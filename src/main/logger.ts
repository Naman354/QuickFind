import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

class Logger {
  private static instance: Logger | null = null;
  private logFilePath: string = '';
  private logDirPath: string = '';
  private initialized = false;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Initializes the logger with the application userData path
   */
  public initialize(customUserDataPath?: string): void {
    if (this.initialized) return;

    try {
      let userData = customUserDataPath;
      if (!userData) {
        try {
          userData = app.getPath('userData');
        } catch {
          const appData =
            process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
          userData = path.join(appData, 'QuickFind');
        }
      }

      this.logDirPath = path.join(userData, 'logs');
      this.logFilePath = path.join(this.logDirPath, 'quickfind.log');

      if (!fs.existsSync(this.logDirPath)) {
        fs.mkdirSync(this.logDirPath, { recursive: true });
      }

      this.initialized = true;
      this.info('Logger', `Application logger initialized. Log file: ${this.logFilePath}`);
    } catch (err) {
      console.error('[QuickFind:Logger] Failed to initialize log directory:', err);
    }
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  private writeToFile(level: LogLevel, category: string, message: string, details?: unknown): void {
    if (!this.initialized || !this.logFilePath) return;

    const timestamp = new Date().toISOString();
    let detailStr = '';
    if (details !== undefined) {
      if (details instanceof Error) {
        detailStr = ` | ${details.stack || details.message}`;
      } else if (typeof details === 'object') {
        try {
          detailStr = ` | ${JSON.stringify(details)}`;
        } catch {
          detailStr = ` | [Object]`;
        }
      } else {
        detailStr = ` | ${String(details)}`;
      }
    }

    const logLine = `[${timestamp}] [${level}] [${category}] ${message}${detailStr}\n`;

    try {
      // Rotate if log exceeds max size
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const oldLogPath = path.join(this.logDirPath, 'quickfind.old.log');
          if (fs.existsSync(oldLogPath)) {
            fs.unlinkSync(oldLogPath);
          }
          fs.renameSync(this.logFilePath, oldLogPath);
        }
      }

      fs.appendFileSync(this.logFilePath, logLine, 'utf8');
    } catch (err) {
      // Non-blocking console warning
      console.warn('[QuickFind:Logger] Failed to write to log file:', err);
    }
  }

  public info(category: string, message: string, details?: unknown): void {
    console.log(`[QuickFind:${category}] ${message}`);
    this.writeToFile('INFO', category, message, details);
  }

  public warn(category: string, message: string, details?: unknown): void {
    console.warn(`[QuickFind:${category}] ${message}`, details || '');
    this.writeToFile('WARN', category, message, details);
  }

  public error(category: string, message: string, details?: unknown): void {
    console.error(`[QuickFind:${category}] ${message}`, details || '');
    this.writeToFile('ERROR', category, message, details);
  }

  public debug(category: string, message: string, details?: unknown): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[QuickFind:${category}] [DEBUG] ${message}`);
    }
    this.writeToFile('DEBUG', category, message, details);
  }
}

export const logger = Logger.getInstance();
