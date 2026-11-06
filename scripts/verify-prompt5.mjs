import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== QuickFind Milestone 5: Floating Search & System Tray Verification ===\n');

let allPassed = true;
function assert(condition, message) {
  if (condition) {
    console.log(`   ✔ ${message}`);
  } else {
    console.error(`   ✖ FAILED: ${message}`);
    allPassed = false;
  }
}

// Test 1: Verify IPC Constants and Contracts
console.log('▶ [Test 1] Verifying IPC Constants & Channel Contracts...');
const constantsFile = fs.readFileSync(path.join(rootDir, 'src/shared/constants.ts'), 'utf8');
assert(constantsFile.includes("OPEN: 'quickfind:file:open'"), 'quickfind:file:open defined');
assert(constantsFile.includes("REVEAL: 'quickfind:file:reveal'"), 'quickfind:file:reveal defined');
assert(constantsFile.includes("COPY_PATH: 'quickfind:file:copyPath'"), 'quickfind:file:copyPath defined');
assert(constantsFile.includes("HIDE: 'quickfind:window:hide'"), 'quickfind:window:hide defined');
assert(constantsFile.includes("SET_HEIGHT: 'quickfind:window:setHeight'"), 'quickfind:window:setHeight defined');
assert(constantsFile.includes("SET_VIEW_MODE: 'quickfind:window:setViewMode'"), 'quickfind:window:setViewMode defined');
assert(constantsFile.includes("FOCUS_INPUT: 'quickfind:window:focusInput'"), 'quickfind:window:focusInput defined');
assert(constantsFile.includes("SWITCH_VIEW: 'quickfind:window:switchView'"), 'quickfind:window:switchView defined');
assert(constantsFile.includes("GLOBAL_SHORTCUT_DEFAULT = 'CommandOrControl+Shift+Space'"), 'Global shortcut CommandOrControl+Shift+Space defined');

// Test 2: Verify Preload API contract
console.log('\n▶ [Test 2] Verifying Preload API Expositions...');
const preloadIndex = fs.readFileSync(path.join(rootDir, 'src/preload/index.ts'), 'utf8');
assert(preloadIndex.includes('file: {'), 'file namespace exposed in preload');
assert(preloadIndex.includes('open: (targetPath: string)'), 'file.open exposed in preload');
assert(preloadIndex.includes('reveal: (targetPath: string)'), 'file.reveal exposed in preload');
assert(preloadIndex.includes('copyPath: (targetPath: string)'), 'file.copyPath exposed in preload');
assert(preloadIndex.includes('hide: () => ipcRenderer.invoke'), 'window.hide exposed in preload');
assert(preloadIndex.includes('setHeight: (height: number)'), 'window.setHeight exposed in preload');
assert(preloadIndex.includes('setViewMode: (mode:'), 'window.setViewMode exposed in preload');
assert(preloadIndex.includes('onFocusInput:'), 'window.onFocusInput listener exposed');
assert(preloadIndex.includes('onSwitchView:'), 'window.onSwitchView listener exposed');

// Test 3: Verify Main Process Window Management
console.log('\n▶ [Test 3] Verifying Floating Window Options & Architecture...');
const windowSrc = fs.readFileSync(path.join(rootDir, 'src/main/window.ts'), 'utf8');
assert(windowSrc.includes('frame: false'), 'Frameless window configured');
assert(windowSrc.includes('transparent: true'), 'Transparent window enabled');
assert(windowSrc.includes('alwaysOnTop: true'), 'Always-on-top enabled');
assert(windowSrc.includes('skipTaskbar: true'), 'Skip taskbar in search mode');
assert(windowSrc.includes('positionFloatingWindow'), 'Floating positioning function implemented');
assert(windowSrc.includes('getDisplayNearestPoint'), 'Active display resolution logic present');
assert(windowSrc.includes('workArea.height * 0.15'), 'Window positioned near upper 15%');
assert(windowSrc.includes('win.on(\'blur\''), 'Blur handler dismisses floating search');
assert(windowSrc.includes('win.on(\'close\''), 'Close handler hides window without destroying instance');
assert(windowSrc.includes('setFloatingWindowHeight'), 'Dynamic window height adjuster implemented');
assert(windowSrc.includes('setWindowViewMode'), 'Search <-> Manage view mode switcher implemented');

