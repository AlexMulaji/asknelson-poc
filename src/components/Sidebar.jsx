import { NavLink } from 'react-router-dom'
import AccountBadge from './AccountBadge.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { navTabs } from './navTabs.js'
import logoUrl from '../assets/logo-asknelson.png'

// Desktop-only left navigation. Hidden below `lg`, where BottomNav takes over.
// Sticks to the top so it stays visible while the content column scrolls.
export default function Sidebar() {
  return (
    <aside className="hidden shrink-0 border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[320px] lg:flex-col">
      <div className="px-8 pt-10 pb-8">
        <img src={logoUrl} alt="AskNelson" className="h-9 w-auto" />
      </div>

      <nav className="flex-1 px-5">
        <ul className="space-y-1.5">
          {navTabs.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3.5 rounded-btn px-4 py-3 text-[16px] transition-colors duration-150',
                    isActive
                      ? 'bg-brand-tint font-extrabold text-brand'
                      : 'font-semibold text-muted hover:bg-canvas hover:text-ink',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={isActive ? 2.2 : 1.9} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Appearance and account, pinned to the bottom of the rail. */}
      <div className="space-y-3 px-5 pb-8">
        <ThemeToggle />
        <AccountBadge variant="full" />
      </div>
    </aside>
  )
}
