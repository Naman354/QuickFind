import {
  AppInfo,
  DatabaseStatus,
  SystemHealth,
  VolumeInfo,
  IndexingStatus,
  IndexingProgressUpdate,
  SearchQuery,
  SearchResults,
  IpcResponse,
  VolumeCheckpoint,
  VolumeSyncStatusUpdate,
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
  sync: {
    getStatus(): Promise<IpcResponse<Record<number, VolumeCheckpoint>>>;
    reconcile(
      volumeId: number
    ): Promise<IpcResponse<{ volumeId: number; reconciledCount: number }>>;
    onStatusUpdate(callback: (update: VolumeSyncStatusUpdate) => void): () => void;
  };
  search(query: SearchQuery): Promise<IpcResponse<SearchResults>>;
  file: {
    open(targetPath: string): Promise<IpcResponse<{ opened: boolean }>>;
    reveal(targetPath: string): Promise<IpcResponse<{ revealed: boolean }>>;
    copyPath(targetPath: string): Promise<IpcResponse<{ copied: boolean }>>;
  };
  window: {
    minimize(): Promise<IpcResponse<void>>;
    maximize(): Promise<IpcResponse<void>>;
    close(): Promise<IpcResponse<void>>;
    hide(): Promise<IpcResponse<void>>;
    setHeight(height: number): Promise<IpcResponse<void>>;
    setViewMode(mode: 'search' | 'manage'): Promise<IpcResponse<void>>;
    onFocusInput(callback: () => void): () => void;
    onSwitchView(callback: (mode: 'search' | 'manage') => void): () => void;
  };
}
