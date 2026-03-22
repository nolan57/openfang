# Session Prompt Files Analysis

This document provides a detailed analysis of the prompt files located in `packages/opencode/src/session/prompt/` and their usage throughout the OpenCode project.

## Overview

The `packages/opencode/src/session/prompt/` directory contains 12 prompt template files that are used to configure system prompts for different AI models and execution contexts.

## File Inventory

| File | Status | Purpose |
|------|--------|---------|
| `anthropic.txt` | ✅ Active | Claude model system prompt |
| `anthropic-20250930.txt` | ⚠️ Unused | Possibly deprecated or backup version |
| `beast.txt` | ✅ Active | GPT/o1/o3 model system prompt |
| `build-switch.txt` | ✅ Active | Transition message for plan-to-build mode |
| `codex_header.txt` | ✅ Active | GPT-5 and general instructions header |
| `copilot-gpt-5.txt` | ⚠️ Unused | Reserved for future Copilot/GPT-5 integration |
| `gemini.txt` | ✅ Active | Gemini model system prompt |
| `max-steps.txt` | ✅ Active | Maximum steps limit reminder |
| `plan-reminder-anthropic.txt` | ⚠️ Unused | Possibly deprecated plan reminder |
| `plan.txt` | ✅ Active | Plan mode activation instructions |
| `qwen.txt` | ✅ Active | Default fallback system prompt |
| `trinity.txt` | ✅ Active | Trinity model system prompt |

## Usage Details

### Model-Specific System Prompts

The primary logic for selecting model-specific prompts is in `packages/opencode/src/session/system.ts`:

```typescript
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }
}
```

#### Model Selection Logic

| Model ID Pattern | Prompt File | Notes |
|------------------|-------------|-------|
| `gpt-5` | `codex_header.txt` | Specific to GPT-5 models |
| `gpt-*`, `o1*`, `o3*` | `beast.txt` | OpenAI GPT series and reasoning models |
| `gemini-*` | `gemini.txt` | Google Gemini models |
| `claude` | `anthropic.txt` | Anthropic Claude models |
| `trinity` (case-insensitive) | `trinity.txt` | Trinity models |
| *(fallback)* | `qwen.txt` | Default for all other models |

### Context-Specific Prompts

The following prompts are injected based on execution context rather than model type. They are imported and used in `packages/opencode/src/session/prompt.ts`:

```typescript
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
```

#### Plan Mode (`plan.txt`)

- **Location**: Line 1426 in `session/prompt.ts`
- **Trigger**: When entering plan mode (`agent.name === "plan"`)
- **Purpose**: Provides instructions for the planning workflow, including:
  - Phase 1: Initial understanding with explore agents
  - Phase 2: Design with plan agents
  - Restrictions on making actual changes during planning

#### Build Switch (`build-switch.txt`)

- **Location**: Lines 1437 and 1458 in `session/prompt.ts`
- **Trigger**: When transitioning from plan mode to build mode
- **Purpose**: Informs the agent that a plan exists and execution should begin
- **Injection points**:
  1. When previous agent was "plan" and current agent is "build"
  2. When any agent continues after a plan agent session

#### Maximum Steps (`max-steps.txt`)

- **Location**: Line 750 in `session/prompt.ts`
- **Trigger**: When `step >= agent.steps` (maximum steps reached)
- **Purpose**: Injected as the final assistant message to indicate step limit reached

```typescript
messages: [
  ...MessageV2.toModelMessages(msgs, model),
  ...(isLastStep
    ? [
        {
          role: "assistant" as const,
          content: MAX_STEPS,
        },
      ]
    : []),
],
```

## Integration Points

### Session Processing Flow

1. **Model Selection**: `SystemPrompt.provider()` selects the appropriate prompt based on model ID
2. **Environment Context**: `SystemPrompt.environment()` adds runtime information (working directory, platform, date)
3. **Instruction Prompts**: Additional instructions from `InstructionPrompt.system()` are appended
4. **Context Injection**: Plan/build/max-steps prompts are injected based on session state

### Key Files

| File | Role |
|------|------|
| `session/system.ts` | Model-specific prompt selection |
| `session/prompt.ts` | Context-aware prompt injection and session loop |
| `session/llm.ts` | Calls `SystemPrompt.provider()` and `SystemPrompt.instructions()` |
| `agent/agent.ts` | Uses `SystemPrompt.instructions()` for agent configuration |

## Unused Files Analysis

### `anthropic-20250930.txt`

- **Status**: Not imported anywhere in the codebase
- **Possible purpose**: May be an updated version of `anthropic.txt` dated September 30, 2025
- **Recommendation**: Consider merging into `anthropic.txt` or documenting why it's kept separate

### `copilot-gpt-5.txt`

- **Status**: Not imported anywhere in the codebase
- **Possible purpose**: Reserved for GitHub Copilot or GPT-5 specific integrations
- **Recommendation**: Document intended use case or remove if no longer planned

### `plan-reminder-anthropic.txt`

- **Status**: Not imported anywhere in the codebase
- **Possible purpose**: May have been a Claude-specific plan reminder
- **Recommendation**: Likely safe to remove as plan reminders are handled differently now

## Summary

The prompt system uses a two-tier approach:

1. **Model Tier**: Selects the base system prompt based on the AI model being used
2. **Context Tier**: Injects additional prompts based on execution state (plan mode, step limits, mode transitions)

This architecture allows for flexible prompt management while keeping model-specific optimizations separate from workflow-specific instructions.
