import { describe, it, expect, vi } from 'vitest'
import { formatStructuredResponse, hasUsableStructuredData, extractJson } from '../../src/response'
import { MergeStrategy } from '../../src/types'
import type { ToolResultEntry, LLMTextFn, StructuredResponse } from '../../src/types'

const singleResult: ToolResultEntry[] = [
  {
    toolName: 'list_users',
    toolArgs: { limit: '10' },
    data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    summary: 'list_users(limit="10") → 2 items',
  },
]

const multipleResults: ToolResultEntry[] = [
  {
    toolName: 'get_user',
    toolArgs: { id: '1' },
    data: { id: 1, name: 'Alice', email: 'alice@test.com' },
    summary: 'get_user(id="1") → 3 fields',
  },
  {
    toolName: 'get_orders',
    toolArgs: { userId: '1' },
    data: [{ id: 101, userId: 1, total: 50 }, { id: 102, userId: 1, total: 75 }],
    summary: 'get_orders(userId="1") → 2 items',
  },
]

describe('formatStructuredResponse', () => {
  describe('Array strategy', () => {
    it('returns results as separate entries', async () => {
      const resp = await formatStructuredResponse(singleResult, MergeStrategy.Array)
      expect(resp.strategy).toBe(MergeStrategy.Array)
      expect(resp.sources).toHaveLength(1)
      expect(resp.sources[0]!.toolName).toBe('list_users')
      expect(Array.isArray(resp.data)).toBe(true)
      expect((resp.data as unknown[])).toHaveLength(1)
    })

    it('handles multiple results', async () => {
      const resp = await formatStructuredResponse(multipleResults, MergeStrategy.Array)
      expect(resp.sources).toHaveLength(2)
      expect((resp.data as unknown[])).toHaveLength(2)
    })

    it('handles empty results', async () => {
      const resp = await formatStructuredResponse([], MergeStrategy.Array)
      expect(resp.sources).toHaveLength(0)
      expect(resp.data).toEqual([])
    })
  })

  describe('Schema-based strategy', () => {
    it('merges entities by shared ID fields', async () => {
      const results: ToolResultEntry[] = [
        {
          toolName: 'get_user',
          toolArgs: { id: '1' },
          data: { id: 1, name: 'Alice' },
          summary: '',
        },
        {
          toolName: 'get_profile',
          toolArgs: { id: '1' },
          data: { id: 1, email: 'alice@test.com', avatar: 'pic.jpg' },
          summary: '',
        },
      ]

      const resp = await formatStructuredResponse(results, MergeStrategy.SchemaBased)
      expect(resp.strategy).toBe(MergeStrategy.SchemaBased)
      const data = resp.data as Record<string, unknown>[]
      expect(data).toHaveLength(1)
      expect(data[0]).toHaveProperty('name', 'Alice')
      expect(data[0]).toHaveProperty('email', 'alice@test.com')
      expect(data[0]).toHaveProperty('avatar', 'pic.jpg')
    })

    it('falls back to array when no ID fields found', async () => {
      const results: ToolResultEntry[] = [
        { toolName: 'status', toolArgs: {}, data: { uptime: '99.9%' }, summary: '' },
        { toolName: 'health', toolArgs: {}, data: { healthy: true }, summary: '' },
      ]

      const resp = await formatStructuredResponse(results, MergeStrategy.SchemaBased)
      // Falls back to array since no ID fields
      expect(resp.strategy).toBe(MergeStrategy.Array)
    })

    it('handles array data with ID fields', async () => {
      const results: ToolResultEntry[] = [
        {
          toolName: 'list_items',
          toolArgs: {},
          data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
          summary: '',
        },
        {
          toolName: 'list_prices',
          toolArgs: {},
          data: [{ id: 1, price: 10 }, { id: 2, price: 20 }],
          summary: '',
        },
      ]

      const resp = await formatStructuredResponse(results, MergeStrategy.SchemaBased)
      expect(resp.strategy).toBe(MergeStrategy.SchemaBased)
      const data = resp.data as Record<string, unknown>[]
      expect(data).toHaveLength(2)
      const item1 = data.find(d => d.id === 1)
      expect(item1).toHaveProperty('name', 'A')
      expect(item1).toHaveProperty('price', 10)
    })

    it('uses last-writer-wins for conflicting field values', async () => {
      const results: ToolResultEntry[] = [
        {
          toolName: 'get_user_v1',
          toolArgs: { id: '1' },
          data: { id: 1, name: 'Alice', status: 'active' },
          summary: '',
        },
        {
          toolName: 'get_user_v2',
          toolArgs: { id: '1' },
          data: { id: 1, name: 'Alice Updated', status: 'inactive' },
          summary: '',
        },
      ]

      const resp = await formatStructuredResponse(results, MergeStrategy.SchemaBased)
      expect(resp.strategy).toBe(MergeStrategy.SchemaBased)
      const data = resp.data as Record<string, unknown>[]
      expect(data).toHaveLength(1)
      // Last writer wins: second result's values override first
      expect(data[0]).toHaveProperty('name', 'Alice Updated')
      expect(data[0]).toHaveProperty('status', 'inactive')
    })
  })

  describe('LLM-guided strategy', () => {
    it('calls LLM to merge multiple results', async () => {
      const mockLlm: LLMTextFn = vi.fn().mockResolvedValue(
        JSON.stringify({ users: [{ id: 1, name: 'Alice', orders: 2 }] }),
      )

      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'Show me user 1 with their orders',
        mockLlm,
      )

      expect(resp.strategy).toBe(MergeStrategy.LlmGuided)
      expect(mockLlm).toHaveBeenCalledOnce()
      expect(resp.data).toEqual({ users: [{ id: 1, name: 'Alice', orders: 2 }] })
    })

    it('uses MERGE_PROMPT for multiple results', async () => {
      let capturedMessages: unknown[] = []
      const mockLlm: LLMTextFn = vi.fn().mockImplementation(async (msgs) => {
        capturedMessages = msgs
        return JSON.stringify({ merged: true })
      })

      await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        mockLlm,
      )

      const systemMsg = (capturedMessages as Array<{ role: string; content: string }>).find(m => m.role === 'system')
      expect(systemMsg?.content).toContain('data merging assistant')
      expect(systemMsg?.content).not.toContain('data formatting assistant')
    })

    it('focuses single result via LLM call', async () => {
      const mockLlm: LLMTextFn = vi.fn().mockResolvedValue(
        JSON.stringify([{ name: 'Alice' }]),
      )

      const resp = await formatStructuredResponse(
        singleResult,
        MergeStrategy.LlmGuided,
        'list users',
        mockLlm,
      )

      expect(resp.strategy).toBe(MergeStrategy.LlmGuided)
      expect(mockLlm).toHaveBeenCalledOnce()
      expect(resp.data).toEqual([{ name: 'Alice' }])
    })

    it('uses FOCUS_PROMPT for single result', async () => {
      let capturedMessages: unknown[] = []
      const mockLlm: LLMTextFn = vi.fn().mockImplementation(async (msgs) => {
        capturedMessages = msgs
        return JSON.stringify({ focused: true })
      })

      await formatStructuredResponse(
        singleResult,
        MergeStrategy.LlmGuided,
        'list users',
        mockLlm,
      )

      const systemMsg = (capturedMessages as Array<{ role: string; content: string }>).find(m => m.role === 'system')
      expect(systemMsg?.content).toContain('data formatting assistant')
      expect(systemMsg?.content).not.toContain('data merging assistant')
    })

    it('falls back to array when LLM is not provided', async () => {
      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        undefined as unknown as LLMTextFn,
      )
      expect(resp.strategy).toBe(MergeStrategy.Array)
    })

    it('propagates LLM infrastructure errors', async () => {
      const mockLlm: LLMTextFn = vi.fn().mockRejectedValue(new Error('API error'))

      await expect(formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        mockLlm,
      )).rejects.toThrow('API error')
    })

    it('falls back to array on invalid JSON from LLM', async () => {
      const mockLlm: LLMTextFn = vi.fn().mockResolvedValue('This is not valid JSON')

      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        mockLlm,
      )

      expect(resp.strategy).toBe(MergeStrategy.Array)
    })

    it('sends full compact JSON to the merge prompt without truncation', async () => {
      const largeData = { payload: 'x'.repeat(5000) }
      const results: ToolResultEntry[] = [
        { toolName: 'big_api', toolArgs: {}, data: largeData, summary: '' },
        { toolName: 'small_api', toolArgs: {}, data: { id: 1 }, summary: '' },
      ]

      let capturedMessages: unknown[] = []
      const mockLlm: LLMTextFn = vi.fn().mockImplementation(async (msgs) => {
        capturedMessages = msgs
        return JSON.stringify({ merged: true })
      })

      await formatStructuredResponse(results, MergeStrategy.LlmGuided, 'merge', mockLlm)

      const userMsg = (capturedMessages as Array<{ role: string; content: string }>).find(m => m.role === 'user')
      expect(userMsg).toBeDefined()
      // Full compact JSON should be present (not truncated, not pretty-printed)
      const fullCompactJson = JSON.stringify(largeData)
      expect(userMsg!.content).toContain(fullCompactJson)
    })
  })
})

