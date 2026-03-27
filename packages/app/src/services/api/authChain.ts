import { executeRaw } from '@api2aux/api-invoke'
import { useAuthChainStore, getOrigin } from '../../store/authChainStore'
import { useAuthStore } from '../../store/authStore'
import { AuthType } from '../../types/auth'
import { proxy } from './proxy'

/**
 * Extract a value from a nested object using dot-notation path.
 * Supports paths like "token", "data.access_token", "response.auth.bearer".
 */
function extractByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Execute the auth endpoint for a given origin and cache the resulting token.
 * Returns the token string on success, or throws on failure.
 */
export async function authenticateForOrigin(baseUrl: string): Promise<string> {
  const origin = getOrigin(baseUrl)
  const chainStore = useAuthChainStore.getState()
  const config = chainStore.getConfig(origin)

  if (!config) {
    throw new Error(`No auth endpoint configured for origin: ${origin}`)
  }

  // Execute the auth endpoint directly via URL (no operation/spec needed)
  const result = await executeRaw(config.url, {
    method: config.method,
    body: config.requestBody || undefined,
    headers: config.requestBody ? { 'Content-Type': 'application/json' } : undefined,
    middleware: [proxy],
  })

  // Extract token using configured path
  const token = extractByPath(result.data, config.tokenPath)
  if (token === undefined || token === null || token === '') {
    throw new Error(
      `Token not found at path "${config.tokenPath}" in auth response. ` +
      `Response keys: ${result.data && typeof result.data === 'object' ? Object.keys(result.data as object).join(', ') : typeof result.data}`
    )
  }

  const tokenStr = String(token)

  // Cache the token
  chainStore.cacheToken(origin, tokenStr)

  // Also set it as a Bearer credential in the main auth store so it's used automatically
  useAuthStore.getState().setCredential(baseUrl, {
    type: AuthType.Bearer,
    label: 'Auth Chain (auto)',
    token: tokenStr,
  })
  useAuthStore.getState().setAuthStatus(baseUrl, 'success')

  return tokenStr
}

/**
 * Ensure a valid token exists for the given origin.
 * If no cached token, authenticates first. Returns the token.
 */
export async function ensureAuthenticated(baseUrl: string): Promise<string | null> {
  const origin = getOrigin(baseUrl)
  const chainStore = useAuthChainStore.getState()

  // No auth chain configured — nothing to do
  if (!chainStore.getConfig(origin)) {
    return null
  }

  // Check for cached token
  const cached = chainStore.getCachedToken(origin)
  if (cached) {
    return cached
  }

  // No cached token — authenticate
  return authenticateForOrigin(baseUrl)
}

/**
 * Handle a 401/403 error by re-authenticating and returning a new token.
 * Invalidates the old token first to force a fresh auth call.
 */
export async function reauthenticateOnFailure(baseUrl: string): Promise<string> {
  const origin = getOrigin(baseUrl)
  const chainStore = useAuthChainStore.getState()

  // Invalidate old token
  chainStore.invalidateToken(origin)

  // Re-authenticate
  return authenticateForOrigin(baseUrl)
}

/**
 * Check if an auth chain is configured for a URL's origin.
 */
export function hasAuthChain(url: string): boolean {
  const origin = getOrigin(url)
  return useAuthChainStore.getState().getConfig(origin) !== null
}
