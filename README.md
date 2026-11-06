# QuickFind

**QuickFind** is a fast, accurate, completely local Windows desktop file-search application. It features a custom filesystem indexing and search engine built entirely from first principles, operating independently of third-party engines like Everything.

---

## Architecture Overview

QuickFind is engineered around three logically independent components with strict isolation boundaries:

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop Interface                        │
│             React 19 + Vite + TypeScript UI                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC (contextBridge, Sandboxed)
┌──────────────────────────────▼──────────────────────────────┐
│                    Electron Main Process                    │
│     Security Guards • IPC Handlers • App Lifecycle          │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼──────────────┐┌──────────────▼───────────────┐
│       Indexing Engine       ││        Search Engine         │
│  Filesystem scanning &      ││  FTS5 Trigram Matching,      │
│  metadata change tracking   ││  B-tree fallback, ranking    │
│  (Worker Thread • Bounded)  ││  (Sub-millisecond queries)   │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               └──────────────┬───────────────┘
                              │
               ┌──────────────▼───────────────┐
               │    SQLite Local Database     │
               │  WAL Mode • FTS5 • 64MB RAM  │
               │  Resides in %APPDATA%        │
               └──────────────────────────────┘
```

### 1. Desktop Interface
- **Framework**: React 19 + Vite.
- **Role**: Search user interface, volume indexing dashboard, and real-time query test panel.
- **Security**: Runs in an isolated renderer sandbox (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- **Communication**: Interacts with backend services exclusively through a typed context bridge (`window.quickFindApi`).

### 2. Indexing Engine
- **Role**: Discovers local fixed NTFS volumes, recursively scans directory structures, collects entry metadata, and persists records in SQLite.
- **Offload & Concurrency**: Runs off the main Electron event loop inside a dedicated background `worker_threads.Worker` with bounded concurrency (8 workers) and batched database writes (2,000 items/batch).
- **Filesystem Traversal**: Ignores symbolic links, directory junctions, and reparse points to avoid recursion loops. Applies conservative system exclusions (`$Recycle.Bin`, `System Volume Information`, etc.) without excluding user directories or project repositories.
- **Stale Record Safety**: Old records are pruned only upon a completely successful full volume scan; failed or interrupted scans preserve previously indexed data intact.

### 3. Search Engine
- **Role**: High-speed, accurate retrieval of files and folders from the SQLite index.
- **FTS5 Trigram Matching**: Utilizes an FTS5 virtual table with the `trigram` tokenizer (`entries_fts`) for partial, substring, and case-insensitive filename/path matching.
- **Short-Query Fallback**: Automatically falls back to B-tree indexed searches (`idx_entries_name_nocase`, `idx_entries_ext_nocase`) for queries with fewer than 3 characters (`c`, `ts`, `.h`).
- **Ranked Prioritization**:
  1. Exact filename matches (`lower(name) = lower(term)`).
  2. Filename prefix matches (`name LIKE term || '%'`).
  3. Filename substring matches (`name LIKE '%' || term || '%'`).
  4. Exact folder name matches (`is_directory = 1 AND lower(name) = lower(term)`).
  5. Folder/path substring matches (`path LIKE '%' || term || '%'`).
- **Performance**: Sub-millisecond to low single-digit millisecond query execution times across tens of thousands of entries.

### 4. Database Foundation
- **Storage Location**: Electron's `app.getPath('userData')` directory (`%APPDATA%/quickfind/quickfind.db` on Windows). Never written into source directories.
- **Driver**: `better-sqlite3` compiled with native SQLite FTS5 support.
- **Performance & Integrity Pragmas**:
  - `journal_mode = WAL`: High concurrency, non-blocking readers/writers across main and worker threads.
  - `synchronous = NORMAL`: Eliminates disk flush bottlenecks safely in WAL mode.
  - `foreign_keys = ON`: Strict referential integrity.
  - `cache_size = -64000`: 64 MB in-memory SQLite cache.
  - `temp_store = MEMORY`: RAM-based temporary tables and sorting.
  - `mmap_size = 268435456`: 256 MB memory-mapped I/O for high-speed reads.
  - `busy_timeout = 10000`: 10-second lock resolution timeout.

---

## Database Schema & Migrations

The database schema is managed via an automated schema-versioning migration runner ([`MigrationManager`](file:///d:/Development/Utility/QuickFind/src/main/database/migrations.ts)).

### Tables

#### `volumes` (Migration 1)
Stores local drive information, volume identifiers, capacity, and indexing state:
```sql
CREATE TABLE IF NOT EXISTS volumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_guid TEXT,
  drive_letter TEXT NOT NULL UNIQUE,       -- E.g. 'C:', 'D:'
  label TEXT NOT NULL DEFAULT '',
  file_system TEXT NOT NULL DEFAULT 'NTFS',
  total_bytes INTEGER NOT NULL DEFAULT 0,
  free_bytes INTEGER NOT NULL DEFAULT 0,
  indexing_state TEXT NOT NULL DEFAULT 'unindexed',
  last_scan_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### `indexing_sessions` (Migration 1)
