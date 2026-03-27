#!/usr/bin/env bash
set -euo pipefail

export CODEX_BIN=/home/allada/projects/eval_model/node_modules/.bin/codex
export CLAUDE_BIN=/home/allada/projects/eval_model/node_modules/.bin/claude

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTANCES=${INSTANCES:-4}
MCP_PORT=${MCP_PORT:-3000}
ADMIN_PORT=${ADMIN_PORT:-3001}
MCP_PID=""

cleanup() {
  echo "Shutting down..."
  if [ -n "$MCP_PID" ] && kill -0 "$MCP_PID" 2>/dev/null; then
    kill "$MCP_PID" 2>/dev/null
    wait "$MCP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Find all running emulators.
ADB_DEVICES=$(adb devices | grep -E 'emulator-[0-9]+\s+device' | awk '{print $1}' | paste -sd, -)
if [ -z "$ADB_DEVICES" ]; then
  echo "No running emulators found. Start at least one emulator first."
  exit 1
fi
echo "Devices: $ADB_DEVICES"

# Install dependencies if needed.
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing root dependencies..."
  (cd "$SCRIPT_DIR" && bun install)
fi
if [ ! -d "$SCRIPT_DIR/adb-mcp-bridge/node_modules" ]; then
  echo "Installing adb-mcp-bridge dependencies..."
  (cd "$SCRIPT_DIR/adb-mcp-bridge" && bun install)
fi

# Start the MCP + admin server.
echo "Starting MCP server on :$MCP_PORT (admin :$ADMIN_PORT)..."
ADB_DEVICES="$ADB_DEVICES" PORT="$MCP_PORT" ADMIN_PORT="$ADMIN_PORT" \
  bun run "$SCRIPT_DIR/adb-mcp-bridge/src/main.ts" &
MCP_PID=$!

# Wait for the MCP server to be ready.
for i in $(seq 1 30); do
  if curl -s "http://localhost:$MCP_PORT" -o /dev/null 2>/dev/null; then
    break
  fi
  sleep 0.5
done

echo "MCP server ready (pid $MCP_PID)"

# Run harness instances in parallel.
echo "Running $INSTANCES harness instance(s)..."
pids=()
for i in $(seq 1 "$INSTANCES"); do
  bun run "$SCRIPT_DIR/index.ts" \
    --mcp-url "http://localhost:$MCP_PORT" \
    --admin-url "http://localhost:$ADMIN_PORT" \
    "$@" &
  pids+=($!)
done

# Wait for all harness instances and track failures.
failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=$((failed + 1))
  fi
done

if [ "$failed" -gt 0 ]; then
  echo "$failed/$INSTANCES instance(s) had failures"
  exit 1
fi

echo "All $INSTANCES instance(s) completed successfully"
