/**
 * ACP Runtime errors.
 */

/**
 * ACP Runtime error codes.
 */
export type AcpRuntimeErrorCode =
  | "ACP_BACKEND_MISSING"
  | "ACP_BACKEND_UNAVAILABLE"
  | "ACP_BACKEND_UNHEALTHY"
  | "ACP_SESSION_CREATE_FAILED"
  | "ACP_SESSION_NOT_FOUND"
  | "ACP_SESSION_CLOSE_FAILED"
  | "ACP_RUNTIME_NOT_REGISTERED"
  | "ACP_INVALID_IDENTITY"

/**
 * ACP Runtime error.
 *
 * Provides structured error information for runtime-related failures.
 */
export class AcpRuntimeError extends Error {
  /**
   * Error code for programmatic handling.
   */
  public readonly code: AcpRuntimeErrorCode

  /**
   * Additional error details.
   */
  public readonly details?: unknown

  constructor(
    code: AcpRuntimeErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(`${code}: ${message}`)
    this.name = "AcpRuntimeError"
    this.code = code
    this.details = details
  }

  /**
   * Convert error to plain object for serialization.
   */
  toJSON(): { name: string; code: string; message: string; details?: unknown } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    }
  }
}

/**
 * Create a "backend missing" error.
 */
export function createBackendMissingError(backendId?: string): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_BACKEND_MISSING",
    backendId
      ? `ACP runtime backend "${backendId}" is not registered`
      : "No ACP runtime backend is configured",
    { backendId },
  )
}

/**
 * Create a "backend unavailable" error.
 */
export function createBackendUnavailableError(backendId: string): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_BACKEND_UNAVAILABLE",
    `ACP runtime backend "${backendId}" is currently unavailable`,
    { backendId },
  )
}

/**
 * Create a "backend unhealthy" error.
 */
export function createBackendUnhealthyError(backendId: string): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_BACKEND_UNHEALTHY",
    `ACP runtime backend "${backendId}" failed health check`,
    { backendId },
  )
}

/**
 * Create a "session not found" error.
 */
export function createSessionNotFoundError(sessionId: string): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_SESSION_NOT_FOUND",
    `ACP session "${sessionId}" not found`,
    { sessionId },
  )
}

/**
 * Create a "session create failed" error.
 */
export function createSessionCreateFailedError(
  sessionId: string,
  cause?: unknown,
): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_SESSION_CREATE_FAILED",
    `Failed to create ACP session "${sessionId}"`,
    { sessionId, cause },
  )
}

/**
 * Create an "invalid identity" error.
 */
export function createInvalidIdentityError(details?: unknown): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_INVALID_IDENTITY",
    "Invalid ACP session identity",
    { details },
  )
}
