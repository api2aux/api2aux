/**
 * Type inference service for URL parameters.
 *
 * Detects parameter types from name and value with confidence levels.
 * Uses conservative detection with multi-signal validation to prevent
 * false positives that destroy user trust.
 */

export const InferredType = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'date',
  Email: 'email',
  Url: 'url',
  Coordinates: 'coordinates',
  Zip: 'zip',
} as const
export type InferredType = typeof InferredType[keyof typeof InferredType]

export const UrlConfidenceLevel = {
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
} as const
export type UrlConfidenceLevel = typeof UrlConfidenceLevel[keyof typeof UrlConfidenceLevel]

export interface TypeInferenceResult {
  type: InferredType
  confidence: UrlConfidenceLevel
  reasons: string[]
}

// Name hint patterns for type detection
const DATE_NAME_HINTS = /date|time|created|updated|timestamp/i
const EMAIL_NAME_HINTS = /email|mail/i
const COORDINATE_NAME_HINTS = /coord|lat|lng|location|position/i
const ZIP_NAME_HINTS = /zip|postal/i
const VERSION_NAME_HINTS = /version|ver|api.?ver/i

// Value patterns
const BOOLEAN_PATTERN = /^(true|false)$/
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_PATTERN = /^https?:\/\//
const COORDINATE_PATTERN = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/
const LEADING_ZEROS_PATTERN = /^0\d+$/
// Pure 5-digit positive integers are likely IDs/codes, not numbers
const FIVE_DIGIT_INTEGER_PATTERN = /^\d{5}$/

/**
 * Check if a name contains a hint for a specific type.
 */
function hasNameHint(name: string, pattern: RegExp): boolean {
  return pattern.test(name)
}

/**
 * Check if value is a valid boolean.
 */
function tryBoolean(value: string): TypeInferenceResult | null {
  if (BOOLEAN_PATTERN.test(value)) {
    return {
      type: 'boolean',
      confidence: 'HIGH',
      reasons: [`Value "${value}" is exact boolean literal`],
    }
  }
  return null
}

/**
 * Check if value is a valid number.
 * Excludes:
 * - Leading zeros (could be ID or zip)
 * - Pure 5-digit integers (likely IDs/codes, not quantities)
 * - Scientific notation
 */
function tryNumber(name: string, value: string): TypeInferenceResult | null {
  // Reject leading zeros (except just "0")
  if (LEADING_ZEROS_PATTERN.test(value)) {
    return null
  }

  // Reject pure 5-digit integers - likely IDs/codes, not quantities
  // (e.g., "10001" could be zip, order ID, product code, etc.)
  if (FIVE_DIGIT_INTEGER_PATTERN.test(value)) {
    return null
  }

  // If name suggests ZIP but value is all digits (but doesn't match ZIP pattern),
  // treat as string rather than number (conservative approach)
  // e.g., name="zip", value="1234" or "123456" should be string, not number
  if (hasNameHint(name, ZIP_NAME_HINTS) && /^\d+$/.test(value)) {
    return null
  }

  // Version strings (e.g., "2.1") look numeric but should remain strings —
  // HTML input[type=number] applies locale-specific formatting (2,1 vs 2.1)
  if (hasNameHint(name, VERSION_NAME_HINTS)) {
    return null
  }

  if (NUMBER_PATTERN.test(value)) {
    return {
      type: 'number',
      confidence: 'HIGH',
      reasons: [`Value "${value}" matches numeric pattern`],
    }
  }
  return null
}

/**
 * Check if value is a valid ISO date.
 * Validates: pattern match + parseable + year in range 1970-2100.
 */
function tryDate(name: string, value: string): TypeInferenceResult | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null
  }

  // Try to parse and validate
  const timestamp = Date.parse(value)
  if (isNaN(timestamp)) {
    return null
  }

  // Extract year and validate range
  const year = parseInt(value.substring(0, 4), 10)
  if (year < 1970 || year > 2100) {
    return null
  }

  // Validate the date is actually valid (catches things like 2024-13-01)
  const date = new Date(value)
  const [yearPart, monthPart, dayPart] = value.split('T')[0]!.split('-').map(Number)
  if (
    date.getUTCFullYear() !== yearPart ||
    date.getUTCMonth() + 1 !== monthPart ||
    date.getUTCDate() !== dayPart
  ) {
    return null
  }

  const hasHint = hasNameHint(name, DATE_NAME_HINTS)
  return {
    type: 'date',
    confidence: hasHint ? 'HIGH' : 'MEDIUM',
    reasons: [
      `Value matches ISO 8601 date format`,
      ...(hasHint ? [`Name "${name}" contains date hint`] : []),
    ],
  }
}

/**
 * Check if value is a valid email address.
 */