describe('hasUsableStructuredData', () => {
  it('returns false for Array strategy', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.Array, sources: [], data: [] }
    expect(hasUsableStructuredData(s)).toBe(false)
  })

  it('returns false for null data', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: null }
    expect(hasUsableStructuredData(s)).toBe(false)
  })

  it('returns false for undefined data', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: undefined }
    expect(hasUsableStructuredData(s)).toBe(false)
  })

  it('returns false for empty array', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: [] }
    expect(hasUsableStructuredData(s)).toBe(false)
  })

  it('returns false for empty object', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: {} }
    expect(hasUsableStructuredData(s)).toBe(false)
  })

  it('returns true for non-empty object', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: { name: 'Alice' } }
    expect(hasUsableStructuredData(s)).toBe(true)
  })

  it('returns true for non-empty array', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: [1, 2, 3] }
    expect(hasUsableStructuredData(s)).toBe(true)
  })

  it('returns true for SchemaBased strategy with data', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.SchemaBased, sources: [], data: [{ id: 1 }] }
    expect(hasUsableStructuredData(s)).toBe(true)
  })

  it('returns true for falsy but valid data (number 0)', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: 0 }
    expect(hasUsableStructuredData(s)).toBe(true)
  })

  it('returns true for falsy but valid data (empty string)', () => {
    const s: StructuredResponse = { strategy: MergeStrategy.LlmGuided, sources: [], data: '' }
    expect(hasUsableStructuredData(s)).toBe(true)
  })
})

