/**
 * Filesystem Indexing & Volume Types
 */

export type VolumeIndexingState = 'unindexed' | 'indexing' | 'indexed' | 'error';

export interface VolumeInfo {
  id: number;
  driveLetter: string;
  label: string;
  fileSystem: string;
  volumeGuid: string | null;
  totalBytes: number;
  freeBytes: number;
  indexingState: VolumeIndexingState;
  lastScanId: number | null;
  lastScanTimestamp: number | null;
  entryCount?: number;
}

export type SessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface IndexingSessionRecord {
  id: number;
  volumeId: number;
  status: SessionStatus;
  startTime: number;
  endTime: number | null;
  scannedFiles: number;
  scannedFolders: number;
  errorCount: number;
  errorDetails?: string | null;
}

export interface IndexingProgressUpdate {
  sessionId: number;
  volumeId: number;
  driveLetter: string;
  status: SessionStatus;
  scannedFiles: number;
  scannedFolders: number;
  errorCount: number;
  currentPath: string;
  durationMs: number;
  itemsPerSecond: number;
}

export type GlobalIndexingState = 'idle' | 'indexing' | 'cancelling' | 'error';

export interface IndexingStatus {
  state: GlobalIndexingState;
  activeProgress: IndexingProgressUpdate | null;
  volumes: VolumeInfo[];
  totalIndexedFiles: number;
  totalIndexedFolders: number;
  lastCompletedScanTimestamp: number | null;
  lastError: string | null;
}

export interface DiscoveredVolume {
  driveLetter: string;
  volumeGuid: string | null;
  label: string;
  fileSystem: string;
  totalBytes: number;
  freeBytes: number;
}

export interface FileEntryItem {
  name: string;
  path: string;
  parentPath: string;
  extension: string;
  isDirectory: boolean;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
  isHidden: boolean;
  isSystem: boolean;
  fileReferenceNumber?: string | null;
  parentReferenceNumber?: string | null;
}

