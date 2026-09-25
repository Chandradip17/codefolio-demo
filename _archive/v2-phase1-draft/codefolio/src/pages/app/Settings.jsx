import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProfileForm from '../../components/ProfileForm'
import { Button, PageHeader, Segmented } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'

const PROVIDER_LABEL = { google: 'Google', email: 'Email code' }

export default function Settings() {
  const { user, signOut } = useAuth()
  const { preference, setPreference } = useTheme()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean)

  return (
    <div className="wrap page page--narrow">
      <PageHeader eyebrow="Settings" title="Settings" />

      <section className="settings-block" aria-labelledby="s-profile">
        <h2 id="s-profile">Profile</h2>
        <ProfileForm mode="edit" onSaved={() => toast({ title: 'Profile saved' })} />
      </section>

      <section className="settings-block" aria-labelledby="s-appearance">
        <h2 id="s-appearance">Appearance</h2>
        <p className="muted small">Saved on this device.</p>
        <Segmented
          label="Theme"
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'system', label: 'System', icon: 'monitor' },
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
          ]}
        />
      </section>

      <section className="settings-block" aria-labelledby="s-account">
        <h2 id="s-account">Account</h2>
        <dl className="kv">
          <div>
            <dt>Email</dt>
            <dd>{user?.email}</dd>
          </div>
          <div>
            <dt>Sign-in methods</dt>
            <dd>{providers.map((p) => PROVIDER_LABEL[p] || p).join(', ') || '—'}</dd>
          </div>
        </dl>
        <div className="row-actions">
          <Button variant="secondary" icon="logout" onClick={async () => (await signOut(), navigate('/'))}>
            Sign out
          </Button>
          <Button
            variant="ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await supabase.auth.signOut({ scope: 'global' })
              navigate('/')
            }}
          >
            Sign out of all devices
          </Button>
        </div>
      </section>
    </div>
  )
}
