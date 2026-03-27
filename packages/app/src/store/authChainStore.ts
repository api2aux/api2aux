import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Configuration for an auth endpoint that provides tokens for other endpoints on the same origin.
 * URL-based: works in both single-endpoint and multi-endpoint/sidebar modes.
 */
export interface AuthEndpointConfig {
  /** Full URL of the auth endpoint */
  url: string
  /** HTTP method for the auth endpoint */
  method: string
  /** Dot-notation path to extract the token from the auth response (e.g. "data.token", "access_token") */
  tokenPath: string
  /** Request body to send with the auth endpoint (JSON string, e.g. credentials) */
  requestBody: string
}

/**
 * Cached token from a successful auth endpoint call.
 */
interface CachedToken {
  /** The extracted token value */
  token: string
  /** Timestamp when the token was obtained */
  obtainedAt: number
}

interface AuthChainState {
  /** Auth endpoint configs indexed by origin */
  configs: Record<string, AuthEndpointConfig>
  /** Cached tokens indexed by origin (runtime only, not persisted) */
  tokens: Record<string, CachedToken>
}

interface AuthChainStore extends AuthChainState {
  /** Set auth endpoint config for an origin */
  setConfig: (origin: string, config: AuthEndpointConfig) => void
  /** Get auth endpoint config for an origin */
  getConfig: (origin: string) => AuthEndpointConfig | null
  /** Remove auth endpoint config for an origin */
  removeConfig: (origin: string) => void
  /** Cache a token for an origin */
  cacheToken: (origin: string, token: string) => void
  /** Get cached token for an origin */
  getCachedToken: (origin: string) => string | null
  /** Invalidate cached token for an origin (e.g. on 401) */
  invalidateToken: (origin: string) => void
  /** Check if a URL is the auth endpoint for its origin */
  isAuthEndpointUrl: (url: string) => boolean
  /** Clear all configs and tokens */
  clearAll: () => void
}

function getOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export { getOrigin }

export const useAuthChainStore = create<AuthChainStore>()(
  persist(
    (set, get) => ({
      configs: {},
      tokens: {},

      setConfig: (origin, config) => {
        set((state) => ({
          configs: { ...state.configs, [origin]: config },
          // Invalidate cached token when config changes
          tokens: (() => {
            const { [origin]: _, ...rest } = state.tokens
            return rest
          })(),
        }))
      },

      getConfig: (origin) => {
        return get().configs[origin] ?? null
      },

      removeConfig: (origin) => {
        set((state) => {
          const { [origin]: _, ...restConfigs } = state.configs
          const { [origin]: __, ...restTokens } = state.tokens
          return { configs: restConfigs, tokens: restTokens }
        })
      },

      cacheToken: (origin, token) => {
        set((state) => ({
          tokens: {
            ...state.tokens,
            [origin]: { token, obtainedAt: Date.now() },
          },
        }))
      },

      getCachedToken: (origin) => {
        const cached = get().tokens[origin]
        return cached?.token ?? null
      },

      invalidateToken: (origin) => {
        set((state) => {
          const { [origin]: _, ...rest } = state.tokens
          return { tokens: rest }
        })
      },

      isAuthEndpointUrl: (url) => {
        const origin = getOrigin(url)
        const config = get().configs[origin]
        if (!config) return false
        // Normalize both URLs for comparison (strip trailing slashes)
        const normalize = (u: string) => u.replace(/\/+$/, '')
        return normalize(config.url) === normalize(url)
      },

      clearAll: () => {
        set({ configs: {}, tokens: {} })
      },
    }),
    {
      name: 'api2aux-auth-chain',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        configs: state.configs,
      }),
    }
  )
)
