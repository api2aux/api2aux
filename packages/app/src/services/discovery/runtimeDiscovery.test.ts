import { describe, it, expect, vi } from 'vitest'
import { discoverRuntimeEdgesFromInference } from './runtimeDiscovery'
import type { InferenceOperation } from '@api2aux/workflow-inference'

function op(overrides: Partial<InferenceOperation> & { id: string }): InferenceOperation {
  return {
    path: '/test',
    method: 'GET',
    tags: [],
    parameters: [],
    responseFields: [],
    requestBodyFields: [],
    ...overrides,
  }
}

describe('discoverRuntimeEdgesFromInference', () => {
  it('returns results when all probes succeed', async () => {
    const ops = [
      op({ id: 'list_items', path: '/items', responseFields: [{ name: 'id', type: 'string', path: 'id' }] }),
    ]

    const executeFn = vi.fn().mockResolvedValue({ results: [{ id: 'abc' }] })
    const result = await discoverRuntimeEdgesFromInference(ops, executeFn)

    expect(result.probesAttempted).toBe(1)
    expect(result.probesSucceeded).toBe(1)
    expect(result.probeResults[0]!.success).toBe(true)
    expect(result.probeResults[0]!.values.length).toBeGreaterThan(0)
  })

  it('continues after individual probe failures', async () => {
    const ops = [
      op({ id: 'list_a', path: '/a' }),
      op({ id: 'list_b', path: '/b' }),
    ]

    const executeFn = vi.fn()
      .mockResolvedValueOnce({ index: 'foo' })
      .mockRejectedValueOnce(new Error('auth error'))

    const result = await discoverRuntimeEdgesFromInference(ops, executeFn)

    expect(result.probesAttempted).toBe(2)
    expect(result.probesSucceeded).toBe(1)
    expect(result.probeResults[0]!.success).toBe(true)
    expect(result.probeResults[1]!.success).toBe(false)
    expect(result.probeResults[1]!.values).toEqual([])
  })

  it('returns valid result when all probes fail', async () => {
    const ops = [
      op({ id: 'list_a', path: '/a' }),
      op({ id: 'list_b', path: '/b' }),
    ]

    const executeFn = vi.fn().mockRejectedValue(new Error('network error'))
    const result = await discoverRuntimeEdgesFromInference(ops, executeFn)

    expect(result.probesAttempted).toBe(2)
    expect(result.probesSucceeded).toBe(0)
    expect(result.edges).toEqual([])
    // Should not throw — returns a valid but empty result
  })

  it('stops probing on abort signal', async () => {
    const ops = [
      op({ id: 'list_a', path: '/a' }),
      op({ id: 'list_b', path: '/b' }),
      op({ id: 'list_c', path: '/c' }),
    ]

    const controller = new AbortController()
    let callCount = 0
    const executeFn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount >= 1) controller.abort()
      return { id: 'test' }
    })

    const result = await discoverRuntimeEdgesFromInference(ops, executeFn, {
      signal: controller.signal,
    })

    // Should have stopped after first probe (abort checked before each probe)
    expect(result.probesAttempted).toBeLessThanOrEqual(2)
  })

  it('calls onProgress with correct values', async () => {
    const ops = [
      op({ id: 'list_a', path: '/a' }),
      op({ id: 'list_b', path: '/b' }),
    ]

    const onProgress = vi.fn()
    const executeFn = vi.fn().mockResolvedValue({})

    await discoverRuntimeEdgesFromInference(ops, executeFn, { onProgress })

    expect(onProgress).toHaveBeenCalledTimes(2)
    // First call: completed=0, total=2
    expect(onProgress.mock.calls[0]![0]).toBe(0)
    expect(onProgress.mock.calls[0]![1]).toBe(2)
    // Second call: completed=1, total=2
    expect(onProgress.mock.calls[1]![0]).toBe(1)
    expect(onProgress.mock.calls[1]![1]).toBe(2)
  })

  it('respects maxProbes option', async () => {
    const ops = Array.from({ length: 10 }, (_, i) =>
      op({ id: `list_${i}`, path: `/resource-${i}` })
    )

    const executeFn = vi.fn().mockResolvedValue({})
    const result = await discoverRuntimeEdgesFromInference(ops, executeFn, { maxProbes: 3 })

    expect(result.probesAttempted).toBeLessThanOrEqual(3)
    expect(executeFn).toHaveBeenCalledTimes(result.probesAttempted)
  })
})
