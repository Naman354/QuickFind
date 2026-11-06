import React, { useEffect, useState, useCallback } from 'react';
import { Header } from './components/Header';
import { StatusBadge } from './components/StatusBadge';
import { InfoCard } from './components/InfoCard';
import { VolumeCard } from './components/VolumeCard';
import { IndexingProgressCard } from './components/IndexingProgressCard';
import { SearchTester } from './components/SearchTester';
import { FloatingSearch } from './components/FloatingSearch';
import {
  AppInfo,
  DatabaseStatus,
  SystemHealth,
  VolumeInfo,
  IndexingStatus,
  IndexingProgressUpdate,
} from '../shared/types';
import './App.css';

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'search' | 'manage'>('search');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus | null>(null);
  const [activeProgress, setActiveProgress] = useState<IndexingProgressUpdate | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshData = useCallback(async () => {
    if (!window.quickFindApi) return;

    try {
      const [volsRes, idxRes, healthRes, dbRes] = await Promise.all([
        window.quickFindApi.indexing.getVolumes(),
        window.quickFindApi.indexing.getStatus(),
        window.quickFindApi.getHealth(),
        window.quickFindApi.getDatabaseStatus(),
      ]);

      if (volsRes.success && volsRes.data) {
        setVolumes(volsRes.data);
      }
      if (idxRes.success && idxRes.data) {
        setIndexingStatus(idxRes.data);
        if (idxRes.data.activeProgress) {
          setActiveProgress(idxRes.data.activeProgress);
        }
      }
      if (healthRes.success && healthRes.data) {
        setHealth(healthRes.data);
      }
      if (dbRes.success && dbRes.data) {
        setDbStatus(dbRes.data);
      }
    } catch (err) {
      console.error('[QuickFind:Renderer] Refresh error:', err);
    }
  }, []);

  useEffect(() => {
    async function loadInitialData() {
      if (!window.quickFindApi) {
        setError('IPC bridge (quickFindApi) is not available in the renderer window.');
        setLoading(false);
        return;
      }

      try {
        const infoRes = await window.quickFindApi.getAppInfo();
        if (infoRes.success && infoRes.data) {
          setAppInfo(infoRes.data);
        } else {
          setError(infoRes.error || 'Failed to fetch application metadata');
        }

        await refreshData();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();

    // Subscribe to live indexing progress notifications
    const unsubscribe = window.quickFindApi?.indexing?.onProgress(update => {
      if (update.status === 'running') {
        setActiveProgress(update);
      } else {
        // Scan finished, cancelled or failed
        setActiveProgress(null);
        setIsCancelling(false);
        refreshData();
      }
    });

    // Subscribe to incremental filesystem synchronization updates
    const unsubSync = window.quickFindApi?.sync?.onStatusUpdate(() => {
      refreshData();
    });

    // Subscribe to view mode switches from tray/main process
    const unsubSwitchView = window.quickFindApi?.window?.onSwitchView?.(mode => {
      setViewMode(mode);
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubSync) unsubSync();
      if (unsubSwitchView) unsubSwitchView();
    };
  }, [refreshData]);

  // Handle Escape key when in manage mode to return to quick search
  useEffect(() => {
    if (viewMode !== 'manage') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewMode('search');
        window.quickFindApi?.window.setViewMode('search');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewMode]);

  const handleStartIndexing = async (volumeId: number) => {
    if (!window.quickFindApi) return;
    try {
      const res = await window.quickFindApi.indexing.startScan(volumeId);
      if (!res.success) {
        alert(`Failed to start indexing: ${res.error}`);
      } else {
        refreshData();
      }
    } catch (err) {
      alert(`Error starting scan: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelIndexing = async () => {
    if (!window.quickFindApi) return;
    try {
      setIsCancelling(true);
      await window.quickFindApi.indexing.cancelScan();
    } catch (err) {
      console.error('[QuickFind:Renderer] Cancel error:', err);
      setIsCancelling(false);
    }
  };

  const handleReconcileVolume = async (volumeId: number) => {
    if (!window.quickFindApi) return;
    try {
      const res = await window.quickFindApi.sync.reconcile(volumeId);
      if (res.success && res.data) {
        console.log(
          `[QuickFind:Renderer] Reconciled volume ${volumeId}: ${res.data.reconciledCount} items updated.`
        );
      }
      refreshData();
    } catch (err) {
      console.error('[QuickFind:Renderer] Reconcile error:', err);
    }
  };

  const isScanning = activeProgress !== null || indexingStatus?.state === 'indexing';

  if (viewMode === 'search') {
    return (
      <FloatingSearch
        onOpenManage={() => {
          setViewMode('manage');
          window.quickFindApi?.window.setViewMode('manage');
        }}
      />
    );
  }

  return (
    <div className="app-container">
      <Header
        appName={appInfo?.name || 'QuickFind'}
        onBackToSearch={() => {
          setViewMode('search');
          window.quickFindApi?.window.setViewMode('search');
        }}
      />

      <main className="app-content">
        {loading ? (
          <div className="state-card loading">
            <div className="spinner" />
            <p>Initializing QuickFind local engine...</p>
          </div>
        ) : error ? (
          <div className="state-card error">
            <div className="state-icon error-icon">⚠️</div>
            <h2>Initialization Problem</h2>
            <p className="error-message">{error}</p>
          </div>
        ) : (
          <div className="dashboard">
            {/* Hero Banner */}
            <section className="hero-banner">
              <div className="hero-status">
                <div className="success-icon-wrapper">
                  <svg
                    viewBox="0 0 24 24"
                    className="success-icon"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h1 className="hero-title">Local Index & Search Engine Active</h1>
                  <p className="hero-subtitle">
                    SQLite FTS5 Trigram full-text search, NTFS volume discovery, and background
                    worker indexing are operational.
                  </p>
                </div>
              </div>
              <div className="hero-meta">
                <StatusBadge
                  status={
                    isScanning ? 'pending' : health?.state === 'healthy' ? 'healthy' : 'degraded'
                  }
                  label={isScanning ? 'INDEXING' : 'READY'}
                />
              </div>
            </section>

            {/* Live Indexing Session View */}
            {activeProgress && (
              <IndexingProgressCard
                progress={activeProgress}
                onCancel={handleCancelIndexing}
                isCancelling={isCancelling}
              />
            )}

            {/* Volumes Section */}
            <section className="section-container">
              <div className="section-header">
                <div>
                  <h2 className="section-title">Discovered Local NTFS Volumes</h2>
                  <p className="section-subtitle">
                    Select a local drive to begin recursive filesystem scanning and SQLite indexing
                  </p>
                </div>
                <div className="section-badge">
                  <span>Total Indexed: </span>
                  <strong>
                    {(
                      (indexingStatus?.totalIndexedFiles || 0) +
                      (indexingStatus?.totalIndexedFolders || 0)
                    ).toLocaleString()}{' '}
                    entries
                  </strong>
                </div>
              </div>

              <div className="volumes-grid">
                {volumes.length > 0 ? (
                  volumes.map(vol => (
                    <VolumeCard
                      key={vol.id}
                      volume={vol}
                      isScanning={isScanning}
                      onStartIndexing={handleStartIndexing}
                      onReconcileVolume={handleReconcileVolume}
                    />
                  ))
                ) : (
                  <div className="empty-box">No accessible NTFS volumes found on this device.</div>
                )}
              </div>
            </section>

            {/* Interactive Search Engine Test Panel */}
            <SearchTester />

            {/* Architecture Overview Cards */}
            <div className="cards-grid">
              {/* Database Foundation */}
              <InfoCard
                title="Database Foundation"
                subtitle="Local persistent storage (userData)"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                }
                items={[
                  {
                    label: 'Status',
                    value: dbStatus?.connected ? 'Connected' : 'Disconnected',
                    highlight: true,
                  },
                  {
                    label: 'Journal Mode',
                    value: dbStatus?.journalMode?.toUpperCase() || 'UNKNOWN',
                  },
                  {
                    label: 'SQLite FTS5',
                    value: dbStatus?.fts5Available ? 'Enabled' : 'Unavailable',
                    highlight: true,
                  },
                  {
                    label: 'Indexed Files',
                    value: (indexingStatus?.totalIndexedFiles || 0).toLocaleString(),
                  },
                  {
                    label: 'Indexed Folders',
                    value: (indexingStatus?.totalIndexedFolders || 0).toLocaleString(),
                  },
                  { label: 'Location', value: dbStatus?.filePath || 'N/A' },
                ]}
              />

              {/* Engine Architecture */}
              <InfoCard
                title="Engine Architecture"
                subtitle="Component execution status"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                }
                items={[
                  {
                    label: 'Desktop Interface',
                    value: 'React 19 + Vite (Sandboxed)',
                    highlight: true,
                  },
                  {
                    label: 'Indexing Engine',
                    value: isScanning ? 'Active (Scanning)' : 'Ready (Worker Thread)',
                    highlight: true,
                  },
                  { label: 'Concurrency Model', value: 'Bounded (8 Workers/Batch 2000)' },
                  { label: 'NTFS Reparse Points', value: 'Ignored (No recursion)' },
                  {
                    label: 'Search Engine',
                    value: 'Active (FTS5 Trigram & Ranked Query Engine)',
                    highlight: true,
                  },
                ]}
              />

              {/* Environment Information */}
              <InfoCard
                title="Runtime Environment"
                subtitle="Local platform specifications"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                }
                items={[
                  { label: 'Environment', value: appInfo?.environment || 'unknown' },
                  { label: 'Electron', value: `v${appInfo?.electronVersion || 'N/A'}` },
                  { label: 'Node.js', value: `v${appInfo?.nodeVersion || 'N/A'}` },
                  { label: 'Chromium', value: `v${appInfo?.chromeVersion || 'N/A'}` },
                  { label: 'Platform', value: `${appInfo?.platform} (${appInfo?.arch})` },
                ]}
              />
            </div>

            <footer className="footer-note">
              <span>QuickFind Milestone 3 Complete: SQLite FTS5 Trigram Search Engine Active</span>
              <span>•</span>
              <span>Next Milestone: Keyboard-Driven Desktop Search Interface</span>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
};
