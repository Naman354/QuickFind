/**
 * Database Schema Definitions for QuickFind
 * Milestone 2: Filesystem Indexing Schema
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

