/**
 * Heuristic functions for pattern-based component selection.
 * Each heuristic returns null or a ComponentSelection with confidence score.
 *
 * Moved from app/src/services/selection/heuristics.ts — logic preserved verbatim.
 */

import type { TypeSignature, FieldDefinition } from '@api2aux/semantic-analysis'
import type { ComponentSelection, SelectionContext } from './types'
import { isImageUrl } from '../detect/image'
import { ComponentType, SelectionReason } from '../types'

/**
 * Helper to extract field entries from array-of-objects schema.
 */
function getArrayItemFields(schema: TypeSignature): Array<[string, TypeSignature]> | null {
  if (schema.kind !== 'array') return null
  if (schema.items.kind !== 'object') return null
  return Array.from(schema.items.fields.entries()).map(([name, def]) => [name, def.type])
}

/**
 * Helper to extract field entries from object schema.
 */
function getObjectFields(schema: TypeSignature): Array<[string, FieldDefinition]> | null {
  if (schema.kind !== 'object') return null
  return Array.from(schema.fields.entries())
}

/**
 * Detects review pattern: rating + comment/review fields.
 */
export function checkReviewPattern(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  const fields = getArrayItemFields(schema)
  if (!fields) return null

  const hasRating = Array.from(context.semantics.values()).some(
    semantic => semantic.detectedCategory === 'rating'
  )

  const hasReview = fields.some(([name]) => {
    const hasDescSemantic = Array.from(context.semantics.values()).some(
      semantic => semantic.detectedCategory === 'reviews' || semantic.detectedCategory === 'description'
    )

    const importanceEntry = Array.from(context.importance.entries()).find(([path]) =>
      path.endsWith(`].${name}`)
    )
    const tier = importanceEntry?.[1]?.tier

    return (
      (hasDescSemantic || /comment|review|text|body/i.test(name)) &&
      (tier === 'primary' || tier === 'secondary' || !importanceEntry)
    )
  })

  if (hasRating && hasReview) {
    return {
      componentType: ComponentType.CardList,
      confidence: 0.85,
      reason: SelectionReason.ReviewPattern,
    }
  }

  return null
}

/**
 * Detects image-heavy arrays.
 */
export function checkImageGalleryPattern(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  const fields = getArrayItemFields(schema)
  if (!fields) return null

  const imageCategories = new Set(['image', 'thumbnail', 'avatar'])
  const imageFieldCount = Array.from(context.semantics.values()).filter(
    semantic => imageCategories.has(semantic.detectedCategory ?? '')
  ).length

  if (imageFieldCount === 0) return null

  if (fields.length <= 4) {
    return {
      componentType: ComponentType.Gallery,
      confidence: 0.9,
      reason: SelectionReason.ImageGallery,
    }
  }

  return {
    componentType: ComponentType.CardList,
    confidence: 0.75,
    reason: SelectionReason.ImageGallery,
  }
}

/**
 * Detects event-like arrays (timeline pattern).
 */
export function checkTimelinePattern(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  const fields = getArrayItemFields(schema)
  if (!fields) return null

  const dateCategories = new Set(['date', 'timestamp'])
  const hasDate = Array.from(context.semantics.values()).some(
    semantic => dateCategories.has(semantic.detectedCategory ?? '')
  )

  const narrativeCategories = new Set(['title', 'description'])
  const hasNarrative = Array.from(context.semantics.values()).some(
    semantic => narrativeCategories.has(semantic.detectedCategory ?? '')
  )

  if (hasDate && hasNarrative) {
    return {
      componentType: ComponentType.Timeline,
      confidence: 0.8,
      reason: SelectionReason.TimelinePattern,
    }
  }

  return null
}

/**
 * Default card vs table heuristic based on content richness and field count.
 */
