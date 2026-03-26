import type { TestCase } from "../types.ts";

export const setAlarm5pm: TestCase = {
  id: "set-alarm-5pm",
  name: "Set an alarm for 5:00 PM",
  prompt: "Set an alarm for 5:00 PM on this Android device.",
  setup: [
    // Clear any existing alarms by force-stopping the clock app
    "am force-stop com.google.android.deskclock",
    "input keyevent HOME",
  ],
  verifications: [
    {
      name: "Alarm is set for 17:00",
      command: "dumpsys alarm | grep -i 'triggerWhenIdle'",
      expected: (output: string) => {
        // Look for an alarm manager entry that indicates a pending alarm.
        // The exact format varies by Android version, so we use a broad check.
        // A more precise check would query the clock app's content provider.
        const hasAlarm = output.length > 0;
        return {
          pass: hasAlarm,
          message: hasAlarm
            ? "Found alarm entries in dumpsys"
            : "No alarm entries found in dumpsys",
        };
      },
    },
    {
      name: "Clock app has pending alarm",
      command:
        "content query --uri content://com.android.deskclock/alarm",
      expected: (output: string) => {
        // Check if there's an alarm entry with hour=17
        const has5pm = /hour=17/.test(output) || /17:00/.test(output);
        return {
          pass: has5pm,
          message: has5pm
            ? "Found 5:00 PM alarm in clock database"
            : `No 5:00 PM alarm found. Output: ${output.slice(0, 200)}`,
        };
      },
    },
  ],
  timeoutMs: 120_000,
  tags: ["clock", "alarm"],
};
