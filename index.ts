import { parseArgs } from "node:util";
import { allTests } from "./harness/tests/index.ts";
import { runTests } from "./harness/runner.ts";
import { printSummary, writeJsonReport } from "./harness/reporter.ts";
import { AdminClient } from "./harness/admin_client.ts";
import { CodexProvider } from "./harness/providers/codex.ts";
import { ClaudeProvider } from "./harness/providers/claude.ts";
import { GeminiProvider } from "./harness/providers/gemini.ts";
import type { LlmProvider } from "./harness/providers/types.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "codex" },
    model: { type: "string" },
    "mcp-url": { type: "string", default: "http://localhost:3000" },
    "admin-url": { type: "string", default: "http://localhost:3001" },
    effort: { type: "string" },
    timeout: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: bun run index.ts [options]

Options:
  --provider <name>    LLM provider: codex, claude, gemini (default: codex)
  --model <model>      Model override (e.g. o4-mini, sonnet, opus)
  --mcp-url <url>      MCP server URL (default: http://localhost:3000)
  --admin-url <url>    Admin API URL (default: http://localhost:3001)
  --effort <level>     Reasoning effort level (e.g. low, medium, high, max)
  --timeout <ms>       Per-test timeout in milliseconds
  -h, --help           Show this help
`);
  process.exit(0);
}

const mcpUrl = values["mcp-url"]!;

const effort = values.effort;

function createProvider(name: string, model?: string): LlmProvider {
  switch (name) {
    case "codex":
      return new CodexProvider({ model, mcpServerUrl: mcpUrl, effort });
    case "claude":
      return new ClaudeProvider({ model, mcpServerUrl: mcpUrl, effort });
    case "gemini":
      return new GeminiProvider({ model, mcpServerUrl: mcpUrl });
    default:
      console.error(`Unknown provider: ${name}`);
      console.error("Available providers: codex, claude, gemini");
      process.exit(1);
  }
}

let tests = allTests;
if (values.timeout) {
  const ms = parseInt(values.timeout, 10);
  tests = tests.map((t) => ({ ...t, timeoutMs: ms }));
}

const provider = createProvider(values.provider!, values.model);
const admin = new AdminClient(values["admin-url"]!);

console.log(`Provider: ${provider.name}`);
console.log(`MCP Server: ${mcpUrl}`);
console.log(`Tests: ${tests.length}`);

// Provider-specific setup (codex needs MCP server registration)
if ("setup" in provider && typeof provider.setup === "function") {
  await provider.setup();
}

try {
  const model = values.model ?? (
    values.provider === "claude" ? "sonnet" :
    values.provider === "gemini" ? "gemini-2.5-pro" :
    "gpt-5.4"
  );
  const summary = await runTests(tests, provider, { mcpServerUrl: mcpUrl, admin, model, effort });
  printSummary(summary);
  await writeJsonReport(summary);
  process.exit(summary.failed > 0 ? 1 : 0);
} finally {
  if ("teardown" in provider && typeof provider.teardown === "function") {
    await provider.teardown();
  }
}
