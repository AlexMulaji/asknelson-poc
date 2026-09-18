import { isEnabled, pool, query } from './db.js'
import { aad, blindIndex, open, openJson } from './crypto.js'
import { audit } from './audit.js'
import { progressSnapshot } from './progress.js'

// A read-only window onto the database, run where the encryption key is —
// inside the app container:
//
//   docker compose exec asknelson node server/peek.js tables
//   docker compose exec asknelson node server/peek.js users [limit]
//   docker compose exec asknelson node server/peek.js user <mobile|email>
//   docker compose exec asknelson node server/peek.js events [limit]
//   docker compose exec asknelson node server/peek.js counts [limit]
//   docker compose exec asknelson node server/peek.js audit [limit]
//   docker compose exec asknelson node server/peek.js idcheck <id number>
//   docker compose exec asknelson node server/peek.js raw <table> [limit]
//
// psql shows the personal columns as bytea, because Postgres never receives
// the key. This decrypts them, so most of what it prints is personal
// information: every run is recorded in audit_log, and it writes nothing else.

const [command = 'tables', ...args] = process.argv.slice(2)
const limit = Math.min(Math.max(Number(args[args.length - 1]) || 10, 1), 500)

if (!isEnabled) {
  console.error('DATABASE_URL is not set — run this inside the app container.')
  process.exit(1)
}

const userField = (row, column) => open(row[`${column}_enc`], aad('auth_users', column, row.id))

// 27821234567 -> 082 123 4567
function localPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : digits
  return local.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')
}

const when = (value) => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : '—')

