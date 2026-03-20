/**
 * Framework-agnostic plugin descriptor types.
 * No React dependency — just metadata for plugin resolution.
 */

/** Data types a plugin can accept */
export const DataType = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  Object: 'object',
  Array: 'array',
} as const
export type DataType = typeof DataType[keyof typeof DataType]

/** Source tier of a plugin */
export const PluginSource = {
  Core: 'core',
  Community: 'community',
  Premium: 'premium',
} as const
export type PluginSource = typeof PluginSource[keyof typeof PluginSource]

/** What data a plugin can render */
export interface PluginAccepts {
  /** Compatible data types */
  dataTypes: DataType[]
  /** Preferred semantic categories for matching */
  semanticHints?: string[]
}

/** Framework-agnostic plugin descriptor (no React component reference) */
export interface FieldPluginDescriptor {
  /** Unique ID: 'core/star-rating', '@user/fancy-gauge' */
  id: string
  /** Display name: 'Star Rating' */
  name: string
  /** Description */
  description: string
  /** What data this plugin can render */
  accepts: PluginAccepts
  /** Plugin source tier */
  source: PluginSource
  /** SemVer version string */
  version: string
  /** Searchable tags */
  tags?: string[]
}
