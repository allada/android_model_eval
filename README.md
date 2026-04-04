# eval_model — Android LLM Interaction Benchmark

Evaluate how well LLMs can operate an Android device using only native human interactions: tap, swipe, long-press, and physical buttons. The LLM receives screenshots via HTTP and issues touch/navigation commands through [MCP](https://modelcontextprotocol.io) tools — nothing more than a human could do.

## Architecture

```
┌─────────────┐       MCP tools        ┌─────────────────┐       adb        ┌──────────────┐
│     LLM     │◄──────────────────────►│  adb-mcp-bridge │◄───────────────►│   Android    │
│  (any model)│                         │  (Bun / TS)     │  adbkit + emu   │   Emulator   │
│             │◄── GET /screenshot ────│                 │◄── screencap ──│              │
└─────────────┘                         └─────────────────┘                  └──────────────┘
       ▲                                        ▲
       │ invokes                                │ controls
┌──────┴──────────────────────────────────────────┘
│  Eval Harness (runner.ts + admin_client.ts)
│  - creates device sessions, gives LLM a task prompt
│  - LLM acts autonomously (screenshots + MCP tools)
│  - verifies device state via ADB shell commands
│  - reports pass/fail with timing, tokens, and video
└──────────────────────────────────────────────────
```

### Components

**1. adb-mcp-bridge** — Two servers in one process:

- **MCP server** (port 3000): Exposes tools to the LLM.

  | Tool | Description |
  |------|-------------|
  | `get-device-session-info` | Screen dimensions + screenshot URL |
  | `tap` | Tap a screen coordinate |
  | `swipe` | Swipe between two points |
  | `long-press` | Tap and hold |
  | `key-event` | Physical button press (HOME, BACK, etc.) |

  Screenshots are served via `GET /screenshot/{deviceSessionId}`.

- **Admin API** (port 3001): REST endpoints for the harness to manage test lifecycle.

  | Endpoint | Description |
  |----------|-------------|
  | `POST /initDeviceSession` | Create a session, assign a device |
  | `POST /runAdbCommand` | Run arbitrary adb shell command (for verification) |
  | `POST /downloadFile` | Download a file and push to device |
  | `POST /loadSnapshot` | Restore emulator snapshot |
  | `POST /runEmuCommand` | Send emulator console command |
  | `POST /startRecording` | Begin screen recording |
  | `POST /stopRecording` | End screen recording |
  | `POST /removeDeviceSession` | Clean up session and snapshot |

**2. Eval Harness** — Orchestrates the full test lifecycle:

1. Creates a device session via the admin API
2. Runs test-specific setup (e.g., install an app, toggle a setting)
3. Hands the LLM a task prompt + `deviceSessionId`
4. The LLM acts autonomously — fetches screenshots, calls MCP tools
5. When the LLM declares the task complete, the harness verifies device state via ADB
6. Reports pass/fail with timing, token counts, and a video recording

**3. LLM Providers** — Pluggable adapters for:

- **Claude** (`--provider claude`) — wraps the `claude` CLI
- **OpenAI Codex** (`--provider codex`) — wraps the `codex` CLI
- **Google Gemini** (`--provider gemini`) — wraps the `gemini` CLI

Each provider translates the vendor's output format into a common event stream (tool calls, messages, usage stats).

## Test Suite

| Test ID | Description | Setup | Verification | Timeout |
|---------|------------|-------|--------------|---------|
| `airplane-mode-on` | Turn on airplane mode | Disables airplane mode | `settings get global airplane_mode_on` = `1` | 90s |
| `airplane-mode-off` | Turn off airplane mode | Enables airplane mode | `settings get global airplane_mode_on` = `0` | 90s |
| `set-alarm-5pm` | Set an alarm for 5:00 PM | Force-stops Clock app | `dumpsys alarm` output contains `17:00` | 120s |
| `uninstall-app` | Uninstall Firefox Focus | Downloads and installs the APK | `pm list packages` does not contain `org.mozilla.focus` | 120s |

A `verification-code` test (read a 6-digit code from an SMS notification) exists but is currently disabled.

### Scoring

All scoring is **binary pass/fail** — no partial credit. Verification queries actual device state via ADB shell commands after the LLM finishes. Reusable helpers in `harness/verification/checks.ts`:

- `settingEquals(namespace, key, expected)` — check Android settings
- `packageInstalled(packageName, shouldExist)` — check installed packages
- `shellMatches(name, command, pattern)` — run shell command and test with regex

## Device Management

The `DevicePool` manages multiple emulators concurrently:

- Each test session gets its own emulator snapshot (`mcp-session-{id}`)
- When a device is shared across sessions, state is saved/restored via snapshot swap
- This prevents state leakage between tests
- Sessions are cleaned up (snapshot deleted) when the test completes

## Prerequisites

- [Bun](https://bun.sh) runtime
- Android SDK with `adb` on PATH
- A running Android emulator (`adb devices` should list a connected device)
- [scrcpy](https://github.com/Genymobile/scrcpy) (for screen recording)
- [ffmpeg](https://ffmpeg.org/) (for video conversion)

**Using Nix** (optional): `nix develop` provides all system dependencies automatically (adb, scrcpy, ffmpeg, graphics libraries for the emulator).

## Getting Started

```bash
# Install dependencies
bun install
cd adb-mcp-bridge && bun install && cd ..

# Start an emulator (if not already running)
scripts/start-emulator.sh Pixel_8a -no-audio

# Option A: All-in-one (starts MCP server + runs harness)
./run.sh --provider claude --model claude-opus-4-6 --effort low --timeout 600000

# Option B: Start components separately
# Terminal 1 — MCP + Admin servers
ADB_DEVICES=emulator-5554 bun run adb-mcp-bridge/src/main.ts

# Terminal 2 — Eval harness
bun run index.ts --provider claude --model claude-opus-4-6 --effort low
```

`run.sh` auto-detects connected emulators, starts the MCP server, and launches one harness instance per device.

## CLI Options

```
bun run index.ts [options]

  --provider <name>    LLM provider: codex, claude, gemini       (default: codex)
  --model <model>      Model name/ID override
  --mcp-url <url>      MCP server URL                            (default: http://localhost:3000)
  --admin-url <url>    Admin API URL                              (default: http://localhost:3001)
  --effort <level>     Reasoning effort: low, medium, high, max
  --test <id>          Run only this test (e.g. set-alarm-5pm)
  --timeout <ms>       Per-test timeout in milliseconds
  -h, --help           Show help
```

## Widget & Visualization

The `widget/` directory contains web-based tools for exploring and sharing results:

- **`player-responsive.html`** — Interactive replay viewer. Plays back a test run with synchronized video, screenshot timeline, agent messages, and tool calls. Includes an episode picker sidebar categorized by model. Supports dark/light mode.
- **`stats.html`** — Benchmark results chart showing fail rate, duration, tokens, and cost per model. Loads data from `widget/data/stats.json` and `pricing.json`. Filterable by test. Supports dark/light mode.
- **`embed.html`** / **`player-widget.js`** — Embeddable versions of the player for blog posts (designed for Ghost.io HTML cards).
- **`svg.svg`** — Architecture diagram.

Start the dev server:

```bash
bun run widget/serve.ts
# Serves on http://localhost:8200
```

## Scripts

| Script | Purpose |
|--------|---------|
| `export-widget-data.ts` | Extract timeline events from `results/` into per-session JSON files in `widget/data/` |
| `export-stats.ts` | Aggregate results into `stats.csv` and `widget/data/stats.json` (with Wilson CIs) |
| `build-stats-embed.ts` | Generate `stats-embed.html` with inlined data for Ghost.io embedding |
| `build-db.ts` | Build a SQLite database from results for ad-hoc SQL analysis |
| `s3-upload-data.sh` | Upload gzipped widget data to S3 with proper headers |
| `convert-videos.sh` | Convert `.mkv` screen recordings to `.mp4` |
| `start-emulator.sh` | Launch an Android emulator with proper process group cleanup |

## Project Structure

```
eval_model/
├── adb-mcp-bridge/          MCP server + Admin API
│   └── src/
│       ├── main.ts              Server entry point (MCP + Admin)
│       ├── device_pool.ts       Session & snapshot management
│       └── adb_service.ts       Low-level ADB wrapper (tap, swipe, screenshot, etc.)
├── harness/                 Eval harness
│   ├── runner.ts                Test execution loop
│   ├── reporter.ts              Result formatting & JSON output
│   ├── admin_client.ts          HTTP client for the admin API
│   ├── types.ts                 Shared type definitions
│   ├── log.ts                   Logging utility
│   ├── providers/               LLM provider adapters
│   │   ├── types.ts                 Provider interface
│   │   ├── claude.ts                Anthropic Claude
│   │   ├── codex.ts                 OpenAI Codex
│   │   └── gemini.ts                Google Gemini
│   ├── tests/                   Test case definitions
│   │   ├── index.ts                 Test registry
│   │   ├── airplane-mode.ts         Toggle airplane mode
│   │   ├── set-alarm.ts             Set a clock alarm
│   │   ├── uninstall-app.ts         Uninstall an app
│   │   └── verification-code.ts     Read SMS code (disabled)
│   └── verification/            Reusable verification helpers
│       └── checks.ts               settingEquals, packageInstalled, shellMatches
├── widget/                  Visualization & replay
│   ├── player-responsive.html   Interactive replay viewer
│   ├── stats.html               Benchmark results chart
│   ├── embed.html               Embeddable player for blog posts
│   ├── player-widget.js         JS embedding library
│   ├── svg.svg                  Architecture diagram
│   └── serve.ts                 Static file dev server
├── scripts/                 Data processing utilities
├── index.ts                 CLI entry point
├── run.sh                   All-in-one runner (MCP server + harness)
├── Dockerfile               Container definition
└── flake.nix                Nix dev environment
```
