// Prints fresh secrets for .env:
//
//   npm run keys:generate
//
// DATA_ENCRYPTION_KEYS seals personal information at rest. Losing it makes
// every encrypted column unreadable, so store it in a secrets manager, not
// only on the server. To rotate, generate a key with the next id and PREPEND
// it: "2:<new>,1:<old>" — new writes use key 2, old rows still open with key 1.
//
// AUTH_PEPPER keys the lookup hashes (phone, email, ID number). Set it once and
// never change it: rotating it breaks every hash-based sign-in.
import crypto from 'node:crypto'

const id = Number(process.argv[2] || 1)
console.log(`DATA_ENCRYPTION_KEYS=${id}:${crypto.randomBytes(32).toString('base64')}`)
console.log(`AUTH_PEPPER=${crypto.randomBytes(32).toString('base64url')}`)
