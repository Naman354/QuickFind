import Database from 'better-sqlite3';
import { SQLITE_CONFIG } from '../../../shared/constants';
import { FileEntryItem, VolumeIndexingState } from '../../../shared/types';

export interface EntryDbRecord {
  volume_id: number;
  name: string;
  path: string;
  parent_path: string;
  extension: string;
  is_directory: number;
  size_bytes: number;
  created_at: number;
  modified_at: number;
  is_hidden: number;
  is_system: number;
  scan_id: number;
  file_reference_number: string | null;
  parent_reference_number: string | null;
  usn: string | null;
}

export class IndexerDb {
  private db: Database.Database;
  private insertEntryStmt: Database.Statement<EntryDbRecord>;
  private insertBatchTx: Database.Transaction<(items: EntryDbRecord[]) => void>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, {
      timeout: SQLITE_CONFIG.BUSY_TIMEOUT_MS,
    });

    // Worker performance settings
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = -32000'); // 32MB in worker
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma(`busy_timeout = ${SQLITE_CONFIG.BUSY_TIMEOUT_MS}`);

    // Prepared statement for upserting entries
    this.insertEntryStmt = this.db.prepare(`
      INSERT INTO entries (
        volume_id, name, path, parent_path, extension,
        is_directory, size_bytes, created_at, modified_at,
        is_hidden, is_system, scan_id,
        file_reference_number, parent_reference_number, usn
      ) VALUES (
        @volume_id, @name, @path, @parent_path, @extension,
        @is_directory, @size_bytes, @created_at, @modified_at,
        @is_hidden, @is_system, @scan_id,
        @file_reference_number, @parent_reference_number, @usn
      )
      ON CONFLICT(volume_id, path) DO UPDATE SET
        name = excluded.name,
        parent_path = excluded.parent_path,
        extension = excluded.extension,
        is_directory = excluded.is_directory,
        size_bytes = excluded.size_bytes,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        is_hidden = excluded.is_hidden,
        is_system = excluded.is_system,
        scan_id = excluded.scan_id,
        file_reference_number = excluded.file_reference_number,
        parent_reference_number = excluded.parent_reference_number,
        usn = excluded.usn;
    `);

    // Bulk insert transaction
    this.insertBatchTx = this.db.transaction((records: EntryDbRecord[]) => {
      for (const record of records) {
        this.insertEntryStmt.run(record);
      }
    });
  }

  /**
   * Persists a batch of collected file and folder entries in a single fast transaction
   */
  public saveBatch(volumeId: number, scanId: number, items: FileEntryItem[]): void {
    if (items.length === 0) return;

    const records: EntryDbRecord[] = items.map(item => ({
      volume_id: volumeId,
      name: item.name,
      path: item.path,
      parent_path: item.parentPath,
      extension: item.extension,
      is_directory: item.isDirectory ? 1 : 0,
      size_bytes: item.sizeBytes,
      created_at: item.createdAt,
      modified_at: item.modifiedAt,
      is_hidden: item.isHidden ? 1 : 0,
      is_system: item.isSystem ? 1 : 0,
      scan_id: scanId,
      file_reference_number: item.fileReferenceNumber || null,
      parent_reference_number: item.parentReferenceNumber || null,
      usn: null,
    }));

    this.insertBatchTx(records);
  }

  /**
   * Updates progress counts on the current indexing session record
   */
  public updateSessionProgress(
    sessionId: number,
    scannedFiles: number,
    scannedFolders: number,
    errorCount: number
  ): void {
    this.db
      .prepare(
        `
        UPDATE indexing_sessions
        SET scanned_files = ?, scanned_folders = ?, error_count = ?
        WHERE id = ?
      `
      )
      .run(scannedFiles, scannedFolders, errorCount, sessionId);
  }

  /**
   * Marks indexing session as successfully completed
   */
  public completeSession(
    sessionId: number,
    volumeId: number,
    scannedFiles: number,
    scannedFolders: number,
    errorCount: number
  ): void {
    const now = Date.now();
    const completeTx = this.db.transaction(() => {
      // 1. Update session status
      this.db
        .prepare(
          `
          UPDATE indexing_sessions
          SET status = 'completed', end_time = ?, scanned_files = ?, scanned_folders = ?, error_count = ?
          WHERE id = ?
        `
        )
        .run(now, scannedFiles, scannedFolders, errorCount, sessionId);

      // 2. Prune stale records from previous scans (ONLY on completed full scan)
      this.db
        .prepare(
          `
          DELETE FROM entries
          WHERE volume_id = ? AND scan_id != ?
        `
        )
        .run(volumeId, sessionId);

      // 3. Mark volume as indexed
      this.db
        .prepare(
          `
          UPDATE volumes
          SET indexing_state = 'indexed', last_scan_id = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(sessionId, now, volumeId);

      // 4. Update volume checkpoint to synced
      this.db
        .prepare(
          `
          INSERT INTO volume_checkpoints (
            volume_id, sync_mode, sync_status, checkpoint_timestamp, last_sync_timestamp
          ) VALUES (?, 'filesystem_watcher', 'synced', ?, ?)
          ON CONFLICT(volume_id) DO UPDATE SET
            sync_status = 'synced',
            last_sync_timestamp = excluded.last_sync_timestamp,
            checkpoint_timestamp = excluded.checkpoint_timestamp,
            error_message = NULL;
        `
        )
        .run(volumeId, now, now);
    });

    completeTx();
  }

  /**
   * Marks indexing session as failed
   */
  public failSession(sessionId: number, volumeId: number, errorMessage: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `
        UPDATE indexing_sessions
        SET status = 'failed', end_time = ?, error_details = ?
        WHERE id = ?
      `
      )
      .run(now, errorMessage, sessionId);

    this.setVolumeState(volumeId, 'error');
  }

  /**
   * Marks indexing session as cancelled
   */
  public cancelSession(sessionId: number, volumeId: number): void {
    const now = Date.now();
    this.db
      .prepare(
        `
        UPDATE indexing_sessions
        SET status = 'cancelled', end_time = ?
        WHERE id = ?
      `
      )
      .run(now, sessionId);

    // Revert volume state to previous status or unindexed
    this.setVolumeState(volumeId, 'unindexed');
  }

  public setVolumeState(volumeId: number, state: VolumeIndexingState): void {
    this.db
      .prepare('UPDATE volumes SET indexing_state = ?, updated_at = ? WHERE id = ?')
      .run(state, Date.now(), volumeId);
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore closing errors on shutdown
    }
  }
}
