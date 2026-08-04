#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[[ -f "$PROJECT_ROOT/viewer.env" ]] && source "$PROJECT_ROOT/viewer.env"
WEB_PORT="${WEB_PORT:-5173}"

[[ -f "$PROJECT_ROOT/dist/index.html" ]] || {
    echo "ERROR: dist/index.html is missing. Run npm ci && npm run build first." >&2
    exit 1
}

echo "Serving http://0.0.0.0:$WEB_PORT"
exec python3 -m http.server "$WEB_PORT" --directory "$PROJECT_ROOT/dist" --bind 0.0.0.0
