/**
 * Type-safe IPC Communication Contracts
 */

import { AppInfo, DatabaseStatus, SystemHealth } from './system';
import { VolumeInfo, IndexingStatus, VolumeCheckpoint } from './indexing';
import { SearchResults } from './search';

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type GetAppInfoResponse = IpcResponse<AppInfo>;
export type GetSystemHealthResponse = IpcResponse<SystemHealth>;
export type GetDatabaseStatusResponse = IpcResponse<DatabaseStatus>;
export type GetVolumesResponse = IpcResponse<VolumeInfo[]>;
export type GetIndexingStatusResponse = IpcResponse<IndexingStatus>;
export type StartIndexingResponse = IpcResponse<{ sessionId: number }>;
export type CancelIndexingResponse = IpcResponse<void>;
export type GetSearchResponse = IpcResponse<SearchResults>;
export type WindowActionResponse = IpcResponse<void>;
export type GetSyncStatusResponse = IpcResponse<Record<number, VolumeCheckpoint>>;
export type ReconcileVolumeResponse = IpcResponse<{ volumeId: number; reconciledCount: number }>;
