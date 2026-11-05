import { AppConfig, getAppConfig } from '../config/appConfig';
import { DatabaseManager } from '../database';
import { IndexingService } from '../indexing';
import { SearchService } from '../search';
import { AppInfo, DatabaseStatus, SystemHealth } from '../../shared/types';
import { APP_NAME, APP_VERSION } from '../../shared/constants';

export class AppService {
  private static instance: AppService | null = null;
  private config: AppConfig;
  private dbManager: DatabaseManager;
  private indexingService: IndexingService;
  private searchService: SearchService;

  private constructor() {
    this.config = getAppConfig();
    this.dbManager = DatabaseManager.getInstance();
    this.indexingService = IndexingService.getInstance();
    this.searchService = SearchService.getInstance();
  }

  public static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService();
    }
    return AppService.instance;
  }

  /**
   * Initializes backend dependencies (SQLite, Engine facades)
   */
  public async initialize(): Promise<void> {
    console.log('[QuickFind:AppService] Initializing application services...');
    // Initialize SQLite in Electron's userData directory
    this.dbManager.initialize(this.config.databasePath);
  }

  /**
   * Retrieves overall application information
   */
  public getAppInfo(): AppInfo {
    return {
      name: APP_NAME,
      version: APP_VERSION,
      isPackaged: this.config.isPackaged,
      environment: this.config.isDev ? 'development' : 'production',
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      userDataPath: this.config.userDataPath,
    };
  }

  /**
   * Evaluates and aggregates system health across core components
   */
  public getHealth(): SystemHealth {
    const dbStatus = this.dbManager.getStatus();
    const isDbHealthy = dbStatus.connected && dbStatus.fts5Available;

    return {
      state: isDbHealthy ? 'healthy' : 'degraded',
      database: dbStatus,
      components: [
        {
          name: 'Database Engine (SQLite + FTS5)',
          state: isDbHealthy ? 'healthy' : 'error',
          details: isDbHealthy
            ? `WAL mode active, FTS5 available (${dbStatus.filePath})`
            : dbStatus.error || 'Database connection problem',
        },
        {
          name: 'Indexing Engine Facade',
          state: 'healthy',
          details: 'Ready for Milestone 2',
        },
        {
          name: 'Search Engine Facade',
          state: 'healthy',
          details: 'Ready for Milestone 2',
        },
      ],
      timestamp: Date.now(),
    };
  }

  /**
   * Returns current database connection and pragma status
   */
  public getDatabaseStatus(): DatabaseStatus {
    return this.dbManager.getStatus();
  }

  /**
   * Graceful application shutdown
   */
  public async shutdown(): Promise<void> {
    console.log('[QuickFind:AppService] Shutting down application services...');
    await this.indexingService.dispose();
    await this.searchService.dispose();
    this.dbManager.close();
  }
}
