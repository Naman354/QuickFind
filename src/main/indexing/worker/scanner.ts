import fs from 'fs';
import path from 'path';
import { INDEXING_CONFIG } from '../../../shared/constants';
import { FileEntryItem } from '../../../shared/types';
import { PathUtils } from '../pathUtils';

export interface ScanCallbacks {
  onBatch: (items: FileEntryItem[]) => void;
  onProgress: (
    scannedFiles: number,
    scannedFolders: number,
    errors: number,
    currentPath: string
  ) => void;
  isCancelled: () => boolean;
}

export interface ScanResult {
  scannedFiles: number;
  scannedFolders: number;
  errors: number;
  durationMs: number;
  cancelled: boolean;
}

export class FilesystemScanner {
  /**
   * Scans a root path recursively using a bounded concurrency directory queue.
   */
  public static async scan(rootPath: string, callbacks: ScanCallbacks): Promise<ScanResult> {
    const startTime = Date.now();
    const normalizedRoot = PathUtils.normalizePath(rootPath);

    let scannedFiles = 0;
    let scannedFolders = 0;
    let errorCount = 0;
    let lastProgressTime = 0;

    // Buffer for batch database writes
    let batchBuffer: FileEntryItem[] = [];

    const flushBatch = () => {
      if (batchBuffer.length > 0) {
        callbacks.onBatch(batchBuffer);
        batchBuffer = [];
      }
    };

    // Directory queue for bounded concurrency traversal
    const dirQueue: string[] = [normalizedRoot];
    let activeWorkers = 0;

    // Cache of directory path -> NTFS File Reference Number (FRN)
    const dirFrnMap = new Map<string, string>();

    // Seed root directory FRN if accessible
    try {
      const rootStat = await fs.promises.stat(PathUtils.toFsPath(normalizedRoot), { bigint: true });
      if (rootStat.ino) {
        dirFrnMap.set(normalizedRoot, '0x' + rootStat.ino.toString(16));
      }
    } catch {
      // Root might have restricted permissions; will proceed without root FRN
    }

    const maybeReportProgress = (currentPath: string, force = false) => {
      const now = Date.now();
      if (force || now - lastProgressTime >= INDEXING_CONFIG.PROGRESS_INTERVAL_MS) {
        lastProgressTime = now;
        callbacks.onProgress(scannedFiles, scannedFolders, errorCount, currentPath);
      }
    };

    return new Promise(resolve => {
      let isDone = false;

      const finish = (cancelled: boolean) => {
        if (isDone) return;
        isDone = true;
        flushBatch();
        maybeReportProgress(normalizedRoot, true);

        resolve({
          scannedFiles,
          scannedFolders,
          errors: errorCount,
          durationMs: Date.now() - startTime,
          cancelled,
        });
      };

      const processNextDir = async () => {
        if (callbacks.isCancelled()) {
          finish(true);
          return;
        }

        if (dirQueue.length === 0 && activeWorkers === 0) {
          finish(false);
          return;
        }

        while (dirQueue.length > 0 && activeWorkers < INDEXING_CONFIG.CONCURRENCY) {
          if (callbacks.isCancelled()) {
            finish(true);
            return;
          }

          const currentDir = dirQueue.shift()!;
          activeWorkers++;

          // Asynchronously enumerate directory
          (async () => {
            const isRoot = currentDir === normalizedRoot;
            const fsDir = PathUtils.toFsPath(currentDir);

            try {
              const dirents = await fs.promises.readdir(fsDir, { withFileTypes: true });

              for (const dirent of dirents) {
                if (callbacks.isCancelled()) break;

                const entryName = dirent.name;
                const isDir = dirent.isDirectory();
                const isSymlink = dirent.isSymbolicLink();

                // Check exclusions
                if (PathUtils.isExcluded(entryName, isRoot)) {
                  continue;
                }

                const itemPath = PathUtils.normalizePath(path.join(currentDir, entryName));
                const parentPath = currentDir;

                let sizeBytes = 0;
                let createdAt = 0;
                let modifiedAt = 0;
                let fileRef: string | null = null;

                // Stat entry for metadata and NTFS 64-bit File Reference Number (ino)
                try {
                  const stat = await fs.promises.stat(PathUtils.toFsPath(itemPath), {
                    bigint: true,
                  });
                  sizeBytes = Number(stat.size);
                  createdAt = Math.round(Number(stat.birthtimeMs));
                  modifiedAt = Math.round(Number(stat.mtimeMs));
                  if (stat.ino) {
                    fileRef = '0x' + stat.ino.toString(16);
                    if (isDir) {
                      dirFrnMap.set(itemPath, fileRef);
                    }
                  }
                } catch {
                  // File might have been deleted, locked, or permission denied
                  errorCount++;
                }

                const parentRef = dirFrnMap.get(parentPath) || null;
                const isHidden = entryName.startsWith('.') || (isRoot && entryName.startsWith('$'));

                const entryItem: FileEntryItem = {
                  name: entryName,
                  path: itemPath,
                  parentPath,
                  extension: PathUtils.getExtension(entryName, isDir),
                  isDirectory: isDir,
                  sizeBytes: isDir ? 0 : sizeBytes,
                  createdAt,
                  modifiedAt,
                  isHidden,
                  isSystem: false,
                  fileReferenceNumber: fileRef,
                  parentReferenceNumber: parentRef,
                };

                batchBuffer.push(entryItem);

                if (isDir) {
                  scannedFolders++;
                  // DO NOT recursively follow symbolic links or junctions
                  if (!isSymlink) {
                    dirQueue.push(itemPath);
                  }
                } else {
                  scannedFiles++;
                }

                // Flush batch when threshold is reached
                if (batchBuffer.length >= INDEXING_CONFIG.BATCH_SIZE) {
                  flushBatch();
                }

                maybeReportProgress(itemPath);
              }
            } catch (err: unknown) {
              errorCount++;
              const nodeErr = err as NodeJS.ErrnoException;
              // Log protected / inaccessible locations at debug level
              if (
                nodeErr.code !== 'EPERM' &&
                nodeErr.code !== 'EACCES' &&
                nodeErr.code !== 'ENOENT'
              ) {
                console.warn(`[QuickFind:Scanner] Error enumerating ${currentDir}:`, err);
              }
            } finally {
              activeWorkers--;
              maybeReportProgress(currentDir);
              processNextDir();
            }
          })();
        }
      };

      // Start initial workers
      processNextDir();
    });
  }
}
