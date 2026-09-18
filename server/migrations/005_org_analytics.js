// 005 — the employer as a first-class analytics dimension.
//
// Reporting is bought per company: "how is our EAP being used?" is the
// question, and until now it could only be answered by joining events to
// members to accounts to organisations, one decryption at a time.
//
// So organisation_id is denormalised onto members, sessions and events at
// ingest. A company name is not personal information (which is why
// organisations was a plain table in 003), so these columns are clear text and
// can be grouped and indexed directly — no key needed to produce a per-company
// report, and no member row opened to build one.

export default {
  name: '005_org_analytics',
  sql: `
    ALTER TABLE analytics_members
      ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
    ALTER TABLE analytics_devices
      ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
    ALTER TABLE analytics_sessions
      ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
    ALTER TABLE analytics_events
      ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;

    -- Backfill from the accounts that produced the activity. Anonymous
    -- accounts have no member link by design, so their events stay
    -- unattributed — that is the anonymity guarantee working, not a gap.
    UPDATE analytics_members m
       SET organisation_id = u.organisation_id
      FROM auth_users u
     WHERE u.member_id = m.id AND u.organisation_id IS NOT NULL;

    UPDATE analytics_devices d
       SET organisation_id = m.organisation_id
      FROM analytics_members m
     WHERE d.member_id = m.id AND m.organisation_id IS NOT NULL;

    UPDATE analytics_sessions s
       SET organisation_id = m.organisation_id
      FROM analytics_members m
     WHERE s.member_id = m.id AND m.organisation_id IS NOT NULL;

    UPDATE analytics_events e
       SET organisation_id = m.organisation_id
      FROM analytics_members m
     WHERE e.member_id = m.id AND m.organisation_id IS NOT NULL;

    -- The two shapes every per-company report takes: one company's activity
    -- over a window, and one company's activity broken down by event.
    CREATE INDEX analytics_events_org_idx
      ON analytics_events (organisation_id, occurred_at DESC);
    CREATE INDEX analytics_events_org_name_idx
      ON analytics_events (organisation_id, name, occurred_at DESC);
    CREATE INDEX analytics_sessions_org_idx
      ON analytics_sessions (organisation_id, started_at DESC);
    CREATE INDEX analytics_devices_org_idx ON analytics_devices (organisation_id);
    CREATE INDEX analytics_members_org_idx ON analytics_members (organisation_id);
  `,
}
