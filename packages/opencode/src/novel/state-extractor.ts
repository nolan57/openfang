import { Log } from "../util/log"
import { callLLM, callLLMJson } from "./llm-wrapper"
import { Provider } from "../provider/provider"
import { getTraumaTags, getSkillCategories, getCharacterStatus, getEmotionTypes, getGoalTypes, SALIENCE_LEVELS } from "./types"
import type {
  OutcomeType,
  CharacterState,
  TraumaEntry,
  SkillEntry,
  TurnResult,
  StateUpdate,
  ProposedChanges,
  ValidatedChanges,
  MindModel,
} from "../types/novel-state"
import { validateSkillAward, validateTraumaSeverity, calculateStressDelta } from "../types/novel-state"
import { buildStateExtractionPrompt } from "../prompts/state-extraction-prompt"

const log = Log.create({ service: "state-extractor" })

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface KeyEvent {
  description: string
  type:
    | "character_death"
    | "skill_acquired"
    | "trauma_inflicted"
    | "betrayal"
    | "alliance_formed"
    | "revelation"
    | "conflict_resolved"
    | "relationship_shift"
    | "goal_completed"
    | "world_event"
  characters?: string[]
  impact: "low" | "medium" | "high"
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
  newTrauma?: TraumaEntry
  newSkill?: SkillEntry
  secrets?: string[]
  clues?: string[]
  goals?: GoalUpdate[]
  notes?: string
  relationships?: Record<string, number>
  mindModel?: {
    publicSelf?: string
    privateSelf?: string
    blindSpot?: string
  }
}

interface GoalUpdate {
  type: string
  description: string
  priority: number
  status: "active" | "completed" | "failed" | "abandoned" | "paused"
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
  activeClues?: string[]
}

interface EvolutionSummary {
  timestamp: number
  chapter: number
  turn: number
  changes: {
    newCharacters: number
    updatedCharacters: string[]
    newRelationships: number
    updatedRelationships: string[]
    newEvents: number
    newTraumas: number
    newSkills: number
    stressChanges: { character: string; delta: number; cause?: string }[]
  }
  highlights: string[]
  contradictions: string[]
  auditFlags?: AuditFlag[]
}

interface AuditFlag {
  type: "SKILL_IN_FAILURE" | "MISSING_TRAUMA" | "INFLATION" | "IMPOSSIBLE_CHANGE" | "STRESS_OVERFLOW"
  description: string
  corrected: boolean
  correction?: string
}

interface TurnEvaluation {
  outcome_type: OutcomeType
  challenge_difficulty: number
  stress_events: { character: string; intensity: number; cause: string }[]
  relationship_changes: { pair: string; delta: number; cause: string }[]
  key_events: KeyEvent[]
}

interface FactValidationReport {
  isValid: boolean
  flags: Array<{
    type: string
    description: string
    severity: "low" | "medium" | "high"
  }>
  corrections: Array<{
    field: string
    originalValue: any
    correctedValue: any
    reason: string
  }>
}

interface FactValidator {
  validateExtractedState(updates: any, currentState: any): Promise<FactValidationReport>
}

// Extend global scope for optional fact validator
declare global {
  var factValidator: FactValidator | undefined
}

// ============================================================================
// VALIDATION STRATEGIES
// ============================================================================

interface ValidationStrategy {
  validate(
    updates: any,
    currentState: any,
    evaluation: TurnEvaluation,
    storyText: string,
  ): Promise<{ auditFlags: AuditFlag[]; correctedUpdates: any }>
}

