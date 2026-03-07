import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"

const log = Log.create({ service: "state-extractor" })

interface StateUpdate {
  characters?: Record<string, CharacterUpdate>
  relationships?: Record<string, RelationshipUpdate>
  world?: Record<string, any>
}

interface CharacterUpdate {
  traits?: string[]
  stress?: number
  status?: string
  newTrauma?: string
  newSkill?: string
  secrets?: string[]
  clues?: string[]
  notes?: string
}

interface RelationshipUpdate {
  trust?: number
  hostility?: number
  dynamic?: string
  notes?: string
}

/**
 * StateExtractor - Extracts state changes from generated story text
 *
 * This is the critical missing piece that enables true self-evolution:
 * - Parses generated story to detect character psychology changes
 * - Tracks relationship dynamics between characters
 * - Records world state changes (time, events, environment)
 * - Updates story_bible.json with extracted data
 */
export class StateExtractor {
  /**
   * Extract state changes from story segment
   */
  async extract(storyText: string, currentState: any): Promise<StateUpdate> {
    try {
      const model = await Provider.defaultModel()
      const modelInfo = await Provider.getModel(model.providerID, model.modelID)
      const languageModel = await Provider.getLanguage(modelInfo)

      const systemPrompt = `You are a story state analyzer. Extract changes from the story segment.

Current known state:
${JSON.stringify(currentState, null, 2)}

Analyze the story and extract ANY changes to:
1. Characters (stress levels, new traits, trauma, skills, secrets)
2. Relationships (trust, hostility between characters)
3. World state (events, time progression, environmental changes)

Output ONLY a JSON object with this structure:
{
  "characters": {
    "CharacterName": {
      "stress": 0-100,
      "traits": ["new trait"],
      "newTrauma": "description",
      "newSkill": "skill name",
      "secrets": ["revealed secret"],
      "clues": ["discovered clue"],
      "notes": "brief note"
    }
  },
  "relationships": {
    "Char1-Char2": {
      "trust": -100 to 100,
      "hostility": 0-100,
      "dynamic": "description"
    }
  },
  "world": {
    "events": ["event"],
    "timeProgression": "description"
  }
}

Only include fields that CHANGED. Skip characters/relationships that didn't change.`

      const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        prompt: `Story segment to analyze:\n\n${storyText}`,
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        const updates = JSON.parse(jsonMatch[0])
        log.info("state_extracted", {
          characters: Object.keys(updates.characters || {}).length,
          relationships: Object.keys(updates.relationships || {}).length,
        })
        return updates
      }
    } catch (error) {
      log.error("state_extraction_failed", { error: String(error) })
    }

    return {}
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
            status: "active",
            trauma: [],
            skills: [],
            secrets: [],
            clues: [],
            notes: "",
          }
        }

        const current = newState.characters[charName]
        const update = charUpdate as CharacterUpdate

        // Merge traits
        if (update.traits && update.traits.length > 0) {
          current.traits = [...new Set([...(current.traits || []), ...update.traits])]
        }

        // Update stress (additive)
        if (typeof update.stress === "number") {
          current.stress = Math.min(100, Math.max(0, (current.stress || 0) + update.stress))
        }

        // Update status
        if (update.status) {
          current.status = update.status
        }

        // Add trauma
        if (update.newTrauma) {
          current.trauma = [...(current.trauma || []), update.newTrauma]
        }

        // Add skill
        if (update.newSkill) {
          current.skills = [...new Set([...(current.skills || []), update.newSkill])]
        }

        // Add secrets
        if (update.secrets && update.secrets.length > 0) {
          current.secrets = [...new Set([...(current.secrets || []), ...update.secrets])]
        }

        // Add clues
        if (update.clues && update.clues.length > 0) {
          current.clues = [...new Set([...(current.clues || []), ...update.clues])]
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
            dynamic: "",
            history: [],
          }
        }

        const current = newState.relationships[relationKey]
        const update = relationUpdate as RelationshipUpdate

        // Update trust (additive)
        if (typeof update.trust === "number") {
          current.trust = Math.min(100, Math.max(-100, (current.trust || 0) + update.trust))
        }

        // Update hostility (additive)
        if (typeof update.hostility === "number") {
          current.hostility = Math.min(100, Math.max(0, (current.hostility || 0) + update.hostility))
        }

        // Update dynamic
        if (update.dynamic) {
          current.dynamic = update.dynamic
          current.history = [
            ...(current.history || []),
            {
              timestamp: Date.now(),
              dynamic: update.dynamic,
            },
          ]
        }
      }
    }

    // Apply world updates
    if (updates.world) {
      if (!newState.world) {
        newState.world = {}
      }

      const worldUpdate = updates.world

      if (worldUpdate.events) {
        newState.world.events = [...(newState.world.events || []), ...worldUpdate.events]
      }

      if (worldUpdate.timeProgression) {
        newState.world.lastTimeUpdate = worldUpdate.timeProgression
      }

      // Merge any other world fields
      for (const [key, value] of Object.entries(worldUpdate)) {
        if (key !== "events" && key !== "timeProgression") {
          newState.world[key] = value
        }
      }
    }

    log.info("state_updated", {
      characters: Object.keys(newState.characters || {}).length,
      relationships: Object.keys(newState.relationships || {}).length,
      worldFields: Object.keys(newState.world || {}).length,
    })

    return newState
  }

  /**
   * Generate context string from current state for LLM
   */
  generateContextString(state: any): string {
    const parts: string[] = []

    // Character context
    if (state.characters && Object.keys(state.characters).length > 0) {
      parts.push("=== Characters ===")
      for (const [name, char] of Object.entries(state.characters)) {
        const c = char as any
        parts.push(`${name}:`)
        if (c.traits?.length) parts.push(`  Traits: ${c.traits.join(", ")}`)
        if (c.stress) parts.push(`  Stress: ${c.stress}/100`)
        if (c.trauma?.length) parts.push(`  Trauma: ${c.trauma.join("; ")}`)
        if (c.skills?.length) parts.push(`  Skills: ${c.skills.join(", ")}`)
        if (c.secrets?.length) parts.push(`  Secrets: ${c.secrets.length} hidden`)
        if (c.clues?.length) parts.push(`  Clues: ${c.clues.length} found`)
      }
    }

    // Relationship context
    if (state.relationships && Object.keys(state.relationships).length > 0) {
      parts.push("\n=== Relationships ===")
      for (const [key, rel] of Object.entries(state.relationships)) {
        const r = rel as any
        parts.push(`${key}: Trust ${r.trust || 0}, Hostility ${r.hostility || 0}`)
        if (r.dynamic) parts.push(`  Dynamic: ${r.dynamic}`)
      }
    }

    // World context
    if (state.world && Object.keys(state.world).length > 0) {
      parts.push("\n=== World State ===")
      for (const [key, value] of Object.entries(state.world)) {
        parts.push(`${key}: ${JSON.stringify(value)}`)
      }
    }

    return parts.join("\n")
  }
}

export const stateExtractor = new StateExtractor()
