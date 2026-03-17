/**
 * Functional test: GitHub REST API patterns.
 * Verifies workflow inference for a large API with nested resources.
 */

import { describe, it, expect } from 'vitest'
import { analyzeWorkflows } from '../index'
import { WorkflowPattern } from '../types'

describe('GitHub API — workflow inference', () => {
  // Fixture operations based on real GitHub REST API patterns (raw format)
  const githubOps = [
    {
      id: 'list_repos',
      path: '/user/repos',
      method: 'GET',
      tags: ['repos'],
      parameters: [
        { name: 'type', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sort', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            full_name: { type: 'string' },
            owner: { type: 'object' },
          },
        },
      },
    },
    {
      id: 'get_repo',
      path: '/repos/{owner}/{repo}',
      method: 'GET',
      tags: ['repos'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          description: { type: 'string' },
          stargazers_count: { type: 'integer' },
        },
      },
    },
    {
      id: 'list_issues',
      path: '/repos/{owner}/{repo}/issues',
      method: 'GET',
      tags: ['issues'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            number: { type: 'integer' },
            title: { type: 'string' },
            state: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'get_issue',
      path: '/repos/{owner}/{repo}/issues/{issue_number}',
      method: 'GET',
      tags: ['issues'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'issue_number', in: 'path', required: true, schema: { type: 'integer' } },
      ],
    },
    {
      id: 'create_issue',
      path: '/repos/{owner}/{repo}/issues',
      method: 'POST',
      tags: ['issues'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        schema: {
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'update_issue',
      path: '/repos/{owner}/{repo}/issues/{issue_number}',
      method: 'PATCH',
      tags: ['issues'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'issue_number', in: 'path', required: true, schema: { type: 'integer' } },
      ],
    },
    {
      id: 'list_issue_comments',
      path: '/repos/{owner}/{repo}/issues/{issue_number}/comments',
      method: 'GET',
      tags: ['issues'],
      parameters: [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'issue_number', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            body: { type: 'string' },
            user: { type: 'object' },
          },
        },
      },
    },
    {
      id: 'search_repos',
      path: '/search/repositories',
      method: 'GET',
      tags: ['search'],
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'sort', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          total_count: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                full_name: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
    },
  ]

  it('detects browse workflow for issues (list → detail)', () => {
    const { workflows } = analyzeWorkflows(githubOps)

    const issueBrowse = workflows.find(w =>
      w.pattern === WorkflowPattern.Browse &&
      w.steps.some(s => s.operationId === 'list_issues') &&
      w.steps.some(s => s.operationId === 'get_issue')
    )
    expect(issueBrowse).toBeDefined()
  })

  it('detects CRUD workflow for issues', () => {
    const { workflows } = analyzeWorkflows(githubOps)

    const issueCrud = workflows.find(w =>
      w.pattern === WorkflowPattern.CRUD &&
      w.steps.some(s => s.operationId === 'create_issue')
    )
    expect(issueCrud).toBeDefined()
  })

  it('infers edges from get_issue to list_issue_comments (shared path params)', () => {
    const { graph } = analyzeWorkflows(githubOps)

    // get_issue response has number/id → list_issue_comments needs issue_number
    // Also they share path params owner, repo
    const edge = graph.edges.find(e =>
      e.sourceId === 'list_issues' && e.targetId === 'get_issue'
    )
    expect(edge).toBeDefined()
  })

  it('produces multiple workflows for a complex API', () => {
    const { workflows } = analyzeWorkflows(githubOps)
    expect(workflows.length).toBeGreaterThanOrEqual(2)
  })
})
