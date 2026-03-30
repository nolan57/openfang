export class OpenFangErrorHandler {
  private static readonly MAX_RETRIES = 3
  private static readonly BASE_DELAY = 1000 // 1 second

  async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= OpenFangErrorHandler.MAX_RETRIES; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error

        // Non-retryable errors
        if (this.isNonRetryableError(error)) {
          throw error
        }

        // Exponential backoff
        const delay = OpenFangErrorHandler.BASE_DELAY * Math.pow(2, attempt - 1)
        console.warn(
          `${context} failed (attempt ${attempt}/${OpenFangErrorHandler.MAX_RETRIES}): ${error}. Retrying in ${delay}ms...`,
        )
        await this.sleep(delay)
      }
    }

    throw new Error(`${context} failed after ${OpenFangErrorHandler.MAX_RETRIES} retries: ${lastError}`)
  }

  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // 4xx errors (except 429)
      if (/4\d{2}/.test(error.message) && !error.message.includes("429")) {
        return true
      }
      // Auth errors
      if (error.message.includes("401") || error.message.includes("403")) {
        return true
      }
    }
    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const OpenFangErrors = {
  NotFound: class extends Error {
    constructor(resource: string) {
      super(`${resource} not found`)
      this.name = "OpenFangNotFound"
    }
  },

  AlreadyExists: class extends Error {
    constructor(resource: string) {
      super(`${resource} already exists`)
      this.name = "OpenFangAlreadyExists"
    }
  },

  ConnectionFailed: class extends Error {
    constructor(url: string) {
      super(`Failed to connect to OpenFang at ${url}`)
      this.name = "OpenFangConnectionFailed"
    }
  },

  HandNotActive: class extends Error {
    constructor(handName: string) {
      super(`Hand '${handName}' is not active`)
      this.name = "OpenFangHandNotActive"
    }
  },

  WorkflowFailed: class extends Error {
    constructor(workflowId: string, reason: string) {
      super(`Workflow '${workflowId}' failed: ${reason}`)
      this.name = "OpenFangWorkflowFailed"
    }
  },
}
