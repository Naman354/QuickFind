import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { QuickFindApi } from './api';
import { IndexingProgressUpdate, SearchQuery, VolumeSyncStatusUpdate } from '../shared/types';

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
  sync: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC.GET_STATUS),
    reconcile: (volumeId: number) => ipcRenderer.invoke(IPC_CHANNELS.SYNC.RECONCILE, volumeId),
    onStatusUpdate: (callback: (update: VolumeSyncStatusUpdate) => void) => {
      const handler = (_event: IpcRendererEvent, update: VolumeSyncStatusUpdate) => {
        callback(update);
      };
      ipcRenderer.on(IPC_CHANNELS.SYNC.STATUS_UPDATE, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.SYNC.STATUS_UPDATE, handler);
      };
    },
  },
  search: (query: SearchQuery) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH.EXECUTE, query),
  file: {
    open: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE.OPEN, targetPath),
    reveal: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE.REVEAL, targetPath),
    copyPath: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE.COPY_PATH, targetPath),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.CLOSE),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.HIDE),
    setHeight: (height: number) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.SET_HEIGHT, height),
    setViewMode: (mode: 'search' | 'manage') =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW.SET_VIEW_MODE, mode),
    onFocusInput: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.WINDOW.FOCUS_INPUT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.WINDOW.FOCUS_INPUT, handler);
      };
    },
    onSwitchView: (callback: (mode: 'search' | 'manage') => void) => {
      const handler = (_event: IpcRendererEvent, mode: 'search' | 'manage') => callback(mode);
      ipcRenderer.on(IPC_CHANNELS.WINDOW.SWITCH_VIEW, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.WINDOW.SWITCH_VIEW, handler);
      };
    },
  },
};

// Expose safe, controlled API to the isolated renderer world
contextBridge.exposeInMainWorld('quickFindApi', api);
