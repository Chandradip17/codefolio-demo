// Unstop integration tests: provider, normalization, caching, HTTP API and
// database deduplication. No network access: the provider gets a fake fetch and
// the API runs against an injected catalog.   npm run test:unstop
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { ProviderError, createUnstopProvider } from '../src/lib/external/unstopProvider.js'
import { identityKey, normalizeBatch, normalizeRecord, statusOf } from '../src/lib/external/normalize.js'
import { createCatalog, queryItems } from '../src/lib/external/catalog.js'
import { createApp } from '../src/app.js'

let passed = 0
const test = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.stack?.split('\n').slice(0, 3).join('\n      ')}`)
    process.exitCode = 1
  }
}
const quiet = { info() {}, warn() {}, debug() {} }
const logs = []
const capture = { info: (m) => logs.push(m), warn: (m) => logs.push(m) }
const DAY = 86400000
const iso = (d) => new Date(Date.now() + d * DAY).toISOString()
const cfg = (o = {}) => ({ provider: 'feed', feedUrl: 'https://feed.example.org/v1/events', apiKey: 'secret-key', allowedHosts: ['unstop.com'], cacheTtlMs: 60_000, timeoutMs: 50, maxEvents: 500, syncIntervalMs: 0, production: false, ...o })
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const rec = (i, o = {}) => ({ id: String(i), title: `Event ${i}`, url: `https://unstop.com/hackathons/event-${i}`, type: 'hackathon', mode: 'online', startAt: iso(10 + i), registrationDeadline: iso(5 + i), organizer: `Org ${i}`, ...o })
const noSleep = async () => {}

console.log('Provider')
await test('successful fetch sends the key server-side and follows same-host pagination only', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization })
    if (url.endsWith('/events')) return json({ events: [rec(1), rec(2)], next: 'https://feed.example.org/v1/events?page=2' })
    if (url.endsWith('page=2')) return json({ events: [rec(3)], next: 'https://evil.example.com/steal' })
    throw new Error(`unexpected ${url}`)
  }
  const p = createUnstopProvider(cfg(), { fetchImpl, sleep: noSleep })
  const records = await p.fetchRecords()
  assert.equal(records.length, 3)
  assert.equal(seen.length, 2) // did not follow the cross-host "next"
  assert.equal(seen[0].auth, 'Bearer secret-key')
  const d = p.describe()
  assert.equal(d.feedHost, 'feed.example.org')
  assert.equal(JSON.stringify(d).includes('secret-key'), false)
})
await test('empty response → no records (not an error)', async () => {
  const p = createUnstopProvider(cfg(), { fetchImpl: async () => json({ events: [] }), sleep: noSleep })
  assert.deepEqual(await p.fetchRecords(), [])
})
await test('malformed responses → ProviderError(malformed)', async () => {
  for (const body of [new Response('<html>nope</html>', { status: 200 }), json({ hello: 'world' })]) {
    const p = createUnstopProvider(cfg(), { fetchImpl: async () => body, sleep: noSleep })
    await assert.rejects(p.fetchRecords(), (e) => e instanceof ProviderError && e.kind === 'malformed')
  }
})
await test('timeout → retried 3 times, then ProviderError(timeout)', async () => {
  let calls = 0
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      calls++
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))
    })
  const p = createUnstopProvider(cfg({ timeoutMs: 30 }), { fetchImpl, sleep: noSleep })
  // AbortSignal.timeout's timer doesn't keep Node alive; the real server always has other handles open.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    await assert.rejects(p.fetchRecords(), (e) => e.kind === 'timeout')
  } finally {
    clearInterval(keepAlive)
  }
  assert.equal(calls, 3)
})
await test('API failure: 5xx retried then fails; 4xx fails immediately', async () => {
  let calls = 0
  const p500 = createUnstopProvider(cfg(), { fetchImpl: async () => (calls++, json({}, 503)), sleep: noSleep })
  await assert.rejects(p500.fetchRecords(), (e) => e.kind === 'http' && e.status === 503)
  assert.equal(calls, 3)
  calls = 0
  const p401 = createUnstopProvider(cfg(), { fetchImpl: async () => (calls++, json({}, 401)), sleep: noSleep })
  await assert.rejects(p401.fetchRecords(), (e) => e.kind === 'http' && e.status === 401)
  assert.equal(calls, 1)
})
await test('rate limit (429) → no retry, Retry-After honoured', async () => {
  let calls = 0
  const p = createUnstopProvider(cfg(), { fetchImpl: async () => (calls++, json({}, 429, { 'retry-after': '120' })), sleep: noSleep })
  await assert.rejects(p.fetchRecords(), (e) => e.kind === 'rate_limited' && e.retryAfterMs === 120000)
  assert.equal(calls, 1)
})
await test('off / missing feed URL / mock-in-production are not configured', async () => {
  for (const c of [cfg({ provider: 'off' }), cfg({ feedUrl: '' }), cfg({ provider: 'mock', production: true })]) {
    const p = createUnstopProvider(c, { fetchImpl: async () => assert.fail('must not fetch'), sleep: noSleep })
    assert.equal(p.configured, false)
    await assert.rejects(p.fetchRecords(), (e) => e.kind === 'not_configured')
  }
  const mock = createUnstopProvider(cfg({ provider: 'mock' }), {})
  const records = await mock.fetchRecords()
  assert.ok(records.length > 0 && records.every((r) => r.title.startsWith('[Mock]') && /MOCK DATA/.test(r.description)))
})

