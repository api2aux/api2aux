/**
 * Unit tests for the detect modules: type, image, and primitive detection.
 */

import { describe, it, expect } from 'vitest'
import { detectFieldType } from '../../src/detect/type'
import { isImageUrl, getHeroImageField } from '../../src/detect/image'
import {
  detectPrimitiveMode,
  isEmail,
  isColorValue,
  isRatingField,
  isCurrencyField,
  isCodeField,
} from '../../src/detect/primitive'

// ============================================================================
// detectFieldType
// ============================================================================

describe('detectFieldType', () => {
  it('returns null for null', () => {
    expect(detectFieldType(null)).toBe('null')
  })

  it('returns null for undefined', () => {
    expect(detectFieldType(undefined)).toBe('null')
  })

  it('returns boolean for true/false', () => {
    expect(detectFieldType(true)).toBe('boolean')
    expect(detectFieldType(false)).toBe('boolean')
  })

  it('returns number for numbers', () => {
    expect(detectFieldType(42)).toBe('number')
    expect(detectFieldType(3.14)).toBe('number')
    expect(detectFieldType(-0)).toBe('number')
  })

  it('returns date for ISO 8601 date strings', () => {
    expect(detectFieldType('2024-01-15')).toBe('date')
    expect(detectFieldType('2024-01-15T10:30:00Z')).toBe('date')
    expect(detectFieldType('2024-01-15T10:30:00+05:30')).toBe('date')
    expect(detectFieldType('2024-01-15T10:30:00.123Z')).toBe('date')
  })

  it('returns string for non-date strings', () => {
    expect(detectFieldType('hello')).toBe('string')
    expect(detectFieldType('')).toBe('string')
    expect(detectFieldType('not-a-date')).toBe('string')
  })

  it('returns string for invalid ISO 8601 dates (regex matches but Date.parse fails)', () => {
    expect(detectFieldType('2024-13-45')).toBe('string')
  })

  it('returns unknown for arrays and objects', () => {
    expect(detectFieldType([1, 2, 3])).toBe('unknown')
    expect(detectFieldType({ a: 1 })).toBe('unknown')
  })
})

// ============================================================================
// isImageUrl
// ============================================================================

describe('isImageUrl', () => {
  it('returns true for common image extensions', () => {
    expect(isImageUrl('https://example.com/photo.jpg')).toBe(true)
    expect(isImageUrl('https://example.com/photo.jpeg')).toBe(true)
    expect(isImageUrl('https://example.com/photo.png')).toBe(true)
    expect(isImageUrl('https://example.com/photo.gif')).toBe(true)
    expect(isImageUrl('https://example.com/photo.webp')).toBe(true)
    expect(isImageUrl('https://example.com/photo.svg')).toBe(true)
    expect(isImageUrl('https://example.com/photo.avif')).toBe(true)
  })

  it('returns false for non-image extensions', () => {
    expect(isImageUrl('https://example.com/doc.pdf')).toBe(false)
    expect(isImageUrl('https://example.com/page.html')).toBe(false)
  })

  it('returns false for non-HTTP URLs', () => {
    expect(isImageUrl('ftp://example.com/photo.jpg')).toBe(false)
  })

  it('returns false for falsy/non-string values', () => {
    expect(isImageUrl(null)).toBe(false)
    expect(isImageUrl(undefined)).toBe(false)
    expect(isImageUrl('')).toBe(false)
    expect(isImageUrl(42)).toBe(false)
  })

  it('checks pathname not query params', () => {
    // Image extension in query but not pathname
    expect(isImageUrl('https://example.com/api?file=photo.jpg')).toBe(false)
    // Image extension in pathname with query params
    expect(isImageUrl('https://example.com/photo.jpg?w=100')).toBe(true)
  })

  it('handles case insensitively', () => {
    expect(isImageUrl('https://example.com/PHOTO.JPG')).toBe(true)
    expect(isImageUrl('https://example.com/Photo.PNG')).toBe(true)
  })
})

// ============================================================================
// getHeroImageField
// ============================================================================

