/**
 * Pre-defined operations for catalog APIs.
 * Uses api-invoke's defineAPI builder for readable, type-safe definitions.
 */

import { defineAPI } from '@api2aux/api-invoke'
import type { ParsedAPI } from '@api2aux/api-invoke'

export interface CatalogSeedEntry {
  name: string
  baseUrl: string
  operations: ParsedAPI['operations']
}

const jsonplaceholder = defineAPI('JSONPlaceholder')
  .baseUrl('https://jsonplaceholder.typicode.com')
  .get('/users', { id: 'getUsers', summary: 'Get all users', tags: ['users'] })
  .get('/users/{id}', {
    id: 'getUserById', summary: 'Get user by ID', tags: ['users'],
    params: { id: { type: 'integer', description: 'User ID' } },
  })
  .get('/posts', {
    id: 'getPosts', summary: 'Get all posts', tags: ['posts'],
    params: { userId: { type: 'integer', description: 'Filter by user ID' } },
  })
  .get('/posts/{id}', {
    id: 'getPostById', summary: 'Get post by ID', tags: ['posts'],
    params: { id: { type: 'integer', description: 'Post ID' } },
  })
  .get('/posts/{postId}/comments', {
    id: 'getPostComments', summary: 'Get comments for a post', tags: ['comments'],
    params: { postId: { type: 'integer', description: 'Post ID' } },
  })
  .get('/todos', {
    id: 'getTodos', summary: 'Get all todos', tags: ['todos'],
    params: { userId: { type: 'integer', description: 'Filter by user ID' } },
  })
  .build()

const catfact = defineAPI('Cat Facts')
  .baseUrl('https://catfact.ninja')
  .get('/fact', { id: 'getRandomFact', summary: 'Get a random cat fact', tags: ['facts'] })
  .get('/facts', {
    id: 'getFacts', summary: 'Get a list of cat facts', tags: ['facts'],
    params: {
      limit: { type: 'integer', description: 'Number of facts', default: 10 },
      page: { type: 'integer', description: 'Page number' },
    },
  })
  .build()

const dogceo = defineAPI('Dog CEO')
  .baseUrl('https://dog.ceo/api')
  .get('/breeds/list/all', { id: 'listAllBreeds', summary: 'List all dog breeds', tags: ['breeds'] })
  .get('/breeds/image/random', { id: 'getRandomImage', summary: 'Get a random dog image', tags: ['images'] })
  .get('/breed/{breed}/images/random', {
    id: 'getBreedImage', summary: 'Get a random image of a specific breed', tags: ['images'],
    params: { breed: { description: 'Dog breed name (e.g., "labrador")' } },
  })
  .build()

export const CATALOG_SEED_DATA: CatalogSeedEntry[] = [
  { name: 'jsonplaceholder', baseUrl: jsonplaceholder.baseUrl, operations: jsonplaceholder.operations },
  { name: 'catfact', baseUrl: catfact.baseUrl, operations: catfact.operations },
  { name: 'dogceo', baseUrl: dogceo.baseUrl, operations: dogceo.operations },
]
