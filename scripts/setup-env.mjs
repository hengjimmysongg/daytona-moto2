#!/usr/bin/env node
/**
 * Set up .env for local development and for deploying.
 *
 * Creates the file if it is missing, keeps any value already in it, and
 * generates the one secret that does not come from somewhere else — the
 * API key, which is just a random string and may as well be a strong one.
 *
 * Values are never printed. A token that gets echoed into a terminal ends
 * up in scrollback, in shell history and in CI logs, so this prints only
 * whether each variable is set and how long it is.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')

const checkOnly = process.argv.includes('--check')

/** What each variable is for, and where to get it when it is missing. */
const VARIABLES = [
  {
    name: 'TRACKER_API_KEY',
    need: 'deploy',
    generate: () => randomBytes(32).toString('base64url'),
    what: 'The shared secret every /api call must present.',
    how: 'Generated for you.',
  },
  {
    name: 'TURSO_DATABASE_URL',
    need: 'deploy',
    what: 'The hosted SQLite database. Local dev falls back to ./data/tracker.db.',
    how: 'turso db create trackday && turso db show trackday --url',
  },
  {
    name: 'TURSO_AUTH_TOKEN',
    need: 'deploy',
    what: 'Token for that database.',
    how: 'turso db tokens create trackday',
  },
  {
    name: 'GARAGE_ID',
    need: 'optional',
    what: 'Which garage rows belong to. Only worth setting for two logs in one database.',
    how: 'Defaults to "default".',
  },
]

/* ------------------------------------------------------------------ */

function parseEnv(text) {
  const values = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
  }
  return values
}

function describe(value) {
  if (!value) return 'not set'
  return `set (${value.length} chars)`
}

const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : new Map()
const hadFile = existsSync(envPath)
const generated = []

for (const variable of VARIABLES) {
  if (existing.get(variable.name)) continue
  if (!variable.generate || checkOnly) continue
  existing.set(variable.name, variable.generate())
  generated.push(variable.name)
}

if (!checkOnly) {
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : ''
  // The leading comment block of .env.example, which is the bit that says
  // where these values have to end up.
  const preamble = []
  for (const line of example.split('\n')) {
    if (!line.startsWith('#')) break
    preamble.push(line)
  }
  const header = preamble.join('\n')

  const body = VARIABLES.map((variable) => {
    const comment = `# ${variable.what}${variable.how ? `\n#   ${variable.how}` : ''}`
    return `${comment}\n${variable.name}=${existing.get(variable.name) ?? ''}`
  }).join('\n\n')

  writeFileSync(envPath, `${header || '# Local environment. Never committed.'}\n\n${body}\n`, {
    mode: 0o600,
  })
}

/* ------------------------------------------------------------------ */

const label = checkOnly ? 'Checking' : hadFile ? 'Updated' : 'Created'
console.log(`\n${label} .env\n`)

let missingForDeploy = 0
for (const variable of VARIABLES) {
  const value = existing.get(variable.name)
  const isMissing = !value && variable.need === 'deploy'
  if (isMissing) missingForDeploy += 1
  const mark = value ? '✓' : variable.need === 'deploy' ? '✗' : '·'
  const note = generated.includes(variable.name) ? ' — generated' : ''
  console.log(`  ${mark} ${variable.name.padEnd(20)} ${describe(value)}${note}`)
  if (isMissing) console.log(`      ${variable.how}`)
}

console.log('')
if (missingForDeploy === 0) {
  console.log('Ready.')
  console.log('  Local     npm run dev:vercel        # or: npm run dev:netlify')
  console.log('  Vercel    npx vercel env add TRACKER_API_KEY production   # once per variable')
  console.log('            npx vercel deploy --prod')
  console.log('  Netlify   npx netlify env:import .env')
  console.log('            npx netlify deploy --build --prod')
} else {
  console.log(`${missingForDeploy} variable(s) still needed to deploy. Local development works`)
  console.log('without them — the database falls back to the file ./data/tracker.db.')
  console.log('\n  npm run dev:vercel         # works now')
}
console.log('')

// .env is only ever read on this machine. Whichever host you use wants its
// own copy of these, set through that host — not this file.
if (checkOnly && missingForDeploy > 0) process.exit(1)
