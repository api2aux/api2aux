/**
 * Hook to run the semantic analysis pipeline when schema/data changes.
 * Populates the analysis cache with semantics, importance, and selection results.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { detectSemantics, getBestMatch } from '../services/semantic'
import { analyzeFields } from '../services/analysis'
import { selectComponent, selectObjectComponent, selectPrimitiveArrayComponent } from '@api2aux/data2ui'
import type { UnifiedSchema, TypeSignature, SemanticMetadata } from '../types/schema'
import type { FieldInfo } from '../services/analysis/types'
import type { SelectionContext } from '@api2aux/data2ui'

/**
 * Extract sample values from data for a given field path.
 * Handles array data by extracting values from each item.
 */
function extractSampleValues(data: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(data)) return []

  const samples: unknown[] = []
  for (const item of data.slice(0, 10)) { // Sample first 10 items
    if (item && typeof item === 'object' && fieldName in item) {
      samples.push((item as Record<string, unknown>)[fieldName])
    }
  }
  return samples
}

/**
 * Get primitive type string from TypeSignature.
 */
function getPrimitiveType(type: TypeSignature): string {
  if (type.kind === 'primitive') return type.type
  if (type.kind === 'array') return 'array'
  if (type.kind === 'object') return 'object'
  return 'unknown'
}

/**
 * Schema kind discriminator for analysis.
 */
const SchemaKind = {
  ArrayOfObjects: 'array-of-objects',
  Object: 'object',
  PrimitiveArray: 'primitive-array',
} as const
type SchemaKind = typeof SchemaKind[keyof typeof SchemaKind]

/**
 * Walk schema and find all analyzable paths (arrays of objects, objects, primitive arrays).
 * Returns array of { path, schema, data, schemaKind } for each analyzable node.
 */
function findAnalyzablePaths(
  schema: TypeSignature,
  data: unknown,
  basePath: string = '$'
): Array<{ path: string; schema: TypeSignature; data: unknown; schemaKind: SchemaKind }> {
  const results: Array<{ path: string; schema: TypeSignature; data: unknown; schemaKind: SchemaKind }> = []

  // Array of objects
  if (schema.kind === 'array' && schema.items.kind === 'object') {
    results.push({ path: basePath, schema, data, schemaKind: 'array-of-objects' })
  }

  // Primitive arrays (array of primitives)
  if (schema.kind === 'array' && schema.items.kind === 'primitive') {
    results.push({ path: basePath, schema, data, schemaKind: 'primitive-array' })
  }

  // Objects (including root-level objects for single-object APIs like /users/1)
  if (schema.kind === 'object') {
    results.push({ path: basePath, schema, data, schemaKind: 'object' })
  }

  // Recursively check nested objects
  if (schema.kind === 'object') {
    for (const [fieldName, fieldDef] of schema.fields.entries()) {
      const nestedPath = basePath === '$' ? `$.${fieldName}` : `${basePath}.${fieldName}`
      const nestedData = data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)[fieldName]
        : undefined

      results.push(...findAnalyzablePaths(fieldDef.type, nestedData, nestedPath))
    }
  }

  // Check inside arrays
  if (schema.kind === 'array') {
    const itemPath = `${basePath}[]`
    const firstItem = Array.isArray(data) && data.length > 0 ? data[0] : undefined
    results.push(...findAnalyzablePaths(schema.items, firstItem, itemPath))
  }

  return results
}

/**
 * Build FieldInfo array from an array-of-objects schema.
 */
function buildFieldInfos(
  schema: TypeSignature,
  data: unknown,
  basePath: string
): { fieldInfos: FieldInfo[]; semanticsMap: Map<string, SemanticMetadata> } {
  if (schema.kind !== 'array' || schema.items.kind !== 'object') {
    return { fieldInfos: [], semanticsMap: new Map() }
  }

  const fields = schema.items.fields
  const fieldInfos: FieldInfo[] = []
  const semanticsMap = new Map<string, SemanticMetadata>()

  let position = 0
  const totalFields = fields.size

  for (const [fieldName, fieldDef] of fields.entries()) {
    const fieldPath = `${basePath}[].${fieldName}`
    const sampleValues = extractSampleValues(data, fieldName)
    const primitiveType = getPrimitiveType(fieldDef.type)

    // Run semantic detection
    const semanticResults = detectSemantics(fieldPath, fieldName, primitiveType, sampleValues)
    const bestMatch = getBestMatch(semanticResults)

    // Build semantic metadata
    const semanticMetadata: SemanticMetadata = bestMatch
      ? {
          detectedCategory: bestMatch.category,
          confidence: bestMatch.confidence,
          level: bestMatch.level,
          appliedAt: 'smart-default',
          alternatives: semanticResults
            .filter(r => r.category !== bestMatch.category)
            .slice(0, 2)
            .map(r => ({ category: r.category, confidence: r.confidence }))
        }
      : {
          detectedCategory: null,
          confidence: 0,
          level: 'none',
          appliedAt: 'type-based',
          alternatives: []
        }

    semanticsMap.set(fieldPath, semanticMetadata)

    // Build field info for importance analysis
    fieldInfos.push({
      path: fieldPath,
      name: fieldName,
      semanticCategory: bestMatch?.category ?? null,
      sampleValues,
      position,
      totalFields,
    })

    position++
  }

  return { fieldInfos, semanticsMap }
}

/**
 * Build FieldInfo array from an object schema.
 * Similar to buildFieldInfos but for objects (not arrays of objects).
 */
