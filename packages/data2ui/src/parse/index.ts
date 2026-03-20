/**
 * Unified input parser with format auto-detection.
 */
import { InputFormat } from '../types'
import { parseJSON } from './json'
import { parseYAML } from './yaml'
import { parseXML } from './xml'
import type { ParseOptions, ParseResult } from './types'

/**
 * Detect the format of a raw string input.
 * Heuristic-based: checks for XML declaration/tags, then JSON markers, else YAML.
 */
export function detectFormat(input: string): InputFormat {
  const trimmed = input.trimStart()

  // XML: starts with '<' (tag or declaration)
  if (trimmed.startsWith('<')) {
    return InputFormat.XML
  }

  // JSON: starts with '{', '[', or is a quoted string/number/boolean/null
  const firstChar = trimmed[0]
  if (firstChar === '{' || firstChar === '[') {
    return InputFormat.JSON
  }

  // JSON primitives: "string", number, true, false, null
  if (firstChar === '"' || /^-?\d/.test(trimmed) || /^(true|false|null)\b/.test(trimmed)) {
    return InputFormat.JSON
  }

  // Default to YAML (superset of JSON, handles most other formats)
  return InputFormat.YAML
}

/**
 * Parse raw input into a JS value.
 *
 * - If input is a string, auto-detects format (or uses forced format) and parses.
 * - If input is already a non-string value, returns it directly (format defaults
 *   to JSON unless overridden via options).
 */
export function parseInput(input: string | unknown, options?: ParseOptions): ParseResult {
  // Already parsed data (object, array, number, etc.)
  if (typeof input !== 'string') {
    return {
      data: input,
      inputFormat: options?.inputFormat ?? InputFormat.JSON,
    }
  }

  if (input.trim().length === 0) {
    throw new Error('Cannot parse empty input')
  }

  const format = options?.inputFormat ?? detectFormat(input)

  switch (format) {
    case InputFormat.JSON:
      return { data: parseJSON(input), inputFormat: InputFormat.JSON }
    case InputFormat.YAML:
      return { data: parseYAML(input), inputFormat: InputFormat.YAML }
    case InputFormat.XML:
      return { data: parseXML(input, options?.xmlOptions), inputFormat: InputFormat.XML }
    default: {
      // Exhaustive check
      const _exhaustive: never = format
      throw new Error(`Unknown input format: ${_exhaustive}`)
    }
  }
}

export type { ParseResult, ParseOptions, XmlParseOptions } from './types'
