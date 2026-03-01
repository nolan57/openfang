# OpenCode TUI 界面设计文档

## 1. 整体布局

OpenCode TUI 采用**垂直分割 + 侧边栏**的布局模式，主要分为以下几个区域：

```
┌─────────────────────────────────────────────────────────────────┐
│                         主内容区                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Header (可选)                           ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                              ││
│  │                    Messages 消息区域                          ││
│  │                    (可滚动)                                   ││
│  │                                                              ││
│  ├─────────────────────────────────────────────────────────────┤
│  │                      Footer (可选)                            ││
│  ├─────────────────────────────────────────────────────────────┤
│  │                    Prompt 输入框                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌───────────────────────────▼────────────────────────────────┐│
│  │                      Sidebar (侧边栏)                        ││
│  │                    (宽度 42 字符)                            ││
│  │  - Context 信息                                             ││
│  │  - MCP 服务器状态                                            ││
│  │  - 插件状态                                                  ││
│  │  - 定时任务                                                  ││
│  │  - TODO 列表                                                ││
│  │  - Diff 变更                                                ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 2. 页面结构

### 2.1 Home 页面 (首页)

**位置**: `routes/home.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                        OpenCode Logo                             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [提示词输入框]                              [发送按钮 / Ctrl+Enter]│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  最近会话列表                                                   │
│  - Session 1                      2024-01-15                   │
│  - Session 2                      2024-01-14                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  快捷操作:                                                      │
│  /connect - 连接 provider                                        │
│  /mcps    - 查看 MCP 服务器                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**组件**:

- `Logo`: OpenCode ASCII 艺术字 Logo
- `Prompt`: 提示词输入组件
- `Tips`: 使用技巧提示
- `MCP状态`: 显示连接的 MCP 服务器数量

### 2.2 Session 页面 (会话页面)

**位置**: `routes/session/index.tsx`

#### 2.2.1 主消息区域

```
┌─────────────────────────────────────────────────────────────────┐
│  # Session Title                              Context (15K 60%) │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [User Message]                                    10:30 AM     │
│  ─────────────────────────────────────────────────────────────  │
│  你好，请帮我创建一个文件                                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Assistant]                                    Build Agent     │
│  ▣                                                              │
│  当然可以，我来帮你创建文件。                                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ $ touch myfile.txt                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Thinking]                                                      │
│  _Thinking: 用户想要创建一个文件，我需要使用 bash 工具...         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**消息类型**:

1. **UserMessage** (用户消息)
   - 左侧边框带颜色标识 (根据 agent)
   - 显示文件名/目录附件
   - 显示时间戳 (可选)

2. **AssistantMessage** (助手消息)
   - 显示 Agent 名称和模型
   - 显示执行耗时
   - 显示 interrupted 状态

3. **ToolCall** (工具调用)
   - 内联工具: 图标 + 工具名 + 参数
   - 块级工具: 完整输出，可展开/折叠

4. **Reasoning** (思考过程)
   - 折叠显示
   - 可通过设置切换显示/隐藏

#### 2.2.2 Header (会话头)

**位置**: `routes/session/header.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│  # Session Title                              Context  Cost    │
│  Parent Session | Prev | Next (子会话时显示)                     │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.2.3 Footer (页脚)

**位置**: `routes/session/footer.tsx`

```
┌─────────────────────────────────────────────────────────────────┤
│  /path/to/project                      /status  ⊙ 2 MCP  • 1 LSP │
└─────────────────────────────────────────────────────────────────┘
```

**显示信息**:

- 当前工作目录
- 连接状态
- MCP 服务器数量和状态
- LSP 服务器数量
- 权限请求数量

#### 2.2.4 Prompt 输入框

**组件**: `component/prompt/index.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│  > [输入框 - 支持多行]                           [发送] [Ctrl+Enter]│
└─────────────────────────────────────────────────────────────────┘
```

**功能**:

- 多行输入 (Shift+Enter 换行)
- 命令自动补全
- 文件拖拽
- 历史记录

### 2.3 Sidebar (侧边栏)

**位置**: `routes/session/sidebar.tsx`

**宽度**: 42 字符

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

**可折叠区块**:

1. **Context** - 上下文使用情况
2. **MCP** - MCP 服务器状态
3. **Plugins** - 插件状态和日志
4. **Scheduler** - 定时任务
5. **Todo** - 待办事项
6. **Diff** - 文件变更
7. **LSP** - LSP 服务器状态

## 3. 配色方案

### 3.1 主题系统

**位置**: `context/theme/`

**支持的主题** (30+):

- `opencode` - OpenCode 默认主题
- `catppuccin` / `catppuccin-frappe` / `catppuccin-macchiato`
- `nord`
- `dracula`
- `one-dark` / `one-dark-pro`
- `tokyonight`
- `github`
- `gruvbox`
- 等等...

### 3.2 颜色变量

```typescript
ThemeColors {
  primary: RGBA      // 主色
  secondary: RGBA    // 辅色
  accent: RGBA       // 强调色
  error: RGBA        // 错误
  warning: RGBA      // 警告
  success: RGBA      // 成功
  info: RGBA         // 信息

  text: RGBA         // 主文字
  textMuted: RGBA    // 辅助文字

  background: RGBA        // 背景
  backgroundPanel: RGBA   // 面板背景
  backgroundElement: RGBA // 元素背景

  border: RGBA        // 边框
  borderActive: RGBA // 激活边框

  diffAdded: RGBA     // Diff 新增
  diffRemoved: RGBA   // Diff 删除
}
```

