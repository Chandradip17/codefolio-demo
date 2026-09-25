const env = process.env

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
