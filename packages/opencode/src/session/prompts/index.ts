/**
 * Prompt Management System
 * 
 * A modular, configuration-driven prompt management system that replaces
 * the legacy hardcoded prompt routing with a structured, layered approach.
 * 
 * Architecture:
 * - types.ts: TypeScript type definitions for structured prompts
 * - config.ts: Configuration for model routing and templates
 * - router.ts: Configuration-driven prompt routing
 * - builder.ts: Layered prompt assembly pipeline
 * 
 * Usage:
 * ```typescript
 * import { PromptBuilder, PromptRouter } from "./prompts"
 * 
 * // Build a complete prompt for a model
 * const prompt = await PromptBuilder.build({ id: "claude-3-opus", providerID: "anthropic" })
 * 
 * // Get just the template ID for routing
 * const templateId = PromptRouter.getTemplateId("gpt-4")
 * ```
 */

export * from "./types"
export * from "./config"
export { PromptRouter } from "./router"
export { PromptBuilder } from "./builder"
