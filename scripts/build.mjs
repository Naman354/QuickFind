import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

async function build() {
  console.log('=== QuickFind Production Build ===\n');

  try {
    // 1. Build React renderer with Vite
    console.log('Step 1: Building React Renderer...');
    await runCommand('npx', ['vite', 'build']);

    // 2. Compile Main process with TypeScript (including worker threads)
    console.log('\nStep 2: Compiling Electron Main process & Worker scripts...');
    await runCommand('npx', ['tsc', '-p', 'tsconfig.node.json']);

    // 3. Bundle Preload script with Vite (sandboxed, self-contained)
    console.log('\nStep 3: Bundling Preload script...');
    await runCommand('npx', ['vite', 'build', '--config', 'vite.config.preload.mts']);

    // 4. Copy native driver scripts
    const nativeSrc = path.join(rootDir, 'src/main/indexing/sync/usn/nativeReadUsn.ps1');
    const nativeDistDir = path.join(rootDir, 'dist/main/indexing/sync/usn');
    if (fs.existsSync(nativeSrc)) {
      fs.mkdirSync(nativeDistDir, { recursive: true });
      fs.copyFileSync(nativeSrc, path.join(nativeDistDir, 'nativeReadUsn.ps1'));
    }

    // 5. Verify build artifacts
    const mainJs = path.join(rootDir, 'dist/main/index.js');
    const workerJs = path.join(rootDir, 'dist/main/indexing/worker/indexingWorker.js');
    const preloadJs = path.join(rootDir, 'dist/preload/index.js');
    const rendererHtml = path.join(rootDir, 'dist/renderer/index.html');

    if (!fs.existsSync(mainJs)) {
      throw new Error(`Missing main bundle at ${mainJs}`);
    }
    if (!fs.existsSync(workerJs)) {
      throw new Error(`Missing worker script at ${workerJs}`);
    }
    if (!fs.existsSync(preloadJs)) {
      throw new Error(`Missing preload bundle at ${preloadJs}`);
    }
    if (!fs.existsSync(rendererHtml)) {
      throw new Error(`Missing renderer index at ${rendererHtml}`);
    }

    console.log('\n✅ QuickFind build completed successfully!');
    console.log('Artifacts:');
    console.log(` - Main:     dist/main/index.js`);
    console.log(` - Worker:   dist/main/indexing/worker/indexingWorker.js`);
    console.log(` - Preload:  dist/preload/index.js`);
    console.log(` - Renderer: dist/renderer/index.html`);
  } catch (error) {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
  }
}

build();
