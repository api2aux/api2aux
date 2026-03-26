/**
 * Smart component selection service.
 * Moved from app/src/services/selection/ — same algorithm, streamlined JSDoc.
 */

import type { TypeSignature } from '@api2aux/semantic-analysis'
import type { ComponentSelection, SelectionContext } from './types'
import { ComponentType, SelectionReason } from '../types'

/** Minimum confidence for a heuristic to override the type-based default */
export const SMART_DEFAULT_THRESHOLD = 0.75
import {
  checkReviewPattern,
  checkImageGalleryPattern,
  checkTimelinePattern,
  selectCardOrTable,
  checkProfilePattern,
  checkComplexObjectPattern,
  checkSplitPattern,
  checkChipsPattern,
  checkImageGridPattern,
} from './heuristics'
import { matchUIHint } from './hint-matcher'

/**
 * Select the most appropriate component type for rendering array data.
 * Only returns smart default when confidence >= SMART_DEFAULT_THRESHOLD.
 */
export function selectComponent(
  schema: TypeSignature,
  context: SelectionContext,
  path?: string,
): ComponentSelection {
  if (schema.kind !== 'array' || schema.items.kind !== 'object') {
    return {
      componentType: getDefaultTypeName(schema),
      confidence: 0,
      reason: SelectionReason.NotApplicable,
    }
  }

  // Check plugin UI hints before heuristics
  if (path) {
    const hintMatch = matchUIHint(path, context.uiHints)
    if (hintMatch) return hintMatch
  }

  const heuristics = [
    checkReviewPattern,
    checkImageGalleryPattern,
    checkTimelinePattern,
    selectCardOrTable,
  ]

  for (const heuristic of heuristics) {
    const result = heuristic(schema, context)
    if (result && result.confidence >= SMART_DEFAULT_THRESHOLD) {
      return result
    }
  }

  return {
    componentType: ComponentType.Table,
    confidence: 0,
    reason: SelectionReason.FallbackToDefault,
  }
}

/**
 * Select the most appropriate component type for rendering an object.
 * Only returns smart default when confidence >= SMART_DEFAULT_THRESHOLD.
 */
export function selectObjectComponent(
  schema: TypeSignature,
  context: SelectionContext,
  path?: string,
): ComponentSelection {
  if (schema.kind !== 'object') {
    return {
      componentType: ComponentType.Detail,
      confidence: 0,
      reason: SelectionReason.FallbackToDefault,
    }
  }

  // Check plugin UI hints before heuristics
  if (path) {
    const hintMatch = matchUIHint(path, context.uiHints)
    if (hintMatch) return hintMatch
  }

  const heuristics = [
    checkProfilePattern,
    checkComplexObjectPattern,
    checkSplitPattern,
  ]

  for (const heuristic of heuristics) {
    const result = heuristic(schema, context)
    if (result && result.confidence >= SMART_DEFAULT_THRESHOLD) {
      return result
    }
  }

  return {
    componentType: ComponentType.Detail,
    confidence: 0,
    reason: SelectionReason.FallbackToDefault,
  }
}

/**
 * Select the most appropriate component type for rendering a primitive array.
 * Only returns smart default when confidence >= SMART_DEFAULT_THRESHOLD.
 */
export function selectPrimitiveArrayComponent(
  schema: TypeSignature,
  data: unknown,
  context: SelectionContext,
  path?: string,
): ComponentSelection {
  if (schema.kind !== 'array' || schema.items.kind !== 'primitive') {
    return {
      componentType: ComponentType.PrimitiveList,
      confidence: 0,
      reason: SelectionReason.FallbackToDefault,
    }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      componentType: ComponentType.PrimitiveList,
      confidence: 0,
      reason: SelectionReason.NoData,
    }
  }

  // Check plugin UI hints before heuristics
  if (path) {
    const hintMatch = matchUIHint(path, context.uiHints)
    if (hintMatch) return hintMatch
  }

  const gridResult = checkImageGridPattern(data, schema)
  if (gridResult && gridResult.confidence >= SMART_DEFAULT_THRESHOLD) {
    return gridResult
  }

  const result = checkChipsPattern(data, schema, context)
  if (result && result.confidence >= SMART_DEFAULT_THRESHOLD) {
    return result
  }

  return {
    componentType: ComponentType.PrimitiveList,
    confidence: 0,
    reason: SelectionReason.FallbackToDefault,
  }
}

/**
 * Get default component type name based on schema structure.
 */
export function getDefaultTypeName(schema: TypeSignature): string {
  if (schema.kind === 'array' && schema.items.kind === 'object') return ComponentType.Table
  if (schema.kind === 'array' && schema.items.kind === 'primitive') return ComponentType.PrimitiveList
  if (schema.kind === 'object') return ComponentType.Detail
  if (schema.kind === 'primitive') return ComponentType.Primitive
  return ComponentType.Json
}

export type { ComponentSelection, SelectionContext } from './types'
