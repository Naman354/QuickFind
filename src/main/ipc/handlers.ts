import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { AppService } from '../services/appService';
import { validateIpcSender } from '../security/validator';
import { SyncService } from '../indexing/sync/syncService';
import {
  GetAppInfoResponse,
  GetDatabaseStatusResponse,
  GetSystemHealthResponse,
  GetVolumesResponse,
  GetIndexingStatusResponse,
  StartIndexingResponse,
  CancelIndexingResponse,
  GetSearchResponse,
  SearchQuery,
  WindowActionResponse,
  GetSyncStatusResponse,
  ReconcileVolumeResponse,
  VolumeSyncStatusUpdate,
} from '../../shared/types';

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  isDev: boolean
): void {
  const appService = AppService.getInstance();
  const indexingService = appService.getIndexingService();
  const searchService = appService.getSearchService();
  const syncService = SyncService.getInstance();

  // Forward indexing worker progress updates to renderer window
  indexingService.onProgress(update => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.INDEXING.PROGRESS_UPDATE, update);
    }
  });

  // Forward incremental sync status updates to renderer window
  syncService.on('statusUpdate', (update: VolumeSyncStatusUpdate) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SYNC.STATUS_UPDATE, update);
    }
  });

  // Helper to validate and guard handler execution
  function guard<T>(
    event: Electron.IpcMainInvokeEvent,
    action: () => T | Promise<T>
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (!validateIpcSender(event, getMainWindow(), isDev)) {
      return Promise.resolve({
        success: false,
        error: 'Security violation: Unauthorized IPC sender',
      });
    }

    try {
      const result = action();
      if (result instanceof Promise) {
        return result
          .then(data => ({ success: true, data }))
          .catch(err => ({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }));
      }
      return Promise.resolve({ success: true, data: result });
    } catch (err) {
      return Promise.resolve({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // System Information
  ipcMain.handle(IPC_CHANNELS.SYSTEM.GET_INFO, async (event): Promise<GetAppInfoResponse> => {
    return guard(event, () => appService.getAppInfo());
  });

  // System Health
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM.GET_HEALTH,
    async (event): Promise<GetSystemHealthResponse> => {
      return guard(event, () => appService.getHealth());
    }
  );

  // Database Status
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_STATUS,
    async (event): Promise<GetDatabaseStatusResponse> => {
      return guard(event, () => appService.getDatabaseStatus());
    }
  );

  // Indexing: Get Volumes
  ipcMain.handle(IPC_CHANNELS.INDEXING.GET_VOLUMES, async (event): Promise<GetVolumesResponse> => {
    return guard(event, () => indexingService.getVolumes());
  });

  // Indexing: Get Overall Status
  ipcMain.handle(
    IPC_CHANNELS.INDEXING.GET_STATUS,
    async (event): Promise<GetIndexingStatusResponse> => {
      return guard(event, () => indexingService.getStatus());
    }
  );

  // Indexing: Start Scan
  ipcMain.handle(
    IPC_CHANNELS.INDEXING.START_SCAN,
    async (event, volumeId: number): Promise<StartIndexingResponse> => {
      return guard(event, () => {
        if (typeof volumeId !== 'number' || isNaN(volumeId)) {
          throw new Error('Invalid volumeId parameter provided');
        }
        return indexingService.startIndexing(volumeId);
      });
    }
  );

  // Indexing: Cancel Scan
  ipcMain.handle(
    IPC_CHANNELS.INDEXING.CANCEL_SCAN,
    async (event): Promise<CancelIndexingResponse> => {
      return guard(event, () => indexingService.cancelIndexing());
    }
  );

  // Sync: Get Status & Checkpoints
  ipcMain.handle(IPC_CHANNELS.SYNC.GET_STATUS, async (event): Promise<GetSyncStatusResponse> => {
    return guard(event, () => syncService.getCheckpoints());
  });

  // Sync: Reconcile Volume
  ipcMain.handle(
    IPC_CHANNELS.SYNC.RECONCILE,
    async (event, volumeId: number): Promise<ReconcileVolumeResponse> => {
      return guard(event, async () => {
        if (typeof volumeId !== 'number' || isNaN(volumeId)) {
          throw new Error('Invalid volumeId parameter provided');
        }
        const reconciledCount = await syncService.reconcileVolume(volumeId);
        return { volumeId, reconciledCount };
      });
    }
  );

  // Search: Execute Query
  ipcMain.handle(
    IPC_CHANNELS.SEARCH.EXECUTE,
    async (event, query: SearchQuery): Promise<GetSearchResponse> => {
      return guard(event, () => {
        if (!query || typeof query !== 'object') {
          throw new Error('Invalid query payload provided');
        }
        return searchService.search(query);
      });
    }
  );

  // Window Controls
  ipcMain.handle(IPC_CHANNELS.WINDOW.MINIMIZE, async (event): Promise<WindowActionResponse> => {
    return guard(event, () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.minimize();
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW.MAXIMIZE, async (event): Promise<WindowActionResponse> => {
    return guard(event, () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW.CLOSE, async (event): Promise<WindowActionResponse> => {
    return guard(event, () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
  });
}
