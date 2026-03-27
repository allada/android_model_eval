import type { TestCase } from "../types.ts";

export const airplaneModeOn: TestCase = {
  id: "airplane-mode-on",
  name: "Turn on airplane mode",
  prompt: "Turn on airplane mode on.",
  setup: [
    // Ensure airplane mode is OFF before the test
    "cmd connectivity airplane-mode disable",
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
  prompt: "Turn off airplane mode on.",
  setup: [
    // Ensure airplane mode is ON before the test
    "cmd connectivity airplane-mode enable",
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
