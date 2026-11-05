/**
 * Type-safe IPC Communication Contracts
 */

import { AppInfo, DatabaseStatus, SystemHealth } from './system';

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type GetAppInfoResponse = IpcResponse<AppInfo>;
export type GetSystemHealthResponse = IpcResponse<SystemHealth>;
export type GetDatabaseStatusResponse = IpcResponse<DatabaseStatus>;
export type WindowActionResponse = IpcResponse<void>;

