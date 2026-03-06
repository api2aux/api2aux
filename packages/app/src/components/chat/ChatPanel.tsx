import { useRef, useEffect, useState } from 'react'
import { useChat } from '../../hooks/useChat'
import { useChatStore } from '../../store/chatStore'
import { useAppStore } from '../../store/appStore'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatSettings } from './ChatSettings'

export function ChatPanel() {
  const { setOpen, clearMessages } = useChatStore()
  const url = useAppStore((s) => s.url)
  const { messages, sendMessage, sending, hasApiKey, contextStats } = useChat()
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(messages.length)

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessageCount.current = messages.length
  }, [messages.length])

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
          <span>{contextStats.messageCount} msgs in context</span>
          <span
            className={contextStats.estimatedTokens > 6000 ? 'text-amber-500' : ''}
            title="Approximate token count of conversation history sent to LLM"
          >
            ~{contextStats.estimatedTokens.toLocaleString()} tokens
          </span>
        </div>
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
