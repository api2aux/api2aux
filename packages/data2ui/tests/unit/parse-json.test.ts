import { describe, it, expect } from 'vitest'
import { parseInput, detectFormat } from '../../src/parse'
import { InputFormat } from '../../src/types'

describe('JSON parsing', () => {
  it('parses a JSON object string', () => {
    const result = parseInput('{"name": "Alice", "age": 30}')
    expect(result.inputFormat).toBe(InputFormat.JSON)
    expect(result.data).toEqual({ name: 'Alice', age: 30 })
  })

  it('parses a JSON array string', () => {
    const result = parseInput('[1, 2, 3]')
    expect(result.inputFormat).toBe(InputFormat.JSON)
    expect(result.data).toEqual([1, 2, 3])
  })

  it('parses JSON primitives', () => {
    expect(parseInput('"hello"').data).toBe('hello')
    expect(parseInput('42').data).toBe(42)
    expect(parseInput('true').data).toBe(true)
    expect(parseInput('false').data).toBe(false)
    expect(parseInput('null').data).toBe(null)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseInput('{invalid}', { inputFormat: InputFormat.JSON }))
      .toThrow('JSON parse error')
  })

  it('passes through non-string input as JSON format', () => {
    const data = { foo: 'bar' }
    const result = parseInput(data)
    expect(result.data).toBe(data)
    expect(result.inputFormat).toBe(InputFormat.JSON)
  })

  it('preserves forced format for non-string input', () => {
    const result = parseInput({ x: 1 }, { inputFormat: InputFormat.YAML })
    expect(result.inputFormat).toBe(InputFormat.YAML)
  })
})

describe('detectFormat', () => {
  it('detects JSON objects', () => {
    expect(detectFormat('{"key": "value"}')).toBe(InputFormat.JSON)
  })

  it('detects JSON arrays', () => {
    expect(detectFormat('[1, 2, 3]')).toBe(InputFormat.JSON)
  })

  it('detects JSON primitives', () => {
    expect(detectFormat('"hello"')).toBe(InputFormat.JSON)
    expect(detectFormat('42')).toBe(InputFormat.JSON)
    expect(detectFormat('true')).toBe(InputFormat.JSON)
    expect(detectFormat('null')).toBe(InputFormat.JSON)
  })

  it('detects XML', () => {
    expect(detectFormat('<root><item>1</item></root>')).toBe(InputFormat.XML)
    expect(detectFormat('<?xml version="1.0"?><root/>')).toBe(InputFormat.XML)
  })

  it('detects XML with leading whitespace', () => {
    expect(detectFormat('  \n  <root/>')).toBe(InputFormat.XML)
  })

  it('defaults to YAML for other content', () => {
    expect(detectFormat('name: Alice\nage: 30')).toBe(InputFormat.YAML)
    expect(detectFormat('- item1\n- item2')).toBe(InputFormat.YAML)
  })
})
