// Routes an assessment CTA to the right place in the app, based on cta.type.
//   journey   -> open that journey by id (preserving any existing progress)
//   explore   -> open that Explore theme by id (deep-linked via ?theme=)
//   asknelson -> open the AskNelson support/booking tab
//
// `navigate` is react-router's useNavigate(); `switchJourney` comes from
// useJourneyProgress() so a journey CTA reuses the exact same start/switch path
// as the Journeys tab (and never wipes saved progress).
export function runCta(cta, { navigate, switchJourney }) {
  if (!cta) {
    navigate('/asknelson')
    return
  }
  switch (cta.type) {
    case 'journey':
      if (cta.target && typeof switchJourney === 'function') switchJourney(cta.target)
      navigate('/journeys')
      break
    case 'explore':
      navigate(cta.target ? `/explore?theme=${encodeURIComponent(cta.target)}` : '/explore')
      break
    case 'asknelson':
    default:
      navigate('/asknelson')
      break
  }
}
