import { generateUsername } from '../username.js'

// 006 — give every account a display handle.
//
// Identified accounts had no username: the app fell back to showing the mobile
// number the member signed up with, so a personal identifier sat on the home
// screen where anyone glancing at the phone could read it. Every account now
// carries a generated handle ("CalmRiver4821") and that is what the app shows.
//
// Existing accounts are backfilled here rather than lazily at sign-in, so the
// column can be made NOT NULL and nothing downstream has to cope with a member
// who has no handle yet.

export default {
  name: '006_member_usernames',

  sql: `
    -- Usernames have always been compared case-insensitively in code; make the
    -- database agree, so two accounts cannot differ only in capitalisation.
    --
    -- The constraint goes first and the index second, and the order matters:
    -- 002 declared "username text UNIQUE", so auth_users_username_key is a
    -- constraint whose backing index shares its name. DROP INDEX on that name
    -- refuses (2BP01, "you can drop constraint ... instead") and takes the
    -- whole migration down with it. Dropping the constraint removes its index
    -- too; the DROP INDEX after it is for a database where the name somehow
    -- exists as a plain index instead.
    ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_username_key;
    DROP INDEX IF EXISTS auth_users_username_key;
    CREATE UNIQUE INDEX auth_users_username_lower_idx ON auth_users (lower(username));
  `,

  async run(client) {
    const { rows } = await client.query(
      "SELECT id FROM auth_users WHERE username IS NULL OR btrim(username) = ''"
    )

    // Collisions are rare (about 20 million combinations) but a backfill of a
    // large table will hit some, so each row retries against the set already
    // allocated plus whatever is in the table.
    const taken = new Set()
    const existing = await client.query(
      'SELECT lower(username) AS name FROM auth_users WHERE username IS NOT NULL'
    )
    for (const row of existing.rows) taken.add(row.name)

    for (const row of rows) {
      let username = null
      for (let attempt = 0; attempt < 12 && !username; attempt++) {
        const candidate = generateUsername()
        if (!taken.has(candidate.toLowerCase())) username = candidate
      }
      if (!username) throw new Error(`Could not allocate a username for ${row.id}`)
      taken.add(username.toLowerCase())
      await client.query('UPDATE auth_users SET username = $2 WHERE id = $1', [row.id, username])
    }

    // Inside the transaction and after the backfill: the constraint and the
    // rows that satisfy it land together, or neither does.
    await client.query('ALTER TABLE auth_users ALTER COLUMN username SET NOT NULL')

    if (rows.length) console.log(`[asknelson] backfilled ${rows.length} member username(s)`)
  },
}