class SkillValidationStrategy implements ValidationStrategy {
  async validate(
    updates: any,
    currentState: any,
    evaluation: TurnEvaluation,
    _storyText: string,
  ): Promise<{ auditFlags: AuditFlag[]; correctedUpdates: any }> {
    const auditFlags: AuditFlag[] = []
    const correctedUpdates = { ...updates }

    if (correctedUpdates.characters) {
      for (const [charName, charUpdate] of Object.entries(correctedUpdates.characters)) {
        const update = charUpdate as CharacterUpdate
        const currentChar = currentState.characters?.[charName] || {}

        if (update.newSkill) {
          const canAwardSkill = validateSkillAward(evaluation.outcome_type, evaluation.challenge_difficulty)
          if (!canAwardSkill) {
            auditFlags.push({
              type: "SKILL_IN_FAILURE",
              description: `${charName} gained skill during ${evaluation.outcome_type} (difficulty ${evaluation.challenge_difficulty})`,
              corrected: true,
              correction: "Skill removed, converted to stress +15",
            })
            delete (update as any).newSkill
            update.stress = (update.stress || 0) + 15
          } else {
            update.newSkill.difficulty = evaluation.challenge_difficulty
            update.newSkill.source_event = evaluation.key_events[0]?.description || "Unknown challenge"
          }
        }

        // Mental analysis skill inflation
        if (update.newSkill?.category === "Mental_Analysis") {
          const recentSkills = (currentChar.skills || []).filter(
            (s: SkillEntry) =>
              s.category === "Mental_Analysis" &&
              s.acquiredTurn &&
              (currentState.turnCount || 0) - s.acquiredTurn! < 3,
          )
          if (recentSkills.length >= 2) {
            auditFlags.push({
              type: "INFLATION",
              description: `${charName} has ${recentSkills.length} recent Mental_Analysis skills`,
              corrected: true,
              correction: "Skill merged into existing",
            })
            delete (update as any).newSkill
          }
        }

        // Dead characters cannot gain skills
        const currentStatus = (currentChar?.status as string)?.toLowerCase() || "active"
        if ((currentStatus === "deceased" || currentStatus === "dead") && update.newSkill) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `Dead character '${charName}' cannot gain skill '${update.newSkill.name}'`,
            corrected: true,
            correction: `Skill '${update.newSkill.name}' removed`,
          })
          delete (update as any).newSkill
        }
      }
    }

    return { auditFlags, correctedUpdates }
  }
}

class TraumaValidationStrategy implements ValidationStrategy {
  async validate(
    updates: any,
    currentState: any,
    evaluation: TurnEvaluation,
    _storyText: string,
  ): Promise<{ auditFlags: AuditFlag[]; correctedUpdates: any }> {
    const auditFlags: AuditFlag[] = []
    const correctedUpdates = { ...updates }

    if (correctedUpdates.characters) {
      for (const [charName, charUpdate] of Object.entries(correctedUpdates.characters)) {
        const update = charUpdate as CharacterUpdate
        const currentChar = currentState.characters?.[charName] || {}
        const currentStatus = (currentChar?.status as string)?.toLowerCase() || "active"

        // Dead characters cannot receive trauma
        if ((currentStatus === "deceased" || currentStatus === "dead") && update.newTrauma) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `Dead character '${charName}' cannot receive new trauma`,
            corrected: true,
            correction: `Trauma '${update.newTrauma.name}' removed`,
          })
          delete (update as any).newTrauma
          continue
        }

        const stressDelta = update.stress || 0
        const currentStress = currentChar.stress || 0
        const newStress = currentStress + stressDelta

        const relatedStressEvent = evaluation.stress_events.find((e) => e.character === charName)
        const shouldAddTrauma =
          validateTraumaSeverity(newStress, relatedStressEvent ? relatedStressEvent.intensity >= 7 : false) ||
          stressDelta > 20 ||
          evaluation.outcome_type === "FAILURE"

        // BUG FIX: was `!shouldAddTrauma && !update.newTrauma` (logic inverted)
        if (shouldAddTrauma && !update.newTrauma) {
          auditFlags.push({
            type: "MISSING_TRAUMA",
            description: `${charName} experienced stress ${newStress} without trauma`,
            corrected: true,
            correction: "Auto-generated trauma entry",
          })

          update.newTrauma = {
            name: this.generateTraumaName(charName, relatedStressEvent?.cause || "stress_event"),
            description: `Psychological wound from: ${relatedStressEvent?.cause || "high stress event"}`,
            tags: this.selectTraumaTags(relatedStressEvent?.cause || ""),
            severity: Math.min(10, Math.floor((relatedStressEvent?.intensity || 5) / 2) + 1),
            source_event: relatedStressEvent?.cause || "Cumulative stress",
            acquiredChapter: currentState.chapterCount || 0,
            acquiredTurn: currentState.turnCount || 0,
            triggers: [],
          }
        }

