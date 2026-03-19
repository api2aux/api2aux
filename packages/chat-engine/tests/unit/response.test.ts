import { describe, it, expect, vi } from 'vitest'
import { formatStructuredResponse } from '../../src/response'
import { MergeStrategy, FinishReason } from '../../src/types'
import type { ToolResultEntry, LLMCompletionFn } from '../../src/types'

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
  })

  describe('LLM-guided strategy', () => {
    it('calls LLM to merge multiple results', async () => {
      const mockLlm: LLMCompletionFn = vi.fn().mockResolvedValue({
        content: JSON.stringify({ users: [{ id: 1, name: 'Alice', orders: 2 }] }),
        tool_calls: [],
        finish_reason: FinishReason.Stop,
      })

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

    it('falls back to array for single result', async () => {
      const mockLlm: LLMCompletionFn = vi.fn()

      const resp = await formatStructuredResponse(
        singleResult,
        MergeStrategy.LlmGuided,
        'list users',
        mockLlm,
      )

      // Single result, no need to merge
      expect(resp.strategy).toBe(MergeStrategy.Array)
      expect(mockLlm).not.toHaveBeenCalled()
    })

    it('falls back to array when LLM is not provided', async () => {
      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
      )
      expect(resp.strategy).toBe(MergeStrategy.Array)
    })

    it('falls back to array on LLM error', async () => {
      const mockLlm: LLMCompletionFn = vi.fn().mockRejectedValue(new Error('API error'))

      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        mockLlm,
      )

      expect(resp.strategy).toBe(MergeStrategy.Array)
    })

    it('falls back to array on invalid JSON from LLM', async () => {
      const mockLlm: LLMCompletionFn = vi.fn().mockResolvedValue({
        content: 'This is not valid JSON',
        tool_calls: [],
        finish_reason: FinishReason.Stop,
      })

      const resp = await formatStructuredResponse(
        multipleResults,
        MergeStrategy.LlmGuided,
        'merge data',
        mockLlm,
      )

      expect(resp.strategy).toBe(MergeStrategy.Array)
    })
  })
})
