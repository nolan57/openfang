/**
 * Prompt Configuration
 * 
 * Configuration-driven routing for model-specific prompt templates.
 * This replaces the hardcoded `if (model.id.includes(...))` logic.
 */

import type { ModelRoute, PromptTemplate } from "./types"

/**
 * Model routing configuration
 * Patterns are matched in priority order (highest first)
 */
export const MODEL_ROUTES: ModelRoute[] = [
  // GPT-5 specific routing
  {
    pattern: "^gpt-5",
    template_id: "codex",
    priority: 100,
    model_family: "openai",
  },
  // GPT series (GPT-4, GPT-3.5, etc.)
  {
    pattern: "^gpt-",
    template_id: "beast",
    priority: 80,
    model_family: "openai",
  },
  // OpenAI reasoning models (o1, o3)
  {
    pattern: "^o[13]",
    template_id: "beast",
    priority: 80,
    model_family: "openai",
  },
  // Gemini models
  {
    pattern: "^gemini-",
    template_id: "gemini",
    priority: 90,
    model_family: "gemini",
  },
  // Anthropic Claude models
  {
    pattern: "claude",
    template_id: "anthropic",
    priority: 90,
    model_family: "anthropic",
  },
  // Trinity models
  {
    pattern: "trinity",
    template_id: "trinity",
    priority: 90,
    model_family: "trinity",
  },
  // Default fallback
  {
    pattern: ".*",
    template_id: "universal",
    priority: 0,
    model_family: "universal",
  },
]

/**
 * Strategy prompts configuration
 * Used for different operational modes (plan, build, etc.)
 */
export const STRATEGY_PROMPTS = {
  plan: {
    template_id: "plan",
    trigger_when: ["plan"],
    description: "Read-only planning mode",
  },
  build_switch: {
    template_id: "build-switch",
    trigger_when: ["plan_to_build"],
    description: "Transition from plan to build mode",
  },
  max_steps: {
    template_id: "max-steps",
    trigger_when: ["max_steps_reached"],
    description: "Maximum steps limit reached",
  },
}

/**
 * Safety constraints that are always injected
 * These are critical rules that supersede all other instructions
 */
export const SAFETY_CONSTRAINTS = [
  {
    id: "security",
    priority: "critical" as const,
    content:
      "IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously. Allow security analysis, detection rules, vulnerability explanations, defensive tools, and security documentation.",
  },
  {
    id: "url_generation",
    priority: "critical" as const,
    content:
      "IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.",
  },
]

/**
 * Template registry
 * Maps template IDs to their file paths (relative to prompts/templates/)
 */
export const TEMPLATE_REGISTRY: Record<string, string> = {
  anthropic: "anthropic.xml",
  beast: "beast.xml",
  codex: "codex.xml",
  gemini: "gemini.xml",
  trinity: "trinity.xml",
  universal: "universal.xml",
  plan: "plan.xml",
  "build-switch": "build-switch.xml",
  "max-steps": "max-steps.xml",
}

/**
 * Provider-specific extensions
 * Additional configuration for specific AI providers
 */
export const PROVIDER_EXTENSIONS = {
  anthropic: {
    supports_thinking_tags: true,
    supports_streaming: true,
    max_context_tokens: 200000,
  },
  openai: {
    supports_thinking_tags: false,
    supports_streaming: true,
    max_context_tokens: 128000,
  },
  gemini: {
    supports_thinking_tags: false,
    supports_streaming: true,
    max_context_tokens: 1000000,
  },
  trinity: {
    supports_thinking_tags: false,
    supports_streaming: true,
    max_context_tokens: 128000,
  },
}

/**
 * Debug configuration
 */
export const DEBUG_CONFIG = {
  enabled: process.env.OPENCODE_DEBUG_PROMPTS === "true",
  log_assembled_prompts: process.env.OPENCODE_LOG_PROMPTS === "true",
  sanitize_paths: true,
}
