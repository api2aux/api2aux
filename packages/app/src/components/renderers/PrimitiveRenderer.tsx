import { useState } from 'react'
import type { RendererProps } from '../../types/components'
import type { FieldType } from '../../types/schema'
import type { FieldRenderProps } from '../../types/plugins'
import { useConfigStore } from '../../store/configStore'
import { useAppStore } from '../../store/appStore'
import { ExternalLink } from '../ui/ExternalLink'
import { isImageUrl, isEmail, isColorValue, isCurrencyField, isRatingField, detectPrimitiveMode } from '@api2aux/data2ui'
import { registry } from '../registry/pluginRegistry'

// Existing semantic components (used directly when no plugin is registered yet)
import { StatusBadge } from './semantic/StatusBadge'
import { StarRating } from './semantic/StarRating'
import { CurrencyValue, detectCurrencyFromSiblings } from './semantic/CurrencyValue'
import { FormattedDate } from './semantic/FormattedDate'

const TEXT_TRUNCATE_LIMIT = 100
const TEXT_TRUNCATE_MAX = 500

/** Expandable text for long values — shows truncated text with "more"/"less" toggle */
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (text.length <= TEXT_TRUNCATE_LIMIT) return <span>{text}</span>
  const full = expanded ? text.slice(0, TEXT_TRUNCATE_MAX) : text.slice(0, TEXT_TRUNCATE_LIMIT)
  const suffix = !expanded ? '...' : text.length > TEXT_TRUNCATE_MAX ? '...' : ''
  const lastSpace = full.lastIndexOf(' ')
  const before = lastSpace > 0 ? full.slice(0, lastSpace + 1) : ''
  const lastWord = lastSpace > 0 ? full.slice(lastSpace + 1) : full
  return (
    <span>
      {before}
      <span className="inline whitespace-nowrap">
        {lastWord}{suffix}{' '}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className="text-primary hover:text-primary/80 text-xs cursor-pointer"
        >
          {expanded ? 'less' : 'more'}
        </button>
      </span>
    </span>
  )
}

