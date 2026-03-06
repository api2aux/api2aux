import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { FieldConfig, ThemePreset, StyleOverrides, ConfigState, DrilldownMode, PaginationConfig } from '../types/config'

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      targetVal !== undefined &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key] = sourceVal as T[keyof T]
    }
  }
  return result
}

interface ConfigStore extends ConfigState {
  // Mode
  setDrilldownMode: (mode: DrilldownMode) => void

  // Field config
  setFieldConfig: (path: string, config: Partial<FieldConfig>) => void
  toggleFieldVisibility: (path: string) => void
  setFieldLabel: (path: string, label: string) => void
  setFieldComponentType: (path: string, componentType: string) => void
  setFieldOrder: (path: string, order: number) => void
  reorderFields: (orderedPaths: string[]) => void

  // Theme
  applyTheme: (theme: ThemePreset) => void

  // Style overrides
  setStyleOverride: (key: string, value: string) => void
  setStyleOverrides: (overrides: StyleOverrides) => void
  setEndpointStyleOverride: (endpoint: string, key: string, value: string) => void
  clearEndpointOverrides: (endpoint: string) => void
  getEndpointStyleOverrides: (endpoint: string) => StyleOverrides

  // Pagination
  setPaginationConfig: (path: string, config: Partial<PaginationConfig>) => void
  getPaginationConfig: (path: string, defaultItemsPerPage: number) => PaginationConfig

  // Plugin preferences
  setPluginPreference: (semanticCategory: string, pluginId: string) => void
  removePluginPreference: (semanticCategory: string) => void
  getPluginPreference: (semanticCategory: string) => string | undefined

  // Utility
  clearFieldConfigs: () => void
  resetConfig: () => void
  getHiddenFieldCount: () => number
  getFieldConfig: (path: string) => FieldConfig
}

