/**
 * Unit tests for domain auto-detection engine.
 */

import { describe, it, expect } from 'vitest'
import { detectDomain } from './domain-detector'
import type { DomainSignature, OperationContext } from '../types/enrichment'

function mockOp(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    id: 'op1',
    path: '/api/v1/resource',
    method: 'GET',
    tags: [],
    parameters: [],
    responseFieldNames: [],
    ...overrides,
  }
}

function makeSigs(entries: Array<[string, DomainSignature]>): Map<string, DomainSignature> {
  return new Map(entries)
}

function makeNames(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries)
}

describe('detectDomain', () => {
  it('returns empty array for empty operations', () => {
    const sigs = makeSigs([['@health/base', { keywords: ['patient'] }]])
    const names = makeNames([['@health/base', 'Healthcare']])
    expect(detectDomain([], sigs, names)).toEqual([])
  })

  it('returns empty array for empty signatures', () => {
    const ops = [mockOp()]
    expect(detectDomain(ops, new Map(), new Map())).toEqual([])
  })

  it('detects healthcare domain from FHIR-like API', () => {
    const ops = [
      mockOp({ id: 'getPatient', path: '/Patient/{id}', tags: ['fhir'], responseFieldNames: ['mrn', 'name', 'birthDate'] }),
      mockOp({ id: 'listDiagnosis', path: '/Condition', tags: ['fhir'], summary: 'List patient diagnosis records', responseFieldNames: ['code', 'status'] }),
      mockOp({ id: 'getObservation', path: '/Observation', tags: ['fhir'], responseFieldNames: ['value', 'effectiveDateTime'] }),
    ]
    const sig: DomainSignature = {
      keywords: ['patient', 'diagnosis', 'fhir'],
      pathPatterns: [/\/Patient\//i],
      fieldPatterns: [/^mrn$/i],
    }
    const sigs = makeSigs([['@health/base', sig]])
    const names = makeNames([['@health/base', 'Healthcare']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(1)
    expect(results[0].pluginId).toBe('@health/base')
    expect(results[0].pluginName).toBe('Healthcare')
    expect(results[0].score).toBeGreaterThan(0.5)
    expect(results[0].matchedSignals.length).toBeGreaterThan(0)
  })

  it('detects finance domain from banking API', () => {
    const ops = [
      mockOp({ id: 'listAccounts', path: '/accounts', tags: ['banking'], summary: 'List customer accounts', responseFieldNames: ['accountId', 'balance'] }),
      mockOp({ id: 'getTransaction', path: '/accounts/{id}/transactions', tags: ['banking'], responseFieldNames: ['transactionId', 'amount'] }),
    ]
    const sig: DomainSignature = {
      keywords: ['account', 'transaction', 'banking', 'balance'],
      pathPatterns: [/\/accounts/i],
    }
    const sigs = makeSigs([['@finance/base', sig]])
    const names = makeNames([['@finance/base', 'Finance']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(1)
    expect(results[0].pluginId).toBe('@finance/base')
    expect(results[0].score).toBeGreaterThan(0.3)
  })

  it('filters out low-score APIs below threshold', () => {
    const ops = [
      mockOp({ id: 'listPets', path: '/pets', tags: ['pets'], responseFieldNames: ['name', 'breed'] }),
    ]
    const sig: DomainSignature = {
      keywords: ['patient', 'diagnosis', 'fhir', 'medication', 'observation'],
      threshold: 0.5,
    }
    const sigs = makeSigs([['@health/base', sig]])
    const names = makeNames([['@health/base', 'Healthcare']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(0)
  })

  it('handles signature with only keywords (no patterns)', () => {
    const ops = [
      mockOp({ id: 'listClaims', path: '/claims', tags: ['insurance'], summary: 'List insurance claims' }),
      mockOp({ id: 'getPolicy', path: '/policies/{id}', summary: 'Get policy details' }),
    ]
    const sig: DomainSignature = {
      keywords: ['claim', 'policy', 'insurance', 'underwriting'],
    }
    const sigs = makeSigs([['@insurance/base', sig]])
    const names = makeNames([['@insurance/base', 'Insurance']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(1)
    // With only keywords, full weight goes to keyword matching (3/4 matched)
    expect(results[0].score).toBe(0.75)
  })

  it('scores multiple signatures independently', () => {
    const ops = [
      mockOp({ id: 'getPatient', path: '/Patient/{id}', tags: ['fhir'], responseFieldNames: ['mrn'] }),
      mockOp({ id: 'listAccounts', path: '/accounts', tags: ['banking'], responseFieldNames: ['balance'] }),
    ]
    const healthSig: DomainSignature = {
      keywords: ['patient', 'fhir'],
      pathPatterns: [/\/Patient\//i],
      fieldPatterns: [/^mrn$/i],
    }
    const financeSig: DomainSignature = {
      keywords: ['account', 'banking'],
      pathPatterns: [/\/accounts/i],
      fieldPatterns: [/^balance$/i],
    }
    const sigs = makeSigs([
      ['@health/base', healthSig],
      ['@finance/base', financeSig],
    ])
    const names = makeNames([
      ['@health/base', 'Healthcare'],
      ['@finance/base', 'Finance'],
    ])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(2)
    expect(results.map(r => r.pluginId)).toContain('@health/base')
    expect(results.map(r => r.pluginId)).toContain('@finance/base')
  })

  it('sorts results by score descending', () => {
    const ops = [
      mockOp({ id: 'getPatient', path: '/Patient/{id}', tags: ['fhir', 'health'], summary: 'Get patient by ID', responseFieldNames: ['mrn', 'name'] }),
    ]
    // Strong match
    const healthSig: DomainSignature = {
      keywords: ['patient', 'fhir', 'health'],
      pathPatterns: [/\/Patient\//i],
      fieldPatterns: [/^mrn$/i],
    }
    // Weak match (only one keyword partially found)
    const financeSig: DomainSignature = {
      keywords: ['patient', 'billing'],
      threshold: 0.2,
    }
    const sigs = makeSigs([
      ['@finance/base', financeSig],
      ['@health/base', healthSig],
    ])
    const names = makeNames([
      ['@health/base', 'Healthcare'],
      ['@finance/base', 'Finance'],
    ])

    const results = detectDomain(ops, sigs, names)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].pluginId).toBe('@health/base')
  })

  it('uses plugin ID as name when name not provided', () => {
    const ops = [
      mockOp({ id: 'listClaims', path: '/claims', tags: ['insurance'] }),
    ]
    const sig: DomainSignature = { keywords: ['claim', 'insurance'] }
    const sigs = makeSigs([['@insurance/base', sig]])
    // Empty names map
    const names = new Map<string, string>()

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(1)
    expect(results[0].pluginName).toBe('@insurance/base')
  })

  it('matches keywords in operation descriptions', () => {
    const ops = [
      mockOp({ id: 'op1', path: '/api/v1/data', description: 'Retrieve patient medical records' }),
    ]
    const sig: DomainSignature = { keywords: ['patient', 'medical'] }
    const sigs = makeSigs([['@health/base', sig]])
    const names = makeNames([['@health/base', 'Healthcare']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(1.0)
  })

  it('uses default threshold of 0.3', () => {
    const ops = [
      mockOp({ id: 'op1', path: '/something', tags: ['misc'] }),
    ]
    // 1 out of 4 keywords matches nothing — score = 0
    const sig: DomainSignature = { keywords: ['patient', 'diagnosis', 'fhir', 'medication'] }
    const sigs = makeSigs([['@health/base', sig]])
    const names = makeNames([['@health/base', 'Healthcare']])

    const results = detectDomain(ops, sigs, names)
    expect(results).toHaveLength(0) // 0 < 0.3 default threshold
  })
})
