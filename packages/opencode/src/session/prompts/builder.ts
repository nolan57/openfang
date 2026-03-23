/**
 * Prompt Builder
 * 
 * Implements a layered pipeline for assembling prompts:
 * 1. Base Layer: Core role definition
 * 2. Context Layer: Dynamic runtime context
 * 3. Strategy Layer: Mode-specific instructions
 * 4. Safety Layer: Mandatory security constraints
 */

import { PromptRouter } from "./router"
import { SAFETY_CONSTRAINTS, DEBUG_CONFIG } from "./config"
import type { PromptBuilderOptions, AssembledPrompt, PromptLayer } from "./types"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "prompt.builder" })

// Import template files
import TEMPLATE_ANTHROPIC from "../prompt/anthropic.txt"
import TEMPLATE_BEAST from "../prompt/beast.txt"
import TEMPLATE_CODEX from "../prompt/codex_header.txt"
import TEMPLATE_GEMINI from "../prompt/gemini.txt"
import TEMPLATE_TRINITY from "../prompt/trinity.txt"
import TEMPLATE_UNIVERSAL from "../prompt/qwen.txt"
import TEMPLATE_PLAN from "../prompt/plan.txt"
import TEMPLATE_BUILD_SWITCH from "../prompt/build-switch.txt"
import TEMPLATE_MAX_STEPS from "../prompt/max-steps.txt"

/**
 * Template content map
 */
const TEMPLATE_CONTENT: Record<string, string> = {
  anthropic: TEMPLATE_ANTHROPIC,
  beast: TEMPLATE_BEAST,
  codex: TEMPLATE_CODEX,
  gemini: TEMPLATE_GEMINI,
  trinity: TEMPLATE_TRINITY,
  universal: TEMPLATE_UNIVERSAL,
  plan: TEMPLATE_PLAN,
  "build-switch": TEMPLATE_BUILD_SWITCH,
  "max-steps": TEMPLATE_MAX_STEPS,
}

export namespace PromptBuilder {
  /**
   * Build the complete system prompt for a model
   */
  export async function build(
    model: { id: string; providerID: string },
    options: Partial<PromptBuilderOptions> = {},
  ): Promise<AssembledPrompt> {
    const opts: PromptBuilderOptions = {
      include_safety_layer: true,
      include_context_layer: true,
      debug_mode: DEBUG_CONFIG.enabled,
      custom_layers: [],
      ...options,
    }

    const layersApplied: PromptLayer[] = []
    const system: string[] = []

    // Get the base template
    const templateId = PromptRouter.getTemplateId(model.id)
    const baseTemplate = TEMPLATE_CONTENT[templateId]
    
    if (!baseTemplate) {
      throw new Error(`Template not found: ${templateId}`)
    }

    // Layer 1: Base - Core role definition
    system.push(baseTemplate)
    layersApplied.push("base")

    // Layer 2: Context - Dynamic runtime context
    if (opts.include_context_layer) {
      const contextSection = await buildContextSection()
      system.push(contextSection)
      layersApplied.push("context")
    }

    // Layer 3: Safety - Mandatory constraints
    if (opts.include_safety_layer) {
      const safetySection = buildSafetySection()
      system.push(safetySection)
      layersApplied.push("safety")
    }

    const result: AssembledPrompt = {
      system,
      instructions: templateId === "codex" ? TEMPLATE_CODEX.trim() : undefined,
      metadata: {
        template_id: templateId,
        model_id: model.id,
        provider_id: model.providerID,
        layers_applied: layersApplied,
        assembled_at: Date.now(),
      },
    }

    // Debug logging
    if (opts.debug_mode || DEBUG_CONFIG.log_assembled_prompts) {
      logPromptAssembly(result)
    }

    return result
  }

  /**
   * Build the dynamic context section
   */
  async function buildContextSection(): Promise<string> {
    const project = Instance.project
    const lines: string[] = [
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `Working directory: ${Instance.directory}`,
      `Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `Platform: ${process.platform}`,
      `Today's date: ${new Date().toDateString()}`,
      `</env>`,
    ]

    // Optionally include directory tree
    if (project.vcs === "git") {
      // Tree generation is expensive, skip for now
      // const tree = await Ripgrep.tree({ cwd: Instance.directory, limit: 50 })
      // if (tree) {
      //   lines.push(`<directories>`, tree, `</directories>`)
      // }
    }

    return lines.join("\n")
  }

  /**
   * Build the safety constraints section
   */
  function buildSafetySection(): string {
    const criticalConstraints = SAFETY_CONSTRAINTS.filter(
      (c) => c.priority === "critical"
    )

    if (criticalConstraints.length === 0) {
      return ""
    }

    const lines = criticalConstraints.map((c) => c.content)
    return lines.join("\n\n")
  }

  /**
   * Get a strategy prompt by name
   */
  export function getStrategyPrompt(name: "plan" | "build-switch" | "max-steps"): string {
    const template = TEMPLATE_CONTENT[name]
    if (!template) {
      throw new Error(`Strategy template not found: ${name}`)
    }
    return template
  }

  /**
   * Get instructions header (for Codex sessions)
   */
  export function getInstructions(): string {
    return TEMPLATE_CODEX.trim()
  }

  /**
   * Log assembled prompt for debugging
   */
  function logPromptAssembly(result: AssembledPrompt): void {
    const sanitizedSystem = result.system.map((section) => {
      if (DEBUG_CONFIG.sanitize_paths) {
        // Sanitize absolute paths for logging
        return section.replace(/\/[^\s]+/g, "[PATH]")
      }
      return section
    })

    log.info("assembled prompt", {
      template_id: result.metadata.template_id,
      model_id: result.metadata.model_id,
      layers: result.metadata.layers_applied,
      sections: result.system.length,
      total_length: sanitizedSystem.join("\n").length,
    })
  }

  /**
   * Get template content by ID
   */
  export function getTemplate(templateId: string): string {
    const template = TEMPLATE_CONTENT[templateId]
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }
    return template
  }
}
