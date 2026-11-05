import React from 'react';
import { IndexingProgressUpdate } from '../../shared/types';

interface IndexingProgressCardProps {
  progress: IndexingProgressUpdate;
  onCancel: () => void;
  isCancelling: boolean;
}

export const IndexingProgressCard: React.FC<IndexingProgressCardProps> = ({
  progress,
  onCancel,
  isCancelling,
}) => {
  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  };

  const totalItems = progress.scannedFiles + progress.scannedFolders;

  return (
    <div className="indexing-live-card">
      <div className="indexing-live-header">
        <div className="live-header-info">
          <div className="live-indicator">
            <span className="live-dot pulse" />
            <span className="live-text">Indexing Drive {progress.driveLetter} (Worker Thread)</span>
          </div>
          <span className="live-speed">{progress.itemsPerSecond.toLocaleString()} items/sec</span>
        </div>
        <button className="btn btn-danger btn-small" disabled={isCancelling} onClick={onCancel}>
          {isCancelling ? 'Cancelling...' : 'Cancel Scan'}
        </button>
      </div>

      <div className="live-path-box">
        <span className="live-path-label">Current:</span>
        <span className="live-path-text" title={progress.currentPath}>
          {progress.currentPath || 'Starting scan...'}
        </span>
      </div>

      <div className="live-stats-grid">
        <div className="live-stat-item">
          <span className="stat-label">Total Processed</span>
          <span className="stat-number">{totalItems.toLocaleString()}</span>
        </div>
        <div className="live-stat-item">
          <span className="stat-label">Files</span>
          <span className="stat-number">{progress.scannedFiles.toLocaleString()}</span>
        </div>
        <div className="live-stat-item">
          <span className="stat-label">Folders</span>
          <span className="stat-number">{progress.scannedFolders.toLocaleString()}</span>
        </div>
        <div className="live-stat-item">
          <span className="stat-label">Elapsed Time</span>
          <span className="stat-number">{formatDuration(progress.durationMs)}</span>
        </div>
        <div className="live-stat-item">
          <span className="stat-label">Errors</span>
          <span className={`stat-number ${progress.errorCount > 0 ? 'text-warn' : ''}`}>
            {progress.errorCount.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};