        // Warn if trauma severity doesn't match stress level
        if (update.newTrauma && update.newTrauma.severity > 7 && currentStress < 50) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `High severity trauma (${update.newTrauma.severity}) for '${charName}' with low stress (${currentStress})`,
            corrected: false,
          })
        }

        if (update.newTrauma && update.newTrauma.severity >= 5 && currentStress < 30) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `Moderate trauma (${update.newTrauma.severity}) for '${charName}' without significant stress event`,
            corrected: false,
          })
        }
      }
    }

    return { auditFlags, correctedUpdates }
  }

  private generateTraumaName(character: string, cause: string): string {
    const keywords = cause.split("_").map((k) => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase())
    const suffix = ["Shock", "Wound", "Scar", "Phobia", "PTSD"][Math.floor(Math.random() * 5)]
    return `${character}_${keywords.join("")}_${suffix}`
  }

  private selectTraumaTags(cause: string): string[] {
    const traumaTags = getTraumaTags()
    const tags: string[] = []
    const causeLower = cause.toLowerCase()

    if (causeLower.includes("interrogat") || causeLower.includes("torture")) {
      tags.push(traumaTags.PSYCHOLOGICAL_FEAR, traumaTags.ISOLATION)
    }
    if (causeLower.includes("combat") || causeLower.includes("injur")) {
      tags.push(traumaTags.PHYSICAL_INJURY, traumaTags.PHYSICAL_PAIN)
    }
    if (causeLower.includes("betray") || causeLower.includes("trust")) {
      tags.push(traumaTags.PSYCHOLOGICAL_BETRAYAL)
    }
    if (causeLower.includes("death") || causeLower.includes("loss")) {
      tags.push(traumaTags.PSYCHOLOGICAL_LOSS)
    }
    if (causeLower.includes("visual") || causeLower.includes("gore")) {
      tags.push(traumaTags.VISUAL, traumaTags.FLASHBACK)
    }
    if (causeLower.includes("nightmare") || causeLower.includes("sleep")) {
      tags.push(traumaTags.NIGHTMARE)
    }

    return tags.length > 0 ? tags : [traumaTags.PSYCHOLOGICAL_FEAR]
  }
}

class ConsistencyValidationStrategy implements ValidationStrategy {
  async validate(
    updates: any,
    currentState: any,
    _evaluation: TurnEvaluation,
    _storyText: string,
  ): Promise<{ auditFlags: AuditFlag[]; correctedUpdates: any }> {
    const auditFlags: AuditFlag[] = []
    const correctedUpdates = { ...updates }

    // Relationship updates require both characters to exist
    if (correctedUpdates.relationships) {
      for (const [relKey] of Object.entries(correctedUpdates.relationships)) {
        const [charA, charB] = relKey.split("-")
        const existsA = currentState.characters?.[charA]
        const existsB = currentState.characters?.[charB]

        if (!existsA) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `Relationship '${relKey}' references non-existent character '${charA}'`,
            corrected: true,
            correction: `Relationship update for '${relKey}' removed`,
          })
          delete (correctedUpdates.relationships as any)?.[relKey]
        }
        if (!existsB) {
          auditFlags.push({
            type: "IMPOSSIBLE_CHANGE",
            description: `Relationship '${relKey}' references non-existent character '${charB}'`,
            corrected: true,
            correction: `Relationship update for '${relKey}' removed`,
          })
          delete (correctedUpdates.relationships as any)?.[relKey]
        }
      }
    }

    // Completed goals should not be reactivated
    if (correctedUpdates.characters) {
      for (const [charName, charUpdate] of Object.entries(correctedUpdates.characters)) {
        const update = charUpdate as CharacterUpdate
        const currentChar = currentState.characters?.[charName]

        if (update.goals && currentChar?.goals) {
          for (const goal of update.goals) {
            const existingGoal = currentChar.goals.find((g: any) => g.type === goal.type)
            if (existingGoal && existingGoal.status === "completed" && goal.status === "active") {
              auditFlags.push({
                type: "IMPOSSIBLE_CHANGE",
                description: `Completed goal '${goal.type}' for '${charName}' reactivated`,
                corrected: true,
                correction: `Goal '${goal.type}' status reset to 'completed'`,
              })
              for (const g of update.goals) {
                if (g.type === goal.type) {
                  g.status = "completed"
                }
              }
            }
          }
        }
      }
    }

    return { auditFlags, correctedUpdates }
  }
}

// ============================================================================
// STATE TRANSFORMER
// ============================================================================

