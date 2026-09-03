import {
  GridIcon,
  HomeIcon,
  WellnessIcon,
  ClipboardCheckIcon,
  NelsonMarkIcon,
} from './Icons.jsx'

// Single source of truth for the primary navigation. Used by BottomNav (mobile)
// and Sidebar (desktop) so the two stay in sync.
//
// "My Wellness" holds both the journey programmes and meditation, which the V1
// design merges behind one tab with a segmented control.
export const navTabs = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/my-wellness', label: 'My Wellness', Icon: WellnessIcon },
  { to: '/assessments', label: 'Assessments', Icon: ClipboardCheckIcon },
  { to: '/explore', label: 'Explore', Icon: GridIcon },
  { to: '/asknelson', label: 'AskNelson', Icon: NelsonMarkIcon },
]
