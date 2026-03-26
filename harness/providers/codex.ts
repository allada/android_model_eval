import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LlmProvider, LlmExecutionResult, ProviderConfig } from "./types.ts";

export interface CodexProviderOptions {
  /** Model to use (e.g. "o4-mini", "o3"). Default: "o4-mini". */
  model?: string;
  /** Path to the codex binary. Default: "codex". */
  codexBin?: string;
}

/**
 * Provider that spawns the Codex CLI with native MCP server support.
 * Codex connects to the MCP server directly — no API bridging needed.
 */
export class CodexProvider implements LlmProvider {
  readonly name: string;
  private model: string;
  private codexBin: string;

  constructor(options: CodexProviderOptions = {}) {
    this.model = options.model ?? "o4-mini";
    this.codexBin = options.codexBin ?? "codex";
    this.name = `codex-${this.model}`;
  }

  async execute(prompt: string, config: ProviderConfig): Promise<LlmExecutionResult> {
    const start = Date.now();

    // Write a temporary MCP config file pointing to the running server
    const tmpDir = await mkdtemp(join(tmpdir(), "eval-harness-"));
    const mcpConfigPath = join(tmpDir, "mcp.json");
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          "adb-mcp-bridge": {
            type: "http",
            url: config.mcpServerUrl,
          },
        },
      }),
    );

    try {
      const systemPrompt = [
        "You are controlling an Android device via MCP tools.",
        "First call init-device-session to acquire a device — this returns a screenshotUrl you can GET at any time to see the current screen.",
        "Available tools: init-device-session, tap, swipe, long-press, key-event (POWER, VOLUME_UP, VOLUME_DOWN only).",
        "To type text, tap individual keys on the on-screen keyboard.",
        "To go home, swipe up from the bottom of the screen. To go back, swipe from the left edge.",
        "When done, stop and summarize what you did.",
      ].join(" ");

      const args = [
        "--full-auto",
        "--model", this.model,
        "--mcp-config", mcpConfigPath,
        "--system-prompt", systemPrompt,
        prompt,
      ];

      const proc = Bun.spawn([this.codexBin, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

      // Race between process completion and timeout
      const timeoutId = setTimeout(() => {
        proc.kill();
      }, config.timeoutMs);

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      clearTimeout(timeoutId);

      const durationMs = Date.now() - start;
      const timedOut = durationMs >= config.timeoutMs;

      if (stderr) {
        console.error(`  [codex stderr]: ${stderr.slice(0, 500)}`);
      }

      return {
        completedSuccessfully: exitCode === 0 && !timedOut,
        finalOutput: stdout || undefined,
        durationMs,
      };
    } finally {
      await unlink(mcpConfigPath).catch(() => {});
    }
  }
}
