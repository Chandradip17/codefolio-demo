import { createApp } from './app.js'
import { config, supabaseConfigured, missingSupabaseVars } from './lib/config.js'
import { getDevfolioEvents, getGdgEvents } from './lib/live.js'
import { startRelay } from './lib/realtime.js'

const app = createApp()

app.listen(config.port, () => {
  console.log(`Codefolio API → http://localhost:${config.port}/api`)
  startRelay()
  if (!supabaseConfigured) {
    console.warn(
      `⚠  Supabase not configured (missing ${missingSupabaseVars().join(', ')}).\n` +
        '   Live GDG/Devfolio feeds work; auth, events and bookings return 503 until you fill in server/.env.',
    )
  }
})

// Keep the live feeds warm so visitors never wait on the slow upstream APIs.
const warm = () =>
  Promise.allSettled([getGdgEvents({ force: true }), getDevfolioEvents({ force: true })]).then((r) =>
    r.forEach((x, i) => x.status === 'rejected' && console.warn(`[live] ${i ? 'Devfolio' : 'GDG'} refresh failed: ${x.reason?.message}`)),
  )
warm()
setInterval(warm, 10 * 60 * 1000).unref()
