#!/usr/bin/env bash
# Start Harbour Acoustic Watch on http://localhost:8000
# First run installs dependencies, generates simulated sample data and trains the baseline (~1-2 min).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. Install it with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "(or: python3 -m venv .venv && .venv/bin/pip install numpy scipy scikit-learn fastapi uvicorn python-multipart"
  echo "      && .venv/bin/uvicorn portwatch.server:app --port $PORT)"
  exit 1
fi
uv sync --quiet

# Build the 3D visualisation (../viz) when Node.js is available; the dashboard works without it.
VIZ_DIR="${VIZ_DIR:-../viz}"
if [ -f "$VIZ_DIR/package.json" ]; then
  OUT="$(pwd)/web/viz"
  if command -v npm >/dev/null 2>&1; then
    if [ ! -f "$OUT/index.html" ] || [ -n "$(find "$VIZ_DIR/src" "$VIZ_DIR/public" "$VIZ_DIR/index.html" -newer "$OUT/index.html" -print -quit 2>/dev/null)" ]; then
      echo "Building the 3D visualisation..."
      ( cd "$VIZ_DIR" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } \
          && npx vite build --base /viz/ --outDir "$OUT" --emptyOutDir --logLevel warn ) \
        || echo "3D visualisation build failed; the dashboard will run without it."
    fi
  else
    echo "Node.js not found: running without the 3D visualisation (install Node 18+ to enable it)."
  fi
fi
echo "Open http://localhost:${PORT}"
exec uv run uvicorn portwatch.server:app --host 127.0.0.1 --port "$PORT"
