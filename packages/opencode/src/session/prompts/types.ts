/**
 * Prompt Template Type Definitions
 * 
 * Defines the structured prompt template format following the XML-based specification.
 * This replaces the legacy plain-text prompt files with a modular, configuration-driven approach.
 */

import { z } from "zod"

/**
 * Role definition for the AI agent
 */
export const RoleSchema = z.object({
  identity: z.string().describe("Agent identity and specialization"),
  objective: z.string().describe("Primary goal of the agent"),
  environment: z.string().optional().describe("Operating environment context"),
})

export type Role = z.infer<typeof RoleSchema>

/**
 * Dynamic context variables that can be injected at runtime
 */
export const ContextSchema = z.object({
  cwd: z.string().optional(),
  platform: z.string().optional(),
  tech_stack: z.array(z.string()).optional(),
  mode: z.enum(["plan", "build", "debug", "refactor"]).optional(),
  git_repo: z.boolean().optional(),
  date: z.string().optional(),
})

export type Context = z.infer<typeof ContextSchema>

/**
 * Constraint rules with unique IDs for traceability
 */
export const ConstraintRuleSchema = z.object({
  id: z.string().describe("Unique identifier for the rule"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  content: z.string().describe("The constraint rule content"),
})

export type ConstraintRule = z.infer<typeof ConstraintRuleSchema>

/**
 * Workflow step definition
 */
export const WorkflowStepSchema = z.object({
  name: z.string().describe("Step name/identifier"),
  description: z.string().describe("What this step accomplishes"),
  required: z.boolean().default(true),
})

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

/**
 * Few-shot example for behavior normalization
 */
export const ExampleSchema = z.object({
  id: z.string().describe("Example identifier"),
  user_input: z.string(),
  assistant_response: z.string(),
  context: z.string().optional(),
})

export type Example = z.infer<typeof ExampleSchema>

/**
 * Output format specification
 */
export const OutputFormatSchema = z.object({
  instruction: z.string().describe("Format requirements"),
  schema: z.record(z.string(), z.unknown()).optional().describe("JSON schema if applicable"),
  examples: z.array(z.string()).optional(),
})

export type OutputFormat = z.infer<typeof OutputFormatSchema>

/**
 * Complete structured prompt template
 */
export const PromptTemplateSchema = z.object({
  // Metadata
  id: z.string().describe("Unique template identifier"),
  version: z.string().default("2.0"),
  model_family: z.enum(["anthropic", "openai", "gemini", "trinity", "universal"]).default("universal"),
  language: z.string().default("en"),
  description: z.string().optional(),
  
  // Core sections
  role: RoleSchema,
  context: ContextSchema.optional(),
  constraints: z.array(ConstraintRuleSchema).default([]),
  workflow: z.array(WorkflowStepSchema).default([]),
  examples: z.array(ExampleSchema).default([]),
  output_format: OutputFormatSchema.optional(),
  
  // Extensions
  extensions: z.record(z.string(), z.unknown()).optional().describe("Model-specific extensions"),
})

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>

/**
 * Model routing configuration
 */
export const ModelRouteSchema = z.object({
  pattern: z.string().describe("Regex pattern to match model ID"),
  template_id: z.string().describe("Template ID to use"),
  priority: z.number().default(0).describe("Higher priority routes are checked first"),
  model_family: z.string().optional(),
})

export type ModelRoute = z.infer<typeof ModelRouteSchema>

/**
 * Prompt assembly layers
 */
export type PromptLayer = "base" | "context" | "strategy" | "safety" | "custom"

/**
 * Assembled prompt result
 */
export const AssembledPromptSchema = z.object({
  system: z.array(z.string()).describe("System prompt sections"),
  instructions: z.string().optional().describe("Instructions header"),
  metadata: z.object({
    template_id: z.string(),
    model_id: z.string(),
    provider_id: z.string(),
    layers_applied: z.array(z.string()),
    assembled_at: z.number(),
  }),
})

export type AssembledPrompt = z.infer<typeof AssembledPromptSchema>

/**
 * Prompt builder options
 */
export const PromptBuilderOptionsSchema = z.object({
  include_safety_layer: z.boolean().default(true),
  include_context_layer: z.boolean().default(true),
  debug_mode: z.boolean().default(false),
  custom_layers: z.array(z.string()).optional(),
})

export type PromptBuilderOptions = z.infer<typeof PromptBuilderOptionsSchema>
