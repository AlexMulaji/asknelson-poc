import { NavLink } from 'react-router-dom'
import { navTabs as tabs } from './navTabs.js'
import { AlertIcon } from './Icons.jsx'
import { useGetHelp } from './GetHelp.jsx'

// Mobile tab bar. In the V1 design the active tab is simply navy-on-white with
// a heavier label — no dot or pill indicator. Hidden on desktop (lg+), where
// the Sidebar takes over.
//
// The last slot is Get Help: red, and a button rather than a tab, because it
// opens the help dialog over whatever screen the member is on.
const ITEM = 'flex min-h-[44px] w-full flex-col items-center justify-center gap-1 px-1 py-2.5' // 44px touch target (Apple HIG / WCAG 2.5.5)
const LABEL = 'text-[10px] leading-none tracking-tight'

export default function BottomNav() {
  const { openHelp } = useGetHelp()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface safe-bottom lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                [ITEM, 'transition-colors duration-150', isActive ? 'text-ink' : 'text-muted'].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 1.9} />
                  <span className={`${LABEL} ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button type="button" onClick={() => openHelp('tabbar')} className={`${ITEM} text-danger`}>
            <AlertIcon className="h-[22px] w-[22px]" />
            <span className={`${LABEL} font-extrabold`}>Get Help</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
