/**
 * YAML parser — wraps js-yaml with clear error messages.
 */
import jsYaml from 'js-yaml'

export function parseYAML(input: string): unknown {
  try {
    return jsYaml.load(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`YAML parse error: ${message}`)
  }
}
