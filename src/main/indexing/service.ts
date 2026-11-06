import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { IIndexingEngine } from './types';
import { VolumeDiscovery } from './volumeDiscovery';
import { DatabaseManager } from '../database';
import { getAppConfig } from '../config/appConfig';
import { SyncService } from './sync/syncService';
import { logger } from '../logger';
import {
  GlobalIndexingState,
  IndexingProgressUpdate,
  IndexingStatus,
  SyncMode,
  SyncStatus,
  VolumeInfo,
  VolumeIndexingState,
} from '../../shared/types';

interface VolumeDbRow {
  id: number;
  volume_guid: string | null;
  drive_letter: string;
  label: string;
  file_system: string;
  total_bytes: number;
  free_bytes: number;
  indexing_state: VolumeIndexingState;
  last_scan_id: number | null;
  last_scan_timestamp: number | null;
  entry_count: number;
  journal_id?: string | null;
  first_usn?: string | null;
  next_usn?: string | null;
  last_processed_usn?: string | null;
  sync_mode?: SyncMode | null;
  sync_status?: SyncStatus | null;
  last_sync_timestamp?: number | null;
  checkpoint_timestamp?: number | null;
  error_message?: string | null;
}

export class IndexingService implements IIndexingEngine {
  private static instance: IndexingService | null = null;
  private worker: Worker | null = null;
  private state: GlobalIndexingState = 'idle';
  private activeProgress: IndexingProgressUpdate | null = null;
  private activeSessionId: number | null = null;
  private activeVolumeId: number | null = null;
  private scanStartTime: number = 0;
  private lastError: string | null = null;
  private progressListeners: Set<(update: IndexingProgressUpdate) => void> = new Set();

  private constructor() {}

  public static getInstance(): IndexingService {
    if (!IndexingService.instance) {
      IndexingService.instance = new IndexingService();
    }
    return IndexingService.instance;
  }

  /**
   * Initializes volume discovery and synchronizes local NTFS drives with SQLite
   */
  public async initialize(): Promise<void> {
    try {
      console.log('[QuickFind:IndexingService] Discovering NTFS volumes...');
      await this.discoverAndSyncVolumes();
      // Initialize incremental synchronization and filesystem monitoring
      await SyncService.getInstance().initialize();
    } catch (err) {
      console.error('[QuickFind:IndexingService] Initial volume discovery failed:', err);
    }
  }

  /**
   * Scans system for NTFS drives and synchronizes records into SQLite
   */
  public async discoverAndSyncVolumes(): Promise<VolumeInfo[]> {
    const db = DatabaseManager.getInstance().getDatabase();
    const discovered = await VolumeDiscovery.discoverNtfsVolumes();
    const now = Date.now();

    const upsertStmt = db.prepare(`
      INSERT INTO volumes (
        drive_letter, volume_guid, label, file_system,
        total_bytes, free_bytes, indexing_state, created_at, updated_at
      ) VALUES (
        @drive_letter, @volume_guid, @label, @file_system,
        @total_bytes, @free_bytes, 'unindexed', @created_at, @updated_at
      )
      ON CONFLICT(drive_letter) DO UPDATE SET
        label = excluded.label,
        volume_guid = COALESCE(excluded.volume_guid, volumes.volume_guid),
        total_bytes = excluded.total_bytes,
        free_bytes = excluded.free_bytes,
        updated_at = excluded.updated_at;
    `);

    const syncTx = db.transaction(() => {
      for (const vol of discovered) {
        upsertStmt.run({
          drive_letter: vol.driveLetter,
          volume_guid: vol.volumeGuid,
          label: vol.label,
          file_system: vol.fileSystem,
          total_bytes: vol.totalBytes,
          free_bytes: vol.freeBytes,
          created_at: now,
          updated_at: now,
        });
      }
    });

    syncTx();
    return this.getVolumes();
  }

