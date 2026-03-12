# Prompt Architecture

This document describes the architecture of the Prompt Management System in OpenCode.

## Overview

The Prompt Management System follows a **structured, configuration-driven, pipelined** architecture that replaces the legacy hardcoded prompt routing.

## Design Principles

1. **Structured Templates**: All prompts use XML-like structured sections for clarity and maintainability
2. **Configuration-Driven Routing**: Model-to-template mapping is defined in configuration, not code
3. **Layered Assembly**: Prompts are assembled in layers (base → context → safety)
4. **Zero Hardcoding**: Business prompt content is externalized from core code

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SystemPrompt Module                       │
│                   (session/system.ts)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PromptBuilder                             │
│               (session/prompts/builder.ts)                   │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  Base    │→│ Context  │→│ Strategy │→│  Safety  │       │
│  │  Layer   │ │  Layer   │ │  Layer   │ │  Layer   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PromptRouter                              │
│               (session/prompts/router.ts)                    │
│                                                              │
│  Matches model IDs to templates using regex patterns        │
│  Priority-ordered routing rules                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Configuration                             │
│                (session/prompts/config.ts)                   │
│                                                              │
│  MODEL_ROUTES: Model ID patterns → Template IDs             │
│  SAFETY_CONSTRAINTS: Critical security rules                │
│  TEMPLATE_REGISTRY: Template ID → File path mapping         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Template Files                            │
│               (session/prompt/*.txt)                         │
│                                                              │
│  Structured XML-like templates:                             │
│  - anthropic.txt  (Claude models)                           │
│  - beast.txt      (GPT/o1/o3 models)                        │
│  - codex_header.txt (GPT-5 + instructions)                  │
│  - gemini.txt     (Gemini models)                           │
│  - trinity.txt    (Trinity models)                          │
│  - qwen.txt       (Universal fallback)                      │
│  - plan.txt       (Plan mode)                               │
│  - build-switch.txt (Mode transition)                       │
│  - max-steps.txt  (Step limit)                              │
└─────────────────────────────────────────────────────────────┘
```

## Template Structure

Each prompt template follows a standardized structure:

```xml
<!-- ========== ROLE DEFINITION ========== -->
<role>
  Agent identity and primary objective
</role>

<!-- ========== CONSTRAINTS ========== -->
<constraints>
<rule id="..." priority="critical|high|medium|low">
  Constraint content
</rule>
</constraints>

<!-- ========== WORKFLOW ========== -->
<workflow>
<step name="...">Step description</step>
</workflow>

<!-- ========== OUTPUT FORMAT ========== -->
<output_format>
  Format specifications
</output_format>
```

## Model Routing

Routing is configured in `config.ts` using priority-ordered patterns:

```typescript
export const MODEL_ROUTES: ModelRoute[] = [
  { pattern: "^gpt-5", template_id: "codex", priority: 100 },
  { pattern: "^gemini-", template_id: "gemini", priority: 90 },
  { pattern: "claude", template_id: "anthropic", priority: 90 },
  { pattern: "^gpt-", template_id: "beast", priority: 80 },
  { pattern: "^o[13]", template_id: "beast", priority: 80 },
  { pattern: "trinity", template_id: "trinity", priority: 90 },
  { pattern: ".*", template_id: "universal", priority: 0 }, // fallback
]
```

## Layer Assembly

The `PromptBuilder` assembles prompts in order:

1. **Base Layer**: Core template content for the model family
2. **Context Layer**: Dynamic runtime information (cwd, platform, date)
3. **Strategy Layer**: Mode-specific instructions (plan/build)
4. **Safety Layer**: Mandatory security constraints

## Usage

```typescript
import { PromptBuilder, PromptRouter } from "./prompts"

// Get complete assembled prompt
const prompt = await PromptBuilder.build({
  id: "claude-3-opus",
  providerID: "anthropic"
})

// Get just the template ID
const templateId = PromptRouter.getTemplateId("gpt-4")
// Returns: "beast"
```

## Debug Mode

Enable debug logging via environment variables:

```bash
# Enable prompt system debugging
OPENCODE_DEBUG_PROMPTS=true

# Log assembled prompts
OPENCODE_LOG_PROMPTS=true
```

## Extending

To add support for a new model family:

1. Create a new template file: `session/prompt/newmodel.txt`
2. Add routing rule in `config.ts`:
   ```typescript
   {
     pattern: "^newmodel-",
     template_id: "newmodel",
     priority: 90,
     model_family: "newmodel"
   }
   ```
3. Register in `TEMPLATE_REGISTRY`:
   ```typescript
   newmodel: "newmodel.txt"
   ```
4. Import in `builder.ts`:
   ```typescript
   import TEMPLATE_NEWMODEL from "../prompt/newmodel.txt"
   TEMPLATE_CONTENT["newmodel"] = TEMPLATE_NEWMODEL
   ```
