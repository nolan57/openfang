-- Custom migration to update vector dimensions from 384 to 1536

-- Update system_metadata table
INSERT OR REPLACE INTO system_metadata (key, value, value_type, description, time_created, time_updated)
VALUES ('embedding_dimension', '1536', 'string', 'Embedding vector dimension', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Note: vec_vector_memory dimension change requires dropping and recreating the table
-- This is handled by the application code when it detects dimension mismatch
-- The application will:
-- 1. Read the new dimension (1536) from system_metadata
-- 2. Drop the old vec_vector_memory table
-- 3. Create new vec_vector_memory table with float[1536]
-- 4. Re-index all vectors using the new dimension
