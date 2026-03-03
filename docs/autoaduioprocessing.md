# Audio Processing Automation and AI Programming Assistant Integration Guide (2026 Edition)

## Core Vision and Feasibility

**Goal**: Leverage audio processing code from local Git repositories, using AI programming assistants to fully automate training data generation (vocoder/singer models).

**Conclusion**: Fully feasible.

**Core Pattern**: AI acts as "commander" and "code generator", generating local scripts that call existing Git library functions, rather than running heavy audio processing logic directly within the AI.

**Workflow**: AI reads codebase -> generates orchestration scripts (Agent/Skill) -> executes scripts in local environment -> produces training data.

## Concept Architecture Correction

To avoid over-engineering, clarify the following concepts' definitions in practical implementation:

| Concept | Definition | Practical Implementation Suggestion |
|---------|------------|-----------------------------------|
| **Tool** | Atomic execution unit (function/API). | Corresponds to individual functions in Git libraries (e.g., load_audio, extract_mel). Needs clear type hints and documentation. |
| **Skill** | Combination of tools + logic + state. | Encapsulated workflows (e.g., "high-quality vocal extraction": load -> denoise -> judge -> slice -> save). Exposed as composite Tool in MCP. |
| **Agent** | Task planner and scheduler. | Modern AI assistants (Cursor/Claude) are Agents themselves. No need to write additional schedulers; AI automatically plans call sequences. |
| **MCP** | Connection protocol (Model Context Protocol). | Connection line/socket. Used to standardize exposure of tools and skills, allowing AI to "see" and safely call local code. |

**Key Correction**: Don't build complex "skill management layers" or standalone "agent servers". Directly encapsulate skills as composite tools in MCP Server, letting AI Client dispatch directly.

## Recommended Tech Stack (AI-Native Stack)

Build tools suitable for AI invocation following these technology combinations:

### 3.1 Interaction Layer
- **MCP (Model Context Protocol)**: ⭐ Preferred. Standard protocol, supports Resources/Tools/Prompts.
- **Python Type Hints + Pydantic**: Ensures AI accurately understands function signatures and data structures, reducing runtime errors.
- **FastAPI (Local)**: Optional, for isolating heavy logic into local HTTP services.

### 3.2 Execution & Environment Layer
- **UV**: Ultra-fast Python package management and script execution (`uv run`), suitable for AI generating temporary scripts and running them immediately.
- **Docker / Podman**: Isolate audio processing dependencies (CUDA, FFmpeg), prevent environment pollution.
- **Aider / Cursor**: Core AI programming assistants, with Git awareness and full-library indexing capabilities.

### 3.3 Data & State Layer
- **SQLite + SQLModel**: Single-file database, records processing progress and failure logs. AI excels at SQL queries for resume-from-breakpoint functionality.
- **JSONL**: Streaming storage for Manifest files, easy to append and parse.

### 3.4 Orchestration & Feedback Layer
- **Rich / TQDM**: Provides structured logs and progress bars,便于 AI parsing output for self-correction.
- **Prefect (Lightweight)**: Only introduce when complex retry mechanisms and distributed scaling are needed.

## Implementation Roadmap

### Step 1: Environment Preparation
Create isolated environment with uv and install dependencies:
```bash
uv venv .venv
uv pip install -e ./vocoder-lib
uv pip install -e ./data-prep-lib
uv pip install mcp torch torchaudio librosa
```

### Step 2: Build MCP Server (Core Bridge)
Write `audio_mcp_server.py`, wrapping Git library functions as MCP tools:

```python
from mcp.server.fastmcp import FastMCP
import my_audio_lib  # Your local Git library

mcp = FastMCP("Audio Processor")

@mcp.tool()
def extract_features(audio_path: str, output_dir: str) -> str:
    """Extract mel spectrum and F0 features. Returns error message if file is corrupted."""
    try:
        wav = my_audio_lib.load(audio_path)
        mel, f0 = my_audio_lib.extract_mel_f0(wav)
        my_audio_lib.save(mel, f0, output_dir)
        return f"Success: {audio_path}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def batch_process_workflow(folder_path: str) -> dict:
    """
    [Skill] Batch process folder: iterate -> clean -> extract -> record status.
    Includes auto-skip already processed files and error retry logic.
    """
    # Internally calls multiple atomic tools, contains business logic judgment
    stats = {"success": 0, "failed": 0}
    # ... implementation logic ...
    return stats

if __name__ == "__main__":
    mcp.run()
```

### Step 3: Configure AI Client
Add MCP Server to Cursor or Claude Desktop configuration file:
```json
{
  "mcpServers": {
    "audio-processor": {
      "command": "uv",
      "args": ["run", "audio_mcp_server.py"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Step 4: Natural Language-Driven Automation
Directly command in AI dialog:
"Use batch_process_workflow tool to process ./raw_songs directory. If errors occur, log to error_log.sqlite and continue. After processing, generate manifest.jsonl."

AI will automatically:
1. Identify available MCP tools.
2. Plan execution steps.
3. Call tools and monitor output.
4. Automatically handle exceptions based on logs (e.g., retry or skip).

## Key Best Practices

- **Type Safety First**: All functions exposed to AI must have strict Type Hints and Pydantic models.
- **Stateless Tools, Stateful Skills**: Atomic tools should remain stateless; complex logic (like resume-from-breakpoint) encapsulated inside "Skill" tools.
- **Environment Isolation**: Always run MCP Server via `uv run` or Docker to avoid dependency conflicts.
- **Structured Logging**: Tool output should be JSON or clear text,便于 AI parsing for "reflection" and "error correction".
- **Minimal Encapsulation**: Don't architect for architecture's sake. Simple scripts + MCP are often more efficient than complex Agent frameworks.

## Common Tools Checklist

| Category | Recommended Tools | Purpose |
|----------|-------------------|---------|
| AI Client | Cursor, Claude Desktop, Open Interpreter | As Agent brain, calls MCP tools |
| MCP SDK | mcp (Python), @modelcontextprotocol/sdk (TS) | Build MCP Server |
| Package Management | UV | Fast environment management and script execution |
| Containerization | Docker | Complex dependency isolation |
| Data Recording | SQLite, JSONL | State persistence and Manifest generation |
| Resource Discovery | Smithery.ai, GitHub Awesome MCP Servers | Find ready-made tools |

**Applicable Scenarios**: Audio dataset automation construction, vocoder training preprocessing, local Git repository AI transformation

**Generation Time**: 2026 Edition
