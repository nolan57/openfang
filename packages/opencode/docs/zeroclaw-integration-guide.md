# ZeroClaw Integration - Configuration Guide

## Quick Start

### 1. Start ZeroClaw

First, start ZeroClaw with HTTP gateway enabled:

```bash
# Using Docker
docker run -d -p 42617:42617 zeroclaw/zeroclaw

# Or from source
cd /Users/lpcw/Documents/zeroclaw
cargo run --release -- daemon
```

### 2. Configure OpenCode

Add ZeroClaw as a provider in your `opencode.json`:

```json
{
  "provider": {
    "zeroclaw": {
      "name": "ZeroClaw",
      "api": "http://localhost:42617/v1",
      "env": [],
      "models": {
        "claude-sonnet-4-6": {
          "id": "claude-sonnet-4-6",
          "name": "Claude Sonnet 4-6",
          "limit": {
            "context": 200000,
            "output": 8192
          },
          "capabilities": {
            "temperature": true,
            "reasoning": true,
            "attachment": true,
            "toolcall": true
          }
        }
      }
    }
  }
}
```

Or use environment variables:

```bash
export ZEROCLAW_URL=http://localhost:42617
export ZEROCLAW_TOKEN=your_token_here
```

### 3. Set Authentication Token

ZeroClaw requires pairing. Get your token:

```bash
# If using file-based auth
cat ~/.zeroclaw/daemon.token
```

## Testing

Test the connection:

```bash
# Test health endpoint
curl http://localhost:42617/health

# Test chat endpoint
curl -X POST http://localhost:42617/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

## Troubleshooting

### "Connection refused"

- Ensure ZeroClaw is running: `curl http://localhost:42617/health`
- Check port: ZeroClaw default is `42617`

### "401 Unauthorized"

- Token required: Get from `~/.zeroclaw/daemon.token`
- Or configure in opencode.json

### "No models found"

- Ensure models are configured in provider section
- Check ZeroClaw logs for available models
