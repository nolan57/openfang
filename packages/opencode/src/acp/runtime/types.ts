/**
 * ACP Runtime types and interfaces.
 *
 * Defines the contract for ACP runtime backends that can be
 * registered and selected dynamically.
 */

/**
 * Unique identifier for an ACP runtime.
 */
export type AcpRuntimeId = string

/**
 * ACP Runtime session representation.
 */
export type AcpRuntimeSession = {
  /**
   * Unique session identifier.
   */
  id: string

  /**
   * Original session ID from request.
   */
  sessionId: string

  /**
   * Session creation timestamp.
   */
  createdAt: Date

  /**
   * Session identity information.
   */
  identity: AcpSessionIdentity

  /**
   * Runtime-specific metadata.
   */
  metadata?: Record<string, unknown>
}

/**
 * ACP Session identity information.
 */
export type AcpSessionIdentity = {
  /**
   * User identifier if available.
   */
  userId?: string

  /**
   * Target runtime identifier.
   */
  runtimeId?: AcpRuntimeId

  /**
   * Additional identity metadata.
   */
  metadata?: Record<string, unknown>
}

/**
 * ACP Runtime interface.
 *
 * Implementations provide the actual session management
 * for a specific runtime backend.
 */
export type AcpRuntime = {
  /**
   * Unique runtime identifier.
   */
  id: AcpRuntimeId

  /**
   * Check if the runtime is healthy and available.
   */
  healthy: () => boolean

  /**
   * Create a new session.
   */
  createSession: (input: {
    sessionId: string
    identity: AcpSessionIdentity
  }) => Promise<AcpRuntimeSession>

  /**
   * Get an existing session.
   */
  getSession: (sessionId: string) => Promise<AcpRuntimeSession | null>

  /**
   * Close/terminate a session.
   */
  closeSession: (sessionId: string) => Promise<void>

  /**
   * List all active sessions.
   */
  listSessions?: () => Promise<AcpRuntimeSession[]>
}

/**
 * ACP Runtime backend registration.
 */
export type AcpRuntimeBackend = {
  /**
   * Unique backend identifier.
   */
  id: AcpRuntimeId

  /**
   * Runtime implementation.
   */
  runtime: AcpRuntime

  /**
   * Optional health check override.
   */
  healthy?: () => boolean

  /**
   * Optional description for debugging.
   */
  description?: string
}

/**
 * ACP Runtime selection result.
 */
export type AcpRuntimeSelection = {
  /**
   * Selected runtime.
   */
  runtime: AcpRuntime

  /**
   * Backend information.
   */
  backend: AcpRuntimeBackend

  /**
   * Selection reason.
   */
  reason: "explicit" | "default" | "fallback"
}
