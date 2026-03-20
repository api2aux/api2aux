/**
 * Primitive field type detection from raw values.
 */

/** ISO 8601 date pattern */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Closed set of field types returned by detectFieldType */
export type FieldType = 'null' | 'boolean' | 'number' | 'date' | 'string' | 'unknown'

/**
 * Detect the field type of a primitive value.
 * Returns 'unknown' for arrays/objects (which should be handled by the schema inferrer).
 */
export function detectFieldType(value: unknown): FieldType {
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
