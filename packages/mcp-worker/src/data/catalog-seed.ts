/**
 * Pre-defined operations for catalog APIs.
 * Used by both the seed endpoint and the seed script.
 */

import type { Operation } from 'api-bridge-rt'

export interface CatalogSeedEntry {
  name: string
  baseUrl: string
  operations: Operation[]
}

export const CATALOG_SEED_DATA: CatalogSeedEntry[] = [
  {
    name: 'jsonplaceholder',
    baseUrl: 'https://jsonplaceholder.typicode.com',
    operations: [
      {
        path: '/users', method: 'GET', id: 'getUsers',
        summary: 'Get all users', parameters: [], tags: ['users'],
      },
      {
        path: '/users/{id}', method: 'GET', id: 'getUserById',
        summary: 'Get user by ID',
        parameters: [{ name: 'id', in: 'path', required: true, description: 'User ID', schema: { type: 'integer' } }],
        tags: ['users'],
      },
      {
        path: '/posts', method: 'GET', id: 'getPosts',
        summary: 'Get all posts',
        parameters: [{ name: 'userId', in: 'query', required: false, description: 'Filter by user ID', schema: { type: 'integer' } }],
        tags: ['posts'],
      },
      {
        path: '/posts/{id}', method: 'GET', id: 'getPostById',
        summary: 'Get post by ID',
        parameters: [{ name: 'id', in: 'path', required: true, description: 'Post ID', schema: { type: 'integer' } }],
        tags: ['posts'],
      },
      {
        path: '/posts/{postId}/comments', method: 'GET', id: 'getPostComments',
        summary: 'Get comments for a post',
        parameters: [{ name: 'postId', in: 'path', required: true, description: 'Post ID', schema: { type: 'integer' } }],
        tags: ['comments'],
      },
      {
        path: '/todos', method: 'GET', id: 'getTodos',
        summary: 'Get all todos',
        parameters: [{ name: 'userId', in: 'query', required: false, description: 'Filter by user ID', schema: { type: 'integer' } }],
        tags: ['todos'],
      },
    ],
  },
  {
    name: 'catfact',
    baseUrl: 'https://catfact.ninja',
    operations: [
      {
        path: '/fact', method: 'GET', id: 'getRandomFact',
        summary: 'Get a random cat fact', parameters: [], tags: ['facts'],
      },
      {
        path: '/facts', method: 'GET', id: 'getFacts',
        summary: 'Get a list of cat facts',
        parameters: [
          { name: 'limit', in: 'query', required: false, description: 'Number of facts', schema: { type: 'integer', default: 10 } },
          { name: 'page', in: 'query', required: false, description: 'Page number', schema: { type: 'integer' } },
        ],
        tags: ['facts'],
      },
    ],
  },
  {
    name: 'dogceo',
    baseUrl: 'https://dog.ceo/api',
    operations: [
      {
        path: '/breeds/list/all', method: 'GET', id: 'listAllBreeds',
        summary: 'List all dog breeds', parameters: [], tags: ['breeds'],
      },
      {
        path: '/breeds/image/random', method: 'GET', id: 'getRandomImage',
        summary: 'Get a random dog image', parameters: [], tags: ['images'],
      },
      {
        path: '/breed/{breed}/images/random', method: 'GET', id: 'getBreedImage',
        summary: 'Get a random image of a specific breed',
        parameters: [{ name: 'breed', in: 'path', required: true, description: 'Dog breed name (e.g., "labrador")', schema: { type: 'string' } }],
        tags: ['images'],
      },
    ],
  },
]
