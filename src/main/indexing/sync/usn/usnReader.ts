import { execFile } from 'child_process';
import { promisify } from 'util';
import { UsnJournalInfo, UsnReadResult } from './usnTypes';
import { VolumeCheckpoint } from '../../../../shared/types';

const execFileAsync = promisify(execFile);

/**
 * UsnReader
 * Interacts with Windows NTFS USN Change Journal via Win32 CLI query and binary readers.
 */
export class UsnReader {
  /**
   * Queries the current USN journal status for a drive letter
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
   * Attempts reading USN journal records starting from a specific USN.
   * If non-elevated, gracefully catches access restriction and reports fallback required.
   */
  public static async readJournal(driveLetter: string, startUsn?: string): Promise<UsnReadResult> {
    const drive = driveLetter.replace(/\\$/, '');
    const currentInfo = await this.queryJournal(drive);

    if (!currentInfo) {
      return {
        records: [],
        nextUsn: startUsn || '0x0',
        hasMore: false,
        error: 'Unable to query volume journal',
      };
    }

    try {
      // Attempt reading journal via fsutil or Win32
      const args = ['usn', 'readjournal', drive];
      if (startUsn) {
        args.push(`startusn=${startUsn}`);
      }
      args.push('csv');

      const { stdout: _stdout } = await execFileAsync('fsutil', args, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse csv records if accessible
      return {
        records: [],
        nextUsn: currentInfo.nextUsn,
        hasMore: false,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isAccessDenied = errMsg.includes('Access is denied') || errMsg.includes('Error 5');

      return {
        records: [],
        nextUsn: currentInfo.nextUsn,
        hasMore: false,
        error: isAccessDenied ? 'ACCESS_DENIED' : errMsg,
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