const DEFAULT_FIELD_CONFIG: FieldConfig = {
  visible: true,
  order: 0,
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      // State
      drilldownMode: 'page' as DrilldownMode,
      fieldConfigs: {},
      globalTheme: 'light' as ThemePreset,
      styleOverrides: {} as StyleOverrides,
      endpointOverrides: {},
      paginationConfigs: {},
      pluginPreferences: {},

      // Mode
      setDrilldownMode: (mode) => set({ drilldownMode: mode }),

      // Field config
      setFieldConfig: (path, config) =>
        set((state) => ({
          fieldConfigs: {
            ...state.fieldConfigs,
            [path]: {
              ...DEFAULT_FIELD_CONFIG,
              ...state.fieldConfigs[path],
              ...config,
            },
          },
        })),

      toggleFieldVisibility: (path) =>
        set((state) => {
          const existing = state.fieldConfigs[path]
          return {
            fieldConfigs: {
              ...state.fieldConfigs,
              [path]: {
                ...DEFAULT_FIELD_CONFIG,
                ...existing,
                visible: existing ? !existing.visible : false,
              },
            },
          }
        }),

      setFieldLabel: (path, label) =>
        set((state) => ({
          fieldConfigs: {
            ...state.fieldConfigs,
            [path]: {
              ...DEFAULT_FIELD_CONFIG,
              ...state.fieldConfigs[path],
              label,
            },
          },
        })),

      setFieldComponentType: (path, componentType) =>
        set((state) => ({
          fieldConfigs: {
            ...state.fieldConfigs,
            [path]: {
              ...DEFAULT_FIELD_CONFIG,
              ...state.fieldConfigs[path],
              componentType,
            },
          },
        })),

      setFieldOrder: (path, order) =>
        set((state) => ({
          fieldConfigs: {
            ...state.fieldConfigs,
            [path]: {
              ...DEFAULT_FIELD_CONFIG,
              ...state.fieldConfigs[path],
              order,
            },
          },
        })),

      reorderFields: (orderedPaths) =>
        set((state) => {
          const updated = { ...state.fieldConfigs }
          orderedPaths.forEach((path, index) => {
            updated[path] = {
              ...DEFAULT_FIELD_CONFIG,
              ...updated[path],
              order: index,
            }
          })
          return { fieldConfigs: updated }
        }),

      // Theme
      applyTheme: (theme) => set({ globalTheme: theme }),

      // Style overrides
      setStyleOverride: (key, value) =>
        set((state) => ({
          styleOverrides: { ...state.styleOverrides, [key]: value },
        })),

      setStyleOverrides: (overrides) => set({ styleOverrides: overrides }),

      setEndpointStyleOverride: (endpoint, key, value) =>
        set((state) => ({
          endpointOverrides: {
            ...state.endpointOverrides,
            [endpoint]: {
              ...state.endpointOverrides[endpoint],
              [key]: value,
            },
          },
        })),

      clearEndpointOverrides: (endpoint) =>
        set((state) => {
          const { [endpoint]: _, ...rest } = state.endpointOverrides
          return { endpointOverrides: rest }
        }),

      getEndpointStyleOverrides: (endpoint) => {
        const state = get()
        const endpointOverrides = state.endpointOverrides[endpoint]
        if (!endpointOverrides) return state.styleOverrides
        return { ...state.styleOverrides, ...endpointOverrides }
      },

      // Pagination
      setPaginationConfig: (path, config) =>
        set((state) => {
          const existing = state.paginationConfigs[path] ?? { itemsPerPage: 12, currentPage: 1 }
          return {
            paginationConfigs: {
              ...state.paginationConfigs,
              [path]: { ...existing, ...config },
            },
          }
        }),

      getPaginationConfig: (path, defaultItemsPerPage) => {
        const state = get()
        return state.paginationConfigs[path] ?? { itemsPerPage: defaultItemsPerPage, currentPage: 1 }
      },

      // Plugin preferences
      setPluginPreference: (semanticCategory, pluginId) =>
        set((state) => ({
          pluginPreferences: { ...state.pluginPreferences, [semanticCategory]: pluginId },
        })),

      removePluginPreference: (semanticCategory) =>
        set((state) => {
          const { [semanticCategory]: _, ...rest } = state.pluginPreferences
          return { pluginPreferences: rest }
        }),

      getPluginPreference: (semanticCategory) => {
        return get().pluginPreferences[semanticCategory]
      },

      // Utility
      clearFieldConfigs: () => set({ fieldConfigs: {} }),
      resetConfig: () =>
        set({
          fieldConfigs: {},
          styleOverrides: {} as StyleOverrides,
          endpointOverrides: {},
          globalTheme: 'light' as ThemePreset,
          paginationConfigs: {},
          pluginPreferences: {},
        }),

      getHiddenFieldCount: () => {
        const state = get()
        return Object.values(state.fieldConfigs).filter((c) => c.visible === false).length
      },

      getFieldConfig: (path) => {
        const state = get()
        return state.fieldConfigs[path] ?? DEFAULT_FIELD_CONFIG
      },
    }),
    {
      name: 'api2aux-config',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Record<string, unknown>
        if (version < 3) {
          // v2→v3: compact/spacious presets removed, map to light
          const theme = state.globalTheme as string
          if (theme === 'compact' || theme === 'spacious') {
            state.globalTheme = 'light'
          }
        }
        return state as unknown as ConfigStore
      },
      partialize: (state) => ({
        fieldConfigs: state.fieldConfigs,
        drilldownMode: state.drilldownMode,
        globalTheme: state.globalTheme,
        styleOverrides: state.styleOverrides,
        endpointOverrides: state.endpointOverrides,
        paginationConfigs: state.paginationConfigs,
        pluginPreferences: state.pluginPreferences,
      }),
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') return currentState
        return deepMerge(
          currentState as unknown as Record<string, unknown>,
          persistedState as Record<string, unknown>
        ) as unknown as ConfigStore
      },
    }
  )
)
