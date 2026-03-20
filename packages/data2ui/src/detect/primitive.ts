/**
 * Auto-detection heuristics for primitive display modes.
 * Used to choose smart defaults based on field name and value patterns.
 */
import type { RenderHint } from '../types'

/** Check if a string value looks like an email address */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Check if a string value looks like a CSS color (hex, rgb, hsl) */
export function isColorValue(value: string): boolean {
  return /^#([0-9a-fA-F]{3}){1,2}$/.test(value) ||
    /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(value) ||
    /^hsl\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?\s*\)$/i.test(value)
}

/** Check if a field represents a rating/score (number 0-5 with matching name) */
export function isRatingField(fieldName: string, value: number): boolean {
  return /rating|score|stars/i.test(fieldName) && value >= 0 && value <= 5
}

/**
 * Check if a field represents a currency amount.
 * "total" alone is too ambiguous (pagination count vs monetary total) —
 * require explicit price-related words.
 */
export function isCurrencyField(fieldName: string): boolean {
  return /price|cost|amount|fee|salary|budget|revenue|subtotal/i.test(fieldName)
}

/** Check if a field represents a code/identifier value */
export function isCodeField(fieldName: string): boolean {
  return /\b(id|hash|key|token|code|uuid|guid|ref|sku)\b/i.test(fieldName)
}

/**
 * Detect the best primitive render mode for a value based on heuristics.
 * Returns the mode string, or null if no special mode detected (use default).
 */
export function detectPrimitiveMode(value: unknown, fieldName: string): RenderHint | null {
  if (typeof value === 'number') {
    if (isRatingField(fieldName, value)) return 'rating'
    if (isCurrencyField(fieldName)) return 'currency'
    return null
  }

  if (typeof value === 'string') {
    if (isEmail(value)) return 'email'
    if (isColorValue(value)) return 'color'
    if (isCodeField(fieldName)) return 'code'
    return null
  }

  return null
}
