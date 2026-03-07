import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { TRAUMA_TAGS, SKILL_CATEGORIES, CHARACTER_STATUS, EMOTION_TYPES, GOAL_TYPES, SALIENCE_LEVELS } from "./types"

const log = Log.create({ service: "state-extractor" })

interface StateUpdate {
  characters?: Record<string, CharacterUpdate>
  relationships?: Record<string, RelationshipUpdate>
  world?: WorldUpdate
  evolution_summary?: EvolutionSummary
}

interface CharacterUpdate {
  traits?: string[]
  stress?: number
  status?: string
  emotions?: {
    valence?: number
    arousal?: number
    dominant?: string
  }
  newTrauma?: {
    description: string
    tags: string[]
    severity: number
  }
  newSkill?: {
    name: string
    category: string
    level: number
    description: string
  }
  secrets?: string[]
  clues?: string[]
  goals?: GoalUpdate[]
  notes?: string
}

interface GoalUpdate {
  type: string
  description: string
  priority: number
  status: "active" | "completed" | "failed" | "abandoned"
}

interface RelationshipUpdate {
  trust?: number
  hostility?: number
  dominance?: number
  friendliness?: number
  dynamic?: string
  attachmentStyle?: string
  notes?: string
}

interface WorldUpdate {
  events?: string[]
  timeProgression?: string
  location?: string
  threats?: string[]
  opportunities?: string[]
}

interface EvolutionSummary {
  timestamp: number
  chapter: number
  changes: {
    newCharacters: number
    updatedCharacters: string[]
    newRelationships: number
    updatedRelationships: string[]
    newEvents: number
    newTraumas: number
    newSkills: number
    stressChanges: { character: string; delta: number }[]
  }
  highlights: string[]
  contradictions: string[]
}

/**
 * StateExtractor v2.0 - Enhanced with standardized tags and evolution tracking
 *
 * Improvements over v1.0:
 * - Standardized trauma/skill tags for programmatic access
 * - Emotion modeling (valence/arousal)
 * - Goal tracking system
 * - Evolution summary for each turn
 * - Contradiction detection
 * - Memory salience scoring
 */
export class StateExtractor {
  private previousState: any = null

