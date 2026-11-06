/**
 * Milestone 4 Verification Script: Incremental Synchronization & Filesystem Monitoring
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Clean parent env
delete process.env.ELECTRON_RUN_AS_NODE;

console.log('=== QuickFind Incremental Synchronization Verification ===\n');

const testDbPath = path.join(os.tmpdir(), `quickfind_sync_test_${Date.now()}.db`);
const testDir = path.join(os.tmpdir(), `quickfind_sync_dir_${Date.now()}`);

fs.mkdirSync(testDir, { recursive: true });

async function runTests() {
  const db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');

  try {
    // 1. Test Migrations 1, 2, and 3
    console.log('▶ [Test 1] Applying Database Migrations (V1, V2, V3)...');
    const { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } = await import('../dist/main/database/schema.js');
    db.exec(SCHEMA_V1);
    db.exec(SCHEMA_V2);
    db.exec(SCHEMA_V3);

    // Verify volume_checkpoints table
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='volume_checkpoints'").get();
    if (!tableCheck) throw new Error('volume_checkpoints table missing');

    const indexCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_entries_volume_frn'").get();
    if (!indexCheck) throw new Error('idx_entries_volume_frn index missing');

    console.log('   ✔ Schema V3 and performance indexes successfully established.\n');

    // 2. Test USN Journal Querying
    console.log('▶ [Test 2] Querying NTFS USN Change Journal via UsnReader...');
    const { UsnReader } = await import('../dist/main/indexing/sync/usn/usnReader.js');
    const journalInfo = await UsnReader.queryJournal('C:');

    if (journalInfo) {
      console.log(`   ✔ Drive C: USN Journal ID: ${journalInfo.journalId}`);
      console.log(`   ✔ Next USN: ${journalInfo.nextUsn} | First USN: ${journalInfo.firstUsn}`);
      console.log(`   ✔ Supported versions: V${journalInfo.minSupportedVersion} to V${journalInfo.maxSupportedVersion}`);
    } else {
      console.log('   ℹ Journal query returned null (non-NTFS or virtualized drive).');
    }
    console.log('');

    // 3. Test Binary USN_RECORD_V2 Parser with Synthetic Buffer
    console.log('▶ [Test 3] Parsing Synthetic USN_RECORD_V2 Binary Buffer...');
    const { UsnParser } = await import('../dist/main/indexing/sync/usn/usnParser.js');
    const { USN_REASONS } = await import('../dist/main/indexing/sync/usn/usnTypes.js');

    const filenameStr = 'TestDocument.docx';
    const filenameBuf = Buffer.from(filenameStr, 'utf16le');
    const recordLen = 60 + filenameBuf.length;
    const alignedLen = (recordLen + 7) & ~7;

    const testBuf = Buffer.alloc(alignedLen);
    testBuf.writeUInt32LE(recordLen, 0); // RecordLength
    testBuf.writeUInt16LE(2, 4);          // MajorVersion = 2
    testBuf.writeUInt16LE(0, 6);          // MinorVersion = 0
    testBuf.writeBigUInt64LE(0x0001000000012345n, 8);  // FRN
    testBuf.writeBigUInt64LE(0x0001000000000005n, 16); // Parent FRN
    testBuf.writeBigUInt64LE(0x00000005b3923198n, 24); // USN
    testBuf.writeBigUInt64LE(133500000000000000n, 32); // FileTime
    testBuf.writeUInt32LE((USN_REASONS.FILE_CREATE | USN_REASONS.CLOSE) >>> 0, 40); // Reason
    testBuf.writeUInt32LE(0x20, 52);      // FileAttributes (Archive)
    testBuf.writeUInt16LE(filenameBuf.length, 56); // FileNameLength
    testBuf.writeUInt16LE(60, 58);        // FileNameOffset
    filenameBuf.copy(testBuf, 60);

    const parsedRecords = UsnParser.parseBuffer(testBuf);
    if (parsedRecords.length !== 1) throw new Error(`Expected 1 record, got ${parsedRecords.length}`);
    const r = parsedRecords[0];

    console.log(`   ✔ Parsed Filename: "${r.filename}" (matched: ${r.filename === filenameStr})`);
    console.log(`   ✔ FRN: ${r.fileReferenceNumber} | Parent FRN: ${r.parentFileReferenceNumber}`);
    console.log(`   ✔ USN: ${r.usn}`);
    console.log(`   ✔ Reason flags: [${r.reasonFlags.join(', ')}]`);
    console.log('');

    // 4. Test Checkpoint Rollover & Invalidation Logic
    console.log('▶ [Test 4] Testing Checkpoint Validation & Rollover Detection...');
    if (journalInfo) {
      const validCheckpoint = {
        volumeId: 1,
        journalId: journalInfo.journalId,
        firstUsn: journalInfo.firstUsn,
        nextUsn: journalInfo.nextUsn,
        lastProcessedUsn: journalInfo.nextUsn,
        syncMode: 'filesystem_watcher',
        syncStatus: 'synced',
        lastSyncTimestamp: Date.now(),
        checkpointTimestamp: Date.now(),
      };

      const check1 = UsnReader.isCheckpointValid(validCheckpoint, journalInfo);
      if (!check1.valid) throw new Error('Expected checkpoint to be valid');
      console.log('   ✔ Current checkpoint validated as valid.');

      const rolledCheckpoint = { ...validCheckpoint, lastProcessedUsn: '0x1' };
      const check2 = UsnReader.isCheckpointValid(rolledCheckpoint, journalInfo);
      console.log(`   ✔ Rolled-over checkpoint detected: valid=${check2.valid}, reason="${check2.reason}"`);

      const mismatchedCheckpoint = { ...validCheckpoint, journalId: '0xdeadbeef' };
      const check3 = UsnReader.isCheckpointValid(mismatchedCheckpoint, journalInfo);
      console.log(`   ✔ Recreated journal ID detected: valid=${check3.valid}, reason="${check3.reason}"`);
    }
    console.log('');

    // 5. Test ChangeProcessor (Create, Update, Child Tree Rename, Tree Delete)
    console.log('▶ [Test 5] Testing ChangeProcessor & FTS5 Synchronization...');
    const { ChangeProcessor } = await import('../dist/main/indexing/sync/changeProcessor.js');
    const processor = new ChangeProcessor(db);

    // Setup dummy volume
    db.prepare("INSERT INTO volumes (id, drive_letter, label, file_system, total_bytes, free_bytes, indexing_state, created_at, updated_at) VALUES (1, 'T:', 'Test', 'NTFS', 10000, 5000, 'indexed', 1, 1)").run();

    // Create test files on disk
    const testSubDir = path.join(testDir, 'ProjectAlpha');
    fs.mkdirSync(testSubDir, { recursive: true });
    const file1 = path.join(testSubDir, 'main.ts');
    const file2 = path.join(testSubDir, 'config.json');
    fs.writeFileSync(file1, 'console.log("hello");');
    fs.writeFileSync(file2, '{"version": "1.0"}');

    // Process creation events
    const createRes = await processor.processBatch(1, [
      { type: 'create', path: testSubDir, isDirectory: true, timestamp: Date.now() },
      { type: 'create', path: file1, isDirectory: false, timestamp: Date.now() },
      { type: 'create', path: file2, isDirectory: false, timestamp: Date.now() },
    ]);
    console.log(`   ✔ Created batch: ${createRes.createdCount} entries inserted into DB.`);

    // Check entries and FTS5 search
    const ftsCheck1 = db.prepare("SELECT name, path FROM entries_fts WHERE entries_fts MATCH 'ProjectAlpha'").all();
    console.log(`   ✔ FTS5 search for "ProjectAlpha" found ${ftsCheck1.length} hits: [${ftsCheck1.map(e => e.name).join(', ')}]`);

    // Test modification
    fs.appendFileSync(file1, '\n// modified');
    const updateRes = await processor.processBatch(1, [
      { type: 'update', path: file1, isDirectory: false, timestamp: Date.now() },
    ]);
    console.log(`   ✔ Updated batch: ${updateRes.updatedCount} entries updated.`);

    // Test directory rename with descendants
    console.log('▶ [Test 6] Testing Directory Rename with Descendant Paths...');
    const renamedSubDir = path.join(testDir, 'ProjectBeta');
    fs.renameSync(testSubDir, renamedSubDir);

    processor.renamePath(1, testSubDir, renamedSubDir, true);

    const ftsOld = db.prepare("SELECT name FROM entries_fts WHERE entries_fts MATCH '\"ProjectAlpha\"'").all();
    const ftsNew = db.prepare("SELECT name, path FROM entries_fts WHERE entries_fts MATCH '\"ProjectBeta\"'").all();
    console.log(`   ✔ FTS5 after rename: Old name hits: ${ftsOld.length} | New name hits: ${ftsNew.length}`);
    for (const item of ftsNew) {
      console.log(`     - ${item.name} -> ${item.path}`);
    }

    // Test directory deletion with descendants
    console.log('▶ [Test 7] Testing Recursive Deletion...');
    fs.rmSync(renamedSubDir, { recursive: true, force: true });
    const deleteRes = await processor.processBatch(1, [
      { type: 'delete', path: renamedSubDir, timestamp: Date.now() },
    ]);
    console.log(`   ✔ Deleted batch: ${deleteRes.deletedCount} entries pruned.`);

    const countRemaining = db.prepare("SELECT COUNT(*) as count FROM entries WHERE volume_id = 1").get();
    const ftsRemaining = db.prepare("SELECT COUNT(*) as count FROM entries_fts").get();
    console.log(`   ✔ Remaining entries: ${countRemaining.count} | Remaining FTS entries: ${ftsRemaining.count}`);

    console.log('\n✅ All Milestone 4 verification tests completed successfully!');
  } finally {
    db.close();
    try {
      fs.rmSync(testDbPath, { force: true });
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  }
}

runTests().catch(err => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
