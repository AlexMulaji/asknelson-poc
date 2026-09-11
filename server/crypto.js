import crypto from 'node:crypto'

// Application-level encryption for personal information at rest (POPIA s19).
//
// Postgres never sees the plaintext of an encrypted column, nor the key: values
// are sealed here with AES-256-GCM before the INSERT and opened after the
// SELECT. A stolen dump, backup, replica or disk therefore holds ciphertext
// only, and `log_statement = all` on the database cannot leak a key the way
// pgcrypto's pgp_sym_encrypt(value, key) would.
//
// Sealed layout (bytea):
//   [1 byte format = 1][1 byte key id][12 byte IV][16 byte GCM tag][ciphertext]
//
// Every value is bound to where it lives through GCM's additional
// authenticated data — e.g. "auth_users.phone:<user id>". A ciphertext copied
// into another row or column fails to open instead of quietly showing the
// wrong person's data.
//
// Keys come from DATA_ENCRYPTION_KEYS as "<id>:<base64 32 bytes>" entries,
// comma separated, newest FIRST. The first key seals new values; every listed
// key can still open old ones, so rotation is: prepend a new key, redeploy,
// re-encrypt at leisure, then drop the old key. Generate one with
// `npm run keys:generate`.

const FORMAT = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 2 + IV_BYTES + TAG_BYTES

function parseKeys(spec) {
  const keys = new Map()
  let activeId = null
  for (const entry of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const sep = entry.indexOf(':')
    const id = Number(entry.slice(0, sep))
    if (sep < 1 || !Number.isInteger(id) || id < 1 || id > 255) {
      throw new Error('DATA_ENCRYPTION_KEYS entries must look like "<id 1-255>:<base64 key>"')
    }
    const key = Buffer.from(entry.slice(sep + 1), 'base64')
    if (key.length !== 32) {
      throw new Error(`DATA_ENCRYPTION_KEYS: key ${id} must be 32 random bytes, base64 encoded`)
    }
    if (keys.has(id)) throw new Error(`DATA_ENCRYPTION_KEYS: key id ${id} is listed twice`)
    keys.set(id, key)
    if (activeId === null) activeId = id
  }
  return { keys, activeId }
}

const { keys: KEYS, activeId: ACTIVE_KEY_ID } = parseKeys(process.env.DATA_ENCRYPTION_KEYS)

export const encryptionConfigured = KEYS.size > 0

function requireKey(id) {
  const key = KEYS.get(id)
  if (!key) {
    throw new Error(
      encryptionConfigured
        ? `No encryption key with id ${id} — was it removed from DATA_ENCRYPTION_KEYS too early?`
        : 'DATA_ENCRYPTION_KEYS is not set'
    )
  }
  return key
}

/** Seal a string. null/undefined/'' stay null so optional columns stay NULL. */
export function seal(value, context) {
  if (value == null || value === '') return null
  const key = requireKey(ACTIVE_KEY_ID)
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([FORMAT, ACTIVE_KEY_ID]), iv, cipher.getAuthTag(), body])
}

/**
 * Open a sealed value. Throws on a wrong key, a wrong context or tampering —
 * a value that doesn't authenticate is never returned.
 */
export function open(sealed, context) {
  if (sealed == null) return null
  const buf = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed)
  if (buf.length < HEADER_BYTES || buf[0] !== FORMAT) {
    throw new Error(`Unreadable encrypted value (${context})`)
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireKey(buf[1]), buf.subarray(2, 2 + IV_BYTES))
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(buf.subarray(2 + IV_BYTES, HEADER_BYTES))
  return Buffer.concat([decipher.update(buf.subarray(HEADER_BYTES)), decipher.final()]).toString('utf8')
}

export const sealJson = (value, context) => (value == null ? null : seal(JSON.stringify(value), context))

export function openJson(sealed, context) {
  const text = open(sealed, context)
  return text == null ? null : JSON.parse(text)
}

/** Builds the AAD string for a column: "table.column:rowKey". */
export const aad = (table, column, rowKey = '') => `${table}.${column}:${rowKey}`

// --- blind indexes --------------------------------------------------------------

// Keys the one-way hashes used to look up encrypted values (email, phone, ID
// number, member refs). Without it those hashes would be brute-forceable — the
// space of phone numbers is tiny. Rotating it invalidates every hash-based
// login and lookup, so treat it as permanent.
const PEPPER = process.env.AUTH_PEPPER || ''
export const pepperConfigured = Boolean(PEPPER)

/**
 * HMAC-SHA256 of a value. `namespace` keeps the same input in different roles
 * (a phone number vs. a journey id) from producing comparable hashes. The empty
 * namespace reproduces the original contact-hash scheme exactly, so hashes
 * written before namespaces existed still match.
 */
export function blindIndex(value, namespace = '') {
  if (value == null || value === '') return null
  // NUL separates the parts, so ("ab", "c") and ("a", "bc") cannot collide.
  const input = namespace ? `${namespace}\u0000${value}` : String(value)
  return crypto.createHmac('sha256', PEPPER || 'asknelson-unkeyed').update(input).digest('hex')
}
