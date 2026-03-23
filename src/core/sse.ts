import type { SSEEvent } from './types'

/**
 * Parse a Server-Sent Events stream into an async iterable of events.
 * Implements the WHATWG SSE parsing algorithm.
 *
 * @param body - ReadableStream from a fetch response (e.g. `response.body`)
 * @returns Async generator yielding parsed {@link SSEEvent} objects
 * @throws {Error} If the stream contains invalid UTF-8 data
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''

  // Event accumulator
  let eventType: string | undefined
  let dataLines: string[] = []
  let id: string | undefined
  let retry: number | undefined
  let hasData = false

  function buildEvent(): SSEEvent {
    const event: SSEEvent = { data: dataLines.join('\n') }
    if (eventType !== undefined) event.event = eventType
    if (id !== undefined) event.id = id
    if (retry !== undefined) event.retry = retry
    return event
  }

  function resetAccumulator(): void {
    eventType = undefined
    dataLines = []
    id = undefined
    retry = undefined
    hasData = false
  }

  function processLine(line: string): SSEEvent | undefined {
    // Empty line: dispatch event
    if (line === '') {
      if (hasData) {
        const event = buildEvent()
        resetAccumulator()
        return event
      }
      resetAccumulator()
      return undefined
    }

    // Comment
    if (line[0] === ':') return undefined

    // Parse field
    const colonIdx = line.indexOf(':')
    let field: string
    let value: string

    if (colonIdx === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colonIdx)
      // Strip one leading space after colon per spec
      value = line[colonIdx + 1] === ' ' ? line.slice(colonIdx + 2) : line.slice(colonIdx + 1)
    }

    switch (field) {
      case 'data':
        dataLines.push(value)
        hasData = true
        break
      case 'event':
        eventType = value
        break
      case 'id':
        // Per WHATWG spec, ignore id fields containing U+0000 NULL
        if (!value.includes('\0')) id = value
        break
      case 'retry': {
        // Per WHATWG spec, retry must consist of only ASCII digits (non-negative integer)
        const n = parseInt(value, 10)
        if (!isNaN(n) && n >= 0 && String(n) === value) retry = n
        break
      }
      // Unknown fields are ignored per spec
    }

    return undefined
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      try {
        buffer += decoder.decode(value, { stream: true })
      } catch (decodeError) {
        throw new Error('SSE stream contains invalid UTF-8 data', { cause: decodeError })
      }

      // Split on \r\n, \r, or \n — handle all line endings
      // Process complete lines, keep incomplete last segment in buffer
      // If buffer ends with \r, keep it — next chunk may start with \n (CRLF)
      let startIdx = 0
      const limit = buffer.length - (buffer[buffer.length - 1] === '\r' ? 1 : 0)
      for (let i = 0; i < limit; i++) {
        if (buffer[i] === '\r' || buffer[i] === '\n') {
          const line = buffer.slice(startIdx, i)
          // Skip \n after \r (CRLF)
          if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++
          startIdx = i + 1

          const event = processLine(line)
          if (event) yield event
        }
      }
      buffer = buffer.slice(startIdx)
    }

    // Flush remaining buffer
    try {
      buffer += decoder.decode()
    } catch (decodeError) {
      throw new Error('SSE stream contains invalid UTF-8 data', { cause: decodeError })
    }
    if (buffer.length > 0) {
      const event = processLine(buffer)
      if (event) yield event
    }
    // Dispatch any accumulated event at stream end
    if (hasData) yield buildEvent()
  } finally {
    reader.releaseLock()
  }
}
