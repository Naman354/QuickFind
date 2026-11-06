import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SearchQuery, SearchResults, SearchResultItem, MatchType } from '../../shared/types';

interface FloatingSearchProps {
  onOpenManage: () => void;
}

export const FloatingSearch: React.FC<FloatingSearchProps> = ({ onOpenManage }) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [fileFilter, setFileFilter] = useState<'all' | 'files' | 'folders'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2200);
  }, []);

  const showError = useCallback((err: string) => {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    setErrorMessage(err);
    errorTimeoutRef.current = setTimeout(() => {
      setErrorMessage(null);
    }, 4000);
  }, []);

  // Execute search query
  const executeSearch = useCallback(async (term: string, filter: 'all' | 'files' | 'folders') => {
    if (!window.quickFindApi) return;

    const trimmed = term.trim();
    if (!trimmed) {
      setResults(null);
      setSelectedIndex(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const query: SearchQuery = {
        term: trimmed,
        limit: 30,
        offset: 0,
        filters: {
          isDirectory: filter === 'all' ? undefined : filter === 'folders',
        },
      };

      const res = await window.quickFindApi.search(query);
      if (res.success && res.data) {
        setResults(res.data);
        setSelectedIndex(0);
      } else if (res.error) {
        console.warn('[QuickFind:Search] Search error:', res.error);
      }
    } catch (err) {
      console.error('[QuickFind:Search] Unexpected query error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search trigger
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      if (!searchTerm.trim()) {
        setResults(null);
        setSelectedIndex(0);
        setLoading(false);
      } else {
        executeSearch(searchTerm, fileFilter);
      }
    }, 120);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchTerm, fileFilter, executeSearch]);

  // Adjust floating window height dynamically
  useEffect(() => {
    if (!window.quickFindApi?.window?.setHeight) return;

    let targetHeight = 58; // Base height for input bar

    if (errorMessage) {
      targetHeight += 38;
    }

    if (loading && !results) {
      targetHeight += 56;
    } else if (results && results.items.length > 0) {
      // Input (58) + list items + footer (38)
      const listHeight = Math.min(results.items.length * 52, 410);
      targetHeight = 58 + listHeight + 38;
      if (errorMessage) targetHeight += 38;
    } else if (searchTerm.trim() && !loading) {
      // Empty results state
      targetHeight = 58 + 68 + 38;
      if (errorMessage) targetHeight += 38;
    }

    window.quickFindApi.window.setHeight(targetHeight);
  }, [results, loading, searchTerm, errorMessage]);

  // Focus input automatically on mount and when signaled by main process
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    const unsubFocus = window.quickFindApi?.window?.onFocusInput?.(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      if (unsubFocus) unsubFocus();
    };
  }, []);

  // Ensure selected item stays scrolled into view
  useEffect(() => {
    if (results && results.items.length > 0) {
      const selectedEl = itemRefs.current[selectedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, results]);

  // Open file or folder
  const handleOpenFile = async (item: SearchResultItem) => {
    if (!window.quickFindApi?.file) return;

    try {
      const res = await window.quickFindApi.file.open(item.path);
      if (res.success) {
        // Dismiss floating window on successful file open
        await window.quickFindApi.window.hide();
      } else {
        showError(res.error || 'Unable to open file or folder');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  // Reveal item in Windows Explorer
  const handleRevealInExplorer = async (item: SearchResultItem) => {
    if (!window.quickFindApi?.file) return;

    try {
      const res = await window.quickFindApi.file.reveal(item.path);
      if (res.success) {
        showToast('Revealed in File Explorer');
      } else {
        showError(res.error || 'Failed to reveal item in Explorer');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  // Copy path to clipboard
  const handleCopyPath = async (item: SearchResultItem) => {
    if (!window.quickFindApi?.file) return;

    try {
      const res = await window.quickFindApi.file.copyPath(item.path);
      if (res.success) {
        showToast('Path copied to clipboard');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle global keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = results?.items || [];

    // Escape: Dismiss error/toast -> Clear query -> Hide window
    if (e.key === 'Escape') {
      e.preventDefault();
      if (errorMessage || toastMessage) {
        setErrorMessage(null);
        setToastMessage(null);
        return;
      }
      if (searchTerm) {
        setSearchTerm('');
        setResults(null);
      } else {
        window.quickFindApi?.window?.hide();
      }
      return;
    }

    // Ctrl + Shift + C: Copy path of selected item
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      if (items.length > 0 && items[selectedIndex]) {
        handleCopyPath(items[selectedIndex]);
      }
      return;
    }

    // Enter or Ctrl + Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length > 0 && items[selectedIndex]) {
        if (e.ctrlKey || e.metaKey) {
          handleRevealInExplorer(items[selectedIndex]);
        } else {
          handleOpenFile(items[selectedIndex]);
        }
      }
      return;
    }

    // Arrow Down
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        setSelectedIndex(prev => (prev + 1 < items.length ? prev + 1 : 0));
      }
      return;
    }

    // Arrow Up
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : items.length - 1));
      }
      return;
    }
  };

  // Global keypress catcher: typing anywhere focuses the search input
  const handleWindowKeyDown = (e: React.KeyboardEvent) => {
    if (
      inputRef.current &&
      document.activeElement !== inputRef.current &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      inputRef.current.focus();
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (ms: number): string => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getRankBadgeLabel = (matchType: MatchType): string => {
    switch (matchType) {
      case 'exact_filename':
        return 'Exact Name';
      case 'prefix_filename':
        return 'Prefix';
      case 'substring_filename':
        return 'Substring';
      case 'exact_folder':
        return 'Folder';
      case 'prefix_folder':
        return 'Folder Prefix';
      case 'path_match':
      default:
        return 'Path';
    }
  };

  const getFileCategoryIcon = (item: SearchResultItem) => {
    if (item.isDirectory) {
      return (
        <svg
          viewBox="0 0 24 24"
          className="result-type-icon dir-icon"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    }

    const ext = (item.extension || '').toLowerCase();

    // Code files
    if (
      [
        'ts',
        'tsx',
        'js',
        'jsx',
        'json',
        'py',
        'rs',
        'go',
        'c',
        'cpp',
        'cs',
        'java',
        'html',
        'css',
        'sql',
        'sh',
        'ps1',
      ].includes(ext)
    ) {
      return (
        <svg
          viewBox="0 0 24 24"
          className="result-type-icon code-icon"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    }

    // Documents
    if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) {
      return (
        <svg
          viewBox="0 0 24 24"
          className="result-type-icon doc-icon"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    }

    // Images
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
      return (
        <svg
          viewBox="0 0 24 24"
          className="result-type-icon media-icon"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    }

    // General file
    return (
      <svg
        viewBox="0 0 24 24"
        className="result-type-icon file-icon"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    );
  };

  const items = results?.items || [];
  const hasResults = items.length > 0;
  const isQueryActive = searchTerm.trim().length > 0;

  return (
    <div
      className="floating-search-window"
      onKeyDown={handleKeyDown}
      onKeyUp={handleWindowKeyDown}
      tabIndex={-1}
    >
      {/* Primary Floating Search Bar */}
      <div className="search-bar-row">
        <div className="search-icon-container">
          <svg
            viewBox="0 0 24 24"
            className={`floating-search-icon ${loading ? 'pulsing' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="floating-search-input"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search files, folders, extensions (.pdf), or paths..."
          spellCheck={false}
          autoComplete="off"
        />

        {/* Query execution chips & clear */}
        <div className="search-actions-cluster">
          {results && isQueryActive && (
            <div className="speed-chip">
              <span className="speed-dot" />
              <span>{results.executionTimeMs} ms</span>
              <span className="divider">•</span>
              <span>{results.totalHits.toLocaleString()} hits</span>
            </div>
          )}

          {searchTerm && (
            <button
              className="clear-search-btn"
              title="Clear search (Esc)"
              onClick={() => {
                setSearchTerm('');
                setResults(null);
                inputRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}

          {/* Quick switch to Manage Volumes Dashboard */}
          <button
            className="settings-gear-btn"
            title="Manage Indexed Volumes"
            onClick={onOpenManage}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline Feedback Alerts */}
      {errorMessage && (
        <div className="floating-alert error-alert">
          <span className="alert-icon">⚠️</span>
          <span className="alert-text">{errorMessage}</span>
          <button className="alert-close-btn" onClick={() => setErrorMessage(null)}>
            ×
          </button>
        </div>
      )}

      {toastMessage && (
        <div className="floating-alert info-alert">
          <span className="alert-icon">✓</span>
          <span className="alert-text">{toastMessage}</span>
        </div>
      )}

      {/* Expanding Results Section */}
      {isQueryActive && (
        <div className="results-container" ref={resultsContainerRef}>
          {/* Quick Filter Selector */}
          <div className="results-filter-bar">
            <div className="filter-buttons">
              <button
                className={`filter-btn ${fileFilter === 'all' ? 'active' : ''}`}
                onClick={() => setFileFilter('all')}
              >
                All
              </button>
              <button
                className={`filter-btn ${fileFilter === 'files' ? 'active' : ''}`}
                onClick={() => setFileFilter('files')}
              >
                Files
              </button>
              <button
                className={`filter-btn ${fileFilter === 'folders' ? 'active' : ''}`}
                onClick={() => setFileFilter('folders')}
              >
                Folders
              </button>
            </div>
            {hasResults && (
              <span className="selection-counter">
                {selectedIndex + 1} of {items.length}
              </span>
            )}
          </div>

          {loading && !hasResults ? (
            <div className="floating-empty-box">
              <div className="spinner-mini" />
              <span>Searching local index...</span>
            </div>
          ) : hasResults ? (
            <div className="results-list" role="listbox">
              {items.map((item, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={item.id}
                    ref={el => {
                      itemRefs.current[index] = el;
                    }}
                    role="option"
                    aria-selected={isSelected}
                    className={`result-item-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedIndex(index);
                      handleOpenFile(item);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="item-icon-col">{getFileCategoryIcon(item)}</div>

                    <div className="item-main-col">
                      <div className="item-title-line">
                        <span className="item-name">{item.name}</span>
                        <span className={`match-badge badge-${item.matchType}`}>
                          {getRankBadgeLabel(item.matchType)}
                        </span>
                      </div>
                      <span className="item-path" title={item.path}>
                        {item.path}
                      </span>
                    </div>

                    <div className="item-meta-col">
                      <span className="meta-size">
                        {item.isDirectory ? 'Folder' : formatSize(item.sizeBytes)}
                      </span>
                      {item.modifiedAt ? (
                        <span className="meta-date">{formatDate(item.modifiedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="floating-empty-box">
              <span className="empty-sub">
                No matching files or folders found for &quot;{searchTerm}&quot;
              </span>
            </div>
          )}

          {/* Keyboard Shortcuts Legend Footer */}
          <footer className="keyboard-footer">
            <div className="shortcut-pill">
              <kbd>↵</kbd>
              <span>Open</span>
            </div>
            <div className="shortcut-pill">
              <kbd>Ctrl</kbd>+<kbd>↵</kbd>
              <span>Reveal</span>
            </div>
            <div className="shortcut-pill">
              <kbd>Ctrl</kbd>+<kbd>⇧</kbd>+<kbd>C</kbd>
              <span>Copy Path</span>
            </div>
            <div className="shortcut-pill">
              <kbd>Esc</kbd>
              <span>Dismiss</span>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
};
