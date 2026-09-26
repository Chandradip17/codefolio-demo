import { useCallback, useEffect, useState } from 'react'
import Icon from './Icon'
import { Badge, Button, Input, Select } from './ui'
import { useToast } from '../context/ToastContext'
import * as api from '../services/api'
import { formatDate, formatDateTime, timeAgo } from '../utils/format'

const TYPE_ICON = { commit: 'code', pull_request: 'layers', issue: 'alert' }
const when = (iso) => (Date.now() - Date.parse(iso) < 86400000 ? timeAgo(Date.parse(iso)) : formatDate(iso.slice(0, 10)))

// GitHub repository linked to a hackathon project: metadata, stats and recent
// activity, synced by the server. Access tokens never reach the browser.
export default function RepoPanel({ projectId, editable = false, compact = false }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [conn, setConn] = useState(null)
  const [repos, setRepos] = useState(null)
  const [error, setError] = useState('')
  const [repoInput, setRepoInput] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const r = await api.projectRepository(projectId)
      setData(r)
      setRepoInput((v) => v || r.projectGithubUrl || '')
    } catch (e) {
      setError(e.message)
    }
  }, [projectId])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!editable) return
    api.githubConnection().then(
      (c) => {
        setConn(c)
        if (c.connected) api.githubRepos().then(setRepos, () => setRepos([]))
      },
      () => setConn(null),
    )
  }, [editable])

  async function run(kind, fn, done) {
    setBusy(kind)
    try {
      const r = await fn()
      if (r) setData((d) => ({ ...d, ...r }))
      if (done) toast(done)
    } catch (e) {
      toast({ title: 'GitHub', message: e.message, tone: 'error' })
    } finally {
      setBusy('')
    }
  }
  const connect = () => run('connect', () => api.connectProjectRepository(projectId, repoInput.trim()), { title: 'Repository connected', message: 'Stats and recent activity are synced.' })
  const sync = () => run('sync', () => api.syncProjectRepository(projectId), { title: 'Repository synced' })
  const unlink = () =>
    run('unlink', async () => {
      await api.disconnectProjectRepository(projectId)
      return { repository: null, activity: [] }
    }, { title: 'Repository disconnected', tone: 'info' })
  async function linkAccount() {
    setBusy('account')
    try {
      window.location.assign(await api.githubConnectUrl())
    } catch (e) {
      toast({ title: 'GitHub', message: e.message, tone: 'error' })
      setBusy('')
    }
  }

  const repo = data?.repository
  const st = repo?.stats || {}

  return (
    <section className="card judge-card repo-panel" aria-labelledby={`repo-h-${projectId}`}>
      <div className="card__head">
        <h3 id={`repo-h-${projectId}`}>
          <Icon name="github" size={17} /> GitHub repository
        </h3>
        {repo && (
          <Button size="sm" variant="secondary" icon="external" href={repo.url}>
            View repository
          </Button>
        )}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          <Icon name="alert" size={15} /> {error}
        </p>
      ) : !data ? (
        <div className="skeleton" style={{ height: 90, borderRadius: 14 }} />
      ) : !repo ? (
        editable ? (
          <div className="form-stack">
            {repos?.length ? (
              <Select
                label="Choose one of your repositories"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                options={[{ value: data.projectGithubUrl || '', label: 'Project’s GitHub link' }, ...repos.map((r) => ({ value: r.fullName, label: `${r.fullName}${r.private ? ' (private)' : ''}` }))]}
              />
            ) : (
              <Input label="Repository" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder="owner/name or https://github.com/owner/name" hint="Public repositories work without connecting an account." />
            )}
            <div className="row-actions">
              <Button size="sm" icon="refresh" onClick={connect} loading={busy === 'connect'} disabled={!repoInput.trim()}>
                Connect repository
              </Button>
              {conn && !conn.connected && conn.oauth.configured && (
                <Button size="sm" variant="ghost" icon="github" onClick={linkAccount} loading={busy === 'account'}>
                  Connect GitHub account
                </Button>
              )}
            </div>
            {conn && !conn.connected && (
              <p className="small muted">
                <Icon name="lock" size={13} />{' '}
                {conn.oauth.configured
                  ? conn.oauth.privateRepos
                    ? 'Private repository? Connect your GitHub account first.'
                    : 'Connecting your account lists your repositories. Private repositories aren’t enabled on this server.'
                  : conn.oauth.reason}
              </p>
            )}
          </div>
        ) : (
          <p className="muted small">The team hasn’t connected a repository yet.{data.projectGithubUrl ? ' The submitted link is above.' : ''}</p>
        )
      ) : (
        <>
          <p className="small">
            <strong>{repo.fullName}</strong> <Badge tone={repo.visibility === 'public' ? 'neutral' : 'warn'} icon={repo.visibility === 'public' ? undefined : 'lock'}>{repo.visibility}</Badge>
            {repo.description ? <span className="muted"> · {repo.description}</span> : null}
          </p>
          <h4 className="repo-panel__label">Statistics</h4>
          <div className="event-summary__nums repo-stats">
            {[
              ['Commits', st.commits],
              ['Contributors', st.contributors],
              ['Open PRs', st.openPullRequests],
              ['Open issues', st.openIssues],
              ['Stars', st.stars],
            ].map(([k, v]) => (
              <span key={k}>
                <strong>{v ?? '–'}</strong> {k}
              </span>
            ))}
          </div>
          {Object.keys(repo.languages || {}).length > 0 && (
            <>
            <h4 className="repo-panel__label">Languages</h4>
            <ul className="judge-langs">
              {Object.entries(repo.languages).slice(0, compact ? 3 : 6).map(([name, pct]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span className="meter" aria-hidden="true">
                    <span className="meter__fill" style={{ width: `${pct}%` }} />
                  </span>
                  <small className="muted">{pct}%</small>
                </li>
              ))}
            </ul>
            </>
          )}
          {data.activity?.length > 0 && (
            <div className="judge-ai__block">
              <h4>Recent activity</h4>
              <ul className="mini-list">
                {data.activity.slice(0, compact ? 5 : 10).map((a) => (
                  <li key={`${a.type}:${a.url}`}>
                    <div>
                      <strong className="break">
                        <Icon name={TYPE_ICON[a.type] || 'code'} size={13} />{' '}
                        <a className="link" href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.message || a.type}
                        </a>
                      </strong>
                      <small>
                        {a.actor}{a.at ? ` · ${when(a.at)}` : ''}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {repo.syncError && (
            <p className="form-error" role="status">
              <Icon name="alert" size={15} /> {repo.syncError}
            </p>
          )}
          <p className="small muted">
            {repo.lastSyncedAt ? `Synced ${formatDateTime(repo.lastSyncedAt)}` : 'Not synced yet'} · counts are informational only and never affect scores.
          </p>
          {editable && (
            <div className="row-actions">
              <Button size="sm" variant="secondary" icon="refresh" onClick={sync} loading={busy === 'sync'}>
                Sync now
              </Button>
              <Button size="sm" variant="danger-ghost" icon="x" onClick={unlink} loading={busy === 'unlink'}>
                Disconnect
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
