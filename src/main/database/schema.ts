/**
 * Database Schema Definitions for QuickFind
 * Milestone 1: Base Tables
 * Milestone 2: Filesystem Indexing Schema
 * Milestone 3: FTS5 Trigram Search Infrastructure
 * Milestone 4: Incremental Filesystem Synchronization & USN Checkpoints
 */

export const SCHEMA_V1 = `
-- 1. Volumes table: stores drive information and indexing state
CREATE TABLE IF NOT EXISTS volumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_guid TEXT,
  drive_letter TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  file_system TEXT NOT NULL DEFAULT 'NTFS',
  total_bytes INTEGER NOT NULL DEFAULT 0,
  free_bytes INTEGER NOT NULL DEFAULT 0,
  indexing_state TEXT NOT NULL DEFAULT 'unindexed',
  last_scan_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. Indexing sessions table: tracks each scanning run
CREATE TABLE IF NOT EXISTS indexing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'running' | 'completed' | 'failed' | 'cancelled'
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  scanned_files INTEGER NOT NULL DEFAULT 0,
  scanned_folders INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_details TEXT
);

-- 3. Entries table: files and directories with metadata
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  is_directory INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  modified_at INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  scan_id INTEGER NOT NULL REFERENCES indexing_sessions(id),
  file_reference_number TEXT,
  parent_reference_number TEXT,
  usn TEXT,
  CONSTRAINT uq_volume_path UNIQUE (volume_id, path)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_entries_volume_parent ON entries (volume_id, parent_path);
CREATE INDEX IF NOT EXISTS idx_entries_name ON entries (name);
CREATE INDEX IF NOT EXISTS idx_entries_volume_ext ON entries (volume_id, extension);
CREATE INDEX IF NOT EXISTS idx_entries_volume_scan ON entries (volume_id, scan_id);
CREATE INDEX IF NOT EXISTS idx_entries_is_dir ON entries (is_directory);
CREATE INDEX IF NOT EXISTS idx_sessions_volume ON indexing_sessions (volume_id);
CREATE INDEX IF NOT EXISTS idx_volumes_drive ON volumes (drive_letter);
`;

export const SCHEMA_V2 = `
-- FTS5 Virtual Table with trigram tokenizer for high-speed substring and path searching
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  name,
  path,
  content='entries',
  content_rowid='id',
  tokenize='trigram'
);

-- Real-time synchronization triggers between entries table and FTS5 index
CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
  INSERT INTO entries_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
END;

-- Additional B-tree indexes for case-insensitive exact and prefix searches
CREATE INDEX IF NOT EXISTS idx_entries_name_nocase ON entries (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_entries_ext_nocase ON entries (extension COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_entries_path_nocase ON entries (path COLLATE NOCASE);
`;

export const SCHEMA_V3 = `
-- Persistent volume synchronization checkpoints (USN journal / filesystem watcher)
CREATE TABLE IF NOT EXISTS volume_checkpoints (
  volume_id INTEGER PRIMARY KEY REFERENCES volumes(id) ON DELETE CASCADE,
  journal_id TEXT,
  first_usn TEXT,
  next_usn TEXT,
  last_processed_usn TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'filesystem_watcher', -- 'usn_journal' | 'filesystem_watcher' | 'reconciling'
  sync_status TEXT NOT NULL DEFAULT 'out_of_sync',      -- 'synced' | 'syncing' | 'reconciling' | 'out_of_sync' | 'error'
  last_sync_timestamp INTEGER,
  checkpoint_timestamp INTEGER NOT NULL,
  error_message TEXT
);

-- Fast lookup indexes for NTFS file reference numbers and parent references
CREATE INDEX IF NOT EXISTS idx_entries_volume_frn ON entries (volume_id, file_reference_number);
CREATE INDEX IF NOT EXISTS idx_entries_volume_parent_frn ON entries (volume_id, parent_reference_number);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON volume_checkpoints (sync_status);
`;
