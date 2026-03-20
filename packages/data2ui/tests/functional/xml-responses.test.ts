/**
 * Functional tests: XML data through full buildUIPlan() pipeline.
 */
import { describe, it, expect } from 'vitest'
import { buildPlanFromFixture } from '../helpers/setup'
import { NodeKind, InputFormat } from '../../src/types'
import type { LayoutNode } from '../../src/plan/types'

describe('XML responses: RSS feed', () => {
  it('auto-detects XML format', () => {
    const plan = buildPlanFromFixture('rss-feed.xml')
    expect(plan.inputFormat).toBe(InputFormat.XML)
  })

  it('produces a layout node at root', () => {
    const plan = buildPlanFromFixture('rss-feed.xml')
    expect(plan.root.kind).toBe(NodeKind.Layout)
  })

  it('unwraps RSS structure correctly', () => {
    const plan = buildPlanFromFixture('rss-feed.xml')
    const root = plan.root as LayoutNode

    // RSS root unwraps to channel content which has title, link, description, item
    // The channel object should have children
    expect(root.children.length).toBeGreaterThan(0)
  })

  it('generates analysis for the parsed data', () => {
    const plan = buildPlanFromFixture('rss-feed.xml')
    expect(Object.keys(plan.analysis).length).toBeGreaterThan(0)
  })

  it('applies component override to XML data', () => {
    const plan = buildPlanFromFixture('rss-feed.xml', {
      componentOverrides: { '$': 'timeline' },
    })

    const root = plan.root as LayoutNode
    expect(root.component).toBe('timeline')
  })
})
