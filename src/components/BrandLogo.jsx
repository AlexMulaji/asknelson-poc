import logoBlue from '../assets/logo-asknelson-blue.png'
import logoWhite from '../assets/logo-asknelson-white.png'

// The askNelson wordmark for in-app (Tailwind) surfaces. Both marks are
// rendered and the `dark:` variant shows the one matching <html>.dark -- blue
// on light, white on dark (the blue mark's navy "ask" disappears on a dark
// surface). CSS-only, so there's no flash when the theme toggles. Auth screens
// have their own equivalent: Logo in components/auth/authPrims.jsx.
export default function BrandLogo({ className = 'h-9 w-auto' }) {
  return (
    <>
      <img src={logoBlue} alt="AskNelson" className={`${className} dark:hidden`} />
      <img src={logoWhite} alt="AskNelson" className={`${className} hidden dark:block`} />
    </>
  )
}
