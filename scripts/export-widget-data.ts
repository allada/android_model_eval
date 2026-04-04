/**
 * Extracts event timeline data from result JSON files for the video player widget.
 * Reads result files directly (not the DB) to get videoPath, recordingStartedAtMs, and rawOutput.
 * Outputs one JSON file per test result into widget/data/.
 */
import { readdirSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "results");
const WIDGET_DIR = join(ROOT, "widget");
const WIDGET_DATA_DIR = join(WIDGET_DIR, "data");
const WIDGET_VIDEOS_DIR = join(WIDGET_DIR, "videos");
const WIDGET_IMAGES_DIR = join(WIDGET_DIR, "images");

interface WidgetEvent {
  type: "tap" | "swipe" | "long-press" | "key-event" | "screenshot" | "sleep" | "message" | "usage" | "tool_call";
  videoOffsetMs: number;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  scale?: number;
  durationMs?: number;
  key?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalCostUsd?: number;
  imageFile?: string;
  text?: string;
  thinking?: string;
  toolName?: string;
  toolRequest?: string;
  toolResponse?: string;
  toolResponseImageFile?: string;
}

interface WidgetData {
  testId: string;
  testName: string;
  provider: string;
  model: string;
  pass: boolean;
  screenWidth: number;
  screenHeight: number;
  recordingStartedAtMs: number;
  videoFile: string;
  events: WidgetEvent[];
}

function extractTimestampMs(resultContent: any): number | null {
  // Format 1: string like '{"success":true,"timestamp_ms":123}'
  if (typeof resultContent === "string") {
    try {
      const parsed = JSON.parse(resultContent);
      if (parsed.timestamp_ms) return parsed.timestamp_ms;
    } catch {}
    // Could also be a plain error string
    return null;
  }

  // Format 2: array like [{"type":"text","text":"{\"timestamp_ms\":123}"}, {"type":"image",...}]
  if (Array.isArray(resultContent)) {
    for (const item of resultContent) {
      if (item.type === "text" && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (parsed.timestamp_ms) return parsed.timestamp_ms;
        } catch {}
      }
    }
  }

  // Format 3: structured content object
  if (resultContent?.timestamp_ms) return resultContent.timestamp_ms;

  return null;
}

function extractBase64Image(resultContent: any): string | null {
  // Format: array like [{"type":"text",...}, {"type":"image","source":{"data":"base64..."}}]
  if (Array.isArray(resultContent)) {
    for (const item of resultContent) {
      if (item.type === "image" && item.source?.data) {
        return item.source.data;
      }
    }
  }
  return null;
}

/** Format a tool request/response as pretty JSON, stripping deviceSessionId */
function formatToolParams(params: any): string {
  if (!params) return "{}";
  const clean = { ...params };
  delete clean.deviceSessionId;
  return JSON.stringify(clean, null, 2);
}

function getToolNameShort(name: string): string {
  // "mcp__adb-mcp-bridge__tap" -> "tap"
  const parts = name.split("__");
  return parts[parts.length - 1];
}

