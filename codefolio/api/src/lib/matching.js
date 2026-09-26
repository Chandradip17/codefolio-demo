// Team Matcher scoring — deterministic and explainable. The ONE place the
// weights and rules live. (Gemini may only suggest skill tags that the member
// confirms; it never touches a score.)

export const MATCH_WEIGHTS = {
  skills: 0.4, // skill complement
  goal: 0.25, // hackathon interest: what each person wants from this hackathon
  experience: 0.15,
  availability: 0.1,
  interests: 0.1, // project interests
}

// Roles a team needs, and the skills that signal them. A skill can signal several roles.
export const ROLES = {
  frontend: { label: 'Frontend', keywords: ['frontend', 'front-end', 'react', 'vue', 'angular', 'svelte', 'next.js', 'nextjs', 'html', 'css', 'javascript', 'typescript', 'tailwind', 'web development', 'web dev', 'dashboard'] },
  backend: { label: 'Backend', keywords: ['backend', 'back-end', 'node', 'node.js', 'nodejs', 'express', 'django', 'flask', 'fastapi', 'spring', 'java', 'go', 'golang', 'rust', 'php', 'laravel', 'ruby', 'rails', 'api', 'rest', 'graphql', 'postgresql', 'postgres', 'mysql', 'mongodb', 'sql', 'supabase', 'firebase', 'python', 'c#', '.net'] },
  ai_ml: { label: 'AI / ML', keywords: ['ai', 'ml', 'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'nlp', 'llm', 'genai', 'generative ai', 'computer vision', 'data science', 'scikit-learn', 'python', 'gemini', 'openai'] },
  design: { label: 'UI/UX Design', keywords: ['ui/ux', 'ux', 'ui', 'ui design', 'ux design', 'figma', 'design', 'product design', 'graphic design', 'adobe xd', 'prototyping'] },
  mobile: { label: 'Mobile', keywords: ['mobile', 'android', 'ios', 'flutter', 'react native', 'kotlin', 'swift', 'dart'] },
  data: { label: 'Data', keywords: ['data', 'data analysis', 'data analytics', 'pandas', 'power bi', 'tableau', 'analytics', 'data engineering', 'spark', 'excel', 'sql'] },
  devops: { label: 'Cloud / DevOps', keywords: ['devops', 'docker', 'kubernetes', 'aws', 'gcp', 'google cloud', 'azure', 'ci/cd', 'linux', 'cloud', 'terraform'] },
  blockchain: { label: 'Web3', keywords: ['web3', 'blockchain', 'solidity', 'ethereum', 'smart contracts'] },
  product: { label: 'Product / Pitching', keywords: ['product', 'product management', 'pitching', 'presentation', 'business', 'marketing', 'research', 'storytelling'] },
}
export const ROLE_IDS = Object.keys(ROLES)

export const EXPERIENCE = { beginner: 0, intermediate: 1, advanced: 2 }
export const AVAILABILITY_LABEL = { full_time: 'available for the whole event', part_time: 'available part-time', flexible: 'flexible on time' }
export const GOAL_LABEL = { win: 'compete to win', learn: 'learn new things', build: 'build a real product', network: 'meet people' }
const GOAL_PAIRS = { 'build|win': 0.7, 'learn|network': 0.7, 'build|learn': 0.6 }

const norm = (s) => String(s || '').toLowerCase().trim()
const listLabel = (ids) => ids.map((r) => ROLES[r].label).join(', ')

// Roles signalled by a list of skills (exact keyword, or keyword as a whole word).
export function rolesOf(skills = []) {
  const out = new Set()
  for (const raw of skills) {
    const s = norm(raw)
    if (!s) continue
    for (const [id, r] of Object.entries(ROLES)) {
      if (r.keywords.some((k) => s === k || new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`).test(s))) out.add(id)
    }
  }
  return out
}

const inter = (a, b) => [...a].filter((x) => b.has(x))
const round = (n) => Math.round(n * 1000) / 1000

// me / them: { skills, lookingFor, experience, availability, goal, interests }
export function scoreMatch(me, them) {
  const myRoles = rolesOf(me.skills)
  const theirRoles = rolesOf(them.skills)
  const need = new Set((me.lookingFor || []).filter((r) => ROLES[r]))
  const theirNeed = new Set((them.lookingFor || []).filter((r) => ROLES[r]))

  // --- skill complement: do they bring what I need, do I bring what they need, what's new ---
  const covered = inter(need, theirRoles)
  const reciprocal = inter(theirNeed, myRoles)
  const fresh = [...theirRoles].filter((r) => !myRoles.has(r))
  const cover = need.size ? covered.length / need.size : 0
  const recip = theirNeed.size ? reciprocal.length / theirNeed.size : 0.5
  const novelty = theirRoles.size ? fresh.length / theirRoles.size : 0
  const skills = need.size ? 0.6 * cover + 0.25 * recip + 0.15 * novelty : 0.6 * novelty + 0.4 * recip

  // --- hackathon interest: goals ---
  const goalKey = [me.goal, them.goal].sort().join('|')
  const goal = me.goal === them.goal ? 1 : GOAL_PAIRS[goalKey] ?? 0.4

  // --- experience ---
  const diff = Math.abs((EXPERIENCE[me.experience] ?? 1) - (EXPERIENCE[them.experience] ?? 1))
  const experience = 1 - 0.5 * diff

  // --- availability ---
  const availability =
    me.availability === them.availability ? 1 : me.availability === 'flexible' || them.availability === 'flexible' ? 0.8 : 0.4

  // --- project interests (Jaccard); unknown = neutral ---
  const mi = new Set((me.interests || []).map(norm).filter(Boolean))
  const ti = new Set((them.interests || []).map(norm).filter(Boolean))
  const sharedInterests = inter(mi, ti)
  const union = new Set([...mi, ...ti])
  const interests = mi.size && ti.size ? sharedInterests.length / union.size : 0.5

  const components = { skills: round(skills), goal: round(goal), experience: round(experience), availability: round(availability), interests: round(interests) }
  const total = Object.entries(MATCH_WEIGHTS).reduce((sum, [k, w]) => sum + w * components[k], 0)

  // Reasons come only from the data above.
  const reasons = []
  if (covered.length) reasons.push(`Brings ${listLabel(covered)} — what you're looking for`)
  else if (!need.size && fresh.length) reasons.push(`Adds ${listLabel(fresh.slice(0, 3))} to your skills`)
  if (reciprocal.length) reasons.push(`Looking for ${listLabel(reciprocal)}, which you have`)
  if (me.goal === them.goal) reasons.push(`Same goal: ${GOAL_LABEL[me.goal]}`)
  if (diff === 0) reasons.push(`Same experience level (${them.experience})`)
  else if (diff === 1) reasons.push(`Close experience levels (you: ${me.experience}, them: ${them.experience})`)
  if (me.availability === them.availability) reasons.push(`Both ${AVAILABILITY_LABEL[me.availability]}`)
  if (sharedInterests.length) reasons.push(`Shared interests: ${sharedInterests.slice(0, 4).join(', ')}`)

  const notes = []
  if (need.size && !covered.length) notes.push(`Doesn't list ${listLabel([...need])}`)
  if (diff === 2) notes.push('Very different experience levels')
  if (availability === 0.4) notes.push('Different availability')

  return {
    percent: Math.round(total * 100),
    score: round(total),
    components,
    reasons,
    notes,
    roles: [...theirRoles],
  }
}

// Rank candidates deterministically: score, then name, then id.
export function rankMatches(me, candidates) {
  return candidates
    .map((c) => ({ candidate: c, match: scoreMatch(me, c) }))
    .sort((a, b) => b.match.score - a.match.score || String(a.candidate.name).localeCompare(String(b.candidate.name)) || String(a.candidate.userId).localeCompare(String(b.candidate.userId)))
}