describe('getHeroImageField', () => {
  it('returns the first image URL field', () => {
    const item = {
      name: 'Alice',
      avatar: 'https://example.com/alice.jpg',
      email: 'alice@test.com',
    }
    const fields: Array<[string, { type: { kind: string } }]> = [
      ['name', { type: { kind: 'primitive' } }],
      ['avatar', { type: { kind: 'primitive' } }],
      ['email', { type: { kind: 'primitive' } }],
    ]

    const result = getHeroImageField(item, fields as any)

    expect(result).not.toBeNull()
    expect(result?.fieldName).toBe('avatar')
    expect(result?.url).toBe('https://example.com/alice.jpg')
  })

  it('returns null when no image URL fields', () => {
    const item = { name: 'Alice', email: 'alice@test.com' }
    const fields: Array<[string, { type: { kind: string } }]> = [
      ['name', { type: { kind: 'primitive' } }],
      ['email', { type: { kind: 'primitive' } }],
    ]

    expect(getHeroImageField(item, fields as any)).toBeNull()
  })
})

// ============================================================================
// isEmail
// ============================================================================

describe('isEmail', () => {
  it('returns true for valid emails', () => {
    expect(isEmail('user@example.com')).toBe(true)
    expect(isEmail('a.b@c.co')).toBe(true)
  })

  it('returns false for invalid emails', () => {
    expect(isEmail('not-an-email')).toBe(false)
    expect(isEmail('@missing.local')).toBe(false)
    expect(isEmail('missing@')).toBe(false)
  })
})

// ============================================================================
// isColorValue
// ============================================================================

describe('isColorValue', () => {
  it('detects hex colors', () => {
    expect(isColorValue('#fff')).toBe(true)
    expect(isColorValue('#FF0000')).toBe(true)
  })

  it('detects rgb colors', () => {
    expect(isColorValue('rgb(255, 0, 0)')).toBe(true)
  })

  it('detects hsl colors', () => {
    expect(isColorValue('hsl(120, 50%, 50%)')).toBe(true)
  })

  it('rejects non-colors', () => {
    expect(isColorValue('red')).toBe(false)
    expect(isColorValue('#gg0000')).toBe(false)
  })
})

// ============================================================================
// isRatingField
// ============================================================================

describe('isRatingField', () => {
  it('returns true for rating field with 0-5 value', () => {
    expect(isRatingField('rating', 4.5)).toBe(true)
    expect(isRatingField('score', 0)).toBe(true)
    expect(isRatingField('stars', 5)).toBe(true)
  })

  it('returns false for non-matching field names', () => {
    expect(isRatingField('price', 4.5)).toBe(false)
  })

  it('returns false for out-of-range values', () => {
    expect(isRatingField('rating', -1)).toBe(false)
    expect(isRatingField('rating', 6)).toBe(false)
  })
})

// ============================================================================
// isCurrencyField
// ============================================================================

describe('isCurrencyField', () => {
  it('returns true for currency field names', () => {
    expect(isCurrencyField('price')).toBe(true)
    expect(isCurrencyField('cost')).toBe(true)
    expect(isCurrencyField('amount')).toBe(true)
    expect(isCurrencyField('subtotal')).toBe(true)
  })

  it('returns false for non-currency names', () => {
    expect(isCurrencyField('name')).toBe(false)
    // "total" alone is ambiguous (pagination count vs monetary total)
    expect(isCurrencyField('total')).toBe(false)
  })
})

// ============================================================================
// isCodeField
// ============================================================================

describe('isCodeField', () => {
  it('returns true for identifier field names', () => {
    expect(isCodeField('id')).toBe(true)
    expect(isCodeField('hash')).toBe(true)
    expect(isCodeField('token')).toBe(true)
    expect(isCodeField('uuid')).toBe(true)
    expect(isCodeField('sku')).toBe(true)
  })

  it('returns false for non-code names', () => {
    expect(isCodeField('name')).toBe(false)
    expect(isCodeField('description')).toBe(false)
  })
})

// ============================================================================
// detectPrimitiveMode
// ============================================================================

describe('detectPrimitiveMode', () => {
  it('returns rating for rating number fields', () => {
    expect(detectPrimitiveMode(4.5, 'rating')).toBe('rating')
  })

  it('returns currency for currency number fields', () => {
    expect(detectPrimitiveMode(29.99, 'price')).toBe('currency')
  })

  it('returns email for email string values', () => {
    expect(detectPrimitiveMode('user@example.com', 'email')).toBe('email')
  })

  it('returns color for color string values', () => {
    expect(detectPrimitiveMode('#ff0000', 'theme_color')).toBe('color')
  })

  it('returns code for code field names', () => {
    expect(detectPrimitiveMode('abc123', 'id')).toBe('code')
  })

  it('returns null when no special mode detected', () => {
    expect(detectPrimitiveMode('hello', 'name')).toBeNull()
    expect(detectPrimitiveMode(42, 'count')).toBeNull()
    expect(detectPrimitiveMode(true, 'active')).toBeNull()
  })
})
