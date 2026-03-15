# Novel Engine Improvement Plan

## Goal: Evolve from simple initial idea to epic masterpiece with numerous characters and complex structure via self-evolution.

## Phase 1: Foundational Improvements (Stability & Performance)

1. **Type Safety & Strictness**
   - Eliminate `any` types in `StateExtractor`, `EvolutionOrchestrator`, `CharacterDeepener`.
   - Use `zod` schemas for all LLM outputs and state transitions.
   - Enforce strict null checks; avoid implicit `any` from JSON.parse.

2. **Error Handling & Logging**
   - Replace broad `try/catch` with specific error handling and meaningful logs.
   - Add correlation IDs for tracing LLM calls across modules.
   - Introduce retry with exponential backoff for LLM generation failures.

3. **Performance Optimization**
   - Memoize expensive LLM prompts (e.g., `generateBranches`, `evaluateBranch`).
   - Batch character/relationship updates to reduce LLM calls.
   - Use functional array methods (`flatMap`, `filter`) over loops where applicable.
   - Lazy-load heavy modules (visual orchestrator, pattern miner) until needed.

4. **Testing & Validation**
   - Increase unit test coverage for `state-extractor.ts` and `evolution-rules.ts`.
   - Add property-based tests for branch generation consistency.
   - Create snapshot tests for narrative skeleton outputs.
   - Implement mutation testing to ensure evolution rules catch edge cases.

## Phase 2: Scalability & Complexity Handling

1. **Branching & State Management**
   - Implement branch pruning: keep only top-N branches by evaluation score.
   - Introduce branch merging when narratives converge (detect similarity via embeddings).
   - Add persistent branch storage (SQLite) to support time-travel beyond memory limits.
   - Allow branch dependencies (e.g., Branch B requires outcome of Branch A).

2. **Pattern Mining & Evolution**
   - Upgrade pattern miner to extract higher-order abstractions (archetypes, plot templates).
   - Store patterns in a vector index for semantic similarity search.
   - Add pattern decay mechanism: outdated patterns fade unless reinforced.
   - Enable cross-story pattern transfer (learn from multiple novel instances).

3. **Thematic Analysis Deepening**
   - Extend `thematic-analyst.ts` to track motif evolution across chapters/characters.
   - Generate motif variation suggestions automatically.
   - Correlate motif strength with character arcs and relationship tension.
   - Export thematic evolution as a knowledge graph for LLM prompting.

4. **Relationship & Faction Modeling**
   - Enhance `relationship-analyzer.ts` to detect emergent factions automatically.
   - Model multi-way relationships (triads, groups) not just dyads.
   - Add relationship inertia: resistance to sudden trust/hostility shifts.
   - Generate relationship-based plot hooks (betrayal, alliance, rivalry escalation).

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
