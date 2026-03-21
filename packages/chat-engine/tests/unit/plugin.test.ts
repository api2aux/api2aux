/**
 * Plugin integration tests.
 * Demonstrates how domain-specific plugins customize the chat engine.
 */

import { describe, it, expect, vi } from 'vitest'
import { ChatEngine } from '../../src/engine'
import { ChatEventType, MergeStrategy, FinishReason } from '../../src/types'
import { NO_DATA_MESSAGE } from '../../src/defaults'
import type {
  ChatEnginePlugin,
  LLMCompletionFn,
  ToolExecutorFn,
  ChatEngineContext,
  ChatEngineEvent,
  Tool,
  StreamResult,
} from '../../src/types'

// ── Test fixtures ──

const testTool: Tool = {
  type: 'function',
  function: {
    name: 'get_patient',
    description: 'Get patient record',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
}

const testContext: ChatEngineContext = {
  url: 'https://api.hospital.com',
  spec: null,
  tools: [testTool],
  systemPrompt: 'You are a healthcare assistant.',
}

function toolCallResponse(name: string, args: Record<string, unknown>): StreamResult {
  return {
    content: '',
    tool_calls: [{
      id: `call_${Date.now()}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }],
    finish_reason: FinishReason.ToolCalls,
  }
}

function textResponse(text: string): StreamResult {
  return { content: text, tool_calls: [], finish_reason: FinishReason.Stop }
}

// ── Example domain plugins ──

/**
 * Healthcare plugin: redacts patient identifiers from text responses.
 * Demonstrates processResponse hook for compliance.
 */
const healthcarePlugin: ChatEnginePlugin = {
  id: 'healthcare',

  modifySystemPrompt: (base) => {
    return base + '\n\nHIPAA Notice: Never include patient SSN or full name in text responses. Use initials only.'
  },

  processToolResult: (_name, data) => {
    // Redact SSN from tool results before feeding back to LLM
    if (data && typeof data === 'object' && 'ssn' in data) {
      return { ...(data as Record<string, unknown>), ssn: '***-**-****' }
    }
    return data
  },

  processResponse: (text) => {
    // Redact any SSN-like patterns from the final text
    return text.replace(/\d{3}-\d{2}-\d{4}/g, '***-**-****')
  },
}

/**
 * Insurance plugin: restricts available tools based on claim type.
 * Demonstrates modifyTools hook for access control.
 */
const insurancePlugin: ChatEnginePlugin = {
  id: 'insurance',

  modifyTools: (tools, _context) => {
    // Only allow read-only operations (GET tools)
    return tools.filter(t => t.function.name.startsWith('get_') || t.function.name.startsWith('list_'))
  },
}

// ── Tests ──

describe('Healthcare plugin', () => {
  it('adds HIPAA notice to system prompt', async () => {
    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('get_patient', { id: '123' }))
      .mockImplementationOnce(async () => textResponse('ignored'))
      // Phase B text response
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('Patient record retrieved.')
        return textResponse('Patient record retrieved.')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({
      id: '123',
      name: 'John Doe',
      ssn: '123-45-6789',
    })

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    }, [healthcarePlugin])

    await engine.sendMessage('Get patient 123', () => {})

    // Verify HIPAA notice was added to system prompt
    const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
    const messages = firstCall[0] as Array<{ role: string; content: string | null }>
    expect(messages[0]!.content).toContain('HIPAA Notice')
  })

  it('redacts SSN from tool results fed to LLM', async () => {
    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('get_patient', { id: '123' }))
      .mockImplementationOnce(async () => textResponse('ignored'))
      // Phase B text response
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('ok')
        return textResponse('ok')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({
      id: '123',
      name: 'John Doe',
      ssn: '123-45-6789',
    })

    const events: ChatEngineEvent[] = []
    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    }, [healthcarePlugin])

    const result = await engine.sendMessage('Get patient 123', (e) => events.push(e))

    // The tool result stored in the engine should have redacted SSN
    expect(result.toolResults[0]!.data).toHaveProperty('ssn', '***-**-****')

    // The tool result event should also have redacted SSN
    const resultEvent = events.find(e => e.type === ChatEventType.ToolCallResult)
    if (resultEvent?.type === ChatEventType.ToolCallResult) {
      expect((resultEvent.data as Record<string, unknown>).ssn).toBe('***-**-****')
    }
  })

  it('redacts SSN patterns from text response', async () => {
    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('get_patient', { id: '123' }))
      .mockImplementationOnce(async () => textResponse('ignored'))
      // Phase B text response
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('Patient SSN is 123-45-6789')
        return textResponse('Patient SSN is 123-45-6789')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ id: '123' })

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    }, [healthcarePlugin])

    const result = await engine.sendMessage('Get patient 123', () => {})

    expect(result.text).toBe('Patient SSN is ***-**-****')
    expect(result.text).not.toContain('6789')
  })
})

describe('Insurance plugin', () => {
  it('filters tools to read-only operations', async () => {
    const tools: Tool[] = [
      { type: 'function', function: { name: 'get_claim', description: 'Get claim', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'list_claims', description: 'List claims', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'submit_claim', description: 'Submit claim', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'delete_claim', description: 'Delete claim', parameters: { type: 'object', properties: {} } } },
    ]

    const context: ChatEngineContext = {
      ...testContext,
      tools,
    }

    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('get_claim', { id: '1' }))
      .mockImplementationOnce(async () => textResponse('ignored'))
      // Phase B text response
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('ok')
        return textResponse('ok')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ id: '1' })

    const engine = new ChatEngine(llm, executor, context, {
      mergeStrategy: MergeStrategy.Array,
    }, [insurancePlugin])

    await engine.sendMessage('Get claim 1', () => {})

    // Verify only read-only tools were sent to the LLM
    const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
    const sentTools = firstCall[1] as Tool[]
    const names = sentTools.map(t => t.function.name)
    expect(names).toContain('get_claim')
    expect(names).toContain('list_claims')
    expect(names).not.toContain('submit_claim')
    expect(names).not.toContain('delete_claim')
  })
})

describe('Multiple plugins', () => {
  it('applies plugins in order', async () => {
    const callOrder: string[] = []

    const plugin1: ChatEnginePlugin = {
      id: 'plugin1',
      modifySystemPrompt: (base) => {
        callOrder.push('plugin1:prompt')
        return base + ' [Plugin1]'
      },
      processResponse: (text) => {
        callOrder.push('plugin1:response')
        return text + ' [P1]'
      },
    }

    const plugin2: ChatEnginePlugin = {
      id: 'plugin2',
      modifySystemPrompt: (base) => {
        callOrder.push('plugin2:prompt')
        return base + ' [Plugin2]'
      },
      processResponse: (text) => {
        callOrder.push('plugin2:response')
        return text + ' [P2]'
      },
    }

    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('get_patient', { id: '1' }))
      .mockImplementationOnce(async () => textResponse('ignored'))
      // Phase B text response
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('Result')
        return textResponse('Result')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({})

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    }, [plugin1, plugin2])

    const result = await engine.sendMessage('test', () => {})

    // Plugins should be called in order
    expect(callOrder).toEqual([
      'plugin1:prompt', 'plugin2:prompt',
      'plugin1:response', 'plugin2:response',
    ])

    // Both plugin modifications should be applied
    expect(result.text).toBe('Result [P1] [P2]')
  })
})