console.log('\nNormalization & deduplication')
const opts = { source: 'unstop', allowedHosts: ['unstop.com'] }
await test('normalizes aliases, strips HTML, clamps fields', () => {
  const { item } = normalizeRecord(
    { id: 77, name: 'AI  Hackathon', link: 'https://unstop.com/hackathons/ai-77', event_type: 'Hackathons', format: 'In-Person', city: 'Pune', start_date: '2026-10-10T04:30:00Z', regnEndDate: 1790000000, description: '<p>Build <b>AI</b></p><ul><li>fun</li></ul>', skills: 'Python, ML, Python', themes: [{ name: 'GenAI' }], prizes: '₹1L', logo: 'http://insecure/logo.png' },
    opts,
  )
  assert.equal(item.eventType, 'hackathon')
  assert.equal(item.mode, 'offline')
  assert.equal(item.location, 'Pune')
  assert.equal(item.description, 'Build AI\n• fun')
  assert.deepEqual(item.skills, ['Python', 'ML'])
  assert.deepEqual(item.tags, ['GenAI'])
  assert.equal(item.logo, null) // non-https images dropped
  assert.equal(item.registrationUrl, item.sourceUrl)
  assert.equal(item.registrationDeadline, new Date(1790000000 * 1000).toISOString())
  assert.equal(item.externalId, '77')
  assert.equal(item.identityKey, 'id:77')
})
await test('invalid records are skipped with a reason (partial data still accepted)', () => {
  const { items, skipped } = normalizeBatch(
    [null, 'text', { title: 'x' }, { title: 'No url' }, { title: 'Insecure', url: 'http://unstop.com/a' }, { title: 'Wrong host', url: 'https://unstop.evil.com/a' }, { title: 'Minimal but valid', url: 'https://unstop.com/o/1' }],
    opts,
  )
  assert.equal(items.length, 1)
  assert.equal(items[0].eventType, 'other')
  assert.equal(items[0].mode, 'unknown')
  assert.equal(skipped.length, 6)
  assert.ok(skipped.every((s) => s.reason))
})
await test('identity: provider id, else deterministic fingerprint; duplicates collapse', () => {
  const a = { title: 'Web Dev Sprint!', organizer: 'GDG Pune', startAt: '2026-10-10T04:30:00.000Z' }
  const b = { title: '  web dev   SPRINT ', organizer: 'gdg pune', startAt: '2026-10-10T10:00:00.000Z' }
  assert.equal(identityKey(a), identityKey(b))
  assert.match(identityKey(a), /^fp:[0-9a-f]{32}$/)
  assert.notEqual(identityKey(a), identityKey({ ...a, startAt: '2026-10-11T04:30:00Z' }))
  const { items } = normalizeBatch([rec(1), rec(1, { title: 'Event 1 (updated)' }), { ...a, url: 'https://unstop.com/x' }, { ...b, url: 'https://unstop.com/y' }], opts)
  assert.equal(items.length, 2)
  assert.equal(items.find((i) => i.externalId === '1').title, 'Event 1 (updated)')
})
await test('status: open / closing soon / closed / ended', () => {
  const now = Date.now()
  assert.equal(statusOf({ registrationDeadline: iso(10), startAt: iso(12) }, now), 'open')
  assert.equal(statusOf({ registrationDeadline: iso(1), startAt: iso(12) }, now), 'closing_soon')
  assert.equal(statusOf({ registrationDeadline: iso(-1), startAt: iso(12) }, now), 'closed')
  assert.equal(statusOf({ startAt: iso(-5), endAt: iso(-3) }, now), 'ended')
})

