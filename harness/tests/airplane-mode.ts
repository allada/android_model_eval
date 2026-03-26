import type { TestCase } from "../types.ts";

export const airplaneModeOn: TestCase = {
  id: "airplane-mode-on",
  name: "Turn on airplane mode",
  prompt: "Turn on airplane mode on",
  setup: [
    "settings put global airplane_mode_on 0",
    "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false",
    "input keyevent HOME",
  ],
  verifications: [
    {
      name: "airplane_mode_on is 1",
      command: "settings get global airplane_mode_on",
      expected: "1",
    },
  ],
  timeoutMs: 90_000,
  tags: ["settings", "connectivity"],
};

export const airplaneModeOff: TestCase = {
  id: "airplane-mode-off",
  name: "Turn off airplane mode",
  prompt: "Turn off airplane mode on",
  setup: [
    "settings put global airplane_mode_on 1",
    "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true",
    "input keyevent HOME",
  ],
  verifications: [
    {
      name: "airplane_mode_on is 0",
      command: "settings get global airplane_mode_on",
      expected: "0",
    },
  ],
  timeoutMs: 90_000,
  tags: ["settings", "connectivity"],
};
