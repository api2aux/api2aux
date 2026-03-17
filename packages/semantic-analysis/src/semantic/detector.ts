/**
 * Semantic detection engine.
 * Main entry point for detecting semantic categories of API fields.
 */

import { getAllPatterns, getCompositePatterns } from './patterns'
import { calculateConfidence } from './scorer'
import { createMemoizedDetector, type MemoizedDetector } from './cache'
import type { ConfidenceResult, CompositePattern, SemanticPattern } from './types'
import { DEFAULT_THRESHOLDS } from './types'
import type { PluginSemanticCategory } from '../types/plugins'
import { enrichmentRegistry } from '../enrichment/registry'

/**
 * Injectable custom categories provider.
 * Set by the app layer (e.g., from plugin registry) via setCustomCategoriesProvider().
 * Defaults to enrichment registry categories for standalone/CLI usage.
 *
 * The app layer can override this to merge enrichment registry categories
 * with app-specific plugin categories. If not overridden, enrichment plugins'
 * field categories are automatically included via the registry.
 */
let customCategoriesProvider: () => PluginSemanticCategory[] = () =>
  enrichmentRegistry.getAllFieldCategories()

/**
 * Set the provider function for custom plugin categories.
 * Call this from the app layer to integrate plugin-declared categories
 * into the detection pipeline.
 */
export function setCustomCategoriesProvider(provider: () => PluginSemanticCategory[]): void {
  customCategoriesProvider = provider
  // Reset memoized detector so new categories take effect
  memoizedDetector = null
}

/**
 * Convert a plugin-declared semantic category into a SemanticPattern
 * so it can compete in the same scoring pipeline as core patterns.
 * Uses regex name matching (Tier 2) instead of embeddings (Tier 1).
 */
function pluginCategoryToPattern(cat: PluginSemanticCategory): SemanticPattern {
  return {
    category: cat.id as any,
    namePatterns: cat.namePatterns.map(regex => ({
      regex,
      weight: 0.40,
      languages: ['en'],
    })),
    typeConstraint: { allowed: ['string', 'number', 'boolean', 'array', 'object'], weight: 0.10 },
    valueValidators: [{
      name: `plugin:${cat.id}`,
      validator: (value: unknown) => cat.validate(value, { fieldName: '', fieldPath: '', parentObject: undefined }),
      weight: 0.30,
    }],
    formatHints: [],
    thresholds: { high: DEFAULT_THRESHOLDS.high, medium: DEFAULT_THRESHOLDS.medium },
  }
}

/**
 * Internal detection function (before memoization).
 * Runs all patterns against a field and returns sorted results.
 * Evaluates both core patterns (Tier 1) and plugin-declared categories (Tier 2).
 */
