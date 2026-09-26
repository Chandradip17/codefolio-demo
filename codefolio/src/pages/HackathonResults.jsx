import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { Button, EmptyState, ErrorState } from '../components/ui'
import * as api from '../services/api'
import { formatDate, formatDateTime } from '../utils/format'
import { ResultsTable } from './admin/OrganizerResults'

// Published hackathon results for members. Unpublished results return 404 from the API.
export default function HackathonResults() {
  const { hackathonId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.publicResults(hackathonId))
    } catch (e) {
      setError(e)
    }
  }, [hackathonId])
  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="container page-pad">
      {error ? (
        error.status === 404 ? (
          <EmptyState
            icon="trophy"
            title="Results aren’t published yet"
            message={error.message}
            action={
              <Button to="/events" variant="secondary" icon="arrowLeft">
                Back to events
              </Button>
            }
          />
        ) : (
          <ErrorState message={error.message} onRetry={load} />
        )
      ) : !data ? (
        <div className="skeleton" style={{ height: 360, borderRadius: 20 }} />
      ) : (
        <>
          <header className="dash-head">
            <div>
              <p className="eyebrow">Hackathon results</p>
              <h1>{data.event.title}</h1>
              <p className="muted">
                {formatDate(data.event.date, { weekday: true })} · judged by {data.judges} {data.judges === 1 ? 'judge' : 'judges'} · published{' '}
                {formatDateTime(data.event.resultsPublishedAt)}
              </p>
            </div>
          </header>
          <ResultsTable rows={data.results} criteria={data.criteria} />
          <p className="small muted table-foot">
            <Icon name="info" size={14} /> Score = average of the judges’ weighted scores (Innovation 25%, Technical 25%, Impact 20%, UI/UX 15%,
            Presentation 15%).
          </p>
        </>
      )}
    </div>
  )
}
