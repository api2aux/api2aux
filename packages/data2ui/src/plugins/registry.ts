/**
 * Framework-agnostic plugin registry.
 * Manages plugin descriptors for field-level plugin resolution.
 */
import type { FieldPluginDescriptor } from './types'

export class PluginRegistry {
  private plugins: Map<string, FieldPluginDescriptor> = new Map()
  private defaults: Map<string, string> = new Map()

  register(plugin: FieldPluginDescriptor): void {
    this.plugins.set(plugin.id, plugin)
  }

  setDefault(semanticCategory: string, pluginId: string): void {
    if (!this.plugins.has(pluginId)) {
      throw new Error(
        `Cannot set default for "${semanticCategory}": plugin "${pluginId}" is not registered`
      )
    }
    this.defaults.set(semanticCategory, pluginId)
  }

  getDefault(semanticCategory: string): FieldPluginDescriptor | null {
    const pluginId = this.defaults.get(semanticCategory)
    if (!pluginId) return null
    return this.plugins.get(pluginId) ?? null
  }

  get(id: string): FieldPluginDescriptor | null {
    return this.plugins.get(id) ?? null
  }

  list(): FieldPluginDescriptor[] {
    return Array.from(this.plugins.values())
  }

  get size(): number {
    return this.plugins.size
  }
}
