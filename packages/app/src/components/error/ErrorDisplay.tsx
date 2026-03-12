import { useState } from 'react'
import { ErrorKind } from '../../types/errors'
import type { AppError } from '../../types/errors'

interface ErrorDisplayProps {
  error: Error
  onRetry?: () => void
}

export function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  const [showDetails, setShowDetails] = useState(false)

  // Check if error implements AppError interface
  const isAppError = (err: Error): err is Error & AppError => {
    return 'kind' in err && 'suggestion' in err
  }

  const appError = isAppError(error) ? error : null
  const kind = appError?.kind || ErrorKind.Unknown

  // Configuration for each error type
  const errorConfig = {
    [ErrorKind.Cors]: {
      title: 'CORS Error',
      icon: '🛡️',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-300',
      textColor: 'text-red-800',
      iconBg: 'bg-red-100',
    },
    [ErrorKind.Network]: {
      title: 'Network Error',
      icon: '📡',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-300',
      textColor: 'text-orange-800',
      iconBg: 'bg-orange-100',
    },
    [ErrorKind.Api]: {
      title: 'API Error',
      icon: '⚠️',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-300',
      textColor: 'text-yellow-800',
      iconBg: 'bg-yellow-100',
    },
    [ErrorKind.Auth]: {
      title: 'Authentication Error',
      icon: '🔒',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-300',
      textColor: 'text-purple-800',
      iconBg: 'bg-purple-100',
    },
    [ErrorKind.Parse]: {
      title: 'Parse Error',
      icon: '📝',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-300',
      textColor: 'text-blue-800',
      iconBg: 'bg-blue-100',
    },
    [ErrorKind.Graphql]: {
      title: 'GraphQL Error',
      icon: '⬡',
      bgColor: 'bg-indigo-50',
      borderColor: 'border-indigo-300',
      textColor: 'text-indigo-800',
      iconBg: 'bg-indigo-100',
    },
    [ErrorKind.Unknown]: {
      title: 'Error',
      icon: '❌',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-300',
      textColor: 'text-gray-800',
      iconBg: 'bg-gray-100',
    },
  }

  const config = errorConfig[kind]

  return (
    <div
      className={`${config.bgColor} ${config.borderColor} border-2 rounded-lg p-6 max-w-2xl mx-auto`}
    >
      {/* Header with icon and title */}
      <div className="flex items-start gap-4 mb-4">
        <div className={`${config.iconBg} rounded-full p-3 text-2xl`}>
          {config.icon}
        </div>
        <div className="flex-1">
          <h3 className={`text-lg font-semibold ${config.textColor} mb-1`}>
            {config.title}
          </h3>
          <p className={`${config.textColor} font-medium`}>
            {error.message}
          </p>
        </div>
      </div>

      {/* Suggestion */}
      {appError?.suggestion && (
        <div className={`${config.textColor} mb-4 ml-16`}>
          <p className="text-sm">
            <span className="font-semibold">Suggestion:</span> {appError.suggestion}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 ml-16">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-background border border-border rounded-md hover:bg-muted font-medium text-sm"
          >
            Try Again
          </button>
        )}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="px-4 py-2 bg-background border border-border rounded-md hover:bg-muted font-medium text-sm"
        >
          {showDetails ? 'Hide' : 'Show'} Technical Details
        </button>
      </div>

      {/* Technical details (collapsible) */}
      {showDetails && (
        <div className="mt-4 ml-16 bg-background rounded border border-border p-4">
          <p className="text-xs font-mono text-foreground mb-2">
            <span className="font-semibold">Error Type:</span> {error.name}
          </p>
          {appError && 'kind' in appError && (
            <p className="text-xs font-mono text-foreground mb-2">
              <span className="font-semibold">Kind:</span> {appError.kind}
            </p>
          )}
          {'errors' in error && Array.isArray((error as any).errors) && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-foreground mb-1">GraphQL Errors:</p>
              <ul className="text-xs font-mono text-muted-foreground list-disc ml-4 space-y-1">
                {(error as any).errors.map((e: { message: string }, i: number) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
          {error.stack && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-foreground mb-1">Stack Trace:</p>
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                {error.stack}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
