import type { TestCase } from "../types.ts";

export const setAlarm5pm: TestCase = {
  id: "set-alarm-5pm",
  name: "Set an alarm for 5:00 PM",
  prompt: "Set an alarm for 5:00 PM on this Android device.",
  setup: [
    // Clear any existing alarms by force-stopping the clock app
    "am force-stop com.google.android.deskclock",
  ],
  verifications: [
    {
      name: "Clock app has a pending alarm for 17:00",
      // Only check the active "Pending alarm batches" section (before "Past-due"),
      // so we don't match cancelled/historical entries.
      command: "dumpsys alarm | sed '/Past-due/,$d' | grep -A2 'com.google.android.deskclock'",
      expected: (output: string) => {
        // dumpsys alarm shows origWhen with local time like "origWhen=2026-03-26 17:00:00.000"
        const has5pm = /17:00/.test(output);
        return {
          pass: has5pm,
          message: has5pm
            ? "Found 17:00 alarm in dumpsys"
            : `No 17:00 alarm found. Output: ${output}`,
        };
      },
    },
  ],
  timeoutMs: 120_000,
  tags: ["clock", "alarm"],
};
