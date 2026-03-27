import type { Operation } from '@api2aux/semantic-analysis'
import { Lock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { methodBadgeClass } from '../../lib/method-colors'
import { AuthChainKeyIcon } from '../auth/AuthChainInline'
import { useAuthChainStore, getOrigin } from '../../store/authChainStore'
import { useAppStore } from '../../store/appStore'

/** Display path for an operation — always show the full path for clarity. */
function compactPath(path: string): string {
  return path
}

interface OperationItemProps {
  operation: Operation
  index: number
  isSelected: boolean
  onSelect: (index: number) => void
  /** When true, show operation name/id instead of path (e.g. GraphQL where all ops share /graphql) */
  showNameInsteadOfPath?: boolean
  /** Base URL for auth chain config */
  baseUrl?: string
}

export function OperationItem({ operation, index, isSelected, onSelect, showNameInsteadOfPath, baseUrl }: OperationItemProps) {
  const displayPath = showNameInsteadOfPath
    ? (operation.summary || operation.id)
    : compactPath(operation.path)

  const fullUrl = baseUrl ? `${baseUrl}${operation.path}` : ''
  const origin = baseUrl ? getOrigin(baseUrl) : ''
  const hasChain = useAuthChainStore((s) => origin ? !!s.getConfig(origin) : false)
  const isAuthEndpoint = useAuthChainStore((s) => fullUrl ? s.isAuthEndpointUrl(fullUrl) : false)

  // Per-operation state indicator
  const opResult = useAppStore((s) => s.operationResults[operation.id])

  return (
    <div className="flex items-center">
      <button
        onClick={() => onSelect(index)}
        title={operation.path}
        className={`
          flex-1 min-w-0 text-left px-3 py-2 transition-colors
          ${isSelected
            ? 'bg-primary/10 border-l-[3px] border-primary text-foreground font-medium'
            : 'hover:bg-muted/50 border-l-[3px] border-transparent'
          }
        `}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`px-1.5 py-0.5 text-xs font-semibold rounded uppercase shrink-0 ${methodBadgeClass(operation.method)}`}>
            {operation.method}
          </span>
          {operation.security && operation.security.length > 0 && (
            <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <code className="text-xs font-mono text-foreground truncate">
            {displayPath}
          </code>
          {/* Per-operation status indicator */}
          {opResult?.loading && (
            <Loader2 className="w-3 h-3 text-muted-foreground animate-spin shrink-0 ml-auto" />
          )}
          {opResult && !opResult.loading && opResult.data !== null && (
            <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 ml-auto" />
          )}
          {opResult && !opResult.loading && opResult.error && (
            <AlertCircle className="w-3 h-3 text-red-500 shrink-0 ml-auto" />
          )}
        </div>
        {!showNameInsteadOfPath && operation.summary && (
          <p className="text-xs text-muted-foreground truncate">
            {operation.summary}
          </p>
        )}
      </button>
      {/* Auth chain key icon — only show if no chain configured yet, or this IS the auth endpoint */}
      {baseUrl && (!hasChain || isAuthEndpoint) && (
        <span className={`shrink-0 pr-2 ${isAuthEndpoint ? '' : 'opacity-0 hover:opacity-100'} transition-opacity`}>
          <AuthChainKeyIcon url={fullUrl} method={operation.method} />
        </span>
      )}
    </div>
  )
}
