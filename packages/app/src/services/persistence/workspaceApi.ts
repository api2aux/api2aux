/**
 * Workspace persistence API client.
 * Communicates with the backend /api/workspaces endpoints.
 * Falls back gracefully if the API is unavailable (localStorage still works).
 */

const API_BASE = '/api/workspaces'

export interface WorkspaceData {
  id: string
  name: string
  appState: Record<string, unknown>
  authCredentials: Record<string, unknown>
  authChains: Record<string, unknown>
  configState: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/** Check if the persistence API is available */
export async function isApiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(API_BASE, { method: 'GET', signal: AbortSignal.timeout(2000) })
    return res.ok || res.status === 503 // 503 = DB not configured, but API is running
  } catch {
    return false
  }
}

/** List all workspaces */
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await fetch(API_BASE)
  if (!res.ok) throw new Error(`Failed to list workspaces: ${res.status}`)
  return res.json()
}

/** Get a workspace by ID */
export async function getWorkspace(id: string): Promise<WorkspaceData | null> {
  const res = await fetch(`${API_BASE}/${id}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to get workspace: ${res.status}`)
  return res.json()
}

/** Create a new workspace */
export async function createWorkspace(data: WorkspaceData): Promise<WorkspaceData> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to create workspace: ${res.status}`)
  return res.json()
}

/** Update a workspace (partial update) */
export async function updateWorkspace(id: string, data: Partial<WorkspaceData>): Promise<WorkspaceData> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to update workspace: ${res.status}`)
  return res.json()
}

/** Delete a workspace */
export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete workspace: ${res.status}`)
}
