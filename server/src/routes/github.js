// /api/github — account connection (OAuth, server-side) and project repositories.
//   GET    /connection                     my connection status
//   POST   /connect                        → { url } to GitHub's authorize page
//   GET    /callback                       GitHub redirects here (no auth header; signed state)
//   DELETE /connection                     disconnect (and revoke the grant)
//   GET    /repos                          my repositories (needs a connection)
//   GET    /projects/:id/repository        repository + recent activity (auto-syncs when stale)
//   POST   /projects/:id/repository        connect a repository to the project
//   POST   /projects/:id/repository/sync   refresh now
//   DELETE /projects/:id/repository        disconnect the repository
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { config } from '../lib/config.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { projectAccess } from '../lib/projectAccess.js'
import {
  GitHubError, authorizeUrl, createGitHubClient, decryptToken, encryptToken, exchangeCode, fetchRepoSnapshot,
  oauthStatus, parseRepoUrl, revokeToken, signState, verifyState,
} from '../lib/github.js'

const STALE_MS = 15 * 60 * 1000
const SYNC_COOLDOWN_MS = 60 * 1000
const KEEP_ACTIVITY = 50

const router = Router()
router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } } }))

const gh = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (e) {
    if (e instanceof GitHubError) throw new HttpError(e.status, e.code, e.message)
    throw e
  }
}

async function connectionOf(userId) {
  return must(await admin.from('github_connections').select('*').eq('user_id', userId).maybeSingle())
}
async function userClient(userId) {
  const c = await connectionOf(userId)
  if (!c) return null
  return { client: createGitHubClient({ token: decryptToken(c.access_token_enc) }), connection: c }
}

// ---------- OAuth callback (browser navigation from GitHub; identity comes from the signed state) ----------
router.get('/callback', async (req, res) => {
  const back = (q) => res.redirect(`${config.appUrl}/dashboard?${new URLSearchParams(q)}`)
  const userId = verifyState(req.query.state)
  if (!userId) return back({ github: 'error', reason: 'expired' })
  if (req.query.error || !req.query.code) return back({ github: 'error', reason: String(req.query.error || 'cancelled').slice(0, 40) })
  if (!oauthStatus().configured) return back({ github: 'error', reason: 'not_configured' })
  try {
    const { token, scopes } = await exchangeCode(String(req.query.code))
    const { data: me } = await createGitHubClient({ token }).get('/user')
    must(
      await admin.from('github_connections').upsert({
        user_id: userId, github_user_id: me.id, github_username: me.login, access_token_enc: encryptToken(token), scopes, updated_at: new Date().toISOString(),
      }),
    )
    console.info(`[github] connected account @${me.login}`)
    back({ github: 'connected' })
  } catch (e) {
    console.warn(`[github] OAuth callback failed: ${e.message}`)
    back({ github: 'error', reason: 'exchange_failed' })
  }
})

router.use(requireAuth)

router.get('/connection', async (req, res) => {
  const c = await connectionOf(req.user.id)
  const s = oauthStatus()
  res.set('Cache-Control', 'no-store').json({
    oauth: { configured: s.configured, privateRepos: Boolean(s.privateRepos), reason: s.configured ? null : req.user.isAdmin ? s.reason : 'Connecting a GitHub account isn’t set up on this server yet.' },
    connected: Boolean(c),
    username: c?.github_username || null,
    scopes: c?.scopes || null,
  })
})

router.post('/connect', (req, res) => {
  const s = oauthStatus()
  if (!s.configured) throw new HttpError(503, 'github/not_configured', `Connecting a GitHub account isn’t set up on this server yet.${req.user.isAdmin ? ` ${s.reason}` : ''}`)
  res.json({ url: authorizeUrl(signState(req.user.id)) })
})

router.delete('/connection', async (req, res) => {
  const c = await connectionOf(req.user.id)
  if (c) {
    if (oauthStatus().configured) await revokeToken(decryptToken(c.access_token_enc))
    must(await admin.from('github_connections').delete().eq('user_id', req.user.id))
  }
  res.status(204).end()
})

