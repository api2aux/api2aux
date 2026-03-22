import { describe, it, expect } from 'vitest'
import { inferParameterType, type InferredType, type UrlConfidenceLevel } from './typeInferrer'

describe('inferParameterType', () => {
  describe('boolean detection', () => {
    it('detects "true" as boolean with HIGH confidence', () => {
      const result = inferParameterType('status', 'true')
      expect(result.type).toBe('boolean')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects "false" as boolean with HIGH confidence', () => {
      const result = inferParameterType('enabled', 'false')
      expect(result.type).toBe('boolean')
      expect(result.confidence).toBe('HIGH')
    })

    it('does not detect "yes" as boolean', () => {
      const result = inferParameterType('status', 'yes')
      expect(result.type).toBe('string')
    })

    it('does not detect "no" as boolean', () => {
      const result = inferParameterType('status', 'no')
      expect(result.type).toBe('string')
    })

    it('does not detect "1" as boolean', () => {
      const result = inferParameterType('flag', '1')
      expect(result.type).toBe('number')
    })

    it('does not detect "0" as boolean', () => {
      const result = inferParameterType('flag', '0')
      expect(result.type).toBe('number')
    })

    it('is case-sensitive - "True" is string', () => {
      const result = inferParameterType('status', 'True')
      expect(result.type).toBe('string')
    })

    it('is case-sensitive - "FALSE" is string', () => {
      const result = inferParameterType('status', 'FALSE')
      expect(result.type).toBe('string')
    })
  })

  describe('number detection', () => {
    it('detects integer with HIGH confidence', () => {
      const result = inferParameterType('count', '42')
      expect(result.type).toBe('number')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects zero', () => {
      const result = inferParameterType('count', '0')
      expect(result.type).toBe('number')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects negative integer', () => {
      const result = inferParameterType('offset', '-10')
      expect(result.type).toBe('number')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects decimal', () => {
      const result = inferParameterType('price', '19.99')
      expect(result.type).toBe('number')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects negative decimal', () => {
      const result = inferParameterType('temperature', '-3.5')
      expect(result.type).toBe('number')
      expect(result.confidence).toBe('HIGH')
    })

    it('does not detect number with leading zeros as number (could be ID)', () => {
      const result = inferParameterType('id', '007')
      // Leading zeros suggest string (like zip code or ID)
      expect(result.type).toBe('string')
    })

    it('does not detect scientific notation', () => {
      const result = inferParameterType('value', '1e10')
      expect(result.type).toBe('string')
    })

    it('does not detect number with spaces', () => {
      const result = inferParameterType('value', ' 42 ')
      expect(result.type).toBe('string')
    })
  })

  describe('date detection', () => {
    it('detects ISO date with name hint as HIGH confidence', () => {
      const result = inferParameterType('startDate', '2024-01-15')
      expect(result.type).toBe('date')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects ISO date without name hint as MEDIUM confidence', () => {
      const result = inferParameterType('foo', '2024-01-15')
      expect(result.type).toBe('date')
      expect(result.confidence).toBe('MEDIUM')
    })

    it('detects ISO datetime', () => {
      const result = inferParameterType('createdAt', '2024-01-15T10:30:00Z')
      expect(result.type).toBe('date')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects ISO datetime with milliseconds', () => {
      const result = inferParameterType('timestamp', '2024-01-15T10:30:00.123Z')
      expect(result.type).toBe('date')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects ISO datetime with timezone offset', () => {
      const result = inferParameterType('updated', '2024-01-15T10:30:00+05:30')
      expect(result.type).toBe('date')
      expect(result.confidence).toBe('HIGH')
    })

    it('boosts confidence with "date" in name', () => {
      const result = inferParameterType('expireDate', '2024-01-15')
      expect(result.confidence).toBe('HIGH')
    })

    it('boosts confidence with "time" in name', () => {
      const result = inferParameterType('endTime', '2024-01-15T23:59:59Z')
      expect(result.confidence).toBe('HIGH')
    })

    it('boosts confidence with "created" in name', () => {
      const result = inferParameterType('created', '2024-01-15')
      expect(result.confidence).toBe('HIGH')
    })

    it('boosts confidence with "updated" in name', () => {
      const result = inferParameterType('updatedAt', '2024-01-15')
      expect(result.confidence).toBe('HIGH')
    })

    it('rejects invalid date format', () => {
      const result = inferParameterType('date', '2024/01/15')
      expect(result.type).toBe('string')
    })

    it('rejects invalid month', () => {
      const result = inferParameterType('date', '2024-13-01')
      expect(result.type).toBe('string')
    })

    it('rejects invalid day', () => {
      const result = inferParameterType('date', '2024-01-32')
      expect(result.type).toBe('string')
    })

    it('rejects year before 1970', () => {
      const result = inferParameterType('date', '1969-12-31')
      expect(result.type).toBe('string')
    })

    it('rejects year after 2100', () => {
      const result = inferParameterType('date', '2101-01-01')
      expect(result.type).toBe('string')
    })

    it('accepts year 1970', () => {
      const result = inferParameterType('date', '1970-01-01')
      expect(result.type).toBe('date')
    })

    it('accepts year 2100', () => {
      const result = inferParameterType('date', '2100-12-31')
      expect(result.type).toBe('date')
    })
  })

  describe('email detection', () => {
    it('detects email with name hint as HIGH confidence', () => {
      const result = inferParameterType('email', 'user@example.com')
      expect(result.type).toBe('email')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects email without name hint as MEDIUM confidence', () => {
      const result = inferParameterType('contact', 'user@example.com')
      expect(result.type).toBe('email')
      expect(result.confidence).toBe('MEDIUM')
    })

    it('detects email with "mail" in name', () => {
      const result = inferParameterType('userMail', 'user@example.com')
      expect(result.confidence).toBe('HIGH')
    })

    it('handles email with subdomain', () => {
      const result = inferParameterType('email', 'user@mail.example.com')
      expect(result.type).toBe('email')
    })

    it('handles email with plus sign', () => {
      const result = inferParameterType('email', 'user+tag@example.com')
      expect(result.type).toBe('email')
    })

    it('handles email with dots in local part', () => {
      const result = inferParameterType('email', 'first.last@example.com')
      expect(result.type).toBe('email')
    })

    it('rejects email without @', () => {
      const result = inferParameterType('email', 'notanemail')
      expect(result.type).toBe('string')
    })

    it('rejects email without domain', () => {
      const result = inferParameterType('email', 'user@')
      expect(result.type).toBe('string')
    })

    it('rejects email without local part', () => {
      const result = inferParameterType('email', '@example.com')
      expect(result.type).toBe('string')
    })

    it('rejects email with short TLD', () => {
      const result = inferParameterType('email', 'user@example.c')
      expect(result.type).toBe('string')
    })

    it('rejects email with spaces', () => {
      const result = inferParameterType('email', 'user @example.com')
      expect(result.type).toBe('string')
    })
  })

  describe('URL detection', () => {
    it('detects https URL with HIGH confidence', () => {
      const result = inferParameterType('website', 'https://example.com')
      expect(result.type).toBe('url')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects http URL with HIGH confidence', () => {
      const result = inferParameterType('link', 'http://example.com')
      expect(result.type).toBe('url')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects URL with path', () => {
      const result = inferParameterType('callback', 'https://example.com/api/callback')
      expect(result.type).toBe('url')
    })

    it('detects URL with query string', () => {
      const result = inferParameterType('redirect', 'https://example.com?foo=bar')
      expect(result.type).toBe('url')
    })

    it('detects URL with port', () => {
      const result = inferParameterType('api', 'http://localhost:3000')
      expect(result.type).toBe('url')
    })

    it('does not detect ftp URLs', () => {
      const result = inferParameterType('link', 'ftp://files.example.com')
      expect(result.type).toBe('string')
    })

    it('does not detect URLs without protocol', () => {
      const result = inferParameterType('link', 'example.com')
      expect(result.type).toBe('string')
    })

    it('does not detect URLs with // only', () => {
      const result = inferParameterType('link', '//example.com')
      expect(result.type).toBe('string')
    })
  })

  describe('coordinates detection', () => {
    it('detects coordinates with name hint as HIGH confidence', () => {
      const result = inferParameterType('location', '40.7128,-74.0060')
      expect(result.type).toBe('coordinates')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects coordinates with "coord" in name', () => {
      const result = inferParameterType('geoCoord', '40.7128,-74.0060')
      expect(result.type).toBe('coordinates')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects coordinates with "lat" in name', () => {
      const result = inferParameterType('latLng', '40.7128,-74.0060')
      expect(result.type).toBe('coordinates')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects coordinates with "lng" in name', () => {
      const result = inferParameterType('lngLat', '40.7128,-74.0060')
      expect(result.type).toBe('coordinates')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects coordinates with "position" in name', () => {
      const result = inferParameterType('position', '40.7128,-74.0060')
      expect(result.type).toBe('coordinates')
      expect(result.confidence).toBe('HIGH')
    })

    it('falls back to string without name hint', () => {
      const result = inferParameterType('foo', '40.7128,-74.0060')
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })

    it('validates latitude range (-90 to 90)', () => {
      const result = inferParameterType('location', '91.0,-74.0060')
      expect(result.type).toBe('string')
    })

    it('validates latitude range (negative)', () => {
      const result = inferParameterType('location', '-91.0,-74.0060')
      expect(result.type).toBe('string')
    })

    it('validates longitude range (-180 to 180)', () => {
      const result = inferParameterType('location', '40.7128,181.0')
      expect(result.type).toBe('string')
    })

    it('validates longitude range (negative)', () => {
      const result = inferParameterType('location', '40.7128,-181.0')
      expect(result.type).toBe('string')
    })

    it('accepts edge case: north pole', () => {
      const result = inferParameterType('location', '90.0,0.0')
      expect(result.type).toBe('coordinates')
    })

    it('accepts edge case: south pole', () => {
      const result = inferParameterType('location', '-90.0,0.0')
      expect(result.type).toBe('coordinates')
    })

    it('accepts edge case: date line', () => {
      const result = inferParameterType('location', '0.0,180.0')
      expect(result.type).toBe('coordinates')
    })

    it('handles coordinates with spaces', () => {
      const result = inferParameterType('location', '40.7128, -74.0060')
      expect(result.type).toBe('coordinates')
    })
  })

  describe('ZIP code detection', () => {
    it('detects 5-digit ZIP with name hint as HIGH confidence', () => {
      const result = inferParameterType('zipCode', '10001')
      expect(result.type).toBe('zip')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects ZIP+4 with name hint', () => {
      const result = inferParameterType('zip', '10001-1234')
      expect(result.type).toBe('zip')
      expect(result.confidence).toBe('HIGH')
    })

    it('detects ZIP with "postal" in name', () => {
      const result = inferParameterType('postalCode', '10001')
      expect(result.type).toBe('zip')
      expect(result.confidence).toBe('HIGH')
    })

    it('falls back to string without name hint', () => {
      const result = inferParameterType('id', '10001')
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })

    it('falls back to string for generic "code" name', () => {
      // "code" alone is too generic, need zip/postal specifically
      const result = inferParameterType('code', '10001')
      expect(result.type).toBe('string')
    })

    it('rejects ZIP with wrong digit count', () => {
      const result = inferParameterType('zip', '1234')
      expect(result.type).toBe('string')
    })

    it('rejects ZIP with too many digits', () => {
      const result = inferParameterType('zip', '123456')
      expect(result.type).toBe('string')
    })

    it('rejects ZIP+4 with wrong format', () => {
      const result = inferParameterType('zip', '10001-12')
      expect(result.type).toBe('string')
    })
  })

  describe('version detection suppression', () => {
    it('treats "version" param with decimal value as string, not number', () => {
      const result = inferParameterType('version', '2.1')
      expect(result.type).toBe('string')
    })

    it('treats "ver" param with decimal value as string', () => {
      const result = inferParameterType('ver', '3.0')
      expect(result.type).toBe('string')
    })

    it('treats "api_version" param as string', () => {
      const result = inferParameterType('api_version', '1.5')
      expect(result.type).toBe('string')
    })

    it('treats "apiVersion" param as string', () => {
      const result = inferParameterType('apiVersion', '2')
      expect(result.type).toBe('string')
    })
  })

  describe('string fallback', () => {
    it('returns string for unknown patterns with HIGH confidence', () => {
      const result = inferParameterType('foo', 'bar')
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })

    it('returns string for undefined value', () => {
      const result = inferParameterType('foo', undefined)
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })

    it('returns string for empty string', () => {
      const result = inferParameterType('foo', '')
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })

    it('returns string for whitespace only', () => {
      const result = inferParameterType('foo', '   ')
      expect(result.type).toBe('string')
      expect(result.confidence).toBe('HIGH')
    })
  })

  describe('reasons array', () => {
    it('includes reason for boolean detection', () => {
      const result = inferParameterType('status', 'true')
      expect(result.reasons).toBeDefined()
      expect(result.reasons.length).toBeGreaterThan(0)
    })

    it('includes reason for number detection', () => {
      const result = inferParameterType('count', '42')
      expect(result.reasons.length).toBeGreaterThan(0)
    })

    it('includes reason for string fallback', () => {
      const result = inferParameterType('foo', 'bar')
      expect(result.reasons.length).toBeGreaterThan(0)
    })
  })

  describe('type detection order', () => {
    // Verify that boolean is checked before number
    it('prioritizes boolean over number for "true"', () => {
      const result = inferParameterType('value', 'true')
      expect(result.type).toBe('boolean')
    })

    // URL should be checked before email (url@example.com could be confused)
    it('prioritizes detection order correctly', () => {
      // "https://user@example.com" is a valid URL with auth, not an email
      const result = inferParameterType('link', 'https://user@example.com')
      expect(result.type).toBe('url')
    })
  })
})
