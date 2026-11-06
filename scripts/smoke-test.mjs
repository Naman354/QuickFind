import { spawn } from 'child_process';
import path from 'path';

// Clean parent env
delete process.env.ELECTRON_RUN_AS_NODE;

const electronBinary = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const mainPath = path.join(process.cwd(), 'dist', 'main', 'index.js');

console.log('Testing Electron runtime startup with Milestone 4 synchronization...');

const child = spawn(electronBinary, [mainPath], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', d => {
  const str = d.toString();
  output += str;
  process.stdout.write(str);
});

child.stderr.on('data', d => {
  const str = d.toString();
  output += str;
  process.stderr.write(str);
});

// Give Electron 5 seconds to boot up and initialize services, then terminate
setTimeout(() => {
  console.log('\nTerminating Electron process cleanly...');
  child.kill();
}, 5000);

child.on('exit', code => {
  console.log(`\nElectron process exited (code: ${code}).`);
  if (output.includes('QuickFind') || output.includes('Database') || output.includes('SyncService') || output.includes('IndexingService')) {
    console.log('✅ Smoke test passed: Electron started and initialized backend services successfully.');
    process.exit(0);
  } else {
    console.error('❌ Smoke test produced unexpected output.');
    process.exit(1);
  }
});

