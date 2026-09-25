import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import ContentCard from '../components/ContentCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SearchIcon } from '../components/Icons.jsx'
import { useContentState } from '../hooks/useContent.js'
import { track } from '../lib/analytics.js'

function buildItems(themeList) {
  const items = []

  const maxContent = Math.max(0, ...themeList.map(theme => theme.content?.length ?? 0));
  for (let i = 0; i < maxContent; i++){
    for (const theme of themeList) {
      const c = theme.content?.[i] ?? 0
      if (!c) { continue }

      const isVideo = (c.type || '').toLowerCase() === 'video'
      const mins = isVideo ? c.duration_mins : c.read_time_mins
      const duration = mins != null ? `${mins} min${isVideo ? ' watch' : ' read'}` : undefined
      items.push({
        ...c,
        themeId: theme.id,
        theme: theme.title,
        themeColor: theme.color,
        // Per-topic pill colours, set in /admin. Themes saved before those
        // fields existed fall back to their own background/accent pair.
        themePillBg: theme.pill_bg || theme.bg,
        themePillFg: theme.pill_fg || theme.color,
        duration,
      })
    }
  }
  
  return items
}

// Stand-in cards shown while the first server fetch is in flight, shaped like
// ContentCard (portrait thumbnail left, copy right) so nothing jumps when the
// real cards land.
function ContentCardSkeleton() {
  return (
    <div aria-hidden className="flex overflow-hidden rounded-card bg-surface shadow-card motion-safe:animate-pulse">
      <div className="media-bg aspect-[3/4] w-[104px] shrink-0 sm:w-[116px]" />
      <div className="flex flex-1 flex-col gap-2 px-4 py-4">
        <div className="media-bg h-5 w-20 rounded-pill" />
        <div className="media-bg h-4 w-4/5 rounded" />
        <div className="media-bg h-3 w-full rounded" />
        <div className="media-bg h-3 w-2/3 rounded" />
      </div>
    </div>
  )
}

export default function Explore() {
  // Server-first: on a first visit this waits for the server copy rather than
  // painting the bundled one, whose images would then be swapped in place.
  const { data: exploreData, loading } = useContentState('explore')
  const themes = useMemo(() => exploreData?.explore?.themes ?? [], [exploreData])
  const themeIds = useMemo(() => new Set(themes.map((t) => t.id)), [themes])

  const [searchParams] = useSearchParams()
  // Deep link from an assessment CTA: /explore?theme=<id> opens that theme.
  const themeParam = searchParams.get('theme')
  const [activeTheme, setActiveTheme] = useState(() =>
    themeParam && themeIds.has(themeParam) ? themeParam : 'all'
  )
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  // Keep the filter in sync if the ?theme= param changes while already mounted.
  useEffect(() => {
    if (themeParam && themeIds.has(themeParam)) setActiveTheme(themeParam)
  }, [themeParam, themeIds])

  const allItems = useMemo(() => buildItems(themes), [themes])

  const chips = useMemo(
    () => [{ id: 'all', title: 'All' }, ...themes.map((t) => ({ id: t.id, title: t.title }))],
    [themes]
  )

  const filtered = useMemo(() => {
    const byTheme =
      activeTheme === 'all' ? allItems : allItems.filter((i) => i.themeId === activeTheme)
    const q = query.trim().toLowerCase()
    if (!q) return byTheme
    return byTheme.filter((i) =>
      [i.title, i.description, i.source, i.theme]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    )
  }, [activeTheme, allItems, query])

  const hasData = allItems.length > 0
  const activeTitle = chips.find((c) => c.id === activeTheme)?.title ?? ''

  const searchField = (
    <label className="relative block">
      <span className="sr-only">Search resources</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        className="h-11 w-full rounded-btn border border-line bg-surface pl-4 pr-10 text-[14px] text-ink
                   placeholder:text-slate-400 focus:border-brand focus:outline-none lg:w-64"
      />
      <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
    </label>
  )

  return (
    <div className="page-enter px-5 pb-6 lg:px-0">
      <PageHeader
        title="Explore"
        className="px-0"
        action={
          <>
            {/* Desktop keeps the field visible; mobile reveals it from the icon. */}
            <div className="hidden lg:block">{searchField}</div>
            <button
              type="button"
              onClick={() => setSearchOpen((o) => !o)}
              aria-label="Search resources"
              aria-expanded={searchOpen}
              className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-canvas lg:hidden"
            >
              <SearchIcon className="h-6 w-6" />
            </button>
          </>
        }
      />

      {searchOpen ? <div className="mt-4 lg:hidden">{searchField}</div> : null}

      {/* Chip filter row — always rendered (prevents layout jump) */}
      {hasData ? (
        <div className="no-scrollbar -mx-5 mt-5 flex gap-2.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {chips.map((chip) => {
            const isActive = chip.id === activeTheme
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  setActiveTheme(chip.id)
                  track('theme_filtered', { theme: chip.id, label: chip.title })
                }}
                className={[
                  'h-10 shrink-0 whitespace-nowrap rounded-pill border px-4 text-[13px] font-bold transition-colors duration-150',
                  isActive
                    ? 'border-ink bg-navy text-white'
                    : 'border-line bg-surface text-slate-500 hover:border-slate-300',
                ].join(' ')}
              >
                {chip.title}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Content list */}
      <div className="mt-5">
        {loading ? (
          <div role="status" aria-label="Loading resources" className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            {Array.from({ length: 4 }, (_, i) => (
              <ContentCardSkeleton key={i} />
            ))}
          </div>
        ) : !hasData ? (
          <EmptyState
            title="Your content is on its way"
            message="Content loads from explore.json. Once it's added, you'll find articles and videos here, sorted by what you need today."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing here just yet"
            message={
              query.trim()
                ? `No resources match "${query.trim()}". Try a different search or topic.`
                : `We don't have anything under "${activeTitle}" right now. Try another topic — there's plenty to explore.`
            }
          />
        ) : (
          <motion.div
            // key on the filter so the stagger replays when it changes.
            key={`${activeTheme}-${query}`}
            variants={listContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5"
          >
            {filtered.map((item) => (
              <motion.div key={item.id ?? item.url ?? item.title} variants={listItem}>
                <ContentCard item={item} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}
