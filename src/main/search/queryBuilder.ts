import { SEARCH_CONFIG } from '../../shared/constants';
import { MatchType, SearchFilter, SearchQuery } from '../../shared/types';

export interface SqlQueryPlan {
  strategy: 'fts5' | 'short_query' | 'filter_only' | 'empty';
  itemsSql: string;
  itemsParams: Record<string, unknown>;
  countSql: string;
  countParams: Record<string, unknown>;
  limit: number;
  offset: number;
}

export class SearchQueryBuilder {
  /**
   * Translates a SearchQuery into an optimized SQL execution plan
   */
  public static buildPlan(query: SearchQuery): SqlQueryPlan {
    const rawTerm = (query.term || '').trim();
    const limit = Math.min(
      Math.max(query.limit ?? SEARCH_CONFIG.DEFAULT_LIMIT, 1),
      SEARCH_CONFIG.MAX_LIMIT
    );
    const offset = Math.max(query.offset ?? 0, 0);
    const filters = query.filters || {};

    // 1. Empty query
    if (rawTerm.length === 0) {
      if (this.hasActiveFilters(filters)) {
        return this.buildFilterOnlyPlan(filters, limit, offset);
      }
      return {
        strategy: 'empty',
        itemsSql: '',
        itemsParams: {},
        countSql: '',
        countParams: {},
        limit,
        offset,
      };
    }

    // 2. Short query (< 3 chars, trigram tokenizer threshold)
    if (rawTerm.length < SEARCH_CONFIG.TRIGRAM_MIN_LENGTH) {
      return this.buildShortQueryPlan(rawTerm, filters, limit, offset);
    }

    // 3. Standard FTS5 trigram query (>= 3 chars)
    return this.buildFtsPlan(rawTerm, filters, limit, offset);
  }

  /**
   * Builds an FTS5 trigram search plan with ranked ordering
   */
  private static buildFtsPlan(
    rawTerm: string,
    filters: SearchFilter,
    limit: number,
    offset: number
  ): SqlQueryPlan {
    const ftsQuery = this.formatFtsQuery(rawTerm);
    const whereClauses: string[] = ['entries_fts MATCH @ftsQuery'];
    const params: Record<string, unknown> = {
      rawTerm,
      ftsQuery,
      limit,
      offset,
    };

    this.applyCommonFilters(filters, whereClauses, params);

    const where = whereClauses.join(' AND ');

    const itemsSql = `
      SELECT
        e.id,
        e.name,
        e.path,
        e.parent_path,
        e.extension,
        e.is_directory,
        e.size_bytes,
        e.modified_at,
        e.created_at,
        CASE
          WHEN lower(e.name) = lower(@rawTerm) AND e.is_directory = 0 THEN 1
          WHEN lower(e.name) LIKE lower(@rawTerm) || '%' AND e.is_directory = 0 THEN 2
          WHEN lower(e.name) LIKE '%' || lower(@rawTerm) || '%' AND e.is_directory = 0 THEN 3
          WHEN lower(e.name) = lower(@rawTerm) AND e.is_directory = 1 THEN 4
          WHEN lower(e.name) LIKE lower(@rawTerm) || '%' AND e.is_directory = 1 THEN 4
          ELSE 5
        END AS rank_score
      FROM entries_fts fts
      JOIN entries e ON e.id = fts.rowid
      WHERE ${where}
      ORDER BY rank_score ASC, length(e.name) ASC, e.modified_at DESC, e.name ASC
      LIMIT @limit OFFSET @offset;
    `;

    const countSql = `
      SELECT count(*) as total
      FROM entries_fts fts
      JOIN entries e ON e.id = fts.rowid
      WHERE ${where};
    `;

    const countParams = { ...params };
    delete countParams.limit;
    delete countParams.offset;

    return {
      strategy: 'fts5',
      itemsSql,
      itemsParams: params,
      countSql,
      countParams,
      limit,
      offset,
    };
  }

  /**
   * Builds a fallback plan for short queries (1-2 chars) using indexed B-trees
   */
  private static buildShortQueryPlan(
    rawTerm: string,
    filters: SearchFilter,
    limit: number,
    offset: number
  ): SqlQueryPlan {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {
      rawTerm,
      limit,
      offset,
    };

    if (rawTerm.startsWith('.')) {
      whereClauses.push('(e.extension = @rawTerm COLLATE NOCASE)');
    } else {
      whereClauses.push(
        `(e.name = @rawTerm COLLATE NOCASE OR e.name LIKE @rawTerm || '%' COLLATE NOCASE OR e.extension = ('.' || @rawTerm) COLLATE NOCASE)`
      );
    }

    this.applyCommonFilters(filters, whereClauses, params);

    const where = whereClauses.join(' AND ');

    const itemsSql = `
      SELECT
        e.id,
        e.name,
        e.path,
        e.parent_path,
        e.extension,
        e.is_directory,
        e.size_bytes,
        e.modified_at,
        e.created_at,
        CASE
          WHEN lower(e.name) = lower(@rawTerm) AND e.is_directory = 0 THEN 1
          WHEN lower(e.name) LIKE lower(@rawTerm) || '%' AND e.is_directory = 0 THEN 2
          WHEN e.extension = ('.' || lower(@rawTerm)) AND e.is_directory = 0 THEN 2
          WHEN lower(e.name) = lower(@rawTerm) AND e.is_directory = 1 THEN 4
          WHEN lower(e.name) LIKE lower(@rawTerm) || '%' AND e.is_directory = 1 THEN 4
          ELSE 5
        END AS rank_score
      FROM entries e
      WHERE ${where}
      ORDER BY rank_score ASC, length(e.name) ASC, e.modified_at DESC, e.name ASC
      LIMIT @limit OFFSET @offset;
    `;

    const countSql = `
      SELECT count(*) as total
      FROM entries e
      WHERE ${where};
    `;

    const countParams = { ...params };
    delete countParams.limit;
    delete countParams.offset;

    return {
      strategy: 'short_query',
      itemsSql,
      itemsParams: params,
      countSql,
      countParams,
      limit,
      offset,
    };
  }

