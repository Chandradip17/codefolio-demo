// The one Gemini client for Codefolio (Idea Assistant, Team Matcher suggestions,
// judges' project analysis). Server-side only: the key is read from server/.env,
// sent in a header (never a URL), and never logged or returned.
//
// Every failure becomes an AIError with a participant-safe message:
//   ai/not_configured  503  no key on the server
//   ai/config_invalid  503  key rejected / model unavailable (details only in the server log)
//   ai/rate_limited    429  Gemini quota / rate limit
//   ai/unavailable     502  network, timeout, 5xx, empty / truncated / unreadable output
import { config } from './config.js'

export const AI_MESSAGES = {
  'ai/not_configured': 'AI Idea Assistant is not configured.',
  'ai/config_invalid': 'AI service configuration is invalid.',
  'ai/rate_limited': 'Too many AI requests. Please try again shortly.',
  'ai/unavailable': 'The AI service is temporarily unavailable. Please try again.',
}
const STATUS = { 'ai/not_configured': 503, 'ai/config_invalid': 503, 'ai/rate_limited': 429, 'ai/unavailable': 502 }

export class AIError extends Error {
  constructor(code, message = AI_MESSAGES[code], status = STATUS[code] || 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const geminiConfigured = () => Boolean(config.geminiApiKey)

// Server-log detail without the key (Google error messages can echo request data).
const safe = (s) => {
  let out = String(s || '').slice(0, 300)
  if (config.geminiApiKey) out = out.split(config.geminiApiKey).join('[redacted]')
  return out
}

function classify(status, body) {
  const e = body?.error || {}
  const reasons = (e.details || []).map((d) => d?.reason).filter(Boolean)
  if (status === 429 || e.status === 'RESOURCE_EXHAUSTED') return 'ai/rate_limited'
  if (status === 401 || status === 403 || reasons.includes('API_KEY_INVALID') || /api key/i.test(e.message || '')) return 'ai/config_invalid'
  if (status === 404) return 'ai/config_invalid' // model id not available to this key
  if (status === 400) return 'ai/config_invalid' // request the service rejects: a configuration problem, not the user's
  return 'ai/unavailable'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BACKOFF = [1500, 3000]

/**
 * One structured-JSON Gemini call.
 * `system` holds Codefolio's instructions; `prompt` holds the (untrusted) data.
 * Returns { json, model, usage }. Throws AIError.
 */
export async function callGemini({ system, prompt, schema, temperature = 0.7, maxOutputTokens = 8192, timeoutMs = 90000, retries = 1, fetchImpl = fetch }) {
  if (!config.geminiApiKey) throw new AIError('ai/not_configured')
  const models = [config.geminiModel, ...String(config.geminiFallbackModel || '').split(',').map((m) => m.trim())].filter((m, i, a) => m && a.indexOf(m) === i)
  let last
  for (const model of models) {
    try {
      return await callModel(model, { system, prompt, schema, temperature, maxOutputTokens, timeoutMs, retries, fetchImpl })
    } catch (e) {
      last = e
      // Fall back when this model is overloaded or has used up its own (per-model) quota; never for key/config errors.
      if (!(e instanceof AIError) || !(e.overloaded || e.modelQuota)) throw e
      if (model !== models[models.length - 1]) console.warn(`[ai] ${model} ${e.modelQuota ? 'quota used up' : 'overloaded'}; trying fallback model`)
    }
  }
  throw last
}

async function callModel(model, { system, prompt, schema, temperature, maxOutputTokens, timeoutMs, retries, fetchImpl }) {
  const generationConfig = { temperature, maxOutputTokens, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) }
  // Gemini 3 models: keep internal reasoning light (faster, cheaper, leaves room for the answer).
  if (/^gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' }
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  })

  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetchImpl(`${config.geminiApiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      console.warn(`[ai] Gemini request ${timedOut ? 'timed out' : `failed (${e?.cause?.code || e?.name})`}`)
      if (!timedOut && attempt < retries) {
        await sleep(BACKOFF[attempt] || 3000)
        continue
      }
      throw Object.assign(new AIError('ai/unavailable'), { overloaded: !timedOut })
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const code = classify(res.status, data)
      console.warn(`[ai] Gemini HTTP ${res.status} (${code}): ${safe(data?.error?.message)}`)
      // Temporary overload: one quick retry.
      if (code === 'ai/unavailable' && res.status >= 500 && attempt < retries) {
        await sleep(BACKOFF[attempt] || 3000)
        continue
      }
      const perModel = (data?.error?.details || []).some((d) => (d.violations || []).some((v) => /PerModel/.test(v.quotaId || '')))
      throw Object.assign(new AIError(code), { overloaded: code === 'ai/unavailable' && res.status >= 500, modelQuota: code === 'ai/rate_limited' && perModel })
    }
    const cand = data?.candidates?.[0]
    const text = cand?.content?.parts?.map((p) => p.text || '').join('') || ''
    if (!text) {
      console.warn(`[ai] Gemini returned no text (finish: ${cand?.finishReason || data?.promptFeedback?.blockReason || 'unknown'})`)
      throw new AIError('ai/unavailable')
    }
    if (cand?.finishReason === 'MAX_TOKENS') {
      console.warn('[ai] Gemini output was cut off (MAX_TOKENS)')
      throw new AIError('ai/unavailable')
    }
    try {
      return { json: JSON.parse(text), model, usage: data?.usageMetadata || null }
    } catch {
      console.warn('[ai] Gemini output was not valid JSON')
      throw new AIError('ai/unavailable')
    }
  }
}
