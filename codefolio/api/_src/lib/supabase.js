import { createClient } from '@supabase/supabase-js'
import { config, supabaseConfigured } from './config.js'

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

// Errors raised before the request left this machine (DNS lookup, TCP/TLS
// connect). Retrying them can't double-apply a write, so do it a couple of
// times; flaky local DNS otherwise turns into random 5xx responses.
const CONNECT_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ENETUNREACH'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function retryingFetch(input, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init)
    } catch (e) {
      const code = e?.cause?.code || e?.cause?.errno
      if (attempt >= 2 || !CONNECT_ERRORS.has(code) || init?.signal?.aborted) {
        console.warn(`[supabase] request failed after ${attempt + 1} attempt(s): ${code || e?.cause?.message || e.message}`)
        throw e
      }
      await sleep(250 * (attempt + 1))
    }
  }
}

const options = { auth: serverAuth, global: { fetch: retryingFetch } }

// Service-role client: bypasses RLS. Never expose this key to the browser.
export const admin = supabaseConfigured ? createClient(config.supabaseUrl, config.supabaseServiceKey, options) : null

// A fresh anon client per auth call, so sessions never leak between requests.
export const anonClient = () => createClient(config.supabaseUrl, config.supabaseAnonKey, options)
