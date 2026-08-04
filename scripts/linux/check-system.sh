#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[[ -f "$PROJECT_ROOT/viewer.env" ]] && source "$PROJECT_ROOT/viewer.env"
ISAAC_ROOT="${ISAAC_ROOT:-$HOME/isaacsim}"
failed=0

for command_name in nvidia-smi python3; do
    if command -v "$command_name" >/dev/null 2>&1; then
        echo "OK: $command_name found"
    else
        echo "ERROR: $command_name not found"
        failed=1
    fi
done

if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=index,name,driver_version,memory.total,display_active --format=csv,noheader
fi

if [[ -x "$ISAAC_ROOT/kit/kit" ]]; then
    echo "OK: Isaac Sim Kit found at $ISAAC_ROOT/kit/kit"
else
    echo "ERROR: Isaac Sim Kit not found at $ISAAC_ROOT/kit/kit"
    failed=1
fi

if ldconfig -p 2>/dev/null | grep -q libnvidia-encode; then
    echo "OK: NVIDIA NVENC runtime found"
else
    echo "WARNING: libnvidia-encode was not found"
fi

exit "$failed"
