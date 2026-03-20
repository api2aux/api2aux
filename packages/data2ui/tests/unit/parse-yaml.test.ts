import { describe, it, expect } from 'vitest'
import { parseInput } from '../../src/parse'
import { InputFormat } from '../../src/types'

describe('YAML parsing', () => {
  it('parses a YAML object', () => {
    const result = parseInput('name: Alice\nage: 30', { inputFormat: InputFormat.YAML })
    expect(result.inputFormat).toBe(InputFormat.YAML)
    expect(result.data).toEqual({ name: 'Alice', age: 30 })
  })

  it('parses a YAML array', () => {
    const result = parseInput('- apple\n- banana\n- cherry', { inputFormat: InputFormat.YAML })
    expect(result.data).toEqual(['apple', 'banana', 'cherry'])
  })

  it('parses nested YAML', () => {
    const yaml = `
user:
  name: Alice
  address:
    city: Wonderland
    zip: "12345"
`
    const result = parseInput(yaml, { inputFormat: InputFormat.YAML })
    expect(result.data).toEqual({
      user: {
        name: 'Alice',
        address: { city: 'Wonderland', zip: '12345' },
      },
    })
  })

  it('auto-detects YAML format', () => {
    const result = parseInput('name: Bob\nrole: admin')
    expect(result.inputFormat).toBe(InputFormat.YAML)
    expect(result.data).toEqual({ name: 'Bob', role: 'admin' })
  })

  it('throws on invalid YAML', () => {
    expect(() => parseInput(':\n  :\n    - :', { inputFormat: InputFormat.YAML }))
      .toThrow('YAML parse error')
  })
})
