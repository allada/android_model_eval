/**
 * Backfill the `prompt` field in existing result JSON files.
 * Reconstructs the exact prompt each provider would have built.
 *
 * Uses string replacement to avoid re-serializing the entire JSON (OOM risk).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESULTS_DIR = join(import.meta.dir, "..", "results");

const TEST_PROMPTS: Record<string, string> = {
  "airplane-mode-on": "Turn on airplane mode on.",
  "airplane-mode-off": "Turn off airplane mode on.",
  "set-alarm-5pm": "Set an alarm for 5:00 PM.",
  "uninstall-app": "There is an app called Firefox Focus installed on this device. The icon looks like the firefox logo, but purple. Find it and uninstall it.",
  "uninstall-calculator": "There is an app called Firefox Focus installed on this device. The icon looks like the firefox logo, but purple. Find it and uninstall it.",
  "get-verification-code": "You just received a text message with a verification code. Open the Messages app, find the verification code, and tell me what it is.",
};

function extractDeviceSessionId(rawOutput: string): string | null {
  if (!rawOutput) return null;
  // Fast regex on raw string — works for all providers
  const match = rawOutput.match(/"deviceSessionId"\s*:\s*"([a-f0-9-]+)"/);
  return match ? match[1] : null;
}

function buildPrompt(provider: string, testId: string, deviceSessionId: string): string | null {
  const taskPrompt = TEST_PROMPTS[testId];
  if (!taskPrompt) return null;

  if (provider.startsWith("claude")) {
    const systemPrompt = [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get screen dimensions.",
      "Prefer low-resolution, downscaled screenshots to minimize tokens. Only request high-resolution crops of specific UI sections as needed.",
      "Verify the action you took succeeded and retry or wait if needed.",
    ].join("\n");
    return `System: ${systemPrompt}\n\nUser: ${taskPrompt}`;
  }

  if (provider.startsWith("codex")) {
    return [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get the screenshot URL and screen dimensions.",
      "You should verify the action you took succeeded and retry or wait if needed.",
      "",
      `Task: ${taskPrompt}`,
    ].join("\n");
  }

  if (provider.startsWith("gemini")) {
    return [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get the screenshot URL and screen dimensions.",
      "Prefer low-resolution, downscaled screenshots to minimize tokens. Only request high-resolution crops of specific UI sections as needed.",
      "You should verify the action you took succeeded and retry or wait if needed.",
      "",
      `Task: ${taskPrompt}`,
    ].join("\n");
  }

  return null;
}

const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json"));
console.log(`Found ${files.length} result files\n`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  const filepath = join(RESULTS_DIR, file);
  let raw = readFileSync(filepath, "utf-8");

  // Quick check: if all results already have prompts, skip
  if (!raw.includes('"rawOutput"')) {
    skipped++;
    continue;
  }

  // Parse just enough to get provider and per-result info
  // We'll do targeted string insertion to avoid full re-serialization
  const data = JSON.parse(raw);
  let fileChanged = false;

  for (const result of data.results) {
    if (result.prompt) {
      skipped++;
      continue;
    }

    const deviceSessionId = extractDeviceSessionId(result.rawOutput);
    if (!deviceSessionId) {
      if (result.rawOutput && result.rawOutput.length > 100) {
        console.log(`  [WARN] No deviceSessionId: ${file} / ${result.testId}`);
      }
      failed++;
      continue;
    }

    const prompt = buildPrompt(data.provider, result.testId, deviceSessionId);
    if (!prompt) {
      console.log(`  [WARN] Unknown testId: ${result.testId} in ${file}`);
      failed++;
      continue;
    }

    result.prompt = prompt;
    fileChanged = true;
    updated++;
  }

  if (fileChanged) {
    // Write using the streaming approach from reporter.ts to avoid OOM
    const { results, ...rest } = data;
    const { open } = require("node:fs/promises");
    const fh = require("node:fs").openSync(filepath, "w");
    const header = JSON.stringify(rest, null, 2);
    require("node:fs").writeSync(fh, header.slice(0, -2) + ',\n  "results": [\n');
    for (let i = 0; i < results.length; i++) {
      const comma = i < results.length - 1 ? "," : "";
      require("node:fs").writeSync(fh, "    " + JSON.stringify(results[i]) + comma + "\n");
    }
    require("node:fs").writeSync(fh, "  ]\n}\n");
    require("node:fs").closeSync(fh);
  }
}

console.log(`\nDone: ${updated} backfilled, ${skipped} skipped, ${failed} failed`);
