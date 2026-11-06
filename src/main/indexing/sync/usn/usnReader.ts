import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { UsnCapability, UsnJournalInfo, UsnReadResult } from './usnTypes';
import { UsnParser } from './usnParser';
import { VolumeCheckpoint } from '../../../../shared/types';

const execFileAsync = promisify(execFile);

/**
 * UsnReader
 * Implements NTFS USN Change Journal querying and native record reading
 * via Win32 CreateFileW, FSCTL_QUERY_USN_JOURNAL, and FSCTL_READ_USN_JOURNAL.
 */
export class UsnReader {
  /**
   * Resolves the filesystem path to the native USN PowerShell driver script
   */
  private static getNativeScriptPath(): string {
    const distPath = path.join(__dirname, 'nativeReadUsn.ps1');
    if (fs.existsSync(distPath)) return distPath;

    const srcPath = path.join(
      process.cwd(),
      'src',
      'main',
      'indexing',
      'sync',
      'usn',
      'nativeReadUsn.ps1'
    );
    if (fs.existsSync(srcPath)) return srcPath;

    return distPath;
  }

  /**
   * Queries the current USN journal status for a drive letter
   * (Works under a standard Windows user account)
   */
  public static async queryJournal(driveLetter: string): Promise<UsnJournalInfo | null> {
    const drive = driveLetter.replace(/\\$/, '');

    try {
      const { stdout } = await execFileAsync('fsutil', ['usn', 'queryjournal', drive], {
        windowsHide: true,
      });

      return this.parseFsutilQueryOutput(stdout);
    } catch (err) {
      console.warn(`[QuickFind:UsnReader] Failed to query USN journal for ${drive}:`, err);
      return null;
    }
  }

  /**
   * Performs an explicit capability check for USN Journal querying and reading
   */
  public static async checkCapability(driveLetter: string): Promise<UsnCapability> {
    const drive = driveLetter.replace(/\\$/, '');
    const journalInfo = await this.queryJournal(drive);

    if (!journalInfo) {
      return {
        canQueryMetadata: false,
        canReadRecords: false,
        requiresElevation: false,
        journalInfo: null,
        error: 'Unable to query NTFS USN Journal on specified drive',
      };
    }

    // Test record reading capability from NextUsn
    const readTest = await this.readJournal(drive, journalInfo.nextUsn, journalInfo.journalId);

    if (readTest.accessDenied) {
      return {
        canQueryMetadata: true,
        canReadRecords: false,
        requiresElevation: true,
        journalInfo,
        error:
          'Access denied: Reading raw USN Journal records requires Windows Administrator elevation',
      };
    }

    return {
      canQueryMetadata: true,
      canReadRecords: !readTest.error,
      requiresElevation: false,
      journalInfo,
      error: readTest.error,
    };
  }

