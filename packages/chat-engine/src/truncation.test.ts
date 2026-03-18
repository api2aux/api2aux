import { describe, it, expect } from 'vitest'
import { truncateToolResult, summarizeToolResult } from './truncation'

describe('truncateToolResult', () => {
  it('returns JSON within the limit', () => {
    const data = { name: 'Alice', age: 30 }
    const result = truncateToolResult(data, 100)
    expect(result).toBe(JSON.stringify(data))
  })

  it('truncates JSON exceeding the limit', () => {
    const data = { long: 'x'.repeat(200) }
    const result = truncateToolResult(data, 50)
    expect(result.length).toBe(50)
  })

  it('uses default limit when not specified', () => {
    const data = { short: 'value' }
    const result = truncateToolResult(data)
    expect(result).toBe(JSON.stringify(data))
  })

  it('handles arrays', () => {
    const data = [1, 2, 3]
    const result = truncateToolResult(data, 100)
    expect(result).toBe('[1,2,3]')
  })

  it('handles null and primitives', () => {
    expect(truncateToolResult(null, 100)).toBe('null')
    expect(truncateToolResult(42, 100)).toBe('42')
    expect(truncateToolResult('hello', 100)).toBe('"hello"')
  })
})

describe('summarizeToolResult', () => {
  it('summarizes an array result', () => {
    const result = summarizeToolResult([1, 2, 3], 'list_users', { limit: '10' })
    expect(result).toBe('list_users(limit="10") → 3 items')
  })

  it('summarizes a single-item array', () => {
    const result = summarizeToolResult([{ id: 1 }], 'get_user', { id: '1' })
    expect(result).toBe('get_user(id="1") → 1 item')
  })

  it('summarizes an object result', () => {
    const result = summarizeToolResult({ id: 1, name: 'Alice' }, 'get_user', { id: '1' })
    expect(result).toBe('get_user(id="1") → 2 fields')
  })

  it('summarizes a single-field object', () => {
    const result = summarizeToolResult({ id: 1 }, 'get_user', { id: '1' })
    expect(result).toBe('get_user(id="1") → 1 field')
  })

  it('handles empty args', () => {
    const result = summarizeToolResult([1, 2], 'list_all', {})
    expect(result).toBe('list_all() → 2 items')
  })

  it('filters undefined and empty string args', () => {
    const result = summarizeToolResult([], 'search', { q: 'test', empty: '', undef: undefined })
    expect(result).toBe('search(q="test") → 0 items')
  })

  it('handles primitive result', () => {
    const result = summarizeToolResult(42, 'get_count', {})
    expect(result).toBe('get_count()')
  })
})
