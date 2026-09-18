import { NavLink } from 'react-router-dom'
import { navTabs as tabs } from './navTabs.js'

// Mobile tab bar. In the V1 design the active tab is simply navy-on-white with
// a heavier label — no dot or pill indicator. Hidden on desktop (lg+), where
// the Sidebar takes over.
export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface safe-bottom lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                [
                  // min-h ensures a 44px touch target (Apple HIG / WCAG 2.5.5).
                  'flex min-h-[44px] flex-col items-center justify-center gap-1 px-1 py-2.5',
                  'transition-colors duration-150',
                  isActive ? 'text-ink' : 'text-muted',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 1.9} />
                  <span
                    className={[
                      'text-[10px] leading-none tracking-tight',
                      isActive ? 'font-extrabold' : 'font-semibold',
                    ].join(' ')}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
