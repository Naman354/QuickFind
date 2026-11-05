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
│  Filesystem scanning &      ││  Query parsing, ranking,     │
│  metadata change tracking   ││  filtering & FTS5 matching   │
│  (Worker Thread • Bounded)  ││  (Milestone 3 - FTS5)        │
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
- **Role**: Search user interface and volume indexing progress display.
- **Security**: Runs in an isolated renderer sandbox (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- **Communication**: Interacts with backend services exclusively through a typed context bridge (`window.quickFindApi`).

### 2. Indexing Engine
- **Role**: Discovers local fixed NTFS volumes, recursively scans directory structures, collects entry metadata, and persists records in SQLite.
- **Offload & Concurrency**: Runs off the main Electron event loop inside a dedicated background `worker_threads.Worker` with bounded concurrency (8 workers) and batched database writes (2,000 items/batch).
- **Filesystem Traversal**: Ignores symbolic links, directory junctions, and reparse points to avoid recursion loops. Applies conservative system exclusions (`$Recycle.Bin`, `System Volume Information`, etc.) without excluding user directories or project repositories.
- **Stale Record Safety**: Old records are pruned only upon a completely successful full volume scan; failed or interrupted scans preserve previously indexed data intact.

### 3. Search Engine
- **Role**: Query processing, token matching, ranking, and filtering (to be implemented in Milestone 3).
- **Design**: Implemented behind the `ISearchEngine` facade interface (`src/main/search/`), prepared for full-text queries powered by SQLite FTS5.

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

#### `volumes`
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
  indexing_state TEXT NOT NULL DEFAULT 'unindexed', -- 'unindexed' | 'indexing' | 'indexed' | 'error'
  last_scan_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### `indexing_sessions`
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

#### `entries`
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

#### Indexes
- `idx_entries_volume_parent`: High-speed directory tree queries on `(volume_id, parent_path)`.
- `idx_entries_name`: Fast name lookups on `name`.
- `idx_entries_volume_ext`: Fast extension filtering on `(volume_id, extension)`.
- `idx_entries_volume_scan`: Enables instantaneous stale record identification on `(volume_id, scan_id)`.
- `idx_entries_is_dir`: Fast filtering for directories vs files.
- `idx_sessions_volume`: Session history lookup per volume.

---

## Indexing Lifecycle & Controlled IPC API

The renderer interacts with the indexing engine through `window.quickFindApi.indexing`:

| Method | Return Type | Description |
| :--- | :--- | :--- |
| `getVolumes()` | `Promise<IpcResponse<VolumeInfo[]>>` | Discovers local NTFS drives and returns their indexing state and entry counts. |
| `getStatus()` | `Promise<IpcResponse<IndexingStatus>>` | Retrieves overall indexing engine status, total files/folders, and active progress. |
| `startScan(volumeId)` | `Promise<IpcResponse<{ sessionId: number }>>` | Dispatches background worker scan for the specified volume. |
| `cancelScan()` | `Promise<IpcResponse<void>>` | Aborts the active scan gracefully. |
| `onProgress(callback)` | `() => void` | Subscribes to real-time progress updates (items/sec, current path, files, folders, errors). |

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
    │   │   ├── worker/          # Background worker thread
    │   │   │   ├── indexerDb.ts # Worker-dedicated SQLite connection & batch transactions
    │   │   │   ├── indexingWorker.ts # Worker entrypoint and event dispatch
    │   │   │   └── scanner.ts   # Bounded concurrency directory queue scanner
    │   │   └── index.ts
    │   ├── search/              # Search Engine component
    │   │   ├── types.ts         # ISearchEngine contracts
    │   │   ├── service.ts       # SearchService facade
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
        ├── App.tsx              # Indexing dashboard & volume manager
        ├── App.css              # Dark theme styling
        ├── types/
        │   └── electron.d.ts    # Global window.quickFindApi typing
        └── components/
            ├── Header.tsx       # Frameless titlebar & window controls
            ├── IndexingProgressCard.tsx # Live scan status, speed & cancellation
            ├── InfoCard.tsx     # System & database specification display
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

## Milestone Status & Roadmap

- **Milestone 1 (Complete)**: Project Foundation & Architecture
  - Electron + React 19 + Vite + TypeScript foundation.
  - SQLite (`better-sqlite3`) setup with WAL mode & FTS5 in `userData`.
  - Secure sandboxed IPC bridge with sender frame validation and Content Security Policy.
- **Milestone 2 (Complete)**: Database Schema & Initial Filesystem Indexing Engine
  - Database schema for `volumes`, `indexing_sessions`, `entries`, and performance indexes.
  - 64-bit unsigned precision preservation for future NTFS USN Journal fields.
  - Automated schema migration runner.
  - Windows fixed NTFS volume discovery.
  - Bounded concurrency directory queue scanner skipping symbolic links and junctions.
  - Offloaded background worker thread execution with dedicated SQLite batch transactions (20,000+ items/sec).
  - Real-time progress reporting, safe cancellation, and stale record pruning on full scan completion.
- **Milestone 3 (Next)**: Search Processing & Desktop Search Interface
  - SQLite FTS5 query processing, matching, ranking, and filtering.
  - Keyboard-driven desktop search UI.
