import { NavLink } from 'react-router-dom'
import AccountPanel from './AccountPanel.jsx'
import { navTabs } from './navTabs.js'
import BrandLogo from './BrandLogo.jsx'
import { CallIcon } from './Icons.jsx'
import { useGetHelp } from './GetHelp.jsx'

// Desktop-only left navigation. Hidden below `lg`, where BottomNav takes over.
// Sticks to the top so it stays visible while the content column scrolls.
export default function Sidebar() {
  const { openHelp } = useGetHelp()

  return (
    <aside className="hidden shrink-0 overflow-y-auto border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[320px] lg:flex-col">
      <div className="px-8 pt-10 pb-8">
        <BrandLogo />
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
                      : 'font-semibold text-muted hover:bg-surface-sunken hover:text-ink',
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

      {/* Appearance and account, then the always-visible route to urgent help,
          pinned to the bottom of the rail. */}
      <div className="px-7 pb-9">
        <div className="rounded-[8px] border border-line bg-surface px-3.5 pb-[18px] pt-[17px]">
          <AccountPanel />
        </div>
        <button
          type="button"
          onClick={() => openHelp('sidebar')}
          className="mt-7 flex min-h-[50px] w-full items-center justify-center gap-2.5 rounded-[6px] bg-danger text-[17px] font-bold text-white transition hover:brightness-95"
        >
          <CallIcon className="h-[22px] w-[22px]" />
          Get Help Now
        </button>
      </div>
    </aside>
  )
}
