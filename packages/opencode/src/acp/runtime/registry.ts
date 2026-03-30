/**
 * ACP Runtime Registry.
 *
 * Manages registration and selection of ACP runtime backends.
 * Supports multiple backends with automatic failover.
 */

import type { AcpRuntime, AcpRuntimeBackend, AcpRuntimeId } from "./types"

/**
 * Global state for ACP runtime registry.
 * Uses Symbol to avoid conflicts in globalThis.
 */
const ACP_RUNTIME_REGISTRY_STATE_KEY = Symbol.for("opencode.acpRuntimeRegistryState")

type AcpRuntimeRegistryGlobalState = {
  backendsById: Map<AcpRuntimeId, AcpRuntimeBackend>
}

function createAcpRuntimeRegistryGlobalState(): AcpRuntimeRegistryGlobalState {
  return {
    backendsById: new Map<AcpRuntimeId, AcpRuntimeBackend>(),
  }
}

function resolveAcpRuntimeRegistryGlobalState(): AcpRuntimeRegistryGlobalState {
  const globalThisWithRegistry = globalThis as typeof globalThis & {
    [ACP_RUNTIME_REGISTRY_STATE_KEY]?: AcpRuntimeRegistryGlobalState
  }

  if (!globalThisWithRegistry[ACP_RUNTIME_REGISTRY_STATE_KEY]) {
    globalThisWithRegistry[ACP_RUNTIME_REGISTRY_STATE_KEY] =
      createAcpRuntimeRegistryGlobalState()
  }

  return globalThisWithRegistry[ACP_RUNTIME_REGISTRY_STATE_KEY]!
}

const BACKENDS_BY_ID = resolveAcpRuntimeRegistryGlobalState().backendsById

/**
 * Normalize runtime ID for consistent lookup.
 */
function normalizeRuntimeId(id: string): string {
  return id.trim().toLowerCase()
}

/**
 * Check if a backend is healthy.
 */
function isBackendHealthy(backend: AcpRuntimeBackend): boolean {
  if (!backend.healthy) {
    return true // No health check = assume healthy
  }
  try {
    return backend.healthy()
  } catch {
    return false
  }
}

/**
 * Register an ACP runtime backend.
 *
 * @param backend - Runtime backend to register
 * @throws Error if backend or runtime implementation is missing
 *
 * @example
 * ```typescript
 * registerAcpRuntimeBackend({
 *   id: "default",
 *   runtime: myRuntimeImpl,
 *   description: "Default local runtime"
 * })
 * ```
 */
export function registerAcpRuntimeBackend(backend: AcpRuntimeBackend): void {
  const id = normalizeRuntimeId(backend.id)

  if (!id) {
    throw new Error("ACP runtime backend ID is required")
  }

  if (!backend.runtime) {
    throw new Error(`ACP runtime backend "${id}" is missing runtime implementation`)
  }

  BACKENDS_BY_ID.set(id, {
    ...backend,
    id,
  })
}

/**
 * Unregister an ACP runtime backend.
 *
 * @param id - Runtime ID to unregister
 */
export function unregisterAcpRuntimeBackend(id: string): void {
  const normalized = normalizeRuntimeId(id)
  if (!normalized) {
    return
  }
  BACKENDS_BY_ID.delete(normalized)
}

/**
 * Get a registered ACP runtime backend by ID.
 *
 * @param id - Runtime ID (optional, returns first healthy if not provided)
 * @returns Backend or null if not found
 */
export function getAcpRuntimeBackend(id?: string): AcpRuntimeBackend | null {
  const normalized = id ? normalizeRuntimeId(id) : undefined

  if (normalized) {
    return BACKENDS_BY_ID.get(normalized) ?? null
  }

  // No ID provided - return first healthy backend
  if (BACKENDS_BY_ID.size === 0) {
    return null
  }

  for (const backend of BACKENDS_BY_ID.values()) {
    if (isBackendHealthy(backend)) {
      return backend
    }
  }

  // No healthy backend found - return first one anyway
  return BACKENDS_BY_ID.values().next().value ?? null
}

/**
 * Get an ACP runtime by ID.
 *
 * @param id - Runtime ID (optional, returns first healthy if not provided)
 * @returns Runtime or null if not found
 */
export function getAcpRuntime(id?: string): AcpRuntime | null {
  const backend = getAcpRuntimeBackend(id)
  return backend?.runtime ?? null
}

/**
 * Require an ACP runtime, throwing if not available.
 *
 * @param id - Runtime ID (optional, returns first healthy if not provided)
 * @returns Runtime instance
 * @throws Error if no runtime is available
 */
export function requireAcpRuntime(id?: string): AcpRuntime {
  const normalized = id ? normalizeRuntimeId(id) : undefined
  const backend = getAcpRuntimeBackend(normalized || undefined)

  if (!backend) {
    throw new Error(
      `ACP runtime not found: ${id ?? "no runtime registered"}`,
    )
  }

  if (!isBackendHealthy(backend)) {
    throw new Error(
      `ACP runtime "${backend.id}" is currently unavailable`,
    )
  }

  return backend.runtime
}

/**
 * List all registered ACP runtime backends.
 *
 * @returns Array of backend information
 */
export function listAcpRuntimeBackends(): Array<{
  id: AcpRuntimeId
  description?: string
  healthy: boolean
}> {
  return Array.from(BACKENDS_BY_ID.values()).map((backend) => ({
    id: backend.id,
    description: backend.description,
    healthy: isBackendHealthy(backend),
  }))
}

/**
 * Get the count of registered backends.
 */
export function getAcpRuntimeBackendCount(): number {
  return BACKENDS_BY_ID.size
}

/**
 * Clear all registered backends.
 *
 * @internal - For testing only
 */
export function __testing__clearAcpRuntimeBackends(): void {
  BACKENDS_BY_ID.clear()
}
