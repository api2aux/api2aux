import { describe, it, expect, vi } from 'vitest'
import { parseGraphQLSchema } from './parser'
import { SpecFormat, HttpMethod, ContentType } from '../../core/types'
import { TypeKind } from './introspection'
import type { IntrospectionSchema, IntrospectionType, IntrospectionField, IntrospectionTypeRef } from './introspection'

// === Test helpers ===

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

function inputRef(name: string): IntrospectionTypeRef {
  return { kind: TypeKind.INPUT_OBJECT, name, ofType: null }
}

function makeField(name: string, type: IntrospectionTypeRef, args: IntrospectionField['args'] = []): IntrospectionField {
  return { name, description: null, args, type }
}

function makeObjectType(name: string, fields: IntrospectionField[]): IntrospectionType {
  return { kind: TypeKind.OBJECT, name, fields }
}

function makeEnumType(name: string, values: string[]): IntrospectionType {
  return { kind: TypeKind.ENUM, name, enumValues: values.map(v => ({ name: v })) }
}

function makeInputType(name: string): IntrospectionType {
  return { kind: TypeKind.INPUT_OBJECT, name, inputFields: [{ name: 'field', type: scalar('String') }] }
}

function makeSchema(opts: {
  queryFields?: IntrospectionField[]
  mutationFields?: IntrospectionField[]
  subscriptionFields?: IntrospectionField[]
  extraTypes?: IntrospectionType[]
}): { data: { __schema: IntrospectionSchema } } {
  const types: IntrospectionType[] = [
    // Built-in scalars
    { kind: TypeKind.SCALAR, name: 'String' },
    { kind: TypeKind.SCALAR, name: 'Int' },
    { kind: TypeKind.SCALAR, name: 'Float' },
    { kind: TypeKind.SCALAR, name: 'Boolean' },
    { kind: TypeKind.SCALAR, name: 'ID' },
  ]

  let queryType: { name: string } | null = null
  let mutationType: { name: string } | null = null
  let subscriptionType: { name: string } | null = null

  if (opts.queryFields) {
    queryType = { name: 'Query' }
    types.push({ kind: TypeKind.OBJECT, name: 'Query', fields: opts.queryFields })
  }

  if (opts.mutationFields) {
    mutationType = { name: 'Mutation' }
    types.push({ kind: TypeKind.OBJECT, name: 'Mutation', fields: opts.mutationFields })
  }

  if (opts.subscriptionFields) {
    subscriptionType = { name: 'Subscription' }
    types.push({ kind: TypeKind.OBJECT, name: 'Subscription', fields: opts.subscriptionFields })
  }

  if (opts.extraTypes) {
    types.push(...opts.extraTypes)
  }

  return {
    data: {
      __schema: { queryType, mutationType, subscriptionType, types },
    },
  }
}

// === Tests ===

