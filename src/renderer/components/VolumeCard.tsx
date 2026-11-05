import React from 'react';
import { VolumeInfo } from '../../shared/types';
import { StatusBadge } from './StatusBadge';

interface VolumeCardProps {
  volume: VolumeInfo;
  isScanning: boolean;
  onStartIndexing: (volumeId: number) => void;
}

export const VolumeCard: React.FC<VolumeCardProps> = ({ volume, isScanning, onStartIndexing }) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const getBadgeStatus = (state: string): 'healthy' | 'degraded' | 'error' | 'pending' => {
    switch (state) {
      case 'indexed':
        return 'healthy';
      case 'indexing':
        return 'pending';
      case 'error':
        return 'error';
      default:
        return 'degraded';
    }
  };

  return (
    <div className={`volume-card ${volume.indexingState === 'indexing' ? 'volume-active' : ''}`}>
      <div className="volume-card-top">
        <div className="volume-icon-wrapper">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="volume-icon"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="7" y1="12" x2="7" y2="12.01" />
            <line x1="17" y1="12" x2="17" y2="12.01" />
          </svg>
        </div>
        <div className="volume-details">
          <div className="volume-title-row">
            <span className="volume-letter">{volume.driveLetter}</span>
            {volume.label && <span className="volume-label">({volume.label})</span>}
          </div>
          <span className="volume-fs">{volume.fileSystem} Local Fixed Disk</span>
        </div>
        <StatusBadge
          status={getBadgeStatus(volume.indexingState)}
          label={volume.indexingState.toUpperCase()}
        />
      </div>

      <div className="volume-metrics">
        <div className="volume-metric">
          <span className="metric-label">Capacity</span>
          <span className="metric-val">{formatBytes(volume.totalBytes)}</span>
        </div>
        <div className="volume-metric">
          <span className="metric-label">Free Space</span>
          <span className="metric-val">{formatBytes(volume.freeBytes)}</span>
        </div>
        <div className="volume-metric">
          <span className="metric-label">Indexed Entries</span>
          <span className="metric-val metric-highlight">
            {volume.entryCount ? volume.entryCount.toLocaleString() : '0'}
          </span>
        </div>
      </div>

      <div className="volume-actions">
        <button
          className="btn btn-primary"
          disabled={isScanning}
          onClick={() => onStartIndexing(volume.id)}
        >
          {volume.indexingState === 'indexing' ? (
            <>
              <span className="spinner-small" /> Scanning...
            </>
          ) : volume.indexingState === 'indexed' ? (
            'Re-index Volume'
          ) : (
            'Index Volume'
          )}
        </button>
      </div>
    </div>
  );
};
