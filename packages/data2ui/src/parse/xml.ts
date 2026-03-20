/**
 * XML parser — normalizes XML to the JSON/YAML data model.
 *
 * Normalization rules:
 * - Elements → objects; repeated sibling elements → arrays
 * - Attributes → keys with configurable prefix (default: '@')
 * - Text content in mixed-content elements → special key (default: '#text')
 * - Namespace prefixes stripped by default
 * - Leaf text coerced to number/boolean/null when matching patterns
 */
import { XMLParser } from 'fast-xml-parser'
import type { XmlParseOptions } from './types'

const DEFAULT_XML_OPTIONS: XmlParseOptions = {
  attributeMode: 'prefix',
  attributePrefix: '@',
  textKey: '#text',
  stripNamespaces: true,
  coerceTypes: true,
}

export function parseXML(input: string, options?: Partial<XmlParseOptions>): unknown {
  const opts = { ...DEFAULT_XML_OPTIONS, ...options }

  const parserOptions: ConstructorParameters<typeof XMLParser>[0] = {
    ignoreAttributes: opts.attributeMode === 'ignore',
    attributeNamePrefix: opts.attributeMode === 'prefix' ? opts.attributePrefix : '',
    textNodeName: opts.textKey,
    // Coerce "true"/"false"/numbers in leaf text
    parseTagValue: opts.coerceTypes,
    parseAttributeValue: opts.coerceTypes,
    // Let fast-xml-parser handle repeated elements naturally.
    // It automatically creates arrays when sibling elements share a name.
    // Remove namespace prefixes
    removeNSPrefix: opts.stripNamespaces,
    // Group attributes under a nested key when mode is 'nested'
    attributesGroupName: opts.attributeMode === 'nested' ? '@attributes' : undefined,
  }

  try {
    const parser = new XMLParser(parserOptions)
    const result = parser.parse(input) as Record<string, unknown>

    // fast-xml-parser wraps everything under the root element name.
    // Unwrap single root element for consistency with JSON/YAML.
    const keys = Object.keys(result)

    // Skip XML declaration keys (e.g., '?xml')
    const contentKeys = keys.filter(k => !k.startsWith('?'))

    if (contentKeys.length === 1) {
      return result[contentKeys[0]!]
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`XML parse error: ${message}`)
  }
}
