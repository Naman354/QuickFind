import path from 'path';
import { INDEXING_CONFIG } from '../../shared/constants';

export class PathUtils {
  /**
   * Normalizes a Windows path while strictly preserving the original casing of directories and filenames.
   * Standardizes backslashes and ensures an uppercase drive letter.
   * E.g. "c:/Users/hp/Downloads/" -> "C:\\Users\\hp\\Downloads"
   * Root: "c:\" or "c:" -> "C:\\"
   */
  public static normalizePath(rawPath: string): string {
    if (!rawPath) return '';

    // Replace forward slashes with Windows backslashes
    let normalized = rawPath.replace(/\//g, '\\');

    // Ensure uppercase drive letter (e.g., "c:\" -> "C:\")
    if (/^[a-zA-Z]:/.test(normalized)) {
      normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    // Standardize root (e.g., "C:" -> "C:\")
    if (/^[A-Z]:$/.test(normalized)) {
      return normalized + '\\';
    }

    // Remove trailing backslash if not a drive root (e.g., "C:\Users\" -> "C:\Users")
    if (normalized.length > 3 && normalized.endsWith('\\')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * Computes the parent directory path for a given path.
   * "C:\Windows\System32" -> "C:\Windows"
   * "C:\Windows" -> "C:\"
   * "C:\" -> ""
   */
  public static getParentPath(normalizedPath: string): string {
    // If it's a drive root
    if (/^[A-Z]:\\?$/.test(normalizedPath)) {
      return '';
    }

    const parent = path.win32.dirname(normalizedPath);
    // If parent is "C:", make it "C:\"
    if (/^[A-Z]:$/.test(parent)) {
      return parent + '\\';
    }
    return parent;
  }

  /**
   * Extracts file extension in lowercase including the dot.
   * "Report.PDF" -> ".pdf"
   * Folders or files without extension -> ""
   */
  public static getExtension(name: string, isDirectory: boolean): string {
    if (isDirectory) return '';
    const ext = path.extname(name);
    return ext ? ext.toLowerCase() : '';
  }

  /**
   * Prepares path for Windows filesystem operations (handling long paths > 260 chars).
   */
  public static toFsPath(normalizedPath: string): string {
    // If path is long and not already using extended-length prefix
    if (normalizedPath.length >= 240 && !normalizedPath.startsWith('\\\\?\\')) {
      return '\\\\?\\' + normalizedPath;
    }
    return normalizedPath;
  }

  /**
   * Checks whether a directory or file should be excluded based on conservative system rules.
   */
  public static isExcluded(name: string, isRoot: boolean): boolean {
    const lowerName = name.toLowerCase();

    // Check excluded directories (e.g., $Recycle.Bin, System Volume Information)
    if (INDEXING_CONFIG.EXCLUDED_DIR_NAMES.has(lowerName)) {
      return true;
    }

    // Check excluded root system files (e.g., pagefile.sys)
    if (isRoot && INDEXING_CONFIG.EXCLUDED_ROOT_FILES.has(lowerName)) {
      return true;
    }

    return false;
  }
}
