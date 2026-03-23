/**
 * Prompt Router
 * 
 * Configuration-driven routing for selecting the appropriate prompt template
 * based on model ID. Replaces hardcoded `if (model.id.includes(...))` logic.
 */

import { MODEL_ROUTES, DEBUG_CONFIG } from "./config"
import type { ModelRoute } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "prompt.router" })

export namespace PromptRouter {
  /**
   * Find the best matching route for a given model ID
   * Routes are sorted by priority (highest first)
   */
  export function findRoute(modelId: string): ModelRoute {
    // Sort routes by priority (descending)
    const sortedRoutes = [...MODEL_ROUTES].sort((a, b) => b.priority - a.priority)

    for (const route of sortedRoutes) {
      const regex = new RegExp(route.pattern, "i")
      if (regex.test(modelId)) {
        if (DEBUG_CONFIG.enabled) {
          log.info("route matched", {
            modelId,
            templateId: route.template_id,
            pattern: route.pattern,
            priority: route.priority,
          })
        }
        return route
      }
    }

    // Fallback to the default route (pattern: ".*")
    const defaultRoute = MODEL_ROUTES.find((r) => r.pattern === ".*")
    if (!defaultRoute) {
      throw new Error("No default route configured")
    }
    return defaultRoute
  }

  /**
   * Get the template ID for a model
   */
  export function getTemplateId(modelId: string): string {
    return findRoute(modelId).template_id
  }

  /**
   * Get the model family for a model
   */
  export function getModelFamily(modelId: string): string {
    return findRoute(modelId).model_family ?? "universal"
  }

  /**
   * Check if a model matches a specific pattern
   */
  export function matchesPattern(modelId: string, pattern: string): boolean {
    const regex = new RegExp(pattern, "i")
    return regex.test(modelId)
  }

  /**
   * Get all routes that would match a model (for debugging)
   */
  export function getAllMatchingRoutes(modelId: string): ModelRoute[] {
    const sortedRoutes = [...MODEL_ROUTES].sort((a, b) => b.priority - a.priority)
    return sortedRoutes.filter((route) => {
      const regex = new RegExp(route.pattern, "i")
      return regex.test(modelId)
    })
  }

  /**
   * Validate all route patterns are valid regex
   */
  export function validateRoutes(): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    for (const route of MODEL_ROUTES) {
      try {
        new RegExp(route.pattern)
      } catch (e) {
        errors.push(`Invalid regex pattern '${route.pattern}' for route ${route.template_id}: ${e}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}