router.get(
  '/repos',
  gh(async (req, res) => {
    const uc = await userClient(req.user.id)
    if (!uc) throw new HttpError(409, 'github/not_connected', 'Connect your GitHub account first.')
    const { data } = await uc.client.get('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')
    res.set('Cache-Control', 'no-store').json({
      repos: data.map((r) => ({ id: r.id, fullName: r.full_name, url: r.html_url, private: r.private, description: r.description || '', pushedAt: r.pushed_at })),
    })
  }),
)

// ---------- project repositories ----------
const toRepo = (r) =>
  r && {
    fullName: `${r.owner}/${r.repo_name}`,
    owner: r.owner,
    name: r.repo_name,
    url: r.repository_url,
    description: r.description,
    defaultBranch: r.default_branch,
    visibility: r.visibility,
    languages: r.languages,
    stats: r.stats,
    access: r.access,
    lastSyncedAt: r.last_synced_at,
    syncError: r.sync_error,
  }

async function activityOf(projectId) {
  return must(
    await admin.from('github_activity').select('activity_type, actor, message, activity_url, activity_time').eq('project_id', projectId).order('activity_time', { ascending: false }).limit(20),
  ).map((a) => ({ type: a.activity_type, actor: a.actor, message: a.message, url: a.activity_url, at: a.activity_time }))
}

// Fetch + store. Used on connect, manual sync and stale auto-sync.
async function syncRepository(projectId, { owner, repo, access, connectedBy }) {
  let client
  if (access === 'oauth') {
    const uc = connectedBy && (await userClient(connectedBy))
    if (!uc) {
      must(await admin.from('project_repositories').update({ sync_error: 'The GitHub account that connected this private repository was disconnected.', updated_at: new Date().toISOString() }).eq('project_id', projectId))
      throw new HttpError(409, 'github/not_connected', 'The GitHub account that connected this private repository was disconnected. Reconnect it to sync.')
    }
    client = uc.client
  } else client = createGitHubClient()
  try {
    const snap = await fetchRepoSnapshot(client, owner, repo)
    const now = new Date().toISOString()
    must(await admin.from('project_repositories').upsert({ project_id: projectId, ...snap.repository, access, connected_by: connectedBy, last_synced_at: now, sync_error: null, updated_at: now }))
    if (snap.activity.length) {
      must(await admin.from('github_activity').upsert(snap.activity.map((a) => ({ ...a, project_id: projectId })), { onConflict: 'project_id,activity_type,external_id' }))
    }
    // Keep the cache small.
    const old = must(await admin.from('github_activity').select('id').eq('project_id', projectId).order('activity_time', { ascending: false }).range(KEEP_ACTIVITY, KEEP_ACTIVITY + 500))
    if (old.length) must(await admin.from('github_activity').delete().in('id', old.map((o) => o.id)))
    console.info(`[github] synced ${owner}/${repo} (${snap.activity.length} recent items)`)
  } catch (e) {
    const message = e instanceof GitHubError ? e.message : 'Sync failed.'
    await admin.from('project_repositories').update({ sync_error: message, updated_at: new Date().toISOString() }).eq('project_id', projectId)
    throw e
  }
}

router.get(
  '/projects/:id/repository',
  gh(async (req, res) => {
    const { project, canEdit } = await projectAccess(req.user, req.params.id)
    let row = must(await admin.from('project_repositories').select('*').eq('project_id', project.id).maybeSingle())
    // Stale → refresh in the background (the next load shows it); never per render.
    if (row && (!row.last_synced_at || Date.now() - Date.parse(row.last_synced_at) > STALE_MS)) {
      syncRepository(project.id, { owner: row.owner, repo: row.repo_name, access: row.access, connectedBy: row.connected_by }).catch(() => {})
    }
    res.set('Cache-Control', 'no-store').json({ repository: toRepo(row), activity: row ? await activityOf(project.id) : [], canEdit, projectGithubUrl: project.github_url })
  }),
)

const connectSchema = z.object({ repository: z.string().trim().max(200).optional() })

