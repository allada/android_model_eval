import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import sharp from "sharp";
import { z } from "zod";
import { DevicePool } from "./device_pool.js";
import type { AdbService } from "./adb_service.js";
import { spawn, type Subprocess } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface ActiveRecording {
  proc: Subprocess;
  videoPath: string;
  startedAtMs: number;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Comma-separated emulator serials (e.g. "emulator-5554,emulator-5556").
const ADB_DEVICES = process.env.ADB_DEVICES || "";
if (!ADB_DEVICES) {
  console.error("ADB_DEVICES env var required (comma-separated emulator serials)");
  process.exit(1);
}

const sessionInfoSchema = {
  deviceSessionId: z.string(),
  deviceSerial: z.string(),
  screenWidth: z.number(),
  screenHeight: z.number(),
  screenshotUrl: z.string().describe(
    "GET this URL to retrieve a live PNG screenshot. Supports optional query params: x, y, width, height (crop region, width/height max 500px) and scale (0.0-1.0, applied after crop)."
  ),
  timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds when this request was handled"),
};

async function buildSessionInfo(deviceSessionId: string, serial: string, adb: AdbService, timestamp_ms: number) {
  const rawScreenSize = await adb.getScreenSize();
  const match = rawScreenSize.match(/(\d+)x(\d+)/);
  return {
    deviceSessionId,
    deviceSerial: serial,
    screenWidth: match ? parseInt(match[1], 10) : 0,
    screenHeight: match ? parseInt(match[2], 10) : 0,
    screenshotUrl: `http://localhost:${PORT}/screenshot/${deviceSessionId}`,
    timestamp_ms,
  };
}

function createServer(pool: DevicePool): McpServer {
  const server = new McpServer({
    name: "adb-mcp-bridge",
    version: "1.0.0",
  });

  // TODO(allada) For testing the MCP does not call this our test harness calls this
  // then then feeds the deviceSessionId to the model manually. We need to do it this
  // way because the test harness needs to prepare the session that model is going to
  // use and then read out state from that session later to know if it passed or not.
  // I left this in here because if we want to play around manually with an LLM we need
  // to give the LLM access to this API call.
  //
  // server.registerTool(
  //   "init-device-session",
  //   {
  //     description: "Acquire an Android device. Returns a deviceSessionId to use with all other tools, and a screenshotUrl you can fetch at any time to see the current screen.",
  //     inputSchema: {
  //       deviceSerial: z.string().describe("Emulator serial to use (e.g. emulator-5554)"),
  //     },
  //     outputSchema: sessionInfoSchema,
  //   },
  //   async ({ deviceSerial }) => {
  //     const { deviceSessionId, handle } = pool.initializeSession(deviceSerial);
  //     const structuredContent = await buildSessionInfo(deviceSessionId, handle.serial);
  //     return { content: [], structuredContent };
  //   },
  // );

  server.registerTool(
    "get-device-session-info",
    {
      description: "Get session info for an existing device session.",
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
      },
      outputSchema: sessionInfoSchema,
    },
    async ({ deviceSessionId }) => {
      const structuredContent = await pool.withSession(deviceSessionId, (handle) =>
        buildSessionInfo(deviceSessionId, handle.serial, handle.adb, Date.now()),
      );
      return { content: [], structuredContent };
    },
  );

  server.registerTool(
    "screenshot",
    {
      description: [
        "Capture a region of the screen as a PNG image. Two-step process:",
        "1) CROP: Extract the rectangle from (x, y) to (x+width, y+height) in device pixels.",
        "2) SCALE: Resize the cropped image by the scale factor.",
        "The returned image dimensions are (width*scale) x (height*scale) pixels.",
        "Example: x=0, y=0, width=512, height=512, scale=0.5 → crops a 512x512 region, then scales to 256x256px.",
        "Example: x=100, y=200, width=400, height=400, scale=0.25 → crops 400x400 at (100,200), then scales to 100x100px.",
        "Use small scale values (0.25) for overview, larger (0.5-1.0) for reading text or fine details.",
      ].join(" "),
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
        x: z.number().describe("Left edge of crop region in device pixels. 0 = left edge of screen."),
        y: z.number().describe("Top edge of crop region in device pixels. 0 = top of screen."),
        width: z.number().max(512).describe("Width of crop region in device pixels. Max 512. The crop covers x to x+width."),
        height: z.number().max(512).describe("Height of crop region in device pixels. Max 512. The crop covers y to y+height."),
        scale: z.number().optional().default(0.25).describe("Downscale factor applied AFTER cropping. 0.25 = quarter size (default), 0.5 = half size, 1.0 = original crop size. Output image is (width*scale) x (height*scale) pixels."),
      },
    },
    async ({ deviceSessionId, x, y, width, height, scale }) => {
      let timestamp_ms: number;
      let png: Buffer = await pool.withSession(deviceSessionId, (handle) => {
        timestamp_ms = Date.now();
        return handle.adb.screenshot();
      });

      const hasCrop = x != null && y != null && width != null && height != null;
      const hasScale = scale != null;

      if (hasCrop || hasScale) {
        let pipeline = sharp(png);

        if (hasCrop) {
          pipeline = pipeline.extract({
            left: Math.round(x!),
            top: Math.round(y!),
            width: Math.round(width!),
            height: Math.round(height!),
          });
        }

        if (hasScale && scale! < 1.0) {
          const srcWidth = hasCrop ? width! : (await sharp(png).metadata()).width!;
          pipeline = pipeline.resize({
            width: Math.round(srcWidth * scale!),
            withoutEnlargement: true,
          });
        }

        png = await pipeline.png().toBuffer();
      }

      return {
        content: [
          { type: "text", text: JSON.stringify({ timestamp_ms: timestamp_ms! }) },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  server.registerTool(
    "sleep",
    {
      description: "Wait for a specified duration. Useful to let UI animations finish or delayed actions to complete before taking a screenshot. Start with 50ms and increase only if needed.",
      inputSchema: {
        durationMs: z.number().max(25).optional().default(10).describe("Duration to wait in milliseconds (default 10, max 25)"),
      },
      outputSchema: {
        success: z.boolean(),
        timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds"),
      },
    },
    async ({ durationMs }) => {
      const timestamp_ms = Date.now();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return { content: [], structuredContent: { success: true, timestamp_ms } };
    },
  );

  server.registerTool(
    "tap",
    {
      description: "Tap a screen coordinate",
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      },
      outputSchema: {
        success: z.boolean(),
        timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds"),
      },
    },
    async ({ deviceSessionId, x, y }) => {
      const timestamp_ms = await pool.withSession(deviceSessionId, async (handle) => {
        const ts = Date.now();
        await handle.adb.tap(x, y);
        return ts;
      });
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true, timestamp_ms } };
    },
  );

  server.registerTool(
    "swipe",
    {
      description: "Swipe from one point to another",
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
        x1: z.number().describe("Start X"),
        y1: z.number().describe("Start Y"),
        x2: z.number().describe("End X"),
        y2: z.number().describe("End Y"),
        durationMs: z.number().optional().default(300).describe("Swipe duration in milliseconds"),
      },
      outputSchema: {
        success: z.boolean(),
        timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds"),
      },
    },
    async ({ deviceSessionId, x1, y1, x2, y2, durationMs }) => {
      const timestamp_ms = await pool.withSession(deviceSessionId, async (handle) => {
        const ts = Date.now();
        await handle.adb.swipe(x1, y1, x2, y2, durationMs);
        return ts;
      });
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true, timestamp_ms } };
    },
  );

  server.registerTool(
    "long-press",
    {
      description: "Long-press (tap and hold) at a screen coordinate",
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        durationMs: z.number().optional().default(1000).describe("Hold duration in milliseconds"),
      },
      outputSchema: {
        success: z.boolean(),
        timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds"),
      },
    },
    async ({ deviceSessionId, x, y, durationMs }) => {
      const timestamp_ms = await pool.withSession(deviceSessionId, async (handle) => {
        const ts = Date.now();
        await handle.adb.longPress(x, y, durationMs);
        return ts;
      });
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true, timestamp_ms } };
    },
  );

  server.registerTool(
    "key-event",
    {
      description: "Press a physical button on the device",
      inputSchema: {
        deviceSessionId: z.string().describe("Device Session ID"),
        key: z.enum(["POWER", "VOLUME_UP", "VOLUME_DOWN"])
          .describe("Physical button on the device"),
      },
      outputSchema: {
        success: z.boolean(),
        keycode: z.string(),
        timestamp_ms: z.number().describe("Server-side epoch timestamp in milliseconds"),
      },
    },
    async ({ deviceSessionId, key }) => {
      const keycode = `KEYCODE_${key}`;
      const timestamp_ms = await pool.withSession(deviceSessionId, async (handle) => {
        const ts = Date.now();
        await handle.adb.keyEvent(key);
        return ts;
      });
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true, keycode, timestamp_ms } };
    },
  );

  return server;
}

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? "3001", 10);

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

