import { useState } from 'react'
import { ExternalLinkIcon } from '../Icons.jsx'

// Shared controls for the sign-in and registration screens.
//
// Styled with the app's own tokens (brand navy, rounded-btn, shadow-card) rather
// than the POC's Kaelo magenta, so the auth screens sit inside the PWA rather
// than looking bolted on. Touch targets are >=48px throughout, matching the rest
// of the app.

export function Field({
  label,
  hint,
  error,
  optional,
  as = 'input',
  className = '',
  ...props
}) {
  const Tag = as
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-semibold text-gray-600">
        {label}
        {optional ? <span className="font-normal text-gray-400"> (optional)</span> : null}
      </span>
      <Tag
        {...props}
        className={[
          'w-full rounded-btn border bg-white px-3.5 py-3 text-[15px] text-black',
          'outline-none transition-colors placeholder:text-gray-300',
          'focus:border-brand',
          error ? 'border-red-500' : 'border-gray-200',
        ].join(' ')}
      />
      {error ? (
        <span className="mt-1.5 block text-[12px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] leading-relaxed text-gray-400">{hint}</span>
      ) : null}
    </label>
  )
}

export function PasswordField({ label = 'Password', error, hint, value, onChange, ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-semibold text-gray-600">{label}</span>
      <div className="relative">
        <input
          {...props}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          className={[
            'w-full rounded-btn border bg-white py-3 pl-3.5 pr-16 text-[15px] text-black',
            'outline-none transition-colors placeholder:text-gray-300 focus:border-brand',
            error ? 'border-red-500' : 'border-gray-200',
          ].join(' ')}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          // Sits inside the field, so it needs its own comfortable hit area.
          className="absolute right-1 top-1/2 h-11 -translate-y-1/2 rounded-btn px-3 text-[12px] font-semibold text-gray-500 active:bg-gray-50"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <span className="mt-1.5 block text-[12px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] leading-relaxed text-gray-400">{hint}</span>
      ) : null}
    </div>
  )
}

export function PrimaryButton({ children, busy, className = '', ...props }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={[
        'min-h-[48px] w-full rounded-btn bg-brand px-5 text-[15px] font-semibold text-white',
        'transition-transform duration-100 active:scale-[0.98] disabled:opacity-40',
        'disabled:active:scale-100',
        className,
      ].join(' ')}
    >
      {busy ? 'Please wait…' : children}
    </button>
  )
}

export function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={[
        'min-h-[48px] w-full rounded-btn border border-gray-200 bg-white px-5',
        'text-[15px] font-semibold text-gray-700 active:bg-gray-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** A large tappable choice — used for anonymous/identified and OTP channel. */
export function ChoiceCard({ title, description, onClick, accent = '#172B5C' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-press flex w-full items-center gap-3.5 rounded-card border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
    >
      <span
        aria-hidden
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15px] font-semibold text-black">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-gray-500">{description}</span>
      </span>
      <ExternalLinkIcon className="h-4 w-4 shrink-0 -rotate-45 text-gray-300" />
    </button>
  )
}

/** The privacy notice shown before each registration path. */
export function Disclaimer({ tone = 'neutral', title, children }) {
  const styles =
    tone === 'privacy'
      ? 'border-brand-green/30 bg-brand-green/5'
      : 'border-gray-200 bg-gray-50'
  return (
    <div className={`rounded-card border px-4 py-3.5 ${styles}`}>
      <p className="text-[13px] font-semibold text-black">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{children}</p>
    </div>
  )
}

export function FormError({ children }) {
  if (!children) return null
  return (
    <div
      role="alert"
      className="rounded-btn border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-700"
    >
      {children}
    </div>
  )
}
