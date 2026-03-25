/**
 * EnrichmentPluginRegistry — singleton registry for enrichment plugins.
 *
 * Aggregates all registered plugins and provides merged results for each hook type.
 * Consumers call the getter methods to collect hints from all plugins at once.
 *
 * Plugins are resolved in hierarchy order: parents before children, then by priority
 * within each tier. This ensures child plugins can override parent entries.
 */

import type {
  DomainSignature,
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

  // === Hierarchy resolution ===

  /**
   * Resolve plugin order: parents before children, then by priority within each tier.
   * Throws on circular `extends` chains or references to unknown parent IDs.
   */
  private getResolutionOrder(): EnrichmentPlugin[] {
    const plugins = Array.from(this.plugins.values())
    if (plugins.length === 0) return []

    const byId = this.plugins

    // Validate extends references
    for (const p of plugins) {
      if (p.extends && !byId.has(p.extends)) {
        throw new Error(`Plugin "${p.id}" extends unknown plugin "${p.extends}"`)
      }
    }

    // Compute depth for each plugin (memoized, with cycle detection)
    const depth = new Map<string, number>()
    const computing = new Set<string>()

    const getDepth = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!
      if (computing.has(id)) {
        throw new Error(`Circular extends chain detected involving "${id}"`)
      }
      computing.add(id)
      const plugin = byId.get(id)!
      const d = plugin.extends ? getDepth(plugin.extends) + 1 : 0
      computing.delete(id)
      depth.set(id, d)
      return d
    }

    for (const p of plugins) getDepth(p.id)

    // Sort: primary by depth ascending, secondary by priority ascending
    // (lower priority first → higher priority applied later → wins on conflict)
    return plugins.sort((a, b) => {
      const dA = depth.get(a.id)!
      const dB = depth.get(b.id)!
      if (dA !== dB) return dA - dB
      return (a.priority ?? 0) - (b.priority ?? 0)
    })
  }

  /**
   * Get the resolved plugin chain in hierarchy order.
   * Useful for UI display of the effective plugin stack.
   */
  getEffectivePlugins(): EnrichmentPlugin[] {
    return this.getResolutionOrder()
  }

  /** Get all registered domain signatures, keyed by plugin ID. */
  getDomainSignatures(): Map<string, DomainSignature> {
    const result = new Map<string, DomainSignature>()
    for (const plugin of this.plugins.values()) {
      if (plugin.domainSignature) {
        result.set(plugin.id, plugin.domainSignature)
      }
    }
    return result
  }

  /**
   * Extract literal field names considered domain-important across all plugins.
   * Scans `fieldCategories[].namePatterns` for literal regexes and `nameKeywords`.
   */
  getDomainImportantFieldNames(): Set<string> {
    const names = new Set<string>()
    for (const plugin of this.plugins.values()) {
      if (!plugin.fieldCategories) continue
      for (const cat of plugin.fieldCategories) {
        for (const pattern of cat.namePatterns) {
          const src = pattern.source.replace(/^\^/, '').replace(/\$$/, '')
          if (/^[\w-]+$/.test(src)) names.add(src.toLowerCase())
        }
        if (cat.nameKeywords) {
          for (const kw of cat.nameKeywords) names.add(kw.toLowerCase())
        }
      }
    }
    return names
  }

  // === Aggregation methods ===

  /**
   * Collect all field categories from all plugins (additive).
   * Used to feed plugin-declared categories into the semantic detection pipeline.
   */
  getAllFieldCategories(): PluginSemanticCategory[] {
    const categories: PluginSemanticCategory[] = []
    for (const plugin of this.getResolutionOrder()) {
      try {
        if (plugin.fieldCategories) {
          categories.push(...plugin.fieldCategories)
        }
      } catch (err) {
        console.error(`[EnrichmentRegistry] Plugin "${plugin.id}" fieldCategories access crashed:`, err)
      }
    }
    return categories
  }

  /**
   * Run all operation taggers across all plugins, merge results.
   * Returns a map of operationId → aggregated tags (from all plugins).
   * Child plugins override parent tags with the same tag ID (last writer wins).
   */
  tagOperations(operations: OperationContext[]): Map<string, OperationSemanticTag[]> {
    const result = new Map<string, OperationSemanticTag[]>()

    // Initialize with empty arrays
    for (const op of operations) {
      result.set(op.id, [])
    }

    for (const plugin of this.getResolutionOrder()) {
      if (!plugin.tagOperations) continue

      try {
        const pluginTags = plugin.tagOperations(operations)
        if (pluginTags.length !== operations.length) {
          console.warn(`[EnrichmentRegistry] Plugin "${plugin.id}" tagOperations returned ${pluginTags.length} results for ${operations.length} operations — skipping`)
          continue
        }
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
      } catch (err) {
        console.error(`[EnrichmentRegistry] Plugin "${plugin.id}" tagOperations crashed:`, err)
      }
    }

    // Deduplicate by tag ID: last writer (highest priority child) wins
    for (const [opId, tags] of result) {
      const seen = new Map<string, OperationSemanticTag>()
      for (const tag of tags) seen.set(tag.id, tag)
      result.set(opId, Array.from(seen.values()))
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

    for (const plugin of this.getResolutionOrder()) {
      if (!plugin.enrichTools) continue

      try {
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
      } catch (err) {
        console.error(`[EnrichmentRegistry] Plugin "${plugin.id}" enrichTools crashed:`, err)
      }
    }

    return result
  }

  /**
   * Run all UI hint hooks, collect results from all plugins (additive).
   * Results are not deduplicated — consumers apply their own precedence logic.
   */
  getUIHints(operations: OperationContext[]): UIComponentHint[] {
    const hints: UIComponentHint[] = []
    for (const plugin of this.getResolutionOrder()) {
      if (!plugin.uiHints) continue
      try {
        hints.push(...plugin.uiHints(operations))
      } catch (err) {
        console.error(`[EnrichmentRegistry] Plugin "${plugin.id}" uiHints crashed:`, err)
      }
    }
    return hints
  }

  /**
   * Collect all workflow pattern hints from all plugins (additive).
   */
  getWorkflowPatterns(): WorkflowPatternHint[] {
    const patterns: WorkflowPatternHint[] = []
    for (const plugin of this.getResolutionOrder()) {
      if (!plugin.workflowPatterns) continue
      try {
        patterns.push(...plugin.workflowPatterns())
      } catch (err) {
        console.error(`[EnrichmentRegistry] Plugin "${plugin.id}" workflowPatterns crashed:`, err)
      }
    }
    return patterns
  }

  /**
   * Get all plugins that provide LLM disambiguation, in resolution order.
   * The workflow inference engine calls these for ambiguous matches.
   */
  getDisambiguators(): EnrichmentPlugin[] {
    return this.getResolutionOrder().filter(p => p.disambiguate !== undefined)
  }
}

/** Singleton enrichment plugin registry. */
export const enrichmentRegistry = new EnrichmentPluginRegistry()
