/**
 * Reusable mock LLM helpers for functional tests.
 *
 * Two modes:
 * - Scripted: exact sequence of tool calls and text responses
 * - Heuristic: keyword-matching tool selection with auto-generated args
 */

import type { LLMCompletionFn, Tool, StreamResult, ChatMessage } from '../../src/types'
import { MessageRole } from '../../src/types'

// ── Scripted Mock ──

export interface ScriptedStep {
  /** Tool calls to return (LLM decides to call tools). */
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
  /** Text response (LLM produces final answer). */
  text?: string
}

let callIdCounter = 0

/**
 * Create a scripted mock LLM that returns predefined responses in sequence.
 * Each step is consumed in order. Throws if more calls are made than steps.
 */
export function createScriptedLlm(steps: ScriptedStep[]): LLMCompletionFn {
  let stepIndex = 0

  return async (
    _messages: ChatMessage[],
    _tools: Tool[],
    onToken: (token: string) => void,
  ): Promise<StreamResult> => {
    if (stepIndex >= steps.length) {
      throw new Error(
        `Scripted LLM exhausted: expected ${steps.length} call(s) but received call #${stepIndex + 1}`,
      )
    }

    const step = steps[stepIndex]!
    stepIndex++

    if (step.toolCalls && step.toolCalls.length > 0) {
      return {
        content: '',
        tool_calls: step.toolCalls.map(tc => ({
          id: `call_${++callIdCounter}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
        finish_reason: 'tool_calls',
      }
    }

    const text = step.text ?? 'Done.'
    // Simulate streaming by emitting the full text as one token
    onToken(text)
    return { content: text, tool_calls: [], finish_reason: 'stop' }
  }
}

// ── Heuristic Mock ──

/** Tokenize a string into lowercase words, splitting camelCase/snake_case. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

/** Score a tool against a user query by keyword overlap. */
function scoreTool(tool: Tool, queryTokens: Set<string>): number {
  const toolText = `${tool.function.name} ${tool.function.description}`
  const toolTokens = tokenize(toolText)
  let score = 0
  for (const token of toolTokens) {
    if (queryTokens.has(token)) score++
  }
  return score
}

/** Generate plausible args for a tool from its parameter metadata. */
function generateArgs(tool: Tool, queryTokens: Set<string>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  const params = tool.function.parameters

  for (const [name, schema] of Object.entries(params.properties)) {
    // Skip non-required params unless they match query keywords
    const isRequired = params.required?.includes(name)
    const nameTokens = tokenize(name)
    const matchesQuery = nameTokens.some(t => queryTokens.has(t))

    if (!isRequired && !matchesQuery) continue

    // Pick value from metadata
    if (schema.enum && schema.enum.length > 0) {
      // Pick enum value that best matches query
      const bestEnum = schema.enum.find(e =>
        queryTokens.has(String(e).toLowerCase())
      ) ?? schema.enum[0]
      args[name] = bestEnum
    } else if (schema.default !== undefined) {
      args[name] = schema.default
    } else if (schema.description) {
      // Try to extract example from description (e.g., "Example: paladin")
      const exampleMatch = schema.description.match(/Example:\s*(\S+)/i)
      if (exampleMatch) {
        args[name] = exampleMatch[1]
      } else {
        // Use a query token as a plausible value
        const relevantToken = [...queryTokens].find(t => t.length > 2)
        args[name] = relevantToken ?? 'test'
      }
    } else {
      args[name] = 'test'
    }
  }

  return args
}

/**
 * Create a heuristic mock LLM that picks tools based on keyword matching.
 *
 * First call: picks the best-matching tool and generates args from metadata.
 * Subsequent calls (after tool results): produces a text summary.
 */
export function createHeuristicLlm(): LLMCompletionFn {
  let hasCalledTool = false

  return async (
    messages: ChatMessage[],
    tools: Tool[],
    onToken: (token: string) => void,
  ): Promise<StreamResult> => {
    // If we already called a tool, produce a text summary
    if (hasCalledTool || tools.length === 0) {
      const text = 'Based on the API data, here are the results.'
      onToken(text)
      return { content: text, tool_calls: [], finish_reason: 'stop' }
    }

    // Find the latest user message
    const userMsg = [...messages]
      .reverse()
      .find(m => m.role === MessageRole.User)
    const query = userMsg?.content ?? ''
    const queryTokens = new Set(tokenize(query))

    // Score all tools
    const scored = tools.map(tool => ({
      tool,
      score: scoreTool(tool, queryTokens),
    }))
    scored.sort((a, b) => b.score - a.score)

    // Pick the best tool (or first if no matches)
    const best = scored[0]
    if (!best) {
      const text = 'No matching tools found.'
      onToken(text)
      return { content: text, tool_calls: [], finish_reason: 'stop' }
    }

    hasCalledTool = true
    const args = generateArgs(best.tool, queryTokens)

    return {
      content: '',
      tool_calls: [{
        id: `call_heuristic_${++callIdCounter}`,
        type: 'function' as const,
        function: {
          name: best.tool.function.name,
          arguments: JSON.stringify(args),
        },
      }],
      finish_reason: 'tool_calls',
    }
  }
}