  /**
   * Extract state changes from story segment
   */
  async extract(storyText: string, currentState: any): Promise<StateUpdate> {
    try {
      const model = await Provider.defaultModel()
      const modelInfo = await Provider.getModel(model.providerID, model.modelID)
      const languageModel = await Provider.getLanguage(modelInfo)

      const systemPrompt = `You are an expert story state analyzer with psychology training.

Current known state:
${JSON.stringify(currentState, null, 2)}

Extract ALL changes from this story segment. Use STANDARDIZED TAGS:

TRAUMA TAGS (choose from these):
${JSON.stringify(TRAUMA_TAGS, null, 2)}

SKILL CATEGORIES (choose from these):
${JSON.stringify(SKILL_CATEGORIES, null, 2)}

EMOTION TYPES:
${JSON.stringify(EMOTION_TYPES, null, 2)}

CHARACTER STATUS (choose one):
${JSON.stringify(CHARACTER_STATUS, null, 2)}

GOAL TYPES:
${JSON.stringify(GOAL_TYPES, null, 2)}

IMPORTANT RULES:
1. For trauma: Include BOTH description AND tags array
2. For skills: Only add when character OVERCOMES difficulty or gains insight
3. For stress: Track cumulative changes (additive, not absolute)
4. For relationships: Track trust (-100 to 100) and hostility (0 to 100)
5. For deceased characters: Set status to "deceased" or "consciousness_lost"
6. CONTRADICTIONS: Flag if dead character acts, or state changes without cause

Output ONLY JSON with this structure:
{
  "characters": {
    "CharacterName": {
      "stress": 0-100 (delta, not absolute),
      "emotions": { "valence": -100 to 100, "arousal": 0-100, "dominant": "emotion_type" },
      "status": "status_from_list",
      "traits": ["new trait"],
      "newTrauma": { "description": "...", "tags": ["TAG1", "TAG2"], "severity": 1-10 },
      "newSkill": { "name": "...", "category": "category_from_list", "level": 1-5, "description": "..." },
      "secrets": ["revealed secret"],
      "clues": ["discovered clue"],
      "goals": [{ "type": "goal_type", "description": "...", "priority": 1-10, "status": "active|completed|failed" }],
      "notes": "brief note"
    }
  },
  "relationships": {
    "Char1-Char2": {
      "trust": -100 to 100 (delta),
      "hostility": 0-100 (delta),
      "dominance": -100 to 100,
      "friendliness": -100 to 100,
      "dynamic": "description",
      "attachmentStyle": "secure|anxious|avoidant|disorganized"
    }
  },
  "world": {
    "events": ["event"],
    "timeProgression": "description",
    "location": "place",
    "threats": ["new threat"],
    "opportunities": ["new opportunity"]
  },
  "evolution_summary": {
    "timestamp": ${Date.now()},
    "chapter": ${currentState.chapterCount || 0},
    "changes": {
      "newCharacters": 0,
      "updatedCharacters": ["Name1", "Name2"],
      "newRelationships": 0,
      "updatedRelationships": ["Char1-Char2"],
      "newEvents": 0,
      "newTraumas": 0,
      "newSkills": 0,
      "stressChanges": [{ "character": "Name", "delta": +20 }]
    },
    "highlights": ["major plot point 1", "major plot point 2"],
    "contradictions": ["flag any logical inconsistencies"]
  }
}

Only include fields that CHANGED. Use delta values (e.g., stress +20, not stress 85).
For skills: Only award when character demonstrates growth or overcomes significant challenge.
For trauma: Always include severity (1-10) based on emotional impact.`

      const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        prompt: `Story segment to analyze:\n\n${storyText}`,
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        const updates = JSON.parse(jsonMatch[0])

        // Validate and enhance the extraction
        const validated = await this.validateAndEnhance(updates, currentState, storyText)

        log.info("state_extracted", {
          characters: Object.keys(validated.characters || {}).length,
          relationships: Object.keys(validated.relationships || {}).length,
          events: (validated.world?.events || []).length,
          contradictions: (validated.evolution_summary?.contradictions || []).length,
        })

        // Store for next iteration
        this.previousState = currentState

        return validated
      }
    } catch (error) {
      log.error("state_extraction_failed", { error: String(error) })
    }