Tracks scanning sessions, timestamps, item counts, and error logs:
```sql
CREATE TABLE IF NOT EXISTS indexing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                    -- 'running' | 'completed' | 'failed' | 'cancelled'
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  scanned_files INTEGER NOT NULL DEFAULT 0,
  scanned_folders INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_details TEXT
);
```

#### `entries` (Migration 1)
Stores files and folders with absolute paths, parent paths, and metadata:
```sql
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',      -- E.g. '.pdf', '.ts'
  is_directory INTEGER NOT NULL DEFAULT 0, -- 0 = File, 1 = Directory
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  modified_at INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  scan_id INTEGER NOT NULL REFERENCES indexing_sessions(id),
  file_reference_number TEXT,              -- 64-bit unsigned precision safe for NTFS USN Journal
  parent_reference_number TEXT,            -- 64-bit unsigned precision safe for NTFS USN Journal
  usn TEXT,
  CONSTRAINT uq_volume_path UNIQUE (volume_id, path)
);
```

#### `entries_fts` (Migration 2)
External content FTS5 virtual table with the trigram tokenizer for indexed substring matching:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  name,
  path,
  content='entries',
  content_rowid='id',
  tokenize='trigram'
);

-- Real-time synchronization triggers
CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
  INSERT INTO entries_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
END;

