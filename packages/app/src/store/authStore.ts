import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Credential, AuthType, AuthStatus, ApiCredentials } from '../types/auth'

/** Helper function to extract origin from URL */
function getOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    // If URL parsing fails, fall back to raw url
    return url
  }
}

interface AuthState {
  /** Credentials indexed by origin */
  credentials: Record<string, ApiCredentials>
  /** Authentication status indexed by origin (runtime-only, not persisted) */
  authStatus: Record<string, AuthStatus>
}

interface AuthStore extends AuthState {
  /** Set a credential for an API, making it active */
  setCredential: (url: string, credential: Credential) => void
  /** Set which credential type is active for an API */
  setActiveType: (url: string, type: AuthType) => void
  /** Get the currently active credential for an API */
  getActiveCredential: (url: string) => Credential | null
  /** Get all credentials for an API */
  getCredentials: (url: string) => ApiCredentials | null
  /** Clear all credentials for a specific API */
  clearForApi: (url: string) => void
  /** Clear all stored credentials */
  clearAll: () => void
  /** Set authentication status for an API */
  setAuthStatus: (url: string, status: AuthStatus) => void
  /** Get authentication status for an API */
  getAuthStatus: (url: string) => AuthStatus
  /** Get list of all configured origins */
  getConfiguredOrigins: () => string[]
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // State
      credentials: {},
      authStatus: {},

      // Set a credential for an API
      setCredential: (url, credential) => {
        const origin = getOrigin(url)
        set((state) => {
          const existing = state.credentials[origin] ?? {
            credentials: {
              bearer: null,
              basic: null,
              apiKey: null,
              queryParam: null,
              cookie: null,
            },
            activeType: null,
          }

          return {
            credentials: {
              ...state.credentials,
              [origin]: {
                credentials: {
                  ...existing.credentials,
                  [credential.type]: credential,
                },
                activeType: credential.type, // Newly added credential becomes active
              },
            },
            authStatus: {
              ...state.authStatus,
              [origin]: 'untested', // Reset status when credentials change
            },
          }
        })
      },

      // Set which credential type is active
      setActiveType: (url, type) => {
        const origin = getOrigin(url)
        const state = get()
        const apiCreds = state.credentials[origin]

        // Only set if a credential of that type exists
        if (!apiCreds || !apiCreds.credentials[type]) {
          return
        }

        set((state) => ({
          credentials: {
            ...state.credentials,
            [origin]: {
              credentials: apiCreds.credentials,
              activeType: type,
            },
          },
        }))
      },

      // Get the currently active credential
      getActiveCredential: (url) => {
        const origin = getOrigin(url)
        const state = get()
        const apiCreds = state.credentials[origin]

        if (!apiCreds || !apiCreds.activeType) {
          return null
        }

        return apiCreds.credentials[apiCreds.activeType]
      },

      // Get all credentials for an API
      getCredentials: (url) => {
        const origin = getOrigin(url)
        const state = get()
        return state.credentials[origin] ?? null
      },

      // Clear credentials for a specific API
      clearForApi: (url) => {
        const origin = getOrigin(url)
        set((state) => {
          const { [origin]: _, ...restCredentials } = state.credentials
          const { [origin]: __, ...restStatus } = state.authStatus
          return {
            credentials: restCredentials,
            authStatus: restStatus,
          }
        })
      },

      // Clear all credentials
      clearAll: () => {
        set({
          credentials: {},
          authStatus: {},
        })
      },

      // Set authentication status
      setAuthStatus: (url, status) => {
        const origin = getOrigin(url)
        set((state) => ({
          authStatus: {
            ...state.authStatus,
            [origin]: status,
          },
        }))
      },

      // Get authentication status
      getAuthStatus: (url) => {
        const origin = getOrigin(url)
        const state = get()
        return state.authStatus[origin] ?? 'untested'
      },

      // Get list of configured origins
      getConfiguredOrigins: () => {
        const state = get()
        return Object.keys(state.credentials)
      },
    }),
    {
      name: 'api2aux-auth',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        credentials: state.credentials,
        // authStatus is NOT persisted - it's runtime state only
      }),
    }
  )
)
