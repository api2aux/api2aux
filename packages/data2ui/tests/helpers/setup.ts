/**
 * Shared setup utilities for data2ui tests.
 * Loads fixtures and provides assertion helpers.
 */
import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildUIPlan } from '../../src/plan/builder'
import type { UIPlan, BuildOptions } from '../../src/plan/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const FIXTURES_DIR = resolve(__dirname, '../fixtures')

/** Load a fixture file by name */
export function loadFixture(filename: string): string {
  return readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8')
}

/** Load a JSON fixture and return parsed data */
export function loadJSONFixture(filename: string): unknown {
  return JSON.parse(loadFixture(filename))
}

/** Build a UIPlan from a fixture file */
export function buildPlanFromFixture(
  filename: string,
  options?: BuildOptions,
): UIPlan {
  const raw = loadFixture(filename)
  return buildUIPlan(raw, options)
}
