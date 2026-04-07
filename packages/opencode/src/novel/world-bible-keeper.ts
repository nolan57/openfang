import { z } from "zod"
import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import { readFile, writeFile, mkdir, access } from "fs/promises"
import { resolve, dirname } from "path"
import { getNovelDataDir } from "./novel-config"

const log = Log.create({ service: "world-bible-keeper" })

// ============================================================================
// TYPES
// ============================================================================

export interface WorldEntity {
  id: string
  name: string
  type: "location" | "faction" | "artifact" | "rule" | "historical_event" | "race" | "concept"
  description: string
  chapterIntroduced: number
  lastReferenced: number
  attributes: Record<string, string>
  relationships: string[] // IDs of related entities
  status: "active" | "dormant" | "destroyed" | "unknown"
}

export interface WorldBibleEntry {
  id: string
  key: string
  value: string
  category: string
  chapterAdded: number
  lastVerified: number
  confidence: number // 0-1, how certain we are this is correct
}

export interface WorldConsistencyResult {
  status: "consistent" | "conflict" | "uncertain"
  conflicts: Array<{
    type: "lore_contradiction" | "timeline_error" | "character_inconsistency" | "rule_violation"
    description: string
    severity: "low" | "medium" | "high" | "critical"
    suggestion: string
  }>
  newEntries: Array<{
    key: string
    value: string
    category: string
    confidence: number
  }>
  referencedEntities: string[]
  summary: string
}

export interface WorldBibleData {
  version: number
  entities: Record<string, WorldEntity>
  glossary: Record<string, WorldBibleEntry>
  rules: string[]
  timeline: Array<{ chapter: number; event: string }>
  lastUpdated: number
  lastConsistencyCheck: number
}

const DEFAULT_WORLD_BIBLE: WorldBibleData = {
  version: 1,
  entities: {},
  glossary: {},
  rules: [],
  timeline: [],
  lastUpdated: 0,
  lastConsistencyCheck: 0,
}

// ============================================================================
// WORLD BIBLE KEEPER
// ============================================================================

export class WorldBibleKeeper {
  private worldBible: WorldBibleData
  private worldBiblePath: string
  private initialized: boolean = false

