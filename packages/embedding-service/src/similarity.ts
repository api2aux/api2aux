/**
 * Cosine similarity and top-K selection.
 * Pure math — no dependencies.
 */

import type { RelevanceResult } from './types'

/** Compute cosine similarity between two vectors. Returns value in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Find the top-K vectors most similar to the query vector.
 * Returns results sorted by similarity (highest first).
 */
export function topK(
  queryVector: number[],
  itemVectors: number[][],
  k: number,
): RelevanceResult {
  if (itemVectors.length === 0) return { results: [] }

  const scored = itemVectors.map((vec, index) => ({
    index,
    score: cosineSimilarity(queryVector, vec),
  }))

  scored.sort((a, b) => b.score - a.score)

  return {
    results: scored.slice(0, Math.min(k, scored.length)),
  }
}
