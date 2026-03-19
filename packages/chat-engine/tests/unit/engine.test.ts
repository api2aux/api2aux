import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatEngine } from '../../src/engine'
import * as responseModule from '../../src/response'
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

describe('ChatEngine', () => {
  let events: ChatEngineEvent[]
  let onEvent: ChatEngineEventHandler

  beforeEach(() => {
    events = []
    onEvent = (event: ChatEngineEvent) => { events.push(event) }
  })

  describe('single-round text response', () => {
    it('returns text when LLM responds without tool calls', async () => {
      const llm: LLMCompletionFn = vi.fn()
        // First call: LLM calls a tool (we need at least one tool call to pass guardrail)
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          return toolCallResponse('list_users', {})
        })
        // Second call: LLM returns text
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found ')
          onToken('2 users.')
          return textResponse('Found 2 users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Here are 2 users.')
          return textResponse('Here are 2 users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext)
      await engine.sendMessage('Show users', onEvent)

      // Inspect messages sent to LLM on the second call
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Found users.')
          return textResponse('Found users.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ users: [] })

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Patient data')
          return textResponse('Patient data')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ users: [] })

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Patient data')
          return textResponse('Patient data')
        })
      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
      const result = await engine.sendMessage('test', onEvent)

      // Engine completes with the unmodified response text
      expect(result.text).toBe('Patient data')
    })
  })

  describe('onEvent error isolation', () => {
    it('completes the turn even when onEvent handler throws', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Done.')
          return textResponse('Done.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)

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
        .mockImplementation(async (_msgs, _tools, onToken) => {
          onToken('Response')
          return toolCallResponse('list_users', {})
        })
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('First')
          return textResponse('First')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
      await engine.sendMessage('Message 1', onEvent)

      const history = engine.getHistory()
      expect(history.length).toBeGreaterThan(0)
      expect(history[0]!.role).toBe(MessageRole.User)
      expect(history[0]!.content).toBe('Message 1')
    })

    it('clears history', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('Done.')
          return textResponse('Done.')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext)
      await engine.sendMessage('test', onEvent)

      const eventTypes = events.map(e => e.type)

      // Should be: tool_call_start, tool_call_result, token(s), turn_complete
      expect(eventTypes[0]).toBe(ChatEventType.ToolCallStart)
      expect(eventTypes[1]).toBe(ChatEventType.ToolCallResult)

      const tokenIndex = eventTypes.indexOf(ChatEventType.Token)
      expect(tokenIndex).toBeGreaterThan(1)

      const lastEvent = eventTypes[eventTypes.length - 1]
      expect(lastEvent).toBe(ChatEventType.TurnComplete)
    })
  })

  describe('structured response', () => {
    it('includes structured response in turn_complete', async () => {
      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
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

      const llm: LLMCompletionFn = vi.fn()
        .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

      const engine = new ChatEngine(llm, executor, testContext)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
      await engine.sendMessage('  hello  ', onEvent)

      const history = engine.getHistory()
      expect(history[0]!.content).toBe('hello')
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
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
    it('plugin receives guardrail text when no tool calls succeeded', async () => {
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

      const engine = new ChatEngine(llm, executor, testContext, undefined, [plugin])
      const result = await engine.sendMessage('What is 2+2?', onEvent)

      // Plugin should receive NO_DATA_MESSAGE, not the LLM's original text
      expect(receivedText).toEqual([NO_DATA_MESSAGE])
      expect(result.text).toBe(`[modified] ${NO_DATA_MESSAGE}`)
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
        .mockImplementationOnce(async (_msgs, _tools, onToken) => {
          onToken('ok')
          return textResponse('ok')
        })

      const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

      const engine = new ChatEngine(llm, executor, testContext)
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
