/**
 * Domain auto-detection engine.
 *
 * Scores API operations against registered DomainSignatures to suggest
 * which enrichment plugin(s) are relevant. Pure function, no side effects.
 */

import type { DomainSignature, OperationContext } from '../types/enrichment'

/** Result of scoring an API spec against a domain signature. */
export interface DomainDetectionResult {
  /** Plugin ID that owns this signature. */
  readonly pluginId: string
  /** Human-readable plugin name. */
  readonly pluginName: string
  /** Overall match score in the range [0, 1]. */
  readonly score: number
  /** Human-readable descriptions of what matched. */
  readonly matchedSignals: readonly string[]
}

const DEFAULT_THRESHOLD = 0.3

// Scoring weights — redistribute when a signal type is absent
const W_KEYWORDS = 0.4
const W_PATH_PATTERNS = 0.3
const W_FIELD_PATTERNS = 0.3

/**
 * Score operations against registered domain signatures.
 * Returns results above each signature's threshold, sorted by score descending.
 */
export function detectDomain(
  operations: OperationContext[],
  signatures: Map<string, DomainSignature>,
  pluginNames: Map<string, string>,
): DomainDetectionResult[] {
  if (operations.length === 0 || signatures.size === 0) return []

  const results: DomainDetectionResult[] = []

  for (const [pluginId, sig] of signatures) {
    const { score, signals } = scoreDomainSignature(operations, sig)
    const threshold = sig.threshold ?? DEFAULT_THRESHOLD

    if (score >= threshold) {
      results.push({
        pluginId,
        pluginName: pluginNames.get(pluginId) ?? pluginId,
        score,
        matchedSignals: signals,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

function scoreDomainSignature(
  operations: OperationContext[],
  sig: DomainSignature,
): { score: number; signals: string[] } {
  const signals: string[] = []
  const hasPathPatterns = sig.pathPatterns !== undefined && sig.pathPatterns.length > 0
  const hasFieldPatterns = sig.fieldPatterns !== undefined && sig.fieldPatterns.length > 0

  // Compute weights — redistribute absent signal weights to keywords
  let wKeywords = W_KEYWORDS
  let wPath = hasPathPatterns ? W_PATH_PATTERNS : 0
  let wField = hasFieldPatterns ? W_FIELD_PATTERNS : 0

  if (!hasPathPatterns && !hasFieldPatterns) {
    wKeywords = 1.0
  } else if (!hasPathPatterns) {
    wKeywords = W_KEYWORDS + W_PATH_PATTERNS
  } else if (!hasFieldPatterns) {
    wKeywords = W_KEYWORDS + W_FIELD_PATTERNS
  }

  // Keyword matching — check paths, tags, summaries, descriptions
  const keywordScore = scoreKeywords(operations, sig.keywords, signals)

  // Path pattern matching
  let pathScore = 0
  if (hasPathPatterns) {
    pathScore = scorePathPatterns(operations, sig.pathPatterns!, signals)
  }

  // Field pattern matching — check responseFieldNames
  let fieldScore = 0
  if (hasFieldPatterns) {
    fieldScore = scoreFieldPatterns(operations, sig.fieldPatterns!, signals)
  }

  const score = wKeywords * keywordScore + wPath * pathScore + wField * fieldScore
  return { score, signals }
}

function scoreKeywords(
  operations: OperationContext[],
  keywords: readonly string[],
  signals: string[],
): number {
  if (keywords.length === 0) return 0

  // Build a searchable text corpus from all operations
  const corpus = operations.map(op => {
    const parts = [op.path, ...op.tags, op.summary ?? '', op.description ?? '']
    return parts.join(' ').toLowerCase()
  }).join(' ')

  let matched = 0
  for (const keyword of keywords) {
    if (corpus.includes(keyword.toLowerCase())) {
      matched++
      signals.push(`keyword "${keyword}" found`)
    }
  }

  return matched / keywords.length
}

function scorePathPatterns(
  operations: OperationContext[],
  patterns: readonly RegExp[],
  signals: string[],
): number {
  if (patterns.length === 0) return 0

  const allPaths = operations.map(op => op.path)

  let matched = 0
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    if (allPaths.some(path => { pattern.lastIndex = 0; return pattern.test(path) })) {
      matched++
      signals.push(`path pattern ${pattern} matched`)
    }
  }

  return matched / patterns.length
}

function scoreFieldPatterns(
  operations: OperationContext[],
  patterns: readonly RegExp[],
  signals: string[],
): number {
  if (patterns.length === 0) return 0

  const allFields = operations.flatMap(op => op.responseFieldNames)

  let matched = 0
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    if (allFields.some(field => { pattern.lastIndex = 0; return pattern.test(field) })) {
      matched++
      signals.push(`field pattern ${pattern} matched`)
    }
  }

  return matched / patterns.length
}
