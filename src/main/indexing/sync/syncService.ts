import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { DatabaseManager } from '../../database';
import { FilesystemWatcher } from './watcher/filesystemWatcher';
import { ChangeProcessor } from './changeProcessor';
import { UsnReader } from './usn/usnReader';
import { UsnJournalInfo } from './usn/usnTypes';
import { FilesystemScanner } from '../worker/scanner';
import { IndexerDb } from '../worker/indexerDb';
import { PathUtils } from '../pathUtils';
import { logger } from '../../logger';
import {
  FsChangeEvent,
  SyncMode,
  SyncStatus,
  VolumeCheckpoint,
  VolumeSyncStatusUpdate,
} from '../../../shared/types';

const MAX_BUFFERED_EVENTS = 5000;

interface VolumeSyncRuntime {
  volumeId: number;
  driveLetter: string;
  watcher: FilesystemWatcher;
  syncMode: SyncMode;
  syncStatus: SyncStatus;
  currentJournal: UsnJournalInfo | null;
  lastProcessedUsn: string | null;
  lastSyncTimestamp: number | null;
  errorMessage: string | null;
  isScanning: boolean;
  requiresPostScanReconciliation: boolean;
  scanEventBuffer: FsChangeEvent[];
}

/**
 * SyncService
 * Central orchestration service for durable incremental filesystem synchronization,
 * NTFS USN Change Journal batch reading, Windows filesystem monitoring, and full reconciliation.
 */
export class SyncService extends EventEmitter {
  private static instance: SyncService | null = null;
  private runtimes: Map<number, VolumeSyncRuntime> = new Map();
  private isInitialized: boolean = false;

  private constructor() {
    super();
  }

  public static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Initializes synchronization for all indexed volumes on application startup
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.log('[QuickFind:SyncService] Initializing incremental filesystem synchronization...');
    const db = DatabaseManager.getInstance().getDatabase();

    const volumes = db
      .prepare(
        `
        SELECT v.id, v.drive_letter, v.indexing_state,
               c.journal_id, c.first_usn, c.next_usn, c.last_processed_usn,
               c.sync_mode, c.sync_status, c.last_sync_timestamp, c.error_message
        FROM volumes v
        LEFT JOIN volume_checkpoints c ON c.volume_id = v.id;
      `
      )
      .all() as Array<{
      id: number;
      drive_letter: string;
      indexing_state: string;
      journal_id: string | null;
      first_usn: string | null;
      next_usn: string | null;
      last_processed_usn: string | null;
      sync_mode: SyncMode | null;
      sync_status: SyncStatus | null;
      last_sync_timestamp: number | null;
      error_message: string | null;
    }>;

