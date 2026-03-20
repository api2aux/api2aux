/**
 * Component selection — stubs for Phase 1; real logic moved in Phase 2.
 */
import type { TypeSignature } from '@api2aux/semantic-analysis'
import type { ComponentSelection, SelectionContext } from './types'
import { ComponentType } from '../types'

export function selectComponent(
  _schema: TypeSignature,
  _context: SelectionContext,
): ComponentSelection {
  return { componentType: ComponentType.Table, confidence: 0, reason: 'stub' }
}

export function selectObjectComponent(
  _schema: TypeSignature,
  _context: SelectionContext,
): ComponentSelection {
  return { componentType: ComponentType.Detail, confidence: 0, reason: 'stub' }
}

export function selectPrimitiveArrayComponent(
  _schema: TypeSignature,
  _data: unknown,
  _context: SelectionContext,
): ComponentSelection {
  return { componentType: ComponentType.PrimitiveList, confidence: 0, reason: 'stub' }
}

export function getDefaultTypeName(schema: TypeSignature): string {
  if (schema.kind === 'array' && schema.items.kind === 'object') return ComponentType.Table
  if (schema.kind === 'array' && schema.items.kind === 'primitive') return ComponentType.PrimitiveList
  if (schema.kind === 'object') return ComponentType.Detail
  if (schema.kind === 'primitive') return ComponentType.Primitive
  return ComponentType.Json
}

export type { ComponentSelection, SelectionContext } from './types'
