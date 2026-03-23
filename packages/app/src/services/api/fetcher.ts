import { executeRaw, ApiInvokeError, ErrorKind, ParamLocation } from '@api2aux/api-invoke'
import type { Auth } from '@api2aux/api-invoke'
import { CORSError, NetworkError, APIError, ParseError, AuthError, GraphQLError } from './errors'
import { proxy } from './proxy'
import { useAuthStore } from '../../store/authStore'
import { AuthType } from '../../types/auth'
import type { Credential } from '../../types/auth'

/**
 * Convert app Credential to api-invoke Auth.
 */
export function credentialToAuth(credential: Credential): Auth {
  switch (credential.type) {
    case AuthType.Bearer:
      return { type: 'bearer', token: credential.token }
    case AuthType.Basic:
      return { type: 'basic', username: credential.username, password: credential.password }
    case AuthType.ApiKey:
      return { type: 'apiKey', location: ParamLocation.HEADER, name: credential.headerName, value: credential.value }
    case AuthType.QueryParam:
      return { type: 'apiKey', location: ParamLocation.QUERY, name: credential.paramName, value: credential.value }
    case AuthType.Cookie:
      return { type: 'cookie', name: credential.cookieName, value: credential.value }
    default: {
      const _exhaustive: never = credential
      return _exhaustive
    }
  }
}

/**
 * Map api-invoke errors to app-specific error classes.
 */
function mapError(err: unknown, url: string, credential: Credential | null): never {
  if (err instanceof ApiInvokeError) {
    switch (err.kind) {
      case ErrorKind.CORS:
        throw new CORSError(url)
      case ErrorKind.NETWORK:
      case ErrorKind.TIMEOUT:
        throw new NetworkError(url)
      case ErrorKind.AUTH: {
        const authContext = credential ? `${credential.type} auth` : 'no credentials configured'
        const body = err.responseBody
          ? (typeof err.responseBody === 'string' ? err.responseBody : JSON.stringify(err.responseBody))
          : ''
        const authStatus = err.status === 403 ? 403 : 401 as const
        throw new AuthError(url, authStatus, authContext, body)
      }
      case ErrorKind.PARSE:
        throw new ParseError(url)
      case ErrorKind.GRAPHQL: {
        const errors = Array.isArray(err.responseBody)
          ? err.responseBody
          : [{ message: err.message }]
        throw new GraphQLError(url, errors)
      }
      default:
        throw new APIError(url, err.status ?? 0, err.message)
    }
  }
  throw new NetworkError(url)
}

/**
 * Fetch JSON data from an API URL with typed error handling.
 * Detects CORS, network, HTTP, and parse errors.
 */
export async function fetchAPI(url: string): Promise<unknown> {
  try {
    const result = await executeRaw(url, { accept: 'application/json' })
    return result.data
  } catch (err) {
    mapError(err, url, null)
  }
}

export interface FetchOptions {
  method?: string       // defaults to 'GET'
  body?: string         // request body string
  contentType?: string  // defaults to 'application/json'
}

/**
 * Fetch JSON data from an API URL with authentication support.
 * Automatically injects credentials from auth store if configured.
 * Routes through CORS proxy for cross-origin requests.
 * Detects 401/403 as AuthError, CORS, network, HTTP, and parse errors.
 */
export async function fetchWithAuth(url: string, options?: FetchOptions): Promise<unknown> {
  const credential = useAuthStore.getState().getActiveCredential(url)
  const method = options?.method ?? 'GET'
  const body = options?.body
  const contentType = options?.contentType ?? 'application/json'

  try {
    const result = await executeRaw(url, {
      method,
      body,
      accept: 'application/json',
      headers: body ? { 'Content-Type': contentType } : undefined,
      auth: credential ? credentialToAuth(credential) : undefined,
      middleware: [proxy],
    })
    return result.data
  } catch (err) {
    mapError(err, url, credential)
  }
}

/**
 * Check if authentication is configured for a URL.
 * Returns true if an active credential exists for the URL's origin.
 */
export function isAuthConfigured(url: string): boolean {
  const credential = useAuthStore.getState().getActiveCredential(url)
  return credential !== null
}

/**
 * Mask credential values for safe logging.
 * Returns a masked string representation of the credential.
 */
export function maskCredential(credential: Credential): string {
  switch (credential.type) {
    case AuthType.Bearer: {
      const preview = credential.token.substring(0, 4)
      return `Bearer ${preview}***`
    }

    case AuthType.Basic: {
      return `Basic ${credential.username}:***`
    }

    case AuthType.ApiKey: {
      return `${credential.headerName}: ***`
    }

    case AuthType.QueryParam: {
      return `?${credential.paramName}=***`
    }

    case AuthType.Cookie: {
      return `Cookie ${credential.cookieName}=***`
    }

    default: {
      const _exhaustive: never = credential
      return _exhaustive
    }
  }
}
