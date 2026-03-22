# Novel Engine Web Application - Technical Proposal

**Date:** 2026-03-22  
**Status:** 📋 Proposal  
**Based on:** Novel Engine Core Analysis

---

## Executive Summary

This proposal outlines a web application for the Novel Engine, providing an interactive fiction creation and visualization platform. The application will leverage the existing Novel Engine core modules while adding a modern web interface for story management, character development, and visual panel generation.

---

## 1. Core Analysis Summary

### 1.1 Novel Engine Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Novel Engine Core                            │
├─────────────────────────────────────────────────────────────────────┤
│  Story Generation    │  Character System  │  Visual Generation     │
│  ─────────────────────────────────────────────────────────────────  │
│  • Orchestrator      │  • CharacterDeepener│  • VisualOrchestrator │
│  • StateExtractor    │  • CharacterLifecycle│  • VisualTranslator  │
│  • EvolutionRules    │  • RelationshipAnalyzer│  • PromptEngineer  │
│  • BranchManager     │  • AttachmentTheory │  • ContinuityAnalyzer│
│  • PatternMiner      │  • BigFivePersonality│                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Features Identified

| Category                 | Features                                                 |
| ------------------------ | -------------------------------------------------------- |
| **Story Generation**     | Multi-branch generation, Chaos system, State persistence |
| **Character System**     | Big Five personality, Attachment styles, Character arcs  |
| **Visual Generation**    | Panel specs, Camera control, Continuity tracking         |
| **Knowledge Management** | Pattern mining, Motif tracking, Knowledge graphs         |
| **Learning Integration** | Vector search, Quality filtering, Auto-improvement       |

---

## 2. Web Application Architecture

### 2.1 Technology Stack

| Layer                | Technology                | Justification                            |
| -------------------- | ------------------------- | ---------------------------------------- |
| **Frontend**         | SolidJS + SolidStart      | Already in project, reactive, performant |
| **Styling**          | Tailwind CSS + Kobalte UI | Existing UI library in project           |
| **State Management** | SolidJS Stores            | Native reactive stores                   |
| **API**              | Bun + Hono                | Fast, TypeScript-first                   |
| **Database**         | SQLite + Drizzle ORM      | Already used in project                  |
| **Real-time**        | WebSocket                 | For live story updates                   |
| **Auth**             | Better Auth               | Existing auth solution                   |

### 2.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Web Client                                │
├─────────────────────────────────────────────────────────────────────┤
│  Story Editor  │  Character Manager  │  Visual Canvas  │  Dashboard│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway                                 │
├─────────────────────────────────────────────────────────────────────┤
│  REST API  │  WebSocket  │  GraphQL (optional)  │  Auth Middleware │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Novel Engine Service                          │
├─────────────────────────────────────────────────────────────────────┤
│  Orchestrator  │  State Manager  │  Visual Engine  │  LLM Service │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Layer                                  │
├─────────────────────────────────────────────────────────────────────┤
│  SQLite  │  Vector Store  │  Knowledge Graph  │  File Storage      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Feature Modules

### 3.1 Story Management

**Components:**

- `StoryDashboard` - Overview of all stories
- `StoryEditor` - Interactive story editor with branch visualization
- `BranchNavigator` - Visual branch tree navigation
- `ChapterTimeline` - Timeline view of chapters and events

**API Endpoints:**

```
POST   /api/stories                    # Create new story
GET    /api/stories                    # List all stories
GET    /api/stories/:id                # Get story details
PUT    /api/stories/:id                # Update story
DELETE /api/stories/:id                # Delete story
POST   /api/stories/:id/generate       # Generate next chapter
GET    /api/stories/:id/branches       # Get branch history
POST   /api/stories/:id/branches/:bid/switch  # Switch branch
```

**Data Model:**