function detectSemanticsInternal(
  _fieldPath: string,
  fieldName: string,
  fieldType: string,
  sampleValues: unknown[],
  openapiHints?: { format?: string; description?: string }
): ConfidenceResult[] {
  const patterns = getAllPatterns()
  const results: ConfidenceResult[] = []

  // Tier 1: Core patterns (embedding-based name matching)
  for (const pattern of patterns) {
    const result = calculateConfidence(
      fieldName,
      fieldType,
      sampleValues,
      openapiHints,
      pattern
    )

    // Only include results with positive confidence
    if (result.confidence > 0) {
      results.push(result)
    }
  }

  // Tier 2: Plugin-declared custom categories (regex/keyword name matching)
  const customCategories = customCategoriesProvider()
  for (const customCat of customCategories) {
    const pattern = pluginCategoryToPattern(customCat)
    const result = calculateConfidence(
      fieldName,
      fieldType,
      sampleValues,
      openapiHints,
      pattern
    )

    if (result.confidence > 0) {
      results.push(result)
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence)

  // Return top 3 alternatives
  return results.slice(0, 3)
}

/**
 * Memoized detector instance.
 * Created lazily and cached for performance.
 */
let memoizedDetector: MemoizedDetector | null = null

function getMemoizedDetector(): MemoizedDetector {
  if (!memoizedDetector) {
    memoizedDetector = createMemoizedDetector(detectSemanticsInternal)
  }
  return memoizedDetector
}

/**
 * Detect semantic categories for a field.
 * Returns up to 3 best-matching categories sorted by confidence.
 *
 * @param fieldPath - Full path to the field (e.g., 'items[0].price')
 * @param fieldName - Field name (e.g., 'price')
 * @param fieldType - Inferred type (e.g., 'string', 'number', 'array')
 * @param sampleValues - Sample values from the field
 * @param openapiHints - Optional OpenAPI hints (format, description)
 * @returns Array of ConfidenceResult sorted by confidence (max 3)
 *
 * @example
 * ```ts
 * const results = detectSemantics(
 *   'product.price',
 *   'price',
 *   'number',
 *   [19.99, 29.99, 9.99]
 * )
 * // Returns: [{ category: 'price', confidence: 0.85, level: 'high', signals: [...] }]
 * ```
 */
export function detectSemantics(
  fieldPath: string,
  fieldName: string,
  fieldType: string,
  sampleValues: unknown[],
  openapiHints?: { format?: string; description?: string }
): ConfidenceResult[] {
  return getMemoizedDetector().detect(
    fieldPath,
    fieldName,
    fieldType,
    sampleValues,
    openapiHints
  )
}

/**
 * Detect composite patterns for array fields.
 * Checks if an array's item structure matches a composite pattern (e.g., reviews).
 *
 * @param fieldPath - Full path to the array field
 * @param fieldName - Name of the array field
 * @param itemFields - Fields within array items (name and type)
 * @param sampleItems - Sample items from the array
 * @returns Best matching composite pattern result, or null if no match
 *
 * @example
 * ```ts
 * const result = detectCompositeSemantics(
 *   'product.reviews',
 *   'reviews',
 *   [{ name: 'rating', type: 'number' }, { name: 'comment', type: 'string' }],
 *   [{ rating: 5, comment: 'Great!' }]
 * )
 * // Returns: { category: 'reviews', confidence: 0.8, level: 'high', signals: [...] }
 * ```
 */
export function detectCompositeSemantics(
  _fieldPath: string,
  fieldName: string,
  itemFields: Array<{ name: string; type: string }>,
  sampleItems: unknown[]
): ConfidenceResult | null {
  const compositePatterns = getCompositePatterns()
  let bestMatch: ConfidenceResult | null = null

  for (const pattern of compositePatterns) {
    const result = evaluateCompositePattern(fieldName, itemFields, sampleItems, pattern)

    if (result && (!bestMatch || result.confidence > bestMatch.confidence)) {
      bestMatch = result
    }
  }

  return bestMatch
}

/**
 * Evaluate a single composite pattern against array field structure.
 */
function evaluateCompositePattern(
  fieldName: string,
  itemFields: Array<{ name: string; type: string }>,
  sampleItems: unknown[],
  pattern: CompositePattern
): ConfidenceResult | null {
  const signals = []
  let totalScore = 0
  let maxPossibleScore = 0

  // 1. Check name pattern match (best match wins)
  if (pattern.namePatterns.length > 0) {
    let bestNameMatch = 0
    const maxNameWeight = Math.max(...pattern.namePatterns.map(p => p.weight))
    maxPossibleScore += maxNameWeight

    for (const namePattern of pattern.namePatterns) {
      if (namePattern.regex.test(fieldName)) {
        if (namePattern.weight > bestNameMatch) {
          bestNameMatch = namePattern.weight
        }
      }
    }

    signals.push({
      name: 'namePattern',
      matched: bestNameMatch > 0,
      weight: maxNameWeight,
      contribution: bestNameMatch,
    })
    totalScore += bestNameMatch
  }

  // 2. Check type constraint (must be array)
  if (pattern.typeConstraint.weight > 0) {
    maxPossibleScore += pattern.typeConstraint.weight
    // We're called for arrays, so this should pass
    const typeMatched = true

    signals.push({
      name: 'typeConstraint:array',
      matched: typeMatched,
      weight: pattern.typeConstraint.weight,
      contribution: typeMatched ? pattern.typeConstraint.weight : 0,
    })

    if (typeMatched) {
      totalScore += pattern.typeConstraint.weight
    }
  }

  // 3. Check requiredFields structure match
  // Each required field pattern must match at least one item field
  const structureWeight = 0.4 // Structure match is important for composite patterns
  maxPossibleScore += structureWeight

  let allRequiredFieldsMatched = true
  const matchedRequiredFields: string[] = []

  for (const required of pattern.requiredFields) {
    const found = itemFields.some(field => {
      const nameMatches = required.nameRegex.test(field.name)
      const typeMatches = field.type === required.type
      return nameMatches && typeMatches
    })

    if (!found) {
      allRequiredFieldsMatched = false
    } else {
      matchedRequiredFields.push(required.nameRegex.source)
    }
  }

  signals.push({
    name: `requiredFields:${matchedRequiredFields.join(',')}`,
    matched: allRequiredFieldsMatched,
    weight: structureWeight,
    contribution: allRequiredFieldsMatched ? structureWeight : 0,
  })

  if (allRequiredFieldsMatched) {
    totalScore += structureWeight
  }

  // 4. Check minItems constraint
  const hasEnoughItems = sampleItems.length >= pattern.minItems
  if (!hasEnoughItems) {
    // If no items, reduce confidence significantly
    totalScore *= 0.5
  }

  // Calculate final confidence
  const confidence = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0

  // Determine level
  let level: 'high' | 'medium' | 'low' | 'none'
  if (confidence >= pattern.thresholds.high) {
    level = 'high'
  } else if (confidence >= pattern.thresholds.medium) {
    level = 'medium'
  } else if (confidence > 0) {
    level = 'low'
  } else {
    level = 'none'
  }

  // Only return if there's some match
  if (confidence === 0) {
    return null
  }

  return {
    category: pattern.category,
    confidence,
    level,
    signals,
  }
}

/**
 * Get the best matching result if it meets the high confidence threshold.
 * Returns null if no result meets the threshold (>=0.75 per user decision).
 *
 * @param results - Array of detection results
 * @returns Best result with 'high' confidence, or null
 */
export function getBestMatch(results: ConfidenceResult[]): ConfidenceResult | null {
  if (results.length === 0) {
    return null
  }

  const best = results[0]
  // Only return if it meets the high threshold (smart default threshold)
  if (best && best.level === 'high') {
    return best
  }

  return null
}

/**
 * Clear the semantic detection cache.
 * Useful for testing or when detection rules change.
 */
export function clearSemanticCache(): void {
  if (memoizedDetector) {
    memoizedDetector.cache.clear()
  }
}