function tryEmail(name: string, value: string): TypeInferenceResult | null {
  if (!EMAIL_PATTERN.test(value)) {
    return null
  }

  const hasHint = hasNameHint(name, EMAIL_NAME_HINTS)
  return {
    type: 'email',
    confidence: hasHint ? 'HIGH' : 'MEDIUM',
    reasons: [
      `Value matches email pattern`,
      ...(hasHint ? [`Name "${name}" contains email hint`] : []),
    ],
  }
}

/**
 * Check if value is a valid URL (http/https only).
 */
function tryUrl(value: string): TypeInferenceResult | null {
  if (URL_PATTERN.test(value)) {
    return {
      type: 'url',
      confidence: 'HIGH',
      reasons: [`Value starts with http:// or https://`],
    }
  }
  return null
}

/**
 * Check if value is valid coordinates (lat,lng).
 * REQUIRES name hint to return coordinates type (conservative).
 */
function tryCoordinates(name: string, value: string): TypeInferenceResult | null {
  if (!COORDINATE_PATTERN.test(value)) {
    return null
  }

  // Parse and validate ranges
  const parts = value.split(',').map((s) => parseFloat(s.trim()))
  if (parts.length !== 2) {
    return null
  }

  const [lat, lng] = parts
  if (lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) {
    return null
  }

  // REQUIRE name hint for coordinates (too risky without)
  const hasHint = hasNameHint(name, COORDINATE_NAME_HINTS)
  if (!hasHint) {
    return null // Fall back to string without name hint
  }

  return {
    type: 'coordinates',
    confidence: 'HIGH',
    reasons: [
      `Value matches coordinate pattern (lat: ${lat}, lng: ${lng})`,
      `Name "${name}" contains coordinate hint`,
    ],
  }
}

/**
 * Check if value is a valid US ZIP code.
 * REQUIRES name hint to return zip type (conservative).
 */
function tryZip(name: string, value: string): TypeInferenceResult | null {
  if (!ZIP_PATTERN.test(value)) {
    return null
  }

  // REQUIRE name hint for ZIP (too risky without - could be any 5-digit number)
  const hasHint = hasNameHint(name, ZIP_NAME_HINTS)
  if (!hasHint) {
    return null // Fall back to string without name hint
  }

  return {
    type: 'zip',
    confidence: 'HIGH',
    reasons: [`Value matches ZIP code pattern`, `Name "${name}" contains zip/postal hint`],
  }
}

/**
 * Infer the type of a parameter from its name and value.
 *
 * Detection order prioritizes specific types with name hints:
 * 1. boolean (exact match)
 * 2. ZIP (if name hint present - before number to avoid 5-digit misdetection)
 * 3. number (excludes leading zeros)
 * 4. URL (before email to handle auth in URLs)
 * 5. date (ISO 8601)
 * 6. email
 * 7. coordinates (requires name hint)
 * 8. string (fallback)
 *
 * Conservative detection:
 * - Coordinates and ZIP require name hints (too risky without)
 * - Date and email have MEDIUM confidence without name hints
 * - Boolean, number, URL have HIGH confidence from pattern alone
 *
 * @param name - Parameter name (used for hint detection)
 * @param value - Parameter value (used for pattern matching)
 * @returns Type inference result with confidence level and reasons
 */
export function inferParameterType(
  name: string,
  value: string | undefined
): TypeInferenceResult {
  // Handle undefined/empty/whitespace values
  if (value === undefined || value.trim() === '') {
    return {
      type: 'string',
      confidence: 'HIGH',
      reasons: ['Value is undefined or empty'],
    }
  }

  // Check types in order of priority
  // 1. Boolean (exact match only)
  const boolResult = tryBoolean(value)
  if (boolResult) return boolResult

  // 2. ZIP (check BEFORE number when name hint present)
  // This prevents 5-digit zips like "10001" from being detected as numbers
  const zipResult = tryZip(name, value)
  if (zipResult) return zipResult

  // 3. Number (excludes leading zeros, 5-digit integers, zip-hinted digit strings)
  const numResult = tryNumber(name, value)
  if (numResult) return numResult

  // 4. URL (check before email to handle user@host in URLs)
  const urlResult = tryUrl(value)
  if (urlResult) return urlResult

  // 5. Date (ISO 8601)
  const dateResult = tryDate(name, value)
  if (dateResult) return dateResult

  // 6. Email
  const emailResult = tryEmail(name, value)
  if (emailResult) return emailResult

  // 7. Coordinates (requires name hint)
  const coordResult = tryCoordinates(name, value)
  if (coordResult) return coordResult

  // 8. Default: string
  return {
    type: 'string',
    confidence: 'HIGH',
    reasons: ['No specific type pattern matched'],
  }
}