```typescript
interface Story {
  id: string
  title: string
  description: string
  status: "draft" | "active" | "paused" | "completed"
  currentChapter: number
  config: StoryConfig
  createdAt: number
  updatedAt: number
}

interface StoryChapter {
  id: string
  storyId: string
  chapterNumber: number
  content: string
  branchId: string
  chaosEvent: ChaosResult
  characters: CharacterState[]
  createdAt: number
}

interface StoryBranch {
  id: string
  storyId: string
  chapterNumber: number
  choiceMade: string
  quality: number
  selected: boolean
  parentBranchId?: string
}
```

### 3.2 Character Management

**Components:**

- `CharacterList` - List of all characters
- `CharacterProfile` - Detailed character view
- `PersonalityRadar` - Big Five visualization
- `AttachmentStyleChart` - Attachment style display
- `CharacterArcTimeline` - Character development timeline
- `RelationshipGraph` - Interactive relationship visualization

**API Endpoints:**

```
GET    /api/stories/:sid/characters     # List characters
POST   /api/stories/:sid/characters     # Create character
GET    /api/stories/:sid/characters/:cid # Get character
PUT    /api/stories/:sid/characters/:cid # Update character
DELETE /api/stories/:sid/characters/:cid # Delete character
GET    /api/stories/:sid/characters/:cid/arc # Get character arc
GET    /api/stories/:sid/relationships  # Get all relationships
```

**Data Model:**

```typescript
interface Character {
  id: string
  storyId: string
  name: string
  status: CharacterStatus
  personality: PersonalityProfile
  attachmentStyle: AttachmentStyle
  traits: string[]
  skills: SkillEntry[]
  trauma: TraumaEntry[]
  secrets: string[]
  goals: Goal[]
  mindModel: MindModel
  relationships: Relationship[]
  stress: number
  emotions: EmotionalState
}

interface PersonalityProfile {
  openness: number // 0-100
  conscientiousness: number
  extraversion: number
  agreeableness: number
  neuroticism: number
}

interface Relationship {
  targetCharacterId: string
  type: RelationshipType
  powerBalance: PowerBalance
  stage: RelationshipStage
  trust: number
  hostility: number
}
```

### 3.3 Visual Panel Generation

**Components:**

- `VisualCanvas` - Main visual generation interface
- `PanelEditor` - Edit panel specifications
- `CameraControls` - Camera angle and movement controls
- `StyleSelector` - Visual style selection
- `ContinuityChecker` - Check visual continuity
- `PanelGallery` - Browse generated panels

**API Endpoints:**

```
POST   /api/panels/generate             # Generate panel
GET    /api/stories/:sid/panels         # List panels
GET    /api/panels/:id                  # Get panel
PUT    /api/panels/:id                  # Update panel
POST   /api/panels/:id/regenerate      # Regenerate panel
GET    /api/panels/:id/continuity      # Check continuity
```

**Data Model:**

```typescript
interface VisualPanel {
  id: string
  storyId: string
  chapterId: string
  panelIndex: number
  spec: VisualPanelSpec
  imageUrl?: string
  status: "pending" | "generating" | "completed" | "failed"
  createdAt: number
}

interface VisualPanelSpec {
  camera: CameraSpec
  lighting: string
  composition: string
  visualPrompt: string
  negativePrompt: string
  controlNetSignals: ControlNetSignals
  styleModifiers: string[]
  continuity?: ContinuityMetadata
}
```

### 3.4 Knowledge & Patterns

**Components:**

- `PatternExplorer` - Browse discovered patterns
- `MotifTracker` - Track thematic motifs
- `KnowledgeGraph` - Interactive knowledge graph visualization
- `TimelineView` - Event timeline

**API Endpoints:**

```
GET    /api/stories/:sid/patterns       # Get patterns
GET    /api/stories/:sid/motifs         # Get motifs
GET    /api/stories/:sid/knowledge      # Get knowledge graph
GET    /api/stories/:sid/timeline       # Get event timeline
```

### 3.5 Configuration & Settings

**Components:**

- `ConfigEditor` - Story configuration editor
- `TypeCustomizer` - Customize trauma tags, skills, emotions
- `ChaosSettings` - Chaos system configuration
- `VisualSettings` - Visual generation settings

**API Endpoints:**

