import type { TestCase } from "../types.ts";
import { packageInstalled } from "../verification/checks.ts";

const FOCUS_APK_URL =
  "https://github.com/mozilla-mobile/focus-android/releases/download/v108.1.0/focus-108.1.0-x86_64.apk";
const FOCUS_PACKAGE = "org.mozilla.focus";

/**
 * Test that the LLM can uninstall an app.
 *
 * Downloads and installs Firefox Focus, then asks the LLM to remove it.
 */
export const uninstallApp: TestCase = {
  id: "uninstall-app",
  name: "Uninstall the Firefox Focus app",
  prompt: [
    "There is an app called Firefox Focus installed on this device.",
    "The icon looks like the firefox logo, but purple.",
    "Find it and uninstall it.",
  ].join(" "),
  setup: [
    async (ctx) => {
      const packages = await ctx.adbShell("pm list packages");
      if (packages.includes(FOCUS_PACKAGE)) return;
      await ctx.downloadFile(FOCUS_APK_URL, "/data/local/tmp/focus.apk");
      await ctx.adbShell("pm install /data/local/tmp/focus.apk");
      await ctx.adbShell("rm /data/local/tmp/focus.apk");
    },
  ],
  verifications: [packageInstalled(FOCUS_PACKAGE, false)],
  timeoutMs: 120_000,
  tags: ["apps", "uninstall"],
};
