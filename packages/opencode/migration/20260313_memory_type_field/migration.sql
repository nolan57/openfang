-- Migration: Add memory_type field to knowledge_nodes for cross-type linking
-- Target: Global cognitive graph enhancement
-- Date: 2026-03-13

-- Add memory_type column (nullable for backward compatibility)
ALTER TABLE knowledge_node ADD COLUMN memory_type TEXT;

-- Create index for memory_type lookups
CREATE INDEX IF NOT EXISTS knowledge_node_memory_type_idx ON knowledge_node(memory_type);

-- Note: Existing rows will have NULL memory_type, which is fine for backward compatibility
-- New code should populate this field when creating nodes
