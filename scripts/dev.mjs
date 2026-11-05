import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function waitForServer(url, timeoutMs = 20000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, res => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });

      function retry() {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(check, 250);
        }
      }
    };
    check();
  });
}

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`> ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Failed with exit code ${code}`));
    });
  });
}

async function dev() {
  console.log('=== Starting QuickFind Development Environment ===\n');

  try {
    // 1. Initial build of preload and main
    console.log('Step 1: Compiling Main & Preload scripts...');
    await runStep('npx', ['vite', 'build', '--config', 'vite.config.preload.mts']);
    await runStep('npx', ['tsc', '-p', 'tsconfig.node.json']);

    // 2. Start Vite dev server for React
    console.log('\nStep 2: Starting Vite dev server...');
    const viteProc = spawn('npx', ['vite'], {
      cwd: rootDir,
      stdio: 'pipe',
      shell: true,
    });

    viteProc.stdout.on('data', data => {
      const msg = data.toString();
      if (msg.includes('Local:')) {
        console.log(`[Vite] Dev server ready at http://localhost:5173`);
      }
    });

    viteProc.stderr.on('data', data => {
      console.error(`[Vite:Err] ${data.toString()}`);
    });

    // Wait until Vite is responding
    await waitForServer('http://localhost:5173');
    console.log('✅ Vite server responding at http://localhost:5173');

    // 3. Start TypeScript compiler in watch mode for main
    console.log('\nStep 3: Watching main process TypeScript changes...');
    const tscWatch = spawn('npx', ['tsc', '-p', 'tsconfig.node.json', '--watch', '--preserveWatchOutput'], {
      cwd: rootDir,
      stdio: 'ignore',
      shell: true,
    });

    // 4. Launch Electron
    console.log('\nStep 4: Launching Electron desktop window...\n');

    // Ensure ELECTRON_RUN_AS_NODE is removed so Electron runs as GUI app
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electronEnv.NODE_ENV = 'development';

    const electronPath = (await import('electron')).default;
    const electronProc = spawn(electronPath, ['.'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: electronEnv,
      shell: false,
    });

    // Cleanup when Electron exits
    electronProc.on('close', code => {
      console.log(`\n[QuickFind] Electron closed (code ${code}). Shutting down dev services...`);
      tscWatch.kill();
      viteProc.kill();
      process.exit(code || 0);
    });

    process.on('SIGINT', () => {
      tscWatch.kill();
      viteProc.kill();
      electronProc.kill();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start dev environment:', error);
    process.exit(1);
  }
}

dev();

