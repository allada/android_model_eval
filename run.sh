#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR_EARLY="$(cd "$(dirname "$0")" && pwd)"
export CODEX_BIN="${CODEX_BIN:-$SCRIPT_DIR_EARLY/node_modules/.bin/codex}"
export CLAUDE_BIN="${CLAUDE_BIN:-$SCRIPT_DIR_EARLY/node_modules/.bin/claude}"
export GEMINI_BIN="${GEMINI_BIN:-$SCRIPT_DIR_EARLY/node_modules/.bin/gemini}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# INSTANCES defaults to the number of running emulators (set below).
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

# Find all connected ADB devices (emulators, Redroid instances, etc.)
ADB_DEVICES=$(adb devices | grep -E '\s+device$' | awk '{print $1}' | paste -sd, -)
if [ -z "$ADB_DEVICES" ]; then
  echo "No ADB devices found. Start Redroid or an emulator first."
  exit 1
fi
DEVICE_COUNT=$(echo "$ADB_DEVICES" | tr ',' '\n' | wc -l)
INSTANCES=${INSTANCES:-$DEVICE_COUNT}
echo "Devices: $ADB_DEVICES ($DEVICE_COUNT)"
echo "Instances: $INSTANCES"

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
  sleep 1
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
