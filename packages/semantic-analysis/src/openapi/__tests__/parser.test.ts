import { describe, it, expect } from 'vitest'
import { parseOpenAPISpec } from '../parser'

// OpenAPI 3.0 fixture
const openapi3Fixture = {
  openapi: '3.0.3',
  info: {
    title: 'Pet Store API',
    version: '1.0.0',
  },
  servers: [
    { url: 'https://api.example.com/v1' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for authentication',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
      BasicAuth: {
        type: 'http',
        scheme: 'basic',
      },
    },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        description: 'Returns a list of pets',
        tags: ['pets'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of items',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by status',
            required: true,
            schema: {
              type: 'string',
              enum: ['available', 'pending', 'sold'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          required: true,
          description: 'Pet to create',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Fido' },
                  age: { type: 'integer' },
                  status: { type: 'string', enum: ['available', 'pending', 'sold'] },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
          },
        },
      },
    },
    '/pets/{petId}': {
      parameters: [
        {
          name: 'petId',
          in: 'path',
          required: true,
          description: 'Pet ID',
          schema: {
            type: 'integer',
          },
        },
      ],
      get: {
        operationId: 'getPetById',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [
          {
            name: 'fields',
            in: 'query',
            description: 'Fields to include',
            required: false,
            schema: {
              type: 'string',
              maxLength: 100,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        tags: ['pets'],
        responses: {
          '204': {
            description: 'Deleted',
          },
        },
      },
    },
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List all users',
        tags: ['users'],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

// Swagger 2.0 fixture
const swagger2Fixture = {
  swagger: '2.0',
  info: {
    title: 'Legacy API',
    version: '2.5.0',
  },
  host: 'api.legacy.com',
  basePath: '/api/v2',
  schemes: ['https'],
  securityDefinitions: {
    api_key: {
      type: 'apiKey',
      in: 'query',
      name: 'api_key',
    },
    basic_auth: {
      type: 'basic',
      description: 'HTTP Basic Authentication',
    },
  },
  paths: {
    '/items': {
      get: {
        operationId: 'getItems',
        summary: 'Get items',
        tags: ['items'],
        parameters: [
          {
            name: 'search',
            in: 'query',
            description: 'Search query',
            required: false,
            type: 'string',
            format: 'email',
          },
        ],
        responses: {
          '200': {
            description: 'Success',
            schema: {
              type: 'array',
              items: {
                type: 'object',
              },
            },
          },
        },
      },
    },
  },
}

// Empty spec fixture
const emptySpecFixture = {
  openapi: '3.0.0',
  info: {
    title: 'Empty API',
    version: '1.0.0',
  },
  servers: [{ url: 'https://empty.com' }],
  paths: {},
}

describe('parseOpenAPISpec', () => {
  it('parses OpenAPI 3.0 spec correctly', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    expect(result.title).toBe('Pet Store API')
    expect(result.version).toBe('1.0.0')
    expect(result.rawSpecVersion).toBe('3.0.3')
    expect(result.specFormat).toBe('openapi-3')
    expect(result.baseUrl).toBe('https://api.example.com/v1')
    // 3 GET + 1 POST + 1 DELETE = 5 operations
    expect(result.operations).toHaveLength(5)
  })

  it('parses Swagger 2.0 spec correctly', async () => {
    const result = await parseOpenAPISpec(swagger2Fixture)

    expect(result.title).toBe('Legacy API')
    expect(result.version).toBe('2.5.0')
    expect(result.rawSpecVersion).toBe('2.0')
    expect(result.specFormat).toBe('openapi-2')
    expect(result.baseUrl).toBe('https://api.legacy.com/api/v2')
    expect(result.operations).toHaveLength(1)
  })

  it('extracts GET, POST, and DELETE operations', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const ids = result.operations.map(op => op.id)
    expect(ids).toContain('listPets')
    expect(ids).toContain('getPetById')
    expect(ids).toContain('listUsers')
    expect(ids).toContain('createPet')
    expect(ids).toContain('deletePet')

    const createPet = result.operations.find(op => op.id === 'createPet')
    expect(createPet!.method).toBe('POST')

    const deletePet = result.operations.find(op => op.id === 'deletePet')
    expect(deletePet!.method).toBe('DELETE')
  })

  it('extracts requestBody schema from POST operations', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const createPet = result.operations.find(op => op.id === 'createPet')
    expect(createPet).toBeDefined()
    expect(createPet!.requestBody).toBeDefined()
    expect(createPet!.requestBody!.required).toBe(true)
    expect(createPet!.requestBody!.description).toBe('Pet to create')
    expect(createPet!.requestBody!.schema.type).toBe('object')
    expect(createPet!.requestBody!.schema.properties).toBeDefined()
    expect(createPet!.requestBody!.schema.properties!.name.type).toBe('string')
    expect(createPet!.requestBody!.schema.properties!.age.type).toBe('integer')
    expect(createPet!.requestBody!.schema.properties!.status.enum).toEqual(['available', 'pending', 'sold'])
    expect(createPet!.requestBody!.schema.required).toEqual(['name'])

    // GET operations should not have requestBody
    const listPets = result.operations.find(op => op.id === 'listPets')
    expect(listPets!.requestBody).toBeUndefined()
  })

  it('extracts parameters with correct required flags', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const listPets = result.operations.find(op => op.id === 'listPets')
    expect(listPets).toBeDefined()
    expect(listPets!.parameters).toHaveLength(2)

    const limitParam = listPets!.parameters.find(p => p.name === 'limit')
    expect(limitParam).toBeDefined()
    expect(limitParam!.required).toBe(false)
    expect(limitParam!.in).toBe('query')
    expect(limitParam!.schema.type).toBe('integer')
    expect(limitParam!.schema.minimum).toBe(1)
    expect(limitParam!.schema.maximum).toBe(100)
    expect(limitParam!.schema.default).toBe(20)

    const statusParam = listPets!.parameters.find(p => p.name === 'status')
    expect(statusParam).toBeDefined()
    expect(statusParam!.required).toBe(true)
  })

  it('detects path parameters and merges with operation parameters', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const getPetById = result.operations.find(op => op.id === 'getPetById')
    expect(getPetById).toBeDefined()
    expect(getPetById!.path).toBe('/pets/{petId}')
    expect(getPetById!.parameters).toHaveLength(2) // petId (path-level) + fields (operation-level)

    const petIdParam = getPetById!.parameters.find(p => p.name === 'petId')
    expect(petIdParam).toBeDefined()
    expect(petIdParam!.in).toBe('path')
    expect(petIdParam!.required).toBe(true)
    expect(petIdParam!.schema.type).toBe('integer')

    const fieldsParam = getPetById!.parameters.find(p => p.name === 'fields')
    expect(fieldsParam).toBeDefined()
    expect(fieldsParam!.in).toBe('query')
    expect(fieldsParam!.required).toBe(false)
    expect(fieldsParam!.schema.maxLength).toBe(100)
  })

  it('extracts enum parameters', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const listPets = result.operations.find(op => op.id === 'listPets')
    const statusParam = listPets!.parameters.find(p => p.name === 'status')

    expect(statusParam!.schema.enum).toEqual(['available', 'pending', 'sold'])
  })

  it('extracts base URL from OpenAPI 3.x servers', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)
    expect(result.baseUrl).toBe('https://api.example.com/v1')
  })

  it('extracts base URL from Swagger 2.0 host and basePath', async () => {
    const result = await parseOpenAPISpec(swagger2Fixture)
    expect(result.baseUrl).toBe('https://api.legacy.com/api/v2')
  })

  it('handles Swagger 2.0 parameter format (type at root level)', async () => {
    const result = await parseOpenAPISpec(swagger2Fixture)

    const getItems = result.operations.find(op => op.id === 'getItems')
    const searchParam = getItems!.parameters.find(p => p.name === 'search')

    expect(searchParam).toBeDefined()
    expect(searchParam!.schema.type).toBe('string')
    expect(searchParam!.schema.format).toBe('email')
  })

  it('handles empty spec without errors', async () => {
    const result = await parseOpenAPISpec(emptySpecFixture)

    expect(result.operations).toEqual([])
    expect(result.title).toBe('Empty API')
  })

  it('throws descriptive error on invalid spec', async () => {
    await expect(parseOpenAPISpec({ invalid: true })).rejects.toThrow(
      'Failed to parse OpenAPI spec',
    )
  })

  it('extracts response schemas correctly', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const listPets = result.operations.find(op => op.id === 'listPets')
    expect(listPets!.responseSchema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    })
  })

  it('extracts operation metadata (summary, description, tags)', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    const listPets = result.operations.find(op => op.id === 'listPets')
    expect(listPets!.summary).toBe('List all pets')
    expect(listPets!.description).toBe('Returns a list of pets')
    expect(listPets!.tags).toEqual(['pets'])
  })

  it('extracts auth schemes from OpenAPI 3.x spec', async () => {
    const result = await parseOpenAPISpec(openapi3Fixture)

    expect(result.authSchemes).toHaveLength(3)

    const apiKey = result.authSchemes.find(s => s.name === 'ApiKeyAuth')
    expect(apiKey).toEqual({
      name: 'ApiKeyAuth',
      authType: 'apiKey',
      metadata: { headerName: 'X-API-Key' },
      description: 'API key for authentication',
    })

    const bearer = result.authSchemes.find(s => s.name === 'BearerAuth')
    expect(bearer).toEqual({
      name: 'BearerAuth',
      authType: 'bearer',
      metadata: {},
      description: 'BearerAuth',
    })

    const basic = result.authSchemes.find(s => s.name === 'BasicAuth')
    expect(basic).toEqual({
      name: 'BasicAuth',
      authType: 'basic',
      metadata: {},
      description: 'BasicAuth',
    })
  })

  it('extracts security definitions from Swagger 2.0 spec', async () => {
    const result = await parseOpenAPISpec(swagger2Fixture)

    expect(result.authSchemes).toHaveLength(2)

    const apiKey = result.authSchemes.find(s => s.name === 'api_key')
    expect(apiKey).toEqual({
      name: 'api_key',
      authType: 'queryParam',
      metadata: { paramName: 'api_key' },
      description: 'api_key',
    })

    const basic = result.authSchemes.find(s => s.name === 'basic_auth')
    expect(basic).toEqual({
      name: 'basic_auth',
      authType: 'basic',
      metadata: {},
      description: 'HTTP Basic Authentication',
    })
  })

  it('returns empty authSchemes for specs without security', async () => {
    const result = await parseOpenAPISpec(emptySpecFixture)
    expect(result.authSchemes).toEqual([])
  })
})
