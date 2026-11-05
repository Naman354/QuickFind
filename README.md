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
│  (Milestone 2 - Worker/IPC) ││  (Milestone 2 - SQLite)      │
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
- **Role**: Search user interface and results display.
- **Security**: Runs in an isolated renderer sandbox (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- **Communication**: Interacts with the backend strictly through a typed context bridge (`window.quickFindApi`).

### 2. Indexing Engine
- **Role**: Filesystem scanning, metadata collection, and filesystem change monitoring.
- **Design**: Implemented behind the `IIndexingEngine` facade interface (`src/main/indexing/`). The architecture is structured to offload CPU-intensive scanning to an Electron `utilityProcess` or Worker thread in subsequent milestones without modifying renderer code or IPC contracts.

### 3. Search Engine
- **Role**: Query processing, token matching, ranking, and filtering.
- **Design**: Implemented behind the `ISearchEngine` facade interface (`src/main/search/`), prepared for full-text queries powered by SQLite FTS5.

### 4. Database Foundation
- **Storage Location**: Electron's `app.getPath('userData')` directory (`%APPDATA%/quickfind/quickfind.db` on Windows). Never written into source directories.
- **Driver**: `better-sqlite3` compiled with SQLite FTS5 support.
- **Performance & Integrity Pragmas**:
  - `journal_mode = WAL`: High concurrency, non-blocking readers/writers.
  - `synchronous = NORMAL`: Eliminates disk flush bottlenecks safely in WAL mode.
  - `foreign_keys = ON`: Strict referential integrity.
  - `cache_size = -64000`: 64 MB in-memory SQLite cache.
  - `temp_store = MEMORY`: RAM-based temporary tables and sorting.
  - `mmap_size = 268435456`: 256 MB memory-mapped I/O for high-speed reads.
  - `busy_timeout = 5000`: 5-second lock resolution timeout.

---

## Security Architecture

QuickFind implements Electron security best practices:

- **Isolated Renderer**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Controlled Preload**: Only typed, safe methods are exposed to `window.quickFindApi`. No raw Node.js APIs or unrestricted `ipcRenderer` instances are accessible.
- **IPC Sender Validation**: Every IPC invocation verifies `event.sender.id` and validates `event.senderFrame.url` against authorized window origins before handling requests.
- **Navigation & Window Guards**: Navigation away from the local application is intercepted and blocked (`will-navigate`). Untrusted popup creation (`window.open` / `target="_blank"`) is denied via `setWindowOpenHandler`.
- **Content Security Policy (CSP)**: Enforced via HTTP response headers and `<meta>` tags:
  - Development: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5173 http://localhost:5173;`
  - Production: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';`

---

## Project Structure

```
QuickFind/
├── index.html                   # HTML template with Content Security Policy
├── package.json                 # Project scripts & dependencies
├── tsconfig.json                # Root TypeScript configuration
├── tsconfig.node.json           # Node / Electron main process TypeScript config
├── tsconfig.renderer.json       # React / DOM renderer TypeScript config
├── vite.config.mts              # Vite configuration for React renderer
├── vite.config.preload.mts      # Vite configuration for sandboxed preload bundling
├── eslint.config.mjs            # ESLint 9 configuration
├── .prettierrc                  # Prettier formatting rules
├── .gitignore                   # Git ignore rules
├── scripts/
│   ├── dev.mjs                  # Development server & Electron launcher
│   └── build.mjs                # Production build orchestrator
└── src/
    ├── shared/                  # Code shared across main, preload, and renderer
    │   ├── constants.ts         # App constants, IPC channel names, SQLite pragmas
    │   └── types/
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
    │   │   └── index.ts
    │   ├── indexing/            # Indexing Engine component
    │   │   ├── types.ts         # IIndexingEngine contracts
    │   │   ├── service.ts       # IndexingService facade
    │   │   └── index.ts
    │   ├── search/              # Search Engine component
    │   │   ├── types.ts         # ISearchEngine contracts
    │   │   ├── service.ts       # SearchService facade
    │   │   └── index.ts
    │   ├── services/
    │   │   ├── appService.ts    # Application state & health aggregation
    │   │   └── index.ts
    │   ├── security/
    │   │   ├── csp.ts           # CSP configuration
    │   │   ├── validator.ts     # IPC sender and frame validation
    │   │   └── index.ts
    │   └── ipc/
    │       ├── handlers.ts      # Validated IPC handler registrations
    │       └── index.ts
    └── renderer/                # React 19 frontend
        ├── main.tsx             # React mount point
        ├── App.tsx              # Minimal placeholder dashboard
        ├── App.css              # Dark theme styling
        ├── types/
        │   └── electron.d.ts    # Global window.quickFindApi typing
        └── components/
            ├── Header.tsx       # Frameless titlebar & window controls
            ├── InfoCard.tsx     # System & database information display
            └── StatusBadge.tsx  # Health state indicator badge
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
Builds the React renderer into `dist/renderer`, bundles the sandboxed preload script into `dist/preload`, and compiles the main process into `dist/main`:
```bash
npm run build
```

### Type Checking
Performs strict TypeScript validation across both Node and DOM targets:
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

### Native Module Rebuilding
If `better-sqlite3` needs to be compiled against an updated Electron ABI:
```bash
npm run rebuild
```

---

## Milestone Status & Roadmap

- **Milestone 1 (Complete)**: Project Foundation & Architecture
  - Electron + React + Vite + TypeScript configuration.
  - SQLite (`better-sqlite3`) database foundation with WAL mode & FTS5 support in `userData`.
  - Secure sandboxed IPC bridge with sender frame validation and Content Security Policy.
  - Facade architecture for independent Indexing and Search engines.
  - Minimal placeholder dashboard with live health and database reporting.
- **Milestone 2 (Next)**: Filesystem Indexing & Search Engine Schema
  - Filesystem scanner and directory walker.
  - SQLite database schema, indices, and FTS5 virtual tables.
  - Metadata indexing pipeline and incremental change detection.
- **Milestone 3**: Search Processing & Desktop Search Interface
  - Real-time query execution, ranking, and filtering.
  - Keyboard-driven desktop search UI.

