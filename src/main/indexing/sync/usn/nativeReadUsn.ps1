param (
    [string]$Drive = "C:",
    [string]$StartUsn = "0x0",
    [string]$JournalId = "0",
    [int]$MinVersion = 2,
    [int]$MaxVersion = 3,
    [int]$BufferSize = 65536
)

$ErrorActionPreference = "Stop"

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public class NativeUsnDriver {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern SafeFileHandle CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool DeviceIoControl(
        SafeFileHandle hDevice,
        uint dwIoControlCode,
        IntPtr lpInBuffer,
        uint nInBufferSize,
        IntPtr lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    public const uint GENERIC_READ = 0x80000000;
    public const uint FILE_SHARE_READ = 0x00000001;
    public const uint FILE_SHARE_WRITE = 0x00000002;
    public const uint OPEN_EXISTING = 3;
    public const uint FSCTL_READ_USN_JOURNAL = 0x000900bb;

    [StructLayout(LayoutKind.Sequential)]
    public struct READ_USN_JOURNAL_DATA_V1 {
        public long StartUsn;
        public uint ReasonMask;
        public uint ReturnOnlyOnClose;
        public ulong Timeout;
        public ulong BytesToWaitFor;
        public ulong UsnJournalID;
        public ushort MinMajorVersion;
        public ushort MaxMajorVersion;
    }

    public static string ReadBatch(string driveLetter, long startUsn, ulong journalId, ushort minVer, ushort maxVer, int bufferSize) {
        string volumePath = @"\\.\" + driveLetter.TrimEnd('\\');
        var h = CreateFile(volumePath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (h.IsInvalid) {
            int err = Marshal.GetLastWin32Error();
            return "ERROR:" + err;
        }

        try {
            READ_USN_JOURNAL_DATA_V1 readData = new READ_USN_JOURNAL_DATA_V1();
            readData.StartUsn = startUsn;
            readData.ReasonMask = 0xFFFFFFFF; // All reasons
            readData.ReturnOnlyOnClose = 0;
            readData.Timeout = 0;
            readData.BytesToWaitFor = 0;
            readData.UsnJournalID = journalId;
            readData.MinMajorVersion = minVer;
            readData.MaxMajorVersion = maxVer;

            int inSize = Marshal.SizeOf(typeof(READ_USN_JOURNAL_DATA_V1));
            IntPtr inBuf = Marshal.AllocHGlobal(inSize);
            Marshal.StructureToPtr(readData, inBuf, false);

            IntPtr outBuf = Marshal.AllocHGlobal(bufferSize);
            uint bytesReturned = 0;

            bool ok = DeviceIoControl(h, FSCTL_READ_USN_JOURNAL, inBuf, (uint)inSize, outBuf, (uint)bufferSize, out bytesReturned, IntPtr.Zero);
            if (!ok) {
                int err = Marshal.GetLastWin32Error();
                Marshal.FreeHGlobal(inBuf);
                Marshal.FreeHGlobal(outBuf);
                return "IOCTL_ERROR:" + err;
            }

            if (bytesReturned < 8) {
                Marshal.FreeHGlobal(inBuf);
                Marshal.FreeHGlobal(outBuf);
                return "OK:0x0:";
            }

            long nextUsn = Marshal.ReadInt64(outBuf);
            byte[] managed = new byte[bytesReturned];
            Marshal.Copy(outBuf, managed, 0, (int)bytesReturned);

            Marshal.FreeHGlobal(inBuf);
            Marshal.FreeHGlobal(outBuf);

            return "OK:0x" + nextUsn.ToString("x") + ":" + Convert.ToBase64String(managed);
        } finally {
            h.Close();
        }
    }
}
"@

try {
    if (-not ([System.Management.Automation.PSTypeName]'NativeUsnDriver').Type) {
        Add-Type -TypeDefinition $code
    }

    $cleanUsn = $StartUsn.Replace("0x", "").Trim()
    if ([string]::IsNullOrEmpty($cleanUsn)) { $cleanUsn = "0" }
    $cleanId = $JournalId.Replace("0x", "").Trim()
    if ([string]::IsNullOrEmpty($cleanId)) { $cleanId = "0" }

    $parsedStartUsn = [System.Convert]::ToInt64($cleanUsn, 16)
    $parsedJournalId = [System.Convert]::ToUInt64($cleanId, 16)

    $result = [NativeUsnDriver]::ReadBatch($Drive, $parsedStartUsn, $parsedJournalId, [uint16]$MinVersion, [uint16]$MaxVersion, $BufferSize)
    Write-Output $result
} catch {
    Write-Output ("EXCEPTION:" + $_.Exception.Message)
}
