export interface FieldConfig {
  visible: boolean
  label?: string           // custom display label (undefined = use original)
  componentType?: string   // override component type (undefined = use default)
  order: number            // sort order for drag-and-drop reordering
}

export const ThemePreset = {
  Light: 'light',
  Dark: 'dark',
  Midnight: 'midnight',
  Forest: 'forest',
  Sand: 'sand',
  Ocean: 'ocean',
} as const
export type ThemePreset = typeof ThemePreset[keyof typeof ThemePreset]

export interface StyleOverrides {
  '--color-primary'?: string
  '--color-secondary'?: string
  '--color-background'?: string
  '--color-text'?: string
  '--color-surface'?: string
  '--color-border'?: string
  '--spacing-row'?: string
  '--font-family'?: string
  '--font-size-base'?: string
  '--border-radius-base'?: string
  [key: `--${string}`]: string | undefined  // allow additional CSS vars
}

export const DrilldownMode = {
  Page: 'page',
  Dialog: 'dialog',
  Panel: 'panel',
} as const
export type DrilldownMode = typeof DrilldownMode[keyof typeof DrilldownMode]

export interface PaginationConfig {
  itemsPerPage: number
  currentPage: number
}

export interface ConfigState {
  drilldownMode: DrilldownMode
  fieldConfigs: Record<string, FieldConfig>
  globalTheme: ThemePreset
  styleOverrides: StyleOverrides
  endpointOverrides: Record<string, StyleOverrides>
  paginationConfigs: Record<string, PaginationConfig>  // keyed by field path (e.g., "$")
  pluginPreferences: Record<string, string>  // semantic category → preferred plugin ID
}