## 4. 组件库

### 4.1 布局组件

| 组件        | 描述                     |
| ----------- | ------------------------ |
| `box`       | 基础容器，支持 flex 布局 |
| `scrollbox` | 可滚动容器，支持滚动条   |
| `flex`      | Flex 容器                |
| `grid`      | 网格布局                 |

### 4.2 展示组件

| 组件       | 描述                |
| ---------- | ------------------- |
| `text`     | 文本显示            |
| `code`     | 代码块 (带语法高亮) |
| `markdown` | Markdown 渲染       |
| `image`    | 图片显示            |

### 4.3 交互组件

| 组件       | 描述     |
| ---------- | -------- |
| `button`   | 按钮     |
| `input`    | 输入框   |
| `checkbox` | 复选框   |
| `select`   | 下拉选择 |

### 4.4 对话框组件

| 组件                | 描述       |
| ------------------- | ---------- |
| `Dialog`            | 基础对话框 |
| `DialogModel`       | 模型选择   |
| `DialogMCP`         | MCP 配置   |
| `DialogSessionList` | 会话列表   |
| `DialogTimeline`    | 消息时间线 |
| `DialogHelp`        | 帮助文档   |

### 4.5 反馈组件

| 组件       | 描述       |
| ---------- | ---------- |
| `Toast`    | 轻提示通知 |
| `Spinner`  | 加载动画   |
| `Progress` | 进度条     |

## 5. 响应式布局

### 5.1 断点

- **窄屏** (< 80 字符): 隐藏侧边栏，Header 内容垂直排列
- **宽屏** (> 120 字符): 显示侧边栏

### 5.2 侧边栏显示模式

1. **Auto** (自动): 宽屏时自动显示
2. **Show** (显示): 始终显示
3. **Hide** (隐藏): 始终隐藏
4. **Overlay** (覆盖): 窄屏时以覆盖层显示

## 6. 状态管理

### 6.1 全局状态 (Context)

```typescript
// 路由状态
RouteContext: {
  ;(type, sessionID, initialPrompt)
}

// 同步状态
SyncContext: {
  ;(provider, session, message, part, mcp, plugin_status, scheduler_jobs)
}

// 主题状态
ThemeContext: {
  ;(theme, mode, setMode)
}

// 本地状态
LocalContext: {
  ;(agent, model)
}
```

### 6.2 本地状态 (KV Store)

```typescript
kv.get(key: string, defaultValue: any)
// 常用 key:
// - sidebar: "auto" | "hide"
// - thinking_visibility: boolean
// - timestamps: "hide" | "show"
// - tool_details_visibility: boolean
// - scrollbar_visible: boolean
// - header_visible: boolean
```

## 7. 事件系统

### 7.1 TUI 事件

```typescript
TuiEvent = {
  // 会话事件
  SessionSelect: { sessionID: string }
  SessionDelete: { sessionID: string }

  // 命令事件
  CommandExecute: { command: string }

  // Toast 事件
  ToastShow: { title?, message, variant, duration }

  // 插件状态事件
  PluginStatus: {
    plugin: string
    status: "connected" | "disconnected" | "connecting" | "error"
    log?: { type, message }
    error?: string
  }

  // 调度任务事件
  SchedulerJobStarted: { id, name? }
  SchedulerJobCompleted: { id, name? }
  SchedulerJobFailed: { id, name?, error? }
}
```

### 7.2 插件日志显示

插件可以通过 `tui.plugin.status` 事件发送日志：

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

日志显示在 Sidebar 的 Plugins 区块，最多显示 20 条，支持滚动。

## 8. 快捷键

### 8.1 全局快捷键

| 快捷键     | 功能         |
| ---------- | ------------ |
| `Ctrl+C`   | 复制选中内容 |
| `Esc`      | 取消选择     |
| `Ctrl+X S` | 打开设置     |

### 8.2 会话快捷键

| 快捷键       | 功能         |
| ------------ | ------------ |
| `Ctrl+Enter` | 发送消息     |
| `Ctrl+L`     | 清空输入     |
| `/`          | 打开命令面板 |

### 8.3 导航快捷键

| 快捷键                | 功能        |
| --------------------- | ----------- |
| `PageUp` / `PageDown` | 翻页        |
| `Home` / `End`        | 跳转到首/末 |
| `Ctrl+U` / `Ctrl+D`   | 半页滚动    |

## 9. 技术栈

- **框架**: SolidJS
- **TUI 渲染**: @opentui/core
- **状态管理**: SolidJS Context + Store
- **样式**: 主题 JSON 配置 + CSS 变量

## 10. 文件结构

```
cli/cmd/tui/
├── app.tsx                    # 主应用入口
├── routes/
│   ├── home.tsx              # 首页
│   └── session/
│       ├── index.tsx         # 会话页面
│       ├── header.tsx       # 会话头
│       ├── footer.tsx       # 会话尾
│       ├── sidebar.tsx       # 侧边栏
│       ├── permission.tsx   # 权限提示
│       ├── question.tsx     # 问题提示
│       └── dialog-*.tsx     # 对话框组件
├── component/
│   ├── prompt/              # 输入框组件
│   ├── dialog-*/            # 对话框组件
│   └── ...
├── context/
│   ├── theme.tsx            # 主题上下文
│   ├── sync.tsx             # 同步上下文
│   ├── route.tsx            # 路由上下文
│   └── ...
└── ui/
    ├── dialog-*.tsx         # UI 对话框
    ├── toast.tsx            # 提示组件
    └── ...
```
