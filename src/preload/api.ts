import { AppInfo, DatabaseStatus, SystemHealth, IpcResponse } from '../shared/types';

export interface QuickFindApi {
  getAppInfo(): Promise<IpcResponse<AppInfo>>;
  getHealth(): Promise<IpcResponse<SystemHealth>>;
  getDatabaseStatus(): Promise<IpcResponse<DatabaseStatus>>;
  window: {
    minimize(): Promise<IpcResponse<void>>;
    maximize(): Promise<IpcResponse<void>>;
    close(): Promise<IpcResponse<void>>;
  };
}