function buildObjectFieldInfos(
  schema: TypeSignature,
  data: unknown,
  basePath: string
): { fieldInfos: FieldInfo[]; semanticsMap: Map<string, SemanticMetadata> } {
  if (schema.kind !== 'object') {
    return { fieldInfos: [], semanticsMap: new Map() }
  }

  const fields = schema.fields
  const fieldInfos: FieldInfo[] = []
  const semanticsMap = new Map<string, SemanticMetadata>()

  let position = 0
  const totalFields = fields.size

  for (const [fieldName, fieldDef] of fields.entries()) {
    const fieldPath = `${basePath}.${fieldName}`

    // Extract sample values from object data (not array)
    const sampleValues = data && typeof data === 'object' && !Array.isArray(data) && fieldName in (data as Record<string, unknown>)
      ? [(data as Record<string, unknown>)[fieldName]]
      : []

    const primitiveType = getPrimitiveType(fieldDef.type)

    // Run semantic detection
    const semanticResults = detectSemantics(fieldPath, fieldName, primitiveType, sampleValues)
    const bestMatch = getBestMatch(semanticResults)

    // Build semantic metadata
    const semanticMetadata: SemanticMetadata = bestMatch
      ? {
          detectedCategory: bestMatch.category,
          confidence: bestMatch.confidence,
          level: bestMatch.level,
          appliedAt: 'smart-default',
          alternatives: semanticResults
            .filter(r => r.category !== bestMatch.category)
            .slice(0, 2)
            .map(r => ({ category: r.category, confidence: r.confidence }))
        }
      : {
          detectedCategory: null,
          confidence: 0,
          level: 'none',
          appliedAt: 'type-based',
          alternatives: []
        }

    semanticsMap.set(fieldPath, semanticMetadata)

    // Build field info for importance analysis
    fieldInfos.push({
      path: fieldPath,
      name: fieldName,
      semanticCategory: bestMatch?.category ?? null,
      sampleValues,
      position,
      totalFields,
    })

    position++
  }

  return { fieldInfos, semanticsMap }
}

/**
 * Hook to run the analysis pipeline when schema/data changes.
 * Populates the analysis cache with results for DynamicRenderer to consume.
 */
export function useSchemaAnalysis(schema: UnifiedSchema | null, data: unknown): void {
  const { setAnalysisCache, clearAnalysisCache } = useAppStore()

  // Track schema identity to avoid re-running on every render
  const lastSchemaRef = useRef<string | null>(null)

  useEffect(() => {
    // Skip if no schema
    if (!schema) {
      clearAnalysisCache()
      lastSchemaRef.current = null
      return
    }

    // Create identity key from schema URL and timestamp
    const schemaKey = `${schema.url}:${schema.inferredAt}`

    // Skip if schema hasn't changed
    if (lastSchemaRef.current === schemaKey) {
      return
    }
    lastSchemaRef.current = schemaKey

    // Clear previous cache
    clearAnalysisCache()

    // Find all analyzable paths in the schema
    const analyzablePaths = findAnalyzablePaths(schema.rootType, data)

    // Run analysis for each path
    for (const { path, schema: nodeSchema, data: nodeData, schemaKind } of analyzablePaths) {
      if (schemaKind === 'array-of-objects') {
        // Build field infos and semantic metadata
        const { fieldInfos, semanticsMap } = buildFieldInfos(nodeSchema, nodeData, path)

        if (fieldInfos.length === 0) continue

        // Run importance analysis
        const analysisResult = analyzeFields(fieldInfos)

        // Build selection context
        const selectionContext: SelectionContext = {
          semantics: semanticsMap,
          importance: analysisResult.importance,
        }

        // Run component selection
        const selection = selectComponent(nodeSchema, selectionContext)

        // Store in cache
        setAnalysisCache(path, {
          semantics: semanticsMap,
          importance: analysisResult.importance,
          selection,
          grouping: analysisResult.grouping,
        })
      } else if (schemaKind === 'object') {
        // Build field infos and semantic metadata for object
        const { fieldInfos, semanticsMap } = buildObjectFieldInfos(nodeSchema, nodeData, path)

        if (fieldInfos.length === 0) continue

        // Run importance analysis
        const analysisResult = analyzeFields(fieldInfos)

        // Build selection context
        const selectionContext: SelectionContext = {
          semantics: semanticsMap,
          importance: analysisResult.importance,
        }

        // Run object component selection
        const selection = selectObjectComponent(nodeSchema, selectionContext)

        // Store in cache
        setAnalysisCache(path, {
          semantics: semanticsMap,
          importance: analysisResult.importance,
          selection,
          grouping: analysisResult.grouping,
        })
      } else if (schemaKind === 'primitive-array') {
        // Primitive arrays have minimal field analysis but need data for chips heuristic
        // Build a minimal semantics map from parent path semantic detection
        const semanticsMap = new Map<string, SemanticMetadata>()
        const importanceMap = new Map()

        // Detect semantics on the array itself (e.g., "tags", "status")
        // Use the field name from the path (last segment)
        const fieldName = path.split('.').pop() || path
        const semanticResults = detectSemantics(path, fieldName, 'array', Array.isArray(nodeData) ? nodeData.slice(0, 10) : [])
        const bestMatch = getBestMatch(semanticResults)
        if (bestMatch) {
          semanticsMap.set(path, {
            detectedCategory: bestMatch.category,
            confidence: bestMatch.confidence,
            level: bestMatch.level,
            appliedAt: 'smart-default',
            alternatives: []
          })
        }

        const selectionContext: SelectionContext = { semantics: semanticsMap, importance: importanceMap }
        const selection = selectPrimitiveArrayComponent(nodeSchema, nodeData, selectionContext)

        // Store in cache
        setAnalysisCache(path, { semantics: semanticsMap, importance: importanceMap, selection, grouping: null })
      }
    }
  }, [schema, data, setAnalysisCache, clearAnalysisCache])
}
