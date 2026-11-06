import { USN_REASONS, UsnRecord } from './usnTypes';

const UNIX_EPOCH_FILETIME = 116444736000000000n;

/**
 * UsnParser
 * Binary parser for NTFS USN Change Journal records (USN_RECORD_V2 and USN_RECORD_V3)
 */
export class UsnParser {
  /**
   * Parses raw buffer of USN records into structured UsnRecord array
   */
  public static parseBuffer(buffer: Buffer): UsnRecord[] {
    const records: UsnRecord[] = [];
    let offset = 0;

    // Buffer might start with NextUsn (8 bytes) if output from USN read structure
    if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0 && buffer.length > 8) {
      offset = 8;
    }

    while (offset + 8 <= buffer.length) {
      const recordLength = buffer.readUInt32LE(offset);

      // A recordLength of 0 indicates the end of the records in the buffer
      if (recordLength === 0 || offset + recordLength > buffer.length) {
        break;
      }

      const majorVersion = buffer.readUInt16LE(offset + 4);
      const _minorVersion = buffer.readUInt16LE(offset + 6);

      if (majorVersion === 2) {
        const record = this.parseRecordV2(buffer, offset, recordLength);
        if (record) records.push(record);
      } else if (majorVersion === 3) {
        const record = this.parseRecordV3(buffer, offset, recordLength);
        if (record) records.push(record);
      }

      // Advance by recordLength aligned to 8-byte boundary
      const alignedLength = (recordLength + 7) & ~7;
      offset += alignedLength;
    }

    return records;
  }

  /**
   * Parses USN_RECORD_V2 (64-bit File Reference Numbers)
   */
  private static parseRecordV2(
    buffer: Buffer,
    offset: number,
    recordLength: number
  ): UsnRecord | null {
    if (recordLength < 60) return null;

    const majorVersion = buffer.readUInt16LE(offset + 4);
    const minorVersion = buffer.readUInt16LE(offset + 6);
    const frn = buffer.readBigUInt64LE(offset + 8);
    const parentFrn = buffer.readBigUInt64LE(offset + 16);
    const usn = buffer.readBigUInt64LE(offset + 24);
    const fileTime = buffer.readBigUInt64LE(offset + 32);
    const reason = buffer.readUInt32LE(offset + 40);
    const fileAttributes = buffer.readUInt32LE(offset + 52);
    const fileNameLength = buffer.readUInt16LE(offset + 56);
    const fileNameOffset = buffer.readUInt16LE(offset + 58);

    const nameStart = offset + fileNameOffset;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > offset + recordLength || nameEnd > buffer.length) {
      return null;
    }

    const filename = buffer.toString('utf16le', nameStart, nameEnd);
    const timestamp =
      fileTime > UNIX_EPOCH_FILETIME ? Number((fileTime - UNIX_EPOCH_FILETIME) / 10000n) : 0;

    return {
      recordLength,
      majorVersion,
      minorVersion,
      fileReferenceNumber: '0x' + frn.toString(16).padStart(16, '0'),
      parentFileReferenceNumber: '0x' + parentFrn.toString(16).padStart(16, '0'),
      usn: '0x' + usn.toString(16).padStart(16, '0'),
      timestamp,
      reason,
      reasonFlags: this.parseReasonFlags(reason),
      fileAttributes,
      filename,
    };
  }

  /**
   * Parses USN_RECORD_V3 (128-bit File Reference Numbers, e.g. ReFS or newer NTFS)
   */
  private static parseRecordV3(
    buffer: Buffer,
    offset: number,
    recordLength: number
  ): UsnRecord | null {
    if (recordLength < 76) return null;

    const majorVersion = buffer.readUInt16LE(offset + 4);
    const minorVersion = buffer.readUInt16LE(offset + 6);

    // 128-bit FRN: read as two 64-bit BigInts
    const frnLow = buffer.readBigUInt64LE(offset + 8);
    const frnHigh = buffer.readBigUInt64LE(offset + 16);
    const parentFrnLow = buffer.readBigUInt64LE(offset + 24);
    const parentFrnHigh = buffer.readBigUInt64LE(offset + 32);

    const usn = buffer.readBigUInt64LE(offset + 40);
    const fileTime = buffer.readBigUInt64LE(offset + 48);
    const reason = buffer.readUInt32LE(offset + 56);
    const fileAttributes = buffer.readUInt32LE(offset + 68);
    const fileNameLength = buffer.readUInt16LE(offset + 72);
    const fileNameOffset = buffer.readUInt16LE(offset + 74);

    const nameStart = offset + fileNameOffset;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > offset + recordLength || nameEnd > buffer.length) {
      return null;
    }

    const filename = buffer.toString('utf16le', nameStart, nameEnd);
    const timestamp =
      fileTime > UNIX_EPOCH_FILETIME ? Number((fileTime - UNIX_EPOCH_FILETIME) / 10000n) : 0;

    const frnStr =
      '0x' + frnHigh.toString(16).padStart(16, '0') + frnLow.toString(16).padStart(16, '0');
    const parentFrnStr =
      '0x' +
      parentFrnHigh.toString(16).padStart(16, '0') +
      parentFrnLow.toString(16).padStart(16, '0');

    return {
      recordLength,
      majorVersion,
      minorVersion,
      fileReferenceNumber: frnStr,
      parentFileReferenceNumber: parentFrnStr,
      usn: '0x' + usn.toString(16).padStart(16, '0'),
      timestamp,
      reason,
      reasonFlags: this.parseReasonFlags(reason),
      fileAttributes,
      filename,
    };
  }

  /**
   * Deconstructs bitwise reason flags into human-readable identifier strings
   */
  public static parseReasonFlags(reason: number): string[] {
    const flags: string[] = [];

    if (reason & USN_REASONS.FILE_CREATE) flags.push('FILE_CREATE');
    if (reason & USN_REASONS.FILE_DELETE) flags.push('FILE_DELETE');
    if (reason & USN_REASONS.RENAME_OLD_NAME) flags.push('RENAME_OLD_NAME');
    if (reason & USN_REASONS.RENAME_NEW_NAME) flags.push('RENAME_NEW_NAME');
    if (
      reason &
      (USN_REASONS.DATA_OVERWRITE | USN_REASONS.DATA_EXTEND | USN_REASONS.DATA_TRUNCATION)
    ) {
      flags.push('DATA_CHANGE');
    }
    if (reason & USN_REASONS.BASIC_INFO_CHANGE) flags.push('BASIC_INFO_CHANGE');
    if (reason & USN_REASONS.HARD_LINK_CHANGE) flags.push('HARD_LINK_CHANGE');
    if (reason & USN_REASONS.SECURITY_CHANGE) flags.push('SECURITY_CHANGE');
    if (reason & USN_REASONS.CLOSE) flags.push('CLOSE');

    return flags;
  }
}
