import { GridIcon, MapIcon, LeafIcon, ClipboardCheckIcon, NelsonMarkIcon } from './Icons.jsx'

// Single source of truth for the primary navigation. Used by BottomNav (mobile)
// and Sidebar (desktop) so the two stay in sync.
export const navTabs = [
  { to: '/explore', label: 'Explore', Icon: GridIcon },
  { to: '/journeys', label: 'Journeys', Icon: MapIcon },
  { to: '/assessments', label: 'Assessments', Icon: ClipboardCheckIcon },
  { to: '/meditate', label: 'Meditate', Icon: LeafIcon },
  { to: '/asknelson', label: 'AskNelson', Icon: NelsonMarkIcon },
]