console.log('\nCaching')
function fakeProvider(script) {
  let n = 0
  return {
    name: 'unstop', label: 'Unstop', mode: 'feed', configured: true, mock: false, allowedHosts: ['unstop.com'],
    describe: () => ({ mode: 'feed', configured: true }),
    calls: () => n,
    async fetchRecords() {
      const step = script[Math.min(n++, script.length - 1)]
      if (step instanceof Error) throw step
      return step
    },
  }
}
await test('fresh cache is served without refetching; expired cache is served stale while refreshing', async () => {
  let t = 1_000_000
  const provider = fakeProvider([[rec(1), rec(2)], [rec(1), rec(2), rec(3)]])
  const c = createCatalog({ provider, cfg: cfg(), log: quiet, now: () => t })
  assert.equal((await c.snapshot()).items.length, 2)
  t += 30_000
  const again = await c.snapshot()
  assert.equal(again.stale, false)
  assert.equal(provider.calls(), 1) // cache hit
  t += 60_000 // past TTL (60 s)
  const stale = await c.snapshot()
  assert.equal(stale.stale, true)
  assert.equal(stale.items.length, 2)
  await c._state.inflight
  assert.equal((await c.snapshot()).items.length, 3)
})
await test('provider unavailable → last good copy is kept (stale), errors logged, 429 blocks further calls', async () => {
  let t = 5_000_000
  logs.length = 0
  const provider = fakeProvider([[rec(1)], new ProviderError('rate_limited', 'Feed rate limit reached', { retryAfterMs: 600_000 })])
  const c = createCatalog({ provider, cfg: cfg(), log: capture, now: () => t })
  await c.snapshot()
  t += 120_000
  const s = await c.snapshot()
  assert.equal(s.stale, true)
  await c._state.inflight?.catch(() => {})
  assert.ok(logs.some((m) => /\[unstop\] provider unavailable/.test(m)))
  t += 60_000
  await assert.rejects(c.sync(), (e) => e.kind === 'rate_limited')
  assert.equal(provider.calls(), 2) // blocked: no third upstream call
  assert.equal((await c.snapshot()).items.length, 1)
})
await test('no cache + provider down → snapshot throws (API answers 503)', async () => {
  const c = createCatalog({ provider: fakeProvider([new ProviderError('network', 'down')]), cfg: cfg(), log: quiet })
  await assert.rejects(c.snapshot(), (e) => e.kind === 'network')
})

