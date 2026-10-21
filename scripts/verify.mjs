#!/usr/bin/env node
// One command to check that MirrorCat is in shape before merging or
// releasing. Runs every automated check and reports a summary.
//
//   npm run verify            typecheck, lint, unit tests + coverage, build, e2e
//   npm run verify -- --quick skip the build and e2e (no windows open)
//   npm run verify -- --package  also package the app and check its Electron fuses
//   npm run verify -- --bail  stop at the first failure
//
// The e2e step launches MirrorCat (and a small projector window) for
// about 15 seconds, against a throwaway data folder.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
const quick = args.has('--quick')
const withPackage = args.has('--package')
const bail = args.has('--bail')

if (args.has('--help') || args.has('-h')) {
  console.log('Usage: npm run verify -- [--quick] [--package] [--bail]')
  process.exit(0)
}

// Never let an inherited NODE_ENV=production make npm-run tools behave
// differently from a normal terminal.
const env = { ...process.env, NODE_ENV: 'development', FORCE_COLOR: '1' }

const color = process.stdout.isTTY
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const green = (t) => paint('32', t)
const red = (t) => paint('31', t)
const dim = (t) => paint('2', t)
const bold = (t) => paint('1', t)

function run(command, { capture = false, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(command, {
      shell: true,
      env: { ...env, ...extraEnv },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    })
    if (capture) {
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))
    }
    child.on('close', (code) => resolve({ ok: code === 0, output }))
  })
}

const EXPECTED_FUSES = {
  RunAsNode: 'Disabled',
  EnableCookieEncryption: 'Enabled',
  EnableNodeOptionsEnvironmentVariable: 'Disabled',
  EnableNodeCliInspectArguments: 'Disabled',
  EnableEmbeddedAsarIntegrityValidation: 'Enabled',
  OnlyLoadAppFromAsar: 'Enabled'
}

function packagedAppPath() {
  if (!existsSync('release')) return null
  for (const dir of readdirSync('release')) {
    const full = join('release', dir)
    if (process.platform === 'darwin' && dir.startsWith('mac')) {
      const app = readdirSync(full).find((f) => f.endsWith('.app'))
      if (app) return join(full, app)
    }
    if (process.platform === 'win32' && dir === 'win-unpacked') return join(full, 'MirrorCat.exe')
    if (process.platform === 'linux' && dir === 'linux-unpacked') return join(full, 'mirrorcat')
  }
  return null
}

async function checkPackage() {
  const target = { darwin: '--mac', win32: '--win', linux: '--linux' }[process.platform]
  if (!target) return { ok: false, note: `unsupported platform ${process.platform}` }
  const built = await run(`npx electron-builder ${target} --dir`, {
    extraEnv: { CSC_IDENTITY_AUTO_DISCOVERY: 'false', NODE_ENV: 'production' }
  })
  if (!built.ok) return { ok: false, note: 'electron-builder failed' }
  const app = packagedAppPath()
  if (!app) return { ok: false, note: 'packaged app not found under release/' }
  const read = await run(`npx @electron/fuses read --app "${app}"`, {
    capture: true,
    extraEnv: { FORCE_COLOR: '0' }
  })
  const text = read.output.replace(/\x1b\[[0-9;]*m/g, '')
  const wrong = Object.entries(EXPECTED_FUSES).filter(
    ([fuse, state]) => !text.includes(`${fuse} is ${state}`)
  )
  for (const [fuse, state] of wrong) console.log(red(`  fuse ${fuse} should be ${state}`))
  return { ok: read.ok && wrong.length === 0, note: app }
}

const steps = [
  { name: 'Typecheck', run: () => run('npm run -s typecheck') },
  { name: 'Lint', run: () => run('npm run -s lint') },
  { name: 'Unit tests + coverage', run: () => run('npx vitest run --coverage') },
  { name: 'Build', run: () => run('npx electron-vite build'), skip: quick },
  {
    name: 'End-to-end (Playwright)',
    run: () => run('npx playwright test'),
    skip: quick,
    needs: 'Build'
  },
  { name: 'Package + Electron fuses', run: checkPackage, skip: !withPackage, needs: 'Build' }
]

const results = []
for (const step of steps) {
  if (step.skip) {
    results.push({ name: step.name, status: 'skipped' })
    continue
  }
  const dependency = step.needs && results.find((r) => r.name === step.needs)
  if (dependency && dependency.status !== 'passed') {
    results.push({ name: step.name, status: 'skipped', note: `${step.needs} failed` })
    continue
  }
  console.log(`\n${bold(`▶ ${step.name}`)}`)
  const started = Date.now()
  const { ok, note } = await step.run()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name: step.name, status: ok ? 'passed' : 'failed', seconds, note })
  if (!ok && bail) break
}

console.log(`\n${bold('MirrorCat verify')}`)
for (const r of results) {
  const mark = r.status === 'passed' ? green('✓') : r.status === 'failed' ? red('✗') : dim('–')
  const time = r.seconds ? dim(` ${r.seconds}s`) : ''
  const note = r.note ? dim(`  (${r.note})`) : r.status === 'skipped' ? dim('  (skipped)') : ''
  console.log(`  ${mark} ${r.name}${time}${note}`)
}

console.log(
  dim(`
Still by hand (needs real hardware or your real data):
  • Unplug a real projector while live; the projector window should close.
  • Activity Monitor: GPU helper near idle with only images; busy only while video plays.
  • Drag an image from Finder onto the stage; it lands on the selected surface.
  • Packaged app (--package, then open it): Esc, drag-and-drop and Go live still work.`)
)

const failed = results.some((r) => r.status === 'failed')
console.log(failed ? red('\nSome checks failed.') : green('\nAll checks passed.'))
process.exit(failed ? 1 : 0)
