/**
 * Indexing Engine Architecture & Contracts
 * Milestone 1: Architecture boundary definition.
 * Subsequent milestones will implement filesystem scanning, change monitoring,
 * and SQLite indexing (with optional offloading to Electron utilityProcess / Worker thread).
 */

export type IndexingState = 'idle' | 'scanning' | 'indexing' | 'paused' | 'error';

export interface IndexingStats {
  indexedFilesCount: number;
  indexedFoldersCount: number;
  lastScanTimestamp: number | null;
  currentOperation?: string;
}

export interface IndexingStatus {
  state: IndexingState;
  stats: IndexingStats;
  isWorkerActive: boolean;
  error?: string;
}

export interface IIndexingEngine {
  getStatus(): Promise<IndexingStatus>;
  startScan(targetPaths: string[]): Promise<void>;
  stopScan(): Promise<void>;
  dispose(): Promise<void>;
}

