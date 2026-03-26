# eval_model — Android LLM Interaction Benchmark

Evaluate how well LLMs can operate an Android device using only native human interactions: tap, swipe, long-press, and physical buttons. The LLM receives screenshots via HTTP and issues touch/navigation commands through MCP tools — nothing more than a human could do.

## Architecture

```
┌─────────────┐       MCP tools        ┌─────────────────┐       adb        ┌──────────────┐
│     LLM     │◄──────────────────────►│  adb-mcp-bridge │◄───────────────►│   Android    │
│             │                         │  (Bun / TS)     │  adbkit + emu   │   Emulator   │
│             │◄── GET /screenshot ────│                 │◄── screencap ──│              │
└─────────────┘                         └─────────────────┘                  └──────────────┘
```

### Components

**1. MCP Server (`adb-mcp-bridge/`)**

Two servers: an MCP server (port 3000) for the LLM, and an admin server (port 3001) for the test harness.

*Admin API (harness use):*
| Endpoint | Description |
|----------|-------------|
| `POST /initDeviceSession` | Create a session, assign a device |
| `POST /runAdbCommand` | Run raw adb shell command for scoring |
| `POST /removeDeviceSession` | Clean up session + snapshot |

*MCP Tools (LLM use):*
| Tool | Description |
|------|-------------|
| `get-device-session-info` | Get screen size + screenshot URL for a session |
| `tap` | Tap a screen coordinate |
| `swipe` | Swipe between two points |
| `long-press` | Tap and hold |
| `key-event` | Press a physical button (POWER, VOLUME_UP, VOLUME_DOWN) |

Screenshots are served via `GET /screenshot/{deviceSessionId}` — the LLM fetches this URL directly.

**2. Eval Harness**

Drives the evaluation loop:

1. Harness calls admin API `POST /initDeviceSession` to create a session
2. Harness gives the `deviceSessionId` and task prompt to the LLM
3. The LLM fetches screenshots and calls MCP tools to interact with the device
4. The LLM either continues acting or declares the task complete
5. Harness calls `POST /runAdbCommand` to check device state and score the result
6. Harness calls `POST /removeDeviceSession` to clean up

**3. Scoring**

Determine success by checking device state after the LLM finishes (e.g. query settings via adb, take a final screenshot for manual review, or use a verifier LLM).

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) with TypeScript
- **Device control**: [adbkit](https://github.com/DeviceFarmer/adbkit) (ADB TCP protocol) + emulator console
- **Protocol**: [Model Context Protocol (MCP)](https://modelcontextprotocol.io) via `@modelcontextprotocol/sdk`
- **Emulator**: Android Emulator (Pixel 8a, API 36)

## Prerequisites

- Android SDK with `adb` (available via `nix develop` or at `~/Android/Sdk/platform-tools/adb`)
- Running Android emulator (`adb devices` should list a connected device)
- Bun runtime
- Nix (optional, for reproducible dev shell via `nix develop`)

## Getting Started

```bash
# Install dependencies
bun install
cd adb-mcp-bridge && bun install && cd ..

# Start the MCP + admin servers
ADB_DEVICES=emulator-5554 bun run adb-mcp-bridge/src/main.ts

# Run the eval harness
bun run index.ts --provider openai --test airplane-mode-on
```

## Roadmap

- [x] Project scaffolding
- [x] MCP server with Android interaction tools
- [x] Screenshot capture via HTTP endpoint
- [x] Device pool with session management
- [x] Snapshot support for session eviction
- [ ] Eval harness (task prompt -> action loop -> completion)
- [ ] Task suite (curated set of Android tasks to evaluate)
- [ ] Scoring and reporting
