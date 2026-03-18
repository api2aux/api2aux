import { describe, it, expect } from 'vitest'
import { isPaginationParam } from './param-filter'

describe('isPaginationParam', () => {
  it('identifies common pagination params', () => {
    expect(isPaginationParam('limit')).toBe(true)
    expect(isPaginationParam('page')).toBe(true)
    expect(isPaginationParam('offset')).toBe(true)
    expect(isPaginationParam('cursor')).toBe(true)
    expect(isPaginationParam('skip')).toBe(true)
    expect(isPaginationParam('pageSize')).toBe(true)
    expect(isPaginationParam('per_page')).toBe(true)
    expect(isPaginationParam('sort')).toBe(true)
    expect(isPaginationParam('orderBy')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPaginationParam('LIMIT')).toBe(true)
    expect(isPaginationParam('Page')).toBe(true)
    expect(isPaginationParam('OFFSET')).toBe(true)
  })

  it('does not match semantic params', () => {
    expect(isPaginationParam('userId')).toBe(false)
    expect(isPaginationParam('moleculeChemblId')).toBe(false)
    expect(isPaginationParam('confidence')).toBe(false)
    expect(isPaginationParam('targetChemblId')).toBe(false)
    expect(isPaginationParam('index')).toBe(false)
    expect(isPaginationParam('name')).toBe(false)
  })
})
