/**
 * Memory extraction and retrieval utilities
 * 
 * @deprecated Use `Memory` from "../memory/service" instead.
 * This module is kept for backward compatibility and re-exports from MemoryService.
 */

import { Memory, type MemorySuggestion, type ExtractedMemory } from "../memory/service"
import { Instance } from "../project/instance"

// Re-export types for backward compatibility
export type { MemorySuggestion, ExtractedMemory }

/**
 * Get relevant memories using hybrid search
 * @deprecated Use `Memory.getRelevantMemories()` instead
 */
export async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]> {
  return Memory.getRelevantMemories(currentTask, { projectDir })
}

/**
 * Extract memories from a task using LLM
 * @deprecated Use `Memory.extractMemoriesWithLLM()` instead
 */
export async function extractMemoriesWithLLM(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
  modelProviderID: string,
  modelID: string,
): Promise<ExtractedMemory[]> {
  return Memory.extractMemoriesWithLLM({
    projectDir,
    sessionID,
    task,
    toolCalls,
    outcome,
    modelProviderID,
    modelID,
  })
}

/**
 * Extract memories using pattern matching
 * @deprecated Use `Memory.extractMemories()` instead
 */
export async function extractMemories(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
): Promise<void> {
  return Memory.extractMemories({
    projectDir,
    sessionID,
    task,
    toolCalls,
  })
}