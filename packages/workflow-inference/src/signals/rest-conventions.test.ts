import { describe, it, expect } from 'vitest'
import { detectRestConventions } from './rest-conventions'
import type { InferenceOperation } from '../types'

function op(overrides: Partial<InferenceOperation> & { id: string }): InferenceOperation {
  return {
    path: '/test',
    method: 'GET',
    tags: [],
    parameters: [],
    responseFields: [],
    requestBodyFields: [],
    ...overrides,
  }
}

describe('detectRestConventions', () => {
  it('detects list → detail pattern', () => {
    const ops: InferenceOperation[] = [
      op({ id: 'list_users', path: '/users', method: 'GET' }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectRestConventions(ops)
    const listToDetail = edges.find(e => e.sourceId === 'list_users' && e.targetId === 'get_user')
    expect(listToDetail).toBeDefined()
    expect(listToDetail!.score).toBeGreaterThan(0)
    expect(listToDetail!.signals[0]!.detail).toContain('List→Detail')
  })

  it('detects create → detail pattern', () => {
    const ops: InferenceOperation[] = [
      op({ id: 'create_user', path: '/users', method: 'POST' }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectRestConventions(ops)
    const createToDetail = edges.find(e => e.sourceId === 'create_user' && e.targetId === 'get_user')
    expect(createToDetail).toBeDefined()
    expect(createToDetail!.signals[0]!.detail).toContain('Create→Get')
  })

  it('detects create → update pattern', () => {
    const ops: InferenceOperation[] = [
      op({ id: 'create_user', path: '/users', method: 'POST' }),
      op({
        id: 'update_user',
        path: '/users/{userId}',
        method: 'PUT',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectRestConventions(ops)
    const createToUpdate = edges.find(e => e.sourceId === 'create_user' && e.targetId === 'update_user')
    expect(createToUpdate).toBeDefined()
  })

  it('detects detail → delete pattern', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
      op({
        id: 'delete_user',
        path: '/users/{userId}',
        method: 'DELETE',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectRestConventions(ops)
    const detailToDelete = edges.find(e => e.sourceId === 'get_user' && e.targetId === 'delete_user')
    expect(detailToDelete).toBeDefined()
  })

  it('groups correctly across different base paths', () => {
    const ops: InferenceOperation[] = [
      op({ id: 'list_users', path: '/users', method: 'GET' }),
      op({ id: 'get_user', path: '/users/{userId}', method: 'GET', parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }] }),
      op({ id: 'list_posts', path: '/posts', method: 'GET' }),
      op({ id: 'get_post', path: '/posts/{postId}', method: 'GET', parameters: [{ name: 'postId', in: 'path', type: 'string', required: true }] }),
    ]

    const edges = detectRestConventions(ops)
    // Should have list→detail for both users and posts, but no cross-resource edges
    const userEdge = edges.find(e => e.sourceId === 'list_users' && e.targetId === 'get_user')
    const postEdge = edges.find(e => e.sourceId === 'list_posts' && e.targetId === 'get_post')
    const crossEdge = edges.find(e => e.sourceId === 'list_users' && e.targetId === 'get_post')

    expect(userEdge).toBeDefined()
    expect(postEdge).toBeDefined()
    expect(crossEdge).toBeUndefined()
  })
})
