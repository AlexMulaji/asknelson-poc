import {
  AlertIcon,
  AnxietyIcon,
  BookIcon,
  CalendarIcon,
  CallIcon,
  ChatIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CoinIcon,
  EyeIcon,
  ExternalLinkIcon,
  FlameIcon,
  GridIcon,
  HeartIcon,
  HomeIcon,
  InfoIcon,
  LockIcon,
  MoonIcon,
  PlayIcon,
  SadFaceIcon,
  ScaleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  VideoIcon,
  VolumeMaxIcon,
  WellnessIcon,
} from '../components/Icons.jsx'

// The content JSON names icons with Tabler slugs (`ti-flame`). Map them onto the
// AskNelson brand set so no icon font/library ships with the app. The brand set
// has no exact twin for every Tabler slug, so a few are matched by meaning — the
// grid/journey/assessment lists each stay visually distinct. Unknown slugs fall
// back to the wellness mark rather than rendering nothing.
const ICONS = {
  // Topics as they appear in the shipped content.
  'ti-heart-rate-monitor': AnxietyIcon, // Anxiety & Stress
  'ti-cloud': SadFaceIcon, // Low mood
  'ti-flame': FlameIcon, // Burnout
  'ti-moon': MoonIcon, // Sleep
  'ti-users': ChatIcon, // Relationships / connection
  'ti-heart-handshake': ChatIcon,
  'ti-leaf': WellnessIcon, // Mindfulness
  'ti-coin': CoinIcon, // Money
  'ti-briefcase': BookIcon, // Work & career
  'ti-user': EyeIcon, // Self-awareness
  'ti-run': HeartIcon, // Body & movement

  // Additional slugs the brand set covers, for future content.
  'ti-book': BookIcon,
  'ti-compass': GridIcon,
  'ti-grid': GridIcon,
  'ti-map': GridIcon,
  'ti-scale': ScaleIcon,
  'ti-headphones': VolumeMaxIcon,
  'ti-volume': VolumeMaxIcon,
  'ti-clipboard': ClipboardCheckIcon,
  'ti-message': ChatIcon,
  'ti-heart': HeartIcon,
  'ti-eye': EyeIcon,
  'ti-phone': CallIcon,
  'ti-lock': LockIcon,
  'ti-shield': ShieldIcon,
  'ti-calendar': CalendarIcon,
  'ti-clock': ClockIcon,
  'ti-video': VideoIcon,
  'ti-link': ExternalLinkIcon,
  'ti-info': InfoIcon,
  'ti-alert-triangle': AlertIcon,
  'ti-settings': SettingsIcon,
  'ti-search': SearchIcon,
  'ti-home': HomeIcon,
  'ti-play': PlayIcon,
  'ti-check': CheckCircleIcon,
}

export function iconFor(slug) {
  return ICONS[slug] ?? WellnessIcon
}
