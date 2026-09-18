import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env before anything reads process.env.
//
// `docker compose` reads .env itself, but `npm start` / `npm run serve` does
// not: without this, a local run silently ignores every setting in the file —
// no encryption key, no analytics database, and ADMIN_MFA_ECHO off however it
// is written there.
//
// Imported first by index.js, because ESM evaluates each import before the
// module body: the settings must be in place before adminAuth.js and friends
// read them at import time.
//
// A real environment variable always wins (that is Node's own behaviour), so
// in Docker the values compose passes still take precedence over any .env that
// happens to be present.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = process.env.ENV_FILE || path.join(root, '.env')

if (fs.existsSync(envFile)) {
  try {
    // Node 20.12+. Older runtimes simply carry on with the real environment.
    process.loadEnvFile(envFile)
    console.log(`[asknelson] settings loaded from ${path.relative(root, envFile) || envFile}`)
  } catch (err) {
    console.warn(`[asknelson] could not read ${envFile}: ${err.message}`)
  }
}
