// Who may see / change a hackathon project. Used by GitHub and Demo Day routes.
import { admin } from './supabase.js'
import { HttpError, must } from './errors.js'

export async function projectAccess(user, projectId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(projectId))) throw new HttpError(400, 'bad_id', 'Invalid project id.')
  const project = must(await admin.from('projects').select('*').eq('id', projectId).maybeSingle())
  if (!project) throw new HttpError(404, 'project/missing', 'Project not found.')
  const [member, event, judge] = await Promise.all([
    project.team_id
      ? admin.from('team_members').select('user_id').eq('team_id', project.team_id).eq('user_id', user.id).maybeSingle()
      : { data: null },
    admin.from('events').select('id, title, created_by, category').eq('id', project.event_id).single(),
    user.isJudge ? admin.from('judge_assignments').select('judge_id').eq('event_id', project.event_id).eq('judge_id', user.id).maybeSingle() : { data: null },
  ])
  const ev = must(event)
  const canEdit = project.submitted_by === user.id || Boolean(must(member))
  const canManage = ev.created_by === user.id || user.isAdmin
  const isJudge = Boolean(must(judge))
  const canView = canEdit || canManage || isJudge
  // Outsiders get the same answer as a missing project.
  if (!canView) throw new HttpError(404, 'project/missing', 'Project not found.')
  return { project, event: ev, canEdit, canManage, isJudge, canView }
}
