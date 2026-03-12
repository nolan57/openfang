# QQ Bot Plugin - Implementation Guide

This guide provides detailed instructions for installing, configuring, and troubleshooting the enhanced QQ Bot plugin with voice, video, file, and typing indicator support.

## 📦 Dependencies Installation

### 1. Node.js Dependencies

Install the required npm packages:

```bash
cd packages/plugin-qqbot
bun install
```

Or from the repo root:

```bash
bun install --filter=@opencode-ai/plugin-qqbot
```

**Package added:**
- `silk-wasm@^3.3.4` - For SILK voice decoding (no FFmpeg required)

### 2. Python Dependencies (for TTS)

The TTS feature uses `edge-tts`, a Python package that interfaces with Microsoft Edge's TTS service.

**Prerequisites:**
- Python 3.7+ must be installed
- pip (Python package manager)

**Installation:**

```bash
# Windows
pip install edge-tts

# Or if you have multiple Python versions
py -m pip install edge-tts

# Verify installation
edge-tts --help
```

**Troubleshooting edge-tts installation:**

If `edge-tts` command is not found after installation:

1. **Check Python PATH:**
   ```bash
   # Windows - Check if Scripts folder is in PATH
   echo %PATH%
   
   # Add to PATH if missing (adjust version number)
   setx PATH "%PATH%;C:\Users\YourUsername\AppData\Local\Programs\Python\Python311\Scripts"
   ```

2. **Alternative installation using user flag:**
   ```bash
   pip install --user edge-tts
   ```

3. **Verify edge-tts is accessible:**
   ```bash
   edge-tts --version
   ```

## 🔧 Environment Configuration

Create or update your `.env` file in the project root or `packages/plugin-qqbot` directory:

### Required Variables

```bash
# Basic QQ Bot Configuration
QQBOT_ENABLED=true
QQBOT_APP_ID=your_app_id_here
QQBOT_CLIENT_SECRET=your_client_secret_here
QQBOT_DM_POLICY=pairing
QQBOT_GROUP_POLICY=allowlist
QQBOT_ALLOW_FROM=*
```

### Voice Features (STT & TTS)

```bash
# Enable voice message processing
QQBOT_ENABLE_VOICE=true

# TTS voice selection (default: zh-CN-XiaoxiaoNeural)
# Available voices: zh-CN-XiaoxiaoNeural, zh-CN-YunxiNeural, zh-CN-YunjianNeural, etc.
# Full list: https://speech.microsoft.com/portal/voicegallery
QQBOT_TTS_VOICE=zh-CN-XiaoxiaoNeural

# Enable Speech-to-Text (voice message transcription)
QQBOT_ENABLE_STT=true
```

### Video Features

```bash
# Enable video file sending
QQBOT_ENABLE_VIDEO=true
```

### File Features

```bash
# Enable general file sending
QQBOT_ENABLE_FILE=true
```

### Typing Indicator

```bash
# Enable "typing..." indicator when bot is responding
QQBOT_ENABLE_TYPING=true
```

### Complete .env Example

```bash
# QQ Bot Basic Config
QQBOT_ENABLED=true
QQBOT_APP_ID=123456789
QQBOT_CLIENT_SECRET=your_secret_here
QQBOT_DM_POLICY=pairing
QQBOT_GROUP_POLICY=allowlist
QQBOT_ALLOW_FROM=*
QQBOT_RESPONSE_MODE=streaming
QQBOT_STREAMING_DELAY_MS=300

# Voice Features
QQBOT_ENABLE_VOICE=true
QQBOT_TTS_VOICE=zh-CN-XiaoxiaoNeural
QQBOT_ENABLE_STT=true

# Video & File Features
QQBOT_ENABLE_VIDEO=true
QQBOT_ENABLE_FILE=true

# Typing Indicator
QQBOT_ENABLE_TYPING=true

# Optional: Sandbox mode for testing
QQBOT_SANDBOX=false
```

## 📝 Usage Examples

### Sending Voice Messages

The AI can send voice messages using the `<qqvoice>` tag:

```
<qqvoice text="Hello, this is a voice message!" />
```

Or the tag can be self-closing with text attribute:

```
<qqvoice text="这是语音消息" />
```

### Sending Video Messages

```
<qqvideo src="path/to/video.mp4" type="video" />
<qqvideo src="https://example.com/video.mp4" type="video" />
<qqvideo src="data:video/mp4;base64,..." type="video" />
```

Supported types: `image`, `video`, `file`

### Sending Files

```
<qqfile src="path/to/document.pdf" filename="Report.pdf" />
<qqfile src="https://example.com/file.zip" filename="Archive.zip" />
<qqfile src="data:application/pdf;base64,..." filename="doc.pdf" />
```

Supported file types: pdf, doc, docx, xls, xlsx, ppt, pptx, zip, rar, txt, md, json, xml, csv, and more.

