// GitHub: OAuth (server-side), encrypted token storage helpers and a small,
// cache-friendly API client. Tokens never leave the server: the browser only
// ever sees usernames, repository metadata and activity.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

const API = 'https://api.github.com'
const UA = 'Codefolio (+hackathon project integration)'
const STATE_TTL_MS = 10 * 60 * 1000

export class GitHubError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ---------- configuration ----------
const key = () => (config.github.tokenKey ? Buffer.from(config.github.tokenKey, 'base64') : null)
export function oauthStatus() {
  const g = config.github
  const k = key()
  if (!g.clientId || !g.clientSecret) return { configured: false, reason: 'GitHub OAuth App not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).' }
  if (!k || k.length !== 32) return { configured: false, reason: 'GITHUB_TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded.' }
  return { configured: true, scopes: g.scopes, privateRepos: /\brepo\b/.test(g.scopes) }
}

// ---------- token encryption (AES-256-GCM) ----------
export function encryptToken(token) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()])
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`
}
export function decryptToken(blob) {
  if (!blob?.startsWith('v1:')) throw new GitHubError(500, 'github/token', 'Stored GitHub token is unreadable.')
  const raw = Buffer.from(blob.slice(3), 'base64')
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

// ---------- OAuth state (signed, expiring, bound to the member) ----------
const stateKey = () => createHmac('sha256', config.supabaseServiceKey || 'codefolio').update('github-oauth-state').digest()
export function signState(userId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: userId, e: now + STATE_TTL_MS, n: randomBytes(8).toString('hex') })).toString('base64url')
  return `${body}.${createHmac('sha256', stateKey()).update(body).digest('base64url')}`
}
export function verifyState(state, now = Date.now()) {
  const [body, sig] = String(state || '').split('.')
  if (!body || !sig) return null
  const expect = Buffer.from(createHmac('sha256', stateKey()).update(body).digest('base64url'))
  const got = Buffer.from(sig)
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    return p.e > now && typeof p.u === 'string' ? p.u : null
  } catch {
    return null
  }
}
export function authorizeUrl(state) {
  const q = new URLSearchParams({ client_id: config.github.clientId, redirect_uri: config.github.callbackUrl, scope: config.github.scopes, state, allow_signup: 'false' })
  return `https://github.com/login/oauth/authorize?${q}`
}
export async function exchangeCode(code, fetchImpl = fetch) {
  const res = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code, redirect_uri: config.github.callbackUrl }),
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new GitHubError(502, 'github/oauth', body.error_description || 'GitHub did not return an access token.')
  return { token: body.access_token, scopes: body.scope || '' }
}
// Best effort: revoke the grant when a member disconnects.
export async function revokeToken(token, fetchImpl = fetch) {
  const basic = Buffer.from(`${config.github.clientId}:${config.github.clientSecret}`).toString('base64')
  await fetchImpl(`${API}/applications/${config.github.clientId}/grant`, {
    method: 'DELETE',
    headers: { authorization: `Basic ${basic}`, accept: 'application/vnd.github+json', 'user-agent': UA, 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {})
}

// ---------- API client ----------
export function createGitHubClient({ token = null, fetchImpl = fetch } = {}) {
  const auth = token || config.githubToken || null
  async function get(path, { allow404 = false, allow409 = false } = {}) {
    let res
    try {
      res = await fetchImpl(API + path, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': UA, 'x-github-api-version': '2022-11-28', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new GitHubError(502, 'github/unreachable', `Unable to reach GitHub (${e?.cause?.code || e.name}).`)
    }
    if (res.status === 404 && allow404) return { data: null, headers: res.headers }
    if (res.status === 409 && allow409) return { data: [], headers: res.headers } // empty repository
    if (res.status === 401) throw new GitHubError(401, 'github/token', 'GitHub rejected the access token. Reconnect GitHub.')
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'))
      const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.` : ''
      throw new GitHubError(429, 'github/rate_limited', `GitHub rate limit reached.${when}`)
    }
    if (res.status === 404) throw new GitHubError(404, 'github/not_found', 'Repository not found, or you don’t have access to it.')
    if (!res.ok) throw new GitHubError(502, 'github/error', `GitHub returned HTTP ${res.status}.`)
    return { data: await res.json(), headers: res.headers }
  }
  // Total count from a per_page=1 request's pagination (no need to download everything).
  async function count(path, opts) {
    const { data, headers } = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=1`, opts)
    const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(headers.get('link') || '')
    return last ? Number(last[1]) : Array.isArray(data) ? data.length : 0
  }
  return { get, count, authenticatedAs: auth === token && token ? 'user' : auth ? 'server' : 'anonymous' }
}

export function parseRepoUrl(url) {
  const m = String(url || '').trim().match(/^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

const trim = (s, n) => String(s || '').split('\n')[0].slice(0, n)

// Metadata + counts + recent activity. ~8 small requests; never file contents.
export async function fetchRepoSnapshot(client, owner, repo) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const { data: meta } = await client.get(base)
  const [languages, commits, contributors, openPulls, recentCommits, recentPulls, recentIssues] = await Promise.all([
    client.get(`${base}/languages`).then((r) => r.data),
    client.count(`${base}/commits?sha=${encodeURIComponent(meta.default_branch)}`, { allow409: true }),
    client.count(`${base}/contributors?anon=1`, { allow409: true }).catch(() => null),
    client.count(`${base}/pulls?state=open`),
    client.get(`${base}/commits?per_page=10`, { allow409: true }).then((r) => r.data || []),
    client.get(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=5`).then((r) => r.data || []),
    client.get(`${base}/issues?state=all&sort=updated&direction=desc&per_page=10`).then((r) => (r.data || []).filter((i) => !i.pull_request).slice(0, 5)),
  ])
  const totalBytes = Object.values(languages || {}).reduce((a, b) => a + b, 0) || 1
  return {
    repository: {
      github_repo_id: meta.id,
      owner: meta.owner.login,
      repo_name: meta.name,
      repository_url: meta.html_url,
      description: meta.description || '',
      default_branch: meta.default_branch,
      visibility: meta.visibility || (meta.private ? 'private' : 'public'),
      languages: Object.fromEntries(
        Object.entries(languages || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => [k, Math.round((v / totalBytes) * 1000) / 10]),
      ),
      stats: {
        commits,
        contributors,
        openIssues: Math.max(0, (meta.open_issues_count || 0) - openPulls),
        openPullRequests: openPulls,
        stars: meta.stargazers_count,
        forks: meta.forks_count,
        pushedAt: meta.pushed_at,
        updatedAt: meta.updated_at,
        archived: meta.archived,
      },
    },
    activity: [
      ...recentCommits.map((c) => ({
        activity_type: 'commit',
        external_id: c.sha,
        actor: c.author?.login || c.commit?.author?.name || 'unknown',
        message: trim(c.commit?.message, 300),
        activity_url: c.html_url,
        activity_time: c.commit?.author?.date || c.commit?.committer?.date,
      })),
      ...recentPulls.map((p) => ({
        activity_type: 'pull_request',
        external_id: String(p.number),
        actor: p.user?.login || 'unknown',
        message: `#${p.number} ${trim(p.title, 280)} (${p.merged_at ? 'merged' : p.state})`,
        activity_url: p.html_url,
        activity_time: p.updated_at,
      })),
      ...recentIssues.map((i) => ({
        activity_type: 'issue',
        external_id: String(i.number),
        actor: i.user?.login || 'unknown',
        message: `#${i.number} ${trim(i.title, 280)} (${i.state})`,
        activity_url: i.html_url,
        activity_time: i.updated_at,
      })),
    ],
  }
}
