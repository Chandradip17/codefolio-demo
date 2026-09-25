import { Button, EmptyState } from '../components/ui'
import { useAuth } from '../context/AuthContext'

export default function NotFound() {
  const { session } = useAuth()
  return (
    <div className="page-center">
      <div className="narrow">
        <EmptyState icon="code" title="404: nothing here" action={<Button to={session ? '/home' : '/'}>{session ? 'Go home' : 'Back to Codefolio'}</Button>}>
          The page may have moved, or the link is wrong.
        </EmptyState>
      </div>
    </div>
  )
}
