# OpenCode TUI Design Document

## 1. Overall Layout

OpenCode TUI uses a **vertical split + sidebar** layout pattern, divided into the following main areas:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Content Area                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Header (Optional)                      ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                              ││
│  │                    Messages Area                             ││
│  │                    (Scrollable)                              ││
│  │                                                              ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                      Footer (Optional)                      ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                      Prompt Input                           ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌───────────────────────────▼────────────────────────────────┐│
│  │                      Sidebar                                ││
│  │                    (42 characters wide)                     ││
│  │  - Context Information                                      ││
│  │  - MCP Server Status                                        ││
│  │  - Plugin Status                                            ││
│  │  - Scheduled Tasks                                          ││
│  │  - TODO List                                                ││
│  │  - Diff Changes                                            ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 2. Page Structure

### 2.1 Home Page

**Location**: `routes/home.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                        OpenCode Logo                             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [Prompt Input]                              [Send / Ctrl+Enter]│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Recent Sessions List                                           │
│  - Session 1                      2024-01-15                   │
│  - Session 2                      2024-01-14                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Quick Actions:                                                  │
│  /connect - Connect provider                                     │
│  /mcps    - View MCP servers                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components**:
- `Logo`: OpenCode ASCII art logo
- `Prompt`: Prompt input component
- `Tips`: Usage tips
- `MCP Status`: Shows number of connected MCP servers

### 2.2 Session Page

**Location**: `routes/session/index.tsx`

#### 2.2.1 Main Message Area

```
┌─────────────────────────────────────────────────────────────────┐
│  # Session Title                              Context (15K 60%)│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [User Message]                                    10:30 AM     │
│  ─────────────────────────────────────────────────────────────  │
│  Hello, please help me create a file                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Assistant]                                    Build Agent     │
│  ▣                                                              │
│  Of course, I'll help you create the file.                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ $ touch myfile.txt                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Thinking]                                                      │
│  _Thinking: User wants to create a file, I need to use bash...│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Message Types**:

1. **UserMessage**
   - Left border colored indicator (based on agent)
   - Shows file/directory attachments
   - Shows timestamp (optional)

2. **AssistantMessage**
   - Shows Agent name and model
   - Shows execution time
   - Shows interrupted state

3. **ToolCall**
   - Inline tools: Icon + tool name + parameters
   - Block-level tools: Full output, expandable/collapsible

4. **Reasoning**
   - Collapsed by default
   - Can toggle show/hide via settings

#### 2.2.2 Header

**Location**: `routes/session/header.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│  # Session Title                              Context  Cost    │
│  Parent Session | Prev | Next (shown for sub-sessions)          │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.2.3 Footer

**Location**: `routes/session/footer.tsx`

```
┌─────────────────────────────────────────────────────────────────┤
│  /path/to/project                      /status  ⊙ 2 MCP  • 1 LSP│
└─────────────────────────────────────────────────────────────────┘
```

**Display Information**:
- Current working directory
- Connection status
- MCP server count and status
- LSP server count
- Permission request count

#### 2.2.4 Prompt Input

**Component**: `component/prompt/index.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│  > [Input - Multi-line Support]                 [Send] [Ctrl+Enter]│
└─────────────────────────────────────────────────────────────────┘
```

**Features**:
- Multi-line input (Shift+Enter for new line)
- Command auto-completion
- File drag & drop
- History

### 2.3 Sidebar

**Location**: `routes/session/sidebar.tsx`

**Width**: 42 characters

```
┌────────────────────────────────────────┐
│ Session Title                          │
│ ────────────────────────────────────── │
│ Context                                │
│ 12,500 tokens  45% used               │
│ $12.50 spent                          │
├────────────────────────────────────────┤
│ ▼ MCP (2 active)                       │
│   • MCP Server 1          ✓           │
│   • MCP Server 2          ✓           │
├────────────────────────────────────────┤
│ ▼ Plugins (1 active)                   │
│   • qqbot                 ✓           │
│     [10:30] Connected to QQ            │
│     [10:31] Received message           │
├────────────────────────────────────────┤
│ ▼ Todo (3 items)                       │
│   [ ] Task 1                          │
│   [x] Task 2                          │
│   [ ] Task 3                          │
├────────────────────────────────────────┤
│ ▼ Diff (2 files)                       │
│   src/index.ts         +10 -5         │
│   src/utils.ts         +3  -1         │
└────────────────────────────────────────┘
```

**Collapsible Sections**:
1. **Context** - Context usage
2. **MCP** - MCP server status
3. **Plugins** - Plugin status and logs
4. **Scheduler** - Scheduled tasks
5. **Todo** - Todo list
6. **Diff** - File changes
7. **LSP** - LSP server status

## 3. Color Scheme

### 3.1 Theme System

**Location**: `context/theme/`

**Supported Themes** (30+):
- `opencode` - OpenCode default theme
- `catppuccin` / `catppuccin-frappe` / `catppuccin-macchiato`
- `nord`
- `dracula`
- `one-dark` / `one-dark-pro`
- `tokyonight`
- `github`
- `gruvbox`
- And more...

### 3.2 Color Variables

```typescript
ThemeColors {
  primary: RGBA      // Primary color
  secondary: RGBA    // Secondary color
  accent: RGBA       // Accent color
  error: RGBA        // Error
  warning: RGBA      // Warning
  success: RGBA      // Success
  info: RGBA         // Info

  text: RGBA         // Primary text
  textMuted: RGBA    // Secondary text

  background: RGBA        // Background
  backgroundPanel: RGBA   // Panel background
  backgroundElement: RGBA // Element background

  border: RGBA        // Border
  borderActive: RGBA // Active border

  diffAdded: RGBA     // Diff added
  diffRemoved: RGBA   // Diff removed
}
```

## 4. Component Library

### 4.1 Layout Components

| Component | Description |
|----------|-------------|
| `box` | Basic container, supports flex layout |
| `scrollbox` | Scrollable container with scrollbar |
| `flex` | Flex container |
| `grid` | Grid layout |

### 4.2 Display Components

| Component | Description |
|----------|-------------|
| `text` | Text display |
| `code` | Code block (with syntax highlighting) |
| `markdown` | Markdown rendering |
| `image` | Image display |

### 4.3 Interaction Components

| Component | Description |
|----------|-------------|
| `button` | Button |
| `input` | Input field |
| `checkbox` | Checkbox |
| `select` | Dropdown select |

### 4.4 Dialog Components

| Component | Description |
|----------|-------------|
| `Dialog` | Basic dialog |
| `DialogModel` | Model selection |
| `DialogMCP` | MCP configuration |
| `DialogSessionList` | Session list |
| `DialogTimeline` | Message timeline |
| `DialogHelp` | Help documentation |

### 4.5 Feedback Components

| Component | Description |
|----------|-------------|
| `Toast` | Light notification |
| `Spinner` | Loading animation |
| `Progress` | Progress bar |

## 5. Responsive Layout

### 5.1 Breakpoints

- **Narrow** (< 80 chars): Hide sidebar, Header content arranged vertically
- **Wide** (> 120 chars): Show sidebar

### 5.2 Sidebar Display Modes

1. **Auto**: Auto-show on wide screens
2. **Show**: Always show
3. **Hide**: Always hide
4. **Overlay**: Show as overlay on narrow screens

## 6. State Management

### 6.1 Global State (Context)

```typescript
// Route state
RouteContext: {
  ;(type, sessionID, initialPrompt)
}

