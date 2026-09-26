import { useSearchParams } from 'react-router-dom'
import IdeaAssistantPanel from '../components/IdeaAssistantPanel'

// Full-page view of the AI Idea Assistant (the floating "AI Ideas" button opens the same panel).
export default function IdeaAssistant() {
  const [params] = useSearchParams()
  const h = params.get('h') || ''
  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">AI Idea Assistant</p>
          <h1>Shape your hackathon idea</h1>
          <p className="muted">Personalised project ideas from your hackathon’s details and your skills. AI suggestions are a starting point: you decide what to build.</p>
        </div>
      </header>
      <IdeaAssistantPanel key={h} initialHackathon={h} />
    </div>
  )
}
