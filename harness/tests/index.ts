import type { TestCase } from "../types.ts";
import { airplaneModeOn, airplaneModeOff } from "./airplane-mode.ts";
import { setAlarm5pm } from "./set-alarm.ts";
import { uninstallCalculator } from "./uninstall-app.ts";

/** All available test cases. */
export const allTests: TestCase[] = [
  airplaneModeOn,
  airplaneModeOff,
  setAlarm5pm,
  uninstallCalculator,
];

/** Filter tests by ID. */
export function filterById(tests: TestCase[], id: string): TestCase[] {
  return tests.filter((t) => t.id === id);
}

/** Filter tests by tag. */
export function filterByTag(tests: TestCase[], tag: string): TestCase[] {
  return tests.filter((t) => t.tags?.includes(tag));
}
