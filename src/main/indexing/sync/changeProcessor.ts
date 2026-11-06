import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { FsChangeEvent } from '../../../shared/types';
import { PathUtils } from '../pathUtils';

export interface ProcessChangesResult {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  renamedCount: number;
  errorCount: number;
}

/**
 * ChangeProcessor
 * Applies incremental filesystem mutations (creates, updates, deletes, renames) to SQLite
 * with automatic child-path updates, FTS5 synchronization, and idempotent transactions.
 */
export class ChangeProcessor {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Processes a batch of change events atomically within a single database transaction
   */
  public async processBatch(
    volumeId: number,
    events: FsChangeEvent[],
    currentUsn?: string | null
  ): Promise<ProcessChangesResult> {
    const result: ProcessChangesResult = {
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      errorCount: 0,
    };

    if (events.length === 0) return result;

    // Ensure a valid scan_id exists for foreign key integrity
    let activeScanId: number;
    const volRow = this.db
      .prepare('SELECT last_scan_id FROM volumes WHERE id = ?')
      .get(volumeId) as { last_scan_id: number | null } | undefined;

    if (volRow?.last_scan_id) {
      activeScanId = volRow.last_scan_id;
    } else {
      const existingSession = this.db
        .prepare('SELECT id FROM indexing_sessions WHERE volume_id = ? ORDER BY id DESC LIMIT 1')
        .get(volumeId) as { id: number } | undefined;

      if (existingSession) {
        activeScanId = existingSession.id;
      } else {
        const now = Date.now();
        const newSession = this.db
          .prepare(
            `INSERT INTO indexing_sessions (volume_id, status, start_time, end_time, scanned_files, scanned_folders, error_count)
             VALUES (?, 'completed', ?, ?, 0, 0, 0)`
          )
          .run(volumeId, now, now);
        activeScanId = Number(newSession.lastInsertRowid);
      }

      this.db
        .prepare('UPDATE volumes SET last_scan_id = ? WHERE id = ?')
        .run(activeScanId, volumeId);
    }

    const upsertStmt = this.db.prepare(`
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
        file_reference_number = COALESCE(excluded.file_reference_number, entries.file_reference_number),
        parent_reference_number = COALESCE(excluded.parent_reference_number, entries.parent_reference_number),
        usn = COALESCE(excluded.usn, entries.usn);
    `);

    const deleteStmt = this.db.prepare(`
      DELETE FROM entries
      WHERE volume_id = ? AND (path = ? OR path LIKE ? || '\\%');
    `);

    const updateCheckpointStmt = this.db.prepare(`
      INSERT INTO volume_checkpoints (
        volume_id, sync_status, last_sync_timestamp, checkpoint_timestamp, last_processed_usn
      ) VALUES (?, 'synced', ?, ?, ?)
      ON CONFLICT(volume_id) DO UPDATE SET
        sync_status = 'synced',
        last_sync_timestamp = excluded.last_sync_timestamp,
        checkpoint_timestamp = excluded.checkpoint_timestamp,
        last_processed_usn = COALESCE(excluded.last_processed_usn, volume_checkpoints.last_processed_usn),
        error_message = NULL;
    `);

    // Pre-read stats from the filesystem before opening transaction
    const resolvedEntries: Array<{
      event: FsChangeEvent;
      stat: fs.BigIntStats | null;
      parentFrn: string | null;
    }> = [];

    for (const event of events) {
      if (event.type === 'delete') {
        resolvedEntries.push({ event, stat: null, parentFrn: null });
        continue;
      }

      try {
        const fsPath = PathUtils.toFsPath(event.path);
        const stat = await fs.promises.stat(fsPath, { bigint: true });

        // Retrieve parent FRN if parent directory exists
        let parentFrn: string | null = null;
        try {
          const parentDir = path.dirname(event.path);
          const parentStat = await fs.promises.stat(PathUtils.toFsPath(parentDir), {
            bigint: true,
          });
          if (parentStat.ino) {
            parentFrn = '0x' + parentStat.ino.toString(16);
          }
        } catch {
          // Parent might be drive root or inaccessible
        }

        resolvedEntries.push({ event, stat, parentFrn });
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          // Item was deleted before we could stat it; treat as deletion
          resolvedEntries.push({
            event: { ...event, type: 'delete' },
            stat: null,
            parentFrn: null,
          });
        } else {
          result.errorCount++;
        }
      }
    }

