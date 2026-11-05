/**
 * Application & System Information Types
 */

export interface AppInfo {
  name: string;
  version: string;
  isPackaged: boolean;
  environment: 'development' | 'production' | 'test';
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  userDataPath: string;
}

export interface DatabaseStatus {
  connected: boolean;
  filePath: string;
  journalMode: string;
  synchronous: string;
  fts5Available: boolean;
  foreignKeysEnabled: boolean;
  cacheSizeKb: number;
  pageSizeBytes: number;
  mmapSize: number;
  busyTimeoutMs: number;
  error?: string;
}

export type HealthState = 'healthy' | 'degraded' | 'error';

export interface ComponentHealth {
  name: string;
  state: HealthState;
  details?: string;
}

export interface SystemHealth {
  state: HealthState;
  database: DatabaseStatus;
  components: ComponentHealth[];
  timestamp: number;
}

