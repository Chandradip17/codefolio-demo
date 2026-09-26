// Client-side preview of a judge's weighted score. The criteria and weights come
// from the API (server/src/lib/scoring.js); the database stores the official
// value. Same exact integer maths as the server so the preview always matches.
export function weightedScore(scores, criteria) {
  let thousandths = 0
  for (const c of criteria) {
    const v = Number(scores[c.id])
    if (!Number.isFinite(v)) return null
    thousandths += Math.round(v * 10) * Math.round(c.weight * 100)
  }
  return Math.round(thousandths / 10) / 100
}

export const formatScore = (n) => (n == null ? '–' : Number(n).toFixed(2))
export const percent = (w) => `${Math.round(w * 100)}%`
