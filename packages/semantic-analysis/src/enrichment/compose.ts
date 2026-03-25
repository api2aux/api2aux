/**
 * Composition utility for creating child enrichment plugins from a base.
 *
 * Applies the same merge semantics as the registry's hierarchy resolution:
 * - fieldCategories, workflowPatterns, uiHints: additive (base + overrides)
 * - tagOperations, enrichTools: child overrides parent entries (last writer wins)
 * - disambiguate: chained (base runs first, overrides refines)
 */

import type {
  EnrichmentPlugin,
  OperationContext,
  OperationSemanticTag,
  ToolEnrichmentHint,
} from '../types/enrichment'

/**
 * Create a child plugin by composing a base plugin with overrides.
 * Automatically sets `extends` to `base.id`.
 */
export function composeEnrichmentPlugin(
  base: EnrichmentPlugin,
  overrides: Partial<EnrichmentPlugin> & { id: string; name: string; version: string },
): EnrichmentPlugin {
  const composed: EnrichmentPlugin = {
    id: overrides.id,
    name: overrides.name,
    version: overrides.version,
    extends: base.id,
    priority: overrides.priority ?? (base.priority ?? 0) + 1,
    domainSignature: overrides.domainSignature ?? base.domainSignature,

    // Additive: concatenate base + overrides
    fieldCategories: mergeArrayProp(base.fieldCategories, overrides.fieldCategories),

    // Override: child tags replace parent tags with the same ID
    tagOperations: composeTagOperations(base.tagOperations, overrides.tagOperations),

    // Override: child hints merge on top of parent hints
    enrichTools: composeEnrichTools(base.enrichTools, overrides.enrichTools),

    // Additive: concatenate
    uiHints: composeAdditiveFn(base.uiHints, overrides.uiHints),

    // Additive: concatenate
    workflowPatterns: composeAdditiveNullary(base.workflowPatterns, overrides.workflowPatterns),

    // Chained: base runs first, overrides refines
    disambiguate: composeDisambiguate(base.disambiguate, overrides.disambiguate),
  }

  return composed
}

function mergeArrayProp<T>(base?: T[], overrides?: T[]): T[] | undefined {
  if (!base && !overrides) return undefined
  return [...(base ?? []), ...(overrides ?? [])]
}

function composeTagOperations(
  baseFn?: EnrichmentPlugin['tagOperations'],
  overrideFn?: EnrichmentPlugin['tagOperations'],
): EnrichmentPlugin['tagOperations'] {
  if (!baseFn && !overrideFn) return undefined
  if (!baseFn) return overrideFn
  if (!overrideFn) return baseFn

  return (operations: OperationContext[]): OperationSemanticTag[][] => {
    const baseTags = baseFn(operations)
    const overrideTags = overrideFn(operations)

    if (baseTags.length !== operations.length) {
      console.warn(`[composeEnrichmentPlugin] Base tagOperations returned ${baseTags.length} results for ${operations.length} operations`)
    }
    if (overrideTags.length !== operations.length) {
      console.warn(`[composeEnrichmentPlugin] Override tagOperations returned ${overrideTags.length} results for ${operations.length} operations`)
    }

    return operations.map((_, i) => {
      const base = baseTags[i] ?? []
      const override = overrideTags[i] ?? []
      // Deduplicate by tag ID: override wins
      const seen = new Map<string, OperationSemanticTag>()
      for (const tag of base) seen.set(tag.id, tag)
      for (const tag of override) seen.set(tag.id, tag)
      return Array.from(seen.values())
    })
  }
}

function composeEnrichTools(
  baseFn?: EnrichmentPlugin['enrichTools'],
  overrideFn?: EnrichmentPlugin['enrichTools'],
): EnrichmentPlugin['enrichTools'] {
  if (!baseFn && !overrideFn) return undefined
  if (!baseFn) return overrideFn
  if (!overrideFn) return baseFn

  return (operations: OperationContext[]): Map<string, ToolEnrichmentHint> => {
    const baseHints = baseFn(operations)
    const overrideHints = overrideFn(operations)

    // Start with base, merge overrides on top
    const result = new Map(baseHints)
    for (const [opId, hint] of overrideHints) {
      const existing = result.get(opId)
      if (!existing) {
        result.set(opId, { ...hint })
      } else {
        if (hint.descriptionSuffix) {
          existing.descriptionSuffix = existing.descriptionSuffix
            ? `${existing.descriptionSuffix} ${hint.descriptionSuffix}`
            : hint.descriptionSuffix
        }
        if (hint.parameterHints) {
          existing.parameterHints = { ...existing.parameterHints, ...hint.parameterHints }
        }
        if (hint.parameterDefaults) {
          existing.parameterDefaults = { ...existing.parameterDefaults, ...hint.parameterDefaults }
        }
        if (hint.priority !== undefined) {
          existing.priority = Math.max(existing.priority ?? 0, hint.priority)
        }
      }
    }
    return result
  }
}

function composeAdditiveFn<T>(
  baseFn?: (ops: OperationContext[]) => T[],
  overrideFn?: (ops: OperationContext[]) => T[],
): ((ops: OperationContext[]) => T[]) | undefined {
  if (!baseFn && !overrideFn) return undefined
  if (!baseFn) return overrideFn
  if (!overrideFn) return baseFn

  return (operations: OperationContext[]): T[] => {
    return [...baseFn(operations), ...overrideFn(operations)]
  }
}

function composeAdditiveNullary<T>(
  baseFn?: () => T[],
  overrideFn?: () => T[],
): (() => T[]) | undefined {
  if (!baseFn && !overrideFn) return undefined
  if (!baseFn) return overrideFn
  if (!overrideFn) return baseFn

  return (): T[] => {
    return [...baseFn(), ...overrideFn()]
  }
}

function composeDisambiguate(
  baseFn?: EnrichmentPlugin['disambiguate'],
  overrideFn?: EnrichmentPlugin['disambiguate'],
): EnrichmentPlugin['disambiguate'] {
  if (!baseFn && !overrideFn) return undefined
  if (!baseFn) return overrideFn
  if (!overrideFn) return baseFn

  return async (ambiguous) => {
    const baseResults = await baseFn(ambiguous)
    return overrideFn(baseResults.map((r, i) => ({
      sourceOperationId: r.sourceOperationId,
      targetOperationId: r.targetOperationId,
      sourceField: ambiguous[i]?.sourceField ?? '',
      targetParam: ambiguous[i]?.targetParam ?? '',
      currentScore: r.refinedScore,
      context: r.reasoning ?? '',
    })))
  }
}
