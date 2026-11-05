import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { QuickFindApi } from './api';

const api: QuickFindApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_INFO),
  getHealth: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_HEALTH),
  getDatabaseStatus: () => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_STATUS),
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW.CLOSE),
  },
};

// Expose safe, controlled API to the isolated renderer world
contextBridge.exposeInMainWorld('quickFindApi', api);