// Test 4: Verify System Tray Integration
console.log('\n▶ [Test 4] Verifying Windows System Tray Implementation...');
const traySrc = fs.readFileSync(path.join(rootDir, 'src/main/tray.ts'), 'utf8');
assert(traySrc.includes('new Tray('), 'Tray constructor utilized');
assert(traySrc.includes('TRAY_ICON_DATA_URL'), 'Crisp Tray icon data URL provided');
assert(traySrc.includes("'Open QuickFind'"), 'Tray menu contains "Open QuickFind"');
assert(traySrc.includes("'Manage Indexed Volumes'"), 'Tray menu contains "Manage Indexed Volumes"');
assert(traySrc.includes("'Re-index All Volumes'"), 'Tray menu contains "Re-index All Volumes"');
assert(traySrc.includes("'Quit QuickFind'"), 'Tray menu contains "Quit QuickFind"');
assert(traySrc.includes("trayInstance.on('click'"), 'Tray click toggles search window');
assert(traySrc.includes("trayInstance.on('double-click'"), 'Tray double-click toggles search window');

// Test 5: Verify File Operations Security & Stale Item Guard
console.log('\n▶ [Test 5] Verifying Safe File Operations & IPC Security...');
const handlersSrc = fs.readFileSync(path.join(rootDir, 'src/main/ipc/handlers.ts'), 'utf8');
assert(handlersSrc.includes('fs.existsSync(normalized)'), 'File existence verified before opening/revealing');
assert(handlersSrc.includes('shell.openPath(normalized)'), 'Native shell.openPath invoked securely');
assert(handlersSrc.includes('shell.showItemInFolder(normalized)'), 'Native shell.showItemInFolder invoked securely');
assert(handlersSrc.includes('clipboard.writeText(targetPath)'), 'Native clipboard.writeText invoked securely');
assert(handlersSrc.includes('validateIpcSender(event, getMainWindow(), isDev)'), 'Strict IPC sender frame validation maintained');

// Test 6: Verify Floating Search Component Keyboard-First UX
console.log('\n▶ [Test 6] Verifying Keyboard-First Navigation & UX in Renderer...');
const floatingSearchSrc = fs.readFileSync(path.join(rootDir, 'src/renderer/components/FloatingSearch.tsx'), 'utf8');
assert(floatingSearchSrc.includes("e.key === 'ArrowDown'"), 'ArrowDown navigates results');
assert(floatingSearchSrc.includes("e.key === 'ArrowUp'"), 'ArrowUp navigates results');
assert(floatingSearchSrc.includes("e.key === 'Enter'"), 'Enter triggers item action');
assert(floatingSearchSrc.includes("e.ctrlKey || e.metaKey") && floatingSearchSrc.includes("handleRevealInExplorer"), 'Ctrl+Enter reveals in File Explorer');
assert(floatingSearchSrc.includes("e.shiftKey && (e.key === 'C' || e.key === 'c')"), 'Ctrl+Shift+C copies item path');
assert(floatingSearchSrc.includes("e.key === 'Escape'"), 'Escape clears search or dismisses window');
assert(floatingSearchSrc.includes("handleWindowKeyDown"), 'Typing anywhere focuses search input');
assert(floatingSearchSrc.includes("window.quickFindApi.window.setHeight"), 'Dynamic height sent to main process');
assert(floatingSearchSrc.includes("scrollIntoView"), 'Selected item automatically scrolled into view');

// Test 7: Verify Build Artifacts
console.log('\n▶ [Test 7] Verifying Build Artifacts...');
const distMain = path.join(rootDir, 'dist/main/index.js');
const distPreload = path.join(rootDir, 'dist/preload/index.js');
const distHtml = path.join(rootDir, 'dist/renderer/index.html');
assert(fs.existsSync(distMain), `dist/main/index.js exists (${(fs.statSync(distMain).size / 1024).toFixed(1)} KB)`);
assert(fs.existsSync(distPreload), `dist/preload/index.js exists (${(fs.statSync(distPreload).size / 1024).toFixed(1)} KB)`);
assert(fs.existsSync(distHtml), `dist/renderer/index.html exists (${(fs.statSync(distHtml).size / 1024).toFixed(1)} KB)`);

if (allPassed) {
  console.log('\n🎉 All QuickFind Milestone 5 verification checks passed successfully!\n');
  process.exit(0);
} else {
  console.error('\n❌ Some checks failed.\n');
  process.exit(1);
}
