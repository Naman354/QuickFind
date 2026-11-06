import React, { useState, useEffect, useRef } from 'react';
import { MatchType, SearchQuery, SearchResults } from '../../shared/types';

export const SearchTester: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState<string>('package.json');
  const [fileFilter, setFileFilter] = useState<'all' | 'files' | 'folders'>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const executeSearch = async (term: string, typeFilter: 'all' | 'files' | 'folders') => {
    if (!window.quickFindApi) return;

    setLoading(true);
    try {
      const query: SearchQuery = {
        term,
        limit: 25,
        offset: 0,
        filters: {
          isDirectory: typeFilter === 'all' ? undefined : typeFilter === 'folders',
        },
      };

      const res = await window.quickFindApi.search(query);
      if (res.success && res.data) {
        setResults(res.data);
      }
    } catch (err) {
      console.error('[QuickFind:SearchTester] Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      executeSearch(searchTerm, fileFilter);
    }, 150);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchTerm, fileFilter]);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (ms: number): string => {
    if (!ms) return 'Unknown';
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getRankBadgeClass = (matchType: MatchType): string => {
    switch (matchType) {
      case 'exact_filename':
        return 'rank-badge rank-exact';
      case 'prefix_filename':
        return 'rank-badge rank-prefix';
      case 'substring_filename':
        return 'rank-badge rank-sub';
      case 'exact_folder':
        return 'rank-badge rank-folder';
      case 'path_match':
      default:
        return 'rank-badge rank-path';
    }
  };

  const getRankBadgeLabel = (matchType: MatchType): string => {
    switch (matchType) {
      case 'exact_filename':
        return 'Exact Name';
      case 'prefix_filename':
        return 'Prefix Match';
      case 'substring_filename':
        return 'Substring';
      case 'exact_folder':
        return 'Exact Folder';
      case 'prefix_folder':
        return 'Folder Prefix';
      case 'path_match':
      default:
        return 'Path Match';
    }
  };

  return (
    <section className="search-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Search Engine & Query Test</h2>
          <p className="section-subtitle">
            Sub-millisecond queries powered by SQLite FTS5 Trigram index and ranked B-tree matching
          </p>
        </div>
        {results && (
          <div className="search-meta-chip">
            <span className="speed-dot" />
            <span>
              {results.executionTimeMs} ms • {results.totalHits.toLocaleString()} hits (
              {results.strategy.toUpperCase()})
            </span>
          </div>
        )}
      </div>

      <div className="search-box-row">
        <div className="search-input-wrapper">
          <svg
            viewBox="0 0 24 24"
            className="search-input-icon"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="search-input"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search filenames, extensions (.pdf), or paths (e.g. package, DBMS)..."
          />
          {searchTerm && (
            <button className="search-clear-btn" onClick={() => setSearchTerm('')}>
              ×
            </button>
          )}
        </div>

        <div className="filter-pill-group">
          <button
            className={`filter-pill ${fileFilter === 'all' ? 'active' : ''}`}
            onClick={() => setFileFilter('all')}
          >
            All
          </button>
          <button
            className={`filter-pill ${fileFilter === 'files' ? 'active' : ''}`}
            onClick={() => setFileFilter('files')}
          >
            Files Only
          </button>
          <button
            className={`filter-pill ${fileFilter === 'folders' ? 'active' : ''}`}
            onClick={() => setFileFilter('folders')}
          >
            Folders Only
          </button>
        </div>
      </div>

      {/* Suggested Quick Searches */}
      <div className="quick-tags-row">
        <span className="quick-tags-label">Quick Queries:</span>
        {['package.json', 'package', 'json', '.ts', 'dist', 'node_modules'].map(q => (
          <button key={q} className="quick-tag-btn" onClick={() => setSearchTerm(q)}>
            {q}
          </button>
        ))}
      </div>

      {/* Search Results List */}
      <div className="search-results-box">
        {loading ? (
          <div className="search-empty-state">
            <div className="spinner-small" />
            <span>Searching SQLite index...</span>
          </div>
        ) : results && results.items.length > 0 ? (
          <div className="search-items-list">
            {results.items.map(item => (
              <div key={item.id} className="search-item-row">
                <div className="search-item-icon">
                  {item.isDirectory ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  )}
                </div>

                <div className="search-item-info">
                  <div className="search-item-title-row">
                    <span className="search-item-name">{item.name}</span>
                    <span className={getRankBadgeClass(item.matchType)}>
                      {getRankBadgeLabel(item.matchType)}
                    </span>
                  </div>
                  <span className="search-item-path" title={item.path}>
                    {item.path}
                  </span>
                </div>

                <div className="search-item-meta">
                  <span className="item-size">
                    {item.isDirectory ? 'Directory' : formatSize(item.sizeBytes)}
                  </span>
                  <span className="item-date">{formatDate(item.modifiedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="search-empty-state">
            <span>No matching entries found in the local index for &quot;{searchTerm}&quot;.</span>
          </div>
        )}
      </div>
    </section>
  );
};