```
GET    /api/stories/:sid/config         # Get config
PUT    /api/stories/:sid/config         # Update config
GET    /api/types/trauma                # Get trauma tags
GET    /api/types/skills                # Get skill categories
GET    /api/types/emotions              # Get emotion types
```

---

## 4. UI/UX Design

### 4.1 Main Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Header: Logo | Story Selector | User Menu | Settings              │
├─────────────────────────────────────────────────────────────────────┤
│  Sidebar     │              Main Content Area                      │
│  ─────────── │  ─────────────────────────────────────────────────  │
│  Dashboard   │  ┌──────────────────────────────────────────────┐  │
│  Stories     │  │                                              │  │
│  Characters  │  │           Dynamic Content Area               │  │
│  Visuals     │  │                                              │  │
│  Patterns    │  │                                              │  │
│  Settings    │  └──────────────────────────────────────────────┘  │
│              │  ┌──────────────────────────────────────────────┐  │
│  ─────────── │  │  Bottom Panel: Logs | AI Chat | Quick Actions│  │
│  Quick Stats │  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Story Editor View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Story: "Suspect X"  |  Chapter 5  |  Branch: Main  |  Generate ▶  │
├─────────────────────────────────────────────────────────────────────┤
│  Branch Tree    │  Story Content                                    │
│  ─────────────  │  ───────────────────────────────────────────────  │
│  ○ Chapter 1    │                                                   │
│  │  └─ Main ✓   │  The rain hammered against the window as         │
│  │              │  Detective Lin stared at the evidence board...    │
│  ○ Chapter 2    │                                                   │
│  │  └─ Main ✓   │  [Continue to next section...]                   │
│  │              │                                                   │
│  ○ Chapter 3    │  ┌──────────────────────────────────────────┐   │
│  │  ├─ Main ✓   │  │  Chaos Event: Complication               │   │
│  │  └─ Alt A    │  │  A new witness emerges with conflicting  │   │
│  │              │  │  testimony...                            │   │
│  ○ Chapter 4    │  └──────────────────────────────────────────┘   │
│  │  └─ Main ✓   │                                                   │
│  │              │                                                   │
│  ○ Chapter 5 ◀  │                                                   │
│     └─ Main     │                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Character Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  Characters (4)  |  + Add Character  |  Filter: All Status         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Detective Lin │  │  Dr. Chen    │  │  Suspect Wang│            │
│  │  ───────────  │  │  ───────────  │  │  ───────────  │            │
│  │  Status: Active│  │ Status: Active│  │Status: Active │            │
│  │  Stress: 45%  │  │  Stress: 30%  │  │ Stress: 70%   │            │
│  │  Trust: 65%   │  │  Trust: 80%   │  │ Trust: 25%    │            │
│  │               │  │               │  │               │            │
│  │  [Profile ▶]  │  │  [Profile ▶]  │  │  [Profile ▶]  │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Relationship Map                                            │ │
│  │                                                               │ │
│  │    Lin ──[trust: 65]──▶ Chen                                 │ │
│  │     │                     │                                  │ │
│  │     │[hostility: 40]      │[trust: 50]                       │ │
│  │     ▼                     ▼                                  │ │
│  │    Wang ◀──[suspect]──── Lin                                 │ │
│  │                                                               │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Real-time Features

### 5.1 WebSocket Events

**Client → Server:**

```typescript
// Subscribe to story updates
{ type: "subscribe", storyId: string }

// Request chapter generation
{ type: "generate", storyId: string, prompt?: string }

// Switch branch
{ type: "switch_branch", storyId: string, branchId: string }
```

**Server → Client:**

```typescript
// Generation progress
{ type: "progress", storyId: string, phase: string, progress: number }

// Chapter generated
{ type: "chapter_generated", storyId: string, chapter: Chapter }

// Chaos event
{ type: "chaos_event", storyId: string, event: ChaosEvent }

// Character update
{ type: "character_updated", storyId: string, character: Character }

// Visual panel ready
{ type: "panel_ready", storyId: string, panel: VisualPanel }
```

### 5.2 Real-time UI Updates

