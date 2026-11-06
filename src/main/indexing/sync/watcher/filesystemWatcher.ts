import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { SYNC_CONFIG } from '../../../../shared/constants';
import { FsChangeEvent, FsChangeType } from '../../../../shared/types';
import { PathUtils } from '../../pathUtils';

export interface WatcherOptions {
  volumeId: number;
  rootPath: string;
  debounceMs?: number;
}

/**
 * FilesystemWatcher
 * Recursive Windows filesystem monitor powered by ReadDirectoryChangesW (via libuv).
 * Provides event debouncing, path normalization, exclusion filtering, and error recovery.
 */
export class FilesystemWatcher extends EventEmitter {
  private volumeId: number;
  private rootPath: string;
  private debounceMs: number;
  private watcher: fs.FSWatcher | null = null;
  private isRunning: boolean = false;
  private retryCount: number = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  // Pending events keyed by normalized path for debouncing
  private pendingEvents: Map<string, { type: FsChangeType; timestamp: number }> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options: WatcherOptions) {
    super();
    this.volumeId = options.volumeId;
    this.rootPath = PathUtils.normalizePath(options.rootPath);
    this.debounceMs = options.debounceMs ?? SYNC_CONFIG.DEBOUNCE_MS;
  }

  /**
   * Starts monitoring the filesystem root
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.retryCount = 0;
    this.initWatcher();
  }

  /**
   * Stops the active watcher instance
   */
  public stop(): void {
    this.isRunning = false;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.watcher) {
      try {
        this.watcher.removeAllListeners();
        this.watcher.close();
      } catch {
        // Ignore closing errors
      }
      this.watcher = null;
    }

    this.pendingEvents.clear();
  }

  /**
   * Initializes the native recursive watcher using ReadDirectoryChangesW
   */
  private initWatcher(): void {
    if (!this.isRunning) return;

    const fsRoot = PathUtils.toFsPath(this.rootPath);

    try {
      this.watcher = fs.watch(
        fsRoot,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (!filename) return;
          this.handleRawEvent(eventType, filename);
        }
      );

      this.watcher.on('error', (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[QuickFind:Watcher] Watcher error on volume ${this.volumeId} (${this.rootPath}):`,
          errMsg
        );

        // Check for buffer overflow or fatal watcher failure
        const isOverflow =
          errMsg.includes('EMFILE') ||
          errMsg.includes('ENFILE') ||
          errMsg.includes('overflow') ||
          errMsg.includes('UNKNOWN');

        if (isOverflow) {
          this.emit('overflow', { volumeId: this.volumeId, rootPath: this.rootPath });
        }

        this.scheduleRestart();
      });

      this.watcher.on('close', () => {
        if (this.isRunning) {
          this.scheduleRestart();
        }
      });

      console.log(
        `[QuickFind:Watcher] Active monitoring started on volume ${this.volumeId}: ${this.rootPath}`
      );
      this.emit('started', { volumeId: this.volumeId, rootPath: this.rootPath });
    } catch (err) {
      console.error(`[QuickFind:Watcher] Failed to start watcher on ${this.rootPath}:`, err);
      this.scheduleRestart();
    }
  }

  /**
   * Queues raw fs events with sliding-window debouncing
   */
  private handleRawEvent(eventType: string, relativePath: string): void {
    const fullPath = PathUtils.normalizePath(path.join(this.rootPath, relativePath));

    // Check conservative exclusions
    const parts = fullPath.split('\\');
    for (const part of parts) {
      if (PathUtils.isExcluded(part, part === parts[0])) {
        return;
      }
    }

    // Map raw libuv event: 'rename' can be creation, deletion, or rename; 'change' is modification
    const inferredType: FsChangeType = eventType === 'change' ? 'update' : 'create';

    const now = Date.now();
    this.pendingEvents.set(fullPath, { type: inferredType, timestamp: now });

    // Schedule flush timer
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushPendingEvents();
      }, this.debounceMs);
    }
  }

  /**
   * Flushes debounced events and determines actual filesystem status
   */
  private async flushPendingEvents(): Promise<void> {
    this.flushTimer = null;
    if (this.pendingEvents.size === 0) return;

    const eventsToProcess = new Map(this.pendingEvents);
    this.pendingEvents.clear();

    const changeEvents: FsChangeEvent[] = [];

    for (const [filePath, info] of eventsToProcess.entries()) {
      try {
        // Stat the path to verify whether it currently exists
        const stat = await fs.promises.stat(PathUtils.toFsPath(filePath));
        const isDirectory = stat.isDirectory();

        changeEvents.push({
          type: info.type === 'create' ? 'create' : 'update',
          path: filePath,
          isDirectory,
          timestamp: info.timestamp,
        });
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          // File or directory was deleted
          changeEvents.push({
            type: 'delete',
            path: filePath,
            timestamp: info.timestamp,
          });
        }
      }
    }

    if (changeEvents.length > 0) {
      this.emit('changes', { volumeId: this.volumeId, changes: changeEvents });
    }
  }

  /**
   * Handles watcher restart with exponential backoff
   */
  private scheduleRestart(): void {
    if (!this.isRunning) return;

    if (this.watcher) {
      try {
        this.watcher.removeAllListeners();
        this.watcher.close();
      } catch {
        // Ignore
      }
      this.watcher = null;
    }

    this.retryCount++;
    if (this.retryCount > SYNC_CONFIG.MAX_RETRY_ATTEMPTS) {
      console.error(
        `[QuickFind:Watcher] Max restart attempts exceeded for volume ${this.volumeId}`
      );
      this.emit('error', {
        volumeId: this.volumeId,
        error: 'Watcher failed to restart after maximum retry attempts',
      });
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
    console.log(
      `[QuickFind:Watcher] Reconnecting watcher on volume ${this.volumeId} in ${backoffMs}ms (attempt ${this.retryCount})...`
    );

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.initWatcher();
    }, backoffMs);
  }
}
