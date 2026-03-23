import { describe, it, expect } from 'vitest'
import { buildQueryString, formatTypeRef, unwrapType, isNonNull } from './query-builder'
import { TypeKind } from './introspection'
import type { IntrospectionField, IntrospectionType, IntrospectionTypeRef } from './introspection'

function scalar(name: string): IntrospectionTypeRef {
  return { kind: TypeKind.SCALAR, name, ofType: null }
}

function nonNull(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: TypeKind.NON_NULL, name: null, ofType: inner }
}

function list(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: TypeKind.LIST, name: null, ofType: inner }
}

function objectRef(name: string): IntrospectionTypeRef {
  return { kind: TypeKind.OBJECT, name, ofType: null }
}

function enumRef(name: string): IntrospectionTypeRef {
  return { kind: TypeKind.ENUM, name, ofType: null }
}

function makeType(name: string, fields: IntrospectionField[]): IntrospectionType {
  return { kind: TypeKind.OBJECT, name, fields }
}

function makeField(name: string, type: IntrospectionTypeRef, args: IntrospectionField['args'] = []): IntrospectionField {
  return { name, type, args, description: null }
}

describe('formatTypeRef', () => {
  it('formats scalar', () => {
    expect(formatTypeRef(scalar('String'))).toBe('String')
  })

  it('formats non-null scalar', () => {
    expect(formatTypeRef(nonNull(scalar('ID')))).toBe('ID!')
  })

  it('formats list', () => {
    expect(formatTypeRef(list(scalar('String')))).toBe('[String]')
  })

  it('formats non-null list of non-null', () => {
    expect(formatTypeRef(nonNull(list(nonNull(scalar('String')))))).toBe('[String!]!')
  })
})

describe('unwrapType', () => {
  it('unwraps NON_NULL', () => {
    expect(unwrapType(nonNull(scalar('String')))).toEqual(scalar('String'))
  })

  it('unwraps LIST(NON_NULL(OBJECT))', () => {
    expect(unwrapType(list(nonNull(objectRef('User'))))).toEqual(objectRef('User'))
  })

  it('returns scalar as-is', () => {
    expect(unwrapType(scalar('Int'))).toEqual(scalar('Int'))
  })
})

describe('isNonNull', () => {
  it('returns true for NON_NULL', () => {
    expect(isNonNull(nonNull(scalar('String')))).toBe(true)
  })

  it('returns false for nullable', () => {
    expect(isNonNull(scalar('String'))).toBe(false)
  })
})

describe('buildQueryString', () => {
  it('generates query for scalar return type', () => {
    const field = makeField('serverTime', scalar('String'))
    const typeMap = new Map<string, IntrospectionType>()
    const result = buildQueryString('query', field, typeMap)
    expect(result).toBe('query serverTime { serverTime }')
  })

  it('generates query with arguments', () => {
    const field: IntrospectionField = {
      name: 'user',
      description: null,
      args: [
        { name: 'id', type: nonNull(scalar('ID')), description: null, defaultValue: null },
      ],
      type: objectRef('User'),
    }
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('name', scalar('String')),
        makeField('email', scalar('String')),
      ])],
    ])
    const result = buildQueryString('query', field, typeMap)
    expect(result).toBe('query user($id: ID!) { user(id: $id) { name email } }')
  })

  it('recurses into nested objects up to maxDepth', () => {
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('name', scalar('String')),
        makeField('address', objectRef('Address')),
      ])],
      ['Address', makeType('Address', [
        makeField('street', scalar('String')),
        makeField('city', scalar('String')),
      ])],
    ])
    const field = makeField('user', objectRef('User'))
    const result = buildQueryString('query', field, typeMap, 2)
    expect(result).toBe('query user { user { name address { street city } } }')
  })

  it('stops at maxDepth', () => {
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('name', scalar('String')),
        makeField('address', objectRef('Address')),
      ])],
      ['Address', makeType('Address', [
        makeField('street', scalar('String')),
        makeField('location', objectRef('Location')),
      ])],
      ['Location', makeType('Location', [
        makeField('lat', scalar('Float')),
        makeField('lng', scalar('Float')),
      ])],
    ])
    const field = makeField('user', objectRef('User'))
    // maxDepth 1: User fields + Address scalars, but not Location
    const result = buildQueryString('query', field, typeMap, 1)
    expect(result).toBe('query user { user { name address { street } } }')
  })

  it('handles circular type references', () => {
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('name', scalar('String')),
        makeField('friend', objectRef('User')),
      ])],
    ])
    const field = makeField('user', objectRef('User'))
    const result = buildQueryString('query', field, typeMap, 3)
    // Should not infinite loop — circular ref stops recursion
    expect(result).toContain('name')
    expect(result).not.toContain('friend { name friend')
  })

  it('handles list return types', () => {
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('id', nonNull(scalar('ID'))),
        makeField('name', scalar('String')),
      ])],
    ])
    const field = makeField('users', nonNull(list(nonNull(objectRef('User')))))
    const result = buildQueryString('query', field, typeMap)
    expect(result).toBe('query users { users { id name } }')
  })

  it('includes enum fields in selection', () => {
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('name', scalar('String')),
        makeField('role', enumRef('Role')),
      ])],
    ])
    const field = makeField('user', objectRef('User'))
    const result = buildQueryString('query', field, typeMap)
    expect(result).toBe('query user { user { name role } }')
  })

  it('generates mutation string', () => {
    const field: IntrospectionField = {
      name: 'createUser',
      description: null,
      args: [
        { name: 'name', type: nonNull(scalar('String')), description: null, defaultValue: null },
      ],
      type: objectRef('User'),
    }
    const typeMap = new Map<string, IntrospectionType>([
      ['User', makeType('User', [
        makeField('id', nonNull(scalar('ID'))),
        makeField('name', scalar('String')),
      ])],
    ])
    const result = buildQueryString('mutation', field, typeMap)
    expect(result).toBe('mutation createUser($name: String!) { createUser(name: $name) { id name } }')
  })

  it('handles multiple arguments', () => {
    const field: IntrospectionField = {
      name: 'search',
      description: null,
      args: [
        { name: 'query', type: nonNull(scalar('String')), description: null, defaultValue: null },
        { name: 'limit', type: scalar('Int'), description: null, defaultValue: null },
      ],
      type: list(objectRef('Result')),
    }
    const typeMap = new Map<string, IntrospectionType>([
      ['Result', makeType('Result', [
        makeField('title', scalar('String')),
        makeField('score', scalar('Float')),
      ])],
    ])
    const result = buildQueryString('query', field, typeMap)
    expect(result).toBe('query search($query: String!, $limit: Int) { search(query: $query, limit: $limit) { title score } }')
  })
})
