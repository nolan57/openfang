-- Collaborative Multi-Agent System Tables
-- Migration: collab_system
-- Created: 2026-03-10

-- Agents table for collaborative multi-agent system
CREATE TABLE IF NOT EXISTS collab_agents (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    role TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle',
    capabilities TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_active_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_collab_agents_type ON collab_agents(type);
CREATE INDEX IF NOT EXISTS idx_collab_agents_role ON collab_agents(role);
CREATE INDEX IF NOT EXISTS idx_collab_agents_state ON collab_agents(state);

-- Tasks table for task coordination
CREATE TABLE IF NOT EXISTS collab_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    requirements TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    timeout INTEGER,
    dependencies TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER,
    completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_collab_tasks_agent ON collab_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_collab_tasks_status ON collab_tasks(status);

-- Messages table for agent communication
CREATE TABLE IF NOT EXISTS collab_messages (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_collab_messages_from ON collab_messages(from_agent);
CREATE INDEX IF NOT EXISTS idx_collab_messages_to ON collab_messages(to_agent);
CREATE INDEX IF NOT EXISTS idx_collab_messages_type ON collab_messages(type);

-- Sessions table for collaborative sessions
CREATE TABLE IF NOT EXISTS collab_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    agent_ids TEXT NOT NULL,
    context_summary TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_collab_sessions_expires ON collab_sessions(expires_at);
