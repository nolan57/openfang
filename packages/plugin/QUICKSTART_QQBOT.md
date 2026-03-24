# QQBot Quick Start Guide

## 5-Minute Quick Start

### Step 1: Set Environment Variables

```bash
# Create .env file (in project root or globally)
cat > ~/.local/share/opencode/config/.env << EOF
QQBOT_ENABLED=true
QQBOT_APP_ID=YOUR_APP_ID
QQBOT_CLIENT_SECRET=YOUR_CLIENT_SECRET
EOF
```

Or set directly in shell:

```bash
export QQBOT_ENABLED=true
export QQBOT_APP_ID=YOUR_APP_ID
export QQBOT_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

### Step 2: Start OpenCode

```bash
opencode
```

### Step 3: Verify QQBot is Loaded

Check startup logs, you should see:

```
[plugin] loading conditional plugin { name: "qqbot" }
[qqbot] Starting QQ Bot...
[qqbot] Getting access token...
[qqbot] Connected to QQ Gateway
```

---

## Complete Configuration Options

### Basic Configuration

```bash
# Required
QQBOT_ENABLED=true
QQBOT_APP_ID=123456789
QQBOT_CLIENT_SECRET=your_secret

# Access Control (Optional)
QQBOT_DM_POLICY=pairing          # pairing | allowlist | open | disabled
QQBOT_GROUP_POLICY=allowlist     # pairing | allowlist | open | disabled
QQBOT_ALLOW_FROM=*               # Comma-separated user/group ID list
```

### Feature Configuration

```bash
# Voice Features
QQBOT_ENABLE_VOICE=true
QQBOT_TTS_VOICE=zh-CN-XiaoxiaoNeural
QQBOT_ENABLE_STT=true

# Media Features
QQBOT_ENABLE_VIDEO=true
QQBOT_ENABLE_FILE=true

# Experience Optimization
QQBOT_ENABLE_TYPING=true         # Show "typing..." indicator
QQBOT_RESPONSE_MODE=streaming    # streaming | blocking
QQBOT_STREAMING_DELAY_MS=300     # Streaming response delay (ms)
```

### Advanced Configuration

```bash
# Sandbox Mode (for testing)
QQBOT_SANDBOX=false

# Reconnection Configuration
QQBOT_MAX_RECONNECT_ATTEMPTS=10

# Message Chunking
QQBOT_MAX_CHUNK_SIZE=1500
```

---

## Usage Examples

### QQ Bot Commands

Send these commands in QQ:

```
#new              # Create new session
#new help me code # Create new session and start task
#switch <session-id>  # Switch session
#list             # List sessions
#clear            # Clear current session
#abort            # Abort current response
#send user:123 hello  # Send message to specified user
```

### Sending Media Messages

**Voice Messages:**
```
<qqvoice text="Hello, this is a voice message" />
```

**Video Messages:**
```
<qqvideo src="path/to/video.mp4" />
<qqvideo src="https://example.com/video.mp4" />
```

**File Messages:**
```
<qqfile src="path/to/document.pdf" filename="Document.pdf" />
```

---

## Troubleshooting

### Problem 1: QQBot Not Starting

**Check environment variables:**
```bash
echo $QQBOT_ENABLED  # Should output: true
```

**Check logs:**
```bash
cat <project>/.qqbot/logs/qqbot.log
```

### Problem 2: Authentication Failure

**Verify credentials:**
```bash
# Check if APP_ID is numeric
echo $QQBOT_APP_ID

# Check if CLIENT_SECRET is correct
echo $QQBOT_CLIENT_SECRET | head -c 10
```

**Regenerate credentials:**
Visit [QQ Bot Developer Platform](https://bot.q.qq.com/) to regenerate.

### Problem 3: Messages Cannot Be Sent

**Check access control:**
```bash
# If in allowlist mode, ensure user ID is in allowed list
echo $QQBOT_ALLOW_FROM
```

**Check network connection:**
```bash
curl https://api.sgroup.qq.com
```

---

## Getting QQ Bot Credentials

### 1. Register QQ Bot

1. Visit https://bot.q.qq.com/
2. Log in to QQ developer account
3. Create bot application

### 2. Get APP_ID and CLIENT_SECRET

1. Go to application management page
2. Click "Credentials Management"
3. Copy `APPID` and `Secret`

### 3. Configure Bot Permissions

Ensure the following permissions are enabled:
- User message reception
- Group message reception
- Channel message reception
- Message sending

---

## Testing

### Test Message Reception

1. Send a message to the bot in QQ
2. Check logs:
   ```bash
   tail -f <project>/.qqbot/logs/qqbot.log
   ```
3. You should see:
   ```
   [qqbot] DM from user_xxx
   [qqbot] Processing: hello
   ```

### Test Voice Messages

1. Send a voice message to the bot
2. The bot should reply with transcribed text
3. If TTS is enabled, the bot can reply with voice

---

## Advanced Usage

### Multi-Project Configuration

Use different QQ Bot configurations in different projects:

```bash
# Project A - Customer Service Bot
cd project-a
cat > .env << EOF
QQBOT_ENABLED=true
QQBOT_APP_ID=customer_service_id
QQBOT_CLIENT_SECRET=customer_service_secret
QQBOT_DM_POLICY=allowlist
QQBOT_ALLOW_FROM=vip_user_1,vip_user_2
EOF

# Project B - Personal Assistant
cd project-b
cat > .env << EOF
QQBOT_ENABLED=true
QQBOT_APP_ID=personal_assistant_id
QQBOT_CLIENT_SECRET=personal_assistant_secret
QQBOT_DM_POLICY=open
EOF
```

### Disable QQBot

Temporarily disable QQBot:

```bash
# Method 1: Set environment variable to false
export QQBOT_ENABLED=false

# Method 2: Remove environment variable
unset QQBOT_ENABLED

# Method 3: Project-level disable (in .env)
QQBOT_ENABLED=false
```

---

## Resources

- [Complete Usage Guide](./src/providers/qqbot/USAGE.md)
- [Loading Mechanism](./QQBOT_LOADING.md)
- [Migration Guide](./MIGRATION_COMPLETE.md)
- [QQ Bot Official Documentation](https://bot.q.qq.com/wiki/)

---

## FAQ

**Q: Can I use it in Docker?**
A: Yes, just set the same environment variables in Docker.

**Q: Does it support multiple QQ accounts?**
A: The current version only supports single account. Multi-account support is in development.

**Q: How to check QQBot version?**
A: QQBot is now integrated in `@opencode-ai/plugin@1.2.11`, no independent version number.

**Q: How to update QQBot?**
A: Just update the `@opencode-ai/plugin` package:
```bash
bun add @opencode-ai/plugin@latest
```
