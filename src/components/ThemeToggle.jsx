import { CrescentIcon, MonitorIcon, SunIcon } from './Icons.jsx'
import { useTheme } from '../hooks/useTheme.jsx'

// The appearance control.
//
// Three options rather than a two-state switch, because "system" has to be
// reachable: a member who has never touched this is following the OS, and
// without a way back there is no route to that state once they have tapped
// once.
//
//   segmented  the labelled three-way control, for a settings surface with
//              room for it (the desktop sidebar, the admin header)
//   icon       a single button that flips to the opposite of what is on
//              screen, for mobile headers where there is room for one tap
//              target. It pins the preference -- see toggle() in useTheme.

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: CrescentIcon },
  { value: 'system', label: 'Auto', Icon: MonitorIcon },
]

export default function ThemeToggle({ variant = 'segmented', tone = 'default', className = '' }) {
  const { preference, theme, setPreference, toggle } = useTheme()

  if (variant === 'icon') {
    const next = theme === 'dark' ? 'light' : 'dark'
    const Icon = theme === 'dark' ? SunIcon : CrescentIcon
    return (
      <button
        type="button"
        onClick={toggle}
        // The control's job is the switch, so the label names the result
        // rather than the current state -- what a screen reader user needs
        // before deciding to press it.
        aria-label={`Switch to ${next} mode`}
        title={`Switch to ${next} mode`}
        className={[
          'grid h-9 w-9 shrink-0 place-items-center rounded-full transition',
          tone === 'white'
            ? 'text-white hover:bg-white/15'
            : 'border border-gray-200 bg-surface text-gray-600 hover:bg-gray-50',
          className,
        ].join(' ')}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={`flex items-center gap-1 rounded-pill border border-gray-200 bg-surface p-1 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(value)}
            className={[
              'flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-pill px-2',
              'text-[12px] font-semibold transition',
              active ? 'bg-brand text-on-brand' : 'text-gray-500 hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
