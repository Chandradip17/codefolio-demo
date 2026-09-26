// Project analysis for judges: facts from the GitHub API + an optional Gemini
// summary. Supporting information only — it never scores, ranks or decides.
// Keys live in server/.env (GEMINI_API_KEY, GITHUB_TOKEN) and never reach React.
import { config } from './config.js'
import { AIError, callGemini, geminiConfigured } from './gemini.js'

const GH = 'https://api.github.com'
const MAX_README = 12000
const MAX_PATHS = 300

export function parseRepo(url) {
  const m = String(url || '').match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

async function ghFetch(path, { raw = false, token = null } = {}) {
  const res = await fetch(GH + path, {
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'User-Agent': 'codefolio-judging',
      ...(token || config.githubToken ? { Authorization: `Bearer ${token || config.githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached. Try again later (or set GITHUB_TOKEN on the server).')
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
  return raw ? res.text() : res.json()
}

const has = (paths, re) => paths.some((p) => re.test(p))

// Deterministic facts about the repository (no AI involved).
// `token`: the connecting member's OAuth token for a private repository (server-side only).
export async function repoFacts(githubUrl, { token = null } = {}) {
  const r = parseRepo(githubUrl)
  if (!r) throw new Error('Not a GitHub repository link.')
  const base = `/repos/${r.owner}/${r.repo}`
  const gh = (path, o = {}) => ghFetch(path, { ...o, token })
  const meta = await gh(base)
  if (!meta) return { found: false, owner: r.owner, repo: r.repo }
  const [languages, readme, tree, commits] = await Promise.all([
    gh(`${base}/languages`).catch(() => ({})),
    gh(`${base}/readme`, { raw: true }).catch(() => null),
    gh(`${base}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`).catch(() => null),
    gh(`${base}/commits?per_page=100`).catch(() => null),
  ])
  const paths = (tree?.tree || []).filter((t) => t.type === 'blob').map((t) => t.path)
  const total = Object.values(languages || {}).reduce((a, b) => a + b, 0) || 1
  const manifests = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'pubspec.yaml', 'Gemfile', 'composer.json']
  return {
    found: true,
    owner: r.owner,
    repo: r.repo,
    fullName: meta.full_name,
    description: meta.description || '',
    defaultBranch: meta.default_branch,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null,
    createdAt: meta.created_at,
    pushedAt: meta.pushed_at,
    archived: meta.archived,
    languages: Object.entries(languages || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, bytes]) => ({ name, percent: Math.round((bytes / total) * 1000) / 10 })),
    fileCount: paths.length,
    truncatedTree: Boolean(tree?.truncated),
    commitsSampled: Array.isArray(commits) ? commits.length : null,
    contributorsSampled: Array.isArray(commits) ? new Set(commits.map((c) => c.author?.login || c.commit?.author?.email).filter(Boolean)).size : null,
    readme: { present: Boolean(readme), length: readme ? readme.length : 0 },
    signals: {
      tests: has(paths, /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/i),
      ci: has(paths, /^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\//),
      docker: has(paths, /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/),
      envExample: has(paths, /(^|\/)\.env\.(example|sample)$/),
      license: has(paths, /^LICENSE/i),
      docsFolder: has(paths, /^docs\//i),
    },
    manifests: manifests.filter((m) => paths.some((p) => p === m || p.endsWith(`/${m}`))),
    // Kept for the AI prompt only (not shown as-is).
    _readme: readme ? readme.slice(0, MAX_README) : '',
    _paths: paths.slice(0, MAX_PATHS),
  }
}

// ---------- Gemini ----------
const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: 'What the project does, 2–4 sentences, neutral tone.' },
    techStack: { type: 'ARRAY', items: { type: 'STRING' } },
    structure: { type: 'STRING', description: 'How the code is organised, 1–3 sentences.' },
    documentation: {
      type: 'OBJECT',
      properties: { quality: { type: 'STRING', enum: ['good', 'fair', 'poor', 'missing'] }, notes: { type: 'STRING' } },
      required: ['quality', 'notes'],
    },
    testing: {
      type: 'OBJECT',
      properties: { present: { type: 'BOOLEAN' }, notes: { type: 'STRING' } },
      required: ['present', 'notes'],
    },
    potentialIssues: { type: 'ARRAY', items: { type: 'STRING' } },
    missingInformation: { type: 'ARRAY', items: { type: 'STRING' } },
    questionsForTeam: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'techStack', 'structure', 'documentation', 'testing', 'potentialIssues', 'missingInformation', 'questionsForTeam'],
}

function buildPrompt(project, facts) {
  return [
    'You are helping a human hackathon judge understand a submitted project.',
    'Give factual, neutral supporting information only. Do NOT give scores, ratings out of 10, rankings,',
    'a recommendation to accept/reject, or an opinion on whether it should win. Say "unknown" instead of guessing.',
    'Base everything on the submission and repository data below. Keep each list to at most 6 short items.',
    '',
    `PROJECT TITLE: ${project.title}`,
    `PROBLEM STATEMENT: ${project.problem_statement}`,
    `DESCRIPTION: ${project.description}`,
    `STATED TECH STACK: ${(project.tech_stack || []).join(', ') || 'not given'}`,
    `DEMO: ${project.demo_url || 'none'} · VIDEO: ${project.video_url || 'none'}`,
    '',
    `REPOSITORY: ${facts.fullName} (default branch ${facts.defaultBranch}, ${facts.fileCount} files, last push ${facts.pushedAt})`,
    `LANGUAGES: ${facts.languages.map((l) => `${l.name} ${l.percent}%`).join(', ') || 'unknown'}`,
    `SIGNALS: ${JSON.stringify(facts.signals)} · manifests: ${facts.manifests.join(', ') || 'none'}`,
    `FILE TREE (first ${facts._paths.length}):`,
    facts._paths.join('\n'),
    '',
    'README (truncated):',
    facts._readme || '(no README)',
  ].join('\n')
}

const strList = (v, n = 6) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => x.trim().slice(0, 300)) : [])

// Validate / trim what the model returns (never trust its shape blindly).
export function cleanAnalysis(a) {
  if (!a || typeof a !== 'object') throw new Error('The AI response was empty.')
  const q = ['good', 'fair', 'poor', 'missing'].includes(a.documentation?.quality) ? a.documentation.quality : 'fair'
  return {
    summary: String(a.summary || '').slice(0, 1200),
    techStack: strList(a.techStack, 15),
    structure: String(a.structure || '').slice(0, 800),
    documentation: { quality: q, notes: String(a.documentation?.notes || '').slice(0, 500) },
    testing: { present: Boolean(a.testing?.present), notes: String(a.testing?.notes || '').slice(0, 500) },
    potentialIssues: strList(a.potentialIssues),
    missingInformation: strList(a.missingInformation),
    questionsForTeam: strList(a.questionsForTeam),
  }
}

export async function geminiAnalysis(project, facts) {
  if (!geminiConfigured()) return { status: 'not_configured' }
  try {
    const r = await callGemini({ prompt: buildPrompt(project, facts), schema: ANALYSIS_SCHEMA, temperature: 0.2, maxOutputTokens: 12000, timeoutMs: 90000 })
    return { status: 'ready', model: r.model, ai: cleanAnalysis(r.json) }
  } catch (e) {
    // Participant-safe message from the shared Gemini service.
    throw new Error(e instanceof AIError ? e.message : 'The AI service is temporarily unavailable. Please try again.')
  }
}

// Public (judge-facing) view of the stored facts.
export const publicFacts = (facts) => {
  if (!facts) return null
  const { _readme, _paths, ...rest } = facts
  void _readme
  void _paths
  return rest
}
