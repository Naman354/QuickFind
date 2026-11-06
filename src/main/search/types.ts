import { SearchQuery, SearchResults } from '../../shared/types';

export interface ISearchEngine {
  search(query: SearchQuery): Promise<SearchResults>;
  dispose(): Promise<void>;
}

export * from '../../shared/types/search';
