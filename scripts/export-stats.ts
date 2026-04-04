import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestRunSummary } from "../harness/types.ts";

const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "results");
const CSV_PATH = join(ROOT, "stats.csv");
const JSON_PATH = join(ROOT, "widget", "data", "stats.json");

// ── Read all results ──
const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));

interface RawRow {
  testId: string;
  testName: string;
  provider: string;
  model: string;
  effort: string;
  pass: boolean;
  timedOut: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

const rawRows: RawRow[] = [];

for (const file of files) {
  const raw = readFileSync(join(RESULTS_DIR, file), "utf8");
  const run = JSON.parse(raw) as TestRunSummary;

  for (const r of run.results) {
    rawRows.push({
      testId: r.testId,
      testName: r.testName,
      provider: run.provider,
      model: run.model,
      effort: run.effort ?? "",
      pass: r.pass,
      timedOut: /timed?\s*out/i.test(r.error ?? ""),
      durationMs: r.durationMs,
      inputTokens: r.tokenUsage?.inputTokens ?? 0,
      outputTokens: r.tokenUsage?.outputTokens ?? 0,
    });
  }
}

// ── CSV (flat, one row per test run) ──
const header = "test_id,test_name,provider,model,effort,pass,duration_ms,input_tokens,output_tokens";
const csvRows = [header];
for (const r of rawRows) {
  csvRows.push([
    esc(r.testId), esc(r.testName), esc(r.provider), esc(r.model), esc(r.effort),
    r.pass ? "true" : "false", r.durationMs, r.inputTokens, r.outputTokens,
  ].join(","));
}
writeFileSync(CSV_PATH, csvRows.join("\n") + "\n");
console.log(`Wrote ${csvRows.length - 1} rows to ${CSV_PATH}`);

// ── JSON (aggregated per model×test, with Wilson CIs) ──
interface GroupKey { testId: string; testName: string; model: string; provider: string }
interface AggRow extends GroupKey {
  runs: number;
  passes: number;
  fails: number;
  timeouts: number;
  passRate: number;
  ciLower: number;
  ciUpper: number;
  avgDurationS: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  // Pass-only averages (null if no passes)
  passAvgDurationS: number | null;
  passAvgInputTokens: number | null;
  passAvgOutputTokens: number | null;
}

const groups = new Map<string, { key: GroupKey; rows: RawRow[] }>();

for (const r of rawRows) {
  const k = `${r.testId}||${r.model}`;
  if (!groups.has(k)) {
    groups.set(k, {
      key: { testId: r.testId, testName: r.testName, model: r.model, provider: r.provider },
      rows: [],
    });
  }
  groups.get(k)!.rows.push(r);
}

const aggRows: AggRow[] = [];

for (const { key, rows } of groups.values()) {
  const n = rows.length;
  const p = rows.filter((r) => r.pass).length;
  const pHat = n > 0 ? p / n : 0;
  const [ciLo, ciHi] = wilsonCI(p, n);

  const passRows = rows.filter((r) => r.pass);
  const pCount = passRows.length;

  aggRows.push({
    ...key,
    runs: n,
    passes: p,
    fails: n - p,
    timeouts: rows.filter((r) => r.timedOut).length,
    passRate: round4(pHat * 100),
    ciLower: round4(ciLo * 100),
    ciUpper: round4(ciHi * 100),
    avgDurationS: round4(rows.reduce((s, r) => s + r.durationMs, 0) / n / 1000),
    avgInputTokens: Math.round(rows.reduce((s, r) => s + r.inputTokens, 0) / n),
    avgOutputTokens: Math.round(rows.reduce((s, r) => s + r.outputTokens, 0) / n),
    passAvgDurationS: pCount > 0 ? round4(passRows.reduce((s, r) => s + r.durationMs, 0) / pCount / 1000) : null,
    passAvgInputTokens: pCount > 0 ? Math.round(passRows.reduce((s, r) => s + r.inputTokens, 0) / pCount) : null,
    passAvgOutputTokens: pCount > 0 ? Math.round(passRows.reduce((s, r) => s + r.outputTokens, 0) / pCount) : null,
  });
}

aggRows.sort((a, b) => a.testId.localeCompare(b.testId) || a.model.localeCompare(b.model));

writeFileSync(JSON_PATH, JSON.stringify(aggRows, null, 2));
console.log(`Wrote ${aggRows.length} aggregated rows to ${JSON_PATH}`);

// ── Helpers ──
function esc(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function wilsonCI(passes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const pHat = passes / n;
  const denom = 1 + z * z / n;
  const center = pHat + z * z / (2 * n);
  const margin = z * Math.sqrt((pHat * (1 - pHat) + z * z / (4 * n)) / n);
  return [
    Math.max(0, (center - margin) / denom),
    Math.min(1, (center + margin) / denom),
  ];
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