  /**
   * Returns all known volumes with metadata and current indexing state
   */
  public async getVolumes(): Promise<VolumeInfo[]> {
    const db = DatabaseManager.getInstance().getDatabase();

    const rows = db
      .prepare(
        `
        SELECT
          v.*,
          (SELECT COUNT(*) FROM entries e WHERE e.volume_id = v.id) as entry_count,
          (SELECT s.start_time FROM indexing_sessions s WHERE s.id = v.last_scan_id) as last_scan_timestamp,
          c.journal_id, c.first_usn, c.next_usn, c.last_processed_usn,
          c.sync_mode, c.sync_status, c.last_sync_timestamp, c.checkpoint_timestamp, c.error_message
        FROM volumes v
        LEFT JOIN volume_checkpoints c ON c.volume_id = v.id
        ORDER BY v.drive_letter ASC;
      `
      )
      .all() as VolumeDbRow[];

    return rows.map(r => ({
      id: r.id,
      driveLetter: r.drive_letter,
      label: r.label,
      fileSystem: r.file_system,
      volumeGuid: r.volume_guid,
      totalBytes: r.total_bytes,
      freeBytes: r.free_bytes,
      indexingState: r.indexing_state,
      lastScanId: r.last_scan_id,
      lastScanTimestamp: r.last_scan_timestamp,
      entryCount: r.entry_count,
      checkpoint: r.sync_status
        ? {
            volumeId: r.id,
            journalId: r.journal_id || null,
            firstUsn: r.first_usn || null,
            nextUsn: r.next_usn || null,
            lastProcessedUsn: r.last_processed_usn || null,
            syncMode: r.sync_mode || 'filesystem_watcher',
            syncStatus: r.sync_status || 'out_of_sync',
            lastSyncTimestamp: r.last_sync_timestamp || null,
            checkpointTimestamp: r.checkpoint_timestamp || Date.now(),
            errorMessage: r.error_message || null,
          }
        : null,
    }));
  }