function processClaudeRawOutput(
  rawOutput: string,
  recordingStartedAtMs: number,
  imageDir: string,
  sessionId: string,
): { events: WidgetEvent[]; screenWidth: number; screenHeight: number } {
  const lines = rawOutput.split("\n").filter(Boolean);
  const events: WidgetEvent[] = [];
  let screenWidth = 1080;
  let screenHeight = 2400;

  // Build a map of tool_use_id -> tool_use data
  const toolUseMap = new Map<string, { name: string; input: any; seq: number }>();
  // Pending text/thinking messages waiting for a timestamp
  let pendingMessages: { text?: string; thinking?: string }[] = [];
  // Track cumulative token usage across turns
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  let cumulativeThinkingTokens = 0;
  let lastSeenInputTokens = 0;  // to detect turn boundaries
  let pendingUsage: { inputTokens: number; outputTokens: number; thinkingTokens: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    let obj: any;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    // Collect text/thinking and tool_use blocks from assistant messages
    if (obj.type === "assistant" && obj.message?.content) {
      let text = "";
      let thinking = "";
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) text += block.text;
        if (block.type === "thinking" && block.thinking) thinking += block.thinking;
        if (block.type === "tool_use") {
          toolUseMap.set(block.id, {
            name: block.name,
            input: block.input,
            seq: i,
          });
        }
      }
      if (text || thinking) {
        pendingMessages.push({
          text: text || undefined,
          thinking: thinking || undefined,
        });
      }
      // Track token usage per turn (new turn = input_tokens changed)
      const usage = obj.message?.usage;
      if (usage) {
        const inp = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
        const out = usage.output_tokens || 0;
        if (inp !== lastSeenInputTokens && lastSeenInputTokens > 0) {
          // New turn boundary — commit previous turn's usage
          cumulativeInputTokens += lastSeenInputTokens;
          cumulativeOutputTokens += (pendingUsage?.outputTokens || 0);
          cumulativeThinkingTokens += (pendingUsage?.thinkingTokens || 0);
        }
        lastSeenInputTokens = inp;
        // Keep max output_tokens seen for this turn (streaming chunks increment)
        pendingUsage = {
          inputTokens: inp,
          outputTokens: Math.max(pendingUsage?.outputTokens || 0, out),
          thinkingTokens: 0,
        };
      }
    }

    // Capture final usage from result event
    if (obj.type === "result" && obj.usage) {
      const u = obj.usage;
      cumulativeInputTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      cumulativeOutputTokens = u.output_tokens || 0;
    }

    // Process tool_result blocks from user messages
    if (obj.type === "user" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const toolUse = toolUseMap.get(block.tool_use_id);
          if (!toolUse) continue;

          const shortName = getToolNameShort(toolUse.name);
          const timestampMs = extractTimestampMs(block.content);
          if (timestampMs === null) continue;

          const videoOffsetMs = timestampMs - recordingStartedAtMs;

          // Flush pending text/thinking messages with this timestamp
          for (const msg of pendingMessages) {
            events.push({
              type: "message",
              videoOffsetMs,
              text: msg.text,
              thinking: msg.thinking,
            });
          }
          pendingMessages = [];

          // Emit usage snapshot at this timestamp
          events.push({
            type: "usage",
            videoOffsetMs,
            inputTokens: cumulativeInputTokens,
            outputTokens: cumulativeOutputTokens,
            thinkingTokens: cumulativeThinkingTokens,
          });

          const input = toolUse.input;

          switch (shortName) {
            case "tap":
              events.push({
                type: "tap",
                videoOffsetMs,
                x: input.x,
                y: input.y,
              });
              break;
            case "swipe":
              events.push({
                type: "swipe",
                videoOffsetMs,
                x1: input.x1,
                y1: input.y1,
                x2: input.x2,
                y2: input.y2,
                durationMs: input.durationMs ?? 300,
              });
              break;
            case "long-press":
              events.push({
                type: "long-press",
                videoOffsetMs,
                x: input.x,
                y: input.y,
                durationMs: input.durationMs ?? 1000,
              });
              break;
            case "screenshot": {
              const base64 = extractBase64Image(block.content);
              let imageFile: string | undefined;
              if (base64) {
                const imgIdx = events.filter(e => e.type === "screenshot").length;
                const imgName = `${imgIdx}.png`;
                const imgDir = join(imageDir, sessionId);
                mkdirSync(imgDir, { recursive: true });
                writeFileSync(join(imgDir, imgName), Buffer.from(base64, "base64"));
                imageFile = `images/${sessionId}/${imgName}`;
              }
              events.push({
                type: "screenshot",
                videoOffsetMs,
                x: input.x ?? 0,
                y: input.y ?? 0,
                width: input.width,
                height: input.height,
                scale: input.scale,
                imageFile,
              });
              break;
            }
            case "key-event":
              events.push({
                type: "key-event",
                videoOffsetMs,
                key: input.key,
              });
              break;
            case "get-device-session-info": {
              // Extract screen dimensions
              const info =
                typeof block.content === "string"
                  ? JSON.parse(block.content)
                  : block.content;
              if (info.screenWidth) screenWidth = info.screenWidth;
              if (info.screenHeight) screenHeight = info.screenHeight;
              break;
            }
          }

          // Emit tool_call event with request/response for the message panel
          {
            // Format the response, replacing base64 with image reference
            let toolResponse: string;
            const lastScreenshot = events.filter(e => e.type === "screenshot").slice(-1)[0];
            if (typeof block.content === "string") {
              try {
                toolResponse = JSON.stringify(JSON.parse(block.content), null, 2);
              } catch {
                toolResponse = block.content;
              }
            } else if (Array.isArray(block.content)) {
              const cleaned = block.content.map((c: any) => {
                if (c.type === "image") return { type: "image", note: "see Agent's View" };
                if (c.type === "text") {
                  try { return JSON.parse(c.text); } catch { return c.text; }
                }
                return c;
              });
              toolResponse = JSON.stringify(cleaned.length === 1 ? cleaned[0] : cleaned, null, 2);
            } else {
              toolResponse = JSON.stringify(block.content, null, 2);
            }

            events.push({
              type: "tool_call",
              videoOffsetMs,
              toolName: shortName,
              toolRequest: formatToolParams(input),
              toolResponse,
              toolResponseImageFile: shortName === "screenshot" ? lastScreenshot?.imageFile : undefined,
            });
          }
        }
      }
    }
  }

  // Flush any remaining pending messages and final usage
  if (pendingMessages.length > 0 && events.length > 0) {
    const lastOffset = events[events.length - 1].videoOffsetMs;
    for (const msg of pendingMessages) {
      events.push({
        type: "message",
        videoOffsetMs: lastOffset,
        text: msg.text,
        thinking: msg.thinking,
      });
    }
    pendingMessages = [];
  }
  // Emit final usage snapshot
  if (events.length > 0) {
    // Commit last pending turn
    if (lastSeenInputTokens > 0 && pendingUsage) {
      cumulativeInputTokens += lastSeenInputTokens;
      cumulativeOutputTokens += pendingUsage.outputTokens;
    }
    events.push({
      type: "usage",
      videoOffsetMs: events[events.length - 1].videoOffsetMs,
      inputTokens: cumulativeInputTokens,
      outputTokens: cumulativeOutputTokens,
      thinkingTokens: cumulativeThinkingTokens,
    });
  }

  return { events, screenWidth, screenHeight };
}

