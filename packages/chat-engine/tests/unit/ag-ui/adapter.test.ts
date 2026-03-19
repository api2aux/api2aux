import { describe, it, expect, vi } from 'vitest'
import { mapEvent, createAgent } from '../../../src/ag-ui/adapter'
import { AgUiEventType, AgUiRole } from '../../../src/ag-ui/types'
import { ChatEventType, FinishReason, MergeStrategy } from '../../../src/types'
import { ChatEngine } from '../../../src/engine'
import type {
  LLMCompletionFn,
  ToolExecutorFn,
  ChatEngineContext,
  Tool,
  StreamResult,
} from '../../../src/types'
import type { AgUiEvent } from '../../../src/ag-ui/types'

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
  systemPrompt: 'Test assistant.',
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

function makeState() {
  return { messageId: null as string | null, toolCallCounter: 0, toolCallIdMap: new Map<string, string>() }
}

describe('mapEvent', () => {
  const threadId = 'thread_1'
  const runId = 'run_1'

  it('maps Token event — starts message on first token', () => {
    const state = makeState()

    const events = mapEvent(
      { type: ChatEventType.Token, token: 'Hello' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe(AgUiEventType.TextMessageStart)
    expect(events[1]!.type).toBe(AgUiEventType.TextMessageContent)

    if (events[1]!.type === AgUiEventType.TextMessageContent) {
      expect(events[1]!.delta).toBe('Hello')
    }
    expect(state.messageId).not.toBeNull()
  })

  it('maps Token event — no start on subsequent tokens', () => {
    const state = { ...makeState(), messageId: 'existing_id' }

    const events = mapEvent(
      { type: ChatEventType.Token, token: ' world' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(AgUiEventType.TextMessageContent)
  })

  it('maps ToolCallStart to Start + Args + End', () => {
    const state = makeState()

    const events = mapEvent(
      { type: ChatEventType.ToolCallStart, toolCallId: 'call_1', toolName: 'list_users', toolArgs: { limit: 10 }, parallelCount: 1 },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(3)
    expect(events[0]!.type).toBe(AgUiEventType.ToolCallStart)
    expect(events[1]!.type).toBe(AgUiEventType.ToolCallArgs)
    expect(events[2]!.type).toBe(AgUiEventType.ToolCallEnd)

    if (events[0]!.type === AgUiEventType.ToolCallStart) {
      expect(events[0]!.toolCallName).toBe('list_users')
    }
    if (events[1]!.type === AgUiEventType.ToolCallArgs) {
      expect(events[1]!.delta).toBe(JSON.stringify({ limit: 10 }))
    }
  })

  it('maps ToolCallResult using toolCallId correlation', () => {
    const state = makeState()

    // First register a tool call via ToolCallStart
    mapEvent(
      { type: ChatEventType.ToolCallStart, toolCallId: 'call_abc', toolName: 'list_users', toolArgs: {}, parallelCount: 1 },
      state,
      threadId,
      runId,
    )

    // Then map the result — should correlate via toolCallId
    const events = mapEvent(
      { type: ChatEventType.ToolCallResult, toolCallId: 'call_abc', toolName: 'list_users', toolArgs: {}, data: [{ id: 1 }], summary: 'ok' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(AgUiEventType.ToolCallResult)
    if (events[0]!.type === AgUiEventType.ToolCallResult) {
      expect(events[0]!.role).toBe(AgUiRole.Tool)
      expect(events[0]!.toolCallId).toBe('tc_1')
    }
  })

  it('truncates large tool result content at 8000 chars', () => {
    const state = makeState()

    mapEvent(
      { type: ChatEventType.ToolCallStart, toolCallId: 'call_big', toolName: 'list_users', toolArgs: {}, parallelCount: 1 },
      state,
      threadId,
      runId,
    )

    const largeData = { payload: 'x'.repeat(9000) }
    const events = mapEvent(
      { type: ChatEventType.ToolCallResult, toolCallId: 'call_big', toolName: 'list_users', toolArgs: {}, data: largeData, summary: 'ok' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === AgUiEventType.ToolCallResult) {
      expect(events[0]!.content.length).toBeLessThanOrEqual(8000 + 20) // 8000 + truncation marker
      expect(events[0]!.content).toContain('... [truncated]')
    }
  })

  it('handles unserializable tool result data gracefully', () => {
    const state = makeState()

    mapEvent(
      { type: ChatEventType.ToolCallStart, toolCallId: 'call_circ', toolName: 'list_users', toolArgs: {}, parallelCount: 1 },
      state,
      threadId,
      runId,
    )

    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    const events = mapEvent(
      { type: ChatEventType.ToolCallResult, toolCallId: 'call_circ', toolName: 'list_users', toolArgs: {}, data: circular, summary: 'ok' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === AgUiEventType.ToolCallResult) {
      expect(events[0]!.content).toBe('[Unserializable data]')
    }
  })

  it('maps ToolCallError as ToolCallResult with error', () => {
    const state = makeState()

    // Register the tool call
    mapEvent(
      { type: ChatEventType.ToolCallStart, toolCallId: 'call_err', toolName: 'list_users', toolArgs: {}, parallelCount: 1 },
      state,
      threadId,
      runId,
    )

    const events = mapEvent(
      { type: ChatEventType.ToolCallError, toolCallId: 'call_err', toolName: 'list_users', toolArgs: {}, error: 'Network error' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(AgUiEventType.ToolCallResult)
    if (events[0]!.type === AgUiEventType.ToolCallResult) {
      expect(events[0]!.content).toContain('Network error')
    }
  })

  it('maps TurnComplete to MessageEnd + StateSnapshot + RunFinished', () => {
    const state = { ...makeState(), messageId: 'msg_1' }

    const events = mapEvent(
      {
        type: ChatEventType.TurnComplete,
        text: 'Done.',
        toolResults: [],
        structured: { strategy: MergeStrategy.Array, sources: [], data: [] },
      },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(3)
    expect(events[0]!.type).toBe(AgUiEventType.TextMessageEnd)
    expect(events[1]!.type).toBe(AgUiEventType.StateSnapshot)
    expect(events[2]!.type).toBe(AgUiEventType.RunFinished)

    if (events[2]!.type === AgUiEventType.RunFinished) {
      expect(events[2]!.threadId).toBe(threadId)
      expect(events[2]!.runId).toBe(runId)
    }
  })

  it('maps TurnComplete without message end when no message was started', () => {
    const state = makeState()

    const events = mapEvent(
      {
        type: ChatEventType.TurnComplete,
        text: 'Done.',
        toolResults: [],
        structured: { strategy: MergeStrategy.Array, sources: [], data: [] },
      },
      state,
      threadId,
      runId,
    )

    // No TextMessageEnd since no message was started
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe(AgUiEventType.StateSnapshot)
    expect(events[1]!.type).toBe(AgUiEventType.RunFinished)
  })

  it('maps Error to RunError', () => {
    const state = makeState()

    const events = mapEvent(
      { type: ChatEventType.Error, error: 'Rate limited' },
      state,
      threadId,
      runId,
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(AgUiEventType.RunError)
    if (events[0]!.type === AgUiEventType.RunError) {
      expect(events[0]!.message).toBe('Rate limited')
    }
  })
})

describe('createAgent', () => {
  it('produces complete AG-UI event sequence for tool call flow', async () => {
    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('Found users.')
        return textResponse('Found users.')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue([{ id: 1 }])

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    })
    const agent = createAgent(engine)

    const events: AgUiEvent[] = []
    for await (const event of agent.run({
      threadId: 'thread_1',
      runId: 'run_1',
      messages: [{ role: AgUiRole.User, content: 'list users' }],
    })) {
      events.push(event)
    }

    const types = events.map(e => e.type)

    // First event: RUN_STARTED
    expect(types[0]).toBe(AgUiEventType.RunStarted)

    // Should include tool call events
    expect(types).toContain(AgUiEventType.ToolCallStart)
    expect(types).toContain(AgUiEventType.ToolCallArgs)
    expect(types).toContain(AgUiEventType.ToolCallEnd)
    expect(types).toContain(AgUiEventType.ToolCallResult)

    // Should include text message events
    expect(types).toContain(AgUiEventType.TextMessageStart)
    expect(types).toContain(AgUiEventType.TextMessageContent)
    expect(types).toContain(AgUiEventType.TextMessageEnd)

    // Should include state snapshot and run finished
    expect(types).toContain(AgUiEventType.StateSnapshot)

    // Last event: RUN_FINISHED
    expect(types[types.length - 1]).toBe(AgUiEventType.RunFinished)
  })

  it('emits RUN_ERROR when engine throws', async () => {
    const llm: LLMCompletionFn = vi.fn().mockRejectedValue(new Error('API error'))
    const executor: ToolExecutorFn = vi.fn()

    const engine = new ChatEngine(llm, executor, testContext)
    const agent = createAgent(engine)

    const events: AgUiEvent[] = []
    for await (const event of agent.run({
      threadId: 't',
      runId: 'r',
      messages: [{ role: AgUiRole.User, content: 'hello' }],
    })) {
      events.push(event)
    }

    const types = events.map(e => e.type)
    expect(types[0]).toBe(AgUiEventType.RunStarted)
    expect(types).toContain(AgUiEventType.RunError)

    const errorEvent = events.find(e => e.type === AgUiEventType.RunError)
    if (errorEvent?.type === AgUiEventType.RunError) {
      expect(errorEvent.message).toBe('API error')
    }
  })

  it('emits RUN_ERROR when no user message provided', async () => {
    const llm: LLMCompletionFn = vi.fn()
    const executor: ToolExecutorFn = vi.fn()

    const engine = new ChatEngine(llm, executor, testContext)
    const agent = createAgent(engine)

    const events: AgUiEvent[] = []
    for await (const event of agent.run({ threadId: 't', runId: 'r' })) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(AgUiEventType.RunError)
    if (events[0]!.type === AgUiEventType.RunError) {
      expect(events[0]!.message).toContain('No user message')
    }
  })

  it('passes AG-UI tools to engine context', async () => {
    const customTool: Tool = {
      type: 'function',
      function: {
        name: 'custom_tool',
        description: 'Custom',
        parameters: { type: 'object', properties: {} },
      },
    }

    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('custom_tool', {}))
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('ok')
        return textResponse('ok')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue({ done: true })

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    })
    const agent = createAgent(engine)

    const events: AgUiEvent[] = []
    for await (const event of agent.run({
      threadId: 't',
      runId: 'r',
      tools: [customTool],
      messages: [{ role: AgUiRole.User, content: 'use custom tool' }],
    })) {
      events.push(event)
    }

    // Verify the custom tool was used
    expect(executor).toHaveBeenCalledWith('custom_tool', {})
  })

  it('extracts user message from AG-UI messages', async () => {
    const llm: LLMCompletionFn = vi.fn()
      .mockImplementationOnce(async () => toolCallResponse('list_users', {}))
      .mockImplementationOnce(async (_msgs, _tools, onToken) => {
        onToken('ok')
        return textResponse('ok')
      })

    const executor: ToolExecutorFn = vi.fn().mockResolvedValue([])

    const engine = new ChatEngine(llm, executor, testContext, {
      mergeStrategy: MergeStrategy.Array,
    })
    const agent = createAgent(engine)

    const events: AgUiEvent[] = []
    for await (const event of agent.run({
      threadId: 't',
      runId: 'r',
      messages: [
        { role: AgUiRole.User, content: 'first message' },
        { role: AgUiRole.Assistant, content: 'reply' },
        { role: AgUiRole.User, content: 'latest question' },
      ],
    })) {
      events.push(event)
    }

    // The engine should receive the latest user message
    const firstLlmCall = (llm as ReturnType<typeof vi.fn>).mock.calls[0]!
    const messages = firstLlmCall[0] as Array<{ role: string; content: string | null }>
    const userMsg = messages.find(m => m.role === 'user')
    expect(userMsg?.content).toBe('latest question')
  })
})
