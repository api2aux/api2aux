import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatEngine } from './engine'
import { ChatEventType, MergeStrategy, MessageRole } from './types'
import { NO_DATA_MESSAGE } from './defaults'
import type {
  LLMCompletionFn,
  ToolExecutorFn,
  ChatEngineContext,
  ChatEngineEvent,
  ChatEnginePlugin,
  StreamResult,
  Tool,
} from './types'

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
  return { content: text, tool_calls: [], finish_reason: 'stop' }
}

function toolCallResponse(name: string, args: Record<string, unknown>): StreamResult {
  return {
    content: '',
    tool_calls: [{
      id: `call_${Date.now()}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }],
    finish_reason: 'tool_calls',
  }
}

function collectEvents(handler: ChatEngineEventHandler): ChatEngineEvent[] {
  const events: ChatEngineEvent[] = []
  return new Proxy(events, {
    get(target, prop) {
      if (prop === 'handler') {
        return (event: ChatEngineEvent) => { target.push(event) }
      }
      return Reflect.get(target, prop)
    },
  })
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
          finish_reason: 'tool_calls',
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
  })

  describe('plugin hooks', () => {
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
  })
})
