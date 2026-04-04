/**
 * Export widget data for Gemini results only.
 * Processes each result by streaming the file to avoid OOM on 1GB+ files.
 * Extracts rawOutput per result using string offsets rather than full JSON.parse.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "results");
const WIDGET_DIR = join(ROOT, "widget");
const WIDGET_DATA_DIR = join(WIDGET_DIR, "data");
const WIDGET_VIDEOS_DIR = join(WIDGET_DIR, "videos");
const WIDGET_IMAGES_DIR = join(WIDGET_DIR, "images");

mkdirSync(WIDGET_DATA_DIR, { recursive: true });
mkdirSync(WIDGET_VIDEOS_DIR, { recursive: true });
mkdirSync(WIDGET_IMAGES_DIR, { recursive: true });

function formatToolParams(params: any): string {
  if (!params) return "{}";
  const clean = { ...params };
  delete clean.deviceSessionId;
  return JSON.stringify(clean, null, 2);
}

interface WidgetEvent { type: string; videoOffsetMs: number; [key: string]: any; }

function processGeminiRawOutput(
  rawOutput: string, recordingStartedAtMs: number, sessionId: string,
): { events: WidgetEvent[]; screenWidth: number; screenHeight: number } {
  const lines = rawOutput.split("\n").filter(Boolean);
  const events: WidgetEvent[] = [];
  let screenWidth = 1080, screenHeight = 2400;
  const toolUseMap = new Map<string, { name: string; params: any; timestamp: string }>();
  let pendingText = "", pendingTextTimestamp = "", isThinkingBlock = false;
  let finalUsage: { inputTokens: number; outputTokens: number } | null = null;

  for (const line of lines) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === "tool_use") {
      toolUseMap.set(obj.tool_id, { name: obj.tool_name, params: obj.parameters, timestamp: obj.timestamp });
    }

    if (obj.type === "tool_result") {
      const toolUse = toolUseMap.get(obj.tool_id);
      if (!toolUse) continue;
      const shortName = toolUse.name?.replace(/^mcp_adb-mcp-bridge_/, "") || "";
      let mcpTimestamp: number | null = null;
      if (obj.status === "success" && obj.output) {
        try {
          const parsed = JSON.parse(obj.output.split("\n")[0]);
          if (parsed.timestamp_ms) mcpTimestamp = parsed.timestamp_ms;
          if (parsed.screenWidth) screenWidth = parsed.screenWidth;
          if (parsed.screenHeight) screenHeight = parsed.screenHeight;
        } catch {}
      }
      const videoOffsetMs = mcpTimestamp ? mcpTimestamp - recordingStartedAtMs : new Date(obj.timestamp).getTime() - recordingStartedAtMs;

      if (pendingText.trim()) {
        const msgTs = pendingTextTimestamp ? new Date(pendingTextTimestamp).getTime() : new Date(obj.timestamp).getTime();
        const me: WidgetEvent = { type: "message", videoOffsetMs: msgTs - recordingStartedAtMs };
        if (isThinkingBlock) me.thinking = pendingText.trim(); else me.text = pendingText.trim();
        events.push(me);
        pendingText = ""; pendingTextTimestamp = ""; isThinkingBlock = false;
      }
      if (obj.status !== "success") continue;

      const p = toolUse.params || {};
      switch (shortName) {
        case "tap": events.push({ type: "tap", videoOffsetMs, x: p.x, y: p.y }); break;
        case "swipe": events.push({ type: "swipe", videoOffsetMs, x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, durationMs: p.durationMs ?? 300 }); break;
        case "long-press": events.push({ type: "long-press", videoOffsetMs, x: p.x, y: p.y, durationMs: p.durationMs ?? 1000 }); break;
        case "key-event": events.push({ type: "key-event", videoOffsetMs, key: p.key }); break;
        case "screenshot": { const ss: any = { type: "screenshot", videoOffsetMs, x: p.x ?? 0, y: p.y ?? 0, width: p.width, height: p.height, scale: p.scale }; ss._toolId = obj.tool_id; events.push(ss); break; }
      }
      // tool_call event
      {
        let toolResponse: string;
        if (obj.output) {
          const co = obj.output.replace(/\[Image: image\/png\]/g, "[see Agent's View]");
          try { toolResponse = JSON.stringify(JSON.parse(co.split("\n")[0]), null, 2); } catch { toolResponse = co; }
        } else if (shortName === "get-device-session-info") {
          toolResponse = JSON.stringify({ screenWidth, screenHeight }, null, 2);
        } else if (mcpTimestamp) {
          toolResponse = JSON.stringify({ success: true, timestamp_ms: mcpTimestamp }, null, 2);
        } else { toolResponse = JSON.stringify({ success: true }, null, 2); }
        const lastSS = events.filter(e => e.type === "screenshot").slice(-1)[0];
        events.push({ type: "tool_call", videoOffsetMs, toolName: shortName, toolRequest: formatToolParams(p), toolResponse, toolResponseImageFile: shortName === "screenshot" ? lastSS?.imageFile : undefined });
      }
    }

    if (obj.type === "message" && obj.role === "assistant") {
      const content = obj.content || "";
      if (content === "thought") {
        if (pendingText.trim() && !isThinkingBlock) {
          const mt = pendingTextTimestamp ? new Date(pendingTextTimestamp).getTime() - recordingStartedAtMs : 0;
          events.push({ type: "message", videoOffsetMs: mt, text: pendingText.trim() });
          pendingText = "";
        }
        isThinkingBlock = true;
        if (!pendingTextTimestamp) pendingTextTimestamp = obj.timestamp;
        continue;
      }
      if (!pendingTextTimestamp) pendingTextTimestamp = obj.timestamp;
      pendingText += content;
    }

    if (obj.type === "result" && obj.stats) {
      finalUsage = { inputTokens: obj.stats.input_tokens || 0, outputTokens: obj.stats.output_tokens || 0 };
    }
  }

  if (pendingText.trim() && events.length > 0) {
    const lo = events[events.length - 1].videoOffsetMs;
    const me: WidgetEvent = { type: "message", videoOffsetMs: lo };
    if (isThinkingBlock) me.thinking = pendingText.trim(); else me.text = pendingText.trim();
    events.push(me);
  }

  // Extract images: first try __screenshot_image events (new format), then MESSAGE_BUS (old format)
  const ssByToolId = new Map(events.filter((e: any) => e.type === "screenshot" && e._toolId).map((e: any) => [e._toolId, e]));
  let ssIdx = 0;

  // New format: __screenshot_image events with file paths
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "__screenshot_image" && obj.toolId) {
        const sse = ssByToolId.get(obj.toolId);
        if (!sse) continue;
        if (obj.file && existsSync(join(ROOT, obj.file))) {
          // Copy from results/screenshots/ to widget/images/
          const imgName = `${ssIdx}.png`;
          const imgDir = join(WIDGET_IMAGES_DIR, sessionId);
          mkdirSync(imgDir, { recursive: true });
          copyFileSync(join(ROOT, obj.file), join(imgDir, imgName));
          sse.imageFile = `images/${sessionId}/${imgName}`;
          ssIdx++;
        } else if (obj.base64) {
          const imgName = `${ssIdx}.png`;
          const imgDir = join(WIDGET_IMAGES_DIR, sessionId);
          mkdirSync(imgDir, { recursive: true });
          writeFileSync(join(imgDir, imgName), Buffer.from(obj.base64, "base64"));
          sse.imageFile = `images/${sessionId}/${imgName}`;
          ssIdx++;
        }
      }
    } catch {}
  }

  // Old format fallback: MESSAGE_BUS debug lines with inlineData
  if (ssIdx === 0) for (const line of lines) {
    if (!line.includes("[MESSAGE_BUS]") || !line.includes("inlineData")) continue;
    const js = line.indexOf("{");
    if (js < 0) continue;
    try {
      const bus = JSON.parse(line.substring(js));
      if (bus.type !== "tool-calls-update") continue;
      for (const tc of (bus.toolCalls || [])) {
        const cid = tc.response?.callId || tc.request?.callId;
        if (!cid || !(tc.request?.name || "").includes("screenshot")) continue;
        for (const part of (tc.response?.responseParts || [])) {
          if (!part.inlineData?.data) continue;
          const sse = ssByToolId.get(cid);
          if (!sse) continue;
          const imgName = `${ssIdx}.png`;
          const imgDir = join(WIDGET_IMAGES_DIR, sessionId);
          mkdirSync(imgDir, { recursive: true });
          writeFileSync(join(imgDir, imgName), Buffer.from(part.inlineData.data, "base64"));
          sse.imageFile = `images/${sessionId}/${imgName}`;
          ssIdx++;
        }
      }
    } catch {}
  }

  for (const e of events) {
    if (e.type === "tool_call" && e.toolName === "screenshot" && !e.toolResponseImageFile) {
      const ss = events.find((s: any) => s.type === "screenshot" && s.videoOffsetMs === e.videoOffsetMs && s.imageFile);
      if (ss) e.toolResponseImageFile = ss.imageFile;
    }
  }
  for (const e of events) { delete (e as any)._toolId; }
  if (finalUsage) events.push({ type: "usage", videoOffsetMs: 0, inputTokens: finalUsage.inputTokens, outputTokens: finalUsage.outputTokens });

  return { events, screenWidth, screenHeight };
}

// Use a child process to extract each result's data without loading the full file
async function processFile(file: string) {
  const filepath = join(RESULTS_DIR, file);

  // Use bun subprocess to extract individual results, one at a time
  // This runs in a separate process with its own memory space
  const numResults = spawnSync("bun", ["-e", `
    const data = JSON.parse(require('fs').readFileSync('${filepath}', 'utf-8'));
    console.log(JSON.stringify({
      provider: data.provider,
      model: data.model,
      count: data.results.length,
      results: data.results.map(r => ({
        testId: r.testId,
        testName: r.testName,
        pass: r.pass,
        videoPath: r.videoPath,
        recordingStartedAtMs: r.recordingStartedAtMs,
        prompt: r.prompt,
        hasRawOutput: !!r.rawOutput && r.rawOutput.length > 100,
      }))
    }));
  `], { stdio: "pipe" });

  if (numResults.status !== 0) {
    console.log(`  Failed to read metadata: ${numResults.stderr?.toString().substring(0, 200)}`);
    return 0;
  }

  const meta = JSON.parse(numResults.stdout!.toString());
  let exported = 0;

  for (let idx = 0; idx < meta.results.length; idx++) {
    const r = meta.results[idx];
    if (!r.videoPath || !r.recordingStartedAtMs || !r.hasRawOutput) continue;

    const videoFile = basename(r.videoPath);
    const videoSrc = join(RESULTS_DIR, "videos", videoFile);
    if (!existsSync(videoSrc)) { console.log(`  Skipping ${r.testId}: video not found`); continue; }
    copyFileSync(videoSrc, join(WIDGET_VIDEOS_DIR, videoFile));

    const sessionId = videoFile.replace(".mkv", "");

    // Extract this single result's rawOutput in a subprocess
    const sub = spawnSync("bun", ["-e", `
      const data = JSON.parse(require('fs').readFileSync('${filepath}', 'utf-8'));
      const r = data.results[${idx}];
      console.log(r.rawOutput);
    `], { stdio: "pipe", maxBuffer: 2 * 1024 * 1024 * 1024 });

    if (sub.status !== 0) {
      console.log(`  Failed to extract rawOutput for ${r.testId}`);
      continue;
    }

    const rawOutput = sub.stdout!.toString();
    const { events, screenWidth, screenHeight } = processGeminiRawOutput(rawOutput, r.recordingStartedAtMs, sessionId);

    // Insert prompt
    let inputPrompt = r.prompt;
    if (!inputPrompt) {
      for (const line of rawOutput.split("\n").filter(Boolean).slice(0, 10)) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "message" && obj.role === "user" && obj.content) { inputPrompt = obj.content; break; }
        } catch {}
      }
    }
    if (!inputPrompt) inputPrompt = r.testName;
    events.unshift({ type: "message", videoOffsetMs: 0, text: `Prompt: ${inputPrompt}` });

    const widgetData = {
      testId: r.testId, testName: r.testName, provider: meta.provider, model: meta.model,
      pass: r.pass, screenWidth, screenHeight, recordingStartedAtMs: r.recordingStartedAtMs,
      videoFile: videoFile.replace(".mkv", ".mp4"), events,
    };

    const outPath = join(WIDGET_DATA_DIR, `${sessionId}.json`);
    writeFileSync(outPath, JSON.stringify(widgetData, null, 2));
    console.log(`  ${r.testId} (${meta.model}): ${events.length} events → ${basename(outPath)}`);
    exported++;
  }

  return exported;
}

// Main
const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json") && f.includes("gemini"));
console.log(`Found ${files.length} gemini result files\n`);

let totalExported = 0;
for (const file of files) {
  console.log(`Processing ${file}...`);
  totalExported += await processFile(file);
}

console.log(`\nExported ${totalExported} gemini test results`);

// Convert videos
const toConvert = readdirSync(WIDGET_VIDEOS_DIR).filter(f => f.endsWith(".mkv") && !existsSync(join(WIDGET_VIDEOS_DIR, f.replace(".mkv", ".mp4"))));
if (toConvert.length > 0) {
  if (spawnSync("which", ["ffmpeg"], { stdio: "pipe" }).status !== 0) {
    console.log(`\nSkipping ${toConvert.length} video conversions — ffmpeg not in PATH.`);
  } else {
    console.log(`\nConverting ${toConvert.length} videos...`);
    for (const mkv of toConvert) {
      spawnSync("ffmpeg", ["-i", join(WIDGET_VIDEOS_DIR, mkv), "-c:v", "copy", "-movflags", "+faststart", "-an", join(WIDGET_VIDEOS_DIR, mkv.replace(".mkv", ".mp4"))], { stdio: "pipe" });
      console.log(`  ${mkv} -> mp4`);
    }
  }
}

// Regenerate index
const dataFiles = readdirSync(WIDGET_DATA_DIR).filter(f => f.endsWith(".json") && f !== "index.json");
const index = dataFiles.map(f => {
  const d = JSON.parse(readFileSync(join(WIDGET_DATA_DIR, f), "utf-8"));
  return { file: f, testId: d.testId, testName: d.testName, provider: d.provider, model: d.model, pass: d.pass };
});
index.sort((a, b) => a.testName.localeCompare(b.testName) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model) || Number(a.pass) - Number(b.pass));
writeFileSync(join(WIDGET_DATA_DIR, "index.json"), JSON.stringify(index, null, 2));
console.log(`Wrote index.json with ${index.length} entries`);
