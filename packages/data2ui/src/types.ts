/**
 * Const objects (as const) for data2ui.
 * Internal logic references these consts — interfaces stay open (string)
 * so consumers can extend without modifying this package.
 */

/** Node kind discriminator (closed — structural to the engine) */
export const NodeKind = {
  Layout: 'layout',
  Field: 'field',
  Collection: 'collection',
} as const
export type NodeKind = typeof NodeKind[keyof typeof NodeKind]

/**
 * Known component types for the engine's vocabulary.
 * Heuristics and defaults reference these; interfaces accept any string.
 */
export const ComponentType = {
  Table: 'table',
  CardList: 'card-list',
  List: 'list',
  Gallery: 'gallery',
  Timeline: 'timeline',
  Stats: 'stats',
  Detail: 'detail',
  Hero: 'hero',
  Tabs: 'tabs',
  Split: 'split',
  Primitive: 'primitive',
  PrimitiveList: 'primitive-list',
  Chips: 'chips',
  Inline: 'inline',
  Grid: 'grid',
  Json: 'json',
} as const
export type ComponentType = typeof ComponentType[keyof typeof ComponentType]

/** Reasons why a component was selected */
export const SelectionReason = {
  UserOverride: 'user-override',
  ReviewPattern: 'review-pattern',
  ImageGallery: 'image-gallery',
  TimelinePattern: 'timeline-pattern',
  CardHeuristic: 'card-heuristic',
  HighFieldCount: 'high-field-count',
  ImageWithFields: 'image-with-fields',
  ProfilePattern: 'profile-pattern',
  ComplexObject: 'complex-object',
  SplitPattern: 'split-pattern',
  ChipsPattern: 'chips-pattern',
  ImageGrid: 'image-grid',
  NotApplicable: 'not-applicable',
  NoData: 'no-data',
  FallbackToDefault: 'fallback-to-default',
} as const
export type SelectionReason = typeof SelectionReason[keyof typeof SelectionReason]

/** Render hints for field-level plugin resolution */
export const RenderHint = {
  Rating: 'rating',
  Currency: 'currency',
  Email: 'email',
  Color: 'color',
  Code: 'code',
  Link: 'link',
  Image: 'image',
  Date: 'date',
  Badge: 'badge',
  Phone: 'phone',
  Markdown: 'markdown',
} as const
export type RenderHint = typeof RenderHint[keyof typeof RenderHint]

/** Input format for raw data */
export const InputFormat = {
  JSON: 'json',
  YAML: 'yaml',
  XML: 'xml',
} as const
export type InputFormat = typeof InputFormat[keyof typeof InputFormat]
