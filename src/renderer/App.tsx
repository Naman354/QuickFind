import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { StatusBadge } from './components/StatusBadge';
import { InfoCard } from './components/InfoCard';
import { AppInfo, DatabaseStatus, SystemHealth } from '../shared/types';
import './App.css';

export const App: React.FC = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadInitialData() {
      if (!window.quickFindApi) {
        setError('IPC bridge (quickFindApi) is not available in the renderer window.');
        setLoading(false);
        return;
      }

      try {
        const [infoRes, healthRes, dbRes] = await Promise.all([
          window.quickFindApi.getAppInfo(),
          window.quickFindApi.getHealth(),
          window.quickFindApi.getDatabaseStatus(),
        ]);

        if (infoRes.success && infoRes.data) {
          setAppInfo(infoRes.data);
        } else {
          setError(infoRes.error || 'Failed to fetch application metadata');
        }

        if (healthRes.success && healthRes.data) {
          setHealth(healthRes.data);
        }

        if (dbRes.success && dbRes.data) {
          setDbStatus(dbRes.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, []);

  return (
    <div className="app-container">
      <Header appName={appInfo?.name || 'QuickFind'} />

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
            {/* Success Banner */}
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
                  <h1 className="hero-title">QuickFind Started Successfully</h1>
                  <p className="hero-subtitle">
                    Desktop foundation, local SQLite persistence, and secure IPC boundaries are
                    active.
                  </p>
                </div>
              </div>
              <div className="hero-meta">
                <StatusBadge
                  status={health?.state === 'healthy' ? 'healthy' : 'degraded'}
                  label={health?.state === 'healthy' ? 'READY' : 'DEGRADED'}
                />
              </div>
            </section>

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
                    value: dbStatus?.fts5Available ? 'Enabled & Ready' : 'Unavailable',
                    highlight: true,
                  },
                  {
                    label: 'Foreign Keys',
                    value: dbStatus?.foreignKeysEnabled ? 'Enforced' : 'Off',
                  },
                  { label: 'Memory Cache', value: `${dbStatus?.cacheSizeKb || 0} KB` },
                  { label: 'Location', value: dbStatus?.filePath || 'N/A' },
                ]}
              />

              {/* Architecture Pillars */}
              <InfoCard
                title="Engine Architecture"
                subtitle="Logical component status"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                }
                items={[
                  {
                    label: 'Desktop Interface (UI)',
                    value: 'Active (React 19 + Vite)',
                    highlight: true,
                  },
                  { label: 'Preload / IPC Security', value: 'Sandboxed (contextIsolation)' },
                  { label: 'Indexing Engine Facade', value: 'Ready for Milestone 2' },
                  { label: 'Search Engine Facade', value: 'Ready for Milestone 2' },
                  { label: 'Worker / Utility Offload', value: 'Architecturally Supported' },
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
              <span>QuickFind Milestone 1 Foundation Complete</span>
              <span>•</span>
              <span>Next Milestone: Filesystem Indexing & Search Engine Schema</span>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
};