function processCodexRawOutput(
  rawOutput: string,
  recordingStartedAtMs: number,
  imageDir: string,
  sessionId: string,
): { events: WidgetEvent[]; screenWidth: number; screenHeight: number } {
  const lines = rawOutput.split("\n").filter(Boolean);
  const events: WidgetEvent[] = [];
  let screenWidth = 1080;
  let screenHeight = 2400;
  let pendingMessages: { text?: string; thinking?: string }[] = [];
  let finalUsage: { inputTokens: number; outputTokens: number } | null = null;

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture final usage from turn.completed
    if (obj.type === "turn.completed" && obj.usage) {
      finalUsage = {
        inputTokens: (obj.usage.input_tokens || 0) + (obj.usage.cached_input_tokens || 0),
        outputTokens: obj.usage.output_tokens || 0,
      };
      continue;
    }

    if (obj.type !== "item.completed" || !obj.item) continue;

    // Collect agent_message and reasoning items as pending messages
    if (obj.item.type === "agent_message" && obj.item.text) {
      pendingMessages.push({ text: obj.item.text });
      continue;
    }
    if (obj.item.type === "reasoning" && (obj.item.text || obj.item.summary)) {
      pendingMessages.push({ thinking: obj.item.text || obj.item.summary });
      continue;
    }

    const { tool, arguments: args, result } = obj.item;
    if (!tool || !args) continue;

    const timestampMs =
      result?.structured_content?.timestamp_ms ??
      extractTimestampMs(result?.content);
    if (timestampMs === null) continue;

    const videoOffsetMs = timestampMs - recordingStartedAtMs;

    // Flush pending messages with this timestamp
    for (const msg of pendingMessages) {
      events.push({
        type: "message",
        videoOffsetMs,
        text: msg.text,
        thinking: msg.thinking,
      });
    }
    pendingMessages = [];

    switch (tool) {
      case "tap":
        events.push({ type: "tap", videoOffsetMs, x: args.x, y: args.y });
        break;
      case "swipe":
        events.push({
          type: "swipe",
          videoOffsetMs,
          x1: args.x1,
          y1: args.y1,
          x2: args.x2,
          y2: args.y2,
          durationMs: args.durationMs ?? 300,
        });
        break;
      case "long-press":
        events.push({
          type: "long-press",
          videoOffsetMs,
          x: args.x,
          y: args.y,
          durationMs: args.durationMs ?? 1000,
        });
        break;
      case "screenshot": {
        // Codex images in result.content[].data where type === "image"
        let base64: string | null = null;
        if (Array.isArray(result?.content)) {
          for (const c of result.content) {
            if (c.type === "image" && c.data) { base64 = c.data; break; }
          }
        }
        let imageFile: string | undefined;
        if (base64) {
          const imgIdx = events.filter(e => e.type === "screenshot").length;
          const imgName = `${imgIdx}.png`;
          const imgDir = join(imageDir, sessionId);
          mkdirSync(imgDir, { recursive: true });
          writeFileSync(join(imgDir, imgName), Buffer.from(base64, "base64"));
          imageFile = `images/${sessionId}/${imgName}`;
        }
        events.push({
          type: "screenshot",
          videoOffsetMs,
          x: args.x ?? 0,
          y: args.y ?? 0,
          width: args.width,
          height: args.height,
          scale: args.scale,
          imageFile,
        });
        break;
      }
      case "key-event":
        events.push({ type: "key-event", videoOffsetMs, key: args.key });
        break;
      case "get-device-session-info":
        if (result?.structured_content?.screenWidth) {
          screenWidth = result.structured_content.screenWidth;
          screenHeight = result.structured_content.screenHeight;
        }
        break;
    }

    // Emit tool_call event for the message panel
    {
      // Format response: strip base64 from structured_content
      let toolResponse: string;
      const sc = result?.structured_content;
      if (sc) {
        const clean = { ...sc };
        delete clean.timestamp_ms;
        toolResponse = JSON.stringify(clean, null, 2);
      } else if (Array.isArray(result?.content)) {
        const cleaned = result.content.map((c: any) => {
          if (c.type === "image") return { type: "image", note: "see Agent's View" };
          return c;
        });
        toolResponse = JSON.stringify(cleaned.length === 1 ? cleaned[0] : cleaned, null, 2);
      } else {
        toolResponse = JSON.stringify({ success: true }, null, 2);
      }

      const lastScreenshot = events.filter(e => e.type === "screenshot").slice(-1)[0];
      events.push({
        type: "tool_call",
        videoOffsetMs,
        toolName: tool,
        toolRequest: formatToolParams(args),
        toolResponse,
        toolResponseImageFile: tool === "screenshot" ? lastScreenshot?.imageFile : undefined,
      });
    }
  }

  // Flush remaining pending messages
  if (pendingMessages.length > 0 && events.length > 0) {
    const lastOffset = events[events.length - 1].videoOffsetMs;
    for (const msg of pendingMessages) {
      events.push({
        type: "message",
        videoOffsetMs: lastOffset,
        text: msg.text,
        thinking: msg.thinking,
      });
    }
  }

  // Codex only provides final usage — emit a single usage event at the start
  if (finalUsage) {
    events.push({
      type: "usage",
      videoOffsetMs: 0,
      inputTokens: finalUsage.inputTokens,
      outputTokens: finalUsage.outputTokens,
    });
  }

  return { events, screenWidth, screenHeight };
}

