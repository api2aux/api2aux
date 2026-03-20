import { describe, it, expect } from 'vitest'
import { buildUIPlan } from '../../src/plan/builder'
import { NodeKind, ComponentType, InputFormat, SelectionReason } from '../../src/types'

describe('buildUIPlan', () => {
  describe('JSON array of objects', () => {
    it('produces a layout node with table component', () => {
      const data = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]
      const plan = buildUIPlan(data, { url: 'https://api.example.com/users' })

      expect(plan.inputFormat).toBe(InputFormat.JSON)
      expect(plan.root.kind).toBe(NodeKind.Layout)
      expect(plan.schema).toBeDefined()
      expect(plan.generatedAt).toBeGreaterThan(0)

      const root = plan.root as import('../../src/plan/types').LayoutNode
      expect(root.path).toBe('$')
      expect(root.children.length).toBe(3) // id, name, email
    })

    it('has field children with correct paths', () => {
      const data = [{ title: 'Post', body: 'Content' }]
      const plan = buildUIPlan(data)

      const root = plan.root as import('../../src/plan/types').LayoutNode
      const titleChild = root.children.find(c => c.kind === NodeKind.Field && c.name === 'title')
      expect(titleChild).toBeDefined()
      expect(titleChild!.path).toBe('$[].title')
    })
  })

  describe('JSON single object', () => {
    it('produces a layout node with detail component', () => {
      const data = { name: 'Alice', age: 30, city: 'Wonderland' }
      const plan = buildUIPlan(data)

      expect(plan.root.kind).toBe(NodeKind.Layout)
      const root = plan.root as import('../../src/plan/types').LayoutNode
      expect(root.component).toBe(ComponentType.Detail)
      expect(root.children.length).toBe(3)
    })

    it('creates field nodes for primitive fields', () => {
      const data = { name: 'Alice', score: 4.5 }
      const plan = buildUIPlan(data)

      const root = plan.root as import('../../src/plan/types').LayoutNode
      const nameField = root.children.find(c => c.kind === NodeKind.Field && c.name === 'name')
      expect(nameField).toBeDefined()
      expect(nameField!.kind).toBe(NodeKind.Field)
    })
  })

  describe('JSON primitive array', () => {
    it('produces a collection node', () => {
      const data = ['apple', 'banana', 'cherry']
      const plan = buildUIPlan(data)

      expect(plan.root.kind).toBe(NodeKind.Collection)
      const root = plan.root as import('../../src/plan/types').CollectionNode
      expect(root.path).toBe('$')
    })
  })

  describe('string input parsing', () => {
    it('parses JSON string input', () => {
      const plan = buildUIPlan('{"name": "Alice"}')
      expect(plan.inputFormat).toBe(InputFormat.JSON)
      expect(plan.root.kind).toBe(NodeKind.Layout)
    })

    it('parses YAML string input', () => {
      const plan = buildUIPlan('name: Alice\nage: 30')
      expect(plan.inputFormat).toBe(InputFormat.YAML)
      expect(plan.root.kind).toBe(NodeKind.Layout)
    })

    it('parses XML string input', () => {
      const plan = buildUIPlan('<user><name>Alice</name><age>30</age></user>')
      expect(plan.inputFormat).toBe(InputFormat.XML)
      expect(plan.root.kind).toBe(NodeKind.Layout)
    })
  })

  describe('component overrides', () => {
    it('applies user override at root', () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]
      const plan = buildUIPlan(data, {
        componentOverrides: { '$': ComponentType.CardList },
      })

      const root = plan.root as import('../../src/plan/types').LayoutNode
      expect(root.component).toBe(ComponentType.CardList)
      expect(root.selection.reason).toBe(SelectionReason.UserOverride)
      expect(root.selection.confidence).toBe(1)
    })
  })

  describe('nested objects', () => {
    it('handles nested object fields', () => {
      const data = {
        name: 'Alice',
        address: {
          city: 'Wonderland',
          zip: '12345',
        },
      }
      const plan = buildUIPlan(data)

      const root = plan.root as import('../../src/plan/types').LayoutNode
      const addressChild = root.children.find(
        c => c.kind === NodeKind.Layout && c.path === '$.address'
      )
      expect(addressChild).toBeDefined()
      expect(addressChild!.kind).toBe(NodeKind.Layout)

      const addressNode = addressChild as import('../../src/plan/types').LayoutNode
      expect(addressNode.children.length).toBe(2) // city, zip
    })
  })

  describe('analysis integration', () => {
    it('populates analysis in the plan', () => {
      const data = [
        { id: 1, name: 'Alice', email: 'alice@example.com', rating: 4.5 },
        { id: 2, name: 'Bob', email: 'bob@example.com', rating: 3.0 },
      ]
      const plan = buildUIPlan(data)

      // Analysis should have at least the root path
      expect(Object.keys(plan.analysis).length).toBeGreaterThan(0)
      expect(plan.analysis['$']).toBeDefined()
    })

    it('includes semantics in layout nodes', () => {
      const data = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]
      const plan = buildUIPlan(data)

      const root = plan.root as import('../../src/plan/types').LayoutNode
      // Semantics map should be populated
      expect(root.semantics).toBeInstanceOf(Map)
    })
  })
})
