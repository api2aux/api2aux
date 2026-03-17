/**
 * Functional test: Stripe API spec.
 * Verifies workflow inference produces sensible results for a real commerce API.
 */

import { describe, it, expect } from 'vitest'
import { analyzeWorkflows } from '../index'
import { WorkflowPattern } from '../types'

describe('Stripe API — workflow inference', () => {
  // Fixture operations based on known Stripe patterns
  const stripeOps = [
      {
        id: 'list_customers',
        path: '/v1/customers',
        method: 'GET',
        tags: ['Customers'],
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'email', in: 'query', required: false, schema: { type: 'string', format: 'email' } },
        ],
        responseSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                  created: { type: 'integer' },
                },
              },
            },
            has_more: { type: 'boolean' },
          },
        },
      },
      {
        id: 'create_customer',
        path: '/v1/customers',
        method: 'POST',
        tags: ['Customers'],
        parameters: [],
        requestBody: {
          schema: {
            properties: {
              email: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
      {
        id: 'get_customer',
        path: '/v1/customers/{customer}',
        method: 'GET',
        tags: ['Customers'],
        parameters: [
          { name: 'customer', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responseSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            subscriptions: { type: 'object' },
          },
        },
      },
      {
        id: 'update_customer',
        path: '/v1/customers/{customer}',
        method: 'POST', // Stripe uses POST for updates
        tags: ['Customers'],
        parameters: [
          { name: 'customer', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      {
        id: 'delete_customer',
        path: '/v1/customers/{customer}',
        method: 'DELETE',
        tags: ['Customers'],
        parameters: [
          { name: 'customer', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      {
        id: 'list_products',
        path: '/v1/products',
        method: 'GET',
        tags: ['Products'],
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        responseSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  default_price: { type: 'string' },
                },
              },
            },
          },
        },
      },
      {
        id: 'get_product',
        path: '/v1/products/{id}',
        method: 'GET',
        tags: ['Products'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      {
        id: 'create_payment_intent',
        path: '/v1/payment_intents',
        method: 'POST',
        tags: ['PaymentIntents'],
        parameters: [],
        requestBody: {
          schema: {
            properties: {
              amount: { type: 'integer' },
              currency: { type: 'string' },
              customer: { type: 'string' },
            },
          },
        },
      },
      {
        id: 'get_payment_intent',
        path: '/v1/payment_intents/{intent}',
        method: 'GET',
        tags: ['PaymentIntents'],
        parameters: [
          { name: 'intent', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
    ]

  it('has the expected number of fixture operations', () => {
    expect(stripeOps.length).toBe(9)
  })

  it('detects Browse workflows for customers and products', () => {
    const { workflows } = analyzeWorkflows(stripeOps)

    const browseWorkflows = workflows.filter(w => w.pattern === WorkflowPattern.Browse)
    expect(browseWorkflows.length).toBeGreaterThanOrEqual(2) // customers + products

    const customerBrowse = browseWorkflows.find(w =>
      w.steps.some(s => s.operationId === 'list_customers') &&
      w.steps.some(s => s.operationId === 'get_customer')
    )
    expect(customerBrowse).toBeDefined()

    const productBrowse = browseWorkflows.find(w =>
      w.steps.some(s => s.operationId === 'list_products') &&
      w.steps.some(s => s.operationId === 'get_product')
    )
    expect(productBrowse).toBeDefined()
  })

  it('detects CRUD workflow for customers', () => {
    const { workflows } = analyzeWorkflows(stripeOps)

    const crudWorkflows = workflows.filter(w => w.pattern === WorkflowPattern.CRUD)
    const customerCrud = crudWorkflows.find(w =>
      w.steps.some(s => s.operationId === 'create_customer') ||
      w.steps.some(s => s.operationId === 'get_customer')
    )
    expect(customerCrud).toBeDefined()
  })

  it('detects payment intent workflow edges', () => {
    const { graph } = analyzeWorkflows(stripeOps)

    // create_payment_intent → get_payment_intent should have an edge
    const edge = graph.edges.find(e =>
      e.sourceId === 'create_payment_intent' && e.targetId === 'get_payment_intent'
    )
    expect(edge).toBeDefined()
  })

  it('produces non-zero workflows overall', () => {
    const { workflows } = analyzeWorkflows(stripeOps)
    expect(workflows.length).toBeGreaterThanOrEqual(3)
  })
})
