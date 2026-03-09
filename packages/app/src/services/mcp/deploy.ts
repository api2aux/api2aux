/**
 * Deploy an API as a hosted MCP server.
 * Sends pre-parsed operations to the MCP Worker registration endpoint.
 */

import type { Operation, ParsedAPI, AuthConfigType } from '@api2aux/semantic-analysis'

const MCP_WORKER_URL = import.meta.env.VITE_MCP_WORKER_URL || ''

export interface DeployConfig {
  apiUrl: string
  baseUrl: string
  name: string
  authType: AuthConfigType
  authParamName?: string
  operations: Operation[]
}

export interface DeployResult {
  tenantId: string
  mcpUrl: string
  expiresAt: string
}

/**
 * Deploy an API as a hosted MCP server by registering it with the Worker.
 */
export function isMcpWorkerConfigured(): boolean {
  return MCP_WORKER_URL !== ''
}

export async function deployAsMcpServer(config: DeployConfig): Promise<DeployResult> {
  if (!MCP_WORKER_URL) {
    throw new Error('MCP Worker URL not configured. Set VITE_MCP_WORKER_URL environment variable.')
  }
  // OpenAPI specs can have circular $refs after dereferencing.
  // Use a seen-set replacer to safely serialize.
  const seen = new WeakSet()
  const body = JSON.stringify(config, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined
      seen.add(value)
    }
    return value
  })

  const response = await fetch(`${MCP_WORKER_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((error as { error: string }).error || `Registration failed: ${response.status}`)
  }

  return response.json() as Promise<DeployResult>
}

/**
 * Find an existing deployment for a given API URL.
 */
export async function findExistingDeployment(apiUrl: string): Promise<DeployResult | null> {
  if (!MCP_WORKER_URL) return null
  try {
    const response = await fetch(`${MCP_WORKER_URL}/tenants`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const data = await response.json() as {
      tenants: Array<{ tenantId: string; apiUrl: string; mcpUrl: string; expiresAt: string }>
    }

    const match = data.tenants.find(t => t.apiUrl === apiUrl)
    if (!match) return null

    return {
      tenantId: match.tenantId,
      mcpUrl: match.mcpUrl,
      expiresAt: match.expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Build a DeployConfig from a parsed OpenAPI spec.
 */
export function buildDeployConfig(spec: ParsedAPI, authType: AuthConfigType = 'none'): DeployConfig {
  // Derive a short name from the spec title
  const name = spec.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)

  return {
    apiUrl: spec.baseUrl,
    baseUrl: spec.baseUrl,
    name,
    authType,
    operations: spec.operations,
  }
}
