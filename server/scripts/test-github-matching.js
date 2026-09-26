// Offline unit tests: GitHub token encryption, OAuth state signing, repository
// snapshot parsing (mocked fetch — no network), and the team-match scorer.
//   npm run test:github-matching
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { config } from '../src/lib/config.js'

config.github.tokenKey = randomBytes(32).toString('base64')
config.github.clientId = 'test-client'
config.github.clientSecret = 'test-secret'
config.githubToken = null
const gh = await import('../src/lib/github.js')
const { scoreMatch, rankMatches, MATCH_WEIGHTS } = await import('../src/lib/matching.js')

let passed = 0
const test = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.stack}`)
    process.exitCode = 1
  }
}

console.log('GitHub + matching unit tests')

await test('token encryption round-trips, is randomized and tamper-evident', () => {
  const a = gh.encryptToken('gho_example')
  const b = gh.encryptToken('gho_example')
  assert.notEqual(a, b)
  assert.ok(!a.includes('gho_example'))
  assert.equal(gh.decryptToken(a), 'gho_example')
  const raw = Buffer.from(a.slice(3), 'base64')
  raw[raw.length - 1] ^= 1
  assert.throws(() => gh.decryptToken(`v1:${raw.toString('base64')}`))
})

await test('OAuth state: bound to the user, expires, rejects forgery', () => {
  const s = gh.signState('user-1', 1000)
  assert.equal(gh.verifyState(s, 2000), 'user-1')
  assert.equal(gh.verifyState(s, 1000 + 11 * 60 * 1000), null)
  const [body, sig] = s.split('.')
  const forged = Buffer.from(JSON.stringify({ u: 'user-2', e: 9e15, n: 'x' })).toString('base64url')
  assert.equal(gh.verifyState(`${forged}.${sig}`, 2000), null)
  assert.equal(gh.verifyState(`${body}.${sig.slice(0, -2)}xx`, 2000), null)
  assert.equal(gh.verifyState('garbage', 2000), null)
})

await test('oauthStatus + authorize URL use minimum scope, no secret in URL', () => {
  config.github.scopes = 'read:user'
  const s = gh.oauthStatus()
  assert.equal(s.configured, true)
  assert.equal(s.privateRepos, false)
  const url = gh.authorizeUrl('st')
  assert.ok(url.includes('scope=read%3Auser'))
  assert.ok(!url.includes('test-secret'))
})

await test('parseRepoUrl accepts owner/name and github URLs only', () => {
  assert.deepEqual(gh.parseRepoUrl('octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' })
  assert.deepEqual(gh.parseRepoUrl('https://github.com/a/b.git'), { owner: 'a', repo: 'b' })
  assert.equal(gh.parseRepoUrl('https://gitlab.com/a/b'), null)
  assert.equal(gh.parseRepoUrl('a/b/c'), null)
})

const json = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
function mockFetch(routes) {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, auth: init?.headers?.authorization })
    const path = url.replace('https://api.github.com', '')
    for (const [re, h] of routes) if (re.test(path)) return h(path)
    return json({ message: 'Not Found' }, {}, 404)
  }
  f.calls = calls
  return f
}

await test('snapshot: counts from Link headers, languages %, activity rows; token sent only when given', async () => {
  const f = mockFetch([
    [/^\/repos\/o\/r$/, () => json({ id: 7, name: 'r', owner: { login: 'o' }, html_url: 'https://github.com/o/r', description: 'd', default_branch: 'main', visibility: 'private', private: true, open_issues_count: 5, stargazers_count: 3, forks_count: 1, pushed_at: 'p', updated_at: 'u', archived: false })],
    [/\/languages$/, () => json({ JavaScript: 750, CSS: 250 })],
    [/\/commits\?sha=main&per_page=1$/, () => json([{}], { link: '<https://api.github.com/x?per_page=1&page=42>; rel="last"' })],
    [/\/contributors/, () => json([{}], { link: '<https://api.github.com/x?page=3>; rel="last"' })],
    [/\/pulls\?state=open&per_page=1$/, () => json([{}], { link: '<https://api.github.com/x?page=2>; rel="last"' })],
    [/\/commits\?per_page=10$/, () => json([{ sha: 'abc', html_url: 'h', author: { login: 'dev' }, commit: { message: 'First line\nbody', author: { date: '2026-01-01T00:00:00Z' } } }])],
    [/\/pulls\?state=all/, () => json([{ number: 4, title: 'Add x', user: { login: 'dev' }, state: 'closed', merged_at: 't', html_url: 'h', updated_at: 't' }])],
    [/\/issues\?/, () => json([{ number: 9, title: 'Bug', user: { login: 'q' }, state: 'open', html_url: 'h', updated_at: 't' }, { number: 4, pull_request: {} }])],
  ])
  const snap = await gh.fetchRepoSnapshot(gh.createGitHubClient({ token: 'gho_user', fetchImpl: f }), 'o', 'r')
  assert.deepEqual(snap.repository.languages, { JavaScript: 75, CSS: 25 })
  assert.equal(snap.repository.stats.commits, 42)
  assert.equal(snap.repository.stats.contributors, 3)
  assert.equal(snap.repository.stats.openPullRequests, 2)
  assert.equal(snap.repository.stats.openIssues, 3) // 5 open_issues_count − 2 PRs
  assert.equal(snap.repository.visibility, 'private')
  assert.deepEqual(snap.activity.map((a) => a.activity_type), ['commit', 'pull_request', 'issue'])
  assert.equal(snap.activity[0].message, 'First line')
  assert.match(snap.activity[1].message, /merged/)
  assert.ok(f.calls.every((c) => c.auth === 'Bearer gho_user'))
  const anon = mockFetch([[/./, () => json({})]])
  await gh.createGitHubClient({ fetchImpl: anon }).get('/x')
  assert.equal(anon.calls[0].auth, undefined)
})

await test('client error mapping: 404, rate limit, bad token, empty repo', async () => {
  const c = (status, headers) => gh.createGitHubClient({ fetchImpl: async () => json({}, headers, status) })
  await assert.rejects(c(404).get('/x'), { code: 'github/not_found' })
  await assert.rejects(c(403, { 'x-ratelimit-reset': '1700000000' }).get('/x'), { code: 'github/rate_limited', status: 429 })
  await assert.rejects(c(401).get('/x'), { code: 'github/token' })
  assert.deepEqual((await c(409).get('/x', { allow409: true })).data, [])
})

const person = (o) => ({ userId: o.id, name: o.id, skills: [], lookingFor: [], experience: 'intermediate', availability: 'full_time', goal: 'win', interests: [], ...o })
await test('scorer: weights sum to 1; complementary skills beat duplicates; deterministic', () => {
  assert.equal(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0).toFixed(6), '1.000000')
  const me = person({ id: 'me', skills: ['React', 'CSS'], lookingFor: ['backend'], interests: ['AI'] })
  const backend = person({ id: 'b', skills: ['Node.js', 'PostgreSQL'], lookingFor: ['frontend'], interests: ['AI'] })
  const clone = person({ id: 'c', skills: ['React', 'CSS'], lookingFor: ['backend'], interests: ['AI'] })
  const a = scoreMatch(me, backend)
  const b = scoreMatch(me, clone)
  assert.ok(a.percent > b.percent)
  assert.ok(a.percent <= 100 && b.percent >= 0)
  assert.ok(a.reasons.some((r) => /backend/i.test(r)))
  assert.deepEqual(rankMatches(me, [clone, backend]).map((x) => x.candidate.userId), ['b', 'c'])
  assert.deepEqual(scoreMatch(me, backend), a)
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
