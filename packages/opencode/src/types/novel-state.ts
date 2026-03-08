import { z } from "zod"

/**
 * Outcome types for turn resolution
 * Used to determine skill vs trauma generation
 */
export const OutcomeTypeSchema = z.enum(["SUCCESS", "COMPLICATION", "FAILURE", "NEUTRAL"])
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>

/**
 * Chaos roll result (1-6)
 */
export const ChaosRollSchema = z.number().min(1).max(6)
export type ChaosRoll = z.infer<typeof ChaosRollSchema>

/**
 * Trauma entry with standardized classification
 */
export const TraumaEntrySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).describe("Specific trauma name, e.g., 'Interrogation_Phasic_Shock'"),
  description: z.string(),
  tags: z.array(z.string()).describe("Standardized tags from TRAUMA_TAGS"),
  severity: z.number().min(1).max(10).describe("1-10 severity scale"),
  source_event: z.string().describe("Specific event that caused this trauma"),
  acquiredChapter: z.number(),
  acquiredTurn: z.number().optional(),
  triggers: z.array(z.string()).optional().describe("Situations that may trigger this trauma"),
})
export type TraumaEntry = z.infer<typeof TraumaEntrySchema>

/**
 * Skill entry with source tracking
 */
export const SkillEntrySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).describe("Specific skill name bound to event, e.g., 'Bypassed_Neural_Firewall'"),
  category: z.string().describe("Category from SKILL_CATEGORIES"),
  level: z.number().min(1).max(10).default(1),
  description: z.string(),
  source_event: z.string().describe("Specific challenge overcome to gain this skill"),
  difficulty: z.number().min(1).max(10).describe("Difficulty of the challenge overcome"),
  acquiredChapter: z.number(),
  acquiredTurn: z.number().optional(),
  cooldown: z.number().optional().describe("Turns remaining before skill can be used again"),
})
export type SkillEntry = z.infer<typeof SkillEntrySchema>

/**
 * Character relationship tracking
 */
export const RelationshipSchema = z.object({
  trust: z.number().min(-100).max(100).default(0).describe("Trust score -100 to 100"),
  hostility: z.number().min(0).max(100).default(0).describe("Hostility score 0 to 100"),
  dominance: z.number().min(-100).max(100).default(0),
  friendliness: z.number().min(-100).max(100).default(0),
  dynamic: z.string().optional().describe("Current relationship dynamic description"),
  attachmentStyle: z.enum(["secure", "anxious", "avoidant", "disorganized"]).default("secure"),
  history: z
    .array(
      z.object({
        timestamp: z.number(),
        chapter: z.number(),
        turn: z.number().optional(),
        previous: z.string(),
        current: z.string(),
        delta: z.number().optional(),
      }),
    )
    .optional(),
})
export type Relationship = z.infer<typeof RelationshipSchema>

/**
 * Character emotional state
 */
export const EmotionStateSchema = z.object({
  valence: z.number().min(-100).max(100).default(0).describe("Positive/negative mood -100 to 100"),
  arousal: z.number().min(0).max(100).default(50).describe("Activation level 0-100"),
  dominant: z.string().optional().describe("Dominant emotion type"),
})
export type EmotionState = z.infer<typeof EmotionStateSchema>

/**
 * Character mind model - Theory of Mind (three-layer self)
 */
export const MindModelSchema = z.object({
  publicSelf: z.string().describe("How the character presents themselves to others"),
  privateSelf: z.string().describe("Inner thoughts, fears, and true motivations"),
  blindSpot: z.string().describe("Aspects of themselves they cannot see but others notice"),
})
export type MindModel = z.infer<typeof MindModelSchema>

/**
 * Character goal tracking
 */
export const GoalSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.string().describe("Goal type from GOAL_TYPES"),
  description: z.string(),
  priority: z.number().min(1).max(10),
  status: z.enum(["active", "completed", "failed", "abandoned", "paused"]),
  progress: z.number().min(0).max(100).default(0),
  relatedSkills: z.array(z.string()).optional().describe("Skills that help achieve this goal"),
  relatedTraumas: z.array(z.string()).optional().describe("Traumas that block this goal"),
})
export type Goal = z.infer<typeof GoalSchema>

/**
 * Character state with full psychological modeling
 */
export const CharacterStateSchema = z.object({
  status: z.enum([
    "active",
    "injured",
    "stressed",
    "unconscious",
    "captured",
    "missing",
    "deceased",
    "consciousness_lost",
    "ai_simulated",
  ]),
  stress: z.number().min(0).max(100).default(0).describe("Cumulative stress 0-100"),
  emotions: EmotionStateSchema.optional(),
  traits: z.array(z.string()).default([]),
  trauma: z.array(TraumaEntrySchema).default([]),
  skills: z.array(SkillEntrySchema).default([]),
  secrets: z.array(z.string()).default([]),
  clues: z.array(z.string()).default([]),
  goals: z.array(GoalSchema).default([]),
  notes: z.string().optional(),
  relationships: z.record(z.string(), RelationshipSchema).optional().describe("Character's view of others"),
  mindModel: MindModelSchema.optional().describe("Three-layer Theory of Mind model"),
})
export type CharacterState = z.infer<typeof CharacterStateSchema>

/**
 * World state tracking
 */
export const WorldStateSchema = z.object({
  events: z.array(z.string()).default([]),
  timeProgression: z.string().optional(),
  location: z.string().optional(),
  threats: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  activeClues: z.array(z.string()).default([]).describe("Key plot devices currently active"),
  worldState: z.record(z.string(), z.unknown()).optional().describe("Arbitrary world state data"),
})
export type WorldState = z.infer<typeof WorldStateSchema>

