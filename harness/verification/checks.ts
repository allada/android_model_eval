import type { SessionAdminContext, VerificationCheck, VerificationResult } from "../types.ts";

/** Check that an Android setting has a specific value. */
export function settingEquals(
  namespace: "system" | "secure" | "global",
  key: string,
  expectedValue: string,
): VerificationCheck {
  return {
    name: `${namespace}/${key} equals "${expectedValue}"`,
    command: `settings get ${namespace} ${key}`,
    expected: expectedValue,
  };
}

/** Check that a package is (or is not) installed. */
export function packageInstalled(
  packageName: string,
  shouldExist: boolean = true,
): VerificationCheck {
  return {
    name: shouldExist
      ? `${packageName} is installed`
      : `${packageName} is not installed`,
    command: "pm list packages",
    expected: (output: string): VerificationResult => {
      const found = output.split("\n").some((line) =>
        line.trim() === `package:${packageName}`,
      );
      if (shouldExist) {
        return {
          pass: found,
          message: found
            ? `Package ${packageName} is installed`
            : `Package ${packageName} not found`,
        };
      }
      return {
        pass: !found,
        message: found
          ? `Package ${packageName} is still installed`
          : `Package ${packageName} was removed`,
      };
    },
  };
}

/** Check that an ADB shell command output matches a regex. */
export function shellMatches(
  name: string,
  command: string,
  pattern: RegExp,
): VerificationCheck {
  return { name, command, expected: pattern };
}

/** Arbitrary async verification using the device shell directly. */
export function custom(
  name: string,
  fn: (sessionAdminCtx: SessionAdminContext) => Promise<VerificationResult>,
): VerificationCheck {
  return {
    name,
    command: async (sessionAdminCtx) => {
      const result = await fn(sessionAdminCtx);
      return JSON.stringify(result);
    },
    expected: (output: string): VerificationResult => {
      return JSON.parse(output) as VerificationResult;
    },
  };
}
