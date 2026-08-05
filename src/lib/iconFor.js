import {
  BookIcon,
  ChatIcon,
  ClipboardCheckIcon,
  CoinIcon,
  CompassIcon,
  FlameIcon,
  GridIcon,
  HeadphonesIcon,
  IdCardIcon,
  LeafIcon,
  MoonIcon,
  SadFaceIcon,
  ScaleIcon,
  UserPulseIcon,
  UsersIcon,
  WellnessIcon,
} from '../components/Icons.jsx'

// The content JSON names icons with Tabler slugs (`ti-flame`). Map them onto
// the inline set so no icon font/library ships with the app. Unknown slugs fall
// back to the lotus mark rather than rendering nothing.
const ICONS = {
  'ti-heart-rate-monitor': UserPulseIcon,
  'ti-users': UsersIcon,
  'ti-flame': FlameIcon,
  'ti-leaf': LeafIcon,
  'ti-moon': MoonIcon,
  'ti-cloud': SadFaceIcon,
  'ti-heart-handshake': UsersIcon,
  'ti-coin': CoinIcon,
  'ti-briefcase': IdCardIcon,
  'ti-user': IdCardIcon,
  'ti-run': WellnessIcon,
  'ti-book': BookIcon,
  'ti-compass': CompassIcon,
  'ti-scale': ScaleIcon,
  'ti-headphones': HeadphonesIcon,
  'ti-clipboard': ClipboardCheckIcon,
  'ti-message': ChatIcon,
  'ti-grid': GridIcon,
  'ti-map': CompassIcon,
}

export function iconFor(slug) {
  return ICONS[slug] ?? WellnessIcon
}
