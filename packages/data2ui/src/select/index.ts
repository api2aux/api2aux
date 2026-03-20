/**
 * Smart component selection service.
 * Moved from app/src/services/selection/ — logic preserved verbatim.
 */

import type { TypeSignature } from '@api2aux/semantic-analysis'
import type { ComponentSelection, SelectionContext } from './types'
import { ComponentType, SelectionReason } from '../types'
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

/**
 * Select the most appropriate component type for rendering array data.
 * Only returns smart default when confidence >= 0.75.
 */
export function selectComponent(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection {
  if (schema.kind !== 'array' || schema.items.kind !== 'object') {
    return {
      componentType: getDefaultTypeName(schema),
      confidence: 0,
      reason: SelectionReason.NotApplicable,
    }
  }

  const heuristics = [
    checkReviewPattern,
    checkImageGalleryPattern,
    checkTimelinePattern,
    selectCardOrTable,
  ]

  for (const heuristic of heuristics) {
    const result = heuristic(schema, context)
    if (result && result.confidence >= 0.75) {
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
 * Only returns smart default when confidence >= 0.75.
 */
export function selectObjectComponent(
  schema: TypeSignature,
  context: SelectionContext
): ComponentSelection {
  if (schema.kind !== 'object') {
    return {
      componentType: ComponentType.Detail,
      confidence: 0,
      reason: SelectionReason.FallbackToDefault,
    }
  }

  const heuristics = [
    checkProfilePattern,
    checkComplexObjectPattern,
    checkSplitPattern,
  ]

  for (const heuristic of heuristics) {
    const result = heuristic(schema, context)
    if (result && result.confidence >= 0.75) {
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
 * Only returns smart default when confidence >= 0.75.
 */
export function selectPrimitiveArrayComponent(
  schema: TypeSignature,
  data: unknown,
  context: SelectionContext
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

  const gridResult = checkImageGridPattern(data, schema)
  if (gridResult && gridResult.confidence >= 0.75) {
    return gridResult
  }

  const result = checkChipsPattern(data, schema, context)
  if (result && result.confidence >= 0.75) {
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