/** Time ago helper for relative date rendering */
function timeAgo(date: Date): string {
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years > 1 ? 's' : ''} ago`
}

/** Check if a string value looks like a URL */
function isURL(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** Check if a URL points to a video (file or embed platform) */
function isVideoUrl(value: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(value)
    || /youtube\.com\/(watch\?v=|embed\/)/i.test(value)
    || /youtu\.be\//i.test(value)
    || /vimeo\.com\/\d+/i.test(value)
}

/** Check if a URL points to an audio file */
function isAudioUrl(value: string): boolean {
  return /\.(mp3|wav|ogg|flac|aac|m4a|wma|opus)(\?|$)/i.test(value)
}

/** Check if a string value looks like a date */
function isDateLike(value: string, fieldName: string): boolean {
  const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/
  if (isoPattern.test(value)) {
    return !isNaN(Date.parse(value))
  }
  const dateKeywords = ['date', 'created', 'updated', 'timestamp', 'time', 'at']
  const lowerFieldName = fieldName.toLowerCase()
  return dateKeywords.some((keyword) => lowerFieldName.includes(keyword))
}

/** Normalize path for cache lookup (convert indexed to generic) */
function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]')
}

/** Map render mode strings to plugin IDs */
const modeToPlugin: Record<string, string> = {
  rating: 'core/star-rating',
  currency: 'core/currency',
  email: 'core/email-link',
  color: 'core/color-swatch',
  code: 'core/code-block',
  link: 'core/link',
  image: 'core/image',
  text: 'core/text',
  phone: 'core/phone-link',
  copyable: 'core/copyable',
  progress: 'core/progress-bar',
  percentage: 'core/percentage',
  compact: 'core/compact-number',
  dot: 'core/dot-indicator',
  markdown: 'core/markdown',
  checkbox: 'core/checkbox',
  video: 'core/video-player',
  audio: 'core/audio-player',
  'stat-card': 'core/stat-card',
}

/**
 * Get available render modes for a value.
 * Exported for ComponentPicker to determine what options to show.
 */
export function getAvailableRenderModes(value: unknown, fieldName: string = ''): string[] {
  if (typeof value === 'number') {
    const modes: string[] = ['text']
    if (isRatingField(fieldName, value)) modes.push('rating')
    if (isCurrencyField(fieldName)) modes.push('currency')
    if (!modes.includes('rating')) modes.push('rating')
    if (!modes.includes('currency')) modes.push('currency')
    return modes
  }

  if (typeof value !== 'string') {
    return ['text']
  }

  if (isURL(value)) {
    const modes = ['text', 'link', 'image']
    if (isVideoUrl(value)) modes.push('video')
    if (isAudioUrl(value)) modes.push('audio')
    return modes
  }

  if (isDateLike(value, fieldName)) {
    return ['absolute', 'relative']
  }

  const modes: string[] = ['text']
  if (isEmail(value)) modes.push('email')
  if (isColorValue(value)) modes.push('color')
  modes.push('code')
  return modes
}

/**
 * Build FieldRenderProps for a plugin component.
 */
function buildRenderProps(
  data: unknown,
  path: string,
  schema: RendererProps['schema'],
  parentObject?: Record<string, unknown>,
): FieldRenderProps {
  const pathParts = path.split('.')
  const fieldName = pathParts[pathParts.length - 1] || ''
  return {
    value: data,
    fieldName,
    fieldPath: path,
    schema,
    context: parentObject ? { parentObject } : undefined,
  }
}

/**
 * Try to render via a plugin from the registry. Returns null if plugin not found.
 */
function renderViaPlugin(pluginId: string, props: FieldRenderProps): React.ReactElement | null {
  const plugin = registry.get(pluginId)
  if (!plugin) return null
  const Component = plugin.component
  return <Component {...props} />
}

/**
 * PrimitiveRenderer — thin registry router.
 *
 * Resolution precedence:
 *   1. User override (fieldConfigs.componentType)
 *   2. Semantic detection (analysis cache, high confidence)
 *   3. Heuristic detection (detectPrimitiveMode)
 *   4. Data-type default (core/text, core/number, core/boolean-badge)
 *
 * All rendering is delegated to plugin components when available,
 * with inline fallbacks for backward compatibility.
 */
export function PrimitiveRenderer({ data, schema, path }: RendererProps) {
  const { fieldConfigs } = useConfigStore()
  const { getAnalysisCache, data: rootData } = useAppStore()
  const [imageError, setImageError] = useState(false)

  if (schema.kind !== 'primitive') {
    return <span className="text-muted-foreground italic">Invalid primitive type</span>
  }

  const type: FieldType = schema.type
  const pathParts = path.split('.')
  const fieldPath = path
  const fieldName = pathParts[pathParts.length - 1] || ''

  // --- Cache lookup for semantic detection ---
  const parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('.') : path
  const normalizedPath = normalizePath(fieldPath)
  const normalizedParent = normalizePath(parentPath)

  const cached = getAnalysisCache(parentPath)
    || getAnalysisCache(normalizedParent)
    || getAnalysisCache(normalizedParent.replace(/\[\]$/, ''))
    || getAnalysisCache('$')

  const semantics = cached?.semantics?.get(fieldPath)
    || cached?.semantics?.get(normalizedPath)
  const hasHighConfidence = semantics && semantics.level === 'high'
  const category = hasHighConfidence ? semantics?.detectedCategory : null

  // --- Resolve parent object for currency detection ---
  let parentObj: Record<string, unknown> | undefined
  if (parentPath !== '$' && parentPath !== path) {
    let obj: any = rootData
    const parts = parentPath.replace(/^\$\.?/, '').split('.')
    for (const part of parts) {
      if (!obj) break
      const match = part.match(/^(.+?)\[(\d+)\]$/)
      if (match) {
        obj = obj?.[match[1]!]?.[parseInt(match[2]!, 10)]
      } else {
        obj = obj[part]
      }
    }
    if (obj && typeof obj === 'object') parentObj = obj
  }

  const props = buildRenderProps(data, path, schema, parentObj)

  // --- Handle null ---
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">null</span>
  }

  // --- User override (highest precedence) ---
  // Check both exact path and normalized path (config may be stored with generic [] indices)
  const config = fieldConfigs[path] || fieldConfigs[normalizedPath]
  const overrideMode = config?.componentType

  if (overrideMode) {
    // Direct plugin ID (e.g. 'core/star-rating')
    if (overrideMode.includes('/')) {
      const result = renderViaPlugin(overrideMode, props)
      if (result) return result
    }
    // Mode string mapped to plugin ID (e.g. 'rating' → 'core/star-rating')
    const pluginId = modeToPlugin[overrideMode]
    if (pluginId) {
      const result = renderViaPlugin(pluginId, props)
      if (result) return result
    }
    // Fallback for overrides that don't map to plugins yet (e.g. 'relative', 'absolute')
    if (overrideMode === 'relative' && typeof data === 'string') {
      try { return <span title={data}>{timeAgo(new Date(data))}</span> } catch { /* fall through */ }
    }
    if (overrideMode === 'absolute' && typeof data === 'string') {
      try { return <span title={data}>{new Date(data).toLocaleString()}</span> } catch { /* fall through */ }
    }
  }

  // --- Boolean ---
  if (type === 'boolean' && typeof data === 'boolean') {
    const isStatusBoolean = category === 'status'
      || /^(is_|has_|can_)?(active|enabled|verified|published|approved|visible|available|blocked|banned|deleted|suspended)/i.test(fieldName)

    if (isStatusBoolean) {
      return renderViaPlugin('core/status-badge', props) ?? <StatusBadge value={data} />
    }
    return renderViaPlugin('core/boolean-badge', props) ?? (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
        data ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
      }`}>{String(data)}</span>
    )
  }

  // --- Number ---
  if (type === 'number' && typeof data === 'number') {
    // Semantic detection
    if (category === 'rating') {
      return renderViaPlugin('core/star-rating', props) ?? <StarRating value={data} />
    }
    if (category === 'price') {
      return renderViaPlugin('core/currency', props) ?? (
        <CurrencyValue
          amount={data}
          currencyCode={parentObj ? detectCurrencyFromSiblings(fieldName, parentObj) : undefined}
        />
      )
    }

    // Heuristic detection
    const heuristicMode = detectPrimitiveMode(data, fieldName)
    if (heuristicMode === 'rating') {
      return renderViaPlugin('core/star-rating', props) ?? <StarRating value={data} />
    }
    if (heuristicMode === 'currency') {
      return renderViaPlugin('core/currency', props) ?? (
        <CurrencyValue
          amount={data}
          currencyCode={parentObj ? detectCurrencyFromSiblings(fieldName, parentObj) : undefined}
        />
      )
    }

    return renderViaPlugin('core/number', props) ?? <span>{data.toLocaleString()}</span>
  }

  // --- Date ---
  if (type === 'date' && typeof data === 'string') {
    try {
      if (category === 'date' || category === 'timestamp') {
        return renderViaPlugin('core/formatted-date', props) ?? <FormattedDate value={data} />
      }
      return <span title={data}>{new Date(data).toLocaleString()}</span>
    } catch {
      return <span>{data}</span>
    }
  }

  // --- String ---
  if (typeof data === 'string') {
    // URL detection
    if (isURL(data)) {
      const shouldAutoImage = isImageUrl(data) && overrideMode !== 'text'
      if (shouldAutoImage) {
        if (imageError) {
          return <span className="text-muted-foreground" title={data}>{data}</span>
        }
        return (
          <img
            src={data}
            alt={fieldName}
            className="max-h-48 object-contain"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        )
      }
      // Video URL detection
      if (isVideoUrl(data) && overrideMode !== 'text') {
        return renderViaPlugin('core/video-player', props) ?? <span title={data}>{data}</span>
      }
      // Audio URL detection
      if (isAudioUrl(data) && overrideMode !== 'text') {
        return renderViaPlugin('core/audio-player', props) ?? <span title={data}>{data}</span>
      }
      // Non-image URL: show as clickable link with interstitial
      const truncated = data.length > 100 ? `${data.slice(0, 100)}...` : data
      return <ExternalLink href={data} className="text-primary hover:text-primary/80 underline break-all" title={data}>{truncated}</ExternalLink>
    }

    // Date-like string detection
    if (isDateLike(data, fieldName)) {
      try {
        const date = new Date(data)
        if (!isNaN(date.getTime())) {
          if (category === 'date' || category === 'timestamp') {
            return renderViaPlugin('core/formatted-date', props) ?? <FormattedDate value={data} />
          }
          return <span title={data}>{date.toLocaleString()}</span>
        }
      } catch { /* fall through */ }
    }

    // Status string guard
    if (category === 'status') {
      const normalized = data.toLowerCase().trim()
      const isKnownStatus = /^(active|success|published|verified|approved|complete|completed|enabled|paid|delivered|open|live|available|done|error|failed|deleted|banned|rejected|cancelled|canceled|inactive|disabled|closed|expired|denied|blocked|pending|processing|review|in.?review|scheduled|syncing|indexing|draft|paused|waiting|suspended|on.?hold)$/i.test(normalized)
      if (isKnownStatus) {
        return renderViaPlugin('core/status-badge', props) ?? <StatusBadge value={data} />
      }
    }

    // Phone detection (semantic)
    if (category === 'phone') {
      return renderViaPlugin('core/phone-link', props) ?? <span>{data}</span>
    }

    // UUID/ID detection (semantic)
    if (category === 'uuid') {
      return renderViaPlugin('core/copyable', props) ?? <span>{data}</span>
    }

    // Heuristic detection
    const effectiveMode = detectPrimitiveMode(data, fieldName)
    if (effectiveMode === 'email' || isEmail(data)) {
      return renderViaPlugin('core/email-link', props) ?? (
        <a href={`mailto:${data}`} className="text-primary hover:text-primary/80 underline" onClick={(e) => e.stopPropagation()}>{data}</a>
      )
    }
    if (effectiveMode === 'color') {
      return renderViaPlugin('core/color-swatch', props) ?? (
        <span className="inline-flex items-center gap-2">
          <span className="w-5 h-5 rounded border border-border inline-block shrink-0" style={{ backgroundColor: data }} />
          <code className="text-xs font-mono text-foreground">{data}</code>
        </span>
      )
    }
    if (effectiveMode === 'code') {
      return renderViaPlugin('core/code-block', props) ?? (
        <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono">{data}</code>
      )
    }

    // Default text
    return renderViaPlugin('core/text', props) ?? (
      <ExpandableText text={data} />
    )
  }

  // Fallback
  return <span className="text-muted-foreground">{JSON.stringify(data)}</span>
}
