import { basename, join } from 'path'

/**
 * Normalize a tool-supplied path against the project root and (optionally)
 * block sensitive files. Returns either `{ absolute }` on success or
 * `{ deniedReason }` so callers can return the denial as a tool-result
 * string without crashing the agent.
 *
 * The "absolute" detection: a path starting with `/` (POSIX absolute) or
 * containing `:` (Windows drive prefix like `C:\…`) passes through; anything
 * else is joined onto `projectRoot`. This matches what the file-touching
 * core tools did individually before this helper existed.
 *
 * `.env` and `.env.*` are blocked when `blockDotEnv` is set so that read,
 * write, edit, and list all refuse to expose dotenv files. The earlier
 * code only blocked read; write/edit could silently overwrite a `.env`.
 */
export function resolveProjectPath(
  input: string,
  projectRoot: string,
  opts: { blockDotEnv?: boolean } = {}
): { absolute: string } | { deniedReason: string } {
  const absolute =
    input.startsWith('/') || input.includes(':')
      ? input
      : join(projectRoot, input)

  if (opts.blockDotEnv && isDotEnvPath(absolute)) {
    return { deniedReason: 'Access denied: .env files cannot be accessed.' }
  }

  return { absolute }
}

export function isDotEnvPath(absolutePath: string): boolean {
  const name = basename(absolutePath)
  return name === '.env' || name.startsWith('.env.')
}
