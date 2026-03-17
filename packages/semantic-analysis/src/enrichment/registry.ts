/**
 * EnrichmentPluginRegistry — singleton registry for enrichment plugins.
 *
 * Aggregates all registered plugins and provides merged results for each hook type.
 * Consumers call the getter methods to collect hints from all plugins at once.
 */

import type {
  EnrichmentPlugin,
  OperationContext,
  OperationSemanticTag,
  ToolEnrichmentHint,
  UIComponentHint,
  WorkflowPatternHint,
} from '../types/enrichment'
import type { PluginSemanticCategory } from '../types/plugins'

export class EnrichmentPluginRegistry {
  private plugins: Map<string, EnrichmentPlugin> = new Map()

  /** Register an enrichment plugin. Replaces any existing plugin with the same ID. */
  register(plugin: EnrichmentPlugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  /** Unregister a plugin by ID. Returns true if the plugin was found and removed. */
  unregister(id: string): boolean {
    return this.plugins.delete(id)
  }

  /** Get a registered plugin by ID. */
  get(id: string): EnrichmentPlugin | undefined {
    return this.plugins.get(id)
  }

  /** Get all registered plugins. */
  getAll(): EnrichmentPlugin[] {
    return Array.from(this.plugins.values())
  }

  /** Number of registered plugins. */
  get size(): number {
    return this.plugins.size
  }

  /** Remove all registered plugins. */
  clear(): void {
    this.plugins.clear()
  }

  // === Aggregation methods ===

  /**
   * Collect all field categories from all plugins.
   * Used to feed plugin-declared categories into the semantic detection pipeline.
   */
  getAllFieldCategories(): PluginSemanticCategory[] {
    const categories: PluginSemanticCategory[] = []
    for (const plugin of this.plugins.values()) {
      if (plugin.fieldCategories) {
        categories.push(...plugin.fieldCategories)
      }
    }
    return categories
  }

  /**
   * Run all operation taggers across all plugins, merge results.
   * Returns a map of operationId → aggregated tags (from all plugins).
   */
  tagOperations(operations: OperationContext[]): Map<string, OperationSemanticTag[]> {
    const result = new Map<string, OperationSemanticTag[]>()

    // Initialize with empty arrays
    for (const op of operations) {
      result.set(op.id, [])
    }

    for (const plugin of this.plugins.values()) {
      if (!plugin.tagOperations) continue

      const pluginTags = plugin.tagOperations(operations)
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i]
        if (!op) continue
        const opId = op.id
        const tags = pluginTags[i]
        if (tags && tags.length > 0) {
          const existing = result.get(opId)!
          existing.push(...tags)
        }
      }
    }

    return result
  }

  /**
   * Run all tool enrichment hooks, merge results.
   * When multiple plugins provide hints for the same operation, later plugins win on conflict
   * (descriptionSuffix is concatenated, parameterHints/defaults are merged, priority takes max).
   */
  getToolHints(operations: OperationContext[]): Map<string, ToolEnrichmentHint> {
    const result = new Map<string, ToolEnrichmentHint>()

    for (const plugin of this.plugins.values()) {
      if (!plugin.enrichTools) continue

      const pluginHints = plugin.enrichTools(operations)
      for (const [opId, hint] of pluginHints) {
        const existing = result.get(opId)
        if (!existing) {
          result.set(opId, { ...hint })
        } else {
          // Merge: concatenate descriptions, merge objects, take max priority
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
    }

    return result
  }

  /**
   * Run all UI hint hooks, collect results from all plugins.
   * Results are not deduplicated — consumers apply their own precedence logic.
   */
  getUIHints(operations: OperationContext[]): UIComponentHint[] {
    const hints: UIComponentHint[] = []
    for (const plugin of this.plugins.values()) {
      if (!plugin.uiHints) continue
      hints.push(...plugin.uiHints(operations))
    }
    return hints
  }

  /**
   * Collect all workflow pattern hints from all plugins.
   */
  getWorkflowPatterns(): WorkflowPatternHint[] {
    const patterns: WorkflowPatternHint[] = []
    for (const plugin of this.plugins.values()) {
      if (!plugin.workflowPatterns) continue
      patterns.push(...plugin.workflowPatterns())
    }
    return patterns
  }

  /**
   * Get all plugins that provide LLM disambiguation.
   * The workflow inference engine calls these for ambiguous matches.
   */
  getDisambiguators(): EnrichmentPlugin[] {
    return this.getAll().filter(p => p.disambiguate !== undefined)
  }
}

/** Singleton enrichment plugin registry. */
export const enrichmentRegistry = new EnrichmentPluginRegistry()
