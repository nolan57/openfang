# Automatic Skill Generation Disabled

## Summary

Automatic skill generation has been **successfully disabled** to prevent the creation of low-quality auto-generated skills.

## Changes Made

### 1. Configuration Schema (`src/config/config.ts`)

Added new `disableSkillGeneration` field to evolution config:

```typescript
evolution: z.object({
  // ... existing fields
  disableSkillGeneration: z
    .boolean()
    .optional()
    .default(true)
    .describe("Disable automatic skill generation (recommended: true)"),
})
```

**Default value**: `true` (disabled by default)

### 2. Learning Config (`src/learning/config.ts`)

Updated default config:

```typescript
export const defaultLearningConfig: LearningConfig = {
  // ... existing fields
  disableSkillGeneration: true, // Explicitly disabled
}
```

### 3. Analyzer Logic (`src/learning/analyzer.ts`)

Modified action determination to respect the config:

```typescript
private async determineAction(score: number, config: LearningConfig) {
  // Check if skill generation is disabled
  if (config.disableSkillGeneration) {
    log.info("skill_generation_disabled", { score })
    return "note_only" // Always use note_only instead of install_skill
  }

  if (score >= 80) return "install_skill"
  if (score >= 60) return "code_suggestion"
  return "note_only"
}
```

### 4. User Configuration (`~/.local/share/opencode/config/opencode.json`)

Updated user config:

```json
{
  "evolution": {
    "enabled": true,
    "directions": ["AI", "code generation", "agent systems"],
    "sources": ["search", "arxiv", "github", "pypi", "blogs"],
    "exaApiKey": "f89ef302-9553-40c7-9715-6d6d66c33d16",
    "disableSkillGeneration": true
  }
}
```

---

## Behavior Changes

### Before (❌ Auto-generation Enabled)

1. Evolution collects items from web
2. Analyzer scores items (arxiv +20, github +15, etc.)
3. Items with score ≥ 80 → `install_skill` action
4. **Result**: Low-quality auto-generated skills created

**Problems identified**:

- Skills were session transcripts, not reusable logic
- Trigger patterns were malformed (concatenated strings)
- Actions were generic templates, not specific steps
- High duplication (same session → multiple similar skills)

### After (✅ Auto-generation Disabled)

1. Evolution collects items from web
2. Analyzer scores items (same scoring)
3. **ALL items** → `note_only` action (regardless of score)
4. **Result**: Only learning notes created, no skills

**Benefits**:

- No more low-quality auto-generated skills
- Cleaner skill directory
- Manual skill creation encouraged
- Better signal-to-noise ratio

---

## Manual Skill Creation (Recommended)

Instead of auto-generation, create skills manually:

### Example: High-Quality Skill

```json
{
  "name": "fix-mcp-connection-errors",
  "description": "Diagnose and fix MCP server connection issues",
  "triggerPatterns": ["MCP error -32000", "server failed to connect"],
  "actions": [
    "Check server executable path in opencode.json",
    "Verify dependencies are installed (npm list)",
    "Test server manually: <command>",
    "Check server logs: <log_path>",
    "Restart server with: <command>"
  ]
}
```

### Skill Creation Guidelines

**Good skills have**:

- ✅ Clear, specific trigger patterns
- ✅ Concrete action steps
- ✅ Reusable logic (not session-specific)
- ✅ Concise description (1-2 sentences)

**Bad skills have**:

- ❌ Malformed triggers (concatenated paths)
- ❌ Generic actions ("analyze, execute, verify")
- ❌ Session transcripts as content
- ❌ Overly long descriptions

---

## Re-enabling Auto-Generation (Not Recommended)

If you want to re-enable automatic skill generation:

```bash
# Update config
cat ~/.local/share/opencode/config/opencode.json | \
  jq '.evolution.disableSkillGeneration = false' | \
  sponge ~/.local/share/opencode/config/opencode.json
```

**Warning**: This will likely create low-quality skills again. Only enable if you've implemented better skill extraction logic.

---

## Impact Assessment

| Aspect         | Before               | After                  |
| -------------- | -------------------- | ---------------------- |
| Skills per run | 5-10 auto-generated  | 0                      |
| Skill quality  | 2-3/10               | N/A (manual only)      |
| Storage        | Growing (~15KB/run)  | Minimal                |
| Maintenance    | High (review/delete) | Low (manual creation)  |
| Usefulness     | None (all draft)     | High (manual curation) |

---

## Files Modified

1. `src/config/config.ts` - Added schema field
2. `src/learning/config.ts` - Updated default config
3. `src/learning/analyzer.ts` - Modified action determination
4. `~/.local/share/opencode/config/opencode.json` - User config

---

## Next Steps

1. ✅ **Done**: Disable auto-generation
2. ✅ **Done**: Clear existing low-quality skills
3. 📝 **Todo**: Create 3-5 high-value manual skills
4. 🔧 **Future**: Improve skill extraction algorithm (optional)
5. 📊 **Monitor**: Track evolution runs without skill noise

---

## Verification

Test the fix:

```bash
# Run evolution
bun run src/index.ts evolve

# Check skills (should be 0)
cat ~/.local/share/opencode/config/opencode.json | jq '.skills'
cat packages/opencode/.opencode/evolution/skills.json | jq 'length'

# Should output: 0
```

---

**Status**: ✅ Automatic skill generation successfully disabled.

**Date**: 2026-03-25

**Reason**: Prevent creation of low-quality auto-generated skills that provide no value.
