/**
 * Primitive field type detection from raw values.
 */

/** ISO 8601 date pattern */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Detect the field type of a primitive value.
 * Arrays and objects should be handled by the schema inferrer.
 */
export function detectFieldType(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'number') {
    return 'number'
  }

  if (typeof value === 'string') {
    if (ISO_8601_PATTERN.test(value)) {
      const timestamp = Date.parse(value)
      if (!isNaN(timestamp)) {
        return 'date'
      }
    }
    return 'string'
  }

  return 'unknown'
}