    return {}
  }

  /**
   * Validate extracted changes and detect contradictions
   */
  private async validateAndEnhance(updates: any, currentState: any, storyText: string): Promise<StateUpdate> {
    const contradictions: string[] = []

    // Check for deceased character actions
    for (const [charName, charUpdate] of Object.entries(updates.characters || {})) {
      const current = currentState.characters?.[charName]
      if (current?.status === "deceased" || current?.status === "consciousness_lost") {
        if ((charUpdate as any).traits?.length > 0 || (charUpdate as any).newSkill) {
          contradictions.push(`${charName} is ${current.status} but gained new traits/skills`)
        }
      }

      // Validate stress changes have narrative justification
      const stressDelta = (charUpdate as CharacterUpdate).stress || 0
      if (Math.abs(stressDelta) > 30) {
        // Large stress change should have clear cause in story
        if (!storyText.toLowerCase().includes(charName.toLowerCase())) {
          contradictions.push(`Large stress change for ${charName} without clear presence in scene`)
        }
      }
    }

    // Check for impossible relationship changes
    for (const [relKey, relUpdate] of Object.entries(updates.relationships || {})) {
      const trustDelta = (relUpdate as RelationshipUpdate).trust || 0
      if (Math.abs(trustDelta) > 50) {
        // Major trust shift should have dramatic event
        const hasDramaticEvent = ["betray", "save", "reveal", "confess", "attack"].some((word) =>
          storyText.toLowerCase().includes(word),
        )
        if (!hasDramaticEvent) {
          contradictions.push(`Major trust shift in ${relKey} without dramatic catalyst`)
        }
      }
    }

    // Generate evolution summary if not provided
    if (!updates.evolution_summary) {
      updates.evolution_summary = this.generateEvolutionSummary(updates, currentState, contradictions)
    } else {
      // Merge detected contradictions
      updates.evolution_summary.contradictions = [
        ...(updates.evolution_summary.contradictions || []),
        ...contradictions,
      ]
    }

    return updates as StateUpdate
  }

  /**
   * Generate evolution summary from changes
   */
  private generateEvolutionSummary(updates: any, currentState: any, contradictions: string[]): EvolutionSummary {
    const chars = updates.characters || {}
    const rels = updates.relationships || {}
    const world = updates.world || {}

    const stressChanges: { character: string; delta: number }[] = []
    const updatedCharacters: string[] = []
    const updatedRelationships: string[] = []
    let newTraumas = 0
    let newSkills = 0

    for (const [name, update] of Object.entries(chars)) {
      const u = update as CharacterUpdate
      updatedCharacters.push(name)
      if (u.stress) stressChanges.push({ character: name, delta: u.stress })
      if (u.newTrauma) newTraumas++
      if (u.newSkill) newSkills++
    }

    for (const [key] of Object.entries(rels)) {
      updatedRelationships.push(key)
    }

    const highlights: string[] = []
    if (newTraumas > 0) highlights.push(`${newTraumas} new trauma(s) recorded`)
    if (newSkills > 0) highlights.push(`${newSkills} new skill(s) unlocked`)
    if (stressChanges.some((s) => s.delta > 20)) highlights.push("Severe stress experienced")
    if ((world.events || []).length > 0) highlights.push(`${world.events.length} major event(s)`)

    return {
      timestamp: Date.now(),
      chapter: (currentState.chapterCount || 0) + 1,
      changes: {
        newCharacters: Object.keys(chars).filter((n) => !currentState.characters?.[n]).length,
        updatedCharacters,
        newRelationships: Object.keys(rels).filter((k) => !currentState.relationships?.[k]).length,
        updatedRelationships,
        newEvents: (world.events || []).length,
        newTraumas,
        newSkills,
        stressChanges,
      },
      highlights,
      contradictions,
    }
  }

  /**
   * Apply extracted updates to current state
   */
  applyUpdates(currentState: any, updates: StateUpdate): any {
    const newState = { ...currentState }

    // Apply character updates
    if (updates.characters) {
      for (const [charName, charUpdate] of Object.entries(updates.characters)) {
        if (!newState.characters[charName]) {
          newState.characters[charName] = {
            traits: [],
            stress: 0,
            emotions: { valence: 0, arousal: 50, dominant: "neutral" },
            status: CHARACTER_STATUS.ACTIVE,
            trauma: [],
            skills: [],
            secrets: [],
            clues: [],
            goals: [],
            notes: "",
          }
        }

        const current = newState.characters[charName]
        const update = charUpdate as CharacterUpdate

        // Merge traits (deduplicated)
        if (update.traits && update.traits.length > 0) {
          current.traits = [...new Set([...(current.traits || []), ...update.traits])]
        }

        // Update stress (additive, clamped 0-100)
        if (typeof update.stress === "number") {
          current.stress = Math.min(100, Math.max(0, (current.stress || 0) + update.stress))
        }

        // Update emotions
        if (update.emotions) {
          current.emotions = {
            valence: update.emotions.valence !== undefined ? update.emotions.valence : current.emotions?.valence || 0,
            arousal: update.emotions.arousal !== undefined ? update.emotions.arousal : current.emotions?.arousal || 50,
            dominant: update.emotions.dominant || current.emotions?.dominant || "neutral",
          }
        }

        // Update status
        if (update.status) {
          current.status = update.status
        }

        // Add trauma with tags and severity
        if (update.newTrauma) {
          current.trauma = [
            ...(current.trauma || []),
            {
              description: update.newTrauma.description,
              tags: update.newTrauma.tags || [],
              severity: update.newTrauma.severity || 5,
              acquiredChapter: newState.chapterCount,
            },
          ]
        }

        // Add skill with category and level
        if (update.newSkill) {
          current.skills = [
            ...new Set([
              ...(current.skills || []),
              {
                name: update.newSkill.name,
                category: update.newSkill.category || "uncategorized",
                level: update.newSkill.level || 1,
                description: update.newSkill.description || "",
                acquiredChapter: newState.chapterCount,
              },
            ]),
          ]
        }

        // Add secrets
        if (update.secrets && update.secrets.length > 0) {
          current.secrets = [...new Set([...(current.secrets || []), ...update.secrets])]
        }

        // Add clues
        if (update.clues && update.clues.length > 0) {
          current.clues = [...new Set([...(current.clues || []), ...update.clues])]
        }

        // Update goals
        if (update.goals && update.goals.length > 0) {
          for (const goal of update.goals) {
            const existingIndex = current.goals?.findIndex((g: any) => g.type === goal.type)
            if (existingIndex >= 0) {
              current.goals[existingIndex] = goal
            } else {
              current.goals = [...(current.goals || []), goal]
            }
          }
        }

        // Update notes
        if (update.notes) {
          current.notes = update.notes
        }
      }
    }

    // Apply relationship updates
    if (updates.relationships) {
      if (!newState.relationships) {
        newState.relationships = {}
      }

      for (const [relationKey, relationUpdate] of Object.entries(updates.relationships)) {
        if (!newState.relationships[relationKey]) {
          newState.relationships[relationKey] = {
            trust: 0,
            hostility: 0,
            dominance: 0,
            friendliness: 0,
            dynamic: "",
            attachmentStyle: "secure",
            history: [],
          }
        }

        const current = newState.relationships[relationKey]
        const update = relationUpdate as RelationshipUpdate

        // Update trust (additive, clamped -100 to 100)
        if (typeof update.trust === "number") {
          current.trust = Math.min(100, Math.max(-100, (current.trust || 0) + update.trust))
        }

        // Update hostility (additive, clamped 0-100)
        if (typeof update.hostility === "number") {
          current.hostility = Math.min(100, Math.max(0, (current.hostility || 0) + update.hostility))
        }

        // Update dominance
        if (typeof update.dominance === "number") {
          current.dominance = update.dominance
        }

        // Update friendliness
        if (typeof update.friendliness === "number") {
          current.friendliness = update.friendliness
        }

        // Update dynamic with history
        if (update.dynamic) {
          const previousDynamic = current.dynamic
          current.dynamic = update.dynamic
          current.history = [
            ...(current.history || []),
            {
              timestamp: Date.now(),
              chapter: newState.chapterCount,
              previous: previousDynamic,
              current: update.dynamic,
            },
          ]
        }

        // Update attachment style
        if (update.attachmentStyle) {
          current.attachmentStyle = update.attachmentStyle
        }
      }
    }

    // Apply world updates
    if (updates.world) {
      if (!newState.world) {
        newState.world = {}
      }

      const worldUpdate = updates.world as WorldUpdate

      if (worldUpdate.events) {
        newState.world.events = [...new Set([...(newState.world.events || []), ...worldUpdate.events])]
      }

      if (worldUpdate.timeProgression) {
        newState.world.lastTimeUpdate = worldUpdate.timeProgression
      }

      if (worldUpdate.location) {
        newState.world.currentLocation = worldUpdate.location
      }

      if (worldUpdate.threats) {
        newState.world.threats = [...new Set([...(newState.world.threats || []), ...worldUpdate.threats])]
      }

      if (worldUpdate.opportunities) {
        newState.world.opportunities = [
          ...new Set([...(newState.world.opportunities || []), ...worldUpdate.opportunities]),
        ]
      }
    }

    // Add evolution summary
    if (updates.evolution_summary) {
      newState.last_turn_evolution = updates.evolution_summary
    }

    log.info("state_updated", {
      characters: Object.keys(newState.characters || {}).length,
      relationships: Object.keys(newState.relationships || {}).length,
      worldFields: Object.keys(newState.world || {}).length,
      evolutionSummary: updates.evolution_summary ? "included" : "missing",
    })

    return newState
  }

  /**
   * Generate context string from current state for LLM
   */
  generateContextString(state: any): string {
    const parts: string[] = []

    // Character context with emotions and goals
    if (state.characters && Object.keys(state.characters).length > 0) {
      parts.push("=== Characters ===")
      for (const [name, char] of Object.entries(state.characters)) {
        const c = char as any
        parts.push(`${name} (${c.status || "active"}):`)
        if (c.emotions)
          parts.push(
            `  Emotions: ${c.emotions.dominant} (valence: ${c.emotions.valence}, arousal: ${c.emotions.arousal})`,
          )
        if (c.stress) parts.push(`  Stress: ${c.stress}/100`)
        if (c.traits?.length) parts.push(`  Traits: ${c.traits.join(", ")}`)
        if (c.trauma?.length) {
          for (const t of c.trauma) {
            parts.push(`  Trauma: ${t.description} [${t.tags?.join(",") || "untagged"}] (severity: ${t.severity})`)
          }
        }
        if (c.skills?.length) {
          for (const s of c.skills) {
            parts.push(`  Skill: ${s.name} (${s.category}) Lv.${s.level || 1}`)
          }
        }
        if (c.secrets?.length) parts.push(`  Secrets: ${c.secrets.length} hidden`)
        if (c.clues?.length) parts.push(`  Clues: ${c.clues.length} found`)
        if (c.goals?.length) {
          const activeGoals = c.goals.filter((g: any) => g.status === "active")
          if (activeGoals.length) parts.push(`  Active Goals: ${activeGoals.length}`)
        }
      }
    }

    // Relationship context with history
    if (state.relationships && Object.keys(state.relationships).length > 0) {
      parts.push("\n=== Relationships ===")
      for (const [key, rel] of Object.entries(state.relationships)) {
        const r = rel as any
        parts.push(`${key}:`)
        parts.push(`  Trust: ${r.trust || 0}, Hostility: ${r.hostility || 0}`)
        parts.push(`  Dynamic: ${r.dynamic || "undefined"}`)
        if (r.history?.length > 0) {
          const recent = r.history.slice(-3)
          parts.push(`  Recent Changes: ${recent.length}`)
        }
      }
    }

    // World context
    if (state.world && Object.keys(state.world).length > 0) {
      parts.push("\n=== World State ===")
      if (state.world.events?.length) parts.push(`Events: ${state.world.events.slice(-5).join("; ")}`)
      if (state.world.threats?.length) parts.push(`Threats: ${state.world.threats.join(", ")}`)
      if (state.world.opportunities?.length) parts.push(`Opportunities: ${state.world.opportunities.join(", ")}`)
      if (state.world.lastTimeUpdate) parts.push(`Time: ${state.world.lastTimeUpdate}`)
    }

    // Last turn evolution summary
    if (state.last_turn_evolution) {
      const evo = state.last_turn_evolution
      parts.push("\n=== Last Turn Evolution ===")
      if (evo.changes?.updatedCharacters?.length)
        parts.push(`Characters Changed: ${evo.changes.updatedCharacters.join(", ")}`)
      if (evo.highlights?.length) parts.push(`Highlights: ${evo.highlights.join("; ")}`)
      if (evo.contradictions?.length) parts.push(`⚠️ Contradictions: ${evo.contradictions.join("; ")}`)
    }

    return parts.join("\n")
  }

  /**
   * Check for contradictions in current story vs state
   */
  async detectContradictions(storyText: string, currentState: any): Promise<string[]> {
    const contradictions: string[] = []

    // Check for deceased character actions
    for (const [charName, char] of Object.entries(currentState.characters || {})) {
      const c = char as any
      if (c.status === "deceased" || c.status === "consciousness_lost") {
        if (storyText.includes(charName) && !storyText.includes("memory") && !storyText.includes("flashback")) {
          contradictions.push(`${charName} (${c.status}) appears in scene without flashback/memory context`)
        }
      }
    }

    return contradictions
  }
}

export const stateExtractor = new StateExtractor()