// Active screen recordings keyed by deviceSessionId.
const activeRecordings = new Map<string, ActiveRecording>();

async function startRecording(pool: DevicePool, deviceSessionId: string, outputPath: string): Promise<{ startedAtMs: number }> {
  if (activeRecordings.has(deviceSessionId)) {
    throw new Error(`Recording already active for session ${deviceSessionId}`);
  }

  const serial = pool.getSessionSerial(deviceSessionId);
  mkdirSync(dirname(outputPath), { recursive: true });

  // Use stdbuf to force line-buffered stdout — scrcpy block-buffers when piped,
  // which prevents us from detecting "Recording started" until exit.
  const proc = spawn(
    ["stdbuf", "-oL", "scrcpy", `--serial=${serial}`, `--record=${outputPath}`, "--no-window", "--no-playback", "--video-codec=h264"],
    { stdout: "pipe", stderr: "pipe" },
  );

  // Wait for scrcpy to confirm recording has started by watching stdout.
  // Note: scrcpy prints "INFO: Recording started ..." to stdout, not stderr.
  const startedAtMs = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("scrcpy did not start recording within 30s"));
    }, 30_000);

    // Drain stderr in the background so the pipe doesn't block.
    (async () => {
      const errReader = proc.stderr.getReader();
      while (true) {
        const { done, value } = await errReader.read();
        if (done) break;
        console.error(`[scrcpy:${deviceSessionId}] ${new TextDecoder().decode(value).trimEnd()}`);
      }
    })();

    const reader = proc.stdout.getReader();
    let accumulated = "";

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          clearTimeout(timeout);
          reject(new Error(`scrcpy exited before recording started. stdout: ${accumulated}`));
          return;
        }
        const chunk = new TextDecoder().decode(value);
        accumulated += chunk;
        console.error(`[scrcpy:${deviceSessionId}] ${chunk.trimEnd()}`);

        if (accumulated.includes("Recording started")) {
          clearTimeout(timeout);
          resolve(Date.now());
        } else {
          read();
        }
      }, (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    }
    read();
  });

  activeRecordings.set(deviceSessionId, { proc, videoPath: outputPath, startedAtMs });
  console.error(`Recording started for session ${deviceSessionId} → ${outputPath} (startedAtMs=${startedAtMs})`);
  return { startedAtMs };
}