```typescript
// SolidJS reactive store with WebSocket integration
const storyStore = createStore({
  currentStory: null,
  chapters: [],
  characters: [],
  isGenerating: false,
  generationProgress: 0,
  chaosEvent: null,
})

// WebSocket connection
const ws = new WebSocket("ws://localhost:3000/ws")
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  switch (data.type) {
    case "progress":
      storyStore.set("generationProgress", data.progress)
      break
    case "chapter_generated":
      storyStore.set("chapters", [...storyStore.chapters, data.chapter])
      break
    // ...
  }
}
```

---

## 6. API Implementation

### 6.1 Server Structure

```typescript
// packages/novel-web/src/server/api.ts
import { Hono } from "hono"
import { cors } from "hono/cors"
import { auth } from "../auth"
import { storyRoutes } from "./routes/stories"
import { characterRoutes } from "./routes/characters"
import { panelRoutes } from "./routes/panels"

const app = new Hono()

// Middleware
app.use("/*", cors())
app.use("/api/*", auth.middleware)

// Routes
app.route("/api/stories", storyRoutes)
app.route("/api/characters", characterRoutes)
app.route("/api/panels", panelRoutes)

// WebSocket
app.get("/ws", websocketHandler)

export default app
```

### 6.2 Story Generation Endpoint

```typescript
// packages/novel-web/src/server/routes/stories.ts
import { Hono } from "hono"
import { EvolutionOrchestrator } from "@opencode-ai/novel/orchestrator"
import { getStory, saveStory } from "../db/stories"

export const storyRoutes = new Hono()

storyRoutes.post("/:id/generate", async (c) => {
  const storyId = c.req.param("id")
  const { useBranches, prompt } = await c.req.json()

  const story = await getStory(storyId)
  if (!story) {
    return c.json({ error: "Story not found" }, 404)
  }

  // Create orchestrator
  const orchestrator = new EvolutionOrchestrator({
    branchOptions: story.config.branchOptions,
    verbose: true,
  })

  // Load state
  await orchestrator.loadState()

  // Generate chapter
  const content = await orchestrator.runNovelCycle(
    prompt || story.currentPrompt,
    useBranches ?? story.config.useBranches,
  )

  // Save state
  await orchestrator.saveState()
  await saveStory(storyId, {
    currentChapter: story.currentChapter + 1,
    updatedAt: Date.now(),
  })

  return c.json({
    success: true,
    chapter: story.currentChapter + 1,
    content,
  })
})
```

---

## 7. Project Structure

```
packages/novel-web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── drizzle.config.ts
│
├── src/
│   ├── app.tsx                    # Main app entry
│   ├── entry-client.tsx           # Client entry
│   ├── entry-server.tsx           # Server entry
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── MainLayout.tsx
│   │   │
│   │   ├── story/
│   │   │   ├── StoryDashboard.tsx
│   │   │   ├── StoryEditor.tsx
│   │   │   ├── BranchNavigator.tsx
│   │   │   └── ChapterTimeline.tsx
│   │   │
│   │   ├── character/
│   │   │   ├── CharacterList.tsx
│   │   │   ├── CharacterProfile.tsx
│   │   │   ├── PersonalityRadar.tsx
│   │   │   └── RelationshipGraph.tsx
│   │   │
│   │   ├── visual/
│   │   │   ├── VisualCanvas.tsx
│   │   │   ├── PanelEditor.tsx
│   │   │   ├── CameraControls.tsx
│   │   │   └── PanelGallery.tsx
│   │   │
│   │   └── shared/
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Modal.tsx
│   │       └── Spinner.tsx
│   │
│   ├── routes/
│   │   ├── index.tsx              # Dashboard
│   │   ├── stories/
│   │   │   ├── index.tsx          # Story list
│   │   │   ├── [id].tsx           # Story detail
│   │   │   └── [id]/edit.tsx      # Story editor
│   │   ├── characters/
│   │   │   ├── index.tsx          # Character list
│   │   │   └── [id].tsx           # Character profile
│   │   └── visuals/
│   │       ├── index.tsx          # Visual gallery
│   │       └── [id].tsx           # Panel detail
│   │
│   ├── stores/
│   │   ├── storyStore.ts
│   │   ├── characterStore.ts
│   │   ├── visualStore.ts
│   │   └── uiStore.ts
│   │
│   ├── lib/
│   │   ├── api.ts                 # API client
│   │   ├── websocket.ts           # WebSocket client
│   │   └── utils.ts
│   │
│   └── server/
│       ├── api.ts                 # API routes
│       ├── routes/
│       │   ├── stories.ts
│       │   ├── characters.ts
│       │   └── panels.ts
│       ├── db/
│       │   ├── schema.ts
│       │   ├── stories.ts
│       │   └── characters.ts
│       └── services/
│           ├── storyService.ts
│           ├── characterService.ts
│           └── visualService.ts
│
├── public/
│   └── ...
│
└── migration/
    └── ...
```