function processGeminiRawOutput(
  rawOutput: string,
  recordingStartedAtMs: number,
  imageDir: string,
  sessionId: string,
): { events: WidgetEvent[]; screenWidth: number; screenHeight: number } {
  const lines = rawOutput.split("\n").filter(Boolean);
  const events: WidgetEvent[] = [];
  let screenWidth = 1080;
  let screenHeight = 2400;

  // Gemini stream-json event types:
  //   tool_use:    { tool_name, tool_id, parameters, timestamp }
  //   tool_result: { tool_id, status, output, timestamp }
  //   message:     { role, content, delta, timestamp }
  //   result:      { stats: { input_tokens, output_tokens, ... } }

  // Map tool_id -> tool_use data for correlating results
  const toolUseMap = new Map<string, { name: string; params: any; timestamp: string }>();
  // Accumulate assistant message chunks
  let pendingText = "";
  let pendingTextTimestamp = "";
  // Track screenshot index for image filenames
  let screenshotIdx = 0;
  // Track whether current text block is thinking
  let isThinkingBlock = false;
  // Final usage from result event
  let finalUsage: { inputTokens: number; outputTokens: number } | null = null;

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Collect tool_use events (defer emission to tool_result for accurate timing)
    if (obj.type === "tool_use") {
      toolUseMap.set(obj.tool_id, {
        name: obj.tool_name,
        params: obj.parameters,
        timestamp: obj.timestamp,
      });
    }

    // Emit events at tool_result time — this is when the action actually happened
    if (obj.type === "tool_result") {
      const toolUse = toolUseMap.get(obj.tool_id);
      if (!toolUse) continue;
      const shortName = toolUse.name?.replace(/^mcp_adb-mcp-bridge_/, "") || "";

      // Use tool_result ISO timestamp, or MCP timestamp_ms if available
      let videoOffsetMs: number;
      let mcpTimestamp: number | null = null;
      if (obj.status === "success" && obj.output) {
        try {
          const parsed = JSON.parse(obj.output.split("\n")[0]);
          if (parsed.timestamp_ms) mcpTimestamp = parsed.timestamp_ms;
          if (parsed.screenWidth) screenWidth = parsed.screenWidth;
          if (parsed.screenHeight) screenHeight = parsed.screenHeight;
        } catch {}
      }
      videoOffsetMs = mcpTimestamp
        ? mcpTimestamp - recordingStartedAtMs
        : new Date(obj.timestamp).getTime() - recordingStartedAtMs;

      // Flush pending assistant text before this action
      if (pendingText.trim()) {
        const msgTs = pendingTextTimestamp ? new Date(pendingTextTimestamp).getTime() : new Date(obj.timestamp).getTime();
        const msgEvent: WidgetEvent = {
          type: "message",
          videoOffsetMs: msgTs - recordingStartedAtMs,
        };
        if (isThinkingBlock) {
          msgEvent.thinking = pendingText.trim();
        } else {
          msgEvent.text = pendingText.trim();
        }
        events.push(msgEvent);
        pendingText = "";
        pendingTextTimestamp = "";
        isThinkingBlock = false;
      }

      // Only emit events for successful tool calls
      if (obj.status !== "success") continue;

      const p = toolUse.params || {};
      switch (shortName) {
        case "tap":
          events.push({ type: "tap", videoOffsetMs, x: p.x, y: p.y });
          break;
        case "swipe":
          events.push({
            type: "swipe", videoOffsetMs,
            x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
            durationMs: p.durationMs ?? 300,
          });
          break;
        case "long-press":
          events.push({ type: "long-press", videoOffsetMs, x: p.x, y: p.y, durationMs: p.durationMs ?? 1000 });
          break;
        case "key-event":
          events.push({ type: "key-event", videoOffsetMs, key: p.key });
          break;
        case "screenshot": {
          const ssEvent: any = {
            type: "screenshot", videoOffsetMs,
            x: p.x ?? 0, y: p.y ?? 0,
            width: p.width, height: p.height, scale: p.scale,
          };
          ssEvent._toolId = obj.tool_id;
          events.push(ssEvent);
          break;
        }
      }

      // Emit tool_call event for the message panel
      {
        let toolResponse: string;
        if (obj.output) {
          // Clean up: replace base64 image data
          const cleanOutput = obj.output.replace(/\[Image: image\/png\]/g, "[see Agent's View]");
          try {
            toolResponse = JSON.stringify(JSON.parse(cleanOutput.split("\n")[0]), null, 2);
          } catch {
            toolResponse = cleanOutput;
          }
        } else if (shortName === "get-device-session-info") {
          toolResponse = JSON.stringify({ screenWidth, screenHeight }, null, 2);
        } else if (mcpTimestamp) {
          toolResponse = JSON.stringify({ success: true, timestamp_ms: mcpTimestamp }, null, 2);
        } else {
          toolResponse = JSON.stringify({ success: true }, null, 2);
        }

        const lastScreenshot = events.filter(e => e.type === "screenshot").slice(-1)[0];
        events.push({
          type: "tool_call",
          videoOffsetMs,
          toolName: shortName,
          toolRequest: formatToolParams(p),
          toolResponse,
          toolResponseImageFile: shortName === "screenshot" ? lastScreenshot?.imageFile : undefined,
        });
      }
    }

    // Collect assistant messages (delta chunks)
    if (obj.type === "message" && obj.role === "assistant") {
      const content = obj.content || "";
      // "thought" is Gemini's thinking indicator — marks start of a thinking block
      if (content === "thought") {
        // Flush any pending non-thinking text first
        if (pendingText.trim() && !isThinkingBlock) {
          const msgTs = pendingTextTimestamp ? new Date(pendingTextTimestamp).getTime() - recordingStartedAtMs : 0;
          events.push({ type: "message", videoOffsetMs: msgTs, text: pendingText.trim() });
          pendingText = "";
        }
        isThinkingBlock = true;
        if (!pendingTextTimestamp) pendingTextTimestamp = obj.timestamp;
        continue;
      }
      if (!pendingTextTimestamp) pendingTextTimestamp = obj.timestamp;
      pendingText += content;
    }

    // Final result with stats
    if (obj.type === "result" && obj.stats) {
      finalUsage = {
        inputTokens: (obj.stats.input_tokens || 0),
        outputTokens: (obj.stats.output_tokens || 0),
      };
    }
  }
  if (Bun && Bun.gc) {
    Bun.gc();
  }

  // Flush any remaining text
  if (pendingText.trim() && events.length > 0) {
    const lastOffset = events[events.length - 1].videoOffsetMs;
    const msgEvent: WidgetEvent = { type: "message", videoOffsetMs: lastOffset };
    if (isThinkingBlock) {
      msgEvent.thinking = pendingText.trim();
    } else {
      msgEvent.text = pendingText.trim();
    }
    events.push(msgEvent);
  }

  // Extract screenshot images from [MESSAGE_BUS] debug lines (stderr).
  // Gemini CLI strips base64 from stream-json tool_result events but the debug
  // output contains the full image data in responseParts[].inlineData.
  // Match by callId (tool_id) to ensure correct image-to-event mapping.
  const screenshotEvents = events.filter((e: any) => e.type === "screenshot" && e._toolId);
  const ssByToolId = new Map(screenshotEvents.map((e: any) => [e._toolId, e]));
  let ssImgIdx = 0;
  for (const line of lines) {
    if (!line.includes("[MESSAGE_BUS]") || !line.includes("inlineData")) continue;
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) continue;
    try {
      const bus = JSON.parse(line.substring(jsonStart));
      if (bus.type !== "tool-calls-update") continue;
      for (const tc of (bus.toolCalls || [])) {
        const callId = tc.response?.callId || tc.request?.callId;
        if (!callId) continue;
        const callName = tc.request?.name?.replace(/^mcp_adb-mcp-bridge_/, "") || "";
        if (callName !== "screenshot") continue;
        for (const part of (tc.response?.responseParts || [])) {
          if (!part.inlineData?.data) continue;
          const ssEvent = ssByToolId.get(callId);
          if (!ssEvent) continue;
          // Save the image
          const imgName = `${ssImgIdx}.png`;
          const imgDir = join(imageDir, sessionId);
          mkdirSync(imgDir, { recursive: true });
          writeFileSync(join(imgDir, imgName), Buffer.from(part.inlineData.data, "base64"));
          ssEvent.imageFile = `images/${sessionId}/${imgName}`;
          ssImgIdx++;
        }
      }
    } catch {}
  }
  // Back-fill toolResponseImageFile on tool_call events for screenshots
  // (images are matched after the main loop, so tool_call events need updating)
  for (const e of events) {
    if (e.type === "tool_call" && e.toolName === "screenshot" && !e.toolResponseImageFile) {
      // Find the matching screenshot event by videoOffsetMs
      const ss = events.find((s: any) => s.type === "screenshot" && s.videoOffsetMs === e.videoOffsetMs && s.imageFile);
      if (ss) e.toolResponseImageFile = ss.imageFile;
    }
  }
  // Clean up internal _toolId before serialization
  for (const e of events) { delete (e as any)._toolId; }

  // Gemini only provides final usage — emit a single usage event at the start
  if (finalUsage) {
    events.push({
      type: "usage",
      videoOffsetMs: 0,
      inputTokens: finalUsage.inputTokens,
      outputTokens: finalUsage.outputTokens,
    });
  }

  return { events, screenWidth, screenHeight };
}