class StateTransformer {
  transformCharacterUpdates(updates: any): Record<string, CharacterUpdate> {
    if (!updates.character_updates || !Array.isArray(updates.character_updates)) {
      return updates.characters || {}
    }

    const characters: Record<string, CharacterUpdate> = {}

    for (const entry of updates.character_updates) {
      if (entry.name) {
        const charName = entry.name
        const charObj: CharacterUpdate = {}

        if (entry.stress_delta !== undefined) {
          charObj.stress = entry.stress_delta
        }

        if (entry.status_change) {
          charObj.status = entry.status_change
        }

        if (entry.emotions) {
          charObj.emotions = {
            valence: entry.emotions.valence_delta || 0,
            arousal: entry.emotions.arousal_delta || 50,
            dominant: entry.emotions.dominant || "neutral",
          }
        }

        if (entry.new_trait) {
          charObj.traits = [entry.new_trait]
        }

        if (entry.new_trauma) {
          charObj.newTrauma = {
            name: entry.new_trauma.name,
            description: entry.new_trauma.description,
            tags: entry.new_trauma.tags || [],
            severity: entry.new_trauma.severity || 5,
            source_event: entry.new_trauma.source_event,
            acquiredChapter: 0,
            acquiredTurn: 0,
            triggers: [],
          }
        }

        if (entry.new_skill) {
          charObj.newSkill = {
            name: entry.new_skill.name,
            category: entry.new_skill.category || "uncategorized",
            level: entry.new_skill.level || 1,
            description: entry.new_skill.description || "",
            source_event: entry.new_skill.source_event,
            difficulty: entry.new_skill.difficulty || 5,
            acquiredChapter: 0,
            acquiredTurn: 0,
          }
        }

        if (entry.secrets) {
          charObj.secrets = entry.secrets
        }

        if (entry.clues) {
          charObj.clues = entry.clues
        }

        if (entry.goals) {
          charObj.goals = entry.goals.map((g: any) => ({
            type: g.type,
            description: g.description,
            priority: g.priority,
            status: g.status,
          }))
        }

        if (entry.notes) {
          charObj.notes = entry.notes
        }

        if (entry.relationship_deltas) {
          charObj.relationships = entry.relationship_deltas
        }

        if (entry.mindModel) {
          charObj.mindModel = entry.mindModel
        }

        characters[charName] = charObj
      }
    }

    return characters
  }

  transformWorldUpdates(updates: any): WorldUpdate | undefined {
    if (!updates.world_updates) {
      return updates.world
    }

    return {
      events: updates.world_updates.events_resolved || [],
      threats: updates.world_updates.new_threats || [],
      opportunities: updates.world_updates.new_opportunities || [],
      activeClues: updates.world_updates.clues_discovered || [],
      location: updates.world_updates.location_change || undefined,
      timeProgression: updates.world_updates.timeProgression || undefined,
    }
  }
}

// ============================================================================
// EVOLUTION SUMMARY GENERATOR
// ============================================================================

class EvolutionSummaryGenerator {
  generate(
    updates: StateUpdate,
    currentState: any,
    auditFlags: AuditFlag[],
    evaluation?: TurnEvaluation,
  ): EvolutionSummary {
    const chars = updates.characters || {}
    const rels = updates.relationships || {}

    const stressChanges: { character: string; delta: number; cause?: string }[] = []
    const updatedCharacters: string[] = []
    const updatedRelationships: string[] = []
    let newTraumas = 0
    let newSkills = 0

    for (const [name, update] of Object.entries(chars)) {
      const u = update as CharacterUpdate
      updatedCharacters.push(name)
      if (typeof u.stress === "number") stressChanges.push({ character: name, delta: u.stress })
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

    if (evaluation?.key_events && evaluation.key_events.length > 0) {
      for (const event of evaluation.key_events) {
        if (event.impact === "high") {
          highlights.push(`[HIGH IMPACT] ${event.type}: ${event.description}`)
        }
      }
    }

    return {
      timestamp: Date.now(),
      chapter: (currentState.chapterCount || 0) + 1,
      turn: (currentState.turnCount || 0) + 1,
      changes: {
        newCharacters: Object.keys(chars).filter((n) => !currentState.characters?.[n]).length,
        updatedCharacters,
        newRelationships: Object.keys(rels).filter((k) => !currentState.relationships?.[k]).length,
        updatedRelationships,
        newEvents: ((updates.world as WorldUpdate | undefined)?.events || []).length,
        newTraumas,
        newSkills,
        stressChanges,
      },
      highlights,
      contradictions: [],
      auditFlags,
    }
  }
}

// ============================================================================
// STATE EXTRACTOR
// ============================================================================

export class StateExtractor {
  private transformer: StateTransformer
  private summaryGenerator: EvolutionSummaryGenerator
  private validationStrategies: ValidationStrategy[]
  private previousState: any = null
  private turnHistory: TurnResult[] = []

  constructor() {
    this.transformer = new StateTransformer()
    this.summaryGenerator = new EvolutionSummaryGenerator()
    this.validationStrategies = [
      new SkillValidationStrategy(),
      new TraumaValidationStrategy(),
      new ConsistencyValidationStrategy(),
    ]
  }