    // Execute database operations in a single fast transaction
    const applyTx = this.db.transaction(() => {
      const now = Date.now();

      for (const item of resolvedEntries) {
        const { event, stat, parentFrn } = item;
        const normalizedPath = PathUtils.normalizePath(event.path);
        const entryName = path.basename(normalizedPath);
        const parentPath = path.dirname(normalizedPath);

        if (event.type === 'delete') {
          // Delete file or folder and all descendants safely
          const res = deleteStmt.run(volumeId, normalizedPath, normalizedPath);
          if (res.changes > 0) {
            result.deletedCount += res.changes;
          }
          continue;
        }

        if (!stat) continue;

        const isDir = stat.isDirectory();
        const sizeBytes = isDir ? 0 : Number(stat.size);
        const createdAt = Math.round(Number(stat.birthtimeMs));
        const modifiedAt = Math.round(Number(stat.mtimeMs));
        const fileRef = stat.ino ? '0x' + stat.ino.toString(16) : null;
        const isHidden = entryName.startsWith('.') || entryName.startsWith('$');

        upsertStmt.run({
          volume_id: volumeId,
          name: entryName,
          path: normalizedPath,
          parent_path: parentPath,
          extension: PathUtils.getExtension(entryName, isDir),
          is_directory: isDir ? 1 : 0,
          size_bytes: sizeBytes,
          created_at: createdAt,
          modified_at: modifiedAt,
          is_hidden: isHidden ? 1 : 0,
          is_system: 0,
          scan_id: activeScanId,
          file_reference_number: fileRef,
          parent_reference_number: parentFrn,
          usn: currentUsn || null,
        });

        if (event.type === 'create') {
          result.createdCount++;
        } else {
          result.updatedCount++;
        }
      }

      // Update checkpoint atomically with the batch
      updateCheckpointStmt.run(volumeId, now, now, currentUsn || null);
    });

    try {
      applyTx();
    } catch (err) {
      console.error(`[QuickFind:ChangeProcessor] Transaction failed for volume ${volumeId}:`, err);
      result.errorCount += events.length;
      throw err;
    }

    return result;
  }

  /**
   * Handles directory renames or moves, updating all descendant paths atomically
   */
  public renamePath(
    volumeId: number,
    oldPath: string,
    newPath: string,
    isDirectory: boolean
  ): void {
    const normOld = PathUtils.normalizePath(oldPath);
    const normNew = PathUtils.normalizePath(newPath);
    const newName = path.basename(normNew);
    const newParent = path.dirname(normNew);

    const renameTx = this.db.transaction(() => {
      if (!isDirectory) {
        // Simple file rename / move
        this.db
          .prepare(
            `
            UPDATE entries
            SET name = ?, path = ?, parent_path = ?, extension = ?, modified_at = ?
            WHERE volume_id = ? AND path = ?;
          `
          )
          .run(
            newName,
            normNew,
            newParent,
            PathUtils.getExtension(newName, false),
            Date.now(),
            volumeId,
            normOld
          );
      } else {
        // Directory rename or move: update the directory and all descendants
        const oldPrefix = normOld + '\\';
        const newPrefix = normNew + '\\';
        const oldPrefixLen = oldPrefix.length;

        // 1. Update the directory record itself
        this.db
          .prepare(
            `
            UPDATE entries
            SET name = ?, path = ?, parent_path = ?, modified_at = ?
            WHERE volume_id = ? AND path = ?;
          `
          )
          .run(newName, normNew, newParent, Date.now(), volumeId, normOld);

        // 2. Update all descendant records' paths and parent_paths
        this.db
          .prepare(
            `
            UPDATE entries
            SET
              path = ? || substr(path, ?),
              parent_path = CASE
                WHEN parent_path = ? THEN ?
                ELSE ? || substr(parent_path, ?)
              END,
              modified_at = ?
            WHERE volume_id = ? AND path LIKE ? || '%';
          `
          )
          .run(
            newPrefix,
            oldPrefixLen,
            normOld,
            normNew,
            newPrefix,
            oldPrefixLen,
            Date.now(),
            volumeId,
            oldPrefix
          );
      }
    });

    renameTx();
  }
}
