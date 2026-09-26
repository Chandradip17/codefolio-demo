import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Modal from './Modal'
import IdeaAssistantPanel from './IdeaAssistantPanel'
import { Button } from './ui'
import { useAuth } from '../context/AuthContext'
import { cx } from '../utils/format'

// Pages where a floating control would get in the way (sign-in flow, the chat
// composer, projector screens) or where the assistant already fills the page.
const HIDDEN = [/^\/(login|signup|onboarding|auth\/callback|forgot-password|reset-password)/, /^\/hackathons\/(.+\/)?chat$/, /^\/demo\//, /^\/idea-assistant/]

// Standalone entry to the AI Idea Assistant: bottom-left, members only
// (generation itself is authenticated and membership-checked on the server).
export default function AiIdeasButton() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [footerVisible, setFooterVisible] = useState(false)

  // Step aside when the footer is on screen so its links are never covered.
  useEffect(() => {
    const footer = document.querySelector('.footer')
    if (!footer || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setFooterVisible(e.isIntersecting), { threshold: 0 })
    io.observe(footer)
    return () => io.disconnect()
  }, [pathname])

  if (!user?.onboarded || HIDDEN.some((re) => re.test(pathname))) return null
  return (
    <>
      <Button className={cx('ai-fab', footerVisible && !open && 'is-away')} icon="sparkles" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Open the AI Idea Assistant" tabIndex={footerVisible ? -1 : 0}>
        AI Ideas
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="AI Idea Assistant" size="lg" className="ia-modal">
          <IdeaAssistantPanel onNavigate={() => setOpen(false)} />
        </Modal>
      )}
    </>
  )
}
