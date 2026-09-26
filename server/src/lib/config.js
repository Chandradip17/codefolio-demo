const env = process.env
// Integer setting from the environment, clamped; falls back when missing or invalid.
const intEnv = (v, fallback, min, max) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export const config = {
  port: Number(env.PORT) || 4000,
  corsOrigins: (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  imageBucket: env.SUPABASE_IMAGE_BUCKET || 'event-images',
  // Where password-reset emails send people (must be in Supabase Auth → URL Configuration → Redirect URLs).
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // AI project analysis (server-side only; never sent to the browser).
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
  // Optional fallback model(s), comma-separated: used when the main model is overloaded or has used up its per-model quota.
  geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || '',
  // Seconds a member waits between AI idea requests (server-enforced; only requests that reach Gemini count).
  aiIdeaCooldownSeconds: intEnv(env.AI_IDEA_COOLDOWN_SECONDS, 10, 0, 3600),
  // Participant chat limits. The database enforces them (send_chat_message); the UI only mirrors them.
  chat: {
    cooldownSeconds: intEnv(env.CHAT_MESSAGE_COOLDOWN_SECONDS, 5, 0, 3600),
    maxPerMinute: intEnv(env.CHAT_MAX_MESSAGES_PER_MINUTE, 10, 0, 1000),
    maxLength: intEnv(env.CHAT_MAX_MESSAGE_LENGTH, 1000, 1, 4000),
    duplicateWindowSeconds: intEnv(env.CHAT_DUPLICATE_WINDOW_SECONDS, 60, 0, 86400),
    readOnlyAfterEnd: env.CHAT_READ_ONLY_AFTER_END !== 'false',
    pageSize: 50,
  },
  // Override only for a proxy / local mock; the key never leaves the server either way.
  geminiApiBase: (env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  // Optional: raises the GitHub API rate limit from 60 to 5,000 requests/hour.
  githubToken: env.GITHUB_TOKEN || '',
  // GitHub OAuth App (lets members connect their account; needed for private repos).
  github: {
    clientId: env.GITHUB_CLIENT_ID || '',
    clientSecret: env.GITHUB_CLIENT_SECRET || '',
    // Must match the OAuth App's "Authorization callback URL".
    callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL || `${(env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')}/api/github/callback`,
    // 'read:user' = public repos only. Add 'repo' to read private repos (GitHub has no read-only private scope for OAuth Apps).
    scopes: env.GITHUB_OAUTH_SCOPES || 'read:user',
    // 32 random bytes, base64 — encrypts stored access tokens (AES-256-GCM).
    tokenKey: env.GITHUB_TOKEN_ENCRYPTION_KEY || '',
  },
  // External listings from Unstop (see docs/unstop-integration.md).
  // off (default) | feed (licensed JSON feed / official API) | mock (local dev only, never in production)
  unstop: {
    provider: ['off', 'feed', 'mock'].includes(env.UNSTOP_PROVIDER) ? env.UNSTOP_PROVIDER : 'off',
    feedUrl: env.UNSTOP_FEED_URL || '',
    apiKey: env.UNSTOP_API_KEY || '',
    allowedHosts: (env.UNSTOP_ALLOWED_HOSTS || 'unstop.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    cacheTtlMs: Math.max(60, Number(env.UNSTOP_CACHE_TTL_SECONDS) || 900) * 1000,
    timeoutMs: Math.min(60000, Math.max(2000, Number(env.UNSTOP_TIMEOUT_MS) || 15000)),
    syncIntervalMs: Math.max(0, Number(env.UNSTOP_SYNC_INTERVAL_MINUTES) || 0) * 60 * 1000,
    maxEvents: Math.min(2000, Math.max(10, Number(env.UNSTOP_MAX_EVENTS) || 500)),
    // false = keep listings in memory only (no database copy)
    persist: env.UNSTOP_PERSIST !== 'false',
  },
  production: env.NODE_ENV === 'production',
}

export const supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceKey)

export function missingSupabaseVars() {
  return [
    ['SUPABASE_URL', config.supabaseUrl],
    ['SUPABASE_ANON_KEY', config.supabaseAnonKey],
    ['SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)
}
