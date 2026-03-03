# MCP Server Registration Guide for OpenCode

This guide explains how to register a local MCP (Model Context Protocol) server with OpenCode.

## Prerequisites

- **OpenCode** installed globally
- **uv** (Python package manager) installed
- Python 3.x with required dependencies (`mcp`, `pydantic`)

### Install uv (if not already installed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Method 1: Interactive CLI (Recommended)

Use the built-in MCP management command:

```bash
opencode mcp add
```

Follow the interactive prompts:

1. **Location**: Choose between:
   - `Current project` - Config stored in `.opencode/opencode.jsonc`
   - `Global` - Config stored in `~/.opencode/opencode.jsonc`

2. **Server name**: Enter a name (e.g., `pcs-audio`)

3. **Type**: Select `local` (for local command-based servers)

4. **Command**: Enter the full command:
   ```
   uv --directory /Users/lpcw/Documents/PCS run mcp_server
   ```

## Method 2: Manual Configuration

### Project-Level Configuration

Create or edit `.opencode/opencode.jsonc` in your project directory:

```jsonc
{
  "mcp": {
    "pcs-audio": {
      "type": "local",
      "command": ["uv", "--directory", "/Users/lpcw/Documents/PCS", "run", "mcp_server"],
      "env": {
        "PYTHONPATH": "/Users/lpcw/Documents/PCS",
      },
    },
  },
}
```

### Global Configuration

Edit `~/.opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "pcs-audio": {
      "type": "local",
      "command": ["uv", "--directory", "/Users/lpcw/Documents/PCS", "run", "mcp_server"],
    },
  },
}
```

## Configuration Options

| Field     | Type                     | Description                                           |
| --------- | ------------------------ | ----------------------------------------------------- |
| `type`    | `"local"` \| `"remote"`  | Server type - use `"local"` for command-based servers |
| `command` | `string[]`               | Command and arguments as an array                     |
| `env`     | `Record<string, string>` | Optional environment variables                        |
| `timeout` | `number`                 | Optional timeout in ms (default: 5000)                |

## Verification Commands

### List all configured MCP servers

```bash
opencode mcp list
```

Example output:

```
✓ pcs-audio connected
    uv --directory /Users/lpcw/Documents/PCS run mcp_server
```

### Debug a specific server

```bash
opencode mcp debug pcs-audio
```

### Check OAuth authentication status (for remote servers)

```bash
opencode mcp auth list
```

## Example: PCS Audio MCP Server

The PCS MCP server provides audio processing tools:

### Available Tools

| Tool                      | Description                                 |
| ------------------------- | ------------------------------------------- |
| `separate_vocals`         | Separate vocals from mixed audio using UVR5 |
| `mute_audio`              | Mute specified regions in audio             |
| `trim_audio`              | Trim audio to specified time range          |
| `remove_harmony`          | Remove harmony using spectral masking       |
| `merge_audio`             | Merge multiple audio files                  |
| `extract_f0`              | Extract high-precision F0                   |
| `build_diffsinger_npz`    | Build DiffSinger training NPZ               |
| `run_vocoder_workflow`    | Full vocoder data prep workflow             |
| `run_diffsinger_workflow` | Full DiffSinger data prep workflow          |
| `get_workflow_status`     | Get workflow processing status              |

### Usage in OpenCode

Once registered, you can use these tools naturally:

> "Use run_vocoder_workflow to process ./raw_songs and output to ./data"

> "Extract F0 from audio.wav using extract_f0 tool"

> "Check workflow status using get_workflow_status"

## Troubleshooting

### Server not connecting

1. Verify `uv` is installed and in PATH:

   ```bash
   uv --version
   ```

2. Test the command manually:

   ```bash
   uv --directory /Users/lpcw/Documents/PCS run mcp_server
   ```

3. Check for Python dependency issues:
   ```bash
   cd /Users/lpcw/Documents/PCS
   uv sync
   ```

### Permission errors

Ensure OpenCode has permission to execute the command and access the directory. You may need to configure permissions in `opencode.jsonc`:

```jsonc
{
  "permission": {
    "bash": {
      "/Users/lpcw/Documents/PCS/**": "allow",
    },
  },
}
```

## Additional Resources

- [OpenCode MCP Documentation](https://opencode.ai/docs/mcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [uv Documentation](https://docs.astral.sh/uv/)
