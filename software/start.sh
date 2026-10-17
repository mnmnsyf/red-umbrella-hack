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
echo "Open http://localhost:${PORT}"
exec uv run uvicorn portwatch.server:app --host 127.0.0.1 --port "$PORT"
