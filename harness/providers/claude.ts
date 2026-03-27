import * as log from "../log.ts";
import type { LlmProvider, LlmExecutionResult, ProviderConfig, TokenUsage } from "./types.ts";

export interface ClaudeProviderOptions {
  /** Model to use (e.g. "sonnet", "opus", "haiku"). Default: "sonnet". */
  model?: string;
  /** MCP server URL. */
  mcpServerUrl: string;
  /** Effort level (e.g. "low", "medium", "high", "max"). */
  effort?: string;
}

/**
 * Provider that uses the Claude Code CLI with native MCP server support.
 * Uses --mcp-config for per-invocation MCP config (no setup/teardown needed).
 */
export class ClaudeProvider implements LlmProvider {
  readonly name: string;
  private model: string;
  private claudeBin: string;
  private mcpServerUrl: string;
  private effort?: string;

  constructor(options: ClaudeProviderOptions) {
    this.model = options.model ?? "sonnet";
    this.claudeBin = process.env.CLAUDE_BIN ?? "claude";
    this.mcpServerUrl = options.mcpServerUrl;
    this.effort = options.effort;
    this.name = `claude-${this.model}`;
  }

  async execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult> {
    const start = Date.now();

    const systemPrompt = [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${config.deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get the screenshot URL and screen dimensions.",
      "You should verify the action you took succeeded and retry or wait if needed.",
    ].join("\n");

    const mcpConfig = JSON.stringify({
      mcpServers: {
        "adb-mcp-bridge": {
          type: "http",
          url: this.mcpServerUrl,
        },
      },
    });

    const args = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--model", this.model,
      "--system-prompt", systemPrompt,
      "--mcp-config", mcpConfig,
      "--strict-mcp-config",
      "--tools", "",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      ...(this.effort ? ["--effort", this.effort] : []),
      prompt,
    ];

    const proc = Bun.spawn([this.claudeBin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
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
        ? `Claude exited with code ${exitCode}`
        : undefined;

    return { error, durationMs, rawOutput: stdout + stderr, tokenUsage: parseTokenUsage(stdout) };
  }
}

/**
 * Parse token usage from Claude's stream-json output.
 * Prefers the final "result" event with modelUsage summary.
 * Falls back to summing per-turn usage from "assistant" events,
 * which survives timeouts since they're emitted incrementally.
 */
function parseTokenUsage(stdout: string): TokenUsage | undefined {
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let found = false;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);

      // Final result event — use its modelUsage as the authoritative total.
      if (event.type === "result" && event.modelUsage) {
        const totals: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
        for (const model of Object.values(event.modelUsage) as any[]) {
          totals.inputTokens += (model.inputTokens ?? 0)
            + (model.cacheReadInputTokens ?? 0)
            + (model.cacheCreationInputTokens ?? 0);
          totals.outputTokens += model.outputTokens ?? 0;
          totals.thinkingTokens += model.thinkingTokens ?? 0;
        }
        return totals;
      }

      // Per-turn assistant events — accumulate as fallback for timeouts.
      if (event.type === "assistant" && event.message?.usage) {
        const u = event.message.usage;
        usage.inputTokens += (u.input_tokens ?? 0)
          + (u.cache_read_input_tokens ?? 0)
          + (u.cache_creation_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens ?? 0;
        usage.thinkingTokens += u.thinking_tokens ?? 0;
        found = true;
      }
    } catch {
      // Not JSON, skip
    }
  }

  return found ? usage : undefined;
}
