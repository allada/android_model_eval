import type { AdminClient } from "./admin_client.ts";

/** Result from a custom verification function. */
export interface VerificationResult {
  pass: boolean;
  message: string;
}

/**
 * A thin shell interface used by setup/verification steps.
 * Backed by the admin API's runAdbCommand endpoint.
 */
export interface SessionAdminContext {
  /** Run an ADB shell command and return stdout. */
  adbShell(command: string): Promise<string>;
}

/** A single check to run against device state after the LLM finishes. */
export interface VerificationCheck {
  /** Human-readable name shown in reports. */
  name: string;

  /**
   * ADB shell command (string) or async function returning command output.
   * Strings are executed via the admin API's runAdbCommand.
   */
  command: string | ((sessionAdminCtx: SessionAdminContext) => Promise<string>);

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
   * Strings are executed via the admin API. Functions receive a SessionAdminContext.
   * Executed sequentially.
   */
  setup: Array<string | ((sessionAdminCtx: SessionAdminContext) => Promise<void>)>;

  /** Checks to run after the LLM completes or times out. */
  verifications: VerificationCheck[];

  /**
   * Optional check against the LLM's raw output (stdout+stderr).
   * Useful for tests where the LLM needs to report information back
   * (e.g. reading a verification code from the screen).
   */
  rawOutputCheck?: (rawOutput: string) => VerificationResult;

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

import type { TokenUsage } from "./providers/types.ts";

/** Result of running a single test case. */
export interface TestResult {
  testId: string;
  testName: string;
  provider: string;
  pass: boolean;
  checks: CheckResult[];
  durationMs: number;
  error?: string;
  /** Token usage for this test. */
  tokenUsage?: TokenUsage;
  /** Raw output from the LLM process. */
  rawOutput?: string;
}

/** Aggregate results for a full test run. */
export interface TestRunSummary {
  provider: string;
  model: string;
  effort?: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: TestResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
}
