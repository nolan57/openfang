import { Log } from "../util/log"

const log = Log.create({ service: "novel-types" })

/**
 * Standardized tags for trauma classification
 * Based on psychological research and interactive fiction best practices
 */
export const TRAUMA_TAGS = {
  // Visual trauma
  VISUAL: "PTSD_Visual",
  NIGHTMARE: "PTSD_Nightmare",
  FLASHBACK: "PTSD_Flashback",

  // Physical trauma
  PAIN: "Physical_Pain",
  INJURY: "Physical_Injury",
  NEURAL: "Neural_Damage",

  // Psychological trauma
  BETRAYAL: "Psychological_Betrayal",
  GUILT: "Psychological_Guilt",
  FEAR: "Psychological_Fear",
  LOSS: "Psychological_Loss",

  // Social trauma
  HUMILIATION: "Social_Humiliation",
  ISOLATION: "Social_Isolation",
  PERSECUTION: "Social_Persecution",
} as const

/**
 * Standardized skill categories
 */
export const SKILL_CATEGORIES = {
  // Mental skills
  ANALYSIS: "Mental_Analysis",
  DEDUCTION: "Mental_Deduction",
  INTUITION: "Mental_Intuition",
  MEMORY: "Mental_Memory",

  // Social skills
  INTERROGATION: "Social_Interrogation",
  DECEPTION: "Social_Deception",
  PERSUASION: "Social_Persuasion",
  EMPATHY: "Social_Empathy",

  // Technical skills
  HACKING: "Technical_Hacking",
  ENCRYPTION: "Technical_Encryption",
  SURVEILLANCE: "Technical_Surveillance",

  // Combat skills
  COMBAT: "Combat_Physical",
  STEALTH: "Combat_Stealth",
  ESCAPE: "Combat_Escape",

  // Resistance skills
  INTERROGATION_RESIST: "Resistance_Interrogation",
  PAIN_TOLERANCE: "Resistance_Pain",
  FEAR_RESIST: "Resistance_Fear",
} as const

/**
 * Character status constants
 */
export const CHARACTER_STATUS = {
  ACTIVE: "active",
  INJURED: "injured",
  STRESSED: "stressed",
  UNCONSCIOUS: "unconscious",
  CAPTURED: "captured",
  MISSING: "missing",
  DECEASED: "deceased",
  CONSCIOUSNESS_LOST: "consciousness_lost",
  AI_SIMULATED: "ai_simulated",
} as const

/**
 * Relationship attachment styles
 * Based on attachment theory research
 */
export const ATTACHMENT_STYLES = {
  SECURE: "secure",
  ANXIOUS: "anxious",
  AVOIDANT: "avoidant",
  DISORGANIZED: "disorganized",
} as const

/**
 * Emotion types based on OCC model
 */
export const EMOTION_TYPES = {
  // Positive emotions
  JOY: "joy",
  HOPE: "hope",
  PRIDE: "pride",
  GRATITUDE: "gratitude",
  LOVE: "love",

  // Negative emotions
  ANGER: "anger",
  FEAR: "fear",
  SADNESS: "sadness",
  GUILT: "guilt",
  SHAME: "shame",
  ENVY: "envy",
  HATE: "hate",

  // Surprise emotions
  SURPRISE: "surprise",
  CONFUSION: "confusion",
} as const

/**
 * Goal types
 */
export const GOAL_TYPES = {
  SURVIVAL: "survival",
  INVESTIGATION: "investigation",
  REVENGE: "revenge",
  PROTECTION: "protection",
  ESCAPE: "escape",
  DISCOVERY: "discovery",
  REDEMPTION: "redemption",
  POWER: "power",
  LOVE: "love",
  JUSTICE: "justice",
} as const

/**
 * Memory salience levels
 */
export const SALIENCE_LEVELS = {
  CRITICAL: 1.0, // Defining moment, never forgotten
  HIGH: 0.8, // Major event, long-term memory
  MEDIUM: 0.5, // Notable event, may fade
  LOW: 0.3, // Minor event, likely to fade
  TRIVIAL: 0.1, // Background detail, quickly forgotten
} as const

log.info("novel_types_loaded", {
  traumaTags: Object.keys(TRAUMA_TAGS).length,
  skillCategories: Object.keys(SKILL_CATEGORIES).length,
  emotionTypes: Object.keys(EMOTION_TYPES).length,
})