  /**
   * Starts recursive indexing of a volume in a dedicated background worker thread
   */
  public async startIndexing(volumeId: number): Promise<{ sessionId: number }> {
    if (this.state === 'indexing') {
      throw new Error('An indexing session is already in progress');
    }

    const db = DatabaseManager.getInstance().getDatabase();
    const config = getAppConfig();

    const volume = db.prepare('SELECT * FROM volumes WHERE id = ?').get(volumeId) as
      VolumeDbRow | undefined;

    if (!volume) {
      throw new Error(`Volume with id ${volumeId} not found`);
    }

    // 1. Create a new session record
    const now = Date.now();
    const sessionRes = db
      .prepare(
        `
        INSERT INTO indexing_sessions (volume_id, status, start_time, scanned_files, scanned_folders, error_count)
        VALUES (?, 'running', ?, 0, 0, 0)
      `
      )
      .run(volumeId, now);

    const sessionId = Number(sessionRes.lastInsertRowid);
    this.activeSessionId = sessionId;
    this.activeVolumeId = volumeId;
    this.scanStartTime = now;
    this.state = 'indexing';
    this.lastError = null;

    // 2. Mark volume state as indexing
    db.prepare('UPDATE volumes SET indexing_state = ?, updated_at = ? WHERE id = ?').run(
      'indexing',
      now,
      volumeId
    );

    const rootPath = volume.drive_letter + '\\';

    // 3. Prepare sync service to buffer filesystem events during scan (race condition protection)
    await SyncService.getInstance().prepareVolumeForScan(volumeId, volume.drive_letter);

    // 4. Spawn background worker thread
    let workerPath = path.join(__dirname, 'worker/indexingWorker.js');
    if (workerPath.includes('app.asar') && !fs.existsSync(workerPath)) {
      const unpacked = workerPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpacked)) workerPath = unpacked;
    }

    logger.info('IndexingService', `Spawning indexing worker: ${workerPath}`);

    this.worker = new Worker(workerPath);

    this.worker.on(
      'message',
      (msg: {
        type: string;
        sessionId?: number;
        volumeId?: number;
        scannedFiles?: number;
        scannedFolders?: number;
        errorCount?: number;
        currentPath?: string;
        durationMs?: number;
        error?: string;
      }) => {
        const durationMs = Date.now() - this.scanStartTime;
        const totalItems = (msg.scannedFiles || 0) + (msg.scannedFolders || 0);
        const itemsPerSecond = durationMs > 0 ? Math.round((totalItems / durationMs) * 1000) : 0;

        if (msg.type === 'PROGRESS') {
          const update: IndexingProgressUpdate = {
            sessionId,
            volumeId,
            driveLetter: volume.drive_letter,
            status: 'running',
            scannedFiles: msg.scannedFiles || 0,
            scannedFolders: msg.scannedFolders || 0,
            errorCount: msg.errorCount || 0,
            currentPath: msg.currentPath || '',
            durationMs,
            itemsPerSecond,
          };
          this.activeProgress = update;
          this.broadcastProgress(update);
        } else if (msg.type === 'COMPLETED') {
          console.log(
            `[QuickFind:IndexingService] Scan completed for ${volume.drive_letter} (${totalItems} items in ${durationMs}ms)`
          );
          const update: IndexingProgressUpdate = {
            sessionId,
            volumeId,
            driveLetter: volume.drive_letter,
            status: 'completed',
            scannedFiles: msg.scannedFiles || 0,
            scannedFolders: msg.scannedFolders || 0,
            errorCount: msg.errorCount || 0,
            currentPath: '',
            durationMs: msg.durationMs || durationMs,
            itemsPerSecond,
          };
          this.cleanupWorker();
          this.state = 'idle';
          this.activeProgress = null;
          this.broadcastProgress(update);

          // Replay buffered events collected during scan and transition volume to live sync
          SyncService.getInstance()
            .finalizeVolumeScan(volumeId)
            .catch(err => {
              console.error(
                '[QuickFind:IndexingService] Error finalizing volume scan in sync service:',
                err
              );
            });
        } else if (msg.type === 'CANCELLED') {
          console.log(`[QuickFind:IndexingService] Scan cancelled for ${volume.drive_letter}`);
          const update: IndexingProgressUpdate = {
            sessionId,
            volumeId,
            driveLetter: volume.drive_letter,
            status: 'cancelled',
            scannedFiles: msg.scannedFiles || 0,
            scannedFolders: msg.scannedFolders || 0,
            errorCount: msg.errorCount || 0,
            currentPath: '',
            durationMs: msg.durationMs || durationMs,
            itemsPerSecond,
          };
          this.cleanupWorker();
          this.state = 'idle';
          this.activeProgress = null;
          this.broadcastProgress(update);

          // Replay buffered events collected during scan and transition volume to live sync
          SyncService.getInstance()
            .finalizeVolumeScan(volumeId)
            .catch(err => {
              console.error(
                '[QuickFind:IndexingService] Error finalizing volume scan in sync service:',
                err
              );
            });
        } else if (msg.type === 'FAILED') {
          console.error(`[QuickFind:IndexingService] Scan failed: ${msg.error}`);
          logger.error(
            'IndexingService',
            `Scan failed for volume ${volume.drive_letter}: ${msg.error}`
          );
          this.lastError = msg.error || 'Unknown scan error';
          this.cleanupWorker();
          this.state = 'error';
          this.activeProgress = null;
        }
      }
    );

    this.worker.on('error', (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('IndexingService', 'Worker thread runtime error:', errMsg);
      this.lastError = errMsg;
      this.cleanupWorker();
      this.state = 'error';
    });

    this.worker.on('exit', code => {
      if (code !== 0 && this.state === 'indexing') {
        logger.warn('IndexingService', `Worker stopped unexpectedly with exit code ${code}`);
        this.state = 'idle';
      }
    });

    // 4. Send start message to worker
    this.worker.postMessage({
      type: 'START_SCAN',
      sessionId,
      volumeId,
      rootPath,
      dbPath: config.databasePath,
    });

    return { sessionId };
  }

  /**
   * Requests cancellation of the currently active scan
   */
  public async cancelIndexing(): Promise<void> {
    if (this.worker && this.state === 'indexing') {
      console.log('[QuickFind:IndexingService] Requesting scan cancellation...');
      this.state = 'cancelling';
      this.worker.postMessage({ type: 'CANCEL_SCAN' });
    }
  }

  /**
   * Returns overall indexing status including volumes and database totals
   */
  public async getStatus(): Promise<IndexingStatus> {
    const db = DatabaseManager.getInstance().getDatabase();
    const volumes = await this.getVolumes();

    let totalIndexedFiles = 0;
    let totalIndexedFolders = 0;
    let lastCompletedScanTimestamp: number | null = null;

    try {
      const countRow = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN is_directory = 0 THEN 1 ELSE 0 END) as files,
            SUM(CASE WHEN is_directory = 1 THEN 1 ELSE 0 END) as folders
          FROM entries;
        `
        )
        .get() as { files: number | null; folders: number | null };

      totalIndexedFiles = countRow.files || 0;
      totalIndexedFolders = countRow.folders || 0;

      const lastSession = db
        .prepare(
          `
          SELECT end_time FROM indexing_sessions
          WHERE status = 'completed'
          ORDER BY end_time DESC
          LIMIT 1;
        `
        )
        .get() as { end_time: number | null } | undefined;

      lastCompletedScanTimestamp = lastSession?.end_time || null;
    } catch {
      // Table might still be empty
    }

    return {
      state: this.state,
      activeProgress: this.activeProgress,
      volumes,
      totalIndexedFiles,
      totalIndexedFolders,
      lastCompletedScanTimestamp,
      lastError: this.lastError,
    };
  }

  public onProgress(listener: (update: IndexingProgressUpdate) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private broadcastProgress(update: IndexingProgressUpdate): void {
    for (const listener of this.progressListeners) {
      try {
        listener(update);
      } catch (err) {
        console.error('[QuickFind:IndexingService] Error notifying listener:', err);
      }
    }
  }

  private cleanupWorker(): void {
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.terminate().catch(() => {});
      this.worker = null;
    }
    this.activeSessionId = null;
    this.activeVolumeId = null;
  }

  public async dispose(): Promise<void> {
    console.log('[QuickFind:IndexingService] Disposing indexing service...');
    await this.cancelIndexing();
    this.cleanupWorker();
    await SyncService.getInstance().dispose();
    this.state = 'idle';
  }
}
