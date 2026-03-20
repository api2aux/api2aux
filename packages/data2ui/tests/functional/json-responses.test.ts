/**
 * Functional tests: real JSON API responses through full buildUIPlan() pipeline.
 */
import { describe, it, expect } from 'vitest'
import { buildPlanFromFixture, loadJSONFixture } from '../helpers/setup'
import { buildUIPlan } from '../../src/plan/builder'
import { NodeKind, InputFormat } from '../../src/types'
import type { LayoutNode, FieldNode } from '../../src/plan/types'

describe('JSON responses: GitHub repos (array of objects)', () => {
  it('produces a layout node at root', () => {
    const plan = buildPlanFromFixture('github-repos.json', {
      url: 'https://api.github.com/users/octocat/repos',
    })

    expect(plan.inputFormat).toBe(InputFormat.JSON)
    expect(plan.root.kind).toBe(NodeKind.Layout)
  })

  it('root has correct field count', () => {
    const plan = buildPlanFromFixture('github-repos.json')
    const root = plan.root as LayoutNode

    // GitHub repos have 10 fields
    expect(root.children.length).toBe(10)
  })

  it('populates semantics for fields', () => {
    const plan = buildPlanFromFixture('github-repos.json')
    const root = plan.root as LayoutNode

    // Should have semantics populated from analysis
    expect(root.semantics.size).toBeGreaterThan(0)
  })

  it('populates importance for fields', () => {
    const plan = buildPlanFromFixture('github-repos.json')
    const root = plan.root as LayoutNode

    expect(root.importance.size).toBeGreaterThan(0)
  })

  it('generates analysis paths', () => {
    const plan = buildPlanFromFixture('github-repos.json')

    expect(plan.analysis['$']).toBeDefined()
    expect(plan.analysis['$'].semantics).toBeInstanceOf(Map)
    expect(plan.analysis['$'].importance).toBeInstanceOf(Map)
  })

  it('field children have correct paths', () => {
    const plan = buildPlanFromFixture('github-repos.json')
    const root = plan.root as LayoutNode
    const nameField = root.children.find(
      c => c.kind === NodeKind.Field && (c as FieldNode).name === 'name'
    ) as FieldNode

    expect(nameField).toBeDefined()
    expect(nameField.path).toBe('$[].name')
  })
})

describe('JSON responses: Spotify track (single object)', () => {
  it('produces a detail layout at root', () => {
    const plan = buildPlanFromFixture('spotify-track.json', {
      url: 'https://api.spotify.com/v1/tracks/123',
    })

    expect(plan.root.kind).toBe(NodeKind.Layout)
    const root = plan.root as LayoutNode
    expect(root.path).toBe('$')
  })

  it('has field children for all properties', () => {
    const plan = buildPlanFromFixture('spotify-track.json')
    const root = plan.root as LayoutNode

    // Spotify track has 12 fields
    expect(root.children.length).toBe(12)
  })

  it('detects date field in release_date', () => {
    const plan = buildPlanFromFixture('spotify-track.json')
    const root = plan.root as LayoutNode

    const releaseDateField = root.children.find(
      c => c.kind === NodeKind.Field && (c as FieldNode).name === 'release_date'
    ) as FieldNode

    expect(releaseDateField).toBeDefined()
    expect(releaseDateField.path).toBe('$.release_date')
  })
})

describe('JSON responses: component overrides', () => {
  it('applies override to array-of-objects', () => {
    const plan = buildPlanFromFixture('github-repos.json', {
      componentOverrides: { '$': 'card-list' },
    })

    const root = plan.root as LayoutNode
    expect(root.component).toBe('card-list')
    expect(root.selection.confidence).toBe(1)
  })

  it('applies override to single object', () => {
    const plan = buildPlanFromFixture('spotify-track.json', {
      componentOverrides: { '$': 'hero' },
    })

    const root = plan.root as LayoutNode
    expect(root.component).toBe('hero')
  })
})

describe('JSON responses: primitive values', () => {
  it('handles a simple number', () => {
    const plan = buildUIPlan(42)
    expect(plan.root.kind).toBe(NodeKind.Field)
  })

  it('handles a simple string', () => {
    const plan = buildUIPlan('hello world')
    expect(plan.root.kind).toBe(NodeKind.Field)
  })

  it('handles null', () => {
    const plan = buildUIPlan(null)
    expect(plan.root.kind).toBe(NodeKind.Field)
  })
})