describe('parseGraphQLSchema', () => {
  it('parses minimal introspection with one query field', async () => {
    const input = makeSchema({
      queryFields: [makeField('hello', scalar('String'))],
    })

    const api = await parseGraphQLSchema(input)

    expect(api.specFormat).toBe(SpecFormat.GRAPHQL)
    expect(api.version).toBe('1.0.0')
    expect(api.operations).toHaveLength(1)
    expect(api.operations[0].id).toBe('hello')
    expect(api.operations[0].method).toBe(HttpMethod.POST)
    expect(api.operations[0].tags).toEqual(['query'])
    expect(api.operations[0].parameters).toEqual([])
  })

  it('parses queries and mutations', async () => {
    const input = makeSchema({
      queryFields: [makeField('users', list(objectRef('User')))],
      mutationFields: [makeField('createUser', objectRef('User'), [
        { name: 'name', type: nonNull(scalar('String')), description: 'User name' },
      ])],
      extraTypes: [makeObjectType('User', [
        makeField('id', nonNull(scalar('ID'))),
        makeField('name', scalar('String')),
      ])],
    })

    const api = await parseGraphQLSchema(input)

    expect(api.operations).toHaveLength(2)

    const queryOp = api.operations.find(o => o.id === 'users')!
    expect(queryOp.tags).toEqual(['query'])
    expect(queryOp.requestBody).toBeUndefined() // no args

    const mutationOp = api.operations.find(o => o.id === 'mutation_createUser')!
    expect(mutationOp.tags).toEqual(['mutation'])
    expect(mutationOp.requestBody).toBeDefined()
    expect(mutationOp.requestBody!.schema.properties!['name']).toBeDefined()
    expect(mutationOp.requestBody!.schema.required).toEqual(['name'])
  })

  it('prefixes mutation IDs with mutation_ to avoid collisions', async () => {
    const input = makeSchema({
      queryFields: [makeField('user', objectRef('User'))],
      mutationFields: [makeField('user', objectRef('User'))],
      extraTypes: [makeObjectType('User', [makeField('id', scalar('ID'))])],
    })

    const api = await parseGraphQLSchema(input)

    const ids = api.operations.map(o => o.id)
    expect(ids).toContain('user')
    expect(ids).toContain('mutation_user')
    expect(new Set(ids).size).toBe(2) // no collisions
  })

  it('tags subscriptions but does not add buildBody', async () => {
    const input = makeSchema({
      queryFields: [makeField('hello', scalar('String'))],
      subscriptionFields: [makeField('onMessage', scalar('String'))],
    })

    const api = await parseGraphQLSchema(input)

    const sub = api.operations.find(o => o.id === 'subscription_onMessage')!
    expect(sub.tags).toEqual(['subscription'])
    expect(sub.buildBody).toBeUndefined()
  })

  it('maps argument types correctly', async () => {
    const input = makeSchema({
      queryFields: [makeField('search', list(objectRef('Result')), [
        { name: 'query', type: nonNull(scalar('String')) },
        { name: 'limit', type: scalar('Int') },
        { name: 'score', type: scalar('Float') },
        { name: 'active', type: scalar('Boolean') },
        { name: 'id', type: scalar('ID') },
        { name: 'status', type: enumRef('Status') },
        { name: 'filter', type: inputRef('FilterInput') },
        { name: 'tags', type: list(scalar('String')) },
      ])],
      extraTypes: [
        makeObjectType('Result', [makeField('id', scalar('ID'))]),
        makeEnumType('Status', ['ACTIVE', 'INACTIVE']),
        makeInputType('FilterInput'),
      ],
    })

    const api = await parseGraphQLSchema(input)
    const op = api.operations[0]
    const props = op.requestBody!.schema.properties!

    expect(props['query'].type).toBe('string')
    expect(props['limit'].type).toBe('integer')
    expect(props['score'].type).toBe('number')
    expect(props['active'].type).toBe('boolean')
    expect(props['id'].type).toBe('string')
    expect(props['status'].type).toBe('string')
    expect(props['status'].enum).toEqual(['ACTIVE', 'INACTIVE'])
    expect(props['filter'].type).toBe('object')
    expect(props['filter'].nested).toBe(true)
    expect(props['tags'].type).toBe('array')

    // Required: only 'query' is NON_NULL
    expect(op.requestBody!.schema.required).toEqual(['query'])
  })

  it('buildBody produces { query, variables }', async () => {
    const input = makeSchema({
      queryFields: [makeField('user', objectRef('User'), [
        { name: 'id', type: nonNull(scalar('ID')) },
      ])],
      extraTypes: [makeObjectType('User', [
        makeField('id', scalar('ID')),
        makeField('name', scalar('String')),
      ])],
    })

    const api = await parseGraphQLSchema(input)
    const op = api.operations[0]

    expect(op.buildBody).toBeDefined()
    const body = op.buildBody!({ id: '123' })
    expect(body).toHaveProperty('query')
    expect(body).toHaveProperty('variables', { id: '123' })
    expect((body as { query: string }).query).toContain('query user')
  })

  it('buildBody filters out undeclared args from variables', async () => {
    const input = makeSchema({
      queryFields: [makeField('user', objectRef('User'), [
        { name: 'id', type: nonNull(scalar('ID')) },
      ])],
      extraTypes: [makeObjectType('User', [
        makeField('id', scalar('ID')),
        makeField('name', scalar('String')),
      ])],
    })

    const api = await parseGraphQLSchema(input)
    const op = api.operations[0]
    const body = op.buildBody!({ id: '123', extraKey: 'should-be-excluded', body: 'also-excluded' }) as { variables: Record<string, unknown> }
    expect(body.variables).toEqual({ id: '123' })
  })

  it('fetches introspection from URL', async () => {
    const schemaData = makeSchema({
      queryFields: [makeField('ping', scalar('String'))],
    })

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(schemaData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const api = await parseGraphQLSchema('https://api.example.com/graphql', {
      fetch: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/graphql')
    expect(api.baseUrl).toBe('https://api.example.com')
    expect(api.operations).toHaveLength(1)
    expect(api.operations[0].path).toBe('/graphql')
  })

  it('throws on failed introspection HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )

    await expect(
      parseGraphQLSchema('https://api.example.com/graphql', { fetch: mockFetch }),
    ).rejects.toThrow('introspection failed with HTTP 404')
  })

  it('throws on network error during introspection', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      parseGraphQLSchema('https://api.example.com/graphql', { fetch: mockFetch }),
    ).rejects.toThrow('ECONNREFUSED')
  })

  it('throws on invalid introspection object', async () => {
    await expect(
      parseGraphQLSchema({ notASchema: true }),
    ).rejects.toThrow('Invalid GraphQL introspection result')
  })

  it('throws on non-URL string input', async () => {
    await expect(
      parseGraphQLSchema('type Query { hello: String }'),
    ).rejects.toThrow('SDL parsing is not yet supported')
  })

  it('accepts { __schema: ... } shape without data wrapper', async () => {
    const schema: IntrospectionSchema = {
      queryType: { name: 'Query' },
      mutationType: null,
      subscriptionType: null,
      types: [
        { kind: TypeKind.SCALAR, name: 'String' },
        { kind: TypeKind.OBJECT, name: 'Query', fields: [makeField('hello', scalar('String'))] },
      ],
    }

    const api = await parseGraphQLSchema({ __schema: schema })
    expect(api.operations).toHaveLength(1)
    expect(api.operations[0].id).toBe('hello')
  })

  it('sets contentType to JSON on requestBody', async () => {
    const input = makeSchema({
      queryFields: [makeField('search', scalar('String'), [
        { name: 'q', type: scalar('String') },
      ])],
    })

    const api = await parseGraphQLSchema(input)
    expect(api.operations[0].requestBody!.contentType).toBe(ContentType.JSON)
  })

  it('uses custom endpoint option for baseUrl', async () => {
    const input = makeSchema({
      queryFields: [makeField('hello', scalar('String'))],
    })

    const api = await parseGraphQLSchema(input, { endpoint: 'https://custom.api.com/gql' })
    expect(api.baseUrl).toBe('https://custom.api.com')
    expect(api.operations[0].path).toBe('/gql')
  })

  it('generates response schema from return type', async () => {
    const input = makeSchema({
      queryFields: [makeField('user', objectRef('User'))],
      extraTypes: [makeObjectType('User', [
        makeField('id', nonNull(scalar('ID'))),
        makeField('name', scalar('String')),
        makeField('age', scalar('Int')),
      ])],
    })

    const api = await parseGraphQLSchema(input)
    const schema = api.operations[0].responseSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema).toHaveProperty('properties')
    const props = schema.properties as Record<string, { type: string }>
    expect(props['id'].type).toBe('string')
    expect(props['name'].type).toBe('string')
    expect(props['age'].type).toBe('integer')
  })
})