  async extract(storyText: string, currentState: any, turnResult?: Partial<TurnResult>): Promise<StateUpdate> {
    try {
      const evaluation = await this.evaluateTurn(storyText, currentState, turnResult)
      const systemPrompt = this.buildSystemPrompt(currentState, evaluation)

      const result = await callLLM({
        prompt: `Story segment to analyze:\n\n${storyText}`,
        system: systemPrompt,
        callType: "state_extraction",
        temperature: 0.3,
        useRetry: true,
      })

      const text = result.text.trim()
      log.info("llm_raw_output", { text: text.slice(0, 500) })

      const jsonMatch = text.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        try {
          const updates = JSON.parse(jsonMatch[0])
          log.info("parsed_updates", { keys: Object.keys(updates) })

          const validated = await this.validateAndEnhance(updates, currentState, storyText, evaluation)

          log.info("state_extracted", {
            outcome: evaluation.outcome_type,
            difficulty: evaluation.challenge_difficulty,
            characters: Object.keys(validated.characters || {}).length,
            relationships: Object.keys(validated.relationships || {}).length,
            newTraumas: validated.evolution_summary?.changes.newTraumas || 0,
            newSkills: validated.evolution_summary?.changes.newSkills || 0,
            auditFlags: (validated.evolution_summary?.auditFlags || []).length,
          })

          this.previousState = currentState
          return validated
        } catch (parseError) {
          log.error("json_parse_failed", { error: String(parseError), json: jsonMatch[0].slice(0, 200) })
        }
      } else {
        log.warn("no_json_found_in_output", { text: text.slice(0, 300) })
      }
    } catch (error) {
      log.error("state_extraction_failed", { error: String(error) })
    }

    // Graceful degradation: orchestrator has no try/catch around extract()
    // Returning empty object prevents cycle crash while logging the error
    return {}
  }

  private async evaluateTurn(
    storyText: string,
    currentState: any,
    turnResult?: Partial<TurnResult>,
  ): Promise<TurnEvaluation> {
    const evaluationPrompt = `You are a strict narrative auditor. Evaluate this turn's outcome.

ANALYSIS RULES:
1. SUCCESS: Character achieved their goal despite obstacles
2. COMPLICATION: Character failed or made situation worse
3. FAILURE: Character suffered clear defeat or setback
4. NEUTRAL: No clear success or failure, just progression

STRESS EVALUATION:
- Identify moments of conflict, danger, psychological pressure
- Rate intensity 1-10 for each character
- High intensity (>7) should trigger trauma consideration

RELATIONSHIP EVALUATION:
- Track trust changes based on cooperation/betrayal
- Range: -50 to +50 per event

KEY EVENTS CLASSIFICATION:
For each key event, assign ONE of these types:
- character_death: A character dies or is presumed dead
- skill_acquired: A character learns a new skill
- trauma_inflicted: A character suffers psychological trauma
- betrayal: A character betrays another
- alliance_formed: Characters form an alliance
- revelation: Important information is revealed
- conflict_resolved: A major conflict is resolved
- relationship_shift: A significant relationship change
- goal_completed: A character achieves their goal
- world_event: A major world-changing event

Output JSON only:
{
  "outcome_type": "SUCCESS" | "COMPLICATION" | "FAILURE" | "NEUTRAL",
  "challenge_difficulty": 1-10,
  "stress_events": [{"character": "Name", "intensity": 1-10, "cause": "event"}],
  "relationship_changes": [{"pair": "Char1-Char2", "delta": -50 to 50, "cause": "event"}],
  "key_events": [
    {
      "description": "What happened",
      "type": "character_death|skill_acquired|trauma_inflicted|betrayal|alliance_formed|revelation|conflict_resolved|relationship_shift|goal_completed|world_event",
      "characters": ["Character1", "Character2"],
      "impact": "low|medium|high"
    }
  ]
}`

    try {
      const result = await callLLMJson<TurnEvaluation>({
        prompt: `Current state:\n${JSON.stringify(currentState, null, 2)}\n\nStory:\n${storyText}`,
        system: evaluationPrompt,
        callType: "turn_evaluation",
        temperature: 0.2,
        useRetry: true,
      })
      return result.data
    } catch (error) {
      log.warn("turn_evaluation_failed", { error: String(error) })
      return {
        outcome_type: turnResult?.outcome_type || "NEUTRAL",
        challenge_difficulty: turnResult?.challenge_difficulty || 5,
        stress_events: [],
        relationship_changes: [],
        key_events: [],
      }
    }
  }

