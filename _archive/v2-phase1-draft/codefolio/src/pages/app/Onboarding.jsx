import { useNavigate } from 'react-router-dom'
import Logo from '../../components/Logo'
import ProfileForm from '../../components/ProfileForm'
import { Button } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { takeNext } from '../../lib/nextPath'

export default function Onboarding() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="onboarding">
      <header className="onboarding__bar">
        <Logo to="/" />
        <span className="muted small">
          Signed in as {user?.email}{' '}
          <Button variant="link" onClick={async () => (await signOut(), navigate('/'))}>
            Sign out
          </Button>
        </span>
      </header>
      <main id="main" className="onboarding__main">
        <p className="eyebrow">Step 1 of 1 · Your profile</p>
        <h1>Set up your developer profile</h1>
        <p className="muted onboarding__lead">
          Hosts see this when you apply, and teammates see it when you join a team. <strong>Name and username are required</strong>; everything else is
          optional and editable later in Settings.
        </p>
        <ProfileForm mode="onboarding" onSaved={() => navigate(takeNext('/home'), { replace: true })} />
      </main>
    </div>
  )
}
