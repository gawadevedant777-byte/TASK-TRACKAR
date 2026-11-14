# ⚡ TaskFlow — Task Tracker & Daily Diary

[![C++14](https://img.shields.io/badge/Language-C%2B%2B14-blue.svg)](https://isocpp.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](https://microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A high-performance, full-stack **Task Tracker & Daily Diary** web application built with a native **C++ WinSock2 HTTP REST backend** and a modern, responsive **Vanilla JavaScript & CSS3 Single-Page Application (SPA)** frontend.

---

## 🌟 Key Features

### 📁 1. Custom Folder Management (N-ary Tree)
- Organize tasks and journal logs into nested categories with an **N-ary tree structure**.
- Custom folder names and **visual color coding** (palette selection or custom hex).
- Full support for parent-child folder hierarchies and recursive cascade deletions.
- Monotonically increasing unique IDs persisted atomically via C++ file streaming (`folders.json`).

### 📓 2. Unified Task & Daily Diary Engine
- **Daily Tasks:** Create actionable items with Priority (`High`, `Medium`, `Low`), Status (`Pending`, `In Progress`, `Done`), Due Dates, and Folder assignments.
- **Daily Diary:** Rich chronological journaling system for reflections, notes, and milestones.
- **In-View Progress Tracker:** Real-time completion progress bar rendered directly above the task list.
- **Filter Pills & Search:** Instant client-side filtering by status (`All`, `Pending`, `In Progress`, `Completed`) and real-time keyword search across titles and descriptions.
- **Full CRUD:** Intuitive modals for adding, editing, toggling, and deleting tasks and diary entries.

### 📊 3. ISO Weekly Tracker & Percentage Analytics
- **True ISO Monday–Sunday Normalization:** Employs standard calendar math (`mktime`) to group entries into deterministic Monday-to-Sunday weekly buckets.
- **Automated Recalculation:** Every task toggle or status change instantly recalculates daily and weekly completion rates.
- **Interactive Visualizations:**
  - Executive KPI summary cards (Total Tasks, Completed, Pending, In Progress, Diary Entries).
  - Overall progress bar with dynamic completion percentage.
  - Priority distribution breakdown.
  - Interactive 7-Day Monday–Sunday bar chart with percentage labels, gradient fill heights, and date indicators.
  - Itemized daily breakdown list showing progress bars and completion ratios (`done / total`).

### 💾 4. Robust Persistence & Zero-Dependency Backend
- Single-threaded, non-blocking WinSock2 HTTP REST server built without heavy external frameworks.
- Header-only JSON serialization via `nlohmann/json`.
- Automatic static file serving for HTML, CSS, JavaScript, and assets.
- Survives server restarts with reliable disk storage in `backend/data/`.

---

## 🏗️ Architecture & Project Structure

```text
TASK-TRACKAR/
├── README.md               # Project documentation
├── .gitignore              # Git ignore rules
├── build.ps1               # Automated compilation and launch script
├── backend/
│   ├── server.exe          # Compiled backend executable (WinSock2, port 8080)
│   ├── data/
│   │   ├── folders.json    # JSON storage for folder hierarchy
│   │   └── tasks.json      # JSON storage for tasks & diary entries
│   ├── include/            # Third-party header libraries
│   │   ├── json.hpp        # nlohmann/json modern C++ parser
│   │   └── httplib.h       # cpp-httplib single-header library
│   └── src/
│       ├── main.cpp        # WinSock2 HTTP server, static file router & REST API
│       ├── models.hpp      # Data models (Folder, Task, DayStats, WeeklyTracker)
│       └── datastore.hpp   # In-memory store, N-ary tree operations & persistence
└── frontend/
    ├── index.html          # SPA markup (Sidebar, Content Area, Modals)
    ├── css/
    │   └── style.css       # Dark-mode design system & animations
    └── js/
        └── app.js          # Client-side state manager, API client & dynamic renderer
```

---

## 📡 REST API Reference

The backend listens on `http://localhost:8080` and exposes the following endpoints:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Healthcheck and server diagnostic info |
| `GET` | `/api/folders` | Returns all folders with N-ary tree relations |
| `POST` | `/api/folder` | Creates a new folder (`name`, `color`, `parent_id`) |
| `POST` | `/api/folder/update` | Updates folder name, color, or parent ID |
| `DELETE` | `/api/folder/:id` | Recursively deletes folder and child tasks |
| `GET` | `/api/tasks` | Lists all tasks; supports `?folder_id=X` and `?type=diary` |
| `POST` | `/api/task` | Adds new task or diary entry |
| `POST` | `/api/task/toggle` | Toggles status between `done` and `pending` |
| `POST` | `/api/task/update` | Edits task title, description, date, priority, folder, status |
| `DELETE` | `/api/task/:id` | Permanently deletes a task by ID |
| `GET` | `/api/analytics` | Returns aggregated metrics, priority counts & weekly breakdown |

---

## 🚀 Getting Started

### Prerequisites
- **Operating System:** Windows 10 / 11
- **Compiler (optional for rebuilding):** MinGW GCC 6.3+ (with `g++` available on PATH)

### Quick Start (Automated Build & Run)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gawadevedant777-byte/TASK-TRACKAR.git
   cd TASK-TRACKAR
   ```

2. **Run the PowerShell build script:**
   ```powershell
   .\build.ps1
   ```
   *The script will verify your compiler, compile `main.cpp` using `-std=c++14`, link WinSock (`-lws2_32`), and start the server.*

3. **Open in Browser:**
   Navigate to [http://localhost:8080](http://localhost:8080) to use TaskFlow.

---

### Manual Compilation

If you prefer compiling manually using `g++`:

```powershell
cd backend
g++ -std=c++14 -O2 -I"include" -I"src" "src\main.cpp" -o "server.exe" -lws2_32 -static-libgcc -static-libstdc++
.\server.exe
```

---

## 👤 Author

Developed by **[gawadevedant777-byte](https://github.com/gawadevedant777-byte)**.
