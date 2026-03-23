import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import type { SSEEvent } from '@api2aux/api-invoke'

interface StreamDisplayProps {
  onStop: () => void
}

function EventEntry({ event, index }: { event: SSEEvent; index: number }) {
  let parsedData: unknown = null
  try {
    parsedData = JSON.parse(event.data)
  } catch {
    // not JSON, show raw
  }

  return (
    <div className="border-b border-border last:border-b-0 px-3 py-2 hover:bg-muted/50">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
        {event.event && (
          <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            {event.event}
          </span>
        )}
        {event.id && (
          <span className="text-xs text-muted-foreground font-mono">id: {event.id}</span>
        )}
      </div>
      <pre className="text-sm font-mono text-foreground whitespace-pre-wrap break-all">
        {parsedData !== null ? JSON.stringify(parsedData, null, 2) : event.data}
      </pre>
    </div>
  )
}

export function StreamDisplay({ onStop }: StreamDisplayProps) {
  const streaming = useAppStore((s) => s.streaming)
  const streamEvents = useAppStore((s) => s.streamEvents)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [streamEvents.length])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">Stream</h3>
          <span className="text-sm text-muted-foreground">
            {streamEvents.length} event{streamEvents.length !== 1 ? 's' : ''}
          </span>
          {streaming && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              streaming...
            </span>
          )}
        </div>
        {streaming && (
          <button
            onClick={onStop}
            className="px-3 py-1.5 text-sm border border-red-300 text-red-700 rounded-md hover:bg-red-50 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      {/* Events list */}
      <div
        ref={scrollRef}
        className="border border-border rounded-md bg-card max-h-[60vh] overflow-y-auto"
      >
        {streamEvents.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Waiting for events...
          </div>
        ) : (
          streamEvents.map((event, i) => (
            <EventEntry key={i} event={event} index={i} />
          ))
        )}
      </div>
    </div>
  )
}