describe('extractJson', () => {
  it('parses pure JSON string directly', () => {
    expect(extractJson('{"name":"Alice"}')).toEqual({ name: 'Alice' })
  })

  it('parses JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('handles leading/trailing whitespace', () => {
    expect(extractJson('  {"id": 1}  \n')).toEqual({ id: 1 })
  })

  it('extracts JSON from markdown code block with json tag', () => {
    const input = '```json\n{"focused": true}\n```'
    expect(extractJson(input)).toEqual({ focused: true })
  })

  it('extracts JSON from markdown code block without tag', () => {
    const input = '```\n{"focused": true}\n```'
    expect(extractJson(input)).toEqual({ focused: true })
  })

  it('extracts JSON from code block with surrounding text', () => {
    const input = 'Here is the result:\n```json\n{"data": [1, 2]}\n```\nHope this helps!'
    expect(extractJson(input)).toEqual({ data: [1, 2] })
  })

  it('extracts outermost JSON object from surrounding text', () => {
    const input = 'The merged data is: {"users": [{"id": 1}]} end of response'
    expect(extractJson(input)).toEqual({ users: [{ id: 1 }] })
  })

  it('extracts outermost JSON array from surrounding text', () => {
    const input = 'Results: [{"id": 1}, {"id": 2}] done'
    expect(extractJson(input)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('returns null for truly unparseable content', () => {
    expect(extractJson('This is just plain text with no JSON at all')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractJson('')).toBeNull()
  })

  it('returns null for malformed JSON even in code block', () => {
    const input = '```json\n{broken: json}\n```'
    expect(extractJson(input)).toBeNull()
  })

  it('handles nested braces correctly', () => {
    const input = 'prefix {"a": {"b": {"c": 1}}} suffix'
    expect(extractJson(input)).toEqual({ a: { b: { c: 1 } } })
  })

  it('parses number as valid JSON', () => {
    expect(extractJson('42')).toBe(42)
  })

  it('parses string literal as valid JSON', () => {
    expect(extractJson('"hello"')).toBe('hello')
  })
})
