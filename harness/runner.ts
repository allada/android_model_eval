import { AdminClient } from "./admin_client.ts";
import * as log from "./log.ts";
import type { LlmProvider, ProviderConfig } from "./providers/types.ts";
import type {
  TestCase,
  TestResult,
  TestRunSummary,
  CheckResult,
  VerificationCheck,
  SessionAdminContext,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;

/** Common setup commands run before every test. */
const COMMON_SETUP: string[] = [
  // "input keyevent WAKEUP",
  // "input keyevent MENU",       // dismiss lock screen
  // "input keyevent HOME",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Create a SessionAdminContext backed by the admin API for a specific session. */
function makeSessionAdminContext(admin: AdminClient, sessionId: string): SessionAdminContext {
  return {
    adbShell: (command: string) => admin.runAdbCommand(sessionId, command),
  };
}

/** Execute a single verification check and return the result. */
async function runCheck(
  check: VerificationCheck,
  sessionAdminCtx: SessionAdminContext,
): Promise<CheckResult> {
  try {
    const output =
      typeof check.command === "string"
        ? (await sessionAdminCtx.adbShell(check.command)).trim()
        : await check.command(sessionAdminCtx);

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
  /** URL of the MCP server (port 3000). Passed to the LLM provider. */
  mcpServerUrl: string;
  /** Admin client for session management + ADB commands. */
  admin: AdminClient;
}

/**
 * Runs test cases sequentially against a given LLM provider.
 * Each test gets its own device session via the admin API.
 */
export async function runTests(
  tests: TestCase[],
  provider: LlmProvider,
  { admin, mcpServerUrl }: RunnerOptions,
): Promise<TestRunSummary> {
  const runStart = Date.now();
  const results: TestResult[] = [];

  for (const test of tests) {
    const testStart = Date.now();
    log.testHeader(test.name, test.id);

    let error: string | undefined;
    let rawOutput: string | undefined;
    let deviceSessionId: string | undefined;

    try {
      // 0. CREATE SESSION
      const session = await admin.initDeviceSession();
      deviceSessionId = session.deviceSessionId;
      log.harness(`Session: ${deviceSessionId} (${session.deviceSerial})`);

      const sessionAdminCtx = makeSessionAdminContext(admin, deviceSessionId);

      // 1. SETUP: common + test-specific
      for (const cmd of COMMON_SETUP) {
        await sessionAdminCtx.adbShell(cmd);
      }

      for (const step of test.setup) {
        if (typeof step === "string") {
          log.harness(`Setup: ${step}`);
          await sessionAdminCtx.adbShell(step);
        } else {
          await step(sessionAdminCtx);
        }
      }

      // 2. EXECUTE: let the LLM do its thing
      const config: ProviderConfig = {
        mcpServerUrl,
        deviceSessionId,
        timeoutMs: test.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };

      try {
        const result = await provider.execute(test.prompt, config);
        error = result.error;
        rawOutput = result.rawOutput;
      } catch (err: any) {
        error = err.message;
        log.harnessError(`Execution error: ${err.message}`);
      }

      // 3. VERIFY: check device state
      const checks: CheckResult[] = [];
      for (const verification of test.verifications) {
        const result = await runCheck(verification, sessionAdminCtx);
        checks.push(result);
        log.check(result.pass, `${result.name}: ${result.message}`);
      }

      const pass = !error && checks.every((c) => c.pass);
      results.push({
        testId: test.id,
        testName: test.name,
        provider: provider.name,
        pass,
        checks,
        durationMs: Date.now() - testStart,
        error,
        rawOutput,
      });

      log.testResult(pass);
    } catch (err: any) {
      log.harnessError(`Test failed: ${err.message}`);
      results.push({
        testId: test.id,
        testName: test.name,
        provider: provider.name,
        pass: false,
        checks: [],
        durationMs: Date.now() - testStart,
        error: err.message,
      });
    } finally {
      // 4. CLEANUP: remove session
      if (deviceSessionId) {
        try {
          await admin.removeDeviceSession(deviceSessionId);
        } catch (err: any) {
          log.harnessError(`Cleanup failed: ${err.message}`);
        }
      }
    }
  }

  return {
    provider: provider.name,
    totalTests: tests.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
    startedAt: new Date(runStart).toISOString(),
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - runStart,
  };
}
