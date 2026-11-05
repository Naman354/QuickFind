import {
  AppInfo,
  DatabaseStatus,
  SystemHealth,
  VolumeInfo,
  IndexingStatus,
  IndexingProgressUpdate,
  IpcResponse,
} from '../shared/types';

export interface QuickFindApi {
  getAppInfo(): Promise<IpcResponse<AppInfo>>;
  getHealth(): Promise<IpcResponse<SystemHealth>>;
  getDatabaseStatus(): Promise<IpcResponse<DatabaseStatus>>;
  indexing: {
    getVolumes(): Promise<IpcResponse<VolumeInfo[]>>;
    getStatus(): Promise<IpcResponse<IndexingStatus>>;
    startScan(volumeId: number): Promise<IpcResponse<{ sessionId: number }>>;
    cancelScan(): Promise<IpcResponse<void>>;
    onProgress(callback: (update: IndexingProgressUpdate) => void): () => void;
  };
  window: {
    minimize(): Promise<IpcResponse<void>>;
    maximize(): Promise<IpcResponse<void>>;
    close(): Promise<IpcResponse<void>>;
  };
}
