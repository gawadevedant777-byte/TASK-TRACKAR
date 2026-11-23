# ════════════════════════════════════════════════════════════
#  Task Tracker & Daily Diary — PowerShell Build & Run Script
#  Compiles C++ backend if needed and launches the server
# ════════════════════════════════════════════════════════════

$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$SRC_DIR  = Join-Path $PROJECT_ROOT "backend\src"
$INC_DIR  = Join-Path $PROJECT_ROOT "backend\include"
$DATA_DIR = Join-Path $PROJECT_ROOT "backend\data"
$OUT_EXE  = Join-Path $PROJECT_ROOT "backend\server.exe"

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║    TaskFlow — Automated Build & Startup Script    ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Terminate any previous server instances ───────────────
Write-Host "[1/4] Checking for lingering server processes..." -ForegroundColor Yellow
$oldProcesses = Get-Process -Name "server" -ErrorAction SilentlyContinue
if ($oldProcesses) {
    $oldProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "      ✓ Cleared previous server process" -ForegroundColor Green
    Start-Sleep -Milliseconds 400
} else {
    Write-Host "      ✓ Port & process ready" -ForegroundColor Green
}

# ── 2. Ensure data directory ─────────────────────────────────
Write-Host "[2/4] Verifying data directories..." -ForegroundColor Yellow
if (-not (Test-Path $DATA_DIR)) {
    New-Item -ItemType Directory -Force -Path $DATA_DIR | Out-Null
}
Write-Host "      ✓ $DATA_DIR" -ForegroundColor Green

# ── 3. Compile (if g++ is present) ───────────────────────────
Write-Host "[3/4] Preparing C++ backend executable..." -ForegroundColor Yellow
$hasGpp = $false
try {
    $ver = & g++ --version 2>&1 | Select-Object -First 1
    if ($ver) { $hasGpp = $true }
} catch {
    $hasGpp = $false
}

if ($hasGpp) {
    Write-Host "      ✓ Found compiler: $ver" -ForegroundColor Green
    $SRC_FILE = Join-Path $SRC_DIR "main.cpp"
    $COMPILE_ARGS = @(
        "-std=c++14",
        "-O2",
        "-I$INC_DIR",
        "-I$SRC_DIR",
        "$SRC_FILE",
        "-o", "$OUT_EXE",
        "-lws2_32",
        "-static-libgcc",
        "-static-libstdc++"
    )

    Write-Host "      Compiling backend..." -ForegroundColor DarkGray
    $build = Start-Process -FilePath "g++" `
        -ArgumentList $COMPILE_ARGS `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardError "$PROJECT_ROOT\build_err.log"

    if ($build.ExitCode -eq 0) {
        Write-Host "      ✓ Successfully compiled → $OUT_EXE" -ForegroundColor Green
    } else {
        Write-Host "      ⚠ Recompilation warning/error. Checking if existing binary works..." -ForegroundColor Yellow
        if (-not (Test-Path $OUT_EXE)) {
            Write-Host "❌ Compilation FAILED! Error log:" -ForegroundColor Red
            Get-Content "$PROJECT_ROOT\build_err.log" | Write-Host -ForegroundColor Red
            exit 1
        }
    }
} else {
    if (Test-Path $OUT_EXE) {
        Write-Host "      ✓ Using existing precompiled binary → $OUT_EXE" -ForegroundColor Green
    } else {
        Write-Host "❌ g++ not found on PATH and no server.exe found! Please install MinGW GCC." -ForegroundColor Red
        exit 1
    }
}

# ── 4. Launch server ─────────────────────────────────────────
Write-Host "[4/4] Starting TaskFlow Server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Opening browser at: " -NoNewline
Write-Host "http://localhost:8080" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C in this window to stop the server"
Write-Host ""

Start-Process "http://localhost:8080"

Set-Location (Join-Path $PROJECT_ROOT "backend")
& $OUT_EXE
