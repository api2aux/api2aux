import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuthStore } from '../../store/authStore'
import { AuthTypeSelector } from './AuthTypeSelector'
import { CredentialForm } from './CredentialForm'
import { AuthErrorDisplay } from './AuthErrorDisplay'
import { AuthType } from '../../types/auth'
import type { AuthScheme } from '@api2aux/semantic-analysis'
import { AlertTriangle } from 'lucide-react'

const APP_AUTH_TYPES = new Set<string>([
  AuthType.Bearer,
  AuthType.Basic,
  AuthType.ApiKey,
  AuthType.QueryParam,
  AuthType.Cookie,
])

interface AuthPanelProps {
  url: string
  isOpen: boolean
  onToggle: () => void
  authError?: { status: 401 | 403; message: string } | null
  detectedAuth?: AuthScheme[]
  onConfigureClick?: () => void
}

/**
 * Collapsible auth configuration panel.
 * Composes AuthTypeSelector, CredentialForm, and AuthErrorDisplay.
 */
export function AuthPanel({ url, isOpen, authError, detectedAuth, onConfigureClick }: AuthPanelProps) {
  const getCredentials = useAuthStore((state) => state.getCredentials)
  const clearForApi = useAuthStore((state) => state.clearForApi)

  // Get current auth type from store
  const apiCreds = getCredentials(url)
  const storeType: AuthType | 'none' = apiCreds?.activeType ?? 'none'

  // Local state for selected type — allows selecting a type before entering credentials
  const [selectedType, setSelectedType] = useState<AuthType | 'none'>(storeType)

  // Sync local state when store type changes (e.g., after credential save)
  useEffect(() => {
    setSelectedType(storeType)
  }, [storeType])

  // Separate supported and unsupported schemes
  const supportedSchemes = useMemo(
    () => detectedAuth?.filter(s => s.authType !== null && APP_AUTH_TYPES.has(s.authType)) ?? [],
    [detectedAuth]
  )
  const unsupportedSchemes = useMemo(
    () => detectedAuth?.filter(s => s.authType === null || !APP_AUTH_TYPES.has(s.authType)) ?? [],
    [detectedAuth]
  )

  const handleTypeChange = useCallback((type: AuthType | 'none') => {
    setSelectedType(type)
    if (type === 'none') {
      clearForApi(url)
    }
    // For other types, CredentialForm will handle credential creation on input
  }, [clearForApi, url])

  // Auto-select first supported scheme when detectedAuth changes
  useEffect(() => {
    if (!detectedAuth || detectedAuth.length === 0) return

    // Only auto-select if user has NOT already configured credentials
    if (apiCreds === null || storeType === 'none') {
      const firstSupported = supportedSchemes[0]
      if (firstSupported?.authType) {
        handleTypeChange(firstSupported.authType as AuthType)
      }
    }
  }, [detectedAuth, apiCreds, storeType, supportedSchemes, handleTypeChange])

  // Find matching detected scheme for current selected type
  const matchedScheme = detectedAuth?.find(s => s.authType === selectedType)

  return (
    <div className="transition-all duration-200 ease-in-out">
      {isOpen && (
        <div className="space-y-4 pt-4 pb-2">
          {/* Show auth error if present */}
          {authError && <AuthErrorDisplay error={authError} onConfigureClick={onConfigureClick} />}

          {/* Unsupported schemes warning */}
          {unsupportedSchemes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900 mb-1">
                  This API requires authentication methods not yet supported:
                </p>
                <ul className="text-xs text-amber-800 space-y-1">
                  {unsupportedSchemes.map((scheme, idx) => (
                    <li key={idx}>
                      <strong>{scheme.name}:</strong> {scheme.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Auth type selector */}
          <AuthTypeSelector
            value={selectedType}
            onChange={handleTypeChange}
            detectedType={matchedScheme?.authType as AuthType | undefined}
          />

          {/* Dynamic credential form */}
          <CredentialForm
            type={selectedType}
            url={url}
            detectedMetadata={matchedScheme?.metadata}
          />
        </div>
      )}
    </div>
  )
}
