import { ZodError } from 'zod'
import { missingSupabaseVars } from './config.js'

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

// Machine codes raised by the SQL functions (in HINT) → HTTP status.
const HINT_STATUS = {
  'auth/missing': 401,
  'booking/role': 403,
  'booking/seats': 422,
  'booking/duplicate': 409,
  'booking/soldout': 409,
  'booking/insufficient': 409,
  'booking/missing': 404,
  'booking/inactive': 409,
  'event/missing': 404,
  'event/cancelled': 409,
  'event/past': 409,
  'event/closed': 409,
  'event/not_open': 409,
  'team/choice': 422,
  'payment/ref': 422,
  'payment/duplicate': 409,
  'payment/proof': 422,
  'team/solo_disabled': 409,
  'team/solo_only': 409,
  'team/already': 409,
  'team/name': 422,
  'team/name_taken': 409,
  'team/not_found': 404,
  'team/wrong_event': 409,
  'team/full': 409,
  'event/capacity': 422,
  'booking/own': 409,
  'booking/self': 403,
  'booking/state': 409,
  'booking/decision': 422,
  'auth/forbidden': 403,
  'host/already': 409,
  'host/pending': 409,
  'host/missing': 404,
  'host/reviewed': 409,
  'host/self': 403,
  'host/decision': 422,
  'qr/not_approved': 409,
  'checkin/invalid': 404,
  'checkin/not_found': 404,
  'checkin/wrong_event': 409,
  'checkin/already': 409,
  'checkin/revoked': 410,
  'checkin/not_approved': 409,
  'checkin/event_closed': 409,
}

// Turn a Supabase/PostgREST error into an HttpError.
export function fromSupabase(error, fallback = 'Database request failed.') {
  if (!error) return null
  if (error.hint && HINT_STATUS[error.hint]) return new HttpError(HINT_STATUS[error.hint], error.hint, error.message)
  if (error.code === '22P02') return new HttpError(400, 'bad_id', 'Invalid id.')
  if (error.code === '23505') return new HttpError(409, 'conflict', 'That already exists.')
  if (error.code === '23514') return new HttpError(422, 'validation', 'A value is out of the allowed range.')
  if (error.code === 'PGRST116') return new HttpError(404, 'not_found', 'Not found.')
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') {
    return new HttpError(500, 'schema_missing', 'Database tables/functions are missing. Run server/supabase/schema.sql in Supabase.')
  }
  return new HttpError(500, 'db_error', fallback, error.message)
}

// Unwrap a single row from an RPC that returns one composite row
// (PostgREST may return it as an object or a one-element array).
export function mustRow(result, fallback) {
  const data = must(result, fallback)
  return Array.isArray(data) ? data[0] : data
}

// Unwrap a supabase-js result or throw.
export function must({ data, error }, fallback) {
  if (error) throw fromSupabase(error, fallback)
  return data
}

export function notConfigured() {
  return new HttpError(503, 'supabase_not_configured', `Supabase isn't configured. Missing: ${missingSupabaseVars().join(', ')} (see server/.env.example).`)
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const fields = {}
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message
    return res.status(422).json({ error: { code: 'validation', message: Object.values(fields)[0] || 'Invalid input.', fields } })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'That upload is too large.' } })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body.' } })
  }
  const status = err instanceof HttpError ? err.status : 500
  if (status >= 500 && status !== 503) console.error('[api]', req.method, req.originalUrl, err.details || err)
  res.status(status).json({
    error: {
      code: err.code || 'internal',
      message: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong.' : err.message,
      ...(err instanceof HttpError && err.fields ? { fields: err.fields } : {}),
    },
  })
}
