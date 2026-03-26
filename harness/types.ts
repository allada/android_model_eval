import type { AdbService } from "../adb-mcp-bridge/src/adb_service.ts";

/** Result from a custom verification function. */
export interface VerificationResult {
  pass: boolean;
  message: string;
}

/** A single check to run against device state after the LLM finishes. */
export interface VerificationCheck {
  /** Human-readable name shown in reports. */
  name: string;

  /**
   * ADB shell command (string) or async function returning command output.
   * Strings are executed via `adb.shell(command)`.
   */
  command: string | ((adb: AdbService) => Promise<string>);

  /**
   * How to validate the command output:
   * - string  → exact match (trimmed)
   * - RegExp  → test against output
   * - function → custom validation returning pass/fail
   */
  expected: string | RegExp | ((output: string) => VerificationResult);
}

/** A complete test case definition. */
export interface TestCase {
  /** Unique identifier (e.g. "airplane-mode-on"). */
  id: string;

  /** Human-readable name. */
  name: string;

  /** Natural language prompt given to the LLM. */
  prompt: string;

  /**
   * Commands to run before the LLM starts, putting the device in a known state.
   * Strings are executed via `adb.shell()`. Functions receive the AdbService.
   * Executed sequentially.
   */
  setup: Array<string | ((adb: AdbService) => Promise<void>)>;

  /** Checks to run after the LLM completes or times out. */
  verifications: VerificationCheck[];

  /** Per-test timeout in milliseconds. Default: 120_000. */
  timeoutMs?: number;

  /** Tags for filtering (e.g. ["settings", "clock"]). */
  tags?: string[];
}

/** Result of a single verification check. */
export interface CheckResult {
  name: string;
  pass: boolean;
  message: string;
  actualOutput?: string;
}

/** Result of running a single test case. */
export interface TestResult {
  testId: string;
  testName: string;
  provider: string;
  pass: boolean;
  checks: CheckResult[];
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

/** Aggregate results for a full test run. */
export interface TestRunSummary {
  provider: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: TestResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
}
