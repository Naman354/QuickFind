import { DatabaseManager } from '../database';
import { ISearchEngine } from './types';
import { SearchQueryBuilder } from './queryBuilder';
import { SearchQuery, SearchResultItem, SearchResults } from '../../shared/types';

interface RawSearchRow {
  id: number;
  name: string;
  path: string;
  parent_path: string;
  extension: string;
  is_directory: number;
  size_bytes: number;
  modified_at: number;
  created_at: number;
  rank_score: number;
}

/**
 * SearchService
 * High-performance search engine executing ranked full-text and B-tree queries on SQLite.
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

  /**
   * Executes a search query matching filenames, paths, and metadata
   */
  public async search(query: SearchQuery): Promise<SearchResults> {
    const startTime = performance.now();
    const db = DatabaseManager.getInstance().getDatabase();

    const plan = SearchQueryBuilder.buildPlan(query);

    // Empty query with no filters
    if (plan.strategy === 'empty') {
      return {
        term: query.term || '',
        totalHits: 0,
        items: [],
        executionTimeMs: 0,
        hasMore: false,
        limit: plan.limit,
        offset: plan.offset,
        strategy: 'empty',
      };
    }

    try {
      // 1. Fetch matching items
      const itemsStmt = db.prepare(plan.itemsSql);
      const rows = itemsStmt.all(plan.itemsParams) as RawSearchRow[];

      // 2. Fetch total hit count
      const countStmt = db.prepare(plan.countSql);
      const countRes = countStmt.get(plan.countParams) as { total: number } | undefined;
      const totalHits = countRes?.total ?? rows.length;

      // 3. Map into strongly-typed SearchResultItems
      const items: SearchResultItem[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        path: r.path,
        parentPath: r.parent_path,
        extension: r.extension,
        isDirectory: Boolean(r.is_directory),
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        modifiedAt: r.modified_at,
        matchType: SearchQueryBuilder.mapScoreToMatchType(r.rank_score, Boolean(r.is_directory)),
        score: r.rank_score,
      }));

      const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
      const hasMore = plan.offset + items.length < totalHits;

      return {
        term: query.term,
        totalHits,
        items,
        executionTimeMs,
        hasMore,
        limit: plan.limit,
        offset: plan.offset,
        strategy: plan.strategy,
      };
    } catch (err) {
      console.error('[QuickFind:SearchService] Search execution failed:', err);
      throw err;
    }
  }

  public async dispose(): Promise<void> {
    // Teardown resources when needed
  }
}
