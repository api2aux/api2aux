import { describe, it, expect } from 'vitest'
import { parseInput } from '../../src/parse'
import { InputFormat } from '../../src/types'

describe('XML parsing', () => {
  it('parses a simple XML element', () => {
    const xml = '<user><name>Alice</name><age>30</age></user>'
    const result = parseInput(xml)
    expect(result.inputFormat).toBe(InputFormat.XML)
    expect(result.data).toEqual({ name: 'Alice', age: 30 })
  })

  it('parses XML with attributes (prefix mode)', () => {
    const xml = '<book id="123" lang="en"><title>Wonderland</title></book>'
    const result = parseInput(xml)
    expect(result.data).toEqual({
      '@id': 123,
      '@lang': 'en',
      title: 'Wonderland',
    })
  })

  it('ignores attributes when configured', () => {
    const xml = '<book id="123"><title>Wonderland</title></book>'
    const result = parseInput(xml, {
      xmlOptions: { attributeMode: 'ignore' },
    })
    expect(result.data).toEqual({ title: 'Wonderland' })
  })

  it('groups attributes under nested key when configured', () => {
    const xml = '<book id="123"><title>Wonderland</title></book>'
    const result = parseInput(xml, {
      xmlOptions: { attributeMode: 'nested' },
    })
    const data = result.data as Record<string, unknown>
    expect(data['@attributes']).toEqual({ id: 123 })
    expect(data.title).toBe('Wonderland')
  })

  it('handles repeated sibling elements as arrays', () => {
    const xml = `
      <library>
        <book><title>A</title></book>
        <book><title>B</title></book>
        <book><title>C</title></book>
      </library>
    `
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    expect(Array.isArray(data.book)).toBe(true)
    expect((data.book as Array<Record<string, unknown>>).length).toBe(3)
  })

  it('coerces types in leaf text', () => {
    const xml = '<data><count>42</count><active>true</active><rate>3.14</rate></data>'
    const result = parseInput(xml)
    expect(result.data).toEqual({ count: 42, active: true, rate: 3.14 })
  })

  it('preserves strings when coercion is disabled', () => {
    const xml = '<data><count>42</count><active>true</active></data>'
    const result = parseInput(xml, { xmlOptions: { coerceTypes: false } })
    expect(result.data).toEqual({ count: '42', active: 'true' })
  })

  it('strips namespace prefixes by default', () => {
    const xml = '<ns:root xmlns:ns="http://example.com"><ns:name>Alice</ns:name></ns:root>'
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    expect(data.name).toBe('Alice')
  })

  it('skips XML declaration and unwraps root', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><root><value>test</value></root>'
    const result = parseInput(xml)
    expect(result.data).toEqual({ value: 'test' })
  })

  it('handles mixed content with text key', () => {
    const xml = '<p>Hello <b>world</b></p>'
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    expect(data['#text']).toBe('Hello')
    expect(data.b).toBe('world')
  })

  it('handles empty elements', () => {
    const xml = '<root><empty/><value>test</value></root>'
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    expect(data.value).toBe('test')
    expect('empty' in data).toBe(true)
  })

  it('handles deeply nested XML', () => {
    const xml = `
      <root>
        <level1>
          <level2>
            <level3>deep</level3>
          </level2>
        </level1>
      </root>
    `
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    const l1 = data.level1 as Record<string, unknown>
    const l2 = l1.level2 as Record<string, unknown>
    expect(l2.level3).toBe('deep')
  })

  it('handles RSS-like XML with attributes and arrays', () => {
    const xml = `
      <rss version="2.0">
        <channel>
          <title>My Feed</title>
          <item><title>Post 1</title><link>http://a.com</link></item>
          <item><title>Post 2</title><link>http://b.com</link></item>
        </channel>
      </rss>
    `
    const result = parseInput(xml)
    const data = result.data as Record<string, unknown>
    const channel = data.channel as Record<string, unknown>
    expect(channel.title).toBe('My Feed')
    expect(Array.isArray(channel.item)).toBe(true)
    expect((channel.item as Array<Record<string, unknown>>).length).toBe(2)
  })

  it('unwraps single root element', () => {
    const xml = '<wrapper><a>1</a><b>2</b></wrapper>'
    const result = parseInput(xml)
    // Should unwrap <wrapper> to just { a: 1, b: 2 }
    expect(result.data).toEqual({ a: 1, b: 2 })
  })
})
