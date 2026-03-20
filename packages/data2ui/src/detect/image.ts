import type { FieldDefinition } from '@api2aux/semantic-analysis'

/** Get the first image URL field from an object item for hero/gallery display */
export function getHeroImageField(
  item: Record<string, unknown>,
  fields: Array<[string, FieldDefinition]>
): { fieldName: string; url: string } | null {
  for (const [fieldName, fieldDef] of fields) {
    if (fieldDef.type.kind === 'primitive') {
      const value = item[fieldName]
      if (typeof value === 'string' && isImageUrl(value)) {
        return { fieldName, url: value }
      }
    }
  }
  return null
}

/**
 * Detects if a string value is a URL pointing to an image file.
 * Uses pathname-based extension checking to avoid false positives from query params.
 */
export function isImageUrl(value: unknown): boolean {
  // Return false for falsy values, non-strings, or non-HTTP(S) URLs
  if (!value || typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return false
  }

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']

  try {
    // Parse URL and check pathname for image extension
    const url = new URL(value)
    const pathname = url.pathname.toLowerCase()
    return imageExtensions.some(ext => pathname.endsWith(ext))
  } catch (_urlParseError: unknown) {
    // new URL() failed despite the string matching ^https?://.
    // Fall back to simple string splitting — acceptable for a non-throwing detection utility.
    const beforeQuery = value.split('?')[0]?.toLowerCase() ?? ''
    return imageExtensions.some(ext => beforeQuery.endsWith(ext))
  }
}
