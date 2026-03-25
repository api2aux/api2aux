import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

const SPEC_HOSTING_HOSTS = [
  'raw.githubusercontent.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'gist.github.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]

function isSuspiciousBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    return SPEC_HOSTING_HOSTS.some(h => host === h || host.endsWith('.' + h))
  } catch {
    // Not a valid URL — can't be a known CDN host
    return false
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

interface BaseUrlFieldProps {
  specBaseUrl: string
}

export function BaseUrlField({ specBaseUrl }: BaseUrlFieldProps) {
  const baseUrlOverride = useAppStore((s) => s.baseUrlOverride)
  const setBaseUrlOverride = useAppStore((s) => s.setBaseUrlOverride)

  const effectiveUrl = baseUrlOverride ?? specBaseUrl
  const suspicious = isSuspiciousBaseUrl(effectiveUrl)
  const isOverridden = baseUrlOverride !== null

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(effectiveUrl)
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // Keep draft in sync with external value, but only when not actively editing
  useEffect(() => {
    if (!editing) {
      setDraft(effectiveUrl)
      setInvalid(false)
    }
  }, [effectiveUrl, editing])

  const handleSubmit = () => {
    const trimmed = draft.trim().replace(/\/$/, '')
    if (!trimmed || trimmed === specBaseUrl) {
      setBaseUrlOverride(null)
      setInvalid(false)
      setEditing(false)
      return
    }
    if (!isValidHttpUrl(trimmed)) {
      setInvalid(true)
      return
    }
    setBaseUrlOverride(trimmed)
    setInvalid(false)
    setEditing(false)
  }

  const handleReset = () => {
    setBaseUrlOverride(null)
    setDraft(specBaseUrl)
    setInvalid(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') { setDraft(effectiveUrl); setInvalid(false); setEditing(false) }
          }}
          onBlur={handleSubmit}
          className={`flex-1 text-sm bg-transparent border rounded px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 ${
            invalid ? 'border-red-500 focus:ring-red-500' : 'border-border focus:ring-primary'
          }`}
          spellCheck={false}
        />
        {isOverridden && (
          <button
            onMouseDown={(e) => { e.preventDefault(); handleReset() }}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Reset to spec value"
          >
            reset
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 mt-1 group">
      {suspicious && (
        <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      )}
      <button
        onClick={() => setEditing(true)}
        className={`text-sm text-left truncate transition-colors ${
          suspicious
            ? 'text-amber-500 hover:text-amber-400'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title={suspicious ? 'This looks like a spec hosting URL, not the API. Click to edit.' : 'Click to edit base URL'}
      >
        {effectiveUrl}
      </button>
      <svg className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
      </svg>
      {isOverridden && (
        <span className="text-[10px] text-primary">(edited)</span>
      )}
    </div>
  )
}
