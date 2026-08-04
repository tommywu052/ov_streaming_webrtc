#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[[ -f "$PROJECT_ROOT/viewer.env" ]] && source "$PROJECT_ROOT/viewer.env"

ISAAC_ROOT="${ISAAC_ROOT:-$HOME/isaacsim}"
ACTIVE_GPU="${ACTIVE_GPU:-0}"
SIGNAL_PORT="${SIGNAL_PORT:-49100}"
KIT_BIN="$ISAAC_ROOT/kit/kit"
EXPERIENCE="$PROJECT_ROOT/kit/apps/ov.web.viewer.5.1.kit"

[[ -x "$KIT_BIN" ]] || { echo "ERROR: Kit not found: $KIT_BIN" >&2; exit 1; }

extension_args=(--ext-folder "$PROJECT_ROOT/kit/exts")
for folder in apps exts extscache extsUser extsDeprecated; do
    [[ -d "$ISAAC_ROOT/$folder" ]] && extension_args+=(--ext-folder "$ISAAC_ROOT/$folder")
done

exec "$KIT_BIN" "$EXPERIENCE" --no-window \
    "${extension_args[@]}" \
    --/renderer/activeGpu="$ACTIVE_GPU" \
    --/app/livestream/port="$SIGNAL_PORT" \
    --/log/flushStandardStreamOutput=1 \
    "$@"
