# Learning Log

## 2026-09-22 — Auth pages (login/register/password) now follow app-wide dark/light theming

`src/assets/auth/auth_style.css` had its own hardcoded hex palette (`--navy`, `--text-body`, etc.) with no dark-mode variant, while the rest of the app themes everything through CSS variables defined once in `index.css` (`:root` / `.dark`) and consumed via Tailwind tokens. On a device with dark mode on, `<html>` got the `.dark` class, and `index.css`'s theme-aware `body { color: rgb(var(--ink)) }` won a cascade tie against the auth stylesheet's hardcoded `body { color: var(--navy) }`, resolving to a near-white value on the auth screens' hardcoded white background — reading as washed-out grey text on the register page's header and typed input text.

Fixed by re-pointing `auth_style.css`'s own custom properties at the shared tokens (`--navy: rgb(var(--ink))`, `--border: rgb(var(--line))`, etc.) and swapping hardcoded `#fff` surfaces to `rgb(var(--surface))`, instead of rewriting the ~400 lines of rules that already reference those custom properties correctly. This also fully resolves the underlying cascade-order fragility, since both stylesheets' `body` color rules now compute to the identical value regardless of which one wins the tie. The login screen's fixed dark photo-hero background was left untouched — it's a deliberate brand treatment, not a dark-mode surface.
