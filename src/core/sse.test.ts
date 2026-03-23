import { describe, it, expect } from 'vitest'
import { parseSSE } from './sse'
import type { SSEEvent } from './types'

/** Create a ReadableStream from a string. */
function streamFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

/** Create a ReadableStream from multiple string chunks (simulates chunked delivery). */
function chunkedStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

/** Collect all events from a stream. */
async function collect(body: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = []
  for await (const event of parseSSE(body)) {
    events.push(event)
  }
  return events
}

describe('parseSSE', () => {
  it('parses a basic data event', async () => {
    const events = await collect(streamFrom('data: hello\n\n'))
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('parses a named event', async () => {
    const events = await collect(streamFrom('event: update\ndata: payload\n\n'))
    expect(events).toEqual([{ event: 'update', data: 'payload' }])
  })

  it('joins multi-line data with newlines', async () => {
    const events = await collect(streamFrom('data: line1\ndata: line2\n\n'))
    expect(events).toEqual([{ data: 'line1\nline2' }])
  })

  it('parses event with id field', async () => {
    const events = await collect(streamFrom('id: 42\ndata: msg\n\n'))
    expect(events).toEqual([{ id: '42', data: 'msg' }])
  })

  it('parses valid retry field', async () => {
    const events = await collect(streamFrom('retry: 3000\ndata: msg\n\n'))
    expect(events).toEqual([{ retry: 3000, data: 'msg' }])
  })

  it('ignores non-integer retry field', async () => {
    const events = await collect(streamFrom('retry: abc\ndata: msg\n\n'))
    expect(events).toEqual([{ data: 'msg' }])
  })

  it('skips comment lines', async () => {
    const events = await collect(streamFrom(': this is a comment\ndata: msg\n\n'))
    expect(events).toEqual([{ data: 'msg' }])
  })

  it('parses multiple events', async () => {
    const events = await collect(streamFrom('data: first\n\ndata: second\n\n'))
    expect(events).toEqual([{ data: 'first' }, { data: 'second' }])
  })

  it('handles no space after colon', async () => {
    const events = await collect(streamFrom('data:nospace\n\n'))
    expect(events).toEqual([{ data: 'nospace' }])
  })

  it('handles empty data field', async () => {
    const events = await collect(streamFrom('data:\n\n'))
    expect(events).toEqual([{ data: '' }])
  })

  it('handles chunked delivery across chunk boundaries', async () => {
    // Split "data: hello\n\n" across two chunks mid-word
    const events = await collect(chunkedStream('data: hel', 'lo\n\n'))
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('yields [DONE] as normal data', async () => {
    const events = await collect(streamFrom('data: [DONE]\n\n'))
    expect(events).toEqual([{ data: '[DONE]' }])
  })

  it('handles \\r\\n line endings', async () => {
    const events = await collect(streamFrom('data: hello\r\n\r\n'))
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('dispatches trailing event at stream end without final blank line', async () => {
    const events = await collect(streamFrom('data: trailing'))
    expect(events).toEqual([{ data: 'trailing' }])
  })

  it('ignores events with no data lines', async () => {
    // event type set but no data — should not yield
    const events = await collect(streamFrom('event: ping\n\ndata: real\n\n'))
    expect(events).toEqual([{ data: 'real' }])
  })

  it('handles field with no colon (value is empty string)', async () => {
    // Per spec: if no colon, field name = entire line, value = ""
    // "data" with no colon means data field with empty value
    const events = await collect(streamFrom('data\n\n'))
    expect(events).toEqual([{ data: '' }])
  })

  it('handles multiple chunks splitting a CRLF', async () => {
    // \r in first chunk, \n in second chunk
    const events = await collect(chunkedStream('data: split\r', '\ndata: next\r\n\r\n'))
    expect(events).toEqual([{ data: 'split\nnext' }])
  })

  it('preserves extra spaces in data values', async () => {
    // Only ONE leading space is stripped per spec
    const events = await collect(streamFrom('data:  two spaces\n\n'))
    expect(events).toEqual([{ data: ' two spaces' }])
  })

  it('ignores negative retry values per spec', async () => {
    const events = await collect(streamFrom('retry: -1000\ndata: msg\n\n'))
    expect(events).toEqual([{ data: 'msg' }])
  })

  it('ignores retry with decimal values', async () => {
    const events = await collect(streamFrom('retry: 3000.5\ndata: msg\n\n'))
    expect(events).toEqual([{ data: 'msg' }])
  })

  it('ignores id fields containing NULL character', async () => {
    const events = await collect(streamFrom('id: has\0null\ndata: msg\n\n'))
    expect(events).toEqual([{ data: 'msg' }])
  })

  it('handles bare \\r line endings', async () => {
    const events = await collect(streamFrom('data: hello\r\rdata: world\r\r'))
    expect(events).toEqual([{ data: 'hello' }, { data: 'world' }])
  })

  it('yields nothing for an empty stream', async () => {
    const events = await collect(streamFrom(''))
    expect(events).toEqual([])
  })

  it('yields nothing for comment-only stream', async () => {
    const events = await collect(streamFrom(': just a comment\n'))
    expect(events).toEqual([])
  })

  it('propagates stream read errors', async () => {
    let pullCount = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'))
        } else {
          controller.error(new Error('connection reset'))
        }
      },
    })
    const events: SSEEvent[] = []
    await expect(async () => {
      for await (const event of parseSSE(body)) {
        events.push(event)
      }
    }).rejects.toThrow('connection reset')
    expect(events).toEqual([{ data: 'first' }])
  })

  it('releases reader lock on early consumer break', async () => {
    const body = streamFrom('data: a\n\ndata: b\n\ndata: c\n\n')
    const events: SSEEvent[] = []
    for await (const event of parseSSE(body)) {
      events.push(event)
      if (events.length === 1) break
    }
    expect(events).toEqual([{ data: 'a' }])
    // Reader lock should be released — body should not be locked
    expect(body.locked).toBe(false)
  })

  it('throws on invalid UTF-8 data', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xFF, 0xFE]))
        controller.close()
      },
    })
    await expect(collect(body)).rejects.toThrow('SSE stream contains invalid UTF-8 data')
  })

  it('handles a realistic OpenAI-style stream', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')
    const events = await collect(streamFrom(stream))
    expect(events).toHaveLength(3)
    expect(events[0].data).toBe('{"choices":[{"delta":{"content":"Hello"}}]}')
    expect(events[1].data).toBe('{"choices":[{"delta":{"content":" world"}}]}')
    expect(events[2].data).toBe('[DONE]')
  })
})
