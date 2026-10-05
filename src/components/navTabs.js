import {
  GridIcon,
  HomeIcon,
  WellnessIcon,
  ClipboardCheckIcon,
} from './Icons.jsx'

// Single source of truth for the primary navigation. Used by BottomNav (mobile)
// and Sidebar (desktop) so the two stay in sync.
//
// "My Wellness" holds both the journey programmes and meditation, which the V1
// design merges behind one tab with a segmented control.
//
// Get Help is deliberately not in this list: it opens a dialog rather than a
// page (see GetHelp.jsx), so each nav renders it as its own red button.
export const navTabs = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/my-wellness', label: 'My Wellness', Icon: WellnessIcon },
  { to: '/assessments', label: 'Assessments', Icon: ClipboardCheckIcon },
  { to: '/explore', label: 'Explore', Icon: GridIcon },
]
