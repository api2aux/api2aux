/**
 * JSON parser — thin wrapper around JSON.parse with clear error messages.
 */
export function parseJSON(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`JSON parse error: ${message}`)
  }
}
