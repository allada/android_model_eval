#!/usr/bin/env bash
# Wrapper around the Android emulator that ensures orphaned QEMU child
# processes are cleaned up on exit.
#
# Bug: emulator 36.x forks a child qemu-system-x86_64 on shutdown for
# snapshot saving. The child gets stuck in a 100% CPU spin loop and is
# never reaped because the launcher only kills the parent PID.
#
# Fix: run the emulator in its own process group and kill the entire
# group on exit.
set -euo pipefail

AVD_NAME="${1:-Pixel_8a}"
shift 2>/dev/null || true

export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-/home/allada/.config/.android/avd}"

EMULATOR="/home/allada/Android/Sdk/emulator/emulator"

# NixOS: the emulator's bundled Vulkan loader doesn't know about
# /run/opengl-driver. Point it to the system's Vulkan ICD files.
ICD_DIR="/run/opengl-driver/share/vulkan/icd.d"
if [ -d "$ICD_DIR" ] && [ -z "${VK_ICD_FILENAMES:-}" ]; then
  export VK_ICD_FILENAMES
  VK_ICD_FILENAMES=$(find "$ICD_DIR" -name '*.json' -printf '%p:' | sed 's/:$//')
fi

# Start the emulator in a new process group (setsid).
setsid "$EMULATOR" -avd "$AVD_NAME" \
  -netdelay none \
  -netspeed full \
  -no-audio \
  "$@" &
EMU_PID=$!

# Find the process group ID (same as the session leader PID from setsid).
# Give it a moment to start.
sleep 1
PGID=$(ps -o pgid= -p "$EMU_PID" 2>/dev/null | tr -d ' ') || true

cleanup() {
  echo "Cleaning up emulator processes..."
  # Kill the entire process group to catch orphaned QEMU forks.
  if [ -n "$PGID" ]; then
    kill -TERM -"$PGID" 2>/dev/null || true
    sleep 2
    kill -KILL -"$PGID" 2>/dev/null || true
  fi
  # Belt-and-suspenders: kill any remaining qemu children of our session.
  if kill -0 "$EMU_PID" 2>/dev/null; then
    kill -KILL "$EMU_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait "$EMU_PID" 2>/dev/null || true

# After normal exit, clean up any lingering QEMU forks from our group.
if [ -n "$PGID" ]; then
  sleep 1
  kill -KILL -"$PGID" 2>/dev/null || true
fi
