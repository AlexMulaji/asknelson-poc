import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import SegmentedTabs from '../components/SegmentedTabs.jsx'
import OverflowMenu from '../components/OverflowMenu.jsx'
import { RestartIcon, SwapIcon } from '../components/Icons.jsx'
import Journeys from './Journeys.jsx'
import Meditate from './Meditate.jsx'

const TABS = [
  { id: 'journey', label: 'Your Journey' },
  { id: 'meditation', label: 'Meditation' },
]

// V1 merges the old Journeys and Meditate tabs behind one "My Wellness" screen.
// The active tab lives in the URL (?tab=meditation) so it can be linked to —
// notably from Home and from the /meditate redirect.
export default function MyWellness() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const active = TABS.some((t) => t.id === requested) ? requested : 'journey'

  // Journeys reports whether a programme is running, so the ⋮ menu can offer
  // "Change / Restart journey" only when those actions mean something.
  const [journeyMenu, setJourneyMenu] = useState(null)
  const handleMenuChange = useCallback((next) => setJourneyMenu(next), [])

  const setTab = (id) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'journey') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  const showMenu = active === 'journey' && journeyMenu
  const menuItems = showMenu
    ? [
        { label: 'Change Journey', Icon: SwapIcon, onSelect: journeyMenu.onChange },
        { label: 'Restart Journey', Icon: RestartIcon, onSelect: journeyMenu.onRestart },
      ]
    : []

  return (
    <div className="page-enter px-5 lg:px-0">
      <PageHeader
        title="My Wellness"
        className="px-0 lg:px-0"
        action={showMenu ? <OverflowMenu items={menuItems} label="Journey options" /> : null}
      />

      <div className="mt-5">
        <SegmentedTabs tabs={TABS} value={active} onChange={setTab} />
      </div>

      {active === 'journey' ? (
        <Journeys onMenuChange={handleMenuChange} />
      ) : (
        <Meditate />
      )}
    </div>
  )
}
