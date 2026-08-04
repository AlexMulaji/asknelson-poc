import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import ContentCard from '../components/ContentCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useContent } from '../hooks/useContent.js'
import { track } from '../lib/analytics.js'

function buildItems(themeList) {
  const items = []
  for (const theme of themeList) {
    for (const c of theme.content ?? []) {
      const isVideo = (c.type || '').toLowerCase() === 'video'
      const mins = isVideo ? c.duration_mins : c.read_time_mins
      const duration = mins != null ? `${mins} min${isVideo ? '' : ' read'}` : undefined
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

  // Keep the filter in sync if the ?theme= param changes while already mounted.
  useEffect(() => {
    if (themeParam && themeIds.has(themeParam)) setActiveTheme(themeParam)
  }, [themeParam, themeIds])

  const allItems = useMemo(() => buildItems(themes), [themes])

  const chips = useMemo(
    () => [{ id: 'all', title: 'All' }, ...themes.map((t) => ({ id: t.id, title: t.title }))],
    [themes]
  )

  const filtered = useMemo(
    () => (activeTheme === 'all' ? allItems : allItems.filter((i) => i.themeId === activeTheme)),
    [activeTheme, allItems]
  )

  const hasData = allItems.length > 0
  const activeTitle = chips.find((c) => c.id === activeTheme)?.title ?? ''

  return (
    <div className="page-enter">
      <PageHeader title="Explore" subtitle="Browse by what you need today" />

      {/* Chip filter row — always rendered (prevents layout jump) */}
      {hasData ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 py-3 lg:flex-wrap lg:overflow-visible">
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
                // 36px height for chips (slightly smaller than full buttons — acceptable
                // for a scrollable row where miss-taps can be corrected easily).
                className={[
                  'h-9 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors duration-150',
                  isActive
                    ? 'border-brand bg-brand text-white'
                    : 'border-gray-200 bg-white text-gray-600 active:bg-gray-50',
                ].join(' ')}
              >
                {chip.title}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Content list */}
      <div className="px-5 pb-4">
        {!hasData ? (
          <EmptyState
            title="Your content is on its way"
            message="Content loads from explore.json. Once it's added, you'll find articles and videos here, sorted by what you need today."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing here just yet"
            message={`We don't have anything under "${activeTitle}" right now. Try another topic — there's plenty to explore.`}
          />
        ) : (
          <motion.div
            // key on the active theme so the stagger replays when filtering.
            key={activeTheme}
            variants={listContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3"
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
