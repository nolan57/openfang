# Novel Engine Improvement Plan

## Goal: Evolve from simple initial idea to epic masterpiece with numerous characters and complex structure via self-evolution.

## Phase 1: Foundational Improvements (Stability & Performance) ✅

1. **Type Safety & Strictness** ✅
   - ✅ Created `validation.ts` with Zod schemas for all LLM outputs
   - ✅ Added validation functions for trauma, skill, goal, relationship, mindModel, worldState
   - ✅ Created `RawStateUpdate`, `RawCharacterUpdate`, `RawRelationshipUpdate` schemas
   - 🔲 Integrate validation into `state-extractor.ts` (in progress)

2. **Error Handling & Logging** ✅
   - ✅ Created `withRetry()` with exponential backoff for LLM calls
   - ✅ Added `createCorrelationId()` and `createCorrelationContext()` for tracing
   - ✅ Created `ValidationResult<T>` type for structured error handling

3. **Performance Optimization** ✅
   - ✅ Created `memoize()` with TTL support for caching LLM prompts
   - ✅ Created `debounce()`, `throttle()`, `batch()` utilities
   - ✅ Created `lazy()` for on-demand module loading
   - ✅ Created `rateLimit()` for API call protection
   - 🔲 Integrate into `orchestrator.ts` for branch generation (in progress)

4. **Testing & Validation** ✅
   - ✅ Added 50 passing tests with 99 assertions
   - ✅ Created tests for validation, performance, branch-manager, faction-detector
   - 🔲 Add property-based tests for branch generation consistency
   - 🔲 Create snapshot tests for narrative skeleton outputs

## Phase 2: Scalability & Complexity Handling ✅

1. **Branching & State Management** ✅
   - ✅ Created `branch-manager.ts` with branch pruning
   - ✅ Implemented branch scoring with weighted evaluation
   - ✅ Added branch merging via similarity detection (Jaccard + evaluation)
   - ✅ Added branch tree structure with parent/child relationships
   - 🔲 Add persistent branch storage (SQLite)
   - 🔲 Allow branch dependencies

2. **Pattern Mining & Evolution** ✅
   - ✅ Created `pattern-miner-enhanced.ts` with higher-order abstractions
   - ✅ Added archetype extraction (hero, mentor, shadow, trickster, etc.)
   - ✅ Added plot template extraction (three_act, hero_journey, etc.)
   - ✅ Added motif extraction and evolution tracking
   - ✅ Implemented pattern decay mechanism with reinforcement
   - 🔲 Store patterns in a vector index for semantic similarity search
   - 🔲 Enable cross-story pattern transfer (learn from multiple novel instances)

3. **Thematic Analysis Deepening** ✅
   - ✅ Created `motif-tracker.ts` for motif evolution tracking
   - ✅ Track motif evolution across chapters/characters
   - ✅ Generate motif variation suggestions automatically
   - ✅ Correlate motif strength with character arcs
   - ✅ Export thematic evolution as knowledge graph

4. **Relationship & Faction Modeling** ✅
   - ✅ Created `faction-detector.ts` with automatic faction detection
   - ✅ Implemented faction types: alliance, opposition, cooperative, etc.
   - ✅ Added faction cohesion calculation and member influence scoring
   - ✅ Added faction relationship tracking (ally, enemy, neutral, tense, cooperative)
   - ✅ Created `relationship-inertia.ts` with resistance to sudden shifts
   - ✅ Added plot hook generation (betrayal, alliance, rivalry_escalation, etc.)
   - 🔲 Model multi-way relationships (triads, groups) not just dyads

## Phase 3: Advanced Self-Evolution (Meta‑Learning)

1. **Hierarchical Memory Integration**
   - Hook `StateExtractor` updates into the hierarchical memory system.
   - Store chapter summaries at different abstraction levels (sentence, scene, chapter, arc).
   - Enable retrieval‑augmented generation: prompt LLM with relevant past beats.

2. **Knowledge Graph for Story World**
   - Persist characters, locations, items, events as nodes in a graph (via `ontology` skill).
   - Automatically infer new edges (e.g., "Character A knows Location B").
   - Use graph queries to prevent inconsistencies (e.g., dead character acting).

3. **Skill Generation & Curation**
   - Extend `checkAndGenerateSkills` to propose meta‑skills (e.g., "Pattern Recognition", "Foresight").
   - Implement skill usefulness scoring based on actual impact on story metrics.
   - Auto‑retire low‑impact skills; promote high‑impact ones to core library.
   - Share generated skills across novel instances via skill registry.

4. **Evolution‑Driven Orchestration**
   - Allow the orchestrator to propose its own architectural changes (e.g., new branch selection algorithm).
   - Use the evolution system to test proposed changes in a sandbox before adoption.
   - Close the loop: evolution suggestions → orchestrator config → story generation → feedback.

## Phase 4: Integration with OpenCode Ecosystem

1. **MCP (Model Context Protocol) Servers**
   - Expose novel state, patterns, and relationships as MCP resources.
   - Accept MCP tools for external world‑building (geography, magic systems, tech trees).
   - Enable remote agents to contribute to story generation via MCP.

2. **ACP (Agent Client Protocol) & Collab**
   - Deploy multiple `CharacterDeepener` agents as collaborators, each focusing on a character subset.
   - Use the collab system to negotiate cross‑character consistency.
   - Let the coordinator agent resolve conflicts and merge suggestions.

3. **Observability (X‑Ray Mode)**
   - Instrument key functions (branch generation, state extraction, evolution checks) with spans.
   - Export trace data to visualize story evolution over time.
   - Create dashboards for branch health, pattern discovery rate, thematic consistency.

4. **User‑Facing Enhancements**
   - Add slash commands: `/branch <id>` to switch, `/compare` to view branch diffs, `/themes` to see motif evolution.
   - Provide a web UI panel (via `packages/app`) for interactive branch exploration.
   - Allow importing/exporting story bibles in standard formats (JSON, YAML, Markdown).

## Phase 5: Epic Masterpiece Features

1. **Procedural World Generation**
   - Integrate a procedural geography/history generator (seeded from initial prompt).
   - Let world state drive plot constraints (e.g., resource scarcity → conflict).
   - Cache generated chunks to maintain consistency across branches.

2. **Dynamic Casting & Character Lifecycle**
   - Allow characters to be born, die, retire, or transform mid‑story.
   - Implement aging, skill atrophy, trauma recovery over time.
   - Generate new characters on‑demand when plot needs fresh perspectives.

3. **Multi‑Threaded Narrative Execution**
   - Run multiple story lines in parallel (async) then synchronize at convergence points.
   - Use a barrier mechanism: advance all active lines to the next chapter before proceeding.
   - Detect and resolve cross‑line contradictions via the knowledge graph.

4. **Adaptive Tone & Style Evolution**
   - Let the thematic analyst propose tone shifts (dark → hopeful) based on arc progression.
   - Feed style modifiers into the visual prompt engineer for cohesive art generation.
   - Allow user‑guided style evolution via slash commands (`/style grimdark`, `/style hopeful`).

5. **End‑Game Detection & Resolution**
   - Define completion criteria (major arc resolved, thematic saturation, user satisfaction).
   - Auto‑generate epilogue, denouement, and thematic wrap‑up.
   - Offer to seed a sequel or spin‑off from resolved branches.

---

**Next Steps**: Prioritize Phase 1 tasks to stabilize the base, then iteratively roll out phases. Use the evolution system to validate each improvement before merging.