  constructor() {
    this.worldBible = { ...DEFAULT_WORLD_BIBLE }
    this.worldBiblePath = resolve(getNovelDataDir(), "world-bible", "world_bible.json")
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.load()
      this.initialized = true
      log.info("world_bible_initialized", {
        entityCount: Object.keys(this.worldBible.entities).length,
        glossaryCount: Object.keys(this.worldBible.glossary).length,
        ruleCount: this.worldBible.rules.length,
      })
    } catch {
      this.worldBible = { ...DEFAULT_WORLD_BIBLE }
      this.initialized = true
      log.info("world_bible_created_fresh")
    }
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  private async load(): Promise<void> {
    try {
      await access(this.worldBiblePath)
      const content = await readFile(this.worldBiblePath, "utf-8")
      this.worldBible = JSON.parse(content)
      log.info("world_bible_loaded", { path: this.worldBiblePath })
    } catch {
      await this.save()
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.worldBiblePath), { recursive: true })
    this.worldBible.lastUpdated = Date.now()
    await writeFile(this.worldBiblePath, JSON.stringify(this.worldBible, null, 2))
    log.info("world_bible_saved", {
      entityCount: Object.keys(this.worldBible.entities).length,
    })
  }

  // ============================================================================
  // WORLD CONSISTENCY CHECKING
  // ============================================================================

  async checkConsistency(
    storySegment: string,
    currentChapter: number,
  ): Promise<WorldConsistencyResult> {
    if (!this.initialized) await this.initialize()

    const worldContext = this.buildWorldContext()

    const prompt = `You are the World Archivist for an ongoing epic narrative. Your task is to verify consistency.

=== CURRENT WORLD BIBLE ===
${worldContext}

=== NEW STORY SEGMENT (Chapter ${currentChapter}) ===
${storySegment.substring(0, 3000)}

=== TASK ===
Analyze the new story segment against the established world bible:

1. VERIFY CONSISTENCY: Does this segment contradict any established lore, rules, or facts?
2. EXTRACT NEW ENTITIES: Identify new locations, factions, artifacts, rules, or concepts introduced.
3. TRACK REFERENCES: Note which existing entities are referenced in this segment.

Output ONLY valid JSON:
{
  "status": "consistent" | "conflict" | "uncertain",
  "conflicts": [
    {
      "type": "lore_contradiction" | "timeline_error" | "character_inconsistency" | "rule_violation",
      "description": "What contradicts what",
      "severity": "low" | "medium" | "high" | "critical",
      "suggestion": "How to resolve or flag it"
    }
  ],
  "newEntries": [
    {
      "key": "Entity or concept name",
      "value": "Description and properties",
      "category": "location|faction|artifact|rule|historical_event|race|concept",
      "confidence": 0.0-1.0
    }
  ],
  "referencedEntities": ["entity_id_1", "entity_id_2"],
  "summary": "Brief summary of world consistency analysis"
}

Guidelines:
- Be strict about established rules and historical facts
- Allow creative expansion that doesn't contradict existing lore
- Flag anything that seems to change established world rules
- Extract new entities only if they seem important to the narrative`

    try {
      const result = await callLLMJson<WorldConsistencyResult>({
        prompt,
        callType: "world_consistency_check",
        temperature: 0.2,
        useRetry: true,
      })

      const analysis = result.data

      // Auto-integrate new entries with high confidence
      for (const entry of analysis.newEntries || []) {
        if (entry.confidence >= 0.7) {
          this.addGlossaryEntry(entry.key, entry.value, entry.category, currentChapter, entry.confidence)
        }
      }

      // Update referenced entities
      for (const entityId of analysis.referencedEntities || []) {
        const entity = this.worldBible.entities[entityId]
        if (entity) {
          entity.lastReferenced = currentChapter
        }
      }

      // Add to timeline if significant
      if (analysis.status === "conflict" && analysis.conflicts.length > 0) {
        this.worldBible.timeline.push({
          chapter: currentChapter,
          event: `Consistency conflict detected: ${analysis.conflicts[0].description.substring(0, 100)}`,
        })
      }

      this.worldBible.lastConsistencyCheck = currentChapter
      await this.save()

      log.info("world_consistency_checked", {
        status: analysis.status,
        conflicts: analysis.conflicts?.length || 0,
        newEntries: analysis.newEntries?.length || 0,
      })

      return analysis
    } catch (error) {
      log.error("world_consistency_check_failed", { error: String(error) })
      return {
        status: "uncertain",
        conflicts: [],
        newEntries: [],
        referencedEntities: [],
        summary: "Consistency check failed due to technical error",
      }
    }
  }

  // ============================================================================
  // ENTITY MANAGEMENT
  // ============================================================================

  addEntity(entity: Omit<WorldEntity, "id" | "lastReferenced">): WorldEntity {
    const id = entity.name.toLowerCase().replace(/\s+/g, "_")
    const fullEntity: WorldEntity = {
      ...entity,
      id,
      lastReferenced: entity.chapterIntroduced,
      relationships: entity.relationships || [],
      status: entity.status || "active",
    }
    this.worldBible.entities[id] = fullEntity
    log.info("world_entity_added", { id, type: entity.type })
    return fullEntity
  }

  addGlossaryEntry(
    key: string,
    value: string,
    category: string,
    chapter: number,
    confidence: number = 0.8,
  ): WorldBibleEntry {
    const id = key.toLowerCase().replace(/\s+/g, "_")
    const entry: WorldBibleEntry = {
      id,
      key,
      value,
      category,
      chapterAdded: chapter,
      lastVerified: chapter,
      confidence,
    }
    this.worldBible.glossary[id] = entry
    return entry
  }

  addRule(rule: string): void {
    if (!this.worldBible.rules.includes(rule)) {
      this.worldBible.rules.push(rule)
      log.info("world_rule_added", { rule: rule.substring(0, 50) })
    }
  }

  updateEntityStatus(entityId: string, status: WorldEntity["status"]): void {
    const entity = this.worldBible.entities[entityId]
    if (entity) {
      entity.status = status
      log.info("entity_status_updated", { entityId, status })
    }
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  getEntity(id: string): WorldEntity | undefined {
    return this.worldBible.entities[id]
  }

  getEntitiesByType(type: WorldEntity["type"]): WorldEntity[] {
    return Object.values(this.worldBible.entities).filter((e) => e.type === type)
  }

  getActiveEntities(): WorldEntity[] {
    return Object.values(this.worldBible.entities).filter((e) => e.status === "active")
  }

  getGlossaryEntry(key: string): WorldBibleEntry | undefined {
    return this.worldBible.glossary[key.toLowerCase().replace(/\s+/g, "_")]
  }

  getRelevantLoreForScene(location?: string, factions?: string[]): string {
    const parts: string[] = []

    // Add location-specific lore
    if (location) {
      const locId = location.toLowerCase().replace(/\s+/g, "_")
      const locEntity = this.worldBible.entities[locId]
      if (locEntity) {
        parts.push(`LOCATION: ${locEntity.name} - ${locEntity.description}`)
      }
    }

    // Add faction-specific lore
    if (factions) {
      for (const faction of factions) {
        const facId = faction.toLowerCase().replace(/\s+/g, "_")
        const facEntity = this.worldBible.entities[facId]
        if (facEntity) {
          parts.push(`FACTION: ${facEntity.name} - ${facEntity.description}`)
        }
      }
    }

    // Add core rules
    if (this.worldBible.rules.length > 0) {
      parts.push("WORLD RULES:")
      parts.push(...this.worldBible.rules.map((r) => `- ${r}`))
    }

    return parts.join("\n")
  }

  getTimeline(): Array<{ chapter: number; event: string }> {
    return this.worldBible.timeline
  }

  // ============================================================================
  // CONTEXT BUILDING FOR PROMPTS
  // ============================================================================

  buildWorldContext(): string {
    const parts: string[] = []

    // Core rules
    if (this.worldBible.rules.length > 0) {
      parts.push("## WORLD RULES (MUST RESPECT)")
      parts.push(...this.worldBible.rules.map((r, i) => `${i + 1}. ${r}`))
      parts.push("")
    }

    // Active entities by type
    const types: WorldEntity["type"][] = ["location", "faction", "artifact", "race", "rule", "concept"]
    for (const type of types) {
      const entities = this.getEntitiesByType(type).filter((e) => e.status === "active")
      if (entities.length > 0) {
        parts.push(`## ${type.toUpperCase()}S`)
        for (const entity of entities.slice(0, 10)) {
          parts.push(`- **${entity.name}**: ${entity.description}`)
        }
        parts.push("")
      }
    }

    // Glossary
    const glossaryEntries = Object.values(this.worldBible.glossary).filter((e) => e.confidence >= 0.7)
    if (glossaryEntries.length > 0) {
      parts.push("## GLOSSARY")
      for (const entry of glossaryEntries.slice(0, 30)) {
        parts.push(`- **${entry.key}** (${entry.category}): ${entry.value}`)
      }
      parts.push("")
    }

    // Recent timeline events
    const recentEvents = this.worldBible.timeline.slice(-10)
    if (recentEvents.length > 0) {
      parts.push("## RECENT TIMELINE")
      for (const event of recentEvents) {
        parts.push(`- Ch.${event.chapter}: ${event.event}`)
      }
      parts.push("")
    }

    return parts.join("\n") || "No established world bible yet."
  }

  // ============================================================================
  // REPORTING
  // ============================================================================

  generateReport(): string {
    const lines: string[] = ["# World Bible Report\n"]

    lines.push(`## Overview`)
    lines.push(`- **Entities**: ${Object.keys(this.worldBible.entities).length}`)
    lines.push(`- **Glossary Entries**: ${Object.keys(this.worldBible.glossary).length}`)
    lines.push(`- **World Rules**: ${this.worldBible.rules.length}`)
    lines.push(`- **Timeline Events**: ${this.worldBible.timeline.length}`)
    lines.push(`- **Last Consistency Check**: Chapter ${this.worldBible.lastConsistencyCheck || "Never"}`)
    lines.push("")

    lines.push(`## Active Entities by Type`)
    const types: WorldEntity["type"][] = ["location", "faction", "artifact", "race", "rule", "concept"]
    for (const type of types) {
      const entities = this.getEntitiesByType(type).filter((e) => e.status === "active")
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s (${entities.length})`)
      for (const entity of entities) {
        lines.push(`- **${entity.name}** (Ch.${entity.chapterIntroduced}) - ${entity.description.substring(0, 80)}...`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  // ============================================================================
  // IMPORT/EXPORT
  // ============================================================================

  exportData(): WorldBibleData {
    return { ...this.worldBible }
  }

  importData(data: WorldBibleData): void {
    this.worldBible = data
    log.info("world_bible_imported", {
      entityCount: Object.keys(data.entities).length,
      glossaryCount: Object.keys(data.glossary).length,
    })
  }

  clear(): void {
    this.worldBible = { ...DEFAULT_WORLD_BIBLE }
    log.info("world_bible_cleared")
  }
}

export const worldBibleKeeper = new WorldBibleKeeper()
