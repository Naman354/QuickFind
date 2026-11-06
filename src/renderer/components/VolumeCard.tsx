import React from 'react';
import { VolumeInfo } from '../../shared/types';
import { StatusBadge } from './StatusBadge';

interface VolumeCardProps {
  volume: VolumeInfo;
  isScanning: boolean;
  onStartIndexing: (volumeId: number) => void;
  onReconcileVolume?: (volumeId: number) => void;
}

export const VolumeCard: React.FC<VolumeCardProps> = ({
  volume,
  isScanning,
  onStartIndexing,
  onReconcileVolume,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const getBadgeStatus = (state: string): 'healthy' | 'degraded' | 'error' | 'pending' => {
    switch (state) {
      case 'indexed':
      case 'synced':
        return 'healthy';
      case 'indexing':
      case 'syncing':
      case 'reconciling':
        return 'pending';
      case 'error':
        return 'error';
      default:
        return 'degraded';
    }
  };

  const checkpoint = volume.checkpoint;
  const isSyncActive = checkpoint && volume.indexingState === 'indexed';

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
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}
        >
          <StatusBadge
            status={getBadgeStatus(volume.indexingState)}
            label={volume.indexingState.toUpperCase()}
          />
          {isSyncActive && checkpoint && (
            <StatusBadge
              status={getBadgeStatus(checkpoint.syncStatus)}
              label={`SYNC: ${checkpoint.syncStatus.toUpperCase()}`}
            />
          )}
        </div>
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

      {isSyncActive && checkpoint && (
        <div className="volume-sync-info">
          <div className="sync-info-row">
            <span className="sync-info-label">Monitoring Mode:</span>
            <span className="sync-info-val">
              {checkpoint.syncMode === 'usn_journal'
                ? 'NTFS USN Change Journal'
                : 'Live Watcher (ReadDirectoryChangesW)'}
            </span>
          </div>
          {checkpoint.lastProcessedUsn && (
            <div className="sync-info-row">
              <span className="sync-info-label">Last USN:</span>
              <span className="sync-info-val mono">{checkpoint.lastProcessedUsn}</span>
            </div>
          )}
          {checkpoint.lastSyncTimestamp && (
            <div className="sync-info-row">
              <span className="sync-info-label">Last Synced:</span>
              <span className="sync-info-val">
                {new Date(checkpoint.lastSyncTimestamp).toLocaleTimeString()}
              </span>
            </div>
          )}
          {checkpoint.errorMessage && (
            <div className="sync-info-row sync-error">
              <span className="sync-info-label">Sync Alert:</span>
              <span className="sync-info-val">{checkpoint.errorMessage}</span>
            </div>
          )}
        </div>
      )}

      <div className="volume-actions" style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
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

        {volume.indexingState === 'indexed' && onReconcileVolume && (
          <button
            className="btn btn-secondary"
            disabled={isScanning || checkpoint?.syncStatus === 'reconciling'}
            onClick={() => onReconcileVolume(volume.id)}
            title="Perform targeted directory differential reconciliation against SQLite"
          >
            {checkpoint?.syncStatus === 'reconciling' ? 'Reconciling...' : 'Reconcile'}
          </button>
        )}
      </div>
    </div>
  );
};
