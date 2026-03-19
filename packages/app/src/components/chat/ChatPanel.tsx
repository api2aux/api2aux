import { useRef, useEffect, useState } from 'react'
import type { ChatMessage as LLMMessage } from '../../services/llm/types'
import { useChat } from '../../hooks/useChat'
import { useChatStore } from '../../store/chatStore'
import { useAppStore } from '../../store/appStore'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatSettings } from './ChatSettings'

export function ChatPanel() {
  const { setOpen, chatApiUrl } = useChatStore()
  const url = useAppStore((s) => s.url)
  const { messages, sendMessage, clearMessages, sending, hasApiKey, contextStats, llmHistory } = useChat()
  const [showSettings, setShowSettings] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(messages.length)

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessageCount.current = messages.length
  }, [messages.length])

  // Auto-scroll during streaming (text updates in place, message count doesn't change)
  const lastMessage = messages[messages.length - 1]
  useEffect(() => {
    if (sending && lastMessage?.role === 'assistant') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [sending, lastMessage?.text, lastMessage?.role])

  // Show settings by default when no API key
  useEffect(() => {
    if (!hasApiKey) {
      setShowSettings(true)
    }
  }, [hasApiKey])

  return (
    <div className="h-full bg-background border-l border-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm text-foreground">Chat with API</h2>
          {url && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px]" title={url}>
              {new URL(url).hostname}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Clear chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Settings (collapsible) */}
      {showSettings && <ChatSettings />}

      {/* Stale chat banner — shown when API changed since last chat */}
      {messages.length > 0 && chatApiUrl && url && url.split('?')[0] !== chatApiUrl && (
        <div className="mx-3 mt-2 p-2.5 rounded-md bg-muted border border-border text-xs text-muted-foreground">
          <p className="mb-1.5">This chat was with a different API.</p>
          <div className="flex gap-2">
            <button
              onClick={clearMessages}
              className="px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
            >
              Start fresh
            </button>
            <button
              onClick={() => useChatStore.getState().setChatApiUrl(url!.split('?')[0] ?? '')}
              className="px-2 py-1 rounded bg-muted hover:bg-accent text-foreground transition-colors text-xs"
            >
              Keep chat
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center px-8">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {!url
                  ? 'Paste an API URL first, then chat with it here.'
                  : !hasApiKey
                    ? 'Set your API key above to start chatting.'
                    : 'Ask anything about this API. I\'ll query it and show you the results.'}
              </p>
              {url && hasApiKey && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Try:</p>
                  <button
                    onClick={() => sendMessage('Show me all the data')}
                    className="text-xs text-primary hover:underline"
                  >
                    "Show me all the data"
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Context indicator */}
      {contextStats.messageCount > 0 && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[10px] text-muted-foreground">
          <span>
            {contextStats.messageCount} msgs in{' '}
            <button
              onClick={() => setShowContext(true)}
              className="underline hover:text-foreground transition-colors cursor-pointer"
            >
              context
            </button>
          </span>
          <span
            className={contextStats.estimatedTokens > 6000 ? 'text-amber-500' : ''}
            title="Approximate token count of conversation history sent to LLM"
          >
            ~{contextStats.estimatedTokens.toLocaleString()} tokens
          </span>
        </div>
      )}

      {/* Context dialog */}
      {showContext && (
        <ContextDialog history={llmHistory} onClose={() => setShowContext(false)} />
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        disabled={sending || !url || !hasApiKey}
        placeholder={
          !url ? 'Paste an API URL first...'
          : !hasApiKey ? 'Set API key in settings...'
          : 'Ask about this API...'
        }
      />
    </div>
  )
}

function roleBadge(role: string) {
  const styles: Record<string, string> = {
    system: 'bg-purple-500/15 text-purple-400',
    user: 'bg-primary/15 text-primary',
    assistant: 'bg-muted text-foreground',
    tool: 'bg-amber-500/15 text-amber-400',
  }
  return styles[role] || 'bg-muted text-muted-foreground'
}

/** Pretty-print a string if it looks like JSON */
function formatContent(text: string | null): string {
  if (!text) return '(empty)'
  try {
    const parsed = JSON.parse(text)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return text
  }
}

function ContextDialog({ history, onClose }: { history: LLMMessage[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = JSON.stringify(history, null, 2)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-150 max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">LLM Context ({history.length} messages)</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Copy full context as JSON"
            >
              {copied ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages in context yet.</p>
          ) : (
            history.map((msg, i) => {
              const toolCallId = msg.role === 'tool' ? msg.tool_call_id : undefined
              const toolCalls = msg.role === 'assistant' && msg.content === null ? msg.tool_calls : undefined
              return (
                <div key={i} className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${roleBadge(msg.role)}`}>
                      {msg.role}
                    </span>
                    {toolCallId && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        id: {toolCallId}
                      </span>
                    )}
                  </div>
                  {toolCalls && toolCalls.length > 0 ? (
                    <div className="space-y-1">
                      {toolCalls.map((tc, j) => (
                        <pre key={j} className="bg-muted rounded p-2 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap">
                          {tc.function.name}({formatContent(tc.function.arguments)})
                        </pre>
                      ))}
                    </div>
                  ) : (
                    <pre className="bg-muted rounded p-2 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap">
                      {formatContent(msg.content)}
                    </pre>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/** Button to toggle the chat panel, placed in the app toolbar */
export function ChatButton() {
  const { toggle, open } = useChatStore()
  const url = useAppStore((s) => s.url)

  if (!url) return null

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        open
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      }`}
      title="Chat with this API"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      Chat
    </button>
  )
}
