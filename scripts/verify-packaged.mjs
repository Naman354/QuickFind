import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const exe = path.join(process.cwd(), 'release', 'win-unpacked', 'QuickFind.exe');
console.log('Testing packaged application execution:');
console.log('Binary path:', exe);

const child = spawn(exe, [], {
  env: {
    ...process.env,
    QUICKFIND_SMOKE_TEST: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', d => process.stdout.write('[OUT] ' + d.toString()));
child.stderr.on('data', d => process.stderr.write('[ERR] ' + d.toString()));

child.on('exit', code => {
  console.log(`\nPackaged process exited with code: ${code}`);

  // Check log file in APPDATA
  const appData = process.env.APPDATA || '';
  const logFile1 = path.join(appData, 'QuickFind', 'logs', 'quickfind.log');
  const logFile2 = path.join(appData, 'quickfind', 'logs', 'quickfind.log');

  const logFile = fs.existsSync(logFile1) ? logFile1 : fs.existsSync(logFile2) ? logFile2 : null;

  if (logFile) {
    console.log(`\n✅ Persistent log file found at: ${logFile}`);
    console.log('--- Log Content ---');
    console.log(fs.readFileSync(logFile, 'utf8'));
    console.log('-------------------');
  } else {
    console.log('Log file not found at either candidate path.');
  }

  process.exit(code === 0 ? 0 : 1);
});

