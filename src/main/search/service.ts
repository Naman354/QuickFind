import { ISearchEngine, SearchQuery, SearchResults } from './types';

/**
 * SearchService
 * Logical facade for the Search Engine component.
 * Decoupled from IPC and database internals, ready for FTS5 queries in future milestones.
 */
export class SearchService implements ISearchEngine {
  private static instance: SearchService | null = null;

  private constructor() {}

  public static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService();
    }
    return SearchService.instance;
  }

  public async search(query: SearchQuery): Promise<SearchResults> {
    // Search implementation belongs to subsequent milestones
    return {
      term: query.term,
      totalHits: 0,
      items: [],
      executionTimeMs: 0,
    };
  }

  public async dispose(): Promise<void> {
    // Teardown logic when needed
  }
}

