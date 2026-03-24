# QQBot Loading Mechanism

## Loading Methods After Integration

### Old Method (Deprecated) ❌

Load explicitly through configuration file:

```json
{
  "plugin": [
    "/path/to/packages/plugin-qqbot/dist/index.js"
  ]
}
```

### New Method (Recommended) ✅

Load automatically via environment variables, **no configuration file modification needed**:

```bash
# Set environment variables
export QQBOT_ENABLED=true
export QQBOT_APP_ID=your_app_id
export QQBOT_CLIENT_SECRET=your_secret

# Start opencode
opencode
```

QQBot will automatically detect the `QQBOT_ENABLED` environment variable at startup and load if set to `true`.

---

## Implementation Principles

### 1. Conditional Loading Mechanism

In `packages/opencode/src/plugin/index.ts`:

```typescript
// Conditionally loaded plugins
async function getConditionalPlugins(): Promise<PluginInstance[]> {
  const plugins: PluginInstance[] = []

  // Load QQBot if enabled via environment variable
  if (Bun.env.QQBOT_ENABLED === "true") {
    plugins.push(QQBotPlugin)
  }

  return plugins
}
```

### 2. Loading Flow

```
opencode startup
    ↓
Load built-in plugins (CodexAuth, CopilotAuth, GitlabAuth)
    ↓
Load conditional plugins (check QQBOT_ENABLED)
    ├─ true  → Load QQBotPlugin
    └─ false → Skip
    ↓
Load plugins from configuration file (opencode.json plugin array)
```

---

## Configuration Methods

### Method 1: Environment Variables (Recommended)

Create `.env` file or set system environment variables:

```bash
# .env file
QQBOT_ENABLED=true
QQBOT_APP_ID=123456789
QQBOT_CLIENT_SECRET=your_secret_here
QQBOT_DM_POLICY=pairing
QQBOT_GROUP_POLICY=allowlist
QQBOT_ALLOW_FROM=*
QQBOT_RESPONSE_MODE=streaming
QQBOT_ENABLE_VOICE=true
QQBOT_ENABLE_STT=true
QQBOT_ENABLE_TYPING=true
```

### Method 2: Export Environment Variables Directly

```bash
# ~/.bashrc or ~/.zshrc
export QQBOT_ENABLED=true
export QQBOT_APP_ID=123456789
export QQBOT_CLIENT_SECRET=your_secret
```

### Method 3: Specify at Startup

```bash
QQBOT_ENABLED=true QQBOT_APP_ID=xxx QQBOT_CLIENT_SECRET=xxx opencode
```

---

## Complete Configuration Example

### Global Configuration (`~/.local/share/opencode/config/opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": { "*": "allow" },
    "edit": "allow"
  }
  // No longer need "plugin" array to configure QQBot
}
```

### Project Configuration (`opencode.jsonc`)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // Optional: Project-level QQBot configuration
  // Note: Actual configuration is still controlled via environment variables
}
```

---

## Migration Steps

### 1. Update Global Configuration

Remove old plugin-qqbot reference:

```bash
# Edit configuration file
nano ~/.local/share/opencode/config/opencode.json

# Delete or comment out:
# "plugin": ["/path/to/plugin-qqbot/dist/index.js"]
```

### 2. Set Environment Variables

Create or edit `~/.bashrc` / `~/.zshrc` / `.env`:

```bash
export QQBOT_ENABLED=true
export QQBOT_APP_ID=your_app_id
export QQBOT_CLIENT_SECRET=your_secret
```

### 3. Restart opencode

```bash
# Ensure environment variables take effect
source ~/.bashrc  # or ~/.zshrc

# Start opencode
opencode
```

### 4. Verify Loading

Check logs, you should see:

```
[plugin] loading conditional plugin { name: "qqbot" }
[qqbot] Starting QQ Bot...
[qqbot] Connected
```

---

## Troubleshooting

### QQBot Not Loading

**Check environment variables:**

```bash
echo $QQBOT_ENABLED  # Should output: true
```

**Check logs:**

```bash
# Check startup logs, should see:
# "loading conditional plugin" - indicates loading attempt
# Or no related logs - indicates QQBOT_ENABLED is not true
```

### Configuration Not Taking Effect

**Confirm environment variable location:**

- Global: `~/.bashrc`, `~/.zshrc`, `/etc/environment`
- Project: `.env` file (in project root directory)
- Session: `export QQBOT_ENABLED=true`

**Check variable value:**

```bash
# Must be string "true", not "1" or "yes"
echo $QQBOT_ENABLED  # Output: true
```

### Authentication Failure

**Check credentials:**

```bash
# Verify APP_ID and CLIENT_SECRET
echo $QQBOT_APP_ID
echo $QQBOT_CLIENT_SECRET
```

**Check QQ Bot logs:**

Log location: `<project>/.qqbot/logs/qqbot.log`

---

## Advanced Configuration

### Multi-Account Support (Future)

Currently only supports single account. Future support may include:

```bash
# Multiple QQ Bot accounts
QQBOT_ACCOUNTS=default,bot2
QQBOT_DEFAULT_APP_ID=xxx
QQBOT_DEFAULT_CLIENT_SECRET=xxx
QQBOT_BOT2_APP_ID=yyy
QQBOT_BOT2_CLIENT_SECRET=yyy
```

### Project-Level Enable/Disable

Override global settings in project `.env`:

```bash
# Project-level disable QQBot
QQBOT_ENABLED=false
```

---

## Technical Details

### Import Path

```typescript
// opencode/src/plugin/index.ts
import { QQBotPlugin } from "@opencode-ai/plugin/providers/qqbot"
```

### Plugin Registration

```typescript
// Conditional plugin list
const conditionalPlugins = await getConditionalPlugins()

// Loading loop
for (const plugin of conditionalPlugins) {
  const init = await plugin(input)
  if (init) hooks.push(init)
}
```

### Hook Registration

QQBot registers hooks:
- `plugin.status` - Status report
- `plugin.restart` - Restart logic

---

## Summary

| Feature | Old Method | New Method |
|---------|------------|------------|
| Configuration Location | opencode.json | Environment Variables |
| Enable Method | plugin array | QQBOT_ENABLED=true |
| Multi-Project Support | Configure each project | Global + Project override |
| Hot Reload | Requires restart | Requires restart |
| Flexibility | Low | High |

**Recommended Practice:**
- Use environment variables for control
- Global configuration in `~/.bashrc` or `~/.zshrc`
- Project-level override in project `.env` file