export function createDefaultWorldState(): WorldState {
  return {
    events: [],
    threats: [],
    opportunities: [],
    activeClues: [],
    timeProgression: undefined,
    location: undefined,
    worldState: undefined,
  }
}

/**
 * Turn result for causal logic
 */
export const TurnResultSchema = z.object({
  turn_number: z.number(),
  chapter: z.number(),
  chaos_roll: ChaosRollSchema,
  outcome_type: OutcomeTypeSchema,
  challenge_difficulty: z.number().min(1).max(10).optional(),
  summary: z.string(),
  key_events: z.array(z.string()),
  timestamp: z.number(),
})
export type TurnResult = z.infer<typeof TurnResultSchema>

/**
 * Evolution summary for turn tracking
 */
export const EvolutionSummarySchema = z.object({
  timestamp: z.number(),
  chapter: z.number(),
  turn: z.number().optional(),
  changes: z.object({
    newCharacters: z.number().default(0),
    updatedCharacters: z.array(z.string()).default([]),
    newRelationships: z.number().default(0),
    updatedRelationships: z.array(z.string()).default([]),
    newEvents: z.number().default(0),
    newTraumas: z.number().default(0),
    newSkills: z.number().default(0),
    stressChanges: z
      .array(
        z.object({
          character: z.string(),
          delta: z.number(),
          cause: z.string().optional(),
        }),
      )
      .default([]),
  }),
  highlights: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  auditFlags: z
    .array(
      z.object({
        type: z.enum(["SKILL_IN_FAILURE", "MISSING_TRAUMA", "INFLATION", "IMPOSSIBLE_CHANGE"]),
        description: z.string(),
        corrected: z.boolean().default(false),
      }),
    )
    .optional(),
})
export type EvolutionSummary = z.infer<typeof EvolutionSummarySchema>

/**
 * State update from extraction
 */
export const StateUpdateSchema = z.object({
  characters: z.record(z.string(), CharacterStateSchema.partial()).optional(),
  relationships: z.record(z.string(), RelationshipSchema.partial()).optional(),
  world: WorldStateSchema.partial().optional(),
  evolution_summary: EvolutionSummarySchema.optional(),
  turn_result: TurnResultSchema.optional(),
})
export type StateUpdate = z.infer<typeof StateUpdateSchema>

/**
 * Complete story bible structure
 */
export const StoryBibleSchema = z.object({
  characters: z.record(z.string(), CharacterStateSchema).default({}),
  world: WorldStateSchema.default(createDefaultWorldState),
  relationships: z.record(z.string(), RelationshipSchema).default({}),
  currentChapter: z.string().optional(),
  chapterCount: z.number().default(0),
  turnCount: z.number().default(0),
  timestamps: z
    .object({
      createdAt: z.number().optional(),
      lastGeneration: z.number().optional(),
      lastCalibration: z.number().optional(),
    })
    .optional(),
  fullStory: z.string().optional(),
  turn_history: z.array(TurnResultSchema).optional(),
  last_turn_evolution: EvolutionSummarySchema.optional(),
  metadata: z
    .object({
      genre: z.string().optional(),
      themes: z.array(z.string()).optional(),
      calibrationVersion: z.string().optional(),
    })
    .optional(),
})
export type StoryBible = z.infer<typeof StoryBibleSchema>

/**
 * Proposed changes before audit
 */
export const ProposedChangesSchema = z.object({
  characters: z.record(z.string(), CharacterStateSchema.partial()).optional(),
  relationships: z.record(z.string(), RelationshipSchema.partial()).optional(),
  world: WorldStateSchema.partial().optional(),
  turn_result: TurnResultSchema.optional(),
})
export type ProposedChanges = z.infer<typeof ProposedChangesSchema>

/**
 * Validated changes after audit
 */
export const ValidatedChangesSchema = ProposedChangesSchema.extend({
  auditFlags: z.array(
    z.object({
      type: z.enum(["SKILL_IN_FAILURE", "MISSING_TRAUMA", "INFLATION", "IMPOSSIBLE_CHANGE", "STRESS_OVERFLOW"]),
      description: z.string(),
      corrected: z.boolean().default(false),
      correction: z.string().optional(),
    }),
  ),
  corrections_applied: z.number().default(0),
})
export type ValidatedChanges = z.infer<typeof ValidatedChangesSchema>

// Validation helpers - 可通过配置调整的阈值
let config = {
  minDifficultyForSkill: 5, // 技能阈值（原7，放宽到5让LLM更容易给技能）
  traumaStressThreshold: 80, // stress > 80 必生创伤
  traumaDeltaThreshold: 20, // 单次 delta > 20 建议生创伤
}

export function setValidationConfig(overrides: Partial<typeof config>) {
  config = { ...config, ...overrides }
}

export function getValidationConfig() {
  return { ...config }
}

export function validateTraumaSeverity(stress: number, hasHighStressEvent: boolean): boolean {
  return stress > config.traumaStressThreshold || hasHighStressEvent
}

export function validateSkillAward(outcome: OutcomeType, difficulty: number): boolean {
  return outcome === "SUCCESS" && difficulty >= config.minDifficultyForSkill
}

export function calculateStressDelta(baseStress: number, eventSeverity: number): number {
  return Math.min(100 - baseStress, eventSeverity * 10)
}
