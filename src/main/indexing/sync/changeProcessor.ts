import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { FsChangeEvent } from '../../../shared/types';
import { USN_REASONS, UsnRecord } from './usn/usnTypes';
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
 * Applies incremental filesystem mutations (creates, updates, deletes, renames) to SQLite.
 * Uses safe path-prefix comparisons (protecting filenames with % and _), handles USN rename pairing,
 * and maintains atomic transactions with FTS5 synchronization triggers.
 */
export class ChangeProcessor {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Ensures a valid indexing_sessions record exists for foreign key constraints
   */
  private ensureActiveScanId(volumeId: number): number {
    const volRow = this.db
      .prepare('SELECT last_scan_id FROM volumes WHERE id = ?')
      .get(volumeId) as { last_scan_id: number | null } | undefined;

    if (volRow?.last_scan_id) {
      return volRow.last_scan_id;
    }

    const existingSession = this.db
      .prepare('SELECT id FROM indexing_sessions WHERE volume_id = ? ORDER BY id DESC LIMIT 1')
      .get(volumeId) as { id: number } | undefined;

    if (existingSession) {
      this.db
        .prepare('UPDATE volumes SET last_scan_id = ? WHERE id = ?')
        .run(existingSession.id, volumeId);
      return existingSession.id;
    }

    const now = Date.now();
    const newSession = this.db
      .prepare(
        `INSERT INTO indexing_sessions (volume_id, status, start_time, end_time, scanned_files, scanned_folders, error_count)
         VALUES (?, 'completed', ?, ?, 0, 0, 0)`
      )
      .run(volumeId, now, now);

    const scanId = Number(newSession.lastInsertRowid);
    this.db.prepare('UPDATE volumes SET last_scan_id = ? WHERE id = ?').run(scanId, volumeId);
    return scanId;
  }

