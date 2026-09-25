import { useState } from 'react'
import { Button, Badge, Input, Select, Textarea } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CITIES } from '../data/chapters'
import { formatDateTime } from '../utils/format'

export default function Profile({ embedded }) {
  const { user, updateProfile } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ name: user.name, city: user.city || '', chapter: user.chapter || '', bio: user.bio || '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    if (form.name.trim().length < 2) {
      setError('Enter your full name.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await updateProfile({ ...form, name: form.name.trim() })
      toast({ title: 'Profile updated' })
    } catch (err) {
      toast({ title: "Couldn't save", message: err.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={embedded ? '' : 'container page-pad'}>
      <div className="profile">
        <aside className="profile__card">
          <div className="avatar avatar--xl" aria-hidden="true">
            {user.name.slice(0, 1)}
          </div>
          <h1 className="profile__name">{user.name}</h1>
          <p className="muted">{user.email}</p>
          <Badge tone={user.role === 'organizer' ? 'saffron' : 'indigo'} icon={user.role === 'organizer' ? 'grid' : 'ticket'}>
            {user.role === 'organizer' ? 'Organizer' : 'Attendee'}
          </Badge>
          <p className="small muted">Member since {formatDateTime(user.createdAt).split(',')[0]}</p>
        </aside>
        <form className="card form-stack profile__form" onSubmit={submit} noValidate>
          <h2>Profile details</h2>
          <Input label="Full Name" value={form.name} onChange={set('name')} error={error} required />
          <div className="grid-2">
            <Select label="City" value={form.city} onChange={set('city')} options={[{ value: '', label: 'Not set' }, ...CITIES, 'Other']} />
            <Input label={user.role === 'organizer' ? 'Organization/Chapter' : 'Home chapter (optional)'} value={form.chapter} onChange={set('chapter')} />
          </div>
          <Textarea label="Bio" rows={4} value={form.bio} onChange={set('bio')} />
          <div className="form-actions">
            <Button type="submit" loading={busy}>
              Save profile
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