// Sync state
SyncContext: {
  ;(provider, session, message, part, mcp, plugin_status, scheduler_jobs)
}

// Theme state
ThemeContext: {
  ;(theme, mode, setMode)
}

// Local state
LocalContext: {
  ;(agent, model)
}
```

### 6.2 Local State (KV Store)

```typescript
kv.get(key: string, defaultValue: any)
// Common keys:
// - sidebar: "auto" | "hide"
// - thinking_visibility: boolean
// - timestamps: "hide" | "show"
// - tool_details_visibility: boolean
// - scrollbar_visible: boolean
// - header_visible: boolean
```

## 7. Event System

### 7.1 TUI Events

```typescript
TuiEvent = {
  // Session events
  SessionSelect: { sessionID: string }
  SessionDelete: { sessionID: string }

  // Command events
  CommandExecute: { command: string }

  // Toast events
  ToastShow: { title?, message, variant, duration }

  // Plugin status events
  PluginStatus: {
    plugin: string
    status: "connected" | "disconnected" | "connecting" | "error"
    log?: { type, message }
    error?: string
  }

  // Scheduler job events
  SchedulerJobStarted: { id, name? }
  SchedulerJobCompleted: { id, name? }
  SchedulerJobFailed: { id, name?, error? }
}
```

### 7.2 Plugin Log Display

Plugins can send logs via `tui.plugin.status` event:

```typescript
await fetch("/tui/publish", {
  method: "POST",
  body: JSON.stringify({
    type: "tui.plugin.status",
    properties: {
      plugin: "qqbot",
      status: "connected",
      log: {
        type: "message",
        message: "Connected to QQ Gateway",
      },
    },
  }),
})
```

Logs display in Sidebar's Plugins section, max 20 entries, supports scrolling.

## 8. Keyboard Shortcuts

### 8.1 Global Shortcuts

| Shortcut | Function |
|----------|----------|
| `Ctrl+C` | Copy selected content |
| `Esc` | Cancel selection |
| `Ctrl+X S` | Open settings |

### 8.2 Session Shortcuts

| Shortcut | Function |
|----------|----------|
| `Ctrl+Enter` | Send message |
| `Ctrl+L` | Clear input |
| `/` | Open command palette |

### 8.3 Navigation Shortcuts

| Shortcut | Function |
|----------|----------|
| `PageUp` / `PageDown` | Page up/down |
| `Home` / `End` | Jump to first/last |
| `Ctrl+U` / `Ctrl+D` | Half page scroll |

## 9. Tech Stack

- **Framework**: SolidJS
- **TUI Rendering**: @opentui/core
- **State Management**: SolidJS Context + Store
- **Styling**: Theme JSON config + CSS variables

## 10. File Structure

```
cli/cmd/tui/
├── app.tsx                    # Main app entry
├── routes/
│   ├── home.tsx              # Home page
│   └── session/
│       ├── index.tsx         # Session page
│       ├── header.tsx       # Session header
│       ├── footer.tsx       # Session footer
│       ├── sidebar.tsx       # Sidebar
│       ├── permission.tsx   # Permission prompt
│       ├── question.tsx     # Question prompt
│       └── dialog-*.tsx     # Dialog components
├── component/
│   ├── prompt/              # Input component
│   ├── dialog-*/            # Dialog components
│   └── ...
├── context/
│   ├── theme.tsx            # Theme context
│   ├── sync.tsx             # Sync context
│   ├── route.tsx            # Route context
│   └── ...
└── ui/
    ├── dialog-*.tsx         # UI dialogs
    ├── toast.tsx            # Toast component
    └── ...
```