  /**
   * Processes a batch of live filesystem watcher change events
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

    const activeScanId = this.ensureActiveScanId(volumeId);

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

    // Safe path prefix deletion using substr() to prevent % and _ SQL wildcards in filenames
    const deleteStmt = this.db.prepare(`
      DELETE FROM entries
      WHERE volume_id = ? AND (path = ? OR substr(path, 1, ?) = ?);
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

    // Pre-read stats from disk before opening transaction
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
          // File was removed before stat; treat as delete
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

    // Execute batch inside database transaction
    const applyTx = this.db.transaction(() => {
      const now = Date.now();

      for (const item of resolvedEntries) {
        const { event, stat, parentFrn } = item;
        const normalizedPath = PathUtils.normalizePath(event.path);
        const entryName = path.basename(normalizedPath);
        const parentPath = path.dirname(normalizedPath);

        if (event.type === 'delete') {
          const prefix = normalizedPath + '\\';
          const res = deleteStmt.run(volumeId, normalizedPath, prefix.length, prefix);
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

      updateCheckpointStmt.run(volumeId, now, now, currentUsn || null);
    });

    try {
      applyTx();
    } catch (err) {
      console.error(
        `[QuickFind:ChangeProcessor] Batch transaction failed for volume ${volumeId}:`,
        err
      );
      result.errorCount += events.length;
      throw err;
    }

    return result;
  }

  /**
   * Processes a batch of records directly from NTFS USN Change Journal.
   * Handles rename old-name/new-name pairing, parent FRN resolution, and idempotent mutations.
   */
  public async processUsnBatch(
    volumeId: number,
    records: UsnRecord[],
    currentUsn: string
  ): Promise<ProcessChangesResult> {
    const result: ProcessChangesResult = {
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      errorCount: 0,
    };

    if (records.length === 0) return result;

    const _activeScanId = this.ensureActiveScanId(volumeId);

    // Queries for FRN and Parent FRN resolution
    const findByFrnStmt = this.db.prepare(
      'SELECT id, name, path, parent_path, is_directory FROM entries WHERE volume_id = ? AND file_reference_number = ?'
    );
    const findPathByParentFrnStmt = this.db.prepare(
      'SELECT path FROM entries WHERE volume_id = ? AND file_reference_number = ? AND is_directory = 1'
    );

    // Map for pairing RENAME_OLD_NAME and RENAME_NEW_NAME
    const pendingRenames = new Map<string, UsnRecord>();

    // Collect resolved filesystem mutations
    const fileChanges: FsChangeEvent[] = [];
    const renameOperations: Array<{ oldPath: string; newPath: string; isDir: boolean }> = [];

    for (const record of records) {
      const reason = record.reason;

      // 1. Handle Rename Old-Name
      if (reason & USN_REASONS.RENAME_OLD_NAME) {
        pendingRenames.set(record.fileReferenceNumber, record);
        continue;
      }

      // 2. Handle Rename New-Name
      if (reason & USN_REASONS.RENAME_NEW_NAME) {
        const oldRecord = pendingRenames.get(record.fileReferenceNumber);
        pendingRenames.delete(record.fileReferenceNumber);

        // Find existing record in SQLite by FRN
        const existing = findByFrnStmt.get(volumeId, record.fileReferenceNumber) as
          | { id: number; name: string; path: string; parent_path: string; is_directory: number }
          | undefined;

        if (existing) {
          // Resolve new parent path
          let newParentPath = existing.parent_path;
          if (
            oldRecord &&
            oldRecord.parentFileReferenceNumber !== record.parentFileReferenceNumber
          ) {
            const parentRow = findPathByParentFrnStmt.get(
              volumeId,
              record.parentFileReferenceNumber
            ) as { path: string } | undefined;
            if (parentRow) newParentPath = parentRow.path;
          }

          const newPath = path.join(newParentPath, record.filename);
          renameOperations.push({
            oldPath: existing.path,
            newPath,
            isDir: Boolean(existing.is_directory),
          });
          continue;
        }
      }

      // 3. Handle File / Directory Deletion
      if (reason & USN_REASONS.FILE_DELETE) {
        const existing = findByFrnStmt.get(volumeId, record.fileReferenceNumber) as
          { path: string; is_directory: number } | undefined;

        if (existing) {
          fileChanges.push({
            type: 'delete',
            path: existing.path,
            isDirectory: Boolean(existing.is_directory),
            timestamp: record.timestamp || Date.now(),
          });
        }
        continue;
      }

      // 4. Handle File / Directory Creation & Modification
      if (
        reason &
          (USN_REASONS.FILE_CREATE |
            USN_REASONS.CLOSE |
            USN_REASONS.DATA_OVERWRITE |
            USN_REASONS.DATA_EXTEND) &&
        record.filename
      ) {
        // Resolve parent path from parent FRN
        const parentRow = findPathByParentFrnStmt.get(
          volumeId,
          record.parentFileReferenceNumber
        ) as { path: string } | undefined;

        if (parentRow) {
          const itemPath = path.join(parentRow.path, record.filename);
          fileChanges.push({
            type: reason & USN_REASONS.FILE_CREATE ? 'create' : 'update',
            path: itemPath,
            timestamp: record.timestamp || Date.now(),
          });
        }
      }
    }

    // Execute rename operations
    for (const op of renameOperations) {
      try {
        this.renamePath(volumeId, op.oldPath, op.newPath, op.isDir);
        result.renamedCount++;
      } catch (err) {
        console.warn(`[QuickFind:ChangeProcessor] Rename failed for ${op.oldPath}:`, err);
        result.errorCount++;
      }
    }

    // Execute creations, modifications, and deletions
    if (fileChanges.length > 0) {
      const batchRes = await this.processBatch(volumeId, fileChanges, currentUsn);
      result.createdCount += batchRes.createdCount;
      result.updatedCount += batchRes.updatedCount;
      result.deletedCount += batchRes.deletedCount;
      result.errorCount += batchRes.errorCount;
    }

    return result;
  }

  /**
   * Safely updates paths for a renamed or moved directory and all its descendants.
   * Uses safe exact prefix comparisons (protecting % and _ in valid Windows filenames).
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

        // 2. Update all descendant records' paths and parent_paths safely
        // Uses substr(path, 1, oldPrefixLen) = oldPrefix rather than unescaped SQL LIKE
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
            WHERE volume_id = ? AND substr(path, 1, ?) = ?;
          `
          )
          .run(
            newPrefix,
            oldPrefixLen + 1,
            normOld,
            normNew,
            newPrefix,
            oldPrefixLen + 1,
            Date.now(),
            volumeId,
            oldPrefixLen,
            oldPrefix
          );
      }
    });

    renameTx();
  }
}
