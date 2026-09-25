import { createClient } from '@supabase/supabase-js'
import { config, supabaseConfigured } from './config.js'

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

// Service-role client: bypasses RLS. Never expose this key to the browser.
export const admin = supabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: serverAuth })
  : null

// A fresh anon client per auth call, so sessions never leak between requests.
export const anonClient = () => createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: serverAuth })
