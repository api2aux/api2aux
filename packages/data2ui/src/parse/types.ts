import type { InputFormat } from '../types'

/** Options for XML parsing and normalization */
export interface XmlParseOptions {
  /** How to handle XML attributes (default: 'prefix') */
  attributeMode: 'prefix' | 'nested' | 'ignore'
  /** Prefix for attribute keys when mode is 'prefix' (default: '@') */
  attributePrefix: string
  /** Key for text content in mixed-content elements (default: '#text') */
  textKey: string
  /** Strip namespace prefixes from element/attribute names (default: true) */
  stripNamespaces: boolean
  /** Coerce leaf text to number/boolean/null when matching (default: true) */
  coerceTypes: boolean
}

/** Options for parseInput() */
export interface ParseOptions {
  /** Force a specific input format (auto-detected if omitted) */
  inputFormat?: InputFormat
  /** XML-specific parsing options */
  xmlOptions?: Partial<XmlParseOptions>
}

/** Result of parsing raw input into a JS value */
export interface ParseResult {
  /** The parsed JS value (object, array, or primitive) */
  data: unknown
  /** Detected or forced input format */
  inputFormat: InputFormat
}