  /**
   * Reads a batch of USN records from the journal starting from startUsn.
   * Uses native Win32 CreateFileW and FSCTL_READ_USN_JOURNAL with READ_USN_JOURNAL_DATA_V1.
   * Constrains reads to supported versions (V2 and V3) and detects privilege boundaries.
   */
  public static async readJournal(
    driveLetter: string,
    startUsn?: string,
    journalId?: string
  ): Promise<UsnReadResult> {
    const drive = driveLetter.replace(/\\$/, '');

    // If journal ID not provided, query current info
    let activeJournalId = journalId;
    let fallbackNextUsn = startUsn || '0x0';

    if (!activeJournalId) {
      const info = await this.queryJournal(drive);
      if (!info) {
        return {
          records: [],
          nextUsn: fallbackNextUsn,
          hasMore: false,
          error: 'Unable to query volume journal metadata',
        };
      }
      activeJournalId = info.journalId;
      fallbackNextUsn = info.nextUsn;
    }

    const scriptPath = this.getNativeScriptPath();
    if (!fs.existsSync(scriptPath)) {
      return {
        records: [],
        nextUsn: fallbackNextUsn,
        hasMore: false,
        error: `Native USN driver script missing at ${scriptPath}`,
      };
    }

    try {
      const args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Drive',
        drive,
        '-StartUsn',
        startUsn || '0x0',
        '-JournalId',
        activeJournalId,
        '-MinVersion',
        '2',
        '-MaxVersion',
        '3',
      ];

      const { stdout } = await execFileAsync('powershell.exe', args, {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });

      const trimmed = stdout.trim();

      // 1. Success response: OK:<nextUsn>:<base64Buffer>
      if (trimmed.startsWith('OK:')) {
        const parts = trimmed.split(':');
        const nextUsn = parts[1] || fallbackNextUsn;
        const b64Data = parts[2] || '';

        if (!b64Data) {
          return {
            records: [],
            nextUsn,
            hasMore: false,
          };
        }

        const buffer = Buffer.from(b64Data, 'base64');
        const records = UsnParser.parseBuffer(buffer, true);
        const hasMore =
          records.length > 0 && nextUsn.toLowerCase() !== (startUsn || '0x0').toLowerCase();

        return {
          records,
          nextUsn,
          hasMore,
          bytesRead: buffer.length,
        };
      }

      // 2. Access Denied (Error 5): normal standard user mode
      if (trimmed.includes('ERROR:5') || trimmed.includes('IOCTL_ERROR:5')) {
        return {
          records: [],
          nextUsn: fallbackNextUsn,
          hasMore: false,
          accessDenied: true,
          error:
            'ACCESS_DENIED: Direct USN Journal reading requires Windows Administrator elevation',
        };
      }

      // 3. Journal Entry Deleted (Error 1179): rollover occurred
      if (trimmed.includes('1179')) {
        return {
          records: [],
          nextUsn: fallbackNextUsn,
          hasMore: false,
          error: 'JOURNAL_ENTRY_DELETED: Journal entries prior to startUsn have rolled over',
        };
      }

      return {
        records: [],
        nextUsn: fallbackNextUsn,
        hasMore: false,
        error: trimmed,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAccessDenied = errMsg.includes('Access is denied') || errMsg.includes('Error 5');

      return {
        records: [],
        nextUsn: fallbackNextUsn,
        hasMore: false,
        accessDenied: isAccessDenied,
        error: isAccessDenied
          ? 'ACCESS_DENIED: Direct USN Journal reading requires Windows Administrator elevation'
          : errMsg,
      };
    }
  }

  /**
   * Validates whether a persisted checkpoint is still usable with the volume's current USN journal
   */
  public static isCheckpointValid(
    checkpoint: VolumeCheckpoint,
    currentInfo: UsnJournalInfo
  ): { valid: boolean; reason?: 'id_mismatch' | 'rollover' | 'future_usn' | 'missing' } {
    if (!checkpoint.journalId || !checkpoint.lastProcessedUsn) {
      return { valid: false, reason: 'missing' };
    }

    // 1. Check if journal ID was recreated (e.g. disk reformat, journal recreation)
    if (checkpoint.journalId.toLowerCase() !== currentInfo.journalId.toLowerCase()) {
      return { valid: false, reason: 'id_mismatch' };
    }

    try {
      const savedUsn = BigInt(checkpoint.lastProcessedUsn);
      const firstUsn = BigInt(currentInfo.firstUsn);
      const nextUsn = BigInt(currentInfo.nextUsn);

      // 2. Check if journal rolled over (saved USN pruned from journal history)
      if (firstUsn > 0n && savedUsn < firstUsn) {
        return { valid: false, reason: 'rollover' };
      }

      // 3. Check if checkpoint is ahead of next USN (corrupt checkpoint)
      if (savedUsn > nextUsn) {
        return { valid: false, reason: 'future_usn' };
      }

      return { valid: true };
    } catch {
      return { valid: false, reason: 'missing' };
    }
  }

  /**
   * Parses fsutil queryjournal stdout into UsnJournalInfo
   */
  private static parseFsutilQueryOutput(output: string): UsnJournalInfo | null {
    const lines = output.split(/\r?\n/);
    const map: Record<string, string> = {};

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const value = parts.slice(1).join(':').trim();
        map[key] = value;
      }
    }

    const journalId = map['usn journal id'];
    const nextUsn = map['next usn'];

    if (!journalId || !nextUsn) {
      return null;
    }

    return {
      journalId: journalId.split(' ')[0],
      firstUsn: (map['first usn'] || '0x0').split(' ')[0],
      nextUsn: nextUsn.split(' ')[0],
      lowestValidUsn: (map['lowest valid usn'] || '0x0').split(' ')[0],
      maxUsn: (map['max usn'] || '0x0').split(' ')[0],
      maximumSize: map['maximum size'] || '',
      allocationDelta: map['allocation delta'] || '',
      minSupportedVersion: parseInt(map['minimum record version supported'] || '2', 10),
      maxSupportedVersion: parseInt(map['maximum record version supported'] || '4', 10),
    };
  }
}