  async extractMindModel(characterName: string, storyText: string, currentState: any): Promise<MindModel | null> {
    try {
      const currentChar = currentState.characters?.[characterName]
      const existingMindModel = currentChar?.mindModel
        ? JSON.stringify(currentChar.mindModel, null, 2)
        : "None (will create new)"

      const prompt = `You are a psychological profiler analyzing a character's Theory of Mind.

THREE-LAYER MODEL DEFINITIONS:
1. Public Self: How the character presents themselves to others. Their social mask, reputation, and outward behavior patterns.
2. Private Self: Inner thoughts, true motivations, secret fears, and unspoken desires. What they admit only to themselves.
3. Blind Spot: Aspects of their personality/behavior that others notice but they cannot see. Contradictions between intent and impact.

Character: ${characterName}
Existing Mind Model: ${existingMindModel}
Story Context (this turn): ${storyText.substring(0, 2000)}

Output JSON only with this exact structure:
{
  "publicSelf": "...",
  "privateSelf": "...",
  "blindSpot": "..."
}

Each field should be 1-3 concise sentences.`

      const result = await callLLMJson<MindModel>({
        prompt,
        callType: "mind_model_extraction",
        temperature: 0.3,
        useRetry: true,
      })
      log.info("mind_model_extracted", { character: characterName })
      return result.data
    } catch (error) {
      log.error("mind_model_extraction_failed", { character: characterName, error: String(error) })
      return null
    }
  }

  async extractMindModelsForCharacters(
    characterNames: string[],
    storyText: string,
    currentState: any,
  ): Promise<Record<string, MindModel>> {
    const results: Record<string, MindModel> = {}

    for (const charName of characterNames) {
      const mindModel = await this.extractMindModel(charName, storyText, currentState)
      if (mindModel) {
        results[charName] = mindModel
      }
    }

    log.info("mind_models_extracted", { count: Object.keys(results).length })
    return results
  }

  private buildSystemPrompt(currentState: any, evaluation: TurnEvaluation): string {
    const { outcome_type, challenge_difficulty, stress_events } = evaluation

    return buildStateExtractionPrompt({
      currentStateJson: JSON.stringify(currentState, null, 2),
      narrativeText: "Story segment provided separately",
      chaosOutcome: outcome_type,
      difficultyRating: challenge_difficulty,
    })
  }

  private async validateAndEnhance(
    updates: any,
    currentState: any,
    storyText: string,
    evaluation: TurnEvaluation,
  ): Promise<StateUpdate> {
    // Internal processing format (uses newTrauma/newSkill) differs from StateUpdate schema
    // (uses trauma[]/skills[]). We bridge this at runtime; applyUpdates handles the conversion.
    let validated: any = {}
    let auditFlags: AuditFlag[] = []

    // Transform updates to consistent format
    validated.characters = this.transformer.transformCharacterUpdates(updates)
    validated.world = this.transformer.transformWorldUpdates(updates)
    validated.relationships = updates.relationships || {}

    // Apply validation strategies in order
    for (const strategy of this.validationStrategies) {
      const result = await strategy.validate(validated, currentState, evaluation, storyText)
      auditFlags = [...auditFlags, ...result.auditFlags]
      validated = result.correctedUpdates
    }

    // Apply external fact validation if available
    if (typeof globalThis.factValidator !== "undefined") {
      try {
        const validationReport = await globalThis.factValidator.validateExtractedState(validated, currentState)
        if (!validationReport.isValid) {
          for (const flag of validationReport.flags) {
            auditFlags.push({
              type: flag.type,
              description: flag.description,
              corrected: false,
            } as AuditFlag)
          }
          validated = this.applyFactValidationCorrections(validated, validationReport)
        }
      } catch (validationError) {
        log.warn("fact_validation_failed", { error: String(validationError) })
      }
    }

    // Generate evolution summary
    const summary = this.summaryGenerator.generate(validated, currentState, auditFlags, evaluation)
    validated.evolution_summary = summary

    log.info("validation_complete", {
      auditFlags: auditFlags.length,
      outcome: evaluation.outcome_type,
    })

    return validated as StateUpdate
  }

  private applyFactValidationCorrections(updates: any, validationReport: FactValidationReport): any {
    const corrected = { ...updates }

    for (const correction of validationReport.corrections) {
      try {
        const fieldPath = correction.field.split(".")
        let obj: any = corrected

        for (let i = 0; i < fieldPath.length - 1; i++) {
          obj = obj[fieldPath[i]]
          if (!obj) break
        }

        if (obj && fieldPath[fieldPath.length - 1] in obj) {
          const fieldName = fieldPath[fieldPath.length - 1]
          const originalValue = obj[fieldName]
          obj[fieldName] = correction.correctedValue

          log.info("fact_validation_correction_applied", {
            field: correction.field,
            original: originalValue,
            corrected: correction.correctedValue,
            reason: correction.reason,
          })
        }
      } catch (error) {
        log.warn("correction_application_failed", {
          field: correction.field,
          error: String(error),
        })
      }
    }

    return corrected
  }

