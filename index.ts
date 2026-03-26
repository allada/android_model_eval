import { parseArgs } from "node:util";
import { allTests, filterById, filterByTag } from "./harness/tests/index.ts";
import { runTests } from "./harness/runner.ts";
import { printSummary, writeJsonReport } from "./harness/reporter.ts";
import { CodexProvider } from "./harness/providers/codex.ts";
import type { LlmProvider } from "./harness/providers/types.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "codex" },
    model: { type: "string" },
    "mcp-url": { type: "string", default: "http://localhost:3000" },
    device: { type: "string", default: "emulator-5554" },
    test: { type: "string" },
    tag: { type: "string" },
    timeout: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: bun run index.ts [options]

Options:
  --provider <name>   LLM provider (default: codex)
  --model <model>     Model override (e.g. o4-mini, o3)
  --mcp-url <url>     MCP server URL (default: http://localhost:3000)
  --device <serial>   ADB device serial for setup/verify (default: emulator-5554)
  --test <id>         Run a specific test by ID
  --tag <tag>         Filter tests by tag
  --timeout <ms>      Per-test timeout in milliseconds
  -h, --help          Show this help

Examples:
  bun run index.ts --test airplane-mode-on
  bun run index.ts --tag settings
  bun run index.ts --device emulator-5556
`);
  process.exit(0);
}

// Select provider
function createProvider(name: string, model?: string): LlmProvider {
  switch (name) {
    case "codex":
      return new CodexProvider({ model });
    default:
      console.error(`Unknown provider: ${name}`);
      console.error("Available providers: codex");
      process.exit(1);
  }
}

// Filter tests
let tests = allTests;
if (values.test) {
  tests = filterById(tests, values.test);
  if (tests.length === 0) {
    console.error(`No test found with ID: ${values.test}`);
    console.error(`Available tests: ${allTests.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }
}
if (values.tag) {
  tests = filterByTag(tests, values.tag);
  if (tests.length === 0) {
    console.error(`No tests found with tag: ${values.tag}`);
    process.exit(1);
  }
}

// Apply global timeout override
if (values.timeout) {
  const ms = parseInt(values.timeout, 10);
  tests = tests.map((t) => ({ ...t, timeoutMs: ms }));
}

const provider = createProvider(values.provider!, values.model);
const mcpUrl = values["mcp-url"]!;
const deviceSerial = values.device!;

console.log(`Provider: ${provider.name}`);
console.log(`MCP Server: ${mcpUrl}`);
console.log(`Device: ${deviceSerial}`);
console.log(`Tests: ${tests.length}`);

const summary = await runTests(tests, provider, { mcpServerUrl: mcpUrl, deviceSerial });

printSummary(summary);
await writeJsonReport(summary);

process.exit(summary.failed > 0 ? 1 : 0);
