import { parentPort } from 'worker_threads';
import { IndexerDb } from './indexerDb';
import { FilesystemScanner } from './scanner';

if (!parentPort) {
  throw new Error('indexingWorker must be run as a worker thread.');
}

let currentDb: IndexerDb | null = null;
let isCancelled = false;
let isScanning = false;

parentPort.on(
  'message',
  async (message: {
    type: string;
    sessionId?: number;
    volumeId?: number;
    rootPath?: string;
    dbPath?: string;
  }) => {
    if (message.type === 'START_SCAN') {
      const { sessionId, volumeId, rootPath, dbPath } = message;

      if (!sessionId || !volumeId || !rootPath || !dbPath) {
        parentPort?.postMessage({
          type: 'FAILED',
          error: 'Missing required parameters for START_SCAN',
        });
        return;
      }

      if (isScanning) {
        parentPort?.postMessage({
          type: 'FAILED',
          error: 'A scan is already active in this worker',
        });
        return;
      }

      isScanning = true;
      isCancelled = false;

      try {
        currentDb = new IndexerDb(dbPath);
        currentDb.setVolumeState(volumeId, 'indexing');

        const result = await FilesystemScanner.scan(rootPath, {
          onBatch: items => {
            if (currentDb) {
              currentDb.saveBatch(volumeId, sessionId, items);
            }
          },
          onProgress: (scannedFiles, scannedFolders, errors, currentPath) => {
            if (currentDb) {
              currentDb.updateSessionProgress(sessionId, scannedFiles, scannedFolders, errors);
            }
            parentPort?.postMessage({
              type: 'PROGRESS',
              sessionId,
              volumeId,
              scannedFiles,
              scannedFolders,
              errorCount: errors,
              currentPath,
            });
          },
          isCancelled: () => isCancelled,
        });

        if (result.cancelled) {
          currentDb.cancelSession(sessionId, volumeId);
          parentPort?.postMessage({
            type: 'CANCELLED',
            sessionId,
            volumeId,
            scannedFiles: result.scannedFiles,
            scannedFolders: result.scannedFolders,
            errorCount: result.errors,
            durationMs: result.durationMs,
          });
        } else {
          currentDb.completeSession(
            sessionId,
            volumeId,
            result.scannedFiles,
            result.scannedFolders,
            result.errors
          );
          parentPort?.postMessage({
            type: 'COMPLETED',
            sessionId,
            volumeId,
            scannedFiles: result.scannedFiles,
            scannedFolders: result.scannedFolders,
            errorCount: result.errors,
            durationMs: result.durationMs,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (currentDb && sessionId && volumeId) {
          currentDb.failSession(sessionId, volumeId, errMsg);
        }
        parentPort?.postMessage({
          type: 'FAILED',
          sessionId,
          volumeId,
          error: errMsg,
        });
      } finally {
        if (currentDb) {
          currentDb.close();
          currentDb = null;
        }
        isScanning = false;
      }
    } else if (message.type === 'CANCEL_SCAN') {
      isCancelled = true;
    }
  }
);
