/**
 * Unit tests for UI hint matching.
 */

import { describe, it, expect } from 'vitest'
import { matchUIHint } from '../../src/select/hint-matcher'
import type { UIComponentHint } from '@api2aux/semantic-analysis'

describe('matchUIHint', () => {
  it('returns null for undefined hints', () => {
    expect(matchUIHint('$.items[].price', undefined)).toBeNull()
  })

  it('returns null for empty hints array', () => {
    expect(matchUIHint('$.items[].price', [])).toBeNull()
  })

  it('matches glob pattern *.price against nested path', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '*.price', suggestedComponent: 'core/currency', confidence: 0.9 },
    ]
    const result = matchUIHint('$.items[].price', hints)
    expect(result).not.toBeNull()
    expect(result!.componentType).toBe('core/currency')
    expect(result!.confidence).toBe(0.9)
    expect(result!.reason).toBe('plugin-hint')
  })

  it('matches exact path', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '$.items[].thumbnail', suggestedComponent: 'core/image', confidence: 0.85 },
    ]
    const result = matchUIHint('$.items[].thumbnail', hints)
    expect(result).not.toBeNull()
    expect(result!.componentType).toBe('core/image')
  })

  it('returns null when no pattern matches', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '*.email', suggestedComponent: 'core/email-link', confidence: 0.9 },
    ]
    expect(matchUIHint('$.items[].name', hints)).toBeNull()
  })

  it('picks highest confidence when multiple hints match', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '*.price', suggestedComponent: 'core/number', confidence: 0.8 },
      { fieldPattern: '*.price', suggestedComponent: 'core/currency', confidence: 0.95 },
    ]
    const result = matchUIHint('$.product.price', hints)
    expect(result).not.toBeNull()
    expect(result!.componentType).toBe('core/currency')
    expect(result!.confidence).toBe(0.95)
  })

  it('filters out hints below SMART_DEFAULT_THRESHOLD', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '*.price', suggestedComponent: 'core/currency', confidence: 0.5 },
    ]
    expect(matchUIHint('$.items[].price', hints)).toBeNull()
  })

  it('matches suffix pattern without leading dot', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: 'thumbnail', suggestedComponent: 'core/image', confidence: 0.85 },
    ]
    const result = matchUIHint('$.items[].thumbnail', hints)
    expect(result).not.toBeNull()
    expect(result!.componentType).toBe('core/image')
  })

  it('matches glob against top-level path', () => {
    const hints: UIComponentHint[] = [
      { fieldPattern: '*.avatar', suggestedComponent: 'core/image', confidence: 0.9 },
    ]
    const result = matchUIHint('$.avatar', hints)
    expect(result).not.toBeNull()
    expect(result!.componentType).toBe('core/image')
  })
})
