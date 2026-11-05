import { IndexingProgressUpdate, IndexingStatus, VolumeInfo } from '../../shared/types';

export interface IIndexingEngine {
  getStatus(): Promise<IndexingStatus>;
  getVolumes(): Promise<VolumeInfo[]>;
  startIndexing(volumeId: number): Promise<{ sessionId: number }>;
  cancelIndexing(): Promise<void>;
  onProgress(listener: (update: IndexingProgressUpdate) => void): () => void;
  dispose(): Promise<void>;
}