  applyUpdates(currentState: any, updates: StateUpdate): any {
    const newState = { ...currentState }
    newState.characters = { ...currentState.characters }
    newState.relationships = { ...currentState.relationships }
    newState.world = { ...currentState.world }

    if (updates.characters) {
      for (const [charName, charUpdate] of Object.entries(updates.characters)) {
        if (!newState.characters[charName]) {
          newState.characters[charName] = {
            status: getCharacterStatus().ACTIVE,
            stress: 0,
            emotions: { valence: 0, arousal: 50, dominant: "neutral" },
            traits: [],
            trauma: [],
            skills: [],
            secrets: [],
            clues: [],
            goals: [],
            notes: "",
            relationships: {},
            mindModel: {
              publicSelf: "",
              privateSelf: "",
              blindSpot: "",
            },
          }
        }

        const current = newState.characters[charName]
        const update = charUpdate as CharacterUpdate

        if (update.traits && update.traits.length > 0) {
          current.traits = [...new Set([...current.traits, ...update.traits])]
        }

        if (typeof update.stress === "number") {
          current.stress = Math.min(100, Math.max(0, current.stress + update.stress))
        }

        if (update.emotions) {
          current.emotions = {
            valence: update.emotions.valence !== undefined ? update.emotions.valence : current.emotions?.valence || 0,
            arousal: update.emotions.arousal !== undefined ? update.emotions.arousal : current.emotions?.arousal || 50,
            dominant: update.emotions.dominant || current.emotions?.dominant || "neutral",
          }
        }

        if (update.status) {
          current.status = update.status
        }

        if (update.newTrauma) {
          current.trauma = [
            ...current.trauma,
            {
              name: update.newTrauma.name,
              description: update.newTrauma.description,
              tags: update.newTrauma.tags || [],
              severity: update.newTrauma.severity || 5,
              source_event: update.newTrauma.source_event || "Unknown",
              acquiredChapter: newState.chapterCount,
              acquiredTurn: newState.turnCount,
              triggers: [],
            },
          ]
        }

        if (update.newSkill) {
          current.skills = [
            ...current.skills,
            {
              name: update.newSkill.name,
              category: update.newSkill.category || "uncategorized",
              level: update.newSkill.level || 1,
              description: update.newSkill.description || "",
              source_event: update.newSkill.source_event || "Unknown",
              difficulty: update.newSkill.difficulty || 5,
              acquiredChapter: newState.chapterCount,
              acquiredTurn: newState.turnCount,
            },
          ]
        }

        if (update.secrets && update.secrets.length > 0) {
          current.secrets = [...new Set([...current.secrets, ...update.secrets])]
        }

        if (update.clues && update.clues.length > 0) {
          current.clues = [...new Set([...current.clues, ...update.clues])]
        }

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

        if (update.relationships) {
          if (!current.relationships) current.relationships = {}
          for (const [otherChar, delta] of Object.entries(update.relationships)) {
            if (!current.relationships[otherChar]) {
              current.relationships[otherChar] = {
                trust: 0,
                hostility: 0,
                dominance: 0,
                friendliness: 0,
                attachmentStyle: "secure",
              }
            }
            current.relationships[otherChar].trust = Math.min(
              100,
              Math.max(-100, current.relationships[otherChar].trust + (delta as number)),
            )
          }
        }

        if (update.notes) {
          current.notes = update.notes
        }

        if (update.mindModel) {
          if (!current.mindModel) {
            current.mindModel = {
              publicSelf: "",
              privateSelf: "",
              blindSpot: "",
            }
          }
          if (update.mindModel.publicSelf) {
            current.mindModel.publicSelf = update.mindModel.publicSelf
          }
          if (update.mindModel.privateSelf) {
            current.mindModel.privateSelf = update.mindModel.privateSelf
          }
          if (update.mindModel.blindSpot) {
            current.mindModel.blindSpot = update.mindModel.blindSpot
          }
        }
      }
    }

    if (updates.relationships) {
      for (const [relKey, relUpdate] of Object.entries(updates.relationships)) {
        if (!newState.relationships[relKey]) {
          newState.relationships[relKey] = {
            trust: 0,
            hostility: 0,
            dominance: 0,
            friendliness: 0,
            dynamic: "",
            attachmentStyle: "secure",
            history: [],
          }
        }

        const current = newState.relationships[relKey]
        const update = relUpdate as RelationshipUpdate

        if (typeof update.trust === "number") {
          const newTrust = Math.min(100, Math.max(-100, current.trust + update.trust))
          const delta = newTrust - current.trust
          current.trust = newTrust
          current.history = [
            ...current.history,
            {
              timestamp: Date.now(),
              chapter: newState.chapterCount,
              turn: newState.turnCount,
              previous: current.dynamic || "",
              current: current.dynamic || "",
              delta,
            },
          ]
        }

        if (typeof update.hostility === "number") {
          current.hostility = Math.min(100, Math.max(0, current.hostility + update.hostility))
        }

        if (typeof update.dominance === "number") {
          current.dominance = update.dominance
        }

        if (typeof update.friendliness === "number") {
          current.friendliness = update.friendliness
        }

        if (update.dynamic) {
          current.dynamic = update.dynamic
        }

        if (update.attachmentStyle) {
          current.attachmentStyle = update.attachmentStyle
        }
      }
    }

    if (updates.world) {
      if (!newState.world) newState.world = {}
      const worldUpdate = updates.world as WorldUpdate

      if (worldUpdate.events) {
        newState.world.events = [...new Set([...(newState.world.events || []), ...worldUpdate.events])]
      }
      if (worldUpdate.timeProgression) {
        newState.world.timeProgression = worldUpdate.timeProgression
      }
      if (worldUpdate.location) {
        newState.world.location = worldUpdate.location
      }
      if (worldUpdate.threats) {
        newState.world.threats = [...new Set([...(newState.world.threats || []), ...worldUpdate.threats])]
      }
      if (worldUpdate.opportunities) {
        newState.world.opportunities = [
          ...new Set([...(newState.world.opportunities || []), ...worldUpdate.opportunities]),
        ]
      }
      if (worldUpdate.activeClues) {
        newState.world.activeClues = [...new Set([...(newState.world.activeClues || []), ...worldUpdate.activeClues])]
      }
    }

    if (updates.evolution_summary) {
      newState.last_turn_evolution = updates.evolution_summary
    }

    newState.turnCount = (newState.turnCount || 0) + 1

    log.info("state_updated", {
      characters: Object.keys(newState.characters).length,
      relationships: Object.keys(newState.relationships).length,
      turnCount: newState.turnCount,
    })

    return newState
  }

