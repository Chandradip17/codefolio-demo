// Judging criteria and score summaries — the one place this logic lives on the
// server. The database computes each review's weighted score with the same
// weights (cf_weighted_score); scripts/test-judging.js checks they agree.

export const CRITERIA = [
  { id: 'innovation', label: 'Innovation', weight: 0.25 },
  { id: 'technical', label: 'Technical Implementation', weight: 0.25 },
  { id: 'impact', label: 'Impact', weight: 0.2 },
  { id: 'uiux', label: 'UI/UX', weight: 0.15 },
  { id: 'presentation', label: 'Presentation', weight: 0.15 },
]

// A project is flagged when its judges' weighted scores are this far apart.
export const VARIANCE_THRESHOLD = 2.5

const round2 = (n) => Math.round(n * 100) / 100

// Exact integer maths (scores have one decimal, weights two), rounded half-up
// like Postgres round() — so it always agrees with the database.
export function weightedScore(scores) {
  const thousandths = CRITERIA.reduce((sum, c) => sum + Math.round(Number(scores[c.id]) * 10) * Math.round(c.weight * 100), 0)
  return Math.round(thousandths / 10) / 100
}

// reviews: [{ weighted, innovation, technical, ... }]; judges: how many are assigned.
export function summarize(reviews, judges) {
  const n = reviews.length
  const weights = reviews.map((r) => Number(r.weighted))
  const avg = n ? round2(weights.reduce((a, b) => a + b, 0) / n) : null
  const perCriterion = Object.fromEntries(
    CRITERIA.map((c) => [c.id, n ? round2(reviews.reduce((a, r) => a + Number(r[c.id]), 0) / n) : null]),
  )
  const min = n ? Math.min(...weights) : null
  const max = n ? Math.max(...weights) : null
  const spread = n > 1 ? round2(max - min) : 0
  return {
    reviews: n,
    judges,
    complete: judges > 0 && n >= judges,
    average: avg,
    perCriterion,
    min,
    max,
    spread,
    // Only a flag for the organizer to look at — scores are never changed automatically.
    varianceFlag: n > 1 && spread >= VARIANCE_THRESHOLD,
  }
}

// Rank by average (projects without reviews last); ties share a rank.
export function rank(rows) {
  const sorted = [...rows].sort((a, b) => (b.summary.average ?? -1) - (a.summary.average ?? -1))
  let prev = null
  let prevRank = 0
  return sorted.map((row, i) => {
    const r = row.summary.average == null ? null : row.summary.average === prev ? prevRank : i + 1
    if (row.summary.average != null) {
      prev = row.summary.average
      prevRank = r
    }
    return { ...row, rank: r }
  })
}
