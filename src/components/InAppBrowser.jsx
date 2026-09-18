import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CloseIcon, ExternalLinkIcon } from './Icons.jsx'
import { track } from '../lib/analytics.js'
import { pushContentOpened } from '../lib/progressSync.js'
import {
  checkEmbeddable,
  fetchReaderArticle,
  hostOf,
  isExternalUrl,
  knownToOpenOutside,
  videoEmbedUrl,
} from '../lib/externalLinks.js'
import { sanitiseReaderHtml } from '../lib/readerHtml.js'

// In-app viewer for external articles, videos and the booking form.
//
// Four ways a link can open, in order of preference:
//   1. video    - YouTube/TED/Vimeo play in the provider's embed player.
//   2. embedded - the publisher allows framing, so the page opens inside the
//                 app. Back (button or gesture) closes it and the screen
//                 underneath stays exactly where it was.
//   3. reader   - the publisher refuses framing (about half of them do), so
//                 the server extracts the article and it is shown in the
//                 app's own reader view, with a link to the original.
//   4. new tab  - no readable article either (a bot wall, a paywall, a page
//                 that isn't an article): the page opens straight in a new
//                 browser tab, with AskNelson still open behind it.
//
// Framing is the publisher's choice, declared in their headers and checked
// server-side. Cards warm that check (and the reader article) on hover or
// first touch, so most taps already know the answer: a link that has to leave
// the app opens its tab inside the tap itself. When the answer arrives after
// the tap, the tab is still tried - browsers allow it for a few seconds after a
// tap - and if the browser blocks it the current tab is handed over instead
// (see onHandOff). There is deliberately no confirmation step: by then the
// member has already tapped the thing they asked for, and a popup blocker
// firing is not a decision to hand back to them.

// No window features: any size or `popup` feature makes browsers open a
// separate window rather than a tab. `noopener` is also left out of the
// features, because with it window.open always returns null and a successful
// open looks identical to a blocked one - the opener is cut by hand instead.
function openInNewTab(url) {
  try {
    const tab = window.open(url, '_blank')
    if (tab) tab.opener = null
    return tab
  } catch {
    return null
  }
}

/** True for an ordinary click — not a new-tab/window gesture the browser should handle. */
export const isPlainClick = (e) =>
  !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

