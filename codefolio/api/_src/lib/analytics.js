// Organizer analytics: derived percentages and factual observations from the
// aggregated numbers the database returns (hackathon_analytics). No guesses:
// every sentence states a count that is in the data.
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function deriveAnalytics(a) {
  const approved = a.registrations.approved
  const rates = {
    // Share of teams/solo participants (expected submitters) who have a project.
    submissionRate: pct(a.submissions.expected - a.submissions.notStarted, a.submissions.expected),
    // Share of approved participants who are in a team.
    teamFormationRate: pct(a.teams.inTeams, approved),
    approvalRate: pct(approved, a.registrations.total),
    reviewCompletion: pct(Math.min(a.judging.reviews, a.judging.expectedReviews), a.judging.expectedReviews),
  }
  return { ...a, rates, insights: insights(a) }
}

export function insights(a) {
  const out = []
  const pending = a.registrations.byStatus?.Pending || 0
  if (pending) out.push({ tone: 'warn', text: `${plural(pending, 'application')} ${pending === 1 ? 'is' : 'are'} waiting for your review.` })
  if (a.teams.max >= 2 && a.teams.notInTeam) {
    out.push({ tone: 'warn', text: `${plural(a.teams.notInTeam, 'approved participant')} ${a.teams.notInTeam === 1 ? 'is' : 'are'} not in a team.` })
  }
  if (a.teams.belowMinimum) out.push({ tone: 'warn', text: `${plural(a.teams.belowMinimum, 'team')} ${a.teams.belowMinimum === 1 ? 'has' : 'have'} fewer members than the minimum of ${a.teams.min}.` })
  if (a.submissions.notStarted && a.submissions.expected) {
    out.push({ tone: 'warn', text: `${a.submissions.notStarted} of ${a.submissions.expected} teams / solo participants haven’t submitted a project yet.` })
  }
  if (a.submissions.submitted && !a.judging.judges) out.push({ tone: 'warn', text: `${plural(a.submissions.submitted, 'project')} submitted, but no judges are assigned yet.` })
  const left = Math.max(0, a.judging.expectedReviews - a.judging.reviews)
  if (a.judging.judges && left) out.push({ tone: 'warn', text: `${plural(left, 'review')} still to be done (${a.judging.reviews} of ${a.judging.expectedReviews} complete).` })
  if (a.judging.expectedReviews && !left && !a.timeline.resultsPublishedAt) out.push({ tone: 'info', text: 'All assigned reviews are complete. Results are not published yet.' })
  const top = a.tech.top.slice(0, 2)
  if (top.length && a.tech.projectsWithTech >= 2) {
    out.push({ tone: 'info', text: `Most-listed technologies: ${top.map((t) => `${t.label} (${t.count} of ${a.tech.projectsWithTech} projects)`).join(' and ')}.` })
  }
  return out
}
