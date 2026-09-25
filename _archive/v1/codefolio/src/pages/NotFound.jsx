import { Button, EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <div className="container page-pad">
      <EmptyState
        icon="code"
        title="404: page not found"
        message="This route returned undefined. Let's get you back to the events."
        action={
          <Button to="/" iconRight="arrowRight">
            Back home
          </Button>
        }
      />
    </div>
  )
}