/**
 * Returns open(url, meta) — shows the URL in the in-app viewer, which picks
 * the best of video, frame, reader view or a new tab. meta: { title, contentId,
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

      // Already known to need a new tab: open it now, inside the tap.
      if (!videoEmbedUrl(url) && knownToOpenOutside(url) && openInNewTab(url)) {
        track('external_opened_outside', { host: hostOf(url), from: 'auto' })
        remember()
        return true
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

// The app's own rendering of an article the publisher won't let us frame.
function ReaderArticle({ article, fallbackTitle, host, onOpenOriginal }) {
  const html = useMemo(() => sanitiseReaderHtml(article.content), [article.content])
  const bodyRef = useRef(null)
  const heading = article.title || fallbackTitle || host
  const source = article.siteName || host

  // An image that fails (hotlink protection, a dead CDN) should just vanish
  // rather than leave a broken-image box in the middle of the text.
  useEffect(() => {
    const images = bodyRef.current?.querySelectorAll('img') ?? []
    const hide = (e) => {
      e.currentTarget.style.display = 'none'
    }
    images.forEach((img) => img.addEventListener('error', hide))
    return () => images.forEach((img) => img.removeEventListener('error', hide))
  }, [html])

  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface">
      <article
        lang={article.lang || undefined}
        dir={article.dir}
        className="mx-auto max-w-[680px] px-5 pb-[calc(3rem+env(safe-area-inset-bottom,0px))] pt-6"
      >
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">
          {source} · {article.minutes} min read
        </p>
        <h1 className="mt-2 font-display text-[26px] font-extrabold leading-tight text-ink">
          {heading}
        </h1>
        {article.byline ? (
          <p className="mt-2 text-[14px] font-semibold text-slate-500">{article.byline}</p>
        ) : null}

        <div
          ref={bodyRef}
          className="reader-content mt-6"
          // Sanitised twice: allowlisted on the server, then DOMPurify here.
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <div className="mt-10 rounded-card border border-line bg-canvas p-4 text-[13px] leading-relaxed text-slate-500">
          This is a simplified reader view of an article by {source}. Some images, videos or
          formatting from the original may be missing.
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenOriginal}
            className="mt-2 flex items-center gap-1.5 font-bold text-brand-dark"
          >
            Read the original on {host}
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        </div>
      </article>
    </div>
  )
}

function Viewer({ viewer, onClose, onHandOff }) {
  const { url, title } = viewer
  const host = hostOf(url)
  const video = videoEmbedUrl(url)
  // video | checking | embed | reading (fetching the article) | reader
  const [mode, setMode] = useState(video ? 'video' : 'checking')
  const [article, setArticle] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const onHandOffRef = useRef(onHandOff)
  const modeRef = useRef(mode)
  onCloseRef.current = onClose
  onHandOffRef.current = onHandOff
  modeRef.current = mode

  useEffect(() => {
    if (video) return
    let alive = true
    checkEmbeddable(url).then(async (verdict) => {
      if (!alive) return
      if (verdict.embeddable) {
        setMode('embed')
        return
      }
      setMode('reading')
      const result = await fetchReaderArticle(url)
      if (!alive) return
      if (result.readable) {
        setArticle(result)
        setMode('reader')
        return
      }
      // Nothing to show in the app: go straight to a new tab and close the
      // viewer, so AskNelson is still sitting behind the article.
      if (openInNewTab(url)) {
        modeRef.current = 'new_tab'
        track('external_opened_outside', { host, from: 'auto', reason: result.reason ?? null })
        onCloseRef.current()
        return
      }
      // The browser refused the tab, because the open lands after the checks
      // above rather than inside the tap that started them. Hand the current
      // tab over instead: no popup blocker is involved, so it always lands,
      // and Back brings the member home.
      modeRef.current = 'handed_off'
      track('external_opened_outside', { host, from: 'handoff', reason: result.reason ?? null })
      onHandOffRef.current(url)
    })
    return () => {
      alive = false
    }
  }, [url, video])

  // How content is actually consumed: which way it opened, and for how long.
  // A cross-origin frame hides everything inside it, so dwell time is the
  // most the app can know.
  useEffect(() => {
    if (mode === 'checking' || mode === 'reading') return
    track('external_opened', {
      host,
      mode,
      content_id: viewer.contentId ?? null,
      type: viewer.type ?? null,
    })
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
      className="fixed inset-0 z-[60] flex flex-col bg-surface"
    >
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))]">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition hover:bg-canvas"
        >
          <CloseIcon className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[15px] font-extrabold leading-tight text-ink">{title || host}</p>
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
        {mode === 'checking' || mode === 'reading' ? <Spinner /> : null}

        {mode === 'reader' && article ? (
          <ReaderArticle
            article={article}
            fallbackTitle={title}
            host={host}
            onOpenOriginal={() => openOutside('reader')}
          />
        ) : null}

        {mode === 'embed' || mode === 'video' ? (
          <>
            {!loaded ? <Spinner /> : null}
            <iframe
              src={mode === 'video' ? video : url}
              title={title || host}
              onLoad={() => setLoaded(true)}
              className="absolute inset-0 h-full w-full border-0 bg-surface"
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

  /**
   * Give the whole tab to a page that can be shown neither in a frame nor in
   * reader view, when the browser has refused a new tab for it.
   *
   * The viewer is dropped from this history entry first. Without that, Back
   * from the article restores `state.viewer`, the checks run again on a cold
   * cache, reach the same verdict and throw the member straight back out --
   * the app would be impossible to return to.
   */
  const handOff = (target) => {
    const { viewer: _viewer, ...rest } = location.state ?? {}
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: rest,
    })
    window.location.assign(target)
  }

  return (
    <Viewer
      key={viewer.url}
      viewer={viewer}
      onClose={() => navigate(-1)}
      onHandOff={handOff}
    />
  )
}
