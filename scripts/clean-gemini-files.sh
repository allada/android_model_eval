#!/usr/bin/env bash
set -euo pipefail

# Clean _geminiClient from Gemini result files.
# Processes each file by extracting rawOutput per result via jq,
# cleaning MESSAGE_BUS lines, and reassembling.

for f in results/*gemini*.json; do
  [ -f "$f" ] || continue
  SIZE=$(stat -c%s "$f")
  echo "Processing $(basename "$f") ($(numfmt --to=iec $SIZE))..."

  TMPFILE="${f}.tmp"

  # Use jq to stream-process: for each result, clean rawOutput line by line
  # jq can handle large files in streaming mode
  bun -e "
    const fs = require('fs');
    const { execSync } = require('child_process');

    // Read the file structure without rawOutput first
    const file = '${f}';

    // Use jq to get number of results and metadata
    const meta = JSON.parse(execSync('jq \"{provider, model, effort, totalTests, passed, failed, startedAt, completedAt, totalDurationMs}\" ' + JSON.stringify(file)).toString());

    // Get result count
    const countStr = execSync('jq \".results | length\" ' + JSON.stringify(file)).toString().trim();
    const count = parseInt(countStr);

    // Open output file
    const fh = fs.openSync('${TMPFILE}', 'w');

    // Write header
    const header = JSON.stringify(meta, null, 2);
    fs.writeSync(fh, header.slice(0, -2) + ',\n  \"results\": [\n');

    for (let i = 0; i < count; i++) {
      process.stderr.write('  result ' + i + '/' + count + '...\r');

      // Extract result without rawOutput
      const resultMeta = JSON.parse(execSync(
        'jq -c \".results[' + i + '] | del(.rawOutput)\" ' + JSON.stringify(file)
      ).toString());

      // Extract rawOutput and clean it line by line
      const rawOutput = execSync(
        'jq -r \".results[' + i + '].rawOutput // empty\" ' + JSON.stringify(file),
        { maxBuffer: 2 * 1024 * 1024 * 1024 }
      ).toString();

      const cleanedLines = rawOutput.split('\n').map(line => {
        if (!line.includes('[MESSAGE_BUS]')) return line;
        const jsonStart = line.indexOf('{');
        if (jsonStart < 0) return line;
        const prefix = line.substring(0, jsonStart);
        try {
          const obj = JSON.parse(line.substring(jsonStart));
          if (Array.isArray(obj.toolCalls)) {
            for (const tc of obj.toolCalls) {
              if (tc.tool) {
                delete tc.tool.messageBus;
                delete tc.tool.mcpTool;
                delete tc.tool._geminiClient;
                delete tc.tool.cliConfig;
              }
              const strip = (o) => {
                if (!o || typeof o !== 'object') return;
                delete o._geminiClient;
                for (const v of Object.values(o)) strip(v);
              };
              strip(tc);
            }
          }
          return prefix + JSON.stringify(obj);
        } catch {
          return line;
        }
      });

      resultMeta.rawOutput = cleanedLines.join('\n');

      const comma = i < count - 1 ? ',' : '';

      // Write this result - stream the rawOutput field
      const { rawOutput: ro, ...rest } = resultMeta;
      fs.writeSync(fh, '    ' + JSON.stringify(rest).slice(0, -1) + ',\"rawOutput\":\"');
      const CHUNK = 2 * 1024 * 1024;
      for (let j = 0; j < ro.length; j += CHUNK) {
        const escaped = JSON.stringify(ro.slice(j, j + CHUNK));
        fs.writeSync(fh, escaped.slice(1, -1));
      }
      fs.writeSync(fh, '\"' + '}' + comma + '\n');

      // Free memory
      resultMeta.rawOutput = null;
    }

    fs.writeSync(fh, '  ]\n}\n');
    fs.closeSync(fh);
    process.stderr.write('\n');
  " 2>&1

  # Validate the output
  if jq empty "${TMPFILE}" 2>/dev/null; then
    NEWSIZE=$(stat -c%s "${TMPFILE}")
    echo "  Valid JSON. $(numfmt --to=iec $SIZE) → $(numfmt --to=iec $NEWSIZE) ($(( (SIZE - NEWSIZE) * 100 / SIZE ))% reduction)"
    mv "${TMPFILE}" "${f}"
  else
    echo "  ERROR: Invalid JSON output, keeping original"
    rm -f "${TMPFILE}"
  fi
done

echo "Done."