async function main() {
  mkdirSync(WIDGET_DATA_DIR, { recursive: true });
  mkdirSync(WIDGET_VIDEOS_DIR, { recursive: true });
  mkdirSync(WIDGET_IMAGES_DIR, { recursive: true });

  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} result files\n`);

  let totalExported = 0;

  for (const file of files) {
    const data = JSON.parse(
      readFileSync(join(RESULTS_DIR, file), "utf-8")
    );
    const isCodex = data.provider?.startsWith("codex");
    const isGemini = data.provider?.startsWith("gemini");

    for (const result of data.results) {
      if (!result.videoPath || !result.recordingStartedAtMs || !result.rawOutput) {
        continue;
      }

      // Check video file exists and copy it
      const videoFile = basename(result.videoPath);
      const videoSrc = join(RESULTS_DIR, "videos", videoFile);
      try {
        const stat = Bun.file(videoSrc);
        if (stat.size === 0) throw new Error("empty");
      } catch {
        console.log(`  Skipping ${result.testId}: video ${videoFile} not found`);
        continue;
      }
      copyFileSync(videoSrc, join(WIDGET_VIDEOS_DIR, videoFile));


      const sessionId = videoFile.replace(".mkv", "");
      const { events, screenWidth, screenHeight } = isCodex
        ? processCodexRawOutput(result.rawOutput, result.recordingStartedAtMs, WIDGET_IMAGES_DIR, sessionId)
        : isGemini
        ? processGeminiRawOutput(result.rawOutput, result.recordingStartedAtMs, WIDGET_IMAGES_DIR, sessionId)
        : processClaudeRawOutput(result.rawOutput, result.recordingStartedAtMs, WIDGET_IMAGES_DIR, sessionId);

      // Insert the input prompt as the first message
      let inputPrompt = result.prompt;
      if (!inputPrompt) {
        // Fallback: extract from rawOutput (Gemini has it as first user message)
        for (const line of result.rawOutput.split("\n").filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "message" && obj.role === "user" && obj.content) {
              inputPrompt = obj.content;
              break;
            }
          } catch {}
        }
      }
      if (!inputPrompt) {
        inputPrompt = result.testName;
      }
      events.unshift({
        type: "message",
        videoOffsetMs: 0,
        text: `Prompt: ${inputPrompt}`,
      });

      const widgetData: WidgetData = {
        testId: result.testId,
        testName: result.testName,
        provider: data.provider,
        model: data.model,
        pass: result.pass,
        screenWidth,
        screenHeight,
        recordingStartedAtMs: result.recordingStartedAtMs,
        videoFile: videoFile.replace(".mkv", ".mp4"),
        events,
      };

      const outPath = join(WIDGET_DATA_DIR, `${sessionId}.json`);
      Bun.write(outPath, JSON.stringify(widgetData, null, 2));
      console.log(
        `  ${result.testId} (${data.model}): ${events.length} events → ${basename(outPath)}`
      );
      totalExported++;
    }
  }

  console.log(`\nExported ${totalExported} test results to ${WIDGET_DATA_DIR}`);

  // Convert MKV videos to MP4 (GPU-accelerated, parallel)
  const mkvFiles = readdirSync(WIDGET_VIDEOS_DIR).filter(f => f.endsWith(".mkv"));
  const toConvert = mkvFiles.filter(mkv => !existsSync(join(WIDGET_VIDEOS_DIR, mkv.replace(".mkv", ".mp4"))));

  if (toConvert.length > 0) {
    // Check if ffmpeg is available
    const ffmpegCheck = spawnSync("which", ["ffmpeg"], { stdio: "pipe" });
    if (ffmpegCheck.status !== 0) {
      console.log(`\nSkipping video conversion (${toConvert.length} pending) — ffmpeg not in PATH.`);
      console.log(`Run: nix shell nixpkgs#ffmpeg -c bun run scripts/export-widget-data.ts`);
    } else {
      // Re-encode: H.265 via NVENC, half-res (540x1200) for small web-friendly files
      console.log(`\nConverting ${toConvert.length} videos (hevc_nvenc qp35 540x1200)...`);

      const MAX_PARALLEL = 4;
      let converted = 0;
      for (let i = 0; i < toConvert.length; i += MAX_PARALLEL) {
        const batch = toConvert.slice(i, i + MAX_PARALLEL);
        const promises = batch.map(mkv => {
          const mp4Path = join(WIDGET_VIDEOS_DIR, mkv.replace(".mkv", ".mp4"));
          return new Promise<boolean>((resolve) => {
            const proc = nodeSpawn("ffmpeg", [
              "-i", join(WIDGET_VIDEOS_DIR, mkv),
              "-c:v", "hevc_nvenc", "-preset", "medium", "-rc", "constqp", "-qp", "35",
              "-vf", "scale=540:1200",
              "-tag:v", "hvc1", "-movflags", "+faststart", "-an", mp4Path,
            ], { stdio: "pipe" });
            proc.on("close", (code) => {
              if (code === 0) {
                console.log(`  ${mkv} -> mp4`);
                resolve(true);
              } else {
                console.error(`  Failed: ${mkv}`);
                resolve(false);
              }
            });
          });
        });
        const results = await Promise.all(promises);
        converted += results.filter(Boolean).length;
      }
      console.log(`Converted ${converted}/${toConvert.length} videos to MP4`);
    }
  }

  // Generate index.json
  const dataFiles = readdirSync(WIDGET_DATA_DIR).filter(f => f.endsWith(".json") && f !== "index.json");
  const index = dataFiles.map(f => {
    const d = JSON.parse(readFileSync(join(WIDGET_DATA_DIR, f), "utf-8"));
    return { file: f, testId: d.testId, testName: d.testName, provider: d.provider, model: d.model, pass: d.pass };
  });
  index.sort((a, b) =>
    a.testName.localeCompare(b.testName) ||
    a.provider.localeCompare(b.provider) ||
    a.model.localeCompare(b.model) ||
    Number(a.pass) - Number(b.pass)
  );
  writeFileSync(join(WIDGET_DATA_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`Wrote index.json with ${index.length} entries`);
}

main();
