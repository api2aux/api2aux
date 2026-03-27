/**
 * Workspace auto-sync service.
 * Watches zustand stores and debounces saves to the backend API.
 * Falls back to localStorage-only if API is unavailable.
 */

import { useAppStore } from '../../store/appStore'
import { useAuthStore } from '../../store/authStore'
import { useAuthChainStore } from '../../store/authChainStore'
import { useConfigStore } from '../../store/configStore'
import {
  isApiAvailable,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  type WorkspaceData,
} from './workspaceApi'

const WORKSPACE_ID_KEY = 'api2aux-workspace-id'
const DEBOUNCE_MS = 2000

let syncEnabled = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribers: (() => void)[] = []

/** Get or create a workspace ID */
function getWorkspaceId(): string {
  let id = localStorage.getItem(WORKSPACE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(WORKSPACE_ID_KEY, id)
  }
  return id
}

/** Collect current state from all stores */
function collectState(): Omit<WorkspaceData, 'id' | 'name'> {
  const appState = useAppStore.getState()
  const authState = useAuthStore.getState()
  const authChainState = useAuthChainStore.getState()
  const configState = useConfigStore.getState()

  return {
    appState: {
      url: appState.url,
      urlMode: appState.urlMode,
      httpMethod: appState.httpMethod,
      requestBody: appState.requestBody,
      requestBodyFormat: appState.requestBodyFormat,
      additionalEndpoints: appState.additionalEndpoints,
      baseUrlOverride: appState.baseUrlOverride,
      parameterValues: appState.parameterValues,
    },
    authCredentials: {
      credentials: authState.credentials,
    },
    authChains: {
      configs: authChainState.configs,
    },
    configState: {
      fieldConfigs: configState.fieldConfigs,
      drilldownMode: configState.drilldownMode,
      globalTheme: configState.globalTheme,
      styleOverrides: configState.styleOverrides,
      endpointOverrides: configState.endpointOverrides,
      paginationConfigs: configState.paginationConfigs,
      pluginPreferences: configState.pluginPreferences,
    },
  }
}

/** Save current state to the API */
async function saveToApi(): Promise<void> {
  if (!syncEnabled) return

  const id = getWorkspaceId()
  const state = collectState()

  try {
    const existing = await getWorkspace(id)
    if (existing) {
      await updateWorkspace(id, state)
    } else {
      await createWorkspace({ id, name: 'Default', ...state })
    }
  } catch (err) {
    console.warn('[workspace-sync] Failed to save to API:', err instanceof Error ? err.message : err)
  }
}

/** Debounced save — resets timer on each call */
function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveToApi, DEBOUNCE_MS)
}

/** Load state from the API into stores */
async function loadFromApi(): Promise<boolean> {
  const id = getWorkspaceId()

  try {
    const data = await getWorkspace(id)
    if (!data) return false

    // Restore app state
    const app = data.appState as Record<string, unknown> | null
    if (app) {
      useAppStore.setState({
        url: (app.url as string) ?? '',
        urlMode: (app.urlMode as string) ?? 'auto',
        httpMethod: (app.httpMethod as string) ?? 'GET',
        requestBody: (app.requestBody as string) ?? '',
        requestBodyFormat: (app.requestBodyFormat as string) ?? 'json',
        additionalEndpoints: (app.additionalEndpoints as Array<{ url: string; method: string }>) ?? [],
        baseUrlOverride: (app.baseUrlOverride as string | null) ?? null,
        parameterValues: (app.parameterValues as Record<string, string>) ?? {},
      } as Partial<ReturnType<typeof useAppStore.getState>>)
    }

    // Restore auth credentials
    const auth = data.authCredentials as Record<string, unknown> | null
    if (auth?.credentials) {
      useAuthStore.setState({ credentials: auth.credentials as Record<string, unknown> } as Partial<ReturnType<typeof useAuthStore.getState>>)
    }

    // Restore auth chains
    const chains = data.authChains as Record<string, unknown> | null
    if (chains?.configs) {
      useAuthChainStore.setState({ configs: chains.configs as Record<string, unknown> } as Partial<ReturnType<typeof useAuthChainStore.getState>>)
    }

    // Restore config state
    const config = data.configState as Record<string, unknown> | null
    if (config) {
      useConfigStore.setState(config as Partial<ReturnType<typeof useConfigStore.getState>>)
    }

    return true
  } catch (err) {
    console.warn('[workspace-sync] Failed to load from API:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Initialize workspace sync.
 * Checks if the API is available, loads existing state, and starts watching stores.
 */
export async function initWorkspaceSync(): Promise<void> {
  const available = await isApiAvailable()
  if (!available) {
    console.log('[workspace-sync] API not available — using localStorage only')
    return
  }

  // Try to load existing state from DB
  const loaded = await loadFromApi()
  if (loaded) {
    console.log('[workspace-sync] Restored workspace from database')
  }

  // Enable sync and subscribe to store changes
  syncEnabled = true

  unsubscribers.push(
    useAppStore.subscribe(debouncedSave),
    useAuthStore.subscribe(debouncedSave),
    useAuthChainStore.subscribe(debouncedSave),
    useConfigStore.subscribe(debouncedSave),
  )

  console.log('[workspace-sync] Auto-save enabled (debounce: 2s)')
}

/** Stop sync and clean up subscriptions */
export function stopWorkspaceSync(): void {
  syncEnabled = false
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  for (const unsub of unsubscribers) unsub()
  unsubscribers = []
}

/** Force an immediate save (e.g., before page unload) */
export async function forceSave(): Promise<void> {
  if (!syncEnabled) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveToApi()
}

/** Get the current workspace ID */
export function getCurrentWorkspaceId(): string {
  return getWorkspaceId()
}
