import { PHOTOS, unsplash } from '../data/images'
import Icon from './Icon'

export default function AuthShell({ children }) {
  return (
    <div className="auth">
      <div className="auth__art" aria-hidden="true">
        <img src={unsplash(PHOTOS.highFive, 900, 1200)} alt="" />
        <div className="auth__art-copy">
          <p className="auth__quote">“Came for the free Wi-Fi, left with a co-founder.”</p>
          <p className="auth__quote-by">Every hackathon, ever</p>
          <ul>
            <li>
              <Icon name="check" size={16} /> Live GDG &amp; Devfolio listings
            </li>
            <li>
              <Icon name="check" size={16} /> One-click seat booking
            </li>
            <li>
              <Icon name="check" size={16} /> Organizer tools built in
            </li>
          </ul>
        </div>
      </div>
      <div className="auth__panel">
        <div className="auth__card">{children}</div>
      </div>
    </div>
  )
}
