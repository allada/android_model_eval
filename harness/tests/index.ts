import type { TestCase } from "../types.ts";
import { airplaneModeOn, airplaneModeOff } from "./airplane-mode.ts";
import { setAlarm5pm } from "./set-alarm.ts";
import { uninstallCalculator } from "./uninstall-app.ts";
import { makeVerificationCodeTest } from "./verification-code.ts";

/** All available test cases. */
export const allTests: TestCase[] = [
  airplaneModeOn,
  airplaneModeOff,
  setAlarm5pm,
  uninstallCalculator,
  makeVerificationCodeTest(),
];