  /**
   * Builds a plan when no search term is given but filters are applied
   */
  private static buildFilterOnlyPlan(
    filters: SearchFilter,
    limit: number,
    offset: number
  ): SqlQueryPlan {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {
      limit,
      offset,
    };

    this.applyCommonFilters(filters, whereClauses, params);

    const where = whereClauses.length > 0 ? whereClauses.join(' AND ') : '1=1';

    const itemsSql = `
      SELECT
        e.id,
        e.name,
        e.path,
        e.parent_path,
        e.extension,
        e.is_directory,
        e.size_bytes,
        e.modified_at,
        e.created_at,
        1 AS rank_score
      FROM entries e
      WHERE ${where}
      ORDER BY e.modified_at DESC, e.name ASC
      LIMIT @limit OFFSET @offset;
    `;

    const countSql = `
      SELECT count(*) as total
      FROM entries e
      WHERE ${where};
    `;

    const countParams = { ...params };
    delete countParams.limit;
    delete countParams.offset;

    return {
      strategy: 'filter_only',
      itemsSql,
      itemsParams: params,
      countSql,
      countParams,
      limit,
      offset,
    };
  }

  /**
   * Formats raw user input into safe FTS5 trigram match expressions
   */
  public static formatFtsQuery(term: string): string {
    // If user input contains Windows path separators, keep intact as single quoted phrase
    if (term.includes('\\') || term.includes('/')) {
      const sanitized = term.replace(/"/g, '""');
      return `"${sanitized}"`;
    }

    // Split space-separated keywords if multiple words were given
    const words = term
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0);

    if (words.length === 1) {
      return `"${words[0].replace(/"/g, '""')}"`;
    }

    // Wrap individual tokens >= 3 characters in quotes for trigram matching
    const tokens = words
      .filter(w => w.length >= SEARCH_CONFIG.TRIGRAM_MIN_LENGTH)
      .map(w => `"${w.replace(/"/g, '""')}"`);

    if (tokens.length > 0) {
      return tokens.join(' ');
    }

    // Fallback for short token combinations
    return `"${term.replace(/"/g, '""')}"`;
  }

  /**
   * Applies structured filters (isDirectory, extension, volumeId, pathPrefix)
   */
  private static applyCommonFilters(
    filters: SearchFilter,
    whereClauses: string[],
    params: Record<string, unknown>
  ): void {
    if (filters.isDirectory !== undefined) {
      whereClauses.push(`e.is_directory = ${filters.isDirectory ? 1 : 0}`);
    }

    if (filters.volumeId !== undefined) {
      whereClauses.push(`e.volume_id = @filterVolumeId`);
      params.filterVolumeId = filters.volumeId;
    }

    if (filters.pathPrefix) {
      whereClauses.push(`e.path LIKE @filterPathPrefix || '%' COLLATE NOCASE`);
      params.filterPathPrefix = filters.pathPrefix;
    }

    if (filters.extension && filters.extension.length > 0) {
      const normalizedExts = filters.extension.map(ext =>
        ext.startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase()
      );

      const inClauses = normalizedExts.map((_, i) => `@ext_${i}`).join(', ');
      whereClauses.push(`lower(e.extension) IN (${inClauses})`);

      normalizedExts.forEach((ext, i) => {
        params[`ext_${i}`] = ext;
      });
    }

    if (filters.minSizeBytes !== undefined) {
      whereClauses.push(`e.size_bytes >= @minSizeBytes`);
      params.minSizeBytes = filters.minSizeBytes;
    }

    if (filters.maxSizeBytes !== undefined) {
      whereClauses.push(`e.size_bytes <= @maxSizeBytes`);
      params.maxSizeBytes = filters.maxSizeBytes;
    }
  }

  /**
   * Maps numeric rank score (1-5) to typed MatchType
   */
  public static mapScoreToMatchType(score: number, isDirectory: boolean): MatchType {
    switch (score) {
      case 1:
        return 'exact_filename';
      case 2:
        return 'prefix_filename';
      case 3:
        return 'substring_filename';
      case 4:
        return isDirectory ? 'exact_folder' : 'prefix_folder';
      case 5:
      default:
        return 'path_match';
    }
  }

  private static hasActiveFilters(filters: SearchFilter): boolean {
    return Boolean(
      filters.isDirectory !== undefined ||
      filters.volumeId !== undefined ||
      (filters.extension && filters.extension.length > 0) ||
      filters.pathPrefix ||
      filters.minSizeBytes !== undefined ||
      filters.maxSizeBytes !== undefined
    );
  }
}
