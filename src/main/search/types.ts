/**
 * Search Engine Architecture & Contracts
 * Milestone 1: Architecture boundary definition.
 * Subsequent milestones will implement query parsing, FTS5 matching,
 * metadata ranking, and result filtering.
 */

export interface SearchFilter {
  extension?: string[];
  pathPrefix?: string;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  isDirectory?: boolean;
}

export interface SearchQuery {
  term: string;
  filters?: SearchFilter;
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  id: string | number;
  name: string;
  path: string;
  extension: string;
  sizeBytes: number;
  isDirectory: boolean;
  modifiedTimestamp: number;
  score?: number;
}

export interface SearchResults {
  term: string;
  totalHits: number;
  items: SearchResultItem[];
  executionTimeMs: number;
}

export interface ISearchEngine {
  search(query: SearchQuery): Promise<SearchResults>;
  dispose(): Promise<void>;
}
