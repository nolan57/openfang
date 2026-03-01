<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent - Enhanced with self-evolving capabilities.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

---

## Features

### Core AI Coding Agent

- **Powerful CLI** - Full-featured terminal-based AI coding assistant
- **Multiple Agents** - Switch between `build` (full-access) and `plan` (read-only) agents
- **Model Agnostic** - Works with Claude, OpenAI, Google, Anthropic, Azure, Amazon Bedrock, or local models
- **Client/Server Architecture** - Run the agent remotely while controlling from different clients

### Plugin System

Extensible plugin architecture for integrating various communication platforms:

- **QQ Bot** - Tencent QQ messaging platform integration
- **Slack** - Slack workspace integration
- **iMessage** - macOS iMessage support
- **Custom Plugins** - Build your own plugins using the Plugin SDK

### Self-Evolving Agent

- **Permanent Memory** - Agents remember context across sessions
- **Pattern Learning** - Automatic learning from recurring patterns
- **Skill System** - Develop and retain new skills over time
- **Evolution Engine** - Continuous improvement through interaction history

### Scheduler

- **Cron Jobs** - Built-in scheduled task execution
- **Event-Driven** - Trigger actions based on system events
- **Plugin Integration** - Schedule messages and automation

### User Interfaces

- **Terminal UI (TUI)** - Rich terminal interface with sessions, sidebar, and info panels
- **Desktop App** - Native desktop application (macOS, Windows, Linux)
- **Web Interface** - Browser-based access
- **Console App** - Server management console

---

## Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended)
brew install opencode              # macOS and Linux
sudo pacman -S opencode            # Arch Linux
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest
```

### Desktop App

Download from [releases page](https://github.com/anomalyco/opencode/releases):

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS
brew install --cask opencode-desktop
# Windows
scoop bucket add extras; scoop install extras/opencode-desktop
```

---

## Project Structure

```
packages/
├── opencode/           # Core CLI application
├── plugin/             # Plugin SDK and system
├── plugin-qqbot/      # QQ Bot plugin
├── slack/              # Slack integration
├── desktop/            # Desktop application
├── web/                # Web interface
├── console/            # Console app system
├── app/                # Main application
├── enterprise/         # Enterprise features
├── ui/                 # Shared UI components
├── sdk/                # Client SDK
├── util/               # Utilities
├── function/           # Serverless functions
├── script/             # Scripts
└── docs/               # Documentation
```

---

## Configuration

OpenCode uses `opencode.json` for configuration:

```json
{
  "model": "claude-sonnet-4-20250514",
  "agent": "build",
  "plugin": ["@opencode-ai/plugin-qqbot"],
  "allow": ["**/*"],
  "deny": []
}
```

Environment variables can also be used for plugin configuration:

```bash
# QQ Bot
QQBOT_ENABLED=true
QQBOT_APP_ID=your-app-id
QQBOT_CLIENT_SECRET=your-secret

# Scheduler
SCHEDULER_ENABLED=true
```

---

## Documentation

For more details, see the [docs](./docs/) directory:

- [Memory System](./docs/memory-system-comparison.md)
- [Permanent Memory System](./docs/permanent-memory-system.md)
- [TUI Design](./docs/tui-design.md)

---

## Building from Source

```bash
# Install dependencies
bun install

# Build
bun run build

# Development
bun run dev
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

---

## FAQ

### How is this different from the original OpenCode?

This is an enhanced fork with:

- **Plugin System** - Extensible architecture for third-party integrations
- **Self-Evolving Memory** - Agents that learn and improve over time
- **Built-in Scheduler** - Cron job support for automation
- **Multiple Interfaces** - TUI, Desktop, Web, Console apps

### What models are supported?

OpenCode supports multiple providers:

- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Azure OpenAI
- Amazon Bedrock
- Local models via compatible APIs

---

**Community**: [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
