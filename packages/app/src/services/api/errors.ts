import { ErrorKind } from '../../types/errors'
import type { AppError } from '../../types/errors'

export class CORSError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Cors
  readonly suggestion: string

  constructor(url: string) {
    super(`Cannot access ${url} — blocked by CORS policy.`)
    this.name = 'CORSError'
    this.suggestion = 'This API does not allow browser requests. Try a CORS-enabled API like JSONPlaceholder (jsonplaceholder.typicode.com).'
  }
}

export class NetworkError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Network
  readonly suggestion: string

  constructor(url: string) {
    super(`Network error while fetching ${url}.`)
    this.name = 'NetworkError'
    this.suggestion = 'Check your internet connection and verify the URL is correct.'
  }
}

export class APIError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Api
  readonly suggestion: string
  readonly status: number

  constructor(url: string, status: number, statusText: string) {
    super(`API returned ${status} ${statusText} for ${url}.`)
    this.name = 'APIError'
    this.status = status
    this.suggestion = status === 404
      ? 'The endpoint was not found. Check the URL path.'
      : status >= 500
      ? 'The API server is having issues. Try again later.'
      : `The API returned an error (${status}). Verify the URL.`
  }
}

export class ParseError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Parse
  readonly suggestion: string

  constructor(url: string) {
    super(`Failed to parse response from ${url} as JSON.`)
    this.name = 'ParseError'
    this.suggestion = 'The API did not return valid JSON. Ensure the URL points to a JSON API endpoint.'
  }
}

export class GraphQLError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Graphql
  readonly suggestion: string
  readonly errors: Array<{ message: string }>

  constructor(url: string, errors: Array<{ message: string }>) {
    const messages = errors.map(e => e.message).join('; ')
    super(`GraphQL error from ${url}: ${messages}`)
    this.name = 'GraphQLError'
    this.errors = errors
    this.suggestion = 'Check the GraphQL query and variables.'
  }
}

export class AuthError extends Error implements AppError {
  readonly kind: ErrorKind = ErrorKind.Auth
  readonly suggestion: string
  readonly status: 401 | 403
  readonly authContext: string
  readonly responseBody: string

  constructor(url: string, status: 401 | 403, authContext: string, responseBody: string = '') {
    const message = status === 401
      ? `Authentication failed for ${url} (${status})`
      : `Authorization denied for ${url} (${status})`
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.authContext = authContext
    this.responseBody = responseBody
    this.suggestion = status === 401
      ? 'Check your credentials. The server rejected your authentication.'
      : 'Your credentials are valid but you lack permission for this resource.'
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}
