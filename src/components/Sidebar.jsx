import { NavLink } from 'react-router-dom'
import { navTabs } from './navTabs.js'
import ConfidentialityStamp from './ConfidentialityStamp.jsx'
import logoUrl from '../assets/logo-asknelson.png'

// Desktop-only left navigation. Hidden below the `lg` breakpoint, where the
// mobile BottomNav takes over instead. Sticks to the top so it stays visible
// while the content column scrolls — the expected feel of a desktop web app.
export default function Sidebar() {
  return (
    <aside className="hidden shrink-0 border-r border-gray-100 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:flex-col">
      {/* Logo */}
      <div className="px-6 pt-7 pb-6">
        <img src={logoUrl} alt="AskNelson" className="h-7 w-auto" />
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {navTabs.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-btn px-3 py-2.5 text-[15px] font-semibold transition-colors duration-150',
                    isActive
                      ? 'bg-brand/5 text-brand'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
                  ].join(' ')
                }
              >
                <Icon className="h-[22px] w-[22px] shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Confidentiality stamp — always visible alongside the desktop nav */}
      <div className="px-6 pb-7 pt-4">
        <ConfidentialityStamp />
      </div>
    </aside>
  )
}
