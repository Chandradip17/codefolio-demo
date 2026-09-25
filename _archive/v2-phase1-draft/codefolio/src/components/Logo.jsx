import { Link } from 'react-router-dom'

// Placeholder mark derived from the v1 logo ({•}). Replace the <svg> with the
// official Codefolio logo when it's provided; the accent color comes from it.
export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M24 18c-6 0-7 4-7 8s-1 6-5 6c4 0 5 2 5 6s1 8 7 8M40 18c6 0 7 4 7 8s1 6 5 6c-4 0-5 2-5 6s-1 8-7 8"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="5" fill="var(--signal)" />
    </svg>
  )
}

export default function Logo({ to = '/', size = 28 }) {
  return (
    <Link to={to} className="logo" aria-label="Codefolio home">
      <LogoMark size={size} />
      <span className="logo__word">codefolio</span>
    </Link>
  )
}
