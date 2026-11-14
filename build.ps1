# ════════════════════════════════════════════════════════════
#  Task Tracker & Daily Diary — PowerShell Build Script
#  Compiles the C++ backend and starts the server
# ════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$SRC_DIR  = Join-Path $PROJECT_ROOT "backend\src"
$INC_DIR  = Join-Path $PROJECT_ROOT "backend\include"
$DATA_DIR = Join-Path $PROJECT_ROOT "backend\data"
$OUT_EXE  = Join-Path $PROJECT_ROOT "backend\server.exe"

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TaskFlow — C++ Backend Build Script     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check compiler ────────────────────────────────────────
Write-Host "[1/4] Checking compiler..." -ForegroundColor Yellow
try {
    $ver = & g++ --version 2>&1 | Select-Object -First 1
    Write-Host "      ✓ $ver" -ForegroundColor Green
} catch {
    Write-Error "g++ not found! Please install MinGW or TDM-GCC."
}

# ── 2. Ensure data directory ─────────────────────────────────
Write-Host "[2/4] Creating data directory..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $DATA_DIR | Out-Null
Write-Host "      ✓ $DATA_DIR" -ForegroundColor Green

# ── 3. Compile ───────────────────────────────────────────────
Write-Host "[3/4] Compiling C++ source..." -ForegroundColor Yellow

$SRC_FILE = Join-Path $SRC_DIR "main.cpp"

$COMPILE_ARGS = @(
    "-std=c++14",
    "-O2",
    "-I$INC_DIR",
    "-I$SRC_DIR",
    "$SRC_FILE",
    "-o", "$OUT_EXE",
    "-lws2_32",       # Windows socket library
    "-static-libgcc",
    "-static-libstdc++"
)

Write-Host "      g++ $($COMPILE_ARGS -join ' ')" -ForegroundColor DarkGray

$build = Start-Process -FilePath "g++" `
    -ArgumentList $COMPILE_ARGS `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardError "$PROJECT_ROOT\build_err.log"

if ($build.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "❌ Compilation FAILED! Error log:" -ForegroundColor Red
    Get-Content "$PROJECT_ROOT\build_err.log" | Write-Host -ForegroundColor Red
    exit 1
}

Write-Host "      ✓ Compiled → $OUT_EXE" -ForegroundColor Green

# ── 4. Launch server ─────────────────────────────────────────
Write-Host "[4/4] Starting server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Open your browser at: " -NoNewline
Write-Host "http://localhost:8080" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop the server"
Write-Host ""

Set-Location (Join-Path $PROJECT_ROOT "backend")
& $OUT_EXE
