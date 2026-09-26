import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { admin, anonClient } from '../lib/supabase.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { bearer, forgetToken, refreshCachedUser, requireAuth } from '../lib/auth.js'
import { toSession, toUser } from '../lib/mappers.js'
import { createJudgeApplication } from './judging.js'
import { config } from '../lib/config.js'
import { forgotSchema, loginSchema, profileSchema, refreshSchema, resetSchema, signupSchema } from '../lib/validate.js'

const router = Router()

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } },
})

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})

async function profileFor(id) {
  const row = must(await admin.from('profiles').select('*').eq('id', id).maybeSingle())
  if (!row) {
    throw new HttpError(500, 'schema_missing', 'Profile row was not created. Did you run server/supabase/schema.sql (it installs the signup trigger)?')
  }
  return toUser(row)
}

async function signIn(email, password) {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    if (/confirm/i.test(error?.message || '')) throw new HttpError(403, 'auth/unconfirmed', 'Please confirm your email address first.')
    throw new HttpError(401, 'auth/invalid', 'Incorrect email or password.')
  }
  return data
}

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  const input = signupSchema.parse(req.body)
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // Accounts are confirmed immediately for a smooth demo. For production, switch to
    // anonClient().auth.signUp() and enable "Confirm email" in Supabase Auth settings.
    email_confirm: true,
    user_metadata: { name: input.name, city: input.city, chapter: input.chapter, bio: input.bio },
  })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new HttpError(409, 'auth/exists', 'An account with this email already exists.')
    }
    if (/password/i.test(error.message)) throw new HttpError(422, 'validation', error.message)
    throw new HttpError(500, 'auth/signup_failed', 'Could not create the account.', error.message)
  }
  // Choosing "Organizer" at sign-up doesn't grant hosting rights: it files a host
  // request that a platform admin must approve (no bypassing the approval system).
  let hostRequest = null
  if (input.role === 'organizer') {
    const { data: hr, error: hrErr } = await admin.rpc('request_host', {
      p_user: created.user.id,
      p_type: 'event',
      p_org: input.chapter,
      p_city: input.city,
      p_reason: input.bio,
    })
    if (hrErr) console.warn('[auth] host request at signup failed:', hrErr.message)
    hostRequest = hr ? { status: 'pending' } : null
  }
  // "Apply to become a Judge": files a pending application; no judge powers until an admin approves.
  let judgeApplication = null
  if (input.judge) {
    try {
      await createJudgeApplication(created.user.id, input.judge)
      judgeApplication = { status: 'pending' }
    } catch (e) {
      console.warn('[auth] judge application at signup failed:', e.message)
    }
  }
  const { session, user } = await signIn(input.email, input.password)
  res.status(201).json({ user: await profileFor(user.id), session: toSession(session), hostRequest, judgeApplication })
})

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const { session, user } = await signIn(email, password)
  res.json({ user: await profileFor(user.id), session: toSession(session) })
})

// POST /api/auth/refresh  { refreshToken }
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body)
  const { data, error } = await anonClient().auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.session) throw new HttpError(401, 'auth/expired', 'Your session has expired. Please log in again.')
  res.json({ session: toSession(data.session) })
})

// POST /api/auth/forgot  { email }: sends a Supabase recovery email.
// Always 202, so the endpoint can't be used to discover which emails have accounts.
router.post('/forgot', authLimiter, async (req, res) => {
  const { email } = forgotSchema.parse(req.body)
  const { error } = await anonClient().auth.resetPasswordForEmail(email, { redirectTo: `${config.appUrl}/reset-password` })
  if (error) console.warn('[auth] reset email failed:', error.message)
  res.status(202).json({ ok: true })
})

// POST /api/auth/reset  { accessToken, password }: token comes from the recovery link
router.post('/reset', authLimiter, async (req, res) => {
  const { accessToken, password } = resetSchema.parse(req.body)
  const { data, error } = await admin.auth.getUser(accessToken)
  if (error || !data?.user) throw new HttpError(401, 'auth/expired', 'This reset link has expired. Request a new one.')
  const upd = await admin.auth.admin.updateUserById(data.user.id, { password })
  if (upd.error) throw new HttpError(422, 'validation', upd.error.message)
  forgetToken(accessToken)
  res.status(204).end()
})

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = bearer(req)
  if (token) {
    forgetToken(token)
    await admin.auth.admin.signOut(token).catch(() => {})
  }
  res.status(204).end()
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }))

// PATCH /api/auth/me  { name, city, chapter, bio }
router.patch('/me', requireAuth, async (req, res) => {
  const patch = profileSchema.parse(req.body)
  const row = must(await admin.from('profiles').update(patch).eq('id', req.user.id).select('*').single())
  const user = toUser(row)
  refreshCachedUser(req.token, user)
  res.json({ user })
})

export default router
