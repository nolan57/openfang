// ============================================================================
// VISUAL CONFIG PUBLIC API
// ============================================================================

export {
  // Core config loading
  loadVisualConfig,
  getVisualConfig,
  clearConfigCache,
  reloadVisualConfig,

  // Convenience helpers (used by visual-translator.ts and visual-prompt-engineer.ts)
  getEmotionVisual,
  getActionMapping,
  getLightingPreset,
  getStyleModifiers,
  isComplexEmotion,
  isComplexAction,

  // Types
  type VisualConfig,
  type EmotionVisual,
  type ActionMapping,
} from "./config-loader"
