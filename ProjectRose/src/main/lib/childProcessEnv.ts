import { homedir } from 'os'
import { delimiter } from 'path'

// When a Mac `.app` is launched from Finder (or any GUI), macOS sets PATH to
// just `/usr/bin:/bin:/usr/sbin:/sbin` — none of the user's package-manager
// install locations are on it. So `spawn('node')`, `spawn('npm')`,
// `spawn('python')`, etc. all fail with ENOENT even when the user has those
// tools installed. This is *not* a problem when launching the dev build from
// a terminal (the shell's PATH is inherited), which is why it's easy to miss
// during development.
//
// `withAugmentedPath` returns a copy of an env object with the most common
// Mac install locations prepended to PATH. Use it as the `env:` option on
// every `spawn`/`execFile`/`execSync` call in the main process.
//
// Linux desktop launchers usually inherit a sensible PATH, but we add the
// XDG-style user dirs there too for parity. Windows already gets PATH via
// HKCU/HKLM, so this is a no-op.
const MAC_EXTRA_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin'
]

const USER_EXTRA_PATHS = [
  '.bun/bin',
  '.cargo/bin',
  '.deno/bin',
  '.local/bin',
  '.volta/bin'
]

function augmentedPath(currentPath: string | undefined): string {
  const existing = (currentPath ?? '').split(delimiter).filter(Boolean)
  const seen = new Set(existing)
  const extras: string[] = []

  const add = (p: string): void => {
    if (!seen.has(p)) {
      extras.push(p)
      seen.add(p)
    }
  }

  if (process.platform !== 'win32') {
    if (process.platform === 'darwin') {
      for (const p of MAC_EXTRA_PATHS) add(p)
    }
    const home = homedir()
    if (home) {
      for (const rel of USER_EXTRA_PATHS) add(`${home}/${rel}`)
    }
  }

  return [...extras, ...existing].join(delimiter)
}

export function withAugmentedPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return env
  return { ...env, PATH: augmentedPath(env.PATH) }
}
