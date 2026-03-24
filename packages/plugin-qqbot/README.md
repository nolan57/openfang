# @opencode-ai/plugin-qqbot (DEPRECATED)

⚠️ **This package is deprecated and has been merged into [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin).**

## Migration

Please migrate to the new location:

```bash
# Old (deprecated)
npm install @opencode-ai/plugin-qqbot

# New (recommended)
npm install @opencode-ai/plugin@^1.2.11
```

### Usage Changes

**Before:**
```typescript
import QQBotPlugin from "@opencode-ai/plugin-qqbot"
```

**After:**
```typescript
import { QQBotPlugin } from "@opencode-ai/plugin/providers/qqbot"
// or
import { QQBotPlugin } from "@opencode-ai/plugin"
```

### Configuration

Configuration remains the same. The QQ Bot provider is now built into the main plugin package.

## Why Was This Merged?

- Simplified dependency management
- Unified versioning
- Better integration with core plugin SDK
- Easier maintenance and updates

## Support

For issues or questions, please refer to the main [OpenCode repository](https://github.com/nolan57/opencodeclaw).

---

**Package Status:** Deprecated  
**Merged Into:** `@opencode-ai/plugin@1.2.11`  
**Migration Guide:** See [INTEGRATION_PLAN.md](../plugin/INTEGRATION_PLAN.md)