function table(rows) {
  if (rows.length === 0) return console.log('  (none)')
  const columns = Object.keys(rows[0])
  const widest = (c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  const widths = Object.fromEntries(columns.map((c) => [c, Math.min(widest(c), 48)]))
  const line = (cells) =>
    console.log('  ' + columns.map((c) => String(cells[c] ?? '').slice(0, 48).padEnd(widths[c])).join('  '))
  line(Object.fromEntries(columns.map((c) => [c, c])))
  console.log('  ' + columns.map((c) => '-'.repeat(widths[c])).join('  '))
  rows.forEach(line)
}

async function profile(row) {
  console.log(`\n  account     ${row.id}`)
  console.log(`  mobile      ${localPhone(userField(row, 'phone')) || '— (erased: anonymous account)'}`)
  console.log(`  email       ${userField(row, 'email') ?? '—'}`)
  console.log(
    `  name        ${[userField(row, 'first_name'), userField(row, 'last_name')].filter(Boolean).join(' ') || '—'}`
  )
  console.log(`  employer    ${row.organisation_name ?? '—'}`)
  console.log(`  status      ${row.status}${row.is_anonymous ? ' (anonymous)' : ''}`)
  console.log(`  created     ${when(row.created_at)}    last sign-in ${when(row.last_login_at)}`)
  console.log('  ID number   not stored — only a keyed hash, for duplicate checks')

  const consents = await query(
    'SELECT purpose, notice_version, granted, recorded_at FROM user_consents WHERE user_id = $1 ORDER BY recorded_at',
    [row.id]
  )
  console.log('\n  consents')
  table(
    consents.rows.map((c) => ({
      purpose: c.purpose,
      version: c.notice_version,
      granted: c.granted,
      when: when(c.recorded_at),
    }))
  )

  const snapshot = await progressSnapshot(row.id)
  console.log('\n  progress')
  console.log(`    active journey  ${snapshot.activeJourneyId ?? '—'}`)
  for (const [id, journey] of Object.entries(snapshot.journeys)) {
    console.log(
      `    journey ${id}: ${journey.completedDays.length} day(s) done ${JSON.stringify(journey.completedDays)} (${journey.status})`
    )
  }
  for (const [id, record] of Object.entries(snapshot.assessments)) {
    console.log(
      `    assessment ${id}: last score ${record.lastScore} (${record.lastBand ?? 'no band'}), ${record.history.length} taken`
    )
  }
  console.log(`    last screen     ${snapshot.app.lastRoute ?? '—'}`)
  const recent = snapshot.content.recent.map((c) => c.title).filter(Boolean).slice(0, 5)
  console.log(`    recent content  ${recent.join(' | ') || '—'}`)
}

const commands = {
  async tables() {
    const { rows } = await query(
      'SELECT relname AS "table", n_live_tup AS rows FROM pg_stat_user_tables ORDER BY relname'
    )
    console.log('\nTables in the asknelson database:')
    table(rows)
  },

  async users() {
    const { rows } = await query(
      `SELECT u.*, o.name AS organisation_name
         FROM auth_users u
         LEFT JOIN organisations o ON o.id = u.organisation_id
        ORDER BY u.created_at DESC LIMIT $1`,
      [limit]
    )
    console.log(`\n${rows.length} account(s), decrypted:`)
    table(
      rows.map((r) => ({
        created: when(r.created_at),
        status: r.status,
        mobile: localPhone(userField(r, 'phone')),
        email: userField(r, 'email') ?? '',
        employer: r.organisation_name ?? '',
        linked: r.member_id ? 'yes' : 'no',
      }))
    )
  },

  async user() {
    const identifier = args[0]
    if (!identifier) return console.error('Usage: node server/peek.js user <mobile|email>')
    const digits = identifier.replace(/\D/g, '')
    const phone = digits.length === 10 && digits.startsWith('0') ? `27${digits.slice(1)}` : digits
    const { rows } = await query(
      `SELECT u.*, o.name AS organisation_name
         FROM auth_users u
         LEFT JOIN organisations o ON o.id = u.organisation_id
        WHERE u.phone_hash = $1 OR u.email_hash = $2 OR lower(u.username) = lower($3)
        LIMIT 1`,
      [blindIndex(phone), blindIndex(identifier.trim().toLowerCase()), identifier]
    )
    if (!rows[0]) return console.log(`\nNo account matches ${identifier}.`)
    await profile(rows[0])
  },

  async events() {
    const { rows } = await query(
      `SELECT event_uid, name, category, path_enc, props_enc, occurred_at, member_id
         FROM analytics_events ORDER BY occurred_at DESC LIMIT $1`,
      [limit]
    )
    console.log(`\nLast ${rows.length} event(s), props decrypted:`)
    table(
      rows.map((r) => ({
        when: when(r.occurred_at),
        event: r.name,
        identified: r.member_id ? 'yes' : 'no',
        path: open(r.path_enc, aad('analytics_events', 'path', r.event_uid)) ?? '',
        props: JSON.stringify(openJson(r.props_enc, aad('analytics_events', 'props', r.event_uid)) ?? {}),
      }))
    )
  },

  async counts() {
    const { rows } = await query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, event_name, dims, count FROM analytics_daily_counts
        ORDER BY day DESC, count DESC LIMIT $1`,
      [limit]
    )
    console.log('\nDe-identified daily counts (these need no key):')
    table(
      rows.map((r) => ({
        day: r.day,
        event: r.event_name,
        dims: JSON.stringify(r.dims),
        count: r.count,
      }))
    )
  },

  async audit() {
    const { rows } = await query(
      `SELECT occurred_at, actor_type, actor_id, action, target_type, target_id
         FROM audit_log ORDER BY occurred_at DESC LIMIT $1`,
      [limit]
    )
    console.log(`\nLast ${rows.length} audited action(s):`)
    table(
      rows.map((r) => ({
        when: when(r.occurred_at),
        actor: r.actor_type,
        action: r.action,
        target: [r.target_type, r.target_id].filter(Boolean).join(' '),
      }))
    )
  },

  // ID numbers are never stored, encrypted or otherwise — only a keyed hash,
  // so they can't be listed or decrypted. What you can do is ask whether a
  // particular ID number is already registered, which is all the sign-up flow
  // itself ever asks.
  async idcheck() {
    const idNumber = String(args[0] || '').replace(/\D/g, '')
    if (idNumber.length !== 13) return console.error('Usage: node server/peek.js idcheck <13-digit ID number>')
    const hash = blindIndex(idNumber)
    const { rows } = await query(
      `SELECT u.*, o.name AS organisation_name
         FROM auth_users u
         LEFT JOIN organisations o ON o.id = u.organisation_id
        WHERE u.id_number_hash = $1`,
      [hash]
    )
    console.log(`
  ID number   ${idNumber}`)
    console.log(`  stored as   ${hash}`)
    console.log(`  (that hash is all the database holds — the number itself is not recoverable)`)
    if (rows.length === 0) return console.log('\n  No account is registered with this ID number.')
    for (const row of rows) await profile(row)
  },

  // Exactly what psql would show — handy for confirming the columns really do
  // hold ciphertext.
  async raw() {
    const name = args[0]
    if (!/^[a-z_]+$/.test(name || '')) return console.error('Usage: node server/peek.js raw <table> [limit]')
    const { rows } = await query(`SELECT * FROM ${name} LIMIT $1`, [limit])
    console.log(`\n${name}, exactly as stored:`)
    console.log(rows)
  },
}

const run = commands[command]
if (!run) {
  console.error(`Unknown command "${command}". Try: ${Object.keys(commands).join(', ')}`)
  process.exit(1)
}

// Reading decrypted personal data is itself worth recording.
audit(null, { actor: 'admin', action: 'admin_cli_read', targetType: 'command', targetId: command })
await run()
await pool.end()