  generateContextString(state: any): string {
    const parts: string[] = []

    if (state.characters && Object.keys(state.characters).length > 0) {
      parts.push("=== Characters ===")
      for (const [name, char] of Object.entries(state.characters)) {
        const c = char as CharacterState
        parts.push(`${name} (${c.status || "active"}):`)
        if (c.emotions)
          parts.push(
            `  Emotions: ${c.emotions.dominant} (valence: ${c.emotions.valence}, arousal: ${c.emotions.arousal})`,
          )
        if (c.stress) parts.push(`  Stress: ${c.stress}/100`)
        if (c.traits?.length) parts.push(`  Traits: ${c.traits.join(", ")}`)
        if (c.trauma?.length) {
          for (const t of c.trauma) {
            parts.push(
              `  Trauma: ${t.name || t.description} [${(t as any).tags?.join(",") || "untagged"}] (severity: ${(t as any).severity})`,
            )
          }
        }
        if (c.skills?.length) {
          for (const s of c.skills) {
            parts.push(`  Skill: ${s.name} (${s.category}) Lv.${(s as any).level || 1}`)
          }
        }
        if (c.goals?.length) {
          const activeGoals = c.goals.filter((g: any) => g.status === "active")
          if (activeGoals.length) parts.push(`  Active Goals: ${activeGoals.length}`)
        }
      }
    }

    if (state.relationships && Object.keys(state.relationships).length > 0) {
      parts.push("\n=== Relationships ===")
      for (const [key, rel] of Object.entries(state.relationships)) {
        const r = rel as any
        parts.push(`${key}: Trust ${r.trust || 0}, Hostility: ${r.hostility || 0}`)
      }
    }

    if (state.world && Object.keys(state.world).length > 0) {
      parts.push("\n=== World State ===")
      if (state.world.events?.length) parts.push(`Events: ${state.world.events.slice(-5).join("; ")}`)
      if (state.world.threats?.length) parts.push(`Threats: ${state.world.threats.join(", ")}`)
      if (state.world.activeClues?.length) parts.push(`Active Clues: ${state.world.activeClues.join(", ")}`)
    }

    if (state.last_turn_evolution) {
      const evo = state.last_turn_evolution
      parts.push("\n=== Last Turn Evolution ===")
      if (evo.changes?.updatedCharacters?.length)
        parts.push(`Characters Changed: ${evo.changes.updatedCharacters.join(", ")}`)
      if (evo.auditFlags?.length) parts.push(`! Audit Flags: ${evo.auditFlags.map((f: any) => f.type).join(", ")}`)
    }

    return parts.join("\n")
  }
}

export const stateExtractor = new StateExtractor()
