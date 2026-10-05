// 007 — remember who has been shown their anonymous username.
//
// Since 006 every account carries a generated handle ("CalmRiver4821"), but
// nothing ever told the member that this is the name the app knows them by, or
// why it isn't their own. The app now shows a one-time screen explaining it,
// and this column records that the member has seen it.
//
// Deliberately nullable with no default and no backfill: every existing
// account starts at NULL, so members who were given a handle by 006 see the
// explanation once on their next sign-in, the same as a new registration.
// Adding a nullable column without a default is a catalogue-only change in
// Postgres -- no table rewrite -- so this is instant on a live database.

export default {
  name: '007_username_acknowledged',

  sql: `
    ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS username_acknowledged_at timestamptz;
  `,
}
