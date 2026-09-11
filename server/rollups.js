// De-identified daily counts (analytics_daily_counts).
//
// Raw events carry pseudonymous device/member ids and expire under the
// retention policy. These counts carry neither, so they fall outside POPIA's
// definition of personal information and are kept: long-run reporting ("which
// articles are opened most", "how many people finished the grief journey")
// survives deletion of the raw stream.
//
// Every accepted event adds to its day's total (dims = {}); events listed here
// also add to a row keyed by the chosen props. Only low-cardinality,
// non-identifying props belong here — never scores, free text or ids.
export const ROLLUP_DIMENSIONS = {
  content_opened: ['title', 'theme', 'type'],
  external_opened: ['host', 'mode'],
  theme_filtered: ['theme'],
  journey_started: ['journey'],
  journey_day_completed: ['journey'],
  journey_completed: ['journey'],
  journey_resource_opened: ['journey'],
  assessment_started: ['assessment'],
  assessment_completed: ['assessment', 'band'],
  meditation_completed: ['duration_min', 'sound'],
  booking_clicked: ['service'],
}

/** The dims object for one event, or null when it has no configured dims. */
export function rollupDims(name, props) {
  const keys = ROLLUP_DIMENSIONS[name]
  if (!keys) return null
  const dims = {}
  for (const key of keys) {
    const value = props?.[key]
    if (value != null && value !== '') dims[key] = String(value).slice(0, 120)
  }
  return Object.keys(dims).length ? dims : null
}
