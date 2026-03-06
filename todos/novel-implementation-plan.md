Enhanced Novel Writing Engine: Auto-Extraction & CLI Command Integration
Addendum to novel-implementation-plan.md

Executive Summary

This addendum introduces two critical enhancements to the OpenCodeClaw Novel Writing Engine:
Dynamic Configuration via LLM: Replacing manual editing of novel-patterns and keywords with an Auto-Discovery Mechanism. The system will use its own LLM to analyze injected prompts and story context, automatically extracting patterns, generating skills, and updating configuration on the fly.
CLI Command Interface: Implementing a robust Slash Command (/) system allowing users to start sessions, inject prompt files, and control the engine directly from the terminal or chat interface.

These changes shift the paradigm from "User-Configured" to "System-Learned", truly embodying the self-evolving nature of the project.

Feature 1: Dynamic Pattern & Skill Auto-Generation

2.1. Problem Statement
The original plan required users to manually edit memory-patterns.json or create skill files in skills/novel-patterns/. This creates friction and limits the system's ability to adapt to unique story genres or unexpected narrative twists.

2.2. Solution: The PatternMiner Agent
We introduce a background agent, PatternMiner, that runs during the Evolution Loop. It analyzes the generated text and the user's initial prompt to:
Extract Keywords: Identify recurring themes, objects, or concepts not in the default dictionary.
Generate Patterns: Create new entries for memory-patterns dynamically.
Synthesize Skills: If a specific narrative structure (e.g., "Time Loop", "Non-Linear Story") is detected, it generates a temporary "Skill" file to guide future generations.

2.3. Implementation Details

A. Modified adapter.ts - Auto-Extraction Logic

// packages/opencode/src/evolution/novel/adapter.ts

import { z } from "zod";
import { llm } from "@/core/llm";
import { fs } from "@/core/fs";

// Schema for dynamically extracted patterns
const ExtractedPatternSchema = z.object({
keyword: z.string(),
category: z.enum(["trait", "plot_device", "world_rule", "relationship"]),
description: z.string(),
trigger_condition: z.string(), // When to apply this pattern
action: z.string(), // What the system should do when triggered
});

export async function autoExtractPatterns(
storyContext: string,
currentPatterns: any[]
): Promise {
const prompt =
Analyze the following story context and initial setup.
Identify unique narrative patterns, keywords, or rules that are NOT in the standard library.
For each unique element, define a pattern that the system should remember and enforce.

Current Standard Patterns: {JSON.stringify(currentPatterns)}
Story Context:
{storyContext}

Output a JSON list of NEW patterns to add.
;

const result = await llm.generate(prompt, {
response_model: z.array(ExtractedPatternSchema)
});

// Merge with existing patterns and save to dynamic config
const newPatterns = [...currentPatterns, ...result];
await fs.write("packages/opencode/src/evolution/memory-patterns.dynamic.json", JSON.stringify(newPatterns, null, 2));

return newPatterns;
}

B. Dynamic Skill Generation

If the PatternMiner detects a complex structure (e.g., "The story involves a murder mystery with a red herring"), it can generate a temporary skill file:

export async function generateNarrativeSkill(skillName: string, description: string): Promise {
const skillPrompt =
Create a 'Skill' definition for a novel writing agent based on this concept: {description}.
Include:
Trigger conditions (when to use this skill).
A system prompt snippet to guide the LLM.
Examples of application.
Format as a Markdown file compatible with OpenCodeClaw skills.
;

const skillContent = await llm.generate(skillPrompt);
const filePath = packages/opencode/skills/novel-patterns/dynamic-{skillName}.md;

await fs.write(filePath, skillContent);
console.log([Auto-Evolution] Generated new skill: {skillName});
}

C. Integration into Evolution Loop

Update loop.ts to call these functions periodically (e.g., every 5 turns or when a significant plot shift occurs).

// In runNarrativeEvolutionCycle
if (turnId % 5 === 0 || stateChanges.significantShift) {
// Re-analyze and update patterns dynamically
const allPatterns = await loadPatterns(); // Load static + dynamic
const newPatterns = await autoExtractPatterns(state.world.summary, allPatterns);

// Check if new skills are needed
if (detectNewStructure(state)) {
await generateNarrativeSkill("custom-arc", state.world.summary);
}
}

Feature 2: CLI Slash Command Interface

3.1. Overview
Users can now control the novel engine using intuitive slash commands. This allows for seamless switching between "Chat Mode" (discussing the story) and "Generation Mode" (running the self-evolving loop).

3.2. Command Specification
Command Syntax Description
Start Session /start [path/to/prompt.md] Initializes a new story session. If a file path is provided, it reads the file as the initial world setting/prompt.

Continue /continue Resumes the self-evolving loop from the last saved state.

Inject Context /inject [path/to/file.md] Injects additional context (e.g., a character sketch or plot outline) into the current memory without restarting.

Force Evolution /evolve Manually triggers the PatternMiner and Consistency Evaluator immediately.

Show State /state [character_name] Displays the current stored state of a character or the world from the database.

Export /export [format] Exports the current story and state to Markdown, JSON, or PDF.

