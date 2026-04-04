import type { TestCase } from "../types.ts";
import { airplaneModeOn, airplaneModeOff } from "./airplane-mode.ts";
import { setAlarm5pm } from "./set-alarm.ts";
import { uninstallApp } from "./uninstall-app.ts";
/** All available test cases. */
export const allTests: TestCase[] = [
  airplaneModeOn,
  airplaneModeOff,
  setAlarm5pm,
  uninstallApp,
];