console.log('\nHTTP API')
const baseItems = [
  rec(1, { title: 'AI Hackathon', tags: ['AI', 'GenAI'], skills: ['Python'], location: 'Online', prize: '₹1L' }),
  rec(2, { title: 'Web Development Hackathon', mode: 'offline', location: 'Bengaluru', skills: ['React'] }),
  rec(3, { title: 'Coding Competition', type: 'competition', organizer: 'CodeClub', registrationDeadline: iso(1) }),
  rec(4, { title: 'Startup Workshop', type: 'workshop', mode: 'hybrid', location: 'Pune', tags: ['Startup'] }),
  rec(5, { title: 'Old Registration', registrationDeadline: iso(-2) }),
  ...Array.from({ length: 30 }, (_, i) => rec(100 + i, { title: `Machine learning meetup ${i}`, type: 'conference' })),
]
async function withServer(catalog, fn) {
  const server = createApp({ unstopCatalog: catalog }).listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/unstop`
  try {
    await fn(async (path, init) => {
      const r = await fetch(base + path, init)
      return { status: r.status, body: await r.json() }
    })
  } finally {
    server.close()
  }
}
const okCatalog = () => createCatalog({ provider: fakeProvider([baseItems]), cfg: cfg(), log: quiet })

await withServer(okCatalog(), async (get) => {
  await test('search matches title, organizer, tags, skills, category, location', async () => {
    const titles = async (q) => (await get(`/events?q=${encodeURIComponent(q)}`)).body.items.map((i) => i.title)
    assert.deepEqual(await titles('ai hackathon'), ['AI Hackathon'])
    assert.deepEqual(await titles('codeclub'), ['Coding Competition'])
    assert.deepEqual(await titles('genai'), ['AI Hackathon'])
    assert.deepEqual(await titles('react'), ['Web Development Hackathon'])
    assert.deepEqual(await titles('workshop startup'), ['Startup Workshop'])
    assert.deepEqual(await titles('bengaluru'), ['Web Development Hackathon'])
  })
  await test('pagination: page/limit/total/hasMore', async () => {
    const p1 = (await get('/events?category=conference&limit=20&page=1')).body
    const p2 = (await get('/events?category=conference&limit=20&page=2')).body
    assert.equal(p1.total, 30)
    assert.equal(p1.items.length, 20)
    assert.equal(p1.hasMore, true)
    assert.equal(p2.items.length, 10)
    assert.equal(p2.hasMore, false)
    assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 30)
  })
  await test('filters: category, mode, location, status, sort', async () => {
    assert.deepEqual((await get('/events?category=competition')).body.items.map((i) => i.title), ['Coding Competition'])
    assert.deepEqual((await get('/events?mode=hybrid')).body.items.map((i) => i.title), ['Startup Workshop'])
    assert.deepEqual((await get('/events?location=pune')).body.items.map((i) => i.title), ['Startup Workshop'])
    assert.deepEqual((await get('/events?status=closing_soon')).body.items.map((i) => i.title), ['Coding Competition'])
    assert.deepEqual((await get('/events?status=closed')).body.items.map((i) => i.title), ['Old Registration'])
    assert.equal((await get('/events?limit=100')).body.items.some((i) => i.title === 'Old Registration'), false) // default: open only
    assert.equal((await get('/events?sort=deadline&limit=1')).body.items[0].title, 'Coding Competition')
    assert.equal((await get('/events?sort=title&limit=1&category=hackathon')).body.items[0].title, 'AI Hackathon')
  })
  await test('invalid parameters → 422 with field errors', async () => {
    for (const qs of ['limit=500', 'page=0', 'page=abc', 'category=party', 'mode=teleport', 'sort=random', `q=${'x'.repeat(101)}`]) {
      const r = await get(`/events?${qs}`)
      assert.equal(r.status, 422, qs)
      assert.equal(r.body.error.code, 'validation')
    }
  })
  await test('detail: 200 with attribution + official link, 404 unknown, 400 malformed id; no raw payload leaks', async () => {
    const list = (await get('/events?q=ai%20hackathon')).body
    assert.equal(list.source.name, 'unstop')
    const one = await get(`/events/${list.items[0].id}`)
    assert.equal(one.status, 200)
    assert.equal(one.body.event.source, 'unstop')
    assert.equal(one.body.event.registrationUrl, 'https://unstop.com/hackathons/event-1')
    assert.equal(one.body.event.prize, '₹1L')
    assert.equal('raw' in one.body.event || 'identityKey' in one.body.event, false)
    assert.equal((await get('/events/un-0000000000000000')).status, 404)
    assert.equal((await get('/events/../../etc')).status, 404)
    assert.equal((await get('/events/DROP-TABLE')).status, 400)
  })
  await test('admin endpoints require sign-in', async () => {
    assert.equal((await get('/status')).status, 401)
    assert.equal((await get('/sync', { method: 'POST' })).status, 401)
  })
})
await withServer(createCatalog({ provider: fakeProvider([new ProviderError('network', 'down')]), cfg: cfg(), log: quiet }), async (get) => {
  await test('provider unavailable with no cache → 503 with a friendly message', async () => {
    const r = await get('/events')
    assert.equal(r.status, 503)
    assert.equal(r.body.error.message, 'Unable to load external events right now. Please try again later.')
  })
})
await withServer(createCatalog({ provider: createUnstopProvider(cfg({ provider: 'off' })), cfg: cfg(), log: quiet }), async (get) => {
  await test('provider off → 200, empty, configured: false (UI shows nothing)', async () => {
    const r = await get('/events')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.items, [])
    assert.equal(r.body.source.configured, false)
  })
})

console.log('\nDatabase deduplication')
{
  const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(await readFile(new URL('../supabase/migrations/20260926150000_external_events.sql', import.meta.url), 'utf8'))
  const up = async (items) => (await db.query(`select upsert_external_events('unstop', $1) as r`, [JSON.stringify(items)])).rows[0].r
  const { items } = normalizeBatch([rec(1), rec(2), { title: 'No id event', organizer: 'X', startAt: iso(3), url: 'https://unstop.com/n' }], opts)
  const rows = items.map(({ raw, ...i }) => ({ ...i, raw }))
  await test('first sync inserts; re-running the same sync creates no duplicates', async () => {
    assert.deepEqual(await up(rows), { inserted: 3, updated: 0 })
    assert.deepEqual(await up(rows), { inserted: 0, updated: 3 })
    assert.equal((await db.query(`select count(*)::int n from external_events`)).rows[0].n, 3)
  })
  await test('changed data updates the existing row (same identity)', async () => {
    const { items: again } = normalizeBatch([rec(1, { title: 'Event 1 renamed' })], opts)
    await up(again)
    const r = (await db.query(`select title, count(*) over ()::int n from external_events where identity_key = 'id:1'`)).rows
    assert.equal(r.length, 1)
    assert.equal(r[0].title, 'Event 1 renamed')
    assert.equal((await db.query(`select count(*)::int n from external_events`)).rows[0].n, 3)
  })
  await test('browser roles have no access; sync status is recorded', async () => {
    await db.query(`select record_external_sync('unstop', true, 3, 3, 0, null)`)
    assert.equal((await db.query(`select fetched from external_sources where source='unstop'`)).rows[0].fetched, 3)
    for (const role of ['anon', 'authenticated']) {
      await db.exec('begin')
      try {
        await db.query(`select set_config('role', '${role}', true)`)
        await assert.rejects(db.query('select * from external_events'), /permission denied/)
      } finally {
        await db.exec('rollback')
      }
    }
  })
  await db.close()
}

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
process.exit(process.exitCode || 0)
