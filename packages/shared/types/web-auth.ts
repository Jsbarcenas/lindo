/**
 * Result of the Ankama OAuth flow, resolved by the main process once the auth
 * window reaches the deep link the game asked to be redirected to.
 *
 * Exactly one of `code` / `error` is set. A user who closes the window without
 * finishing gets `cancelled`, which the game must be told about too - otherwise
 * its login button stays spinning forever.
 */
export interface WebAuthResult {
  code?: string
  error?: string
  cancelled?: boolean
}
