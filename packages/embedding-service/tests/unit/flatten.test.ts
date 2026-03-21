import { describe, it, expect } from 'vitest'
import { flattenForEmbedding, flattenItems } from '../../src/flatten'

describe('flattenForEmbedding', () => {
  it('flattens a product object with all scalar fields included', () => {
    const product = {
      id: 1,
      title: 'Essence Mascara Lash Princess',
      description: 'A popular mascara known for its volumizing and lengthening effects.',
      category: 'beauty',
      price: 9.99,
      rating: 2.56,
      stock: 99,
      brand: 'Essence',
      sku: 'BEA-ESS-ESS-001',
      availabilityStatus: 'In Stock',
    }

    const text = flattenForEmbedding(product)

    // All scalar fields should be present
    expect(text).toContain('title: Essence Mascara Lash Princess')
    expect(text).toContain('description: A popular mascara')
    expect(text).toContain('category: beauty')
    expect(text).toContain('price: 9.99')
    expect(text).toContain('rating: 2.56')
    expect(text).toContain('sku: BEA-ESS-ESS-001')
    expect(text).toContain('brand: Essence')
  })

  it('puts longer strings first (title/description before short fields)', () => {
    const item = {
      id: 1,
      title: 'A medium length title',
      description: 'A much longer description that contains important context about the item.',
      category: 'test',
    }

    const text = flattenForEmbedding(item)

    // Description (longest string) should come before title
    const descPos = text.indexOf('description:')
    const titlePos = text.indexOf('title:')
    expect(descPos).toBeLessThan(titlePos)
  })

  it('skips URLs and base64 strings', () => {
    const item = {
      title: 'Product',
      image: 'https://cdn.example.com/image.jpg',
      thumbnail: 'https://cdn.example.com/thumb.jpg',
      qrCode: 'data:image/png;base64,abc123',
    }

    const text = flattenForEmbedding(item)
    expect(text).toContain('title: Product')
    expect(text).not.toContain('https://')
    expect(text).not.toContain('data:image')
  })

  it('summarizes nested arrays', () => {
    const item = {
      title: 'Product with reviews',
      reviews: [
        { rating: 4, comment: 'Great!' },
        { rating: 5, comment: 'Excellent!' },
        { rating: 3, comment: 'OK' },
      ],
    }

    const text = flattenForEmbedding(item)
    expect(text).toContain('reviews')
    expect(text).toContain('3') // 3 reviews
    expect(text).toContain('avg rating 4.0')
  })

  it('includes string array values (tags)', () => {
    const item = {
      title: 'Product',
      tags: ['beauty', 'mascara', 'cruelty-free'],
    }

    const text = flattenForEmbedding(item)
    expect(text).toContain('beauty')
    expect(text).toContain('mascara')
  })

  it('skips nested objects', () => {
    const item = {
      title: 'Product',
      dimensions: { width: 10, height: 20, depth: 5 },
      meta: { createdAt: '2025-01-01', barcode: '123456' },
    }

    const text = flattenForEmbedding(item)
    expect(text).toContain('title: Product')
    // Nested objects should not appear as "width: 10"
    expect(text).not.toContain('width:')
  })

  it('caps at ~2000 chars for huge items', () => {
    const item: Record<string, string> = { title: 'Product' }
    // Add many long fields
    for (let i = 0; i < 50; i++) {
      item[`field_${i}`] = `This is a moderately long field value number ${i} with some extra text to fill space.`
    }

    const text = flattenForEmbedding(item)
    expect(text.length).toBeLessThanOrEqual(2050) // Some tolerance for the last segment
  })

  it('handles empty object', () => {
    expect(flattenForEmbedding({})).toBe('')
  })

  it('handles null and undefined', () => {
    expect(flattenForEmbedding(null)).toBe('')
    expect(flattenForEmbedding(undefined)).toBe('')
  })

  it('handles primitives', () => {
    expect(flattenForEmbedding('hello')).toBe('hello')
    expect(flattenForEmbedding(42)).toBe('42')
    expect(flattenForEmbedding(true)).toBe('true')
  })

  it('handles a recipe object (domain-agnostic)', () => {
    const recipe = {
      name: 'Vegetarian Stir-Fry',
      cuisine: 'Asian',
      instructions: 'Stir-fry tofu with broccoli, carrots, and bell peppers.',
      prepTimeMinutes: 15,
      cookTimeMinutes: 20,
      servings: 4,
      difficulty: 'Easy',
    }

    const text = flattenForEmbedding(recipe)
    expect(text).toContain('name: Vegetarian Stir-Fry')
    expect(text).toContain('cuisine: Asian')
    expect(text).toContain('instructions:')
    expect(text).toContain('prepTimeMinutes: 15')
  })

  it('handles weather data (numeric-heavy)', () => {
    const weather = {
      city: 'New York',
      temperature: 72,
      humidity: 65,
      windSpeed: 12,
      condition: 'Partly Cloudy',
      forecast: 'Expect sunshine with occasional clouds.',
    }

    const text = flattenForEmbedding(weather)
    expect(text).toContain('city: New York')
    expect(text).toContain('temperature: 72')
    expect(text).toContain('condition: Partly Cloudy')
  })
})

describe('flattenItems', () => {
  it('flattens each item in an array', () => {
    const items = [
      { title: 'Product A', price: 10 },
      { title: 'Product B', price: 20 },
    ]

    const texts = flattenItems(items)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('Product A')
    expect(texts[1]).toContain('Product B')
  })
})