-- Case-insensitive B-tree indexes for exact and prefix queries
CREATE INDEX IF NOT EXISTS idx_entries_name_nocase ON entries (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_entries_ext_nocase ON entries (extension COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_entries_path_nocase ON entries (path COLLATE NOCASE);
```

#### `volume_checkpoints` (Migration 3)
Persists per-volume synchronization checkpoints, USN Journal tracking, and active monitoring mode:
```sql
CREATE TABLE IF NOT EXISTS volume_checkpoints (
  volume_id INTEGER PRIMARY KEY REFERENCES volumes(id) ON DELETE CASCADE,
  journal_id TEXT,                         -- 64-bit hex string (e.g. '0x01d9c3c0627e36af')
  first_usn TEXT,                          -- 64-bit hex string
  next_usn TEXT,                           -- 64-bit hex string
  last_processed_usn TEXT,                 -- Last processed USN checkpoint
  sync_mode TEXT NOT NULL DEFAULT 'filesystem_watcher', -- 'usn_journal' | 'filesystem_watcher' | 'reconciling'
  sync_status TEXT NOT NULL DEFAULT 'out_of_sync',      -- 'synced' | 'syncing' | 'reconciling' | 'out_of_sync' | 'error'
  last_sync_timestamp INTEGER,
  checkpoint_timestamp INTEGER NOT NULL,
  error_message TEXT
);

-- Fast lookup indexes for NTFS file reference numbers and parent references
CREATE INDEX IF NOT EXISTS idx_entries_volume_frn ON entries (volume_id, file_reference_number);
CREATE INDEX IF NOT EXISTS idx_entries_volume_parent_frn ON entries (volume_id, parent_reference_number);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON volume_checkpoints (sync_status);
```

---

## Controlled IPC API

The renderer interacts with backend engines through typed channels on `window.quickFindApi`:

### Indexing API (`window.quickFindApi.indexing`)
| Method | Return Type | Description |
| :--- | :--- | :--- |
| `getVolumes()` | `Promise<IpcResponse<VolumeInfo[]>>` | Discovers local NTFS drives and returns their indexing state and entry counts. |
| `getStatus()` | `Promise<IpcResponse<IndexingStatus>>` | Retrieves overall indexing engine status, total files/folders, and active progress. |
| `startScan(volumeId)` | `Promise<IpcResponse<{ sessionId: number }>>` | Dispatches background worker scan for the specified volume. |
| `cancelScan()` | `Promise<IpcResponse<void>>` | Aborts the active scan gracefully. |
| `onProgress(callback)` | `() => void` | Subscribes to real-time progress updates (items/sec, current path, files, folders, errors). |

### Search API (`window.quickFindApi.search`)
| Method | Return Type | Description |
| :--- | :--- | :--- |
| `search(query: SearchQuery)` | `Promise<IpcResponse<SearchResults>>` | Executes ranked search query across filenames and paths with optional filters and pagination. |

### Synchronization API (`window.quickFindApi.sync`)
| Method | Return Type | Description |
| :--- | :--- | :--- |
| `getStatus()` | `Promise<IpcResponse<Record<number, VolumeCheckpoint>>>` | Retrieves persisted sync checkpoints, active mode, and sync status for all volumes. |
| `reconcile(volumeId)` | `Promise<IpcResponse<{ volumeId: number; reconciledCount: number }>>` | Triggers targeted differential reconciliation against SQLite for the given volume. |
| `onStatusUpdate(callback)` | `() => void` | Subscribes to real-time volume synchronization state changes and live change events. |

---

## Project Structure

```
QuickFind/
├── index.html                   # HTML template with Content Security Policy
├── package.json                 # Project scripts & dependencies
├── tsconfig.json                # Root TypeScript configuration
├── tsconfig.node.json           # Node / Electron main process TypeScript config
├── tsconfig.preload.json        # Preload script TypeScript config
├── tsconfig.renderer.json       # React / DOM renderer TypeScript config
├── vite.config.mts              # Vite configuration for React renderer
├── vite.config.preload.mts      # Vite configuration for sandboxed preload bundling
├── eslint.config.mjs            # ESLint 9 flat configuration
├── .prettierrc                  # Prettier formatting rules
├── .gitignore                   # Git ignore rules
├── scripts/
│   ├── dev.mjs                  # Development server & Electron launcher
│   └── build.mjs                # Production build orchestrator
└── src/
    ├── shared/                  # Code shared across main, preload, and renderer
    │   ├── constants.ts         # App constants, IPC channel names, SQLite pragmas
    │   └── types/
    │       ├── indexing.ts      # VolumeInfo, IndexingSession, Entry models
    │       ├── ipc.ts           # Type-safe IPC request/response contracts
    │       ├── search.ts        # SearchQuery, SearchResults, MatchType models
    │       ├── system.ts        # AppInfo, DatabaseStatus, SystemHealth models
    │       └── index.ts
    ├── preload/                 # Preload layer
    │   ├── api.ts               # QuickFindApi interface definition
    │   └── index.ts             # Sandboxed contextBridge implementation
    ├── main/                    # Electron main process
    │   ├── index.ts             # Application lifecycle & window creation
    │   ├── config/
    │   │   └── appConfig.ts     # Path resolution, environment detection
    │   ├── database/
    │   │   ├── connection.ts    # SQLite initialization, pragmas, lifecycle
    │   │   ├── migrations.ts    # Database schema migration runner
    │   │   ├── schema.ts        # Table definitions and performance indexes
    │   │   └── index.ts
    │   ├── indexing/            # Indexing Engine component
    │   │   ├── pathUtils.ts     # Path normalization, exclusions, parent extraction
    │   │   ├── service.ts       # IndexingService coordinator & worker manager
    │   │   ├── types.ts         # IIndexingEngine contracts
    │   │   ├── volumeDiscovery.ts # Windows fixed NTFS volume discovery
    │   │   ├── sync/                # Incremental synchronization & monitoring
    │   │   │   ├── usn/             # NTFS USN Journal integration module
    │   │   │   │   ├── usnTypes.ts  # Win32 USN constants, records, and types
    │   │   │   │   ├── usnParser.ts # Binary parser for USN_RECORD_V2 & V3
    │   │   │   │   └── usnReader.ts # Journal querying, validation & rollover detection
    │   │   │   ├── watcher/         # Windows filesystem watcher
    │   │   │   │   └── filesystemWatcher.ts # Recursive ReadDirectoryChangesW monitoring
    │   │   │   ├── changeProcessor.ts # Batched, transactional SQLite mutations & child renames
    │   │   │   ├── syncService.ts   # Sync coordinator & targeted differential reconciler
    │   │   │   └── index.ts
    │   │   ├── worker/              # Background worker thread
    │   │   │   ├── indexerDb.ts     # Worker-dedicated SQLite connection & batch transactions
    │   │   │   ├── indexingWorker.ts # Worker entrypoint and event dispatch
    │   │   │   └── scanner.ts       # Bounded concurrency directory queue scanner
    │   │   └── index.ts
    │   ├── search/              # Search Engine component
    │   │   ├── queryBuilder.ts  # FTS5 & B-tree query generator, ranking, sanitization
    │   │   ├── service.ts       # SearchService search implementation
    │   │   ├── types.ts         # ISearchEngine contracts
    │   │   └── index.ts
    │   ├── services/
    │   │   ├── appService.ts    # Application state & health aggregation
    │   │   └── index.ts
    │   ├── security/
    │   │   ├── csp.ts           # Content Security Policy configuration
    │   │   ├── validator.ts     # IPC sender and frame validation
    │   │   └── index.ts
    │   └── ipc/
    │       ├── handlers.ts      # Validated IPC handler registrations
    │       └── index.ts
    └── renderer/                # React 19 frontend
        ├── main.tsx             # React mount point
        ├── App.tsx              # Dashboard & volume/search manager
        ├── App.css              # Dark theme styling
        ├── types/
        │   └── electron.d.ts    # Global window.quickFindApi typing
        └── components/
            ├── Header.tsx       # Frameless titlebar & window controls
            ├── IndexingProgressCard.tsx # Live scan status, speed & cancellation
            ├── InfoCard.tsx     # System & database specification display
            ├── SearchTester.tsx # Real-time search testing & results display
            ├── StatusBadge.tsx  # Health state indicator badge
            └── VolumeCard.tsx   # Local drive card with indexing action
```

---

## Development & Build Commands

### Prerequisites
- **Node.js**: v22.x or later
- **npm**: v10.x or later
- **OS**: Windows (tested on Windows 10/11 x64)

### Development Mode
Starts the Vite dev server with Hot Module Replacement (HMR), compiles the TypeScript main process in watch mode, and opens the Electron window:
```bash
npm run dev
```

### Production Build
Builds the React renderer into `dist/renderer`, bundles the sandboxed preload script into `dist/preload`, and compiles the main process and indexing worker scripts into `dist/main`:
```bash
npm run build
```

### Type Checking
Performs strict TypeScript validation across Node, Preload, and DOM targets:
```bash
npm run typecheck
```

### Linting & Formatting
```bash
# Check code style with ESLint
npm run lint

# Automatically fix linting issues
npm run lint:fix

# Check formatting with Prettier
npm run format:check

# Format codebase with Prettier
npm run format
```

---

## Floating Desktop Search & System Tray

In Milestone 5, QuickFind transforms into a minimal, keyboard-first Windows desktop search application:

```
┌─────────────────────────────────────────────────────────────┐
│ 🔍  package.json              0.4 ms • 18 hits       ✕   ⚙ │
├─────────────────────────────────────────────────────────────┤
│  [All]  [Files]  [Folders]                          1 of 18 │
├─────────────────────────────────────────────────────────────┤
│ 📄 package.json                    [EXACT NAME]    1.5 KB   │
│    D:\Development\Utility\QuickFind\package.json  Nov 6, 2026│
│                                                             │
│ 📄 package-lock.json               [PREFIX]      186.6 KB   │
│    D:\Development\Utility\QuickFind\package-lock.json       │
├─────────────────────────────────────────────────────────────┤
│ [↵] Open  [Ctrl+↵] Reveal  [Ctrl+⇧+C] Copy Path  [Esc] Close│
└─────────────────────────────────────────────────────────────┘
```

### 1. Global Keyboard Shortcut
- **Shortcut**: `Ctrl + Shift + Space` (`CommandOrControl+Shift+Space`).
- **Behavior**: Summons QuickFind from anywhere in Windows or dismisses it if already focused.
- **Display Awareness**: Centers horizontally in the upper 15% of the active display (the monitor where the user's cursor currently resides).
- **Auto-Focus**: Immediately focuses and selects search input upon summons. Any character typed anywhere in the window directs straight into the search box.

### 2. Windows System Tray
- **Tray Icon**: Crisp 32x32 native image docked in the Windows system notification area.
- **Context Menu**:
  - **Open QuickFind** (`Ctrl+Shift+Space`) — Toggles floating search bar.
  - **Manage Indexed Volumes** — Switches window into full management view (Volumes, Indexing sessions, Database status).
  - **Re-index All Volumes** — Triggers scanning across all discovered NTFS drives.
  - **Quit QuickFind** — Safely unregisters shortcuts, tears down watchers, shuts down SQLite, and terminates the application.
- **Window Lifecycle**: Closing or blurring the floating search window hides it; background filesystem watchers and incremental synchronization continue running uninterrupted. QuickFind is only terminated via Tray "Quit".

### 3. Keyboard-First Navigation
| Shortcut | Action | Description |
|---|---|---|
| `↑` / `↓` | Select Result | Cycles selection through ranked results (first selected by default). Automatically scrolls item into view. |
| `↵` (Enter) | Open File/Folder | Launches item in its default application or opens folder via `shell.openPath`. Gracefully verifies file existence on disk first. Hides search window on success. |
| `Ctrl + ↵` | Reveal in Explorer | Highlights and reveals item in Windows File Explorer via `shell.showItemInFolder`. |
| `Ctrl + ⇧ + C` | Copy Path | Copies absolute path to Windows clipboard via `clipboard.writeText` and shows a confirmation toast. |
| `Esc` | Clear / Dismiss | Dismisses active errors/toasts; if search input has text, clears text; if input is empty, dismisses floating window. |

### 4. Dual View Modes
- **Floating Search (`'search'`)**: Frameless, minimal floating spotlight window (width 680px, height 58px expanding dynamically up to 520px with results).
- **Volume Management (`'manage'`)**: Expands to full 920x640 window displaying discovered NTFS volumes, indexing controls, USN checkpoints, and search engine test panel. Seamlessly return to search mode anytime via the header "Quick Search" button or `Escape`.

---

## Milestone Status & Roadmap

- **Milestone 1 (Complete)**: Project Foundation & Architecture
  - Electron + React 19 + Vite + TypeScript foundation.
  - SQLite (`better-sqlite3`) setup with WAL mode & FTS5 in `userData`.
  - Secure sandboxed IPC bridge with sender frame validation and Content Security Policy.
- **Milestone 2 (Complete)**: Database Schema & Initial Filesystem Indexing Engine
  - Database schema for `volumes`, `indexing_sessions`, `entries`, and performance indexes.
  - Automated schema migration runner.
  - Windows fixed NTFS volume discovery.
  - Bounded concurrency directory queue scanner skipping symbolic links and junctions.
  - Offloaded background worker thread execution with dedicated SQLite batch transactions.
- **Milestone 3 (Complete)**: Search Engine Implementation
  - SQLite FTS5 virtual table with `trigram` tokenizer (`entries_fts`).
  - Real-time synchronization triggers (`AFTER INSERT`, `AFTER DELETE`, `AFTER UPDATE`).
  - B-tree fallback queries for short queries ($< 3$ characters).
  - 5-tier ranking prioritization: Exact filename, Filename prefix, Filename substring, Exact folder, and Path matches.
  - Extension and file/folder filtering with sub-millisecond execution times.
  - Integration with Electron IPC and real-time dashboard query test panel.
- **Milestone 4 (Complete)**: Incremental Indexing & Filesystem Synchronization
  - Windows filesystem monitoring using `ReadDirectoryChangesW` via recursive directory watcher.
  - Dedicated NTFS USN Change Journal parser supporting binary `USN_RECORD_V2` and `V3` (lossless 64-bit and 128-bit FRN and USN identifiers).
  - Journal querying via `fsutil usn queryjournal`, checkpoint validation, and rollover / journal recreation detection.
  - Non-destructive `Migration 3` with persistent `volume_checkpoints` and B-tree indexes for NTFS file reference numbers.
  - Populating 64-bit NTFS file reference numbers (`ino`) and parent reference numbers directly in initial scanner.
  - Transactional, idempotent `ChangeProcessor` handling creations, metadata updates, recursive subtree deletions, and directory renames with all descendant child path transformations.
  - Targeted directory differential reconciliation avoiding full drive rescanning.
  - Race condition buffering during initial volume scanning.
  - Controlled Electron IPC endpoints (`quickfind:sync:getStatus`, `quickfind:sync:reconcile`, `quickfind:sync:statusUpdate`) and enriched volume dashboard UI.
- **Milestone 5 (Complete)**: Floating Desktop Search Interface & System Tray
  - Spotlight/Raycast-style floating search window with dynamic height expansion.
  - Global keyboard shortcut (`Ctrl + Shift + Space`) with display-aware positioning (upper 15% of active display).
  - System tray icon with context menu ("Open QuickFind", "Manage Indexed Volumes", "Re-index All Volumes", "Quit QuickFind").
  - Keyboard-first result navigation (`ArrowUp/Down`, `Enter`, `Ctrl+Enter`, `Ctrl+Shift+C`, `Escape`).
  - Native file operations (`shell.openPath`, `shell.showItemInFolder`, `clipboard.writeText`) with stale file disk verification.
  - Dual-mode architecture seamlessly toggling between compact floating search bar and comprehensive volume management dashboard.
