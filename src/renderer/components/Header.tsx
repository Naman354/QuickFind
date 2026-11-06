import React from 'react';

interface HeaderProps {
  appName: string;
  onBackToSearch?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ appName, onBackToSearch }) => {
  const handleMinimize = () => {
    window.quickFindApi?.window.minimize();
  };

  const handleMaximize = () => {
    window.quickFindApi?.window.maximize();
  };

  const handleClose = () => {
    window.quickFindApi?.window.close();
  };

  return (
    <header className="app-header">
      <div className="app-header-drag">
        <div className="app-logo">
          <svg
            className="app-logo-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <path d="M11 8v6M8 11h6" />
          </svg>
          <span className="app-title">{appName}</span>
          <span className="app-badge">Management</span>
        </div>
      </div>
      {onBackToSearch && (
        <button
          className="header-switch-btn"
          onClick={onBackToSearch}
          title="Switch to Floating Search (Ctrl+Shift+Space)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Quick Search</span>
        </button>
      )}
      <div className="window-controls">
        <button
          className="window-btn minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize window"
        >
          <svg viewBox="0 0 10 10" width="10" height="10">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="window-btn maximize"
          onClick={handleMaximize}
          title="Maximize"
          aria-label="Maximize window"
        >
          <svg viewBox="0 0 10 10" width="10" height="10">
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
        <button
          className="window-btn close"
          onClick={handleClose}
          title="Close"
          aria-label="Close window"
        >
          <svg viewBox="0 0 10 10" width="10" height="10">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
};
