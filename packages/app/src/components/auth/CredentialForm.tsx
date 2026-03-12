import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { useAuthStore } from '../../store/authStore'
import { AuthType } from '../../types/auth'
import type { Credential } from '../../types/auth'

interface CredentialFormProps {
  type: AuthType | 'none'
  url: string
  detectedMetadata?: {
    headerName?: string
    paramName?: string
  }
}

/**
 * Dynamic credential form that renders different fields based on auth type.
 * Auto-saves credentials to authStore on input change.
 */
export function CredentialForm({ type, url, detectedMetadata }: CredentialFormProps) {
  const getCredentials = useAuthStore((state) => state.getCredentials)
  const setCredential = useAuthStore((state) => state.setCredential)

  // Load initial values from store
  const apiCreds = getCredentials(url)

  // Local state for form fields
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [headerName, setHeaderName] = useState('X-API-Key')
  const [headerValue, setHeaderValue] = useState('')
  const [paramName, setParamName] = useState('api_key')
  const [paramValue, setParamValue] = useState('')
  const [cookieName, setCookieName] = useState('')
  const [cookieValue, setCookieValue] = useState('')

  // Visibility toggles for password fields
  const [showToken, setShowToken] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showHeaderValue, setShowHeaderValue] = useState(false)
  const [showParamValue, setShowParamValue] = useState(false)
  const [showCookieValue, setShowCookieValue] = useState(false)

  // Load existing credentials into local state on mount or type change
  useEffect(() => {
    if (type === 'none') return

    const cred = apiCreds?.credentials[type as AuthType]
    if (cred) {
      switch (cred.type) {
        case AuthType.Bearer:
          setToken(cred.token)
          break
        case AuthType.Basic:
          setUsername(cred.username)
          setPassword(cred.password)
          break
        case AuthType.ApiKey:
          setHeaderName(cred.headerName)
          setHeaderValue(cred.value)
          break
        case AuthType.QueryParam:
          setParamName(cred.paramName)
          setParamValue(cred.value)
          break
        case AuthType.Cookie:
          setCookieName(cred.cookieName)
          setCookieValue(cred.value)
          break
      }
    } else {
      // Reset to defaults if no existing credential
      // Use detected metadata if available
      setToken('')
      setUsername('')
      setPassword('')
      setHeaderName(detectedMetadata?.headerName ?? 'X-API-Key')
      setHeaderValue('')
      setParamName(detectedMetadata?.paramName ?? 'api_key')
      setParamValue('')
      setCookieName('')
      setCookieValue('')
    }
  }, [type, url, detectedMetadata]) // Re-run when type, url, or detectedMetadata changes

  // Auto-save helper
  const saveCredential = (credential: Credential) => {
    setCredential(url, credential)
  }

  // Render nothing for 'none' type
  if (type === 'none') return null

  // Bearer Token
  if (type === AuthType.Bearer) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="token" className="block text-sm font-medium text-gray-700">
            Token
          </label>
          <div className="relative">
            <Input
              id="token"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                saveCredential({
                  type: AuthType.Bearer,
                  label: '',
                  token: e.target.value,
                })
              }}
              onPaste={(e) => {
                e.preventDefault()
                const pasted = e.clipboardData.getData('text')
                const cleaned = pasted.replace(/[\n\r]/g, '').trim()
                setToken(cleaned)
                saveCredential({
                  type: AuthType.Bearer,
                  label: '',
                  token: cleaned,
                })
              }}
              placeholder="Enter bearer token"
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              {showToken ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Basic Auth
  if (type === AuthType.Basic) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="username" className="block text-sm font-medium text-gray-700">
            Username
          </label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              saveCredential({
                type: AuthType.Basic,
                label: '',
                username: e.target.value,
                password,
              })
            }}
            placeholder="Enter username"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                saveCredential({
                  type: AuthType.Basic,
                  label: '',
                  username,
                  password: e.target.value,
                })
              }}
              placeholder="Enter password"
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // API Key (custom header)
  if (type === AuthType.ApiKey) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="header-name" className="block text-sm font-medium text-gray-700">
            Header Name
          </label>
          <Input
            id="header-name"
            type="text"
            value={headerName}
            onChange={(e) => {
              setHeaderName(e.target.value)
              saveCredential({
                type: AuthType.ApiKey,
                label: '',
                headerName: e.target.value,
                value: headerValue,
              })
            }}
            placeholder={detectedMetadata?.headerName ?? "X-API-Key"}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="header-value" className="block text-sm font-medium text-gray-700">
            Value
          </label>
          <div className="relative">
            <Input
              id="header-value"
              type={showHeaderValue ? 'text' : 'password'}
              value={headerValue}
              onChange={(e) => {
                setHeaderValue(e.target.value)
                saveCredential({
                  type: AuthType.ApiKey,
                  label: '',
                  headerName,
                  value: e.target.value,
                })
              }}
              placeholder="Enter API key value"
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowHeaderValue(!showHeaderValue)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              {showHeaderValue ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Cookie
  if (type === AuthType.Cookie) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="cookie-name" className="block text-sm font-medium text-gray-700">
            Cookie Name
          </label>
          <Input
            id="cookie-name"
            type="text"
            value={cookieName}
            onChange={(e) => {
              setCookieName(e.target.value)
              saveCredential({
                type: AuthType.Cookie,
                label: '',
                cookieName: e.target.value,
                value: cookieValue,
              })
            }}
            placeholder="session_id"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cookie-value" className="block text-sm font-medium text-gray-700">
            Value
          </label>
          <div className="relative">
            <Input
              id="cookie-value"
              type={showCookieValue ? 'text' : 'password'}
              value={cookieValue}
              onChange={(e) => {
                setCookieValue(e.target.value)
                saveCredential({
                  type: AuthType.Cookie,
                  label: '',
                  cookieName,
                  value: e.target.value,
                })
              }}
              placeholder="Enter cookie value"
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowCookieValue(!showCookieValue)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              {showCookieValue ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Query Parameter
  if (type === AuthType.QueryParam) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="param-name" className="block text-sm font-medium text-gray-700">
            Parameter Name
          </label>
          <Input
            id="param-name"
            type="text"
            value={paramName}
            onChange={(e) => {
              setParamName(e.target.value)
              saveCredential({
                type: AuthType.QueryParam,
                label: '',
                paramName: e.target.value,
                value: paramValue,
              })
            }}
            placeholder={detectedMetadata?.paramName ?? "api_key"}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="param-value" className="block text-sm font-medium text-gray-700">
            Value
          </label>
          <div className="relative">
            <Input
              id="param-value"
              type={showParamValue ? 'text' : 'password'}
              value={paramValue}
              onChange={(e) => {
                setParamValue(e.target.value)
                saveCredential({
                  type: AuthType.QueryParam,
                  label: '',
                  paramName,
                  value: e.target.value,
                })
              }}
              placeholder="Enter parameter value"
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowParamValue(!showParamValue)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              {showParamValue ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
