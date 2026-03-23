// This file was deleted in a previous commit but is still referenced by calibrate-state.ts
// TODO: Fix calibrate-state.ts to remove this dependency

export const STATE_CALIBRATION_PROMPT = `You are a state calibration assistant.`

// Re-export from state-extraction-prompt for backward compatibility
export { NOVEL_STATE_EXTRACTION_PROMPT, buildStateExtractionPrompt } from "./state-extraction-prompt"