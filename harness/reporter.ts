import { mkdir, writeFile, open } from "node:fs/promises";
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
  const effortSuffix = summary.effort ? `-${summary.effort}` : "";
  const filename = `${timestamp}-${summary.provider}${effortSuffix}.json`;
  const filepath = join(resultsDir, filename);

  // Write incrementally to avoid OOM on large rawOutput blobs.
  const fh = await open(filepath, "w");
  try {
    const { results, ...rest } = summary;
    // Write everything except results array
    const header = JSON.stringify(rest, null, 2);
    // Replace closing } with results array start
    await fh.write(header.slice(0, -2) + ',\n  "results": [\n');

    for (let i = 0; i < results.length; i++) {
      const comma = i < results.length - 1 ? "," : "";
      // Write each result field-by-field to avoid OOM on large rawOutput strings.
      const { rawOutput, ...resultRest } = results[i];
      const prefix = JSON.stringify(resultRest);

      if (rawOutput != null) {
        await fh.write("    " + prefix.slice(0, -1) + ',"rawOutput":"');
        // Stream rawOutput in chunks. JSON.stringify each chunk independently
        // to get correct escaping, then strip the surrounding quotes.
        const CHUNK = 2 * 1024 * 1024;
        for (let j = 0; j < rawOutput.length; j += CHUNK) {
          const escaped = JSON.stringify(rawOutput.slice(j, j + CHUNK));
          await fh.write(escaped.slice(1, -1));
        }
        await fh.write('"' + "}" + comma + "\n");
      } else {
        await fh.write("    " + prefix + comma + "\n");
      }
    }

    await fh.write("  ]\n}\n");
  } finally {
    await fh.close();
  }
  console.log(`Results written to ${filepath}`);
  return filepath;
}
