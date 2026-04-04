import * as log from "../log.ts";
import type { LlmProvider, LlmExecutionResult, ProviderConfig, TokenUsage } from "./types.ts";

const MCP_SERVER_NAME = "eval-adb-mcp-bridge";

export interface CodexProviderOptions {
  /** Model to use. Default: "gpt-5.4". */
  model?: string;
  /** MCP server URL to register with codex. */
  mcpServerUrl: string;
  /** Reasoning effort level (e.g. "low", "medium", "high"). */
  effort?: string;
}

/**
 * Provider that uses the Codex CLI with native MCP server support.
 * Registers the MCP server via `codex mcp add` on setup,
 * runs tasks via `codex exec`, and cleans up on teardown.
 */
export class CodexProvider implements LlmProvider {
  readonly name: string;
  private model: string;
  private codexBin: string;
  private mcpServerUrl: string;
  private effort?: string;
  private registered = false;

  constructor(options: CodexProviderOptions) {
    this.model = options.model ?? "gpt-5.4";
    this.codexBin = process.env.CODEX_BIN ?? "codex";
    this.mcpServerUrl = options.mcpServerUrl;
    this.effort = options.effort;
    this.name = `codex-${this.model}`;
  }

  /** Register the MCP server with codex. Call before first execute(). */
  async setup(): Promise<void> {
    // Remove any stale registration first
    await this.spawn(["mcp", "remove", MCP_SERVER_NAME]).catch(() => {});
    const { exitCode, stderr } = await this.spawn([
      "mcp", "add", "--url", this.mcpServerUrl, MCP_SERVER_NAME,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Failed to register MCP server: ${stderr}`);
    }
    this.registered = true;
  }

  /** Unregister the MCP server from codex. Call after all tests. */
  async teardown(): Promise<void> {
    if (!this.registered) return;
    await this.spawn(["mcp", "remove", MCP_SERVER_NAME]).catch(() => {});
    this.registered = false;
  }

  async execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult> {
    const start = Date.now();

    const fullPrompt = [
      "You are controlling an Android device via MCP tools.",
      `Your device session ID is: ${config.deviceSessionId}`,
      "Pass this deviceSessionId to every MCP tool call.",
      "First call get-device-session-info to get the screenshot URL and screen dimensions.",
      "You should verify the action you took succeeded and retry or wait if needed.",
      "",
      `Task: ${prompt}`,
    ].join("\n");

    const args = [
      "exec",
      "--json",
      "--model", this.model,
      "-c", "sandbox_workspace_write.network_access=true",
      "--skip-git-repo-check",
      "--disable", "shell_tool",
      ...(this.effort ? ["-c", `model_reasoning_effort="${this.effort}"`] : []),
      "-c", 'model_reasoning_summary="detailed"',
      "-c", "hide_agent_reasoning=false",
      fullPrompt,
    ];

    const { exitCode, stdout, stderr } = await this.spawn(args, config.timeoutMs, true);

    const durationMs = Date.now() - start;
    const timedOut = durationMs >= config.timeoutMs;

    const error = timedOut
      ? "Timed out"
      : exitCode !== 0
        ? `Codex exited with code ${exitCode}`
        : undefined;

    return { error, prompt: fullPrompt, durationMs, rawOutput: stdout + stderr, tokenUsage: parseTokenUsage(stdout) };
  }

  private async spawn(
    args: string[],
    timeoutMs?: number,
    stream = false,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([this.codexBin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs) {
      timeoutId = setTimeout(() => proc.kill(), timeoutMs);
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
      readStream(proc.stdout as ReadableStream<Uint8Array>, stream),
      readStream(proc.stderr as ReadableStream<Uint8Array>, stream),
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    return { exitCode: exitCode ?? 1, stdout, stderr };
  }
}

/**
 * Parse token usage from Codex's --json JSONL output.
 * Codex emits events with usage info; we sum across all events.
 */
function parseTokenUsage(stdout: string): TokenUsage | undefined {
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let found = false;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      // Codex JSONL events may include usage at various levels
      const u = event.usage ?? event.response?.usage;
      if (u) {
        usage.inputTokens += u.input_tokens ?? u.prompt_tokens ?? 0;
        usage.outputTokens += u.output_tokens ?? u.completion_tokens ?? 0;
        usage.thinkingTokens += u.thinking_tokens ?? u.reasoning_tokens ?? 0;
        found = true;
      }
    } catch {
      // Not JSON, skip
    }
  }

  return found ? usage : undefined;
}
