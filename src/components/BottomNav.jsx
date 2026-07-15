import { NavLink } from 'react-router-dom'
import { navTabs as tabs } from './navTabs.js'

export default function BottomNav() {
  return (
    // backdrop-blur gives a frosted-glass effect on iOS/Android when content
    // scrolls under the nav. The border stays crisp on non-blur devices.
    // Hidden on desktop (lg+), where the Sidebar takes over.
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-100 bg-white/90 backdrop-blur-md safe-bottom lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                [
                  // min-h ensures 44px touch target (Apple HIG / WCAG 2.5.5).
                  'relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-2',
                  'transition-colors duration-150',
                  isActive ? 'text-brand' : 'text-muted',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active dot indicator above icon */}
                  <span
                    className={[
                      'mb-0.5 h-1 w-1 rounded-full transition-all duration-200',
                      isActive ? 'bg-brand scale-100' : 'scale-0 bg-transparent',
                    ].join(' ')}
                    aria-hidden
                  />
                  <Icon className="h-[22px] w-[22px]" />
                  <span className="text-[10px] font-semibold leading-none tracking-wide">
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
