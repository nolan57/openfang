/**
 * System Prompt Module
 * 
 * Provides system prompts for AI models using the new PromptBuilder system.
 * This module maintains backward compatibility while transitioning to the
 * configuration-driven prompt management system.
 */

import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { PromptBuilder, PromptRouter } from "./prompts"
import type { Provider } from "@/provider/provider"

// Legacy imports for backward compatibility
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"

export namespace SystemPrompt {
  /**
   * Get the instructions header (used for Codex sessions)
   */
  export function instructions(): string {
    return PromptBuilder.getInstructions()
  }

  /**
   * Get the provider-specific system prompt
   * 
   * This uses the new PromptRouter for configuration-driven routing,
   * while maintaining backward compatibility with existing code.
   */
  export function provider(model: Provider.Model): string[] {
    // Use the new routing system
    const templateId = PromptRouter.getTemplateId(model.api.id)
    
    // Legacy direct template returns for backward compatibility
    // TODO: After full migration, replace with PromptBuilder.build()
    switch (templateId) {
      case "codex":
        return [PROMPT_CODEX]
      case "beast":
        return [PROMPT_BEAST]
      case "gemini":
        return [PROMPT_GEMINI]
      case "anthropic":
        return [PROMPT_ANTHROPIC]
      case "trinity":
        return [PROMPT_TRINITY]
      case "universal":
      default:
        return [PROMPT_ANTHROPIC_WITHOUT_TODO]
    }
  }

  /**
   * Build the environment context section
   * 
   * Provides runtime context about the current environment including:
   * - Working directory
   * - Git repository status
   * - Platform information
   * - Current date
   */
  export async function environment(model: Provider.Model): Promise<string[]> {
    const project = Instance.project
    const lines = [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
    return lines
  }

  /**
   * Build a complete prompt using the new PromptBuilder
   * 
   * This is the recommended way to get prompts for new code.
   * It uses the layered assembly pipeline with full context injection.
   */
  export async function build(model: Provider.Model): Promise<string[]> {
    const result = await PromptBuilder.build({
      id: model.api.id,
      providerID: model.providerID,
    })
    return result.system
  }
}