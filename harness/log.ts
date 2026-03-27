// ANSI color codes
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

/** Prefix for harness messages. */
export function harness(msg: string): void {
  console.log(`${CYAN}[harness]${RESET} ${msg}`);
}

/** Prefix for harness errors. */
export function harnessError(msg: string): void {
  console.error(`${RED}[harness]${RESET} ${msg}`);
}

/** Prefix for verification results. */
export function check(pass: boolean, msg: string): void {
  const icon = pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`${CYAN}[harness]${RESET} [${icon}] ${msg}`);
}

/** Print a test header. */
export function testHeader(name: string, id: string): void {
  console.log(`\n${BOLD}--- ${name} (${id}) ---${RESET}`);
}

/** Print a test result. */
export function testResult(pass: boolean): void {
  const msg = pass ? `${GREEN}PASSED${RESET}` : `${RED}FAILED${RESET}`;
  console.log(`${CYAN}[harness]${RESET} Result: ${msg}`);
}

const MAX_MODEL_LINE_LENGTH = 500;

/**
 * Write a chunk of LLM output to stdout with a dim prefix.
 * Lines are truncated for console readability.
 */
export function modelChunk(chunk: Uint8Array): void {
  const text = new TextDecoder().decode(chunk);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === lines.length - 1 && line === "") continue;
    const display = line.length > MAX_MODEL_LINE_LENGTH
      ? line.slice(0, MAX_MODEL_LINE_LENGTH) + "..."
      : line;
    process.stdout.write(`${DIM}${MAGENTA}[model]${RESET}${DIM} ${display}${RESET}\n`);
  }
}
