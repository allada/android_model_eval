import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestRunSummary, TestResult, CheckResult } from "../harness/types.ts";

const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "results");
const DB_DIR = join(ROOT, "db");
const DB_PATH = join(DB_DIR, "eval.sqlite");
const IMAGES_DIR = join(DB_DIR, "images");

function createTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      filename          TEXT NOT NULL UNIQUE,
      provider          TEXT NOT NULL,
      model             TEXT NOT NULL,
      effort            TEXT,
      total_tests       INTEGER NOT NULL,
      passed            INTEGER NOT NULL,
      failed            INTEGER NOT NULL,
      started_at        TEXT NOT NULL,
      completed_at      TEXT NOT NULL,
      total_duration_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      test_run_id       INTEGER NOT NULL REFERENCES test_runs(id),
      test_id           TEXT NOT NULL,
      test_name         TEXT NOT NULL,
      provider          TEXT NOT NULL,
      pass              INTEGER NOT NULL,
      duration_ms       INTEGER NOT NULL,
      error             TEXT,
      input_tokens      INTEGER,
      output_tokens     INTEGER,
      thinking_tokens   INTEGER,
      video_path        TEXT,
      recording_started_at_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_test_id ON test_results(test_id);

    CREATE TABLE IF NOT EXISTS checks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      test_result_id    INTEGER NOT NULL REFERENCES test_results(id),
      name              TEXT NOT NULL,
      pass              INTEGER NOT NULL,
      message           TEXT NOT NULL,
      actual_output     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checks_result ON checks(test_result_id);

    CREATE TABLE IF NOT EXISTS messages (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      test_result_id    INTEGER NOT NULL REFERENCES test_results(id),
      seq               INTEGER NOT NULL,
      event_type        TEXT NOT NULL,
      event_subtype     TEXT,
      tool_name         TEXT,
      content           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_result ON messages(test_result_id);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(event_type);

    CREATE TABLE IF NOT EXISTS images (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id        INTEGER NOT NULL REFERENCES messages(id),
      test_result_id    INTEGER NOT NULL REFERENCES test_results(id),
      seq_in_message    INTEGER NOT NULL DEFAULT 0,
      filename          TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_images_message ON images(message_id);
    CREATE INDEX IF NOT EXISTS idx_images_result ON images(test_result_id);
  `);
}

function deleteRunData(db: Database, runId: number) {
  // Get all test_result ids for this run
  const resultIds = db
    .prepare("SELECT id FROM test_results WHERE test_run_id = ?")
    .all(runId) as { id: number }[];

  for (const { id } of resultIds) {
    db.prepare("DELETE FROM images WHERE test_result_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE test_result_id = ?").run(id);
    db.prepare("DELETE FROM checks WHERE test_result_id = ?").run(id);
  }
  db.prepare("DELETE FROM test_results WHERE test_run_id = ?").run(runId);
  db.prepare("DELETE FROM test_runs WHERE id = ?").run(runId);
}

interface ImageRecord {
  seqInMessage: number;
  filename: string;
}

function extractAndReplaceImages(
  parsed: any,
  imgDir: string,
  seq: number
): ImageRecord[] {
  const images: ImageRecord[] = [];

  // Codex format: item.completed with screenshot tool
  if (parsed.type === "item.completed" && parsed.item?.tool === "screenshot") {
    const content = parsed.item?.result?.content;
    if (Array.isArray(content)) {
      for (let i = 0; i < content.length; i++) {
        if (content[i].type === "image" && content[i].data) {
          const leafName = `${seq}_${i}.png`;
          mkdirSync(imgDir, { recursive: true });
          writeFileSync(
            join(imgDir, leafName),
            Buffer.from(content[i].data, "base64")
          );
          content[i].data = `<image:${leafName}>`;
          images.push({ seqInMessage: i, filename: leafName });
        }
      }
    }
  }

  // Claude format: user message with tool_result containing image
  if (parsed.type === "user" && parsed.message?.content) {
    let imgIdx = 0;
    for (const block of parsed.message.content) {
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === "image" && item.source?.data) {
            const leafName = `${seq}_${imgIdx}.png`;
            mkdirSync(imgDir, { recursive: true });
            writeFileSync(
              join(imgDir, leafName),
              Buffer.from(item.source.data, "base64")
            );
            item.source.data = `<image:${leafName}>`;
            images.push({ seqInMessage: imgIdx, filename: leafName });
            imgIdx++;
          }
        }
      }
    }
    // Also replace in tool_use_result if it mirrors the content
    if (Array.isArray(parsed.tool_use_result)) {
      for (const item of parsed.tool_use_result) {
        if (item.type === "image" && item.source?.data) {
          item.source.data = `<image:replaced>`;
        }
      }
    }
  }

  return images;
}

function getEventMeta(parsed: any): {
  eventType: string;
  eventSubtype: string | null;
  toolName: string | null;
} {
  const eventType = parsed.type ?? "unknown";
  let eventSubtype: string | null = parsed.subtype ?? null;
  let toolName: string | null = null;

  // Codex format
  if (parsed.item?.type) eventSubtype = parsed.item.type;
  if (parsed.item?.tool) toolName = parsed.item.tool;

  // Claude format - extract tool name from assistant messages
  if (parsed.type === "assistant" && parsed.message?.content) {
    for (const block of parsed.message.content) {
      if (block.type === "tool_use") {
        toolName = block.name;
        break;
      }
    }
  }

  return { eventType, eventSubtype, toolName };
}

function processFile(db: Database, filename: string) {
  console.log(`Processing ${filename}...`);

  // Idempotency: delete existing data
  const existing = db
    .prepare("SELECT id FROM test_runs WHERE filename = ?")
    .get(filename) as { id: number } | null;
  if (existing) {
    console.log(`  Replacing existing run id=${existing.id}`);
    deleteRunData(db, existing.id);
    rmSync(join(IMAGES_DIR, String(existing.id)), {
      recursive: true,
      force: true,
    });
  }

  const data: TestRunSummary = JSON.parse(
    readFileSync(join(RESULTS_DIR, filename), "utf-8")
  );

  // Prepared statements
  const insertRun = db.prepare(`
    INSERT INTO test_runs (filename, provider, model, effort, total_tests, passed, failed, started_at, completed_at, total_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResult = db.prepare(`
    INSERT INTO test_results (test_run_id, test_id, test_name, provider, pass, duration_ms, error, input_tokens, output_tokens, thinking_tokens, video_path, recording_started_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCheck = db.prepare(`
    INSERT INTO checks (test_result_id, name, pass, message, actual_output)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (test_result_id, seq, event_type, event_subtype, tool_name, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertImage = db.prepare(`
    INSERT INTO images (message_id, test_result_id, seq_in_message, filename)
    VALUES (?, ?, ?, ?)
  `);

  const runResult = insertRun.run(
    filename,
    data.provider,
    data.model,
    data.effort ?? null,
    data.totalTests,
    data.passed,
    data.failed,
    data.startedAt,
    data.completedAt,
    data.totalDurationMs
  );
  const runId = Number(runResult.lastInsertRowid);
  console.log(`  Run id=${runId}, ${data.results.length} test results`);

  let totalImages = 0;
  let totalMessages = 0;

  for (const result of data.results) {
    const resResult = insertResult.run(
      runId,
      result.testId,
      result.testName,
      result.provider,
      result.pass ? 1 : 0,
      result.durationMs,
      result.error ?? null,
      result.tokenUsage?.inputTokens ?? null,
      result.tokenUsage?.outputTokens ?? null,
      result.tokenUsage?.thinkingTokens ?? null,
      (result as any).videoPath ?? null,
      (result as any).recordingStartedAtMs ?? null
    );
    const resultId = Number(resResult.lastInsertRowid);

    for (const check of result.checks) {
      insertCheck.run(
        resultId,
        check.name,
        check.pass ? 1 : 0,
        check.message,
        check.actualOutput ?? null
      );
    }

    if (result.rawOutput) {
      const lines = result.rawOutput.split("\n").filter((l) => l.trim());
      const imgDir = join(IMAGES_DIR, String(runId), result.testId);

      for (let seq = 0; seq < lines.length; seq++) {
        let parsed: any;
        try {
          parsed = JSON.parse(lines[seq]);
        } catch {
          // Store unparseable lines as-is
          insertMessage.run(resultId, seq, "parse_error", null, null, lines[seq]);
          totalMessages++;
          continue;
        }

        const imageRecords = extractAndReplaceImages(parsed, imgDir, seq);
        const { eventType, eventSubtype, toolName } = getEventMeta(parsed);

        const msgResult = insertMessage.run(
          resultId,
          seq,
          eventType,
          eventSubtype,
          toolName,
          JSON.stringify(parsed)
        );
        const messageId = Number(msgResult.lastInsertRowid);
        totalMessages++;

        for (const img of imageRecords) {
          // Store full relative path from db/ for easy reconstruction
          const fullFilename = `${runId}/${result.testId}/${img.filename}`;
          insertImage.run(messageId, resultId, img.seqInMessage, fullFilename);
          totalImages++;
        }
      }
    }
  }

  console.log(
    `  Done: ${totalMessages} messages, ${totalImages} images extracted`
  );
}

async function main() {
  mkdirSync(DB_DIR, { recursive: true });
  mkdirSync(IMAGES_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  createTables(db);

  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} result files\n`);

  for (const file of files) {
    const tx = db.transaction(() => {
      processFile(db, file);
    });
    tx();
  }

  // Print summary
  const runCount = (
    db.prepare("SELECT COUNT(*) as c FROM test_runs").get() as any
  ).c;
  const resultCount = (
    db.prepare("SELECT COUNT(*) as c FROM test_results").get() as any
  ).c;
  const msgCount = (
    db.prepare("SELECT COUNT(*) as c FROM messages").get() as any
  ).c;
  const imgCount = (
    db.prepare("SELECT COUNT(*) as c FROM images").get() as any
  ).c;

  console.log(`\n=== Summary ===`);
  console.log(`Test runs:    ${runCount}`);
  console.log(`Test results: ${resultCount}`);
  console.log(`Messages:     ${msgCount}`);
  console.log(`Images:       ${imgCount}`);
  console.log(`Database:     ${DB_PATH}`);

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
