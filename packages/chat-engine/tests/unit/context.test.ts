import { describe, it, expect } from 'vitest'
import { buildToolsFromUrl, buildToolsFromSpec, buildSystemPrompt, buildChatContext } from '../../src/context'
import type { ApiSpec } from '../../src/types'

const minimalSpec: ApiSpec = {
  title: 'Test API',
  baseUrl: 'https://api.example.com',
  operations: [
    {
      id: 'listUsers',
      path: '/users',
      method: 'GET',
      tags: ['Users'],
      summary: 'List all users',
      parameters: [
        { name: 'limit', in: 'query', required: false, description: 'Max results', schema: { type: 'integer', default: 20 } },
        { name: 'page', in: 'query', required: false, description: 'Page number', schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
        },
      },
    },
    {
      id: 'getUser',
      path: '/users/{userId}',
      method: 'GET',
      tags: ['Users'],
      summary: 'Get user by ID',
      parameters: [
        { name: 'userId', in: 'path', required: true, description: 'User ID', schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  ],
}

describe('buildToolsFromUrl', () => {
  it('creates a single query_api tool', () => {
    const tools = buildToolsFromUrl('https://api.example.com/data')
    expect(tools).toHaveLength(1)
    expect(tools[0]!.function.name).toBe('query_api')
    expect(tools[0]!.type).toBe('function')
  })

  it('includes pre-parsed parameters', () => {
    const tools = buildToolsFromUrl('https://api.example.com/data', [
      { name: 'q', values: ['test'] },
      { name: 'limit' },
    ])
    expect(tools).toHaveLength(1)
    const params = tools[0]!.function.parameters
    expect(params.properties).toHaveProperty('q')
    expect(params.properties).toHaveProperty('limit')
  })

  it('works without parameters', () => {
    const tools = buildToolsFromUrl('https://api.example.com/data')
    expect(tools[0]!.function.parameters.properties).toEqual({})
  })
})

describe('buildToolsFromSpec', () => {
  it('creates one tool per operation', () => {
    const tools = buildToolsFromSpec(minimalSpec)
    expect(tools).toHaveLength(2)
  })

  it('uses operation IDs as tool names', () => {
    const tools = buildToolsFromSpec(minimalSpec)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('list_users')
    expect(names).toContain('get_user')
  })

  it('includes parameter definitions', () => {
    const tools = buildToolsFromSpec(minimalSpec)
    const listUsers = tools.find(t => t.function.name === 'list_users')!
    expect(listUsers.function.parameters.properties).toHaveProperty('limit')
  })
})

describe('buildSystemPrompt', () => {
  it('includes API title for spec mode', () => {
    const prompt = buildSystemPrompt('https://api.example.com', minimalSpec)
    expect(prompt).toContain('Test API')
  })

  it('includes NEVER answer from own knowledge instruction', () => {
    const prompt = buildSystemPrompt('https://api.example.com', minimalSpec)
    expect(prompt).toContain('NEVER answer from your own knowledge')
  })

  it('detects pagination hints', () => {
    const prompt = buildSystemPrompt('https://api.example.com', minimalSpec)
    expect(prompt).toContain('Pagination')
    expect(prompt).toContain('limit')
    expect(prompt).toContain('page')
  })

  it('detects response field semantics', () => {
    const prompt = buildSystemPrompt('https://api.example.com', minimalSpec)
    expect(prompt).toContain('identifiers')
    expect(prompt).toContain('dates')
  })

  it('generates raw URL prompt without spec', () => {
    const prompt = buildSystemPrompt('https://api.example.com/data?q=test')
    expect(prompt).toContain('api.example.com')
    expect(prompt).toContain('query_api')
    expect(prompt).toContain('NEVER answer from your own knowledge')
  })

  it('detects auth schemes', () => {
    const specWithAuth: ApiSpec = {
      ...minimalSpec,
      authSchemes: [{ authType: 'bearer' }],
    }
    const prompt = buildSystemPrompt('https://api.example.com', specWithAuth)
    expect(prompt).toContain('Bearer token')
    expect(prompt).toContain('Authentication')
  })
})

describe('buildChatContext', () => {
  it('builds context with spec', () => {
    const ctx = buildChatContext('https://api.example.com', minimalSpec)
    expect(ctx.url).toBe('https://api.example.com')
    expect(ctx.spec).toBe(minimalSpec)
    expect(ctx.tools.length).toBeGreaterThan(0)
    expect(ctx.systemPrompt).toContain('Test API')
  })

  it('builds context without spec', () => {
    const ctx = buildChatContext('https://api.example.com/data', null)
    expect(ctx.spec).toBeNull()
    expect(ctx.tools).toHaveLength(1)
    expect(ctx.tools[0]!.function.name).toBe('query_api')
  })

  it('passes URL parameters through', () => {
    const ctx = buildChatContext('https://api.example.com/data', null, [{ name: 'q' }])
    expect(ctx.tools[0]!.function.parameters.properties).toHaveProperty('q')
  })
})
