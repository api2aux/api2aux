# @api2aux/embedding-service

Reusable embedding service for semantic similarity search. Runs in the browser (Transformers.js) or via API (OpenAI).

## What

Reduces LLM context by selecting only semantically relevant data from API responses before sending to an LLM for focusing or summarization.

## Architecture

```
API response → flatten to text → embed → cosine similarity → top-K → focus LLM
```

### Flattening

JSON objects are converted to natural language text for embedding. The approach is **domain-agnostic** — works for products, doctors, recipes, weather, or any structured data:

1. **All scalar fields included** except URLs and base64 blobs (which carry no semantic value)
2. **Ordered by value length** — longer strings (title, description) come first, ensuring the most informative fields survive the 2000-char truncation limit
3. **Natural language format** — `"fieldName: value"` pairs, not raw JSON (better retrieval than raw JSON)
4. **Nested arrays summarized** — e.g., `"reviews: 3 items, avg rating 4.0"`
5. **Nested objects skipped** — they add noise without clear semantic value
6. **Capped at 2000 chars** — gte-small supports 512 tokens max

### Providers

| Provider | Model | Cost | Latency | Setup |
|----------|-------|------|---------|-------|
| **Local** (default) | gte-small (q8, 33MB) | Free | ~10ms/batch (after initial model load) | One-time model download |
| **OpenAI** | text-embedding-3-small | ~$0.00006/request | ~200-500ms | API key required |

The local provider runs in a **Web Worker** to avoid blocking the main thread.

## Usage

```ts
import { EmbeddingService } from '@api2aux/embedding-service'

const service = new EmbeddingService({
  provider: 'local',           // or 'openai'
  localModel: 'Xenova/gte-small',  // configurable
  topK: 8,
})

// Find the most relevant items for a query
const products = [/* 30 products from API */]
const relevant = await service.reduceToRelevant(
  'gift for my wife',
  products,
)
// → returns ~8 most relevant products

// Low-level: embed texts directly
const vectors = await service.embed(['text 1', 'text 2'])

// Low-level: cosine similarity
const sim = service.similarity(vectorA, vectorB)
```

## API

### `EmbeddingService`

- `embed(texts: string[]): Promise<number[][]>` — embed texts into vectors (cached)
- `similarity(a: number[], b: number[]): number` — cosine similarity between two vectors
- `findRelevant(query: string, items: unknown[], k?: number): Promise<RelevanceResult>` — find top-K relevant items
- `reduceToRelevant<T>(query: string, items: T[], k?: number): Promise<T[]>` — return actual top-K items
- `setProvider(id: 'local' | 'openai', config?)` — switch provider at runtime (clears cache)
- `getProviderId(): string` — get the current provider ID
- `isReady(): boolean` — whether the provider is ready
- `clearCache(): void` — clear the embedding vector cache
- `destroy()` — clean up resources

### Utilities

- `flattenForEmbedding(item: unknown): string` — flatten a JSON object to text
- `flattenItems(items: unknown[]): string[]` — flatten an array of items
- `cosineSimilarity(a: number[], b: number[]): number` — cosine similarity
- `topK(queryVector, itemVectors, k): RelevanceResult` — top-K selection
