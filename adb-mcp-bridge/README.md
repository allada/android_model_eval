# adb-mcp-bridge

MCP server that gives LLMs access to Android emulator devices through native touch interactions. Manages a pool of emulator devices with session-based allocation and transparent snapshot swapping.

## Quick Start

```bash
bun install
ADB_DEVICES=emulator-5554 bun run src/main.ts
```

Two servers start:
- **MCP server** on `http://localhost:3000` — used by the LLM
- **Admin server** on `http://localhost:3001` — used by the test harness

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADB_DEVICES` | yes | Comma-separated emulator serials (e.g. `emulator-5554,emulator-5556`) |
| `PORT` | no | MCP server port (default: `3000`) |
| `ADMIN_PORT` | no | Admin server port (default: `3001`) |

## Admin API (port 3001)

Used by the test harness to manage device sessions. The harness creates a session, gives the `deviceSessionId` to the LLM, and later inspects device state to score results.

### `POST /initDeviceSession`

Create a new device session. Assigns any available device.

**Response:**
```json
{
  "deviceSessionId": "uuid",
  "deviceSerial": "emulator-5554",
  "screenWidth": 1080,
  "screenHeight": 2400,
  "screenshotUrl": "http://localhost:3000/screenshot/uuid"
}
```

### `POST /runAdbCommand`

Run a raw `adb shell` command on a session's device. Useful for checking device state in test scoring.

**Body:** `{ "deviceSessionId": "uuid", "command": "settings get system screen_brightness" }`

**Response:** `{ "output": "128\n" }`

### `POST /removeDeviceSession`

Clean up a session: remove it from the pool and delete its emulator snapshot.

**Body:** `{ "deviceSessionId": "uuid" }`

**Response:** `{ "success": true }`

## MCP Tools (port 3000)

Stateless MCP endpoint used by the LLM. Device sessions are managed at the tool level, not the MCP transport level, so they survive MCP reconnects.

The test harness creates sessions via the admin API and passes the `deviceSessionId` to the LLM. The LLM then uses these tools:

### `get-device-session-info`

Get session info (screen size, screenshot URL) for an existing session.

**Input:** `{ deviceSessionId }`

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

## HTTP Endpoints (port 3000)

### `GET /screenshot/{deviceSessionId}`

Returns a live PNG screenshot of the device.

## Architecture

```
src/
  main.ts          — MCP server, admin server, screenshot endpoint
  device_pool.ts   — Session tracking, snapshot swapping
  adb_service.ts   — ADB commands via @devicefarmer/adbkit + emulator console
```

### Session Swapping

Multiple sessions can share a single emulator device. When a tool call comes in for a session that isn't the current owner of the device, the pool:

1. Saves the current owner's state as a snapshot (if dirty)
2. Loads the requesting session's snapshot (if it has one)
3. Executes the command

This is transparent to the LLM — it just uses its `deviceSessionId` and the pool handles the rest.

### Dirty Tracking

Only mutating tools (tap, swipe, long-press, key-event) mark a session as dirty. Read-only operations (screenshot, get-device-session-info) do not trigger snapshot saves on swap-out.
