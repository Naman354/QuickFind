import { spawn } from 'child_process';
import fs from 'fs';
import { DiscoveredVolume } from '../../shared/types';
import { PathUtils } from './pathUtils';

interface Win32DiskJson {
  DeviceID?: string;
  VolumeName?: string;
  FileSystem?: string;
  Size?: number;
  FreeSpace?: number;
  VolumeSerialNumber?: string;
}

export class VolumeDiscovery {
  /**
   * Discovers all accessible fixed local NTFS drives on Windows.
   */
  public static async discoverNtfsVolumes(): Promise<DiscoveredVolume[]> {
    if (process.platform !== 'win32') {
      return this.fallbackDiscovery();
    }

    try {
      const volumes = await this.queryCimLogicalDisks();
      if (volumes.length > 0) {
        return volumes;
      }
    } catch (err) {
      console.warn(
        '[QuickFind:VolumeDiscovery] CIM query failed, falling back to drive probe:',
        err
      );
    }

    return this.fallbackDiscovery();
  }

  /**
   * Queries Windows CIM/WMI for local fixed NTFS volumes
   */
  private static queryCimLogicalDisks(): Promise<DiscoveredVolume[]> {
    return new Promise((resolve, reject) => {
      const psCommand =
        'Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -eq 3 | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace, VolumeSerialNumber | ConvertTo-Json';

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psCommand],
        {
          windowsHide: true,
        }
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
        }

        try {
          const trimmed = stdout.trim();
          if (!trimmed) {
            return resolve([]);
          }

          const parsed = JSON.parse(trimmed);
          const rawList: Win32DiskJson[] = Array.isArray(parsed) ? parsed : [parsed];

          const result: DiscoveredVolume[] = [];

          for (const item of rawList) {
            if (!item.DeviceID) continue;

            const driveLetter = PathUtils.normalizePath(item.DeviceID).replace(/\\$/, '');
            const fileSystem = (item.FileSystem || '').toUpperCase();

            // Filter for NTFS filesystem
            if (fileSystem !== 'NTFS') {
              console.log(
                `[QuickFind:VolumeDiscovery] Skipping non-NTFS volume ${driveLetter} (${fileSystem})`
              );
              continue;
            }

            // Verify physical directory access
            const rootPath = driveLetter + '\\';
            if (!fs.existsSync(rootPath)) {
              console.warn(`[QuickFind:VolumeDiscovery] Drive ${driveLetter} is not accessible`);
              continue;
            }

            result.push({
              driveLetter,
              volumeGuid: item.VolumeSerialNumber ? `SN-${item.VolumeSerialNumber}` : null,
              label: item.VolumeName || '',
              fileSystem: 'NTFS',
              totalBytes: Number(item.Size) || 0,
              freeBytes: Number(item.FreeSpace) || 0,
            });
          }

          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Fallback drive discovery for environments where PowerShell query is restricted
   */
  private static fallbackDiscovery(): DiscoveredVolume[] {
    const candidates = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:'];
    const discovered: DiscoveredVolume[] = [];

    for (const drive of candidates) {
      const root = drive + '\\';
      try {
        if (fs.existsSync(root)) {
          discovered.push({
            driveLetter: drive,
            volumeGuid: null,
            label: '',
            fileSystem: 'NTFS',
            totalBytes: 0,
            freeBytes: 0,
          });
        }
      } catch {
        // Skip inaccessible drives
      }
    }

    return discovered;
  }
}
