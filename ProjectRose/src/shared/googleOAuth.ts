export const DEFAULT_GOOGLE_CLIENT_ID =
  'TODO'

export function resolveGoogleClientId(): string {
  const envOverride = (process.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? '').trim()
  if (envOverride) return envOverride
  return DEFAULT_GOOGLE_CLIENT_ID
}
