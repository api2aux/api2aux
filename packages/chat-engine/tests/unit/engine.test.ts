import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatEngine } from '../../src/engine'
import * as responseModule from '../../src/response'
import { clearFocusCache } from '../../src/response'
import { ChatEventType, FinishReason, MergeStrategy, MessageRole } from '../../src/types'
import { NO_DATA_MESSAGE } from '../../src/defaults'
import type {
  ChatMessage,
  LLMCompletionFn,
  ToolExecutorFn,
  ChatEngineContext,
  ChatEngineEvent,
  ChatEngineEventHandler,
  ChatEnginePlugin,
  StreamResult,
  Tool,
} from '../../src/types'

// ── Test helpers ──

const testTool: Tool = {
  type: 'function',
  function: {
    name: 'list_users',
    description: 'List users',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

const testContext: ChatEngineContext = {
  url: 'https://api.example.com',
  spec: null,
  tools: [testTool],
  systemPrompt: 'You are a test assistant.',
}

function textResponse(text: string): StreamResult {
  return { content: text, tool_calls: [], finish_reason: FinishReason.Stop }
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

/** Second tool for multi-result tests (focus/merge LLM only runs for 2+ results). */
const secondTool: Tool = {
  type: 'function',
  function: {
    name: 'get_orders',
    description: 'Get orders',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

const multiContext: ChatEngineContext = {
  ...testContext,
  tools: [testTool, secondTool],
}

function twoToolCallResponse(): StreamResult {
  return {
    content: '',
    tool_calls: [
      { id: 'call_1', type: 'function' as const, function: { name: 'list_users', arguments: '{}' } },
      { id: 'call_2', type: 'function' as const, function: { name: 'get_orders', arguments: '{}' } },
    ],
    finish_reason: FinishReason.ToolCalls,
  }
}

describe('ChatEngine', () => {
  let events: ChatEngineEvent[]
  let onEvent: ChatEngineEventHandler
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    events = []
    onEvent = (event: ChatEngineEvent) => { events.push(event) }
    // Suppress expected warnings and merge fallback errors in tests
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    clearFocusCache()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  describe('single-round text response', () => {
    it('returns text when LLM responds without tool calls', async () => {
      const llm: LLMCompletionFn = vi.fn()
        // Phase A call 1: LLM calls a tool
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        // Phase A call 2: LLM returns text (signals "done with tools", text ignored — breaks to Phase B)
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B: text response with no tools
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found ')
          onToken('2 users.')
          return textResponse('Found 2 users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      const result = await engine.sendMessage('List all users', onEvent)

      expect(result.text).toBe('Found 2 users.')
      expect(result.toolResults).toHaveLength(1)

      // Verify events
      const tokenEvents = events.filter(e => e.type === ChatEventType.Token)
      expect(tokenEvents.length).toBeGreaterThan(0)

      const completeEvent = events.find(e => e.type === ChatEventType.TurnComplete)
      expect(completeEvent).toBeDefined()
    })
  })

  describe('multi-round tool calling', () => {
    it('executes tool calls and sends results back to LLM', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', { limit: '5' }))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Here are 2 users.')
          return textResponse('Here are 2 users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      const result = await engine.sendMessage('Show me users', onEvent)

      expect(executor).toHaveBeenCalledWith('list_users', { limit: '5' })
      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0]!.toolName).toBe('list_users')
      expect(result.text).toBe('Here are 2 users.')

      // Verify tool call events
      const startEvent = events.find(e => e.type === ChatEventType.ToolCallStart)
      expect(startEvent).toBeDefined()
      if (startEvent?.type === ChatEventType.ToolCallStart) {
        expect(startEvent.toolName).toBe('list_users')
      }

      const resultEvent = events.find(e => e.type === ChatEventType.ToolCallResult)
      expect(resultEvent).toBeDefined()
    })

    it('passes correct message structure to LLM after tool execution', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', { limit: '5' }))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      await engine.sendMessage('Show users', onEvent)

      // Inspect messages sent to LLM on the second call (still in Phase A loop)
      const secondCall = (llm as ReturnType<typeof vi.fn>).mock.calls[1]!
      const messages = secondCall[0] as ChatMessage[]

      // Structure: system, user, assistant (with tool_calls), tool (with tool_call_id)
      expect(messages[0]!.role).toBe(MessageRole.System)
      expect(messages[1]!.role).toBe(MessageRole.User)
      expect(messages[1]!.content).toBe('Show users')
      expect(messages[2]!.role).toBe(MessageRole.Assistant)
      expect(messages[2]!.tool_calls).toHaveLength(1)
      expect(messages[2]!.tool_calls![0]!.function.name).toBe('list_users')
      expect(messages[3]!.role).toBe(MessageRole.Tool)
      expect(messages[3]!.tool_call_id).toBe(messages[2]!.tool_calls![0]!.id)
    })
  })

  describe('max rounds', () => {
    it('forces text response after maxRounds', async () => {
      // LLM always returns tool calls, but on the last round tools are empty
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementation(async (_msgs, tools, onToken) => {
          if (tools.length === 0) {
            // Forced text response (no tools available)
            onToken('Reached max rounds.')
            return textResponse('Reached max rounds.')
          }
          return toolCallResponse('list_users', {})
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ ok: true })

      const engine = new ChatEngine(llm, executor, testContext, { maxRounds: 2 })
      const result = await engine.sendMessage('Keep calling', onEvent)

      // Should have called executor twice (2 rounds), then forced text
      expect(executor).toHaveBeenCalledTimes(2)
      expect(result.text).toBe('Reached max rounds.')
    })
  })

  describe('no-LLM-knowledge guardrail', () => {
    it('overrides text when no tools were called', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('The capital of France is Paris.')
          return textResponse('The capital of France is Paris.')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      const result = await engine.sendMessage('What is the capital of France?', onEvent)

      // Guardrail should override the LLM's knowledge-based answer
      expect(result.text).toBe(NO_DATA_MESSAGE)
      expect(executor).not.toHaveBeenCalled()
    })

    it('allows text response when tools were called', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      const result = await engine.sendMessage('Show users', onEvent)

      expect(result.text).toBe('Found users.')
    })
  })

  describe('error handling', () => {
    it('emits tool_call_error when executor throws', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Error occurred.')
          return textResponse('Error occurred.')
        })

      const executor: ToolExecutorFn = vi.fn().mockRejectedValue(new Error('Network error'))

      const engine = new ChatEngine(llm, executor, testContext)
      const result = await engine.sendMessage('List users', onEvent)

      const errorEvent = events.find(e => e.type === ChatEventType.ToolCallError)
      expect(errorEvent).toBeDefined()
      if (errorEvent?.type === ChatEventType.ToolCallError) {
        expect(errorEvent.error).toBe('Network error')
      }

      // Guardrail kicks in since no successful tool results
      expect(result.text).toBe(NO_DATA_MESSAGE)
    })

    it('emits error event when LLM throws', async () => {
      const llm: LLMCompletionFn = vi.fn().mockRejectedValue(new Error('Rate limited'))
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)

      await expect(engine.sendMessage('Hello', onEvent)).rejects.toThrow('Rate limited')

      const errorEvent = events.find(e => e.type === ChatEventType.Error)
      expect(errorEvent).toBeDefined()
    })

    it('handles malformed tool call arguments', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => ({
          content: '',
          tool_calls: [{
            id: 'call_bad',
            type: 'function' as const,
            function: { name: 'list_users', arguments: 'not valid json{' },
          }],
          finish_reason: FinishReason.ToolCalls,
        }))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Failed.')
          return textResponse('Failed.')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      const result = await engine.sendMessage('List users', onEvent)

      const errorEvent = events.find(e => e.type === ChatEventType.ToolCallError)
      expect(errorEvent).toBeDefined()
      expect(executor).not.toHaveBeenCalled()

      // Guardrail: no successful tool results
      expect(result.text).toBe(NO_DATA_MESSAGE)
    })

    it('emits ToolCallStart before ToolCallError on malformed args', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => ({
          content: '',
          tool_calls: [{
            id: 'call_bad',
            type: 'function' as const,
            function: { name: 'list_users', arguments: '{invalid' },
          }],
          finish_reason: FinishReason.ToolCalls,
        }))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
      const engine = new ChatEngine(llm, executor, testContext)
      await engine.sendMessage('test', onEvent)

      const types = events.map(e => e.type)
      const startIdx = types.indexOf(ChatEventType.ToolCallStart)
      const errorIdx = types.indexOf(ChatEventType.ToolCallError)

      expect(startIdx).toBeGreaterThanOrEqual(0)
      expect(errorIdx).toBeGreaterThan(startIdx)
    })
  })

  describe('plugin hooks', () => {
    it('preserves original prompt when modifySystemPrompt returns null', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'noop-prompt',
        modifySystemPrompt: vi.fn().mockReturnValue(null),
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      await engine.sendMessage('test', onEvent)

      // Verify the original prompt was passed (not "null")
      const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
      const messages = firstCall[0] as Array<{ role: string; content: string | null }>
      expect(messages[0]!.content).toBe(testContext.systemPrompt)
    })

    it('calls modifySystemPrompt before LLM call', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'test-prompt',
        modifySystemPrompt: vi.fn().mockReturnValue('Modified prompt.'),
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      await engine.sendMessage('test', onEvent)

      expect(plugin.modifySystemPrompt).toHaveBeenCalledWith(
        testContext.systemPrompt,
        testContext,
      )

      // Verify the modified prompt was passed to the LLM
      const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
      const messages = firstCall[0] as Array<{ role: string; content: string | null }>
      expect(messages[0]!.content).toBe('Modified prompt.')
    })

    it('calls modifyTools before LLM call', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'test-tools',
        modifyTools: vi.fn().mockReturnValue([]),
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('No tools.')
          return textResponse('No tools.')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      await engine.sendMessage('test', onEvent)

      expect(plugin.modifyTools).toHaveBeenCalled()
    })

    it('calls processToolResult on successful tool calls', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'test-result',
        processToolResult: vi.fn().mockImplementation((_name, data) => {
          return { ...data as Record<string, unknown>, enriched: true }
        }),
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ users: [] })

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      expect(plugin.processToolResult).toHaveBeenCalledWith('list_users', { users: [] })
      expect(result.toolResults[0]!.data).toEqual({ users: [], enriched: true })
    })

    it('calls processResponse on final text', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'test-response',
        processResponse: vi.fn().mockImplementation((text) => `[REDACTED] ${text}`),
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Patient data')
          return textResponse('Patient data')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      expect(result.text).toBe('[REDACTED] Patient data')
    })

    it('throws on duplicate plugin IDs', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()
      const plugin: ChatEnginePlugin = { id: 'dupe' }

      expect(() => new ChatEngine(llm, executor, testContext, undefined, [plugin, plugin]))
        .toThrow('Duplicate plugin id: dupe')
    })

    it('does not crash when modifySystemPrompt throws', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'bad-prompt',
        modifySystemPrompt: () => { throw new Error('prompt boom') },
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      // Engine should complete successfully despite the plugin throwing
      expect(result.text).toBe('ok')
    })

    it('does not crash when modifyTools throws', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'bad-tools',
        modifyTools: () => { throw new Error('tools boom') },
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      expect(result.text).toBe('ok')
    })

    it('does not crash when processToolResult throws', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'bad-result',
        processToolResult: () => { throw new Error('result boom') },
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ users: [] })

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      // Engine completes; the original data is preserved (plugin threw before returning)
      expect(result.text).toBe('ok')
      expect(result.toolResults).toHaveLength(1)
    })

    it('does not crash when processResponse throws', async () => {
      const plugin: ChatEnginePlugin = {
        id: 'bad-response',
        processResponse: () => { throw new Error('response boom') },
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Patient data')
          return textResponse('Patient data')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      // Engine completes with the unmodified response text
      expect(result.text).toBe('Patient data')
    })
  })

  describe('onEvent error isolation', () => {
    it('completes the turn even when onEvent handler throws', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Done.')
          return textResponse('Done.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      const collectedEvents: ChatEngineEvent[] = []

      const throwingHandler: ChatEngineEventHandler = (event) => {
        collectedEvents.push(event)
        if (event.type === ChatEventType.ToolCallStart) {
          throw new Error('handler crash')
        }
      }

      const result = await engine.sendMessage('test', throwingHandler)

      // Engine should complete despite the handler throwing on ToolCallStart
      expect(result.text).toBeDefined()
      expect(result.toolResults).toHaveLength(1)

      // All events should still have been emitted (handler was called for each)
      const types = collectedEvents.map(e => e.type)
      expect(types).toContain(ChatEventType.ToolCallStart)
      expect(types).toContain(ChatEventType.ToolCallResult)
      expect(types).toContain(ChatEventType.TurnComplete)
    })
  })

  describe('concurrent sendMessage guard', () => {
    it('throws when sendMessage is called while another is in progress', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementation(async (_msgs, _tools, onToken) => {
          // Simulate a delay
          await new Promise(r => setTimeout(r, 50))
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)

      // Start first message (will take ~50ms)
      const first = engine.sendMessage('first', onEvent)

      // Immediately try a second — should throw
      await expect(engine.sendMessage('second', onEvent))
        .rejects.toThrow('sendMessage is already in progress')

      // First should still complete
      const result = await first
      expect(result.text).toBeDefined()
    })

    it('resets busy flag after sendMessage rejects', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockRejectedValueOnce(new Error('transient error'))
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })

      // First call fails
      await expect(engine.sendMessage('first', onEvent)).rejects.toThrow('transient error')

      // Second call should succeed (busy flag was reset)
      const result = await engine.sendMessage('second', onEvent)
      expect(result.text).toBe('ok')
    })
  })

  describe('history management', () => {
    it('maintains conversation history across messages', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('First')
          return textResponse('First')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      await engine.sendMessage('Message 1', onEvent)

      const history = engine.getHistory()
      expect(history.length).toBeGreaterThan(0)
      expect(history[0]!.role).toBe(MessageRole.User)
      expect(history[0]!.content).toBe('Message 1')
    })

    it('clears history', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      await engine.sendMessage('test', onEvent)
      expect(engine.getHistory().length).toBeGreaterThan(0)

      engine.clearHistory()
      expect(engine.getHistory()).toHaveLength(0)
    })

    it('restores history with setHistory', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      engine.setHistory([
        { role: MessageRole.User, content: 'old message' },
        { role: MessageRole.Assistant, content: 'old response' },
      ])

      expect(engine.getHistory()).toHaveLength(2)
    })
  })

  describe('event emission order', () => {
    it('emits events in correct order for tool call flow', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Done.')
          return textResponse('Done.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)

      // New event order: ToolCallStart, ToolCallResult, DataProcessing, StructuredReady, Token(s), TurnComplete
      expect(eventTypes[0]).toBe(ChatEventType.ToolCallStart)
      expect(eventTypes[1]).toBe(ChatEventType.ToolCallResult)

      const dpIndex = eventTypes.indexOf(ChatEventType.DataProcessing)
      expect(dpIndex).toBeGreaterThan(1)

      const srIndex = eventTypes.indexOf(ChatEventType.StructuredReady)
      expect(srIndex).toBeGreaterThan(dpIndex)

      const tokenIndex = eventTypes.indexOf(ChatEventType.Token)
      expect(tokenIndex).toBeGreaterThan(srIndex)

      const lastEvent = eventTypes[eventTypes.length - 1]
      expect(lastEvent).toBe(ChatEventType.TurnComplete)
    })
  })

  describe('structured response', () => {
    it('includes structured response in turn_complete', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      const result = await engine.sendMessage('test', onEvent)

      expect(result.structured).toBeDefined()
      expect(result.structured.strategy).toBe(MergeStrategy.Array)
      expect(result.structured.sources).toHaveLength(1)
    })

    it('falls back to array strategy when formatStructuredResponse throws', async () => {
      const spy = vi.spyOn(responseModule, 'formatStructuredResponse')
        .mockRejectedValueOnce(new Error('merge exploded'))

      // Use 2 tool results so formatStructuredResponse is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      const engine = new ChatEngine(llm, executor, multiContext)
      const result = await engine.sendMessage('test', onEvent)

      expect(result.structured.strategy).toBe(MergeStrategy.Array)
      expect(Array.isArray(result.structured.data)).toBe(true)
      spy.mockRestore()
    })
  })

  describe('whitespace-only messages', () => {
    it('trims whitespace from user message before adding to history', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      await engine.sendMessage('  hello  ', onEvent)

      const history = engine.getHistory()
      expect(history[0]!.content).toBe('hello')
    })

    it('rejects empty message text', async () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      await expect(engine.sendMessage('', onEvent)).rejects.toThrow('message text must not be empty')
      await expect(engine.sendMessage('   ', onEvent)).rejects.toThrow('message text must not be empty')
    })
  })

  describe('getConfig', () => {
    it('returns resolved config with defaults', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      const config = engine.getConfig()

      expect(config.maxRounds).toBe(3) // MAX_ROUNDS default
      expect(config.truncationLimit).toBe(8000) // TRUNCATION_LIMIT default
      expect(config.mergeStrategy).toBe(MergeStrategy.LlmGuided)
    })

    it('returns overridden config values', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext, {
        maxRounds: 5,
        truncationLimit: 4000,
        mergeStrategy: MergeStrategy.Array,
      })
      const config = engine.getConfig()

      expect(config.maxRounds).toBe(5)
      expect(config.truncationLimit).toBe(4000)
      expect(config.mergeStrategy).toBe(MergeStrategy.Array)
    })

    it('rejects invalid maxRounds', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      expect(() => new ChatEngine(llm, executor, testContext, { maxRounds: 0 }))
        .toThrow('maxRounds must be a finite number >= 1')
      expect(() => new ChatEngine(llm, executor, testContext, { maxRounds: -1 }))
        .toThrow('maxRounds must be a finite number >= 1')
      expect(() => new ChatEngine(llm, executor, testContext, { maxRounds: NaN }))
        .toThrow('maxRounds must be a finite number >= 1')
      expect(() => new ChatEngine(llm, executor, testContext, { maxRounds: Infinity }))
        .toThrow('maxRounds must be a finite number >= 1')
    })

    it('rejects invalid truncationLimit', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      expect(() => new ChatEngine(llm, executor, testContext, { truncationLimit: 0 }))
        .toThrow('truncationLimit must be a finite number >= 1')
      expect(() => new ChatEngine(llm, executor, testContext, { truncationLimit: -5 }))
        .toThrow('truncationLimit must be a finite number >= 1')
    })
  })

  describe('empty LLM content with no tool calls', () => {
    it('uses guardrail message when LLM returns empty content and no tool calls', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => ({
          content: '',
          tool_calls: [],
          finish_reason: FinishReason.Stop,
        }))

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      const result = await engine.sendMessage('hello', onEvent)

      // Guardrail should override empty content
      expect(result.text).toBe(NO_DATA_MESSAGE)
      // History should contain the guardrail message, not empty string
      const assistantMsg = result.history.find(m => m.role === MessageRole.Assistant)
      expect(assistantMsg?.content).toBe(NO_DATA_MESSAGE)
    })
  })

  describe('setHistory then sendMessage', () => {
    it('uses restored history in subsequent LLM calls', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      engine.setHistory([
        { role: MessageRole.User, content: 'previous question' },
        { role: MessageRole.Assistant, content: 'previous answer' },
      ])

      await engine.sendMessage('new question', onEvent)

      // LLM should receive: system + restored history + new user message
      const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
      const messages = firstCall[0] as ChatMessage[]
      expect(messages[0]!.role).toBe(MessageRole.System)
      expect(messages[1]!.role).toBe(MessageRole.User)
      expect(messages[1]!.content).toBe('previous question')
      expect(messages[2]!.role).toBe(MessageRole.Assistant)
      expect(messages[2]!.content).toBe('previous answer')
      expect(messages[3]!.role).toBe(MessageRole.User)
      expect(messages[3]!.content).toBe('new question')
    })
  })

  describe('processResponse with guardrail', () => {
    it('processResponse is NOT called on guardrail path (no tools called)', async () => {
      const receivedText: string[] = []
      const plugin: ChatEnginePlugin = {
        id: 'guardrail-observer',
        processResponse: (text) => {
          receivedText.push(text)
          return `[modified] ${text}`
        },
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('LLM knowledge answer')
          return textResponse('LLM knowledge answer')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext, { mergeStrategy: MergeStrategy.Array }, [plugin])
      const result = await engine.sendMessage('What is 2+2?', onEvent)

      // In focus-first flow, processResponse only runs in Phase B (after tool calls).
      // On the guardrail path (no tools called), processResponse is skipped.
      expect(receivedText).toEqual([])
      expect(result.text).toBe(NO_DATA_MESSAGE)
    })
  })

  describe('non-Error rejection', () => {
    it('handles non-Error thrown from LLM', async () => {
      const llm: LLMCompletionFn = vi.fn().mockRejectedValue('string rejection')
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext)
      await expect(engine.sendMessage('test', onEvent)).rejects.toBe('string rejection')

      const errorEvent = events.find(e => e.type === ChatEventType.Error)
      expect(errorEvent).toBeDefined()
      if (errorEvent?.type === ChatEventType.Error) {
        expect(errorEvent.error).toBe('string rejection')
      }
    })
  })

  describe('setExecutor', () => {
    it('uses the new executor after setExecutor', async () => {
      const oldExecutor: ToolExecutorFn = vi.fn().mockResolvedValue({ old: true })
      const newExecutor: ToolExecutorFn = vi.fn().mockResolvedValue({ new: true })

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const engine = new ChatEngine(llm, oldExecutor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      engine.setExecutor(newExecutor)
      const result = await engine.sendMessage('test', onEvent)

      expect(oldExecutor).not.toHaveBeenCalled()
      expect(newExecutor).toHaveBeenCalledWith('list_users', {})
      expect(result.toolResults[0]!.data).toEqual({ new: true })
    })
  })

  describe('focus-first flow', () => {
    it('emits StructuredReady before text tokens and TurnComplete', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found ')
          onToken('users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ focused: true }))

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: true,
        llmText,
      })
      const result = await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)

      // Event order: ToolCallResult → DataProcessing → StructuredReady → Token(s) → TurnComplete
      expect(eventTypes).toContain(ChatEventType.DataProcessing)
      expect(eventTypes).toContain(ChatEventType.StructuredReady)
      expect(eventTypes).toContain(ChatEventType.TurnComplete)

      const dpIdx = eventTypes.indexOf(ChatEventType.DataProcessing)
      const srIdx = eventTypes.indexOf(ChatEventType.StructuredReady)
      const tokenIdx = eventTypes.indexOf(ChatEventType.Token)
      const tcIdx = eventTypes.indexOf(ChatEventType.TurnComplete)
      expect(dpIdx).toBeLessThan(srIdx)
      expect(srIdx).toBeLessThan(tokenIdx)
      expect(tokenIdx).toBeLessThan(tcIdx)

      // Single tool result: focus LLM is skipped, raw data returned
      expect(result.structured.strategy).toBe(MergeStrategy.LlmGuided)
      expect(Array.isArray(result.structured.data)).toBe(true)

      // llmText should NOT be called for single tool result (focus LLM skipped)
      expect(llmText).not.toHaveBeenCalled()
    })

    it('emits StructuredReady even with Array strategy', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
        parallelMerge: false,
      })
      await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)
      // StructuredReady always fires in Phase B (regardless of strategy)
      expect(eventTypes).toContain(ChatEventType.StructuredReady)
      expect(eventTypes).toContain(ChatEventType.TurnComplete)
    })

    it('does not enter Phase B when no tool calls were made', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Hello')
          return textResponse('Hello')
        })

      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext, {
        parallelMerge: true,
      })
      await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)
      // No Phase B means no StructuredReady or DataProcessing
      expect(eventTypes).not.toContain(ChatEventType.StructuredReady)
      expect(eventTypes).not.toContain(ChatEventType.DataProcessing)
    })

    it('includes parallelMerge in getConfig', () => {
      const llm: LLMCompletionFn = vi.fn()
      const executor: ToolExecutorFn = vi.fn()

      const engine = new ChatEngine(llm, executor, testContext, { parallelMerge: false })
      expect(engine.getConfig().parallelMerge).toBe(false)

      const engine2 = new ChatEngine(llm, executor, testContext)
      expect(engine2.getConfig().parallelMerge).toBe(true) // default
    })

    it('falls back to Array strategy when merge LLM fails', async () => {
      // Use 2 tool results so the merge LLM is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response (still called after fallback)
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      // Merge LLM rejects — caught by engine's Phase B catch block
      const llmText = vi.fn().mockRejectedValue(new Error('Rate limited'))

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: true,
        llmText,
      })
      const result = await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain(ChatEventType.TurnComplete)

      // Should fall back to Array via engine's catch
      expect(result.structured.strategy).toBe(MergeStrategy.Array)
      expect(Array.isArray(result.structured.data)).toBe(true)

      // Engine should log the error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('buildStructuredResponse failed'),
        'Rate limited',
      )
    })

    it('uses llmText when provided instead of streaming llm for merge', async () => {
      // Use 2 tool results so the merge LLM is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ merged: true }))

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        llmText,
      })
      const result = await engine.sendMessage('test', onEvent)

      // llm called 3 times (2-tool call, end-of-tools, Phase B), llmText once (merge)
      expect(llm).toHaveBeenCalledTimes(3)
      expect(llmText).toHaveBeenCalledOnce()
      expect(result.structured.strategy).toBe(MergeStrategy.LlmGuided)
      expect(result.structured.data).toEqual({ merged: true })
    })

    it('falls back to streaming llm for merge when llmText is not provided', async () => {
      // Use 2 tool results so the merge LLM is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Third call: merge fallback (buildStructuredResponse uses streaming llm wrapper)
        .mockImplementationOnce(async () => ({
          content: JSON.stringify({ fallback: true }),
          tool_calls: [],
          finish_reason: FinishReason.Stop,
        }))
        // Fourth call: Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
      })
      const result = await engine.sendMessage('test', onEvent)

      // llm called 4 times: 2-tool call, end-of-tools, merge fallback, Phase B text
      expect(llm).toHaveBeenCalledTimes(4)
      expect(result.structured.data).toEqual({ fallback: true })
    })

    it('emits exactly one StructuredReady per turn', async () => {
      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ merged: true }))

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])
      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: true,
        llmText,
      })
      const result = await engine.sendMessage('test', onEvent)

      // Exactly one StructuredReady emitted
      const structuredReadyEvents = events.filter(e => e.type === ChatEventType.StructuredReady)
      expect(structuredReadyEvents).toHaveLength(1)
      // Single tool result: raw data returned (focus LLM skipped)
      expect(Array.isArray(result.structured.data)).toBe(true)
    })

    it('catches buildStructuredResponse throw at engine level', async () => {
      // Use 2 tool results so formatStructuredResponse is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response (still called after fallback)
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      // Mock formatStructuredResponse to throw
      const spy = vi.spyOn(responseModule, 'formatStructuredResponse')
        .mockRejectedValue(new Error('unexpected runtime crash'))

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: false,
      })

      const result = await engine.sendMessage('test', onEvent)

      // Should produce a valid result with Array fallback
      expect(result.structured.strategy).toBe(MergeStrategy.Array)
      expect(Array.isArray(result.structured.data)).toBe(true)

      // TurnComplete should still be emitted
      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain(ChatEventType.TurnComplete)

      // console.error should have been called
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('buildStructuredResponse failed'),
        'unexpected runtime crash',
      )

      spy.mockRestore()
    })

    it('emits DataProcessing → StructuredReady → Token → TurnComplete in order', async () => {
      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ focused: true }))

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found ')
          onToken('users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: true,
        llmText,
      })
      const result = await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain(ChatEventType.DataProcessing)
      expect(eventTypes).toContain(ChatEventType.StructuredReady)
      expect(eventTypes).toContain(ChatEventType.TurnComplete)

      const dpIdx = eventTypes.indexOf(ChatEventType.DataProcessing)
      const srIdx = eventTypes.indexOf(ChatEventType.StructuredReady)
      const tokenIdx = eventTypes.indexOf(ChatEventType.Token)
      const tcIdx = eventTypes.indexOf(ChatEventType.TurnComplete)
      expect(dpIdx).toBeLessThan(srIdx)
      expect(srIdx).toBeLessThan(tokenIdx)
      expect(tokenIdx).toBeLessThan(tcIdx)
      // Single tool result: raw data returned (focus LLM skipped)
      expect(Array.isArray(result.structured.data)).toBe(true)
    })

    it('updates llmText via setLlmText', async () => {
      // Use 2 tool results so the merge LLM is actually called
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => twoToolCallResponse())
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ updated: true }))

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: MergeStrategy.LlmGuided,
        parallelMerge: false,
      })
      // Set after construction
      engine.setLlmText(llmText)
      const result = await engine.sendMessage('test', onEvent)

      expect(llmText).toHaveBeenCalledOnce()
      expect(result.structured.data).toEqual({ updated: true })
    })
  })

  describe('context compression', () => {
    it('compresses tool messages in history after successful LLM-guided merge', async () => {
      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ focused: true }))

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1, name: 'Alice' }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: 'llm-guided',
        llmText,
        parallelMerge: false,
      })
      const result = await engine.sendMessage('list users', onEvent)

      // UI toolResults should have full raw data
      expect(result.toolResults[0]!.data).toEqual([{ id: 1, name: 'Alice' }])

      // History tool messages should be compressed
      const history = engine.getHistory()
      const toolMsgs = history.filter(m => m.role === 'tool')
      expect(toolMsgs).toHaveLength(1)

      const rawContent = toolMsgs[0]!.content!
      expect(rawContent).toContain('[API Result')
      expect(rawContent).toContain('[End of API Result]')
      // Extract JSON between the framing markers
      const jsonLine = rawContent.split('\n').find(l => l.startsWith('{'))!
      const compressed = JSON.parse(jsonLine)
      // Single tool result: focus LLM skipped, raw data used as focused
      expect(compressed.focused).toEqual([{ id: 1, name: 'Alice' }])
      expect(compressed.calls).toHaveLength(1)
      expect(compressed.calls[0].tool).toBe('list_users')
    })

    it('compresses with truncated raw data on Array fallback', async () => {
      const llmText = vi.fn().mockResolvedValue('not valid json at all')

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ users: [] })

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: 'llm-guided',
        llmText,
        parallelMerge: false,
      })
      await engine.sendMessage('test', onEvent)

      const history = engine.getHistory()
      const toolMsgs = history.filter(m => m.role === 'tool')
      expect(toolMsgs).toHaveLength(1)

      // Should be compressed even on Array fallback — with truncated raw data
      const rawContent = toolMsgs[0]!.content!
      expect(rawContent).toContain('[API Result')
      const jsonLine = rawContent.split('\n').find(l => l.startsWith('{'))!
      const content = JSON.parse(jsonLine)
      expect(content.calls).toHaveLength(1)
      expect(content.calls[0].tool).toBe('list_users')
    })

    it('compresses multi-tool turns with first containing focused data and rest containing refs', async () => {
      const multiTool: Tool = {
        type: 'function',
        function: {
          name: 'get_orders',
          description: 'Get orders',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      }

      const multiContext: ChatEngineContext = {
        ...testContext,
        tools: [testTool, multiTool],
      }

      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ merged: true }))

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => ({
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function' as const, function: { name: 'list_users', arguments: '{}' } },
            { id: 'call_2', type: 'function' as const, function: { name: 'get_orders', arguments: '{}' } },
          ],
          finish_reason: 'tool_calls' as const,
        }))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ orderId: 100 }])

      const engine = new ChatEngine(llm, executor, multiContext, {
        mergeStrategy: 'llm-guided',
        llmText,
        parallelMerge: false,
      })
      await engine.sendMessage('show users and orders', onEvent)

      const history = engine.getHistory()
      const toolMsgs = history.filter(m => m.role === 'tool')
      expect(toolMsgs).toHaveLength(2)

      // First tool message: compressed with focused data and text framing
      const firstContent = toolMsgs[0]!.content!
      expect(firstContent).toContain('[API Result')
      const firstJson = JSON.parse(firstContent.split('\n').find(l => l.startsWith('{'))!)
      expect(firstJson.focused).toEqual({ merged: true })
      expect(firstJson.calls).toHaveLength(2)

      // Second tool message: ref pointer
      expect(toolMsgs[1]!.content).toContain('See first tool result')
    })

    it('subsequent turns see compressed history in LLM input', async () => {
      const llmText = vi.fn().mockResolvedValue(JSON.stringify({ focused: true }))

      const llm: LLMCompletionFn = vi.fn()
        // Turn 1: tool call → end-of-tools → Phase B text
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('first response')
          return textResponse('first response')
        })
        // Turn 2: tool call → end-of-tools → Phase B text
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('second response')
          return textResponse('second response')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: 'llm-guided',
        llmText,
        parallelMerge: false,
      })

      await engine.sendMessage('first question', onEvent)
      await engine.sendMessage('second question', onEvent)

      // Check the LLM input for the 4th call (turn 2, first LLM call)
      // It should contain compressed history from turn 1
      const fourthCall = (llm as ReturnType<typeof vi.fn>).mock.calls[3]!
      const messages = fourthCall[0] as ChatMessage[]

      // Find the tool message from turn 1
      const toolMsg = messages.find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()

      expect(toolMsg!.content).toContain('[API Result')
      const jsonLine = toolMsg!.content!.split('\n').find(l => l.startsWith('{'))!
      const content = JSON.parse(jsonLine)
      // Single tool result: focus LLM skipped, raw data used as focused
      expect(Array.isArray(content.focused)).toBe(true)
    })
  })

  describe('setContext', () => {
    it('uses new context tools and prompt after setContext', async () => {
      const newTool: Tool = {
        type: 'function',
        function: {
          name: 'search_items',
          description: 'Search items',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      }
      const newContext: ChatEngineContext = {
        url: 'https://api2.example.com',
        spec: null,
        tools: [newTool],
        systemPrompt: 'New system prompt.',
      }

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('search_items', {}))
        .mockImplementationOnce(async () => textResponse('ignored'))
        // Phase B text response
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, {
        mergeStrategy: MergeStrategy.Array,
      })
      engine.setContext(newContext)
      await engine.sendMessage('test', onEvent)

      // LLM should receive the new system prompt
      const firstCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
      const messages = firstCall[0] as ChatMessage[]
      expect(messages[0]!.content).toBe('New system prompt.')

      // LLM should receive new tools
      const tools = firstCall[1] as Tool[]
      expect(tools).toHaveLength(1)
      expect(tools[0]!.function.name).toBe('search_items')
    })
  })
})
