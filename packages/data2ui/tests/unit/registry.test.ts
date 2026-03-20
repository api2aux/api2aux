/**
 * Unit tests for the PluginRegistry.
 */

import { describe, it, expect } from 'vitest'
import { PluginRegistry } from '../../src/plugins/registry'
import type { FieldPluginDescriptor } from '../../src/plugins/types'

function createPlugin(id: string): FieldPluginDescriptor {
  return {
    id,
    name: id,
    description: `Plugin ${id}`,
    accepts: { dataTypes: ['number'] },
    source: 'core',
    version: '1.0.0',
  } as FieldPluginDescriptor
}

describe('PluginRegistry', () => {
  it('registers and retrieves a plugin', () => {
    const registry = new PluginRegistry()
    const plugin = createPlugin('core/star-rating')

    registry.register(plugin)

    expect(registry.get('core/star-rating')).toBe(plugin)
    expect(registry.size).toBe(1)
  })

  it('returns null for unregistered plugin', () => {
    const registry = new PluginRegistry()
    expect(registry.get('nonexistent')).toBeNull()
  })

  it('lists all registered plugins', () => {
    const registry = new PluginRegistry()
    registry.register(createPlugin('a'))
    registry.register(createPlugin('b'))

    const list = registry.list()

    expect(list.length).toBe(2)
    expect(list.map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('list() returns a copy, not a reference', () => {
    const registry = new PluginRegistry()
    registry.register(createPlugin('a'))

    const list = registry.list()
    list.push(createPlugin('fake'))

    expect(registry.size).toBe(1)
  })

  it('setDefault + getDefault resolves correctly', () => {
    const registry = new PluginRegistry()
    const plugin = createPlugin('core/star-rating')
    registry.register(plugin)

    registry.setDefault('rating', 'core/star-rating')

    expect(registry.getDefault('rating')).toBe(plugin)
  })

  it('getDefault returns null for unknown category', () => {
    const registry = new PluginRegistry()
    expect(registry.getDefault('unknown')).toBeNull()
  })

  it('setDefault throws for unregistered plugin', () => {
    const registry = new PluginRegistry()

    expect(() => {
      registry.setDefault('rating', 'nonexistent')
    }).toThrow('Cannot set default for "rating": plugin "nonexistent" is not registered')
  })

  it('overwrites existing plugin on re-register', () => {
    const registry = new PluginRegistry()
    const v1 = createPlugin('core/star-rating')
    const v2 = { ...createPlugin('core/star-rating'), version: '2.0.0' }

    registry.register(v1)
    registry.register(v2)

    expect(registry.get('core/star-rating')?.version).toBe('2.0.0')
    expect(registry.size).toBe(1)
  })
})
