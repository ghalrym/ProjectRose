// User-provided Google OAuth credentials. See ADR 0009 for why we no longer
// ship a built-in client_id or rely on PKCE-without-secret.
export interface GoogleOAuthCredentials {
  clientId: string
  clientSecret: string
}

export function hasGoogleOAuthCredentials(
  c: Partial<GoogleOAuthCredentials> | null | undefined
): c is GoogleOAuthCredentials {
  return !!c && !!c.clientId && !!c.clientSecret
}
