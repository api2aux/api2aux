/**
 * Local embedding provider using Transformers.js.
 *
 * Runs inference in a Web Worker to avoid blocking the main thread.
 * Model is downloaded on first use and cached by the browser.
 *
 * In non-browser environments (Node.js, tests), falls back to
 * running on the main thread (browser-with-window check: both
 * Worker and window must exist).
 */

import type { EmbeddingProvider } from '../types'

/** Messages sent TO the embedding worker. */
export type WorkerRequest = { type: 'embed'; id: number; texts: string[]; model: string }

/** Messages received FROM the embedding worker. */
export type WorkerResponse =
  | { type: 'result'; id: number; vectors: number[][] }
  | { type: 'error'; id: number; error: string }
  | { type: 'ready' }

const DEFAULT_MODEL = 'Xenova/gte-small'
const WORKER_REQUEST_TIMEOUT_MS = 30_000

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local'
  readonly name = 'Local (Browser)'
  readonly dimensions = 384

  private model: string
  private worker: Worker | null = null
  private ready = false
  private pendingRequests = new Map<number, {
    resolve: (vectors: number[][]) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextId = 0
  private pipeline: unknown = null
  private initError: Error | null = null

  constructor(model?: string) {
    this.model = model ?? DEFAULT_MODEL
  }

  isReady(): boolean {
    return this.ready
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // In browser: use Web Worker
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      return this.embedViaWorker(texts)
    }

    // In Node.js/tests: run on main thread
    return this.embedDirect(texts)
  }

  /** Embed via Web Worker (browser path). */
  private async embedViaWorker(texts: string[]): Promise<number[][]> {
    if (!this.worker) {
      this.worker = this.createWorker()
    }

    const id = this.nextId++
    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Embedding worker request timed out after ${WORKER_REQUEST_TIMEOUT_MS}ms`))
      }, WORKER_REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'embed', id, texts, model: this.model } satisfies WorkerRequest)
    })
  }

  /** Embed directly on the main thread (Node.js/test path). */
  private async embedDirect(texts: string[]): Promise<number[][]> {
    if (this.initError) {
      throw new Error(`Local embedding provider previously failed to initialize: ${this.initError.message}`)
    }

    if (!this.pipeline) {
      try {
        const { pipeline } = await import('@huggingface/transformers')
        this.pipeline = await pipeline('feature-extraction', this.model, {
          dtype: 'q8',
        })
        this.ready = true
      } catch (err) {
        this.initError = err instanceof Error ? err : new Error(String(err))
        throw new Error(
          `Failed to initialize local embedding provider (model: ${this.model}): ${this.initError.message}. ` +
          `Ensure @huggingface/transformers is installed, or switch to the OpenAI embedding provider.`
        )
      }
    }

    const extractor = this.pipeline as (texts: string[], options: { pooling: string; normalize: boolean }) => Promise<{ tolist: () => number[][] }>
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return output.tolist()
  }

  private createWorker(): Worker {
    // Create an inline worker that loads Transformers.js
    const workerCode = `
      let pipeline = null;

      async function loadModel(model) {
        if (pipeline) return;
        const { pipeline: createPipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
        pipeline = await createPipeline('feature-extraction', model, { dtype: 'q8' });
        self.postMessage({ type: 'ready' });
      }

      self.onmessage = async (e) => {
        const msg = e.data;
        if (msg.type === 'embed') {
          try {
            await loadModel(msg.model);
            const output = await pipeline(msg.texts, { pooling: 'mean', normalize: true });
            const vectors = output.tolist();
            self.postMessage({ type: 'result', id: msg.id, vectors });
          } catch (err) {
            self.postMessage({ type: 'error', id: msg.id, error: err.message || String(err) });
          }
        }
      };
    `

    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const worker = new Worker(URL.createObjectURL(blob), { type: 'module' })

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        this.ready = true
      } else if (msg.type === 'result') {
        const pending = this.pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(msg.id)
          pending.resolve(msg.vectors)
        }
      } else if (msg.type === 'error') {
        const pending = this.pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(msg.id)
          pending.reject(new Error(msg.error))
        }
      }
    }

    worker.onerror = (err: ErrorEvent) => {
      console.error('[embedding-service] Worker error:', err)
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Embedding worker crashed'))
        this.pendingRequests.delete(id)
      }
    }

    return worker
  }

  /** Terminate the worker and clean up. */
  destroy(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
    }
    this.pendingRequests.clear()
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.pipeline = null
    this.initError = null
  }
}
