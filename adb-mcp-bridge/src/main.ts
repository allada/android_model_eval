import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { DevicePool } from "./device_pool.js";
import type { AdbService } from "./adb_service.js";

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
  screenshotUrl: z.string().describe("GET this URL to retrieve a live PNG screenshot of the device"),
};

async function buildSessionInfo(deviceSessionId: string, serial: string, adb: AdbService) {
  const rawScreenSize = await adb.getScreenSize();
  const match = rawScreenSize.match(/(\d+)x(\d+)/);
  return {
    deviceSessionId,
    deviceSerial: serial,
    screenWidth: match ? parseInt(match[1], 10) : 0,
    screenHeight: match ? parseInt(match[2], 10) : 0,
    screenshotUrl: `http://localhost:${PORT}/screenshot/${deviceSessionId}`,
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
      const serial = pool.getSessionSerial(deviceSessionId);
      const handle = await pool.ensureSession(deviceSessionId);
      const structuredContent = await buildSessionInfo(deviceSessionId, handle.serial, handle.adb);
      return { content: [], structuredContent };
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
      },
    },
    async ({ deviceSessionId, x, y }) => {
      const handle = await pool.ensureSession(deviceSessionId);
      await handle.adb.tap(x, y);
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true } };
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
      },
    },
    async ({ deviceSessionId, x1, y1, x2, y2, durationMs }) => {
      const handle = await pool.ensureSession(deviceSessionId);
      await handle.adb.swipe(x1, y1, x2, y2, durationMs);
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true } };
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
      },
    },
    async ({ deviceSessionId, x, y, durationMs }) => {
      const handle = await pool.ensureSession(deviceSessionId);
      await handle.adb.longPress(x, y, durationMs);
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true } };
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
      },
    },
    async ({ deviceSessionId, key }) => {
      const handle = await pool.ensureSession(deviceSessionId);
      const keycode = `KEYCODE_${key}`;
      await handle.adb.keyEvent(key);
      pool.markDirty(deviceSessionId);
      return { content: [], structuredContent: { success: true, keycode } };
    },
  );

  return server;
}

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? "3001", 10);

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function main() {
  const pool = new DevicePool(ADB_DEVICES.split(",").map((s) => s.trim()).filter(Boolean));

  // MCP server (port 3000) — used by the LLM.
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // GET /screenshot/{deviceSessionId} — returns latest PNG screenshot.
      const screenshotMatch = url.pathname.match(/^\/screenshot\/([a-f0-9-]+)$/);
      if (screenshotMatch && req.method === "GET") {
        try {
          const handle = await pool.ensureSession(screenshotMatch[1]);
          const png = await handle.adb.screenshot();
          return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
        } catch {
          return new Response("Unknown device session", { status: 404 });
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
    async fetch(req) {
      const url = new URL(req.url);

      try {
        switch (url.pathname) {
          case "/initDeviceSession": {
            const { deviceSessionId, handle } = pool.initializeSession();
            const info = await buildSessionInfo(deviceSessionId, handle.serial, handle.adb);
            return jsonResponse(info);
          }
          case "/runAdbCommand": {
            const body = await req.json() as { deviceSessionId: string; command: string };
            if (!body.deviceSessionId || !body.command) {
              return jsonResponse({ error: "deviceSessionId and command required" }, 400);
            }
            const handle = await pool.ensureSession(body.deviceSessionId);
            const output = await handle.adb.shell(body.command);
            pool.markDirty(body.deviceSessionId);
            return jsonResponse({ output });
          }
          case "/removeDeviceSession": {
            const body = await req.json() as { deviceSessionId: string };
            if (!body.deviceSessionId) {
              return jsonResponse({ error: "deviceSessionId required" }, 400);
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
