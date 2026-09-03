#!/usr/bin/env node
// Pull live content from a running AskNelson instance into src/data/.
//
// Admin edits are written to the server's data directory, which lives outside
// git — so the content running on prod can drift arbitrarily far from the repo.
// This script fetches the live datasets and writes them over the seed files, so
// `git diff` shows exactly what the content team changed and the result can be
// committed like any other change.
//
// Usage:
//   node scripts/pull-content.mjs                      # localhost:8080
//   node scripts/pull-content.mjs https://prod.example # any instance
//   npm run content:pull -- https://prod.example
//
// GET /api/content/:key is unauthenticated, so no admin password is needed.

import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const DATASETS = ['explore', 'journeys', 'assessments']

// The top-level key each dataset must expose, mirroring the server's own check.
const ROOT_KEY = { explore: 'explore', journeys: 'journeys', assessments: 'assessments' }

const args = process.argv.slice(2)
const force = args.includes('--force')
const base = (args.find((a) => !a.startsWith('--')) || 'http://localhost:8080').replace(/\/+$/, '')

// This script overwrites the seed files wholesale. If the instance you point it
// at is running older content than your branch, that silently reverts work —
// so refuse to clobber uncommitted changes unless explicitly forced.
function uncommittedDataChanges() {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'src/data'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return out.trim().split('\n').filter(Boolean)
  } catch {
    return [] // not a git checkout — nothing to protect
  }
}

const dirty = uncommittedDataChanges()
if (dirty.length && !force) {
  console.error('Refusing to pull: src/data has uncommitted changes.\n')
  for (const line of dirty) console.error(`  ${line}`)
  console.error(
    '\nPulling would overwrite these with whatever the instance is serving.' +
      '\nCommit or stash them first, or re-run with --force if you mean to discard them.' +
      '\n(To undo a bad pull: git checkout -- src/data)'
  )
  process.exit(1)
}

function summarise(key, doc) {
  if (key === 'explore') {
    const themes = doc.explore?.themes ?? []
    const tiles = themes.reduce((n, t) => n + (t.content?.length ?? 0), 0)
    return `${themes.length} themes, ${tiles} tiles`
  }
  const list = doc[key] ?? []
  return `${list.length} ${key}`
}

let failed = 0
console.log(`Pulling content from ${base}\n`)

for (const key of DATASETS) {
  const url = `${base}/api/content/${key}`
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc = await res.json()

    // Refuse to overwrite a good seed file with something malformed.
    if (!doc || typeof doc !== 'object' || !(ROOT_KEY[key] in doc)) {
      throw new Error(`response has no "${ROOT_KEY[key]}" key`)
    }

    const dest = path.join(DATA_DIR, `${key}.json`)
    const next = `${JSON.stringify(doc, null, 2)}\n`
    const prev = await fs.readFile(dest, 'utf8').catch(() => null)

    if (prev === next) {
      console.log(`  = ${key}.json   unchanged   (${summarise(key, doc)})`)
    } else {
      await fs.writeFile(dest, next)
      console.log(`  ✓ ${key}.json   updated     (${summarise(key, doc)})`)
    }
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${key}.json   ${err.message}   [${url}]`)
  }
}

if (failed) {
  console.error(`\n${failed} dataset(s) failed — src/data left untouched for those.`)
  process.exit(1)
}
console.log('\nDone. Review with `git diff src/data`, then commit.')
