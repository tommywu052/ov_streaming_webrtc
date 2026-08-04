#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[[ -f "$PROJECT_ROOT/viewer.env" ]] && source "$PROJECT_ROOT/viewer.env"

ISAAC_ROOT="${ISAAC_ROOT:-$HOME/isaacsim}"
ISAAC_HOST="${ISAAC_HOST:-127.0.0.1}"
ACTIVE_GPU="${ACTIVE_GPU:-0}"
SIGNAL_PORT="${SIGNAL_PORT:-49100}"
STREAM_PORT="${STREAM_PORT:-47998}"
VIEWER_EXPERIENCE="${VIEWER_EXPERIENCE:-ov.web.viewer.6.0.minimal.kit}"
KIT_BIN="$ISAAC_ROOT/kit/kit"
EXPERIENCE="$PROJECT_ROOT/kit/apps/$VIEWER_EXPERIENCE"

[[ -x "$KIT_BIN" ]] || { echo "ERROR: Kit not found: $KIT_BIN" >&2; exit 1; }
[[ -f "$EXPERIENCE" ]] || { echo "ERROR: Experience not found: $EXPERIENCE" >&2; exit 1; }

extension_args=(--ext-folder "$PROJECT_ROOT/kit/exts")
for folder in apps exts extscache extsUser extsDeprecated; do
    [[ -d "$ISAAC_ROOT/$folder" ]] && extension_args+=(--ext-folder "$ISAAC_ROOT/$folder")
done

echo "Starting $VIEWER_EXPERIENCE from $ISAAC_ROOT"
exec "$KIT_BIN" "$EXPERIENCE" --no-window \
    "${extension_args[@]}" \
    --/renderer/activeGpu="$ACTIVE_GPU" \
    --/exts/omni.kit.livestream.app/primaryStream/publicIp="$ISAAC_HOST" \
    --/exts/omni.kit.livestream.app/primaryStream/signalPort="$SIGNAL_PORT" \
    --/exts/omni.kit.livestream.app/primaryStream/streamPort="$STREAM_PORT" \
    --/log/flushStandardStreamOutput=1 \
    "$@"
