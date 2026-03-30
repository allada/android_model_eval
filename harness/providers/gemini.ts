import * as log from "../log.ts";
import type { LlmProvider, LlmExecutionResult, ProviderConfig, TokenUsage } from "./types.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export interface GeminiProviderOptions {
  /** Model to use (e.g. "gemini-2.5-pro", "gemini-2.5-flash"). Default: "gemini-2.5-pro". */
  model?: string;
  /** MCP server URL. */
  mcpServerUrl: string;
}

/**
 * Provider that uses the Gemini CLI with MCP server support.
 *
 * Gemini CLI reads MCP config from settings.json in its config dir.
 * We create a temporary config dir per execution to isolate config.
 *
 * Stream-json event types (from Gemini CLI source):
 *   init        — session_id, model
 *   message     — role, content, delta
 *   tool_use    — tool_name, tool_id, parameters
 *   tool_result — tool_id, status, output/error
 *   error       — severity, message
 *   result      — status, stats (token usage + duration)
 */
export class GeminiProvider implements LlmProvider {
  readonly name: string;
  private model: string;
  private geminiBin: string;
  private mcpServerUrl: string;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model ?? "gemini-2.5-pro";
    this.geminiBin = process.env.GEMINI_BIN ?? "gemini";
    this.mcpServerUrl = options.mcpServerUrl;
    this.name = `gemini-${this.model}`;
  }

  async execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult> {
    const start = Date.now();

    const fullPrompt = [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${config.deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get the screenshot URL and screen dimensions.",
      "Prefer low-resolution, downscaled screenshots to minimize tokens. Only request high-resolution crops of specific UI sections as needed.",
      "You should verify the action you took succeeded and retry or wait if needed.",
      "",
      `Task: ${prompt}`,
    ].join("\n");

    // Gemini CLI reads settings from ~/.gemini/settings.json (hardcoded to homedir()).
    // We create a temp HOME, copy the real ~/.gemini into it (for auth/credentials),
    // then overlay our MCP settings.
    const realHome = homedir();
    const realGeminiDir = join(realHome, ".gemini");
    const tmpHome = join("/tmp", `gemini-eval-${randomUUID()}`);
    const tmpGeminiDir = join(tmpHome, ".gemini");

    if (existsSync(realGeminiDir)) {
      cpSync(realGeminiDir, tmpGeminiDir, { recursive: true });
    } else {
      mkdirSync(tmpGeminiDir, { recursive: true });
    }

    // Merge our MCP server config into existing settings (if any)
    let existingSettings: any = {};
    const settingsPath = join(tmpGeminiDir, "settings.json");
    if (existsSync(settingsPath)) {
      try { existingSettings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
    }
    existingSettings.mcpServers = {
      ...existingSettings.mcpServers,
      "adb-mcp-bridge": {
        httpUrl: this.mcpServerUrl,
        trust: true,
      },
    };
    writeFileSync(settingsPath, JSON.stringify(existingSettings));

    // Write a policy that auto-approves only our MCP server tools
    const policiesDir = join(tmpGeminiDir, "policies");
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(join(policiesDir, "eval.toml"), [
      '# Auto-approve all tools from our MCP server',
      '[[rule]]',
      'mcpName = "adb-mcp-bridge"',
      'decision = "allow"',
      'priority = 200',
      '',
      '# Deny everything else in headless mode',
      '[[rule]]',
      'decision = "deny"',
      'priority = 100',
    ].join("\n"));

    const args = [
      "-p", fullPrompt,
      "-m", this.model,
      "--output-format", "stream-json",
      // Only allow our MCP server via --allowed-mcp-server-names
      "--allowed-mcp-server-names", "adb-mcp-bridge",
      // Debug output for verbose logging
      "-d",
    ];

    try {
      const proc = Bun.spawn([this.geminiBin, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          // Override HOME so Gemini CLI reads ~/.gemini/settings.json from our temp dir
          HOME: tmpHome,
        },
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (config.timeoutMs) {
        timeoutId = setTimeout(() => proc.kill(), config.timeoutMs);
      }

      const readStream = async (
        readable: ReadableStream<Uint8Array>,
        tee: boolean,
      ): Promise<string> => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of readable) {
          chunks.push(chunk);
          if (tee) log.modelChunk(chunk);
        }
        return Buffer.concat(chunks).toString();
      };

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        readStream(proc.stdout as ReadableStream<Uint8Array>, true),
        readStream(proc.stderr as ReadableStream<Uint8Array>, true),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      const durationMs = Date.now() - start;
      const timedOut = durationMs >= config.timeoutMs;

      const error = timedOut
        ? "Timed out"
        : exitCode !== 0
          ? `Gemini exited with code ${exitCode}`
          : undefined;

      return { error, durationMs, rawOutput: stdout + stderr, tokenUsage: parseTokenUsage(stdout) };
    } finally {
      try {
        rmSync(tmpHome, { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * Parse token usage from Gemini CLI's stream-json output.
 *
 * Gemini emits a final "result" event with stats:
 *   { type: "result", stats: { input_tokens, output_tokens, total_tokens, cached, duration_ms, tool_calls, models: {...} } }
 *
 * Also handles per-event usageMetadata if present (Gemini API format):
 *   { usageMetadata: { promptTokenCount, candidatesTokenCount, thoughtsTokenCount } }
 */
function parseTokenUsage(stdout: string): TokenUsage | undefined {
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let found = false;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);

      // Preferred: final "result" event with aggregated stats
      if (event.type === "result" && event.stats) {
        const s = event.stats;
        return {
          inputTokens: s.input_tokens ?? s.input ?? 0,
          outputTokens: s.output_tokens ?? 0,
          thinkingTokens: 0,
        };
      }

      // Fallback: per-event usageMetadata (Gemini API native format)
      const u =
        event.usageMetadata ??
        event.usage ??
        event.message?.usageMetadata ??
        event.response?.usageMetadata;

      if (u) {
        const inp = u.promptTokenCount ?? u.input_tokens ?? 0;
        const out = u.candidatesTokenCount ?? u.output_tokens ?? 0;
        const think = u.thoughtsTokenCount ?? 0;

        if (inp > usage.inputTokens) usage.inputTokens = inp;
        if (out > usage.outputTokens) usage.outputTokens = out;
        if (think > usage.thinkingTokens) usage.thinkingTokens = think;
        found = true;
      }
    } catch {
      // Not JSON, skip
    }
  }

  return found ? usage : undefined;
}
