import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { DevicePool } from "./device_pool.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Comma-separated emulator serials (e.g. "emulator-5554,emulator-5556").
const ADB_DEVICES = process.env.ADB_DEVICES || "";
if (!ADB_DEVICES) {
  console.error("ADB_DEVICES env var required (comma-separated emulator serials)");
  process.exit(1);
}

function createServer(pool: DevicePool): McpServer {
  const server = new McpServer({
    name: "adb-mcp-bridge",
    version: "1.0.0",
  });

  server.registerTool(
    "init-device-session",
    {
      description: "Acquire an Android device. Returns a deviceSessionId to use with all other tools, and a screenshotUrl you can fetch at any time to see the current screen.",
      outputSchema: {
        deviceSessionId: z.string(),
        deviceSerial: z.string(),
        screenWidth: z.number(),
        screenHeight: z.number(),
        screenshotUrl: z.string().describe("GET this URL to retrieve a live PNG screenshot of the device"),
      },
    },
    async () => {
      const { deviceSessionId, handle } = await pool.acquire();
      const raw = await handle.adb.getScreenSize();
      // Parses "Physical size: 1080x2400"
      const match = raw.match(/(\d+)x(\d+)/);
      const screenWidth = match ? parseInt(match[1], 10) : 0;
      const screenHeight = match ? parseInt(match[2], 10) : 0;
      const screenshotUrl = `http://localhost:${PORT}/screenshot/${deviceSessionId}`;
      const structuredContent = {
        deviceSessionId,
        deviceSerial: handle.serial,
        screenWidth,
        screenHeight,
        screenshotUrl,
      };
      return { content: [], structuredContent };
    },
  );

  server.registerTool(
    "tap",
    {
      description: "Tap a screen coordinate",
      inputSchema: {
        deviceSessionId: z.string().describe("Session ID from init-device-session"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ deviceSessionId, x, y }) => {
      const handle = pool.getHandle(deviceSessionId);
      if (!handle) throw new Error("Unknown device session. Call init-device-session first.");
      await handle.adb.tap(x, y);
      handle.dirty = true;
      return { content: [], structuredContent: { success: true } };
    },
  );

  server.registerTool(
    "swipe",
    {
      description: "Swipe from one point to another",
      inputSchema: {
        deviceSessionId: z.string().describe("Session ID from init-device-session"),
        x1: z.number().describe("Start X"),
        y1: z.number().describe("Start Y"),
        x2: z.number().describe("End X"),
        y2: z.number().describe("End Y"),
        durationMs: z.number().optional().default(300).describe("Swipe duration in milliseconds"),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ deviceSessionId, x1, y1, x2, y2, durationMs }) => {
      const handle = pool.getHandle(deviceSessionId);
      if (!handle) throw new Error("Unknown device session. Call init-device-session first.");
      await handle.adb.swipe(x1, y1, x2, y2, durationMs);
      handle.dirty = true;
      return { content: [], structuredContent: { success: true } };
    },
  );

  server.registerTool(
    "long-press",
    {
      description: "Long-press (tap and hold) at a screen coordinate",
      inputSchema: {
        deviceSessionId: z.string().describe("Session ID from init-device-session"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        durationMs: z.number().optional().default(1000).describe("Hold duration in milliseconds"),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ deviceSessionId, x, y, durationMs }) => {
      const handle = pool.getHandle(deviceSessionId);
      if (!handle) throw new Error("Unknown device session. Call init-device-session first.");
      await handle.adb.longPress(x, y, durationMs);
      handle.dirty = true;
      return { content: [], structuredContent: { success: true } };
    },
  );

  server.registerTool(
    "key-event",
    {
      description: "Press a physical button on the device",
      inputSchema: {
        deviceSessionId: z.string().describe("Session ID from init-device-session"),
        key: z.enum(["POWER", "VOLUME_UP", "VOLUME_DOWN"])
          .describe("Physical button on the device"),
      },
      outputSchema: {
        success: z.boolean(),
        keycode: z.string(),
      },
    },
    async ({ deviceSessionId, key }) => {
      const handle = pool.getHandle(deviceSessionId);
      if (!handle) throw new Error("Unknown device session. Call init-device-session first.");
      const keycode = `KEYCODE_${key}`;
      await handle.adb.keyEvent(key);
      handle.dirty = true;
      return { content: [], structuredContent: { success: true, keycode } };
    },
  );

  return server;
}

async function main() {
  const pool = new DevicePool(ADB_DEVICES.split(",").map((s) => s.trim()).filter(Boolean));

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // GET /screenshot/{deviceSessionId} — returns latest PNG screenshot.
      const screenshotMatch = url.pathname.match(/^\/screenshot\/([a-f0-9-]+)$/);
      if (screenshotMatch && req.method === "GET") {
        const handle = pool.getHandle(screenshotMatch[1]);
        if (!handle) return new Response("Unknown device session", { status: 404 });
        const png = await handle.adb.screenshot();
        return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
      }

      // Stateless MCP: fresh transport + server per request.
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createServer(pool);
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  });

  console.error(`adb-mcp-bridge listening on http://localhost:${PORT}`);
}

main();