### Receiving Voice Messages

When a user sends a voice message:
1. The bot downloads the SILK-format voice file
2. Decodes it to WAV using `silk-wasm`
3. Passes the WAV file to the AI model for transcription/processing
4. If decoding fails, responds with: "[Received voice message but unable to transcribe]"

## 🔍 Feature Verification

### Test TTS (Text-to-Speech)

```bash
# Test edge-tts directly
edge-tts --text "Hello, this is a test" --write-media test.mp3 --voice zh-CN-XiaoxiaoNeural

# Play the file to verify
# Windows
start test.mp3
```

### Test STT (Speech-to-Text)

1. Send a voice message to the bot in a private chat
2. Check the bot logs for:
   - `[qqbot] DM from ...`
   - SILK download and decoding messages
3. The bot should process the transcribed audio

### Test Typing Indicator

1. Send a message to the bot
2. You should see "对方正在输入..." (typing indicator) before the bot responds
3. If not visible, check logs for typing indicator errors

## ⚠️ Common Issues & Solutions

### 1. edge-tts Command Not Found

**Error:** `Failed to run edge-tts: spawn cmd.exe ENOENT`

**Solutions:**
- Ensure Python Scripts folder is in PATH
- Restart terminal after adding to PATH
- Use full path: `C:\Users\Username\AppData\Local\Programs\Python\Python311\Scripts\edge-tts.exe`
- Try reinstalling: `pip uninstall edge-tts && pip install edge-tts`

### 2. TTS Timeout

**Error:** `edge-tts timeout after 60s`

**Solutions:**
- Check internet connection (edge-tts requires online access)
- Reduce message length (split long texts)
- Try a different voice model

### 3. SILK Decoding Fails

**Error:** `Failed to decode SILK voice`

**Solutions:**
- Ensure `silk-wasm` is installed: `bun list silk-wasm`
- Check if voice file is valid SILK format
- Verify temp directory is writable

### 4. Media Upload Fails

**Error:** `Failed to upload media: 403`

**Solutions:**
- Verify bot has media upload permissions
- Check file size limits (QQ has restrictions)
- Ensure file format is supported by QQ

### 5. Typing Indicator Not Showing

**Solutions:**
- Verify `QQBOT_ENABLE_TYPING=true`
- Check QQ Bot API permissions for typing endpoint
- Some chat types (e.g., some group types) may not support typing indicators

## 🧹 Temporary File Management

The plugin automatically manages temporary files:

- **Location:** System temp directory (`Bun.tempdir()`)
- **Subdirectories:**
  - `qqbot-media/` - For generated media (TTS MP3 files)
  - `qqbot-voice/` - For received voice processing (SILK → WAV)
- **Cleanup:** Files are deleted immediately after use
- **Manual cleanup (if needed):**
  ```bash
  # Windows
  del /Q /S %TEMP%\qqbot-*
  
  # Linux/Mac
  rm -rf /tmp/qqbot-*
  ```

## 📊 Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `QQBOT_ENABLE_VOICE` | `false` | Enable TTS voice message generation |
| `QQBOT_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | TTS voice model to use |
| `QQBOT_ENABLE_STT` | `true` | Enable speech-to-text for received voice |
| `QQBOT_ENABLE_VIDEO` | `false` | Enable video file sending |
| `QQBOT_ENABLE_FILE` | `false` | Enable general file sending |
| `QQBOT_ENABLE_TYPING` | `false` | Enable typing indicator |

## 🚀 Build & Deploy

```bash
# Build the plugin
cd packages/plugin-qqbot
bun run build

# Type check
bun run typecheck
```

## 📚 Available Voices for TTS

Common Chinese voices:
- `zh-CN-XiaoxiaoNeural` (Female, warm)
- `zh-CN-YunxiNeural` (Male, calm)
- `zh-CN-YunjianNeural` (Male, energetic)
- `zh-CN-XiaoyiNeural` (Female, gentle)
- `zh-CN-YunyangNeural` (Male, professional)

Full list: [Microsoft Speech Voice Gallery](https://speech.microsoft.com/portal/voicegallery)

## 🔐 Security Notes

1. **Never commit `.env` file** - Add to `.gitignore`
2. **Rotate credentials regularly** - Update `QQBOT_CLIENT_SECRET` periodically
3. **Use allowlists** - Set `QQBOT_ALLOW_FROM` to specific user/group IDs
4. **Enable sandbox for testing** - Use `QQBOT_SANDBOX=true` in development

## 📞 Support

For issues related to:
- **QQ Bot API:** Check [QQ Bot Documentation](https://bot.q.qq.com/wiki/)
- **edge-tts:** Check [edge-tts GitHub](https://github.com/rany2/edge-tts)
- **silk-wasm:** Check [silk-wasm npm](https://www.npmjs.com/package/silk-wasm)
- **Plugin issues:** Check project's issue tracker
