// Routes an assessment CTA to the right place in the app, based on cta.type.
//   journey   -> open that journey by id (preserving any existing progress)
//   explore   -> open that Explore theme by id (deep-linked via ?theme=)
//   asknelson -> raise the Get Help dialog (the AskNelson page it used to open
//                has been replaced by the dialog; the type name is kept because
//                it is stored in content JSON and set from the admin portal)
//
// `navigate` is react-router's useNavigate(); `switchJourney` comes from
// useJourneyProgress() so a journey CTA reuses the exact same start/switch path
// as the Journeys tab (and never wipes saved progress); `openHelp` comes from
// useGetHelp(); `source` labels where the dialog was raised from, for reporting.
export function runCta(cta, { navigate, switchJourney, openHelp, source = 'result' }) {
  switch (cta?.type) {
    case 'journey':
      if (cta.target && typeof switchJourney === 'function') switchJourney(cta.target)
      navigate('/my-wellness')
      break
    case 'explore':
      navigate(cta.target ? `/explore?theme=${encodeURIComponent(cta.target)}` : '/explore')
      break
    case 'asknelson':
    default:
      // No CTA, or one we don't recognise: urgent help is the safe default.
      openHelp?.(source)
      break
  }
}
