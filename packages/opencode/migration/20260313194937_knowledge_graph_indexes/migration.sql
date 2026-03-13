-- 知识图谱索引优化
-- 为高频查询字段添加索引以提升性能

-- knowledge_nodes 表索引
CREATE INDEX IF NOT EXISTS "knowledge_node_type_idx" ON "knowledge_node" ("type");
CREATE INDEX IF NOT EXISTS "knowledge_node_entity_idx" ON "knowledge_node" ("entity_type", "entity_id");

-- knowledge_edges 表索引
CREATE INDEX IF NOT EXISTS "knowledge_edge_source_idx" ON "knowledge_edge" ("source_id");
CREATE INDEX IF NOT EXISTS "knowledge_edge_target_idx" ON "knowledge_edge" ("target_id");
CREATE INDEX IF NOT EXISTS "knowledge_edge_relation_idx" ON "knowledge_edge" ("relation");

-- knowledge 表索引
CREATE INDEX IF NOT EXISTS "knowledge_source_idx" ON "knowledge" ("source");
CREATE INDEX IF NOT EXISTS "knowledge_processed_idx" ON "knowledge" ("processed");

-- [ENH] TTL: Add expires_at column to vector_memory for automatic expiration
ALTER TABLE vector_memory ADD COLUMN expires_at INTEGER;

-- [ENH] FTS5: Create full-text search virtual table for fallback search acceleration
-- Note: FTS5 requires the base table to have a rowid, which vector_memory has
CREATE VIRTUAL TABLE IF NOT EXISTS vector_memory_fts USING fts5(
  entity_title,
  content='vector_memory',
  content_rowid='rowid'
);

-- [ENH] FTS5: Triggers to keep FTS index synchronized with vector_memory
CREATE TRIGGER IF NOT EXISTS vector_memory_fts_insert AFTER INSERT ON vector_memory BEGIN
  INSERT INTO vector_memory_fts(rowid, entity_title) VALUES (new.rowid, new.entity_title);
END;

CREATE TRIGGER IF NOT EXISTS vector_memory_fts_delete AFTER DELETE ON vector_memory BEGIN
  INSERT INTO vector_memory_fts(vector_memory_fts, rowid, entity_title) 
  VALUES('delete', old.rowid, old.entity_title);
END;

CREATE TRIGGER IF NOT EXISTS vector_memory_fts_update AFTER UPDATE ON vector_memory BEGIN
  INSERT INTO vector_memory_fts(vector_memory_fts, rowid, entity_title) 
  VALUES('delete', old.rowid, old.entity_title);
  INSERT INTO vector_memory_fts(rowid, entity_title) VALUES (new.rowid, new.entity_title);
END;
