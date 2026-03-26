import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestRunSummary } from "./types.ts";

/** Print a human-readable summary to the console. */
export function printSummary(summary: TestRunSummary): void {
  console.log("\n========================================");
  console.log(`Provider: ${summary.provider}`);
  console.log(`Tests:    ${summary.passed}/${summary.totalTests} passed`);
  console.log(`Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log("========================================\n");

  for (const result of summary.results) {
    const icon = result.pass ? "PASS" : "FAIL";
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    console.log(`  [${icon}] ${result.testName} (${duration})`);

    if (!result.pass) {
      if (result.error) {
        console.log(`         Error: ${result.error}`);
      }
      if (result.timedOut) {
        console.log(`         Timed out`);
      }
      for (const check of result.checks) {
        if (!check.pass) {
          console.log(`         - ${check.name}: ${check.message}`);
        }
      }
    }
  }

  console.log("");
}

/** Write the full summary to a JSON file in results/. */
export async function writeJsonReport(
  summary: TestRunSummary,
  resultsDir: string = join(process.cwd(), "results"),
): Promise<string> {
  await mkdir(resultsDir, { recursive: true });

  const timestamp = summary.startedAt.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${summary.provider}.json`;
  const filepath = join(resultsDir, filename);

  await writeFile(filepath, JSON.stringify(summary, null, 2));
  console.log(`Results written to ${filepath}`);
  return filepath;
}