---

## 8. Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

- [ ] Project setup with SolidStart
- [ ] Database schema design
- [ ] API routes structure
- [ ] Authentication integration
- [ ] WebSocket setup

### Phase 2: Story Management (Week 3-4)

- [ ] Story CRUD operations
- [ ] Chapter generation integration
- [ ] Branch navigation
- [ ] Real-time progress updates

### Phase 3: Character System (Week 5-6)

- [ ] Character CRUD operations
- [ ] Personality visualization
- [ ] Relationship graph
- [ ] Character arc timeline

### Phase 4: Visual Generation (Week 7-8)

- [ ] Panel generation integration
- [ ] Visual canvas
- [ ] Camera controls
- [ ] Panel gallery

### Phase 5: Polish & Deploy (Week 9-10)

- [ ] UI/UX polish
- [ ] Performance optimization
- [ ] Testing
- [ ] Deployment

---

## 9. Integration with Existing Modules

### 9.1 Direct Imports

```typescript
// Story generation
import { EvolutionOrchestrator } from "@opencode-ai/novel/orchestrator"
import { EvolutionRulesEngine } from "@opencode-ai/novel/evolution-rules"
import { BranchManager } from "@opencode-ai/novel/branch-manager"

// Character system
import { CharacterDeepener } from "@opencode-ai/novel/character-deepener"
import { RelationshipAnalyzer } from "@opencode-ai/novel/relationship-analyzer"
import { CharacterLifecycleManager } from "@opencode-ai/novel/character-lifecycle"

// Visual generation
import { VisualOrchestrator } from "@opencode-ai/novel/visual-orchestrator"
import { VisualPromptEngineer } from "@opencode-ai/novel/visual-prompt-engineer"

// Knowledge management
import { StoryKnowledgeGraph } from "@opencode-ai/novel/story-knowledge-graph"
import { MotifTracker } from "@opencode-ai/novel/motif-tracker"

// Learning bridge
import { NovelLearningBridgeManager } from "@opencode-ai/novel/novel-learning-bridge"
```

### 9.2 Bridge Integration

```typescript
// Use existing bridges for cross-module communication
import { BridgeEventBus } from "@opencode-ai/adapt"
import { MemoryLearningBridge } from "@opencode-ai/adapt"

const eventBus = new BridgeEventBus()

// Subscribe to memory updates
eventBus.subscribe("novel", async (event) => {
  if (event.type === "memory_updated") {
    // Update character context
    await updateCharacterContext(event.payload)
  }
})
```

---

## 10. Security Considerations

### 10.1 Authentication

- Use Better Auth for user authentication
- JWT tokens for API access
- Role-based access control (RBAC)

### 10.2 Authorization

```typescript
// Story ownership check
async function checkStoryAccess(userId: string, storyId: string): Promise<boolean> {
  const story = await getStory(storyId)
  return story.ownerId === userId || story.collaborators.includes(userId)
}

// API middleware
app.use("/api/stories/:id/*", async (c, next) => {
  const storyId = c.req.param("id")
  const userId = c.get("userId")

  if (!(await checkStoryAccess(userId, storyId))) {
    return c.json({ error: "Unauthorized" }, 403)
  }

  await next()
})
```

