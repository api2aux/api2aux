/**
 * Functional tests that parse real API specs and verify
 * the workflow inference engine produces sensible results.
 *
 * These are integration tests — they exercise the full pipeline:
 * parseOpenAPISpec → operationsToInference → buildOperationGraph → inferWorkflows
 *
 * Spec fixtures are committed in src/functional/fixtures/.
 */

import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import { analyzeWorkflows } from '../index'
import { WorkflowPattern } from '../types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = resolve(__dirname, 'fixtures')

describe('Real spec: Spotify Web API', () => {
  it('detects browse workflows and graph edges', async () => {
    const spec = await parseOpenAPISpec(resolve(FIXTURES_DIR, 'spotify-web-api.yaml'))
    expect(spec.operations.length).toBeGreaterThan(10)

    const { graph, workflows } = analyzeWorkflows(spec.operations)

    expect(graph.edges.length).toBeGreaterThan(0)

    const browseWorkflows = workflows.filter(w => w.pattern === WorkflowPattern.Browse)
    expect(browseWorkflows.length).toBeGreaterThan(0)

    console.log(`Spotify: ${spec.operations.length} ops, ${graph.edges.length} edges, ${workflows.length} workflows`)
    for (const wf of workflows.slice(0, 5)) {
      console.log(`  ${wf.pattern}: ${wf.name} (${wf.steps.map(s => s.operationId).join(' → ')})`)
    }
  })
})

describe('Real spec: TVMaze API', () => {
  it('detects workflows from TV show data API', async () => {
    const spec = await parseOpenAPISpec(resolve(FIXTURES_DIR, 'tvmaze-api.yaml'))
    expect(spec.operations.length).toBeGreaterThan(5)

    const { graph, workflows } = analyzeWorkflows(spec.operations)

    expect(graph.edges.length).toBeGreaterThan(0)

    console.log(`TVMaze: ${spec.operations.length} ops, ${graph.edges.length} edges, ${workflows.length} workflows`)
    for (const wf of workflows.slice(0, 5)) {
      console.log(`  ${wf.pattern}: ${wf.name} (${wf.steps.map(s => s.operationId).join(' → ')})`)
    }
  })
})

describe('Real spec: Amadeus Flight Offers Search', () => {
  it('parses and analyzes without errors', async () => {
    const spec = await parseOpenAPISpec(resolve(FIXTURES_DIR, 'amadeus-flight-offers-search.json'))
    expect(spec.operations.length).toBeGreaterThan(0)

    const { graph } = analyzeWorkflows(spec.operations)

    console.log(`Amadeus Flights: ${spec.operations.length} ops, ${graph.edges.length} edges`)
  })
})

describe('Real spec: Listen Notes Podcast API', () => {
  it('detects workflows from podcast API', async () => {
    const spec = await parseOpenAPISpec(resolve(FIXTURES_DIR, 'listen-notes-api.yaml'))
    expect(spec.operations.length).toBeGreaterThan(3)

    const { graph, workflows } = analyzeWorkflows(spec.operations)

    console.log(`Listen Notes: ${spec.operations.length} ops, ${graph.edges.length} edges, ${workflows.length} workflows`)
    for (const wf of workflows.slice(0, 5)) {
      console.log(`  ${wf.pattern}: ${wf.name} (${wf.steps.map(s => s.operationId).join(' → ')})`)
    }
  })
})