async function stopRecording(deviceSessionId: string): Promise<{ stoppedAtMs: number }> {
  const recording = activeRecordings.get(deviceSessionId);
  if (!recording) {
    throw new Error(`No active recording for session ${deviceSessionId}`);
  }

  // SIGINT causes scrcpy to flush and close the MKV container cleanly.
  recording.proc.kill("SIGINT");

  // Wait for process exit with timeout.
  const exitPromise = recording.proc.exited;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("scrcpy did not exit within 10s")), 10_000),
  );

  try {
    await Promise.race([exitPromise, timeoutPromise]);
  } catch {
    console.error(`Force-killing scrcpy for session ${deviceSessionId}`);
    recording.proc.kill("SIGKILL");
    await recording.proc.exited;
  }

  activeRecordings.delete(deviceSessionId);
  const stoppedAtMs = Date.now();
  console.error(`Recording stopped for session ${deviceSessionId} (stoppedAtMs=${stoppedAtMs})`);
  return { stoppedAtMs };
}

async function main() {
  const pool = new DevicePool(ADB_DEVICES.split(",").map((s) => s.trim()).filter(Boolean));

  // MCP server (port 3000) — used by the LLM.
  Bun.serve({
    port: PORT,
    idleTimeout: 120, // Snapshot swaps can take a while.
    async fetch(req) {
      const url = new URL(req.url);

      // GET /screenshot/{deviceSessionId}?x=&y=&width=&height=&scale= — returns PNG screenshot.
      const screenshotMatch = url.pathname.match(/^\/screenshot\/([a-f0-9-]+)$/);
      if (screenshotMatch && req.method === "GET") {
        try {
          let png: Buffer = await pool.withSession(screenshotMatch[1], (handle) => handle.adb.screenshot());

          const x = url.searchParams.has("x") ? Number(url.searchParams.get("x")) : null;
          const y = url.searchParams.has("y") ? Number(url.searchParams.get("y")) : null;
          const width = url.searchParams.has("width") ? Number(url.searchParams.get("width")) : null;
          const height = url.searchParams.has("height") ? Number(url.searchParams.get("height")) : null;
          const scale = url.searchParams.has("scale") ? Number(url.searchParams.get("scale")) : null;

          const hasCrop = x !== null && y !== null && width !== null && height !== null;
          const hasScale = scale !== null;

          if (hasCrop || hasScale) {
            if (hasCrop) {
              if (isNaN(x!) || isNaN(y!) || isNaN(width!) || isNaN(height!) || x! < 0 || y! < 0 || width! <= 0 || height! <= 0 || width! > 500 || height! > 500) {
                return new Response("Invalid crop: need x >= 0, y >= 0, 0 < width <= 500, 0 < height <= 500", { status: 400 });
              }
            }
            if (hasScale) {
              if (isNaN(scale!) || scale! <= 0 || scale! > 1.0) {
                return new Response("Invalid scale: must be between 0.0 (exclusive) and 1.0", { status: 400 });
              }
            }

            let pipeline = sharp(png);

            if (hasCrop) {
              pipeline = pipeline.extract({
                left: Math.round(x!),
                top: Math.round(y!),
                width: Math.round(width!),
                height: Math.round(height!),
              });
            }

            if (hasScale && scale! < 1.0) {
              const srcWidth = hasCrop ? width! : (await sharp(png).metadata()).width!;
              pipeline = pipeline.resize({
                width: Math.round(srcWidth * scale!),
                withoutEnlargement: true,
              });
            }

            png = await pipeline.png().toBuffer();
          }

          return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
        } catch (err: any) {
          if (err.message?.includes("Unknown device session")) {
            return new Response("Unknown device session", { status: 404 });
          }
          return new Response(`Screenshot error: ${err.message}`, { status: 500 });
        }
      }

      // Stateless MCP: fresh transport + server per request.
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createServer(pool);
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  });

  // Admin server (port 3001) — used by the test harness.
  Bun.serve({
    port: ADMIN_PORT,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);

      try {
        switch (url.pathname) {
          case "/initDeviceSession": {
            const { deviceSessionId, handle } = pool.initializeSession();
            const info = await buildSessionInfo(deviceSessionId, handle.serial, handle.adb, Date.now());
            return jsonResponse(info);
          }
          case "/runAdbCommand": {
            const body = await req.json() as { deviceSessionId: string; command: string };
            if (!body.deviceSessionId || !body.command) {
              return jsonResponse({ error: "deviceSessionId and command required" }, 400);
            }
            const output = await pool.withSession(body.deviceSessionId, (handle) =>
              handle.adb.shell(body.command),
            );
            pool.markDirty(body.deviceSessionId);
            return jsonResponse({ output });
          }
          case "/downloadFile": {
            const body = await req.json() as { deviceSessionId: string; url: string; destPath: string };
            if (!body.deviceSessionId || !body.url || !body.destPath) {
              return jsonResponse({ error: "deviceSessionId, url, and destPath required" }, 400);
            }
            // Download to a temp file on the host, then adb push to device.
            const tmpPath = `/tmp/dl-${Date.now()}`;
            const curlProc = Bun.spawn(["curl", "-fsSL", "-o", tmpPath, body.url], {
              stdout: "pipe",
              stderr: "pipe",
            });
            const curlExit = await curlProc.exited;
            if (curlExit !== 0) {
              const stderr = await new Response(curlProc.stderr).text();
              throw new Error(`Failed to download ${body.url}: ${stderr.trim()}`);
            }
            try {
              await pool.withSession(body.deviceSessionId, (handle) =>
                handle.adb.pushFile(tmpPath, body.destPath),
              );
            } finally {
              try { (await import("node:fs")).unlinkSync(tmpPath); } catch {}
            }
            return jsonResponse({ success: true });
          }
          case "/runEmuCommand": {
            const body = await req.json() as { deviceSessionId: string; command: string };
            if (!body.deviceSessionId || !body.command) {
              return jsonResponse({ error: "deviceSessionId and command required" }, 400);
            }
            const output = await pool.withSession(body.deviceSessionId, (handle) =>
              handle.adb.emuCommand(body.command),
            );
            return jsonResponse({ output });
          }
          case "/loadSnapshot": {
            const body = await req.json() as { deviceSessionId: string; name: string };
            if (!body.deviceSessionId || !body.name) {
              return jsonResponse({ error: "deviceSessionId and name required" }, 400);
            }
            await pool.withSession(body.deviceSessionId, (handle) =>
              handle.adb.loadSnapshot(body.name),
            );
            return jsonResponse({ success: true });
          }
          case "/startRecording": {
            const body = await req.json() as { deviceSessionId: string; outputPath: string };
            if (!body.deviceSessionId || !body.outputPath) {
              return jsonResponse({ error: "deviceSessionId and outputPath required" }, 400);
            }
            const recordResult = await startRecording(pool, body.deviceSessionId, body.outputPath);
            return jsonResponse(recordResult);
          }
          case "/stopRecording": {
            const body = await req.json() as { deviceSessionId: string };
            if (!body.deviceSessionId) {
              return jsonResponse({ error: "deviceSessionId required" }, 400);
            }
            const stopResult = await stopRecording(body.deviceSessionId);
            return jsonResponse(stopResult);
          }
          case "/removeDeviceSession": {
            const body = await req.json() as { deviceSessionId: string };
            if (!body.deviceSessionId) {
              return jsonResponse({ error: "deviceSessionId required" }, 400);
            }
            // Auto-stop recording if active.
            if (activeRecordings.has(body.deviceSessionId)) {
              try { await stopRecording(body.deviceSessionId); } catch {}
            }
            await pool.removeSession(body.deviceSessionId);
            return jsonResponse({ success: true });
          }
          default:
            return jsonResponse({ error: "Not found" }, 404);
        }
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 500);
      }
    },
  });

  console.error(`adb-mcp-bridge listening on http://localhost:${PORT} (MCP), http://localhost:${ADMIN_PORT} (admin)`);
}

main();