export function selectCardOrTable(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection {
  const fields = getArrayItemFields(schema)
  if (!fields) {
    return {
      componentType: ComponentType.Table,
      confidence: 0.5,
      reason: SelectionReason.FallbackToDefault,
    }
  }

  let visibleFieldCount = 0
  for (const [name] of fields) {
    const importanceEntry = Array.from(context.importance.entries()).find(([path]) =>
      path.endsWith(`].${name}`)
    )
    const tier = importanceEntry?.[1]?.tier

    if (tier === 'primary' || tier === 'secondary') {
      visibleFieldCount++
    }
  }

  const richCategories = new Set(['description', 'reviews', 'image', 'title'])
  const hasRichContent = Array.from(context.semantics.values()).some(
    semantic => richCategories.has(semantic.detectedCategory ?? '')
  )

  if (hasRichContent && visibleFieldCount <= 8) {
    return {
      componentType: ComponentType.CardList,
      confidence: 0.75,
      reason: SelectionReason.CardHeuristic,
    }
  }

  if (visibleFieldCount >= 10) {
    return {
      componentType: ComponentType.Table,
      confidence: 0.8,
      reason: SelectionReason.CardHeuristic,
    }
  }

  return {
    componentType: ComponentType.Table,
    confidence: 0.5,
    reason: SelectionReason.FallbackToDefault,
  }
}

/**
 * Detects profile/person pattern: name field + 2+ contact fields.
 */
export function checkProfilePattern(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  const fields = getObjectFields(schema)
  if (!fields) return null

  const hasName = fields.some(([fieldName]) => {
    const semanticPath = `$.${fieldName}`
    const semantic = context.semantics.get(semanticPath)
    if (semantic?.detectedCategory === 'name') return true
    return /^(name|title|full_?name)$/i.test(fieldName)
  })

  if (!hasName) return null

  const contactCategories = new Set(['email', 'phone', 'address', 'url'])
  const contactNameRegex = /^(email|e_?mail|phone|tel|telephone|mobile|cell|address|website|url|homepage|web)\b/i
  let contactCount = 0

  for (const [fieldName] of fields) {
    const semanticPath = `$.${fieldName}`
    const semantic = context.semantics.get(semanticPath)
    if (semantic && contactCategories.has(semantic.detectedCategory ?? '')) {
      contactCount++
    } else if (contactNameRegex.test(fieldName)) {
      contactCount++
    }
  }

  if (contactCount >= 2) {
    return {
      componentType: ComponentType.Hero,
      confidence: 0.85,
      reason: SelectionReason.ProfilePattern,
    }
  }

  return null
}

/**
 * Detects complex nested objects with 3+ nested structures.
 */
export function checkComplexObjectPattern(
  schema: TypeSignature,
  _context: SelectionContext
): ComponentSelection | null {
  const fields = getObjectFields(schema)
  if (!fields) return null

  let nestedCount = 0

  for (const [, fieldDef] of fields) {
    const fieldType = fieldDef.type
    if (fieldType.kind === 'object' || fieldType.kind === 'array') {
      nestedCount++
    }
  }

  if (nestedCount >= 3) {
    return {
      componentType: ComponentType.Tabs,
      confidence: 0.8,
      reason: SelectionReason.ComplexObject,
    }
  }

  return null
}

/**
 * Detects content + metadata split pattern.
 */
export function checkSplitPattern(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  const fields = getObjectFields(schema)
  if (!fields) return null

  if (fields.length < 5) return null

  const contentNameRegex = /^(description|content|body|summary|text)$/i
  const metadataNameRegex = /^(id|created|updated|timestamp|_)/

  let primaryContentCount = 0
  let metadataCount = 0

  for (const [fieldName] of fields) {
    const semanticPath = `$.${fieldName}`
    const semantic = context.semantics.get(semanticPath)
    const importance = context.importance.get(semanticPath)

    const isDescriptionSemantic = semantic?.detectedCategory === 'description'
    const isContentName = contentNameRegex.test(fieldName)
    const isPrimaryTier = importance?.tier === 'primary'

    if (isPrimaryTier && (isDescriptionSemantic || isContentName)) {
      primaryContentCount++
    }

    const isTertiaryTier = importance?.tier === 'tertiary'
    const isMetadataName = metadataNameRegex.test(fieldName)

    if (isTertiaryTier || isMetadataName) {
      metadataCount++
    }
  }

  if (primaryContentCount === 1 && metadataCount >= 3) {
    return {
      componentType: ComponentType.Split,
      confidence: 0.75,
      reason: SelectionReason.SplitPattern,
    }
  }

  return null
}

/**
 * Detects chips pattern for primitive string arrays.
 */
export function checkChipsPattern(
  data: unknown,
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection | null {
  if (schema.kind !== 'array') return null
  if (schema.items.kind !== 'primitive') return null
  if (schema.items.type !== 'string') return null

  const hasTagsOrStatus = Array.from(context.semantics.values()).some(
    semantic => semantic.detectedCategory === 'tags' || semantic.detectedCategory === 'status'
  )

  if (hasTagsOrStatus) {
    return {
      componentType: ComponentType.Chips,
      confidence: 0.9,
      reason: SelectionReason.ChipsPattern,
    }
  }

  if (!Array.isArray(data) || data.length === 0) return null
  if (data.length > 10) return null

  let totalLength = 0
  let maxLength = 0

  for (const item of data) {
    if (typeof item !== 'string') return null
    totalLength += item.length
    maxLength = Math.max(maxLength, item.length)
  }

  const avgLength = totalLength / data.length

  if (avgLength <= 20 && maxLength <= 30) {
    return {
      componentType: ComponentType.Chips,
      confidence: 0.8,
      reason: SelectionReason.ChipsPattern,
    }
  }

  return null
}

/**
 * Detects primitive arrays of image URLs for grid display.
 */
export function checkImageGridPattern(
  data: unknown,
  schema: TypeSignature
): ComponentSelection | null {
  if (schema.kind !== 'array') return null
  if (schema.items.kind !== 'primitive') return null
  if (schema.items.type !== 'string') return null

  if (!Array.isArray(data) || data.length === 0) return null

  let imageCount = 0
  for (const item of data) {
    if (typeof item === 'string' && isImageUrl(item)) {
      imageCount++
    }
  }

  if (imageCount / data.length >= 0.5) {
    return {
      componentType: ComponentType.Grid,
      confidence: 0.85,
      reason: SelectionReason.ImageGrid,
    }
  }

  return null
}