router.post(
  '/projects/:id/repository',
  gh(async (req, res) => {
    const { project, canEdit } = await projectAccess(req.user, req.params.id)
    if (!canEdit) throw new HttpError(403, 'auth/forbidden', 'Only the project’s team can connect a repository.')
    const { repository } = connectSchema.parse(req.body || {})
    const parsed = parseRepoUrl(repository || project.github_url)
    if (!parsed) throw new HttpError(422, 'validation', 'Use a repository like owner/name or https://github.com/owner/name.')

    // Public access first (no user token needed); private repos need the member's connection.
    let access = 'public'
    let meta = (await createGitHubClient().get(`/repos/${parsed.owner}/${parsed.repo}`, { allow404: true })).data
    if (!meta || meta.private) {
      const uc = await userClient(req.user.id)
      if (!uc) throw new HttpError(404, 'github/not_found', 'Repository not found. If it’s private, connect your GitHub account first.')
      meta = (await uc.client.get(`/repos/${parsed.owner}/${parsed.repo}`, { allow404: true })).data
      if (!meta) throw new HttpError(404, 'github/not_found', 'Repository not found, or your GitHub account can’t access it.')
      access = 'oauth'
    }
    // Keep the project's GitHub link in step (not after judges have started reviewing).
    if (meta.html_url.replace(/\/$/, '').toLowerCase() !== String(project.github_url).replace(/\/$/, '').toLowerCase()) {
      const { count } = await admin.from('project_reviews').select('id', { head: true, count: 'exact' }).eq('project_id', project.id)
      if (count) throw new HttpError(409, 'project/locked', 'Judges have started reviewing, so the project’s repository can’t change.')
      must(await admin.from('projects').update({ github_url: meta.html_url, last_edited_by: req.user.id, updated_at: new Date().toISOString() }).eq('id', project.id))
    }
    await admin.from('github_activity').delete().eq('project_id', project.id) // activity belongs to the previous repo
    await syncRepository(project.id, { owner: meta.owner.login, repo: meta.name, access, connectedBy: req.user.id })
    const row = must(await admin.from('project_repositories').select('*').eq('project_id', project.id).single())
    res.status(201).json({ repository: toRepo(row), activity: await activityOf(project.id) })
  }),
)

router.post(
  '/projects/:id/repository/sync',
  gh(async (req, res) => {
    const { project, canEdit, canManage } = await projectAccess(req.user, req.params.id)
    if (!canEdit && !canManage) throw new HttpError(403, 'auth/forbidden', 'Only the team or the organizer can sync.')
    const row = must(await admin.from('project_repositories').select('*').eq('project_id', project.id).maybeSingle())
    if (!row) throw new HttpError(404, 'github/not_connected', 'No repository is connected to this project yet.')
    if (row.last_synced_at && Date.now() - Date.parse(row.last_synced_at) < SYNC_COOLDOWN_MS) {
      throw new HttpError(429, 'github/cooldown', 'Synced less than a minute ago. Try again shortly.')
    }
    await syncRepository(project.id, { owner: row.owner, repo: row.repo_name, access: row.access, connectedBy: row.connected_by })
    const fresh = must(await admin.from('project_repositories').select('*').eq('project_id', project.id).single())
    res.json({ repository: toRepo(fresh), activity: await activityOf(project.id) })
  }),
)

router.delete('/projects/:id/repository', async (req, res) => {
  const { project, canEdit } = await projectAccess(req.user, req.params.id)
  if (!canEdit) throw new HttpError(403, 'auth/forbidden', 'Only the project’s team can disconnect the repository.')
  must(await admin.from('github_activity').delete().eq('project_id', project.id))
  must(await admin.from('project_repositories').delete().eq('project_id', project.id))
  res.status(204).end()
})

// The token AI analysis should use for a project's repository (private repos only).
export async function analysisTokenFor(projectId) {
  const row = must(await admin.from('project_repositories').select('access, connected_by').eq('project_id', projectId).maybeSingle())
  if (row?.access !== 'oauth' || !row.connected_by) return null
  const c = await connectionOf(row.connected_by)
  return c ? decryptToken(c.access_token_enc) : null
}

export default router
