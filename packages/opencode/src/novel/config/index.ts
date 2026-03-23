// ============================================================================
// VISUAL CONFIG PUBLIC API
// ============================================================================
//
// This module provides the public API for visual configuration.
// Business logic should ONLY use resolveVisualSpec() - all other functions
// are internal implementation details.
// ============================================================================

export {
  // Core config loading (use sparingly - mostly for initialization)
  loadVisualConfig,
  getVisualConfig,
  clearConfigCache,
  reloadVisualConfig,

  // ✅ CORE VISUAL RESOLVER (business layer's main interface)
  resolveVisualSpec,

  // ✅ Internal helpers (still needed by visual-translator.ts and visual-prompt-engineer.ts)
  // These are used by the visual subsystem and should remain exported
  getEmotionVisual,
  getActionMapping,
  getLightingPreset,
  getStyleModifiers,
  isComplexEmotion,
  isComplexAction,

  // Types for visual context and resolved spec
  type VisualConfig,
  type VisualContext,
  type ResolvedVisualSpec,
  type EmotionVisual,
  type ActionMapping,
  type CameraSpec,
  type StrategyOverride,
  type StrategyOverrideEffects,
  type ThematicMapping,
} from "./config-loader"

// ============================================================================
// DEPRECATED (Internal use only - do not export in future versions)
// ============================================================================
// The following are now internal implementation details but still used by:
// - visual-translator.ts (getEmotionVisual, getActionMapping, getLightingPreset, getStyleModifiers)
// - visual-prompt-engineer.ts (isComplexEmotion, isComplexAction)
//
// TODO: Refactor visual subsystem to use resolveVisualSpec() instead
// ============================================================================
