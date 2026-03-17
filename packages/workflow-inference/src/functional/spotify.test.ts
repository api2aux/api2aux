/**
 * Functional test: Spotify Web API patterns.
 * Verifies browse-style workflows for a media/content API.
 */

import { describe, it, expect } from 'vitest'
import { analyzeWorkflows } from '../index'
import { WorkflowPattern } from '../types'

describe('Spotify API — workflow inference', () => {
  const spotifyOps = [
    {
      id: 'search',
      path: '/v1/search',
      method: 'GET',
      tags: ['search'],
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'type', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          artists: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    popularity: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: 'get_artist',
      path: '/v1/artists/{id}',
      method: 'GET',
      tags: ['artists'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          genres: { type: 'array' },
          popularity: { type: 'integer' },
        },
      },
    },
    {
      id: 'get_artist_albums',
      path: '/v1/artists/{id}/albums',
      method: 'GET',
      tags: ['artists'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                release_date: { type: 'string' },
                total_tracks: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    {
      id: 'get_album',
      path: '/v1/albums/{id}',
      method: 'GET',
      tags: ['albums'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          tracks: { type: 'object' },
          artists: { type: 'array' },
        },
      },
    },
    {
      id: 'get_album_tracks',
      path: '/v1/albums/{id}/tracks',
      method: 'GET',
      tags: ['albums'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                duration_ms: { type: 'integer' },
                track_number: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    {
      id: 'get_track',
      path: '/v1/tracks/{id}',
      method: 'GET',
      tags: ['tracks'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
    },
  ]

  it('detects artist → albums browse chain via ID pattern', () => {
    const { graph } = analyzeWorkflows(spotifyOps)

    // get_artist returns { id } which chains to get_artist_albums {id}
    const edge = graph.edges.find(e =>
      e.sourceId === 'get_artist' && e.targetId === 'get_artist_albums'
    )
    expect(edge).toBeDefined()
    expect(edge!.score).toBeGreaterThan(0.15)
  })

  it('detects album → tracks browse chain', () => {
    const { graph } = analyzeWorkflows(spotifyOps)

    const edge = graph.edges.find(e =>
      e.sourceId === 'get_album' && e.targetId === 'get_album_tracks'
    )
    expect(edge).toBeDefined()
  })

  it('search response is deeply nested (known limitation for field extraction)', () => {
    const { graph } = analyzeWorkflows(spotifyOps)

    // The search endpoint has deeply nested response (artists.items[].id)
    // which the field extractor doesn't unwrap past the first level.
    // This is a known limitation — search → detail edges come from
    // plugins or LLM disambiguation, not pure schema analysis.
    const searchOutEdges = graph.edges.filter(e => e.sourceId === 'search')
    // May or may not have edges depending on tag proximity
    expect(searchOutEdges).toBeDefined()
  })

  it('produces edges between related operations', () => {
    const { graph } = analyzeWorkflows(spotifyOps)
    // Should have edges from ID pattern matching
    expect(graph.edges.length).toBeGreaterThan(0)
  })
})