    for (const vol of volumes) {
      if (vol.indexing_state === 'indexed') {
        await this.startMonitoringVolume(vol.id, vol.drive_letter, {
          volumeId: vol.id,
          journalId: vol.journal_id,
          firstUsn: vol.first_usn,
          nextUsn: vol.next_usn,
          lastProcessedUsn: vol.last_processed_usn,
          syncMode: vol.sync_mode || 'filesystem_watcher',
          syncStatus: vol.sync_status || 'out_of_sync',
          lastSyncTimestamp: vol.last_sync_timestamp,
          checkpointTimestamp: Date.now(),
          errorMessage: vol.error_message,
        });
      }
    }
  }

  /**
   * Starts monitoring an indexed volume, validating checkpoints and recovering state
   */
  public async startMonitoringVolume(
    volumeId: number,
    driveLetter: string,
    existingCheckpoint?: VolumeCheckpoint
  ): Promise<void> {
    if (this.runtimes.has(volumeId)) {
      return;
    }

    const rootPath = driveLetter.endsWith('\\') ? driveLetter : driveLetter + '\\';
    console.log(
      `[QuickFind:SyncService] Configuring synchronization for volume ${volumeId} (${rootPath})...`
    );

    // 1. Check USN capabilities and query current journal metadata
    const capability = await UsnReader.checkCapability(driveLetter);
    const journalInfo = capability.journalInfo;

    let syncMode: SyncMode = 'filesystem_watcher';
    const syncStatus: SyncStatus = 'synced';
    const errorMessage: string | null = null;
    let lastUsn = existingCheckpoint?.lastProcessedUsn || journalInfo?.nextUsn || null;

    const db = DatabaseManager.getInstance().getDatabase();
    const processor = new ChangeProcessor(db);

    // 2. Validate saved journal checkpoint
    if (journalInfo && existingCheckpoint?.lastProcessedUsn) {
      const validation = UsnReader.isCheckpointValid(existingCheckpoint, journalInfo);

      if (!validation.valid) {
        console.warn(
          `[QuickFind:SyncService] Checkpoint invalid for volume ${volumeId} (reason: ${validation.reason}). Initiating full volume reconciliation.`
        );
        // Full volume reconciliation when journal history is unavailable or rolled over
        await this.reconcileVolumeFull(volumeId);
        return;
      }

      // Checkpoint is valid: attempt durable catch-up
      if (capability.canReadRecords) {
        console.log(
          `[QuickFind:SyncService] Reading USN Journal catch-up records from ${existingCheckpoint.lastProcessedUsn}...`
        );
        try {
          let currentStartUsn = existingCheckpoint.lastProcessedUsn;
          let hasMore = true;
          let totalRecordsProcessed = 0;

          while (hasMore) {
            const readRes = await UsnReader.readJournal(
              driveLetter,
              currentStartUsn,
              journalInfo.journalId
            );

            if (readRes.error) {
              console.warn(
                `[QuickFind:SyncService] Catch-up read returned error: ${readRes.error}`
              );
              break;
            }

            if (readRes.records.length > 0) {
              await processor.processUsnBatch(volumeId, readRes.records, readRes.nextUsn);
              totalRecordsProcessed += readRes.records.length;
              currentStartUsn = readRes.nextUsn;
            }

            hasMore = readRes.hasMore && readRes.records.length > 0;
          }

          syncMode = 'usn_journal';
          lastUsn = currentStartUsn;
          console.log(
            `[QuickFind:SyncService] USN Journal catch-up completed: ${totalRecordsProcessed} records applied (Next USN: ${lastUsn})`
          );
        } catch (catchErr) {
          console.error(
            `[QuickFind:SyncService] Catch-up failed for volume ${volumeId}:`,
            catchErr
          );
        }
      } else {
        console.log(
          `[QuickFind:SyncService] Running without Administrator rights. Using live filesystem watcher for volume ${volumeId}.`
        );
      }
    }

    // 3. Initialize native recursive filesystem watcher (ReadDirectoryChangesW)
    const watcher = new FilesystemWatcher({
      volumeId,
      rootPath,
    });

    const runtime: VolumeSyncRuntime = {
      volumeId,
      driveLetter,
      watcher,
      syncMode,
      syncStatus,
      currentJournal: journalInfo,
      lastProcessedUsn: lastUsn,
      lastSyncTimestamp: Date.now(),
      errorMessage,
      isScanning: false,
      requiresPostScanReconciliation: false,
      scanEventBuffer: [],
    };

    this.runtimes.set(volumeId, runtime);

    // 4. Connect watcher event listeners
    watcher.on('changes', async ({ changes }: { changes: FsChangeEvent[] }) => {
      await this.handleVolumeChanges(volumeId, changes);
    });

    // 5. Watcher buffer overflow: attempt USN journal catch-up before reconciliation
    watcher.on('overflow', async () => {
      console.warn(
        `[QuickFind:SyncService] Watcher buffer overflow on volume ${volumeId}. Attempting USN Journal catch-up...`
      );
      runtime.syncStatus = 'syncing';
      this.broadcastStatus(volumeId);

      try {
        let caughtUp = false;
        if (runtime.lastProcessedUsn && runtime.currentJournal?.journalId) {
          const catchupRes = await UsnReader.readJournal(
            runtime.driveLetter,
            runtime.lastProcessedUsn,
            runtime.currentJournal.journalId
          );

          if (!catchupRes.error && catchupRes.records.length > 0) {
            await processor.processUsnBatch(volumeId, catchupRes.records, catchupRes.nextUsn);
            runtime.lastProcessedUsn = catchupRes.nextUsn;
            runtime.syncStatus = 'synced';
            caughtUp = true;
            console.log(
              `[QuickFind:SyncService] Successfully caught up ${catchupRes.records.length} records via USN Journal after overflow.`
            );
          }
        }

        if (!caughtUp) {
          console.warn(
            `[QuickFind:SyncService] USN catch-up unavailable. Triggering full volume reconciliation...`
          );
          await this.reconcileVolumeFull(volumeId);
        }
      } catch (err) {
        console.error(`[QuickFind:SyncService] Error recovering from buffer overflow:`, err);
        await this.reconcileVolumeFull(volumeId);
      }
    });

    watcher.on('error', ({ error }: { error: string }) => {
      logger.error('SyncService', `Filesystem monitor error on volume ${volumeId}: ${error}`);
      runtime.syncStatus = 'error';
      runtime.errorMessage = error;
      this.broadcastStatus(volumeId);
    });

    watcher.start();

    // 6. Save updated checkpoint to database
    this.saveCheckpoint(volumeId, {
      volumeId,
      journalId: journalInfo?.journalId || null,
      firstUsn: journalInfo?.firstUsn || null,
      nextUsn: journalInfo?.nextUsn || null,
      lastProcessedUsn: lastUsn,
      syncMode,
      syncStatus,
      lastSyncTimestamp: Date.now(),
      checkpointTimestamp: Date.now(),
      errorMessage,
    });

    this.broadcastStatus(volumeId);
  }

  /**
   * Prepares a volume for an initial scan by buffering events to prevent race conditions
   */
  public async prepareVolumeForScan(volumeId: number, driveLetter: string): Promise<void> {
    const rootPath = driveLetter.endsWith('\\') ? driveLetter : driveLetter + '\\';
    let runtime = this.runtimes.get(volumeId);

    if (!runtime) {
      const watcher = new FilesystemWatcher({ volumeId, rootPath });
      runtime = {
        volumeId,
        driveLetter,
        watcher,
        syncMode: 'filesystem_watcher',
        syncStatus: 'syncing',
        currentJournal: await UsnReader.queryJournal(driveLetter),
        lastProcessedUsn: null,
        lastSyncTimestamp: null,
        errorMessage: null,
        isScanning: true,
        requiresPostScanReconciliation: false,
        scanEventBuffer: [],
      };
      this.runtimes.set(volumeId, runtime);

      watcher.on('changes', async ({ changes }: { changes: FsChangeEvent[] }) => {
        await this.handleVolumeChanges(volumeId, changes);
      });
      watcher.start();
    } else {
      runtime.isScanning = true;
      runtime.requiresPostScanReconciliation = false;
      runtime.scanEventBuffer = [];
      runtime.syncStatus = 'syncing';
    }

    console.log(
      `[QuickFind:SyncService] Race condition protection active: buffering events for volume ${volumeId}`
    );
  }

  /**
   * Finalizes an initial volume scan by replaying buffered changes and declaring the volume synced
   */
  public async finalizeVolumeScan(volumeId: number): Promise<void> {
    const runtime = this.runtimes.get(volumeId);
    if (!runtime) return;

    runtime.isScanning = false;
    const buffered = runtime.scanEventBuffer;
    runtime.scanEventBuffer = [];

    // If buffer limit was exceeded during scan, execute full reconciliation
    if (runtime.requiresPostScanReconciliation) {
      console.log(
        `[QuickFind:SyncService] Buffer limit was exceeded during initial scan. Running full reconciliation for volume ${volumeId}...`
      );
      runtime.requiresPostScanReconciliation = false;
      await this.reconcileVolumeFull(volumeId);
      return;
    }

    if (buffered.length > 0) {
      console.log(
        `[QuickFind:SyncService] Replaying ${buffered.length} buffered changes collected during scan for volume ${volumeId}...`
      );
      const db = DatabaseManager.getInstance().getDatabase();
      const processor = new ChangeProcessor(db);
      await processor.processBatch(volumeId, buffered, runtime.lastProcessedUsn);
    }

    // Capture latest USN checkpoint
    const currentJournal = await UsnReader.queryJournal(runtime.driveLetter);
    if (currentJournal) {
      runtime.currentJournal = currentJournal;
      runtime.lastProcessedUsn = currentJournal.nextUsn;
    }

    runtime.syncStatus = 'synced';
    runtime.lastSyncTimestamp = Date.now();
    this.saveCheckpoint(volumeId, {
      volumeId,
      journalId: runtime.currentJournal?.journalId || null,
      firstUsn: runtime.currentJournal?.firstUsn || null,
      nextUsn: runtime.currentJournal?.nextUsn || null,
      lastProcessedUsn: runtime.lastProcessedUsn,
      syncMode: runtime.syncMode,
      syncStatus: runtime.syncStatus,
      lastSyncTimestamp: runtime.lastSyncTimestamp,
      checkpointTimestamp: Date.now(),
      errorMessage: null,
    });

    console.log(`[QuickFind:SyncService] Volume ${volumeId} marked as fully synchronized.`);
    this.broadcastStatus(volumeId);
  }

  /**
   * Handles incoming filesystem changes for a volume
   */
  private async handleVolumeChanges(volumeId: number, changes: FsChangeEvent[]): Promise<void> {
    const runtime = this.runtimes.get(volumeId);
    if (!runtime) return;

    // If an initial scan is actively running, buffer events with bound protection
    if (runtime.isScanning) {
      if (runtime.scanEventBuffer.length < MAX_BUFFERED_EVENTS) {
        runtime.scanEventBuffer.push(...changes);
      } else {
        runtime.requiresPostScanReconciliation = true;
      }
      return;
    }

    try {
      const db = DatabaseManager.getInstance().getDatabase();
      const processor = new ChangeProcessor(db);

      const result = await processor.processBatch(volumeId, changes, runtime.lastProcessedUsn);
      runtime.lastSyncTimestamp = Date.now();
      runtime.syncStatus = 'synced';
      runtime.errorMessage = null;

      console.log(
        `[QuickFind:SyncService] Applied ${changes.length} changes for volume ${volumeId} (+${result.createdCount} / ~${result.updatedCount} / -${result.deletedCount})`
      );
      this.broadcastStatus(volumeId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[QuickFind:SyncService] Failed to process changes for volume ${volumeId}:`,
        errMsg
      );
      runtime.syncStatus = 'error';
      runtime.errorMessage = errMsg;
      this.broadcastStatus(volumeId);
    }
  }

  /**
   * Performs full volume reconciliation by scanning the filesystem and reconciling the SQLite database.
   * Guarantees total index consistency when USN journal history is lost or rolled over.
   */
  public async reconcileVolumeFull(volumeId: number): Promise<void> {
    const db = DatabaseManager.getInstance().getDatabase();
    const volRow = db.prepare('SELECT drive_letter FROM volumes WHERE id = ?').get(volumeId) as
      { drive_letter: string } | undefined;

    if (!volRow) return;

    const runtime = this.runtimes.get(volumeId);
    if (runtime) {
      runtime.syncStatus = 'reconciling';
      this.broadcastStatus(volumeId);
    }

    const driveLetter = volRow.drive_letter;
    const rootPath = driveLetter.endsWith('\\') ? driveLetter : driveLetter + '\\';
    console.log(`[QuickFind:SyncService] Full volume reconciliation running for ${driveLetter}...`);

    const now = Date.now();
    const sessionRes = db
      .prepare(
        `INSERT INTO indexing_sessions (volume_id, status, start_time, scanned_files, scanned_folders, error_count)
         VALUES (?, 'running', ?, 0, 0, 0)`
      )
      .run(volumeId, now);

    const sessionId = Number(sessionRes.lastInsertRowid);
    const indexerDb = new IndexerDb(db.name);

    try {
      const scanResult = await FilesystemScanner.scan(rootPath, {
        onBatch: items => {
          indexerDb.saveBatch(volumeId, sessionId, items);
        },
        onProgress: (files, folders, errors) => {
          indexerDb.updateSessionProgress(sessionId, files, folders, errors);
        },
        isCancelled: () => false,
      });

      indexerDb.completeSession(
        sessionId,
        volumeId,
        scanResult.scannedFiles,
        scanResult.scannedFolders,
        scanResult.errors
      );

      const journalInfo = await UsnReader.queryJournal(driveLetter);

      if (runtime) {
        runtime.syncStatus = 'synced';
        runtime.currentJournal = journalInfo;
        runtime.lastProcessedUsn = journalInfo?.nextUsn || null;
        runtime.lastSyncTimestamp = Date.now();
        runtime.errorMessage = null;
      }

      this.saveCheckpoint(volumeId, {
        volumeId,
        journalId: journalInfo?.journalId || null,
        firstUsn: journalInfo?.firstUsn || null,
        nextUsn: journalInfo?.nextUsn || null,
        lastProcessedUsn: journalInfo?.nextUsn || null,
        syncMode: 'filesystem_watcher',
        syncStatus: 'synced',
        lastSyncTimestamp: Date.now(),
        checkpointTimestamp: Date.now(),
        errorMessage: null,
      });

      console.log(
        `[QuickFind:SyncService] Full volume reconciliation completed successfully for ${driveLetter}.`
      );
      this.broadcastStatus(volumeId);
    } catch (err) {
      console.error(
        `[QuickFind:SyncService] Full reconciliation failed for volume ${volumeId}:`,
        err
      );
      indexerDb.failSession(sessionId, volumeId, err instanceof Error ? err.message : String(err));
      if (runtime) {
        runtime.syncStatus = 'error';
        runtime.errorMessage = 'Reconciliation failed';
        this.broadcastStatus(volumeId);
      }
    } finally {
      indexerDb.close();
    }
  }

  /**
   * Performs targeted directory differential reconciliation against the SQLite database
   */
  public async reconcileDirectory(volumeId: number, targetDir: string): Promise<number> {
    const normDir = PathUtils.normalizePath(targetDir);
    const db = DatabaseManager.getInstance().getDatabase();
    let reconciledCount = 0;

    console.log(`[QuickFind:SyncService] Targeted reconciliation started for: ${normDir}`);

    try {
      const fsEntries = await fs.promises.readdir(PathUtils.toFsPath(normDir), {
        withFileTypes: true,
      });
      const diskEntryNames = new Set(fsEntries.map(e => e.name));

      // 1. Query existing DB entries under this parent path
      const dbRows = db
        .prepare('SELECT name, path FROM entries WHERE volume_id = ? AND parent_path = ?')
        .all(volumeId, normDir) as Array<{ name: string; path: string }>;

      const dbEntryNames = new Set(dbRows.map(r => r.name));

      // 2. Identify deleted items safely using substr() rather than SQL LIKE
      const toDelete = dbRows.filter(r => !diskEntryNames.has(r.name));
      if (toDelete.length > 0) {
        const deleteStmt = db.prepare(
          'DELETE FROM entries WHERE volume_id = ? AND (path = ? OR substr(path, 1, ?) = ?)'
        );
        const delTx = db.transaction(() => {
          for (const item of toDelete) {
            const prefix = item.path + '\\';
            deleteStmt.run(volumeId, item.path, prefix.length, prefix);
          }
        });
        delTx();
        reconciledCount += toDelete.length;
      }

      // 3. Identify new or modified items on disk
      const newOrModified: FsChangeEvent[] = [];
      for (const dirent of fsEntries) {
        if (!dbEntryNames.has(dirent.name)) {
          newOrModified.push({
            type: 'create',
            path: path.join(normDir, dirent.name),
            isDirectory: dirent.isDirectory(),
            timestamp: Date.now(),
          });
        }
      }

      if (newOrModified.length > 0) {
        const processor = new ChangeProcessor(db);
        await processor.processBatch(volumeId, newOrModified);
        reconciledCount += newOrModified.length;
      }

      console.log(
        `[QuickFind:SyncService] Reconciliation completed for ${normDir} (${reconciledCount} entries adjusted)`
      );
    } catch (err) {
      console.warn(`[QuickFind:SyncService] Error during reconciliation of ${normDir}:`, err);
    }

    return reconciledCount;
  }

  /**
   * Reconciles an entire volume
   */
  public async reconcileVolume(volumeId: number): Promise<number> {
    await this.reconcileVolumeFull(volumeId);
    return 1;
  }

  /**
   * Retrieves checkpoints for all volumes
   */
  public getCheckpoints(): Record<number, VolumeCheckpoint> {
    const db = DatabaseManager.getInstance().getDatabase();
    const rows = db.prepare('SELECT * FROM volume_checkpoints').all() as Array<{
      volume_id: number;
      journal_id: string | null;
      first_usn: string | null;
      next_usn: string | null;
      last_processed_usn: string | null;
      sync_mode: SyncMode;
      sync_status: SyncStatus;
      last_sync_timestamp: number | null;
      checkpoint_timestamp: number;
      error_message: string | null;
    }>;

    const result: Record<number, VolumeCheckpoint> = {};
    for (const row of rows) {
      result[row.volume_id] = {
        volumeId: row.volume_id,
        journalId: row.journal_id,
        firstUsn: row.first_usn,
        nextUsn: row.next_usn,
        lastProcessedUsn: row.last_processed_usn,
        syncMode: row.sync_mode,
        syncStatus: row.sync_status,
        lastSyncTimestamp: row.last_sync_timestamp,
        checkpointTimestamp: row.checkpoint_timestamp,
        errorMessage: row.error_message,
      };
    }

    return result;
  }

  /**
   * Persists a volume checkpoint in SQLite
   */
  private saveCheckpoint(volumeId: number, checkpoint: VolumeCheckpoint): void {
    const db = DatabaseManager.getInstance().getDatabase();
    db.prepare(
      `
      INSERT INTO volume_checkpoints (
        volume_id, journal_id, first_usn, next_usn, last_processed_usn,
        sync_mode, sync_status, last_sync_timestamp, checkpoint_timestamp, error_message
      ) VALUES (
        @volumeId, @journalId, @firstUsn, @nextUsn, @lastProcessedUsn,
        @syncMode, @syncStatus, @lastSyncTimestamp, @checkpointTimestamp, @errorMessage
      )
      ON CONFLICT(volume_id) DO UPDATE SET
        journal_id = excluded.journal_id,
        first_usn = excluded.first_usn,
        next_usn = excluded.next_usn,
        last_processed_usn = excluded.last_processed_usn,
        sync_mode = excluded.sync_mode,
        sync_status = excluded.sync_status,
        last_sync_timestamp = excluded.last_sync_timestamp,
        checkpoint_timestamp = excluded.checkpoint_timestamp,
        error_message = excluded.error_message;
    `
    ).run({
      volumeId: checkpoint.volumeId,
      journalId: checkpoint.journalId,
      firstUsn: checkpoint.firstUsn,
      nextUsn: checkpoint.nextUsn,
      lastProcessedUsn: checkpoint.lastProcessedUsn,
      syncMode: checkpoint.syncMode,
      syncStatus: checkpoint.syncStatus,
      lastSyncTimestamp: checkpoint.lastSyncTimestamp,
      checkpointTimestamp: checkpoint.checkpointTimestamp,
      errorMessage: checkpoint.errorMessage || null,
    });
  }

  /**
   * Broadcasts a volume synchronization update to registered listeners
   */
  private broadcastStatus(volumeId: number): void {
    const runtime = this.runtimes.get(volumeId);
    if (!runtime) return;

    const update: VolumeSyncStatusUpdate = {
      volumeId,
      driveLetter: runtime.driveLetter,
      syncMode: runtime.syncMode,
      syncStatus: runtime.syncStatus,
      lastProcessedUsn: runtime.lastProcessedUsn,
      lastSyncTimestamp: runtime.lastSyncTimestamp,
      errorMessage: runtime.errorMessage,
    };

    this.emit('statusUpdate', update);
  }

  /**
   * Gracefully stops all active volume monitors
   */
  public async dispose(): Promise<void> {
    console.log('[QuickFind:SyncService] Stopping all volume watchers...');
    for (const runtime of this.runtimes.values()) {
      runtime.watcher.stop();
    }
    this.runtimes.clear();
    this.isInitialized = false;
  }
}
