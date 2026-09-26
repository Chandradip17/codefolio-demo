import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import ProfileForm, { AvatarImage } from '../components/ProfileForm'
import { Badge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateTime } from '../utils/format'

export default function Profile({ embedded }) {
  const { user } = useAuth()
  const toast = useToast()

  return (
    <div className={embedded ? '' : 'container page-pad'}>
      <div className="profile">
        <aside className="profile__card">
          <AvatarImage src={user.avatarUrl} name={user.name} className="avatar--xl" />
          <h1 className="profile__name">{user.name}</h1>
          {user.username && <p className="muted mono-handle">@{user.username}</p>}
          <p className="muted">{user.email}</p>
          <Badge tone={user.role === 'organizer' ? 'saffron' : 'indigo'} icon={user.role === 'organizer' ? 'grid' : 'ticket'}>
            {user.role === 'organizer' ? 'Organizer' : 'Attendee'}
          </Badge>
          <p className="small muted">Member since {formatDateTime(user.createdAt).split(',')[0]}</p>
          {user.username && (
            <Link to={`/profile/${user.username}`} className="link link--arrow">
              View public profile <Icon name="arrowRight" size={14} />
            </Link>
          )}
          {user.role !== 'organizer' && !user.isAdmin && (
            <Link to="/host" className="link link--arrow">
              Host events on Codefolio <Icon name="arrowRight" size={14} />
            </Link>
          )}
          <Link to={user.isJudge ? '/judge/dashboard' : '/judge/apply'} className="link link--arrow">
            {user.isJudge ? 'Judge Dashboard' : 'Apply to become a judge'} <Icon name="arrowRight" size={14} />
          </Link>
        </aside>
        <div>
          <ProfileForm mode="edit" onSaved={() => toast({ title: 'Profile updated' })} />
        </div>
      </div>
    </div>
  )
}
