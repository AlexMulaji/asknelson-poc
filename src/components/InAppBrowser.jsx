import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CloseIcon, ExternalLinkIcon } from './Icons.jsx'
import { track } from '../lib/analytics.js'
import { pushContentOpened } from '../lib/progressSync.js'
import {
  cachedVerdict,
  checkEmbeddable,
  hostOf,
  isExternalUrl,
  videoEmbedUrl,
} from '../lib/externalLinks.js'

// In-app viewer for external articles, videos and the booking form.
//
// Three ways a link can open, in order of preference:
//   1. video    - YouTube/TED/Vimeo play in the provider's embed player.
//   2. embedded - the publisher allows framing, so the page opens inside the
//                 app. Back (button or gesture) closes it and the screen
//                 underneath stays exactly where it was.
//   3. popup    - the publisher refuses framing (about half of them do), so
//                 the page opens in a window over the app on desktop, or a
//                 browser tab on mobile, with AskNelson still open behind it.
//
// Framing is the publisher's choice, declared in their headers and checked
// server-side. Cards warm that check on hover or first touch, so the click
// already knows the answer and can open the popup inside the user's gesture -
// a popup opened after an await would be blocked by the browser.

const POPUP_FEATURES = 'noopener,noreferrer,popup=yes,width=560,height=840'

function openPopup(url) {
  try {
    return window.open(url, '_blank', POPUP_FEATURES)
  } catch {
    return null
  }
}

/** True for an ordinary click — not a new-tab/window gesture the browser should handle. */
export const isPlainClick = (e) =>
  !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

/**
 * Returns open(url, meta) — shows the URL in the viewer, or in a popup window
 * when the publisher is known to refuse framing. meta: { title, contentId,
 * themeId, type, record }. `record: false` keeps it out of the member's
 * "recently opened" list (e.g. the booking form).
 */
export function useOpenExternal() {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (url, meta = {}) => {
      if (!isExternalUrl(url)) return false
      const { record = true, ...details } = meta
      const remember = () => {
        if (record) {
          pushContentOpened({
            contentId: details.contentId,
            url,
            title: details.title,
            themeId: details.themeId,
            type: details.type,
          })
        }
      }

      // Known to refuse framing: straight to a popup, while this still counts
      // as a user gesture. If the browser blocks it anyway, fall through to the
      // viewer, which explains and offers the link again.
      const known = cachedVerdict(url)
      if (known && !known.embeddable && !videoEmbedUrl(url)) {
        if (openPopup(url)) {
          track('external_opened_outside', { host: hostOf(url), from: 'popup' })
          remember()
          return true
        }
      }

      navigate(`${location.pathname}${location.search}${location.hash}`, {
        state: { ...(location.state ?? {}), viewer: { url, ...details } },
      })
      remember()
      return true
    },
    [navigate, location]
  )
}

function Spinner() {
  return (
    <div className="absolute inset-0 grid place-items-center" aria-hidden>
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
    </div>
  )
}

function Viewer({ viewer, onClose }) {
  const { url, title } = viewer
  const host = hostOf(url)
  const video = videoEmbedUrl(url)
  const [mode, setMode] = useState(video ? 'video' : 'checking') // video | checking | embed | blocked
  const [loaded, setLoaded] = useState(false)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const modeRef = useRef(mode)
  onCloseRef.current = onClose
  modeRef.current = mode

  useEffect(() => {
    if (video) return
    let alive = true
    checkEmbeddable(url).then((verdict) => {
      if (alive) setMode(verdict.embeddable ? 'embed' : 'blocked')
    })
    return () => {
      alive = false
    }
  }, [url, video])

  // How content is actually consumed: which way it opened, and for how long.
  // A cross-origin frame hides everything inside it, so dwell time is the
  // most the app can know.
  useEffect(() => {
    if (mode === 'checking') return
    track('external_opened', { host, mode, content_id: viewer.contentId ?? null, type: viewer.type ?? null })
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const openedAt = Date.now()
    return () =>
      track('external_closed', {
        host,
        mode: modeRef.current,
        seconds: Math.round((Date.now() - openedAt) / 1000),
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Modal behaviour: page scroll locked, focus on close, Escape closes.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const openOutside = (from) => track('external_opened_outside', { host, from })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || host}
      className="fixed inset-0 z-[60] flex flex-col bg-white"
    >
      <header className="flex items-center gap-1 border-b border-line bg-white px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))]">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-navy transition hover:bg-canvas"
        >
          <CloseIcon className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[15px] font-extrabold leading-tight text-navy">{title || host}</p>
          <p className="truncate text-[12px] font-bold text-slate-400">{host}</p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => openOutside('header')}
          aria-label="Open in browser"
          title="Open in browser"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-canvas"
        >
          <ExternalLinkIcon className="h-5 w-5" />
        </a>
      </header>

      <div className="relative flex-1 bg-canvas">
        {mode === 'checking' ? <Spinner /> : null}

        {mode === 'embed' || mode === 'video' ? (
          <>
            {!loaded ? <Spinner /> : null}
            <iframe
              src={mode === 'video' ? video : url}
              title={title || host}
              onLoad={() => setLoaded(true)}
              className="absolute inset-0 h-full w-full border-0 bg-white"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              // Scripts and same-origin so the page works; deliberately no
              // allow-top-navigation, so a page can't "frame-bust" and
              // navigate the whole app away.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            />
          </>
        ) : null}

        {/* The publisher refuses framing: offer it as a popup window instead. */}
        {mode === 'blocked' ? (
          <div className="absolute inset-0 grid place-items-center bg-navy/40 p-5">
            <div className="w-full max-w-sm rounded-card bg-white p-6 text-center shadow-card">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-tint text-brand">
                <ExternalLinkIcon className="h-6 w-6" />
              </span>
              <h2 className="mt-4 font-display text-[19px] font-extrabold leading-snug text-navy">
                This one opens in its own window
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
                {host} doesn&rsquo;t allow its pages to be shown inside other apps. AskNelson stays
                open behind it.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  openOutside('blocked')
                  if (openPopup(url)) onClose()
                }}
                className="mt-6 grid min-h-[48px] w-full place-items-center rounded-btn bg-brand px-6 text-[15px] font-extrabold text-white transition hover:bg-brand-dark active:scale-[0.98]"
              >
                Open {title ? `“${title}”` : host}
              </a>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 min-h-[44px] w-full text-[14px] font-bold text-slate-500"
              >
                Not now
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Mount once in the app shell; renders while location.state.viewer is set. */
export default function InAppBrowser() {
  const location = useLocation()
  const navigate = useNavigate()
  const viewer = location.state?.viewer
  if (!viewer?.url) return null
  return <Viewer key={viewer.url} viewer={viewer} onClose={() => navigate(-1)} />
}
