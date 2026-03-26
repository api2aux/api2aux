/**
 * SignalRegistry — pluggable registry for workflow inference signal functions.
 *
 * Built-in signals are registered at module load time. External code (e.g.,
 * platform plugins) can register additional signals at runtime.
 */

import type { SignalRegistration } from '../types'
import { detectIdPatterns } from './id-pattern'
import { detectRestConventions } from './rest-conventions'
import { detectSchemaCompat } from './schema-compat'
import { detectTagProximity } from './tag-proximity'
import { detectNameSimilarity } from './name-similarity'

export class SignalRegistry {
  private signals: Map<string, SignalRegistration> = new Map()

  /** Register a signal. Warns if replacing an existing signal with the same ID. */
  register(registration: SignalRegistration): void {
    if (this.signals.has(registration.id)) {
      console.warn(`[SignalRegistry] Replacing existing signal "${registration.id}"`)
    }
    this.signals.set(registration.id, registration)
  }

  /** Unregister a signal by ID. Returns true if the signal was found and removed. */
  unregister(id: string): boolean {
    return this.signals.delete(id)
  }

  /** Get a registered signal by ID. */
  get(id: string): SignalRegistration | undefined {
    return this.signals.get(id)
  }

  /** Get all registered signals in registration order. */
  getAll(): SignalRegistration[] {
    return Array.from(this.signals.values())
  }

  /** Number of registered signals. */
  get size(): number {
    return this.signals.size
  }

  /** Remove all registered signals. */
  clear(): void {
    this.signals.clear()
  }
}

/** Singleton signal registry with built-in signals pre-registered. */
export const signalRegistry = new SignalRegistry()

// Register the 5 built-in deterministic signals
signalRegistry.register({ id: 'id-pattern', signal: detectIdPatterns, weight: 0.35 })
signalRegistry.register({ id: 'rest-conventions', signal: detectRestConventions, weight: 0.25 })
signalRegistry.register({ id: 'schema-compat', signal: detectSchemaCompat, weight: 0.25 })
signalRegistry.register({ id: 'tag-proximity', signal: detectTagProximity, weight: 0.10 })
signalRegistry.register({ id: 'name-similarity', signal: detectNameSimilarity, weight: 0.05 })
