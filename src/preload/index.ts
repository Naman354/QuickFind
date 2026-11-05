import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { QuickFindApi } from './api';
import { IndexingProgressUpdate } from '../shared/types';

const api: QuickFindApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_INFO),
  getHealth: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_HEALTH),
  getDatabaseStatus: () => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_STATUS),
  indexing: {
    getVolumes: () => ipcRenderer.invoke(IPC_CHANNELS.INDEXING.GET_VOLUMES),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.INDEXING.GET_STATUS),
    startScan: (volumeId: number) => ipcRenderer.invoke(IPC_CHANNELS.INDEXING.START_SCAN, volumeId),
    cancelScan: () => ipcRenderer.invoke(IPC_CHANNELS.INDEXING.CANCEL_SCAN),
    onProgress: (callback: (update: IndexingProgressUpdate) => void) => {
      const handler = (_event: IpcRendererEvent, update: IndexingProgressUpdate) => {
        callback(update);
      };
      ipcRenderer.on(IPC_CHANNELS.INDEXING.PROGRESS_UPDATE, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.INDEXING.PROGRESS_UPDATE, handler);
      };
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.CLOSE),
  },
};

// Expose safe, controlled API to the isolated renderer world
contextBridge.exposeInMainWorld('quickFindApi', api);
