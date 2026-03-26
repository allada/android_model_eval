import { AdbService } from "../adb-mcp-bridge/src/adb_service.ts";
import type { LlmProvider, ProviderConfig } from "./providers/types.ts";
import type {
  TestCase,
  TestResult,
  TestRunSummary,
  CheckResult,
  VerificationCheck,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;

/** Common setup commands run before every test. */
const COMMON_SETUP = [
  "input keyevent WAKEUP",
  "input keyevent MENU",       // dismiss lock screen
  "input keyevent HOME",
];

/** Pause for device animations to settle. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Execute a single verification check and return the result. */
async function runCheck(
  check: VerificationCheck,
  adb: AdbService,
): Promise<CheckResult> {
  try {
    // Get command output
    const output =
      typeof check.command === "string"
        ? (await adb.shell(check.command)).trim()
        : await check.command(adb);

    // Evaluate against expected
    if (typeof check.expected === "string") {
      const pass = output === check.expected;
      return {
        name: check.name,
        pass,
        message: pass
          ? `Got expected value "${check.expected}"`
          : `Expected "${check.expected}", got "${output}"`,
        actualOutput: output,
      };
    }

    if (check.expected instanceof RegExp) {
      const pass = check.expected.test(output);
      return {
        name: check.name,
        pass,
        message: pass
          ? `Output matched ${check.expected}`
          : `Output "${output}" did not match ${check.expected}`,
        actualOutput: output,
      };
    }

    // Function validator
    const result = check.expected(output);
    return {
      name: check.name,
      pass: result.pass,
      message: result.message,
      actualOutput: output,
    };
  } catch (err: any) {
    return {
      name: check.name,
      pass: false,
      message: `Check error: ${err.message}`,
    };
  }
}

export interface RunnerOptions {
  /** URL of the running adb-mcp-bridge server. */
  mcpServerUrl: string;
  /** Device serial for setup/verification ADB commands (e.g. "emulator-5554"). */
  deviceSerial: string;
}

/**
 * Runs test cases sequentially against a given LLM provider.
 * Returns a summary of all results.
 */
export async function runTests(
  tests: TestCase[],
  provider: LlmProvider,
  options: RunnerOptions,
): Promise<TestRunSummary> {
  const startedAt = new Date().toISOString();
  const runStart = Date.now();
  const results: TestResult[] = [];

  // Create an AdbService for setup/verification (separate from MCP server sessions).
  const adb = new AdbService(options.deviceSerial);

  for (const test of tests) {
    const testStart = Date.now();
    console.log(`\n--- Running: ${test.name} (${test.id}) ---`);

    let timedOut = false;
    let error: string | undefined;

    // 1. SETUP: common + test-specific
    try {
      for (const cmd of COMMON_SETUP) {
        await adb.shell(cmd);
      }
      await sleep(1000);

      for (const step of test.setup) {
        if (typeof step === "string") {
          await adb.shell(step);
        } else {
          await step(adb);
        }
      }
      await sleep(500);
    } catch (err: any) {
      console.error(`  Setup failed: ${err.message}`);
      results.push({
        testId: test.id,
        testName: test.name,
        provider: provider.name,
        pass: false,
        checks: [],
        durationMs: Date.now() - testStart,
        timedOut: false,
        error: `Setup failed: ${err.message}`,
      });
      continue;
    }

    // 2. EXECUTE: let the LLM do its thing
    const timeoutMs = test.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const config: ProviderConfig = {
      mcpServerUrl: options.mcpServerUrl,
      timeoutMs,
    };

    try {
      const result = await provider.execute(test.prompt, config);
      if (!result.completedSuccessfully) {
        timedOut = true;
      }
      if (result.finalOutput) {
        console.log(`  LLM output: ${result.finalOutput.slice(0, 200)}`);
      }
    } catch (err: any) {
      error = err.message;
      console.error(`  Execution error: ${err.message}`);
    }

    // 3. VERIFY: check device state
    await sleep(1000); // let any final animations settle
    const checks: CheckResult[] = [];
    for (const check of test.verifications) {
      const result = await runCheck(check, adb);
      checks.push(result);
      const icon = result.pass ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${result.name}: ${result.message}`);
    }

    // 4. TEARDOWN
    await adb.shell("input keyevent HOME");

    const pass = !error && !timedOut && checks.every((c) => c.pass);
    results.push({
      testId: test.id,
      testName: test.name,
      provider: provider.name,
      pass,
      checks,
      durationMs: Date.now() - testStart,
      timedOut,
      error,
    });

    console.log(`  Result: ${pass ? "PASSED" : "FAILED"}`);
  }

  const completedAt = new Date().toISOString();
  return {
    provider: provider.name,
    totalTests: tests.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
    startedAt,
    completedAt,
    totalDurationMs: Date.now() - runStart,
  };
}
