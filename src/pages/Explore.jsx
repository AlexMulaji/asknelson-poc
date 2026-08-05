import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import ContentCard from '../components/ContentCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SearchIcon } from '../components/Icons.jsx'
import { useContent } from '../hooks/useContent.js'

function buildItems(themeList) {
  const items = []
  for (const theme of themeList) {
    for (const c of theme.content ?? []) {
      const isVideo = (c.type || '').toLowerCase() === 'video'
      const mins = isVideo ? c.duration_mins : c.read_time_mins
      const duration = mins != null ? `${mins} min${isVideo ? ' watch' : ' read'}` : undefined
      items.push({
        ...c,
        themeId: theme.id,
        theme: theme.title,
        themeColor: theme.color,
        duration,
      })
    }
  }
  return items
}

export default function Explore() {
  const exploreData = useContent('explore')
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
        className="h-11 w-full rounded-btn border border-line bg-white pl-4 pr-10 text-[14px] text-navy
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
              className="grid h-10 w-10 place-items-center rounded-full text-navy transition hover:bg-canvas lg:hidden"
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
                onClick={() => setActiveTheme(chip.id)}
                className={[
                  'h-10 shrink-0 whitespace-nowrap rounded-pill border px-4 text-[13px] font-bold transition-colors duration-150',
                  isActive
                    ? 'border-navy bg-navy text-white'
                    : 'border-line bg-white text-slate-500 hover:border-slate-300',
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
        {!hasData ? (
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
