/**
 * Search Engine Types & Contracts
 */

export type MatchType =
  | 'exact_filename'
  | 'prefix_filename'
  | 'substring_filename'
  | 'exact_folder'
  | 'prefix_folder'
  | 'path_match';

export interface SearchFilter {
  extension?: string[];
  isDirectory?: boolean;
  volumeId?: number;
  pathPrefix?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
}

export interface SearchQuery {
  term: string;
  filters?: SearchFilter;
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  id: number;
  name: string;
  path: string;
  parentPath: string;
  extension: string;
  isDirectory: boolean;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
  matchType: MatchType;
  score: number;
}

export interface SearchResults {
  term: string;
  totalHits: number;
  items: SearchResultItem[];
  executionTimeMs: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  strategy: 'fts5' | 'short_query' | 'filter_only' | 'empty';
}