3.3. Implementation Architecture

A. Command Parser (cli/command-parser.ts)

import { parseArgs } from "node:util";
import { fs } from "@/core/fs";
import { startSession } from "./session-manager";
import { injectContext } from "./context-injector";

export async function handleSlashCommand(input: string, cwd: string) {
const parts = input.trim().split(/s+/);
const command = parts[0];
const args = parts.slice(1);

switch (command) {
case "/start":
const promptPath = args[0];
let initialPrompt = "";
if (promptPath) {
// Read file content if path provided
initialPrompt = await fs.read(promptPath);
console.log(Loaded initial prompt from: {promptPath});
} else {
console.log("Starting interactive setup...");
// Fallback to interactive CLI questions
}
await startSession(cwd, initialPrompt);
break;

    case "/inject":
      if (!args[0]) throw new Error("File path required for /inject");
      const content = await fs.read(args[0]);
      await injectContext(cwd, content);
      console.log("Context injected successfully.");
      break;

    case "/continue":
      await resumeSession(cwd);
      break;

    case "/state":
      const target = args[0] || "world";
      await displayState(cwd, target);
      break;

    default:
      console.log("Unknown command. Available: /start, /continue, /inject, /state, /export");

}
}

B. File Path Resolution & Security
Ensure that file paths are resolved relative to the project root (cwd).
Prevent directory traversal attacks (e.g., ../../etc/passwd) by validating that the resolved path stays within the project directory.

import path from "node:path";

function resolveSafePath(baseDir: string, userInput: string): string {
const resolved = path.resolve(baseDir, userInput);
if (!resolved.startsWith(baseDir)) {
throw new Error("Security Error: Access outside project directory denied.");
}
return resolved;
}

C. Integration with Main Entry Point

Modify bin/opencode.ts (or the main entry) to detect slash commands before entering the standard REPL or agent loop.

// bin/opencode.ts
import { handleSlashCommand } from "@/cli/command-parser";

async function main() {
const input = await readUserInput(); // Custom readline or arg parser

if (input.startsWith("/")) {
await handleSlashCommand(input, process.cwd());
return;
}

// Standard OpenCodeClaw logic for non-command inputs
await runAgentLoop(process.cwd(), input);
}

Updated Workflow Example

Scenario: Starting a New Cyberpunk Mystery

User prepares a prompt file: setup.md # Story Setup
Genre: Cyberpunk Noir
Protagonist: Lin Mo, a hacker with claustrophobia.
Key Plot: A conspiracy involving 3728 uploaded souls.
Tone: Dark, philosophical, fast-paced.
Special Rule: No magic, only hard sci-fi tech.

User starts the session:
opencode . > /start ./setup.md

System Action:
Reads setup.md.
Calls autoExtractPatterns to identify "Cyberpunk", "Claustrophobia", "Uploaded Souls" as key patterns.
Generates a dynamic skill cyberpunk-noir-style.
Initializes story_bible.json.
Starts Turn 1.

Mid-Story Adjustment:
User realizes they want to add a specific character profile later. > /inject ./character_villain.md

System Action:
Parses the file.
Updates StoryState.characters.
Triggers PatternMiner to check for conflicts with existing lore.

Checking Consistency: > /state Lin Mo

System Output:
{
"name": "Lin Mo",
"traits": ["Hacker", "Claustrophobic", "Distrustful"],
"traumas": ["Partner's Death"],
"stress": 45,
"current_status": "On the run"
}

Benefits of These Enhancements
Feature Benefit
Auto-Extraction Zero-Config Onboarding: Users don't need to learn the JSON schema for patterns. The system learns from their natural language description.

Dynamic Skills Genre Adaptability: The system can instantly adapt to "Fantasy", "Romance", or "Horror" just by reading the prompt, without code changes.

Slash Commands Human-in-the-Loop Control: Provides precise control points for the user to intervene, inject data, or inspect the "brain" of the AI without breaking the flow.

File Injection Modular Storytelling: Allows writers to build stories from multiple source files (character sheets, world bibles, plot outlines) rather than one giant prompt.

Updated Implementation Checklist

Add these tasks to the original novel-implementation-plan.md:

Phase 2.5: Dynamic Intelligence (New)
[ ] Implement PatternMiner agent in adapter.ts.
[ ] Create logic for merging static and dynamic memory-patterns.
[ ] Implement generateNarrativeSkill function.
[ ] Add periodic trigger in loop.ts for re-evaluation.

Phase 3.5: CLI & Interaction (New)
[ ] Build command-parser.ts with slash command routing.
[ ] Implement file reading and safe path resolution utilities.
[ ] Create /start, /inject, /state, /continue handlers.
[ ] Integrate command parser into the main binary entry point.
[ ] Add help documentation (/help) for available commands.

Conclusion

By integrating LLM-driven auto-extraction and a flexible CLI command interface, the OpenCodeClaw Novel Engine transforms from a rigid tool into a collaborative partner. It not only writes the story but actively learns the rules of the user's specific universe and provides intuitive controls for the human author to steer the ship. This is the true realization of a Self-Evolving Creative System.