### 10.3 Input Validation

```typescript
import { z } from "zod"

const CreateStorySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  config: z
    .object({
      branchOptions: z.number().min(1).max(10).default(3),
      useBranches: z.boolean().default(false),
      storyType: z.enum(["action", "character", "theme", "balanced"]).default("balanced"),
    })
    .optional(),
})

app.post("/api/stories", async (c) => {
  const body = await c.req.json()
  const result = CreateStorySchema.safeParse(body)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  // Create story...
})
```

---

## 11. Performance Optimization

### 11.1 Caching Strategy

```typescript
// Cache story data with LRU
import { LRUCache } from "lru-cache"

const storyCache = new LRUCache<string, Story>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
})

async function getStoryWithCache(id: string): Promise<Story> {
  const cached = storyCache.get(id)
  if (cached) return cached

  const story = await getStory(id)
  storyCache.set(id, story)
  return story
}
```

### 11.2 Lazy Loading

```typescript
// Lazy load heavy components
const VisualCanvas = lazy(() => import("./components/visual/VisualCanvas"))
const RelationshipGraph = lazy(() => import("./components/character/RelationshipGraph"))

// Use in routes
<Suspense fallback={<Spinner />}>
  <VisualCanvas />
</Suspense>
```

### 11.3 Database Optimization

```typescript
// Use prepared statements
const getStoryStmt = db.prepare("SELECT * FROM stories WHERE id = ?")
const getChaptersStmt = db.prepare("SELECT * FROM chapters WHERE story_id = ? ORDER BY chapter_number")

// Batch operations
async function batchUpdateCharacters(updates: CharacterUpdate[]) {
  db.transaction(() => {
    for (const update of updates) {
      db.update(characters).set(update.data).where(eq(characters.id, update.id))
    }
  })
}
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

```typescript
// Component tests
describe("StoryEditor", () => {
  it("should render chapter content", () => {
    const { getByText } = render(() => <StoryEditor chapter={mockChapter} />)
    expect(getByText("Chapter 1")).toBeInTheDocument()
  })
})

// API tests
describe("Story API", () => {
  it("should create a new story", async () => {
    const response = await app.request("/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: "Test Story" }),
    })
    expect(response.status).toBe(201)
  })
})
```

### 12.2 Integration Tests

```typescript
describe("Story Generation Flow", () => {
  it("should generate a chapter and update state", async () => {
    const story = await createTestStory()
    const result = await generateChapter(story.id)

    expect(result.chapter).toBe(1)
    expect(result.content).toBeTruthy()

    const updatedStory = await getStory(story.id)
    expect(updatedStory.currentChapter).toBe(1)
  })
})
```

---

## 13. Deployment

### 13.1 Build Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import solidStart from "solid-start/vite"

export default defineConfig({
  plugins: [
    solid(),
    solidStart({
      ssr: true,
      islands: true,
    }),
  ],
  build: {
    target: "esnext",
    minify: "terser",
  },
})
```

### 13.2 Docker Configuration

```dockerfile
FROM oven/bun:1 as base
WORKDIR /app

FROM base as install
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM base as build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base as runtime
COPY --from=build /app/.output .output
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
```

---

## Summary

**Project:** Novel Engine Web Application  
**Timeline:** 10 weeks  
**Team:** 2-3 developers

**Key Deliverables:**

1. Interactive story editor with branch visualization
2. Character management with personality analysis
3. Visual panel generation and management
4. Real-time collaboration features
5. Knowledge graph and pattern exploration

**Technology Stack:**

- Frontend: SolidJS + SolidStart
- Backend: Bun + Hono
- Database: SQLite + Drizzle
- Real-time: WebSocket

**Integration Points:**

- Novel Engine Core (orchestrator, rules, characters)
- Learning Bridge (vector search, knowledge graph)
- Memory System (context management)

---

**Status:** 📋 Ready for Review  
**Next Step:** Get approval and begin Phase 1 implementation
