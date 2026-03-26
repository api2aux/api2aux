/**
 * SignalRegistry — pluggable registry for workflow inference signal functions.
 *
 * Built-in signals are registered at module load time. External code (e.g.,
 * platform plugins) can register additional signals at runtime.
 */

import { BuiltInSignal } from '../types'
import type { SignalRegistration } from '../types'
import { detectIdPatterns } from './id-pattern'
import { detectRestConventions } from './rest-conventions'
import { detectSchemaCompat } from './schema-compat'
import { detectTagProximity } from './tag-proximity'
import { detectNameSimilarity } from './name-similarity'

export class SignalRegistry {
  private signals: Map<string, SignalRegistration> = new Map()
  private builtInIds: Set<string> = new Set()

  /** Register a signal. Throws if a signal with the same ID already exists unless override is set. */
  register(registration: SignalRegistration, opts?: { override?: boolean }): void {
    if (!registration.id || registration.id.trim() === '') {
      throw new Error('[SignalRegistry] Signal ID must be a non-empty string')
    }
    const existing = this.signals.get(registration.id)
    if (existing) {
      if (!opts?.override) {
        throw new Error(
          `[SignalRegistry] Signal "${registration.id}" is already registered. ` +
          `Use { override: true } to replace it explicitly.`
        )
      }
    }
    this.signals.set(registration.id, registration)
  }

  /** Unregister a signal by ID. Returns true if the signal was found and removed.
   *  Warns if the signal was not found (possible typo). */
  unregister(id: string): boolean {
    if (!this.signals.has(id)) {
      console.warn(`[SignalRegistry] Attempted to unregister unknown signal "${id}"`)
      return false
    }
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

  /** Remove all user-registered signals, keeping built-ins. */
  clearCustom(): void {
    for (const id of this.signals.keys()) {
      if (!this.builtInIds.has(id)) {
        this.signals.delete(id)
      }
    }
  }

  /** Remove ALL signals including built-ins. Use reset() to restore defaults. */
  clear(): void {
    this.signals.clear()
  }

  /** Restore to initial state: clear everything and re-register built-ins. */
  reset(): void {
    this.signals.clear()
    registerBuiltIns(this)
  }

  /** Mark current registrations as built-in (called during module init). */
  _freezeBuiltIns(): void {
    this.builtInIds = new Set(this.signals.keys())
  }
}

/** Register the 5 built-in deterministic signals. */
function registerBuiltIns(registry: SignalRegistry): void {
  registry.register({ id: BuiltInSignal.IdPattern, signal: detectIdPatterns, weight: 0.35 })
  registry.register({ id: BuiltInSignal.RestConventions, signal: detectRestConventions, weight: 0.25 })
  registry.register({ id: BuiltInSignal.SchemaCompat, signal: detectSchemaCompat, weight: 0.25 })
  registry.register({ id: BuiltInSignal.TagProximity, signal: detectTagProximity, weight: 0.10 })
  registry.register({ id: BuiltInSignal.NameSimilarity, signal: detectNameSimilarity, weight: 0.05 })
}

/** Singleton signal registry with built-in signals pre-registered. */
export const signalRegistry = new SignalRegistry()
registerBuiltIns(signalRegistry)
signalRegistry._freezeBuiltIns()
