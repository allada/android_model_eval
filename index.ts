import { parseArgs } from "node:util";
import { allTests } from "./harness/tests/index.ts";
import { runTests } from "./harness/runner.ts";
import { printSummary, writeJsonReport } from "./harness/reporter.ts";
import { AdminClient } from "./harness/admin_client.ts";
import { CodexProvider } from "./harness/providers/codex.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "codex" },
    model: { type: "string" },
    "mcp-url": { type: "string", default: "http://localhost:3000" },
    "admin-url": { type: "string", default: "http://localhost:3001" },
    timeout: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: bun run index.ts [options]

Options:
  --provider <name>    LLM provider (default: codex)
  --model <model>      Model override (e.g. o4-mini, o3)
  --mcp-url <url>      MCP server URL (default: http://localhost:3000)
  --admin-url <url>    Admin API URL (default: http://localhost:3001)
  --timeout <ms>       Per-test timeout in milliseconds
  -h, --help           Show this help
`);
  process.exit(0);
}

const mcpUrl = values["mcp-url"]!;

function createProvider(name: string, model?: string): CodexProvider {
  switch (name) {
    case "codex":
      return new CodexProvider({ model, mcpServerUrl: mcpUrl });
    default:
      console.error(`Unknown provider: ${name}`);
      console.error("Available providers: codex");
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

await provider.setup();
try {
  const summary = await runTests(tests, provider, { mcpServerUrl: mcpUrl, admin });
  printSummary(summary);
  await writeJsonReport(summary);
  process.exit(summary.failed > 0 ? 1 : 0);
} finally {
  await provider.teardown();
}
