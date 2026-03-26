# adb-mcp-bridge

MCP server that gives LLMs access to Android emulator devices through native touch interactions. Manages a pool of emulator devices with session-based allocation and snapshot support.

## Quick Start

```bash
bun install
ADB_DEVICES=emulator-5554 bun run src/main.ts
```

The server listens on `http://localhost:3000` (override with `PORT` env var).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADB_DEVICES` | yes | Comma-separated emulator serials (e.g. `emulator-5554,emulator-5556`) |
| `PORT` | no | HTTP port (default: `3000`) |

## MCP Tools

The server exposes a stateless MCP endpoint. Device sessions are managed at the tool level, not the MCP transport level. This means sessions survive MCP reconnects.

### `init-device-session`

Must be called first. Acquires a device from the pool and returns everything needed to interact with it.

**Input:** none

**Output:**
```json
{
  "deviceSessionId": "uuid",
  "deviceSerial": "emulator-5554",
  "screenWidth": 1080,
  "screenHeight": 2400,
  "screenshotUrl": "http://localhost:3000/screenshot/uuid"
}
```

The `screenshotUrl` can be fetched at any time to get a live PNG of the device screen.

### `tap`

Tap a screen coordinate.

**Input:** `{ deviceSessionId, x, y }`

### `swipe`

Swipe from one point to another.

**Input:** `{ deviceSessionId, x1, y1, x2, y2, durationMs? }` (default 300ms)

### `long-press`

Tap and hold at a screen coordinate.

**Input:** `{ deviceSessionId, x, y, durationMs? }` (default 1000ms)

### `key-event`

Press a physical button. Only exposes the buttons available on a Pixel 8a.

**Input:** `{ deviceSessionId, key }` where key is `POWER`, `VOLUME_UP`, or `VOLUME_DOWN`

## HTTP Endpoints

### `GET /screenshot/{deviceSessionId}`

Returns a live PNG screenshot of the device. No MCP required.

### `POST /`

Stateless MCP endpoint. Each request gets a fresh MCP transport.

## Architecture

```
src/
  main.ts          — HTTP server, MCP tool registration, screenshot endpoint
  device_pool.ts   — Device allocation, session tracking, snapshot on eviction
  adb_service.ts   — ADB commands via @devicefarmer/adbkit + emulator console
```

### Device Pool

- `init-device-session` claims an idle device from the pool
- If all devices are busy, the oldest session is evicted (snapshotted if dirty)
- The `dirty` flag tracks whether any mutating tool (tap, swipe, etc.) was called
- Screenshots and reads don't mark a session as dirty

### Snapshots

When a session is evicted to make room for a new one, its state is saved as an emulator snapshot (`adb emu avd snapshot save`). Snapshots are per-AVD and cannot be transferred between devices at runtime.
