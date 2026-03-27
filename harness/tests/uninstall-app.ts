import type { TestCase } from "../types.ts";
import { packageInstalled } from "../verification/checks.ts";

/**
 * Test that the LLM can uninstall an app.
 *
 * Uses the Calculator app as a target since it's a non-critical system app
 * that can be uninstalled on most emulator images. Adjust the package name
 * if your emulator image uses a different calculator.
 */
export const uninstallCalculator: TestCase = {
  id: "uninstall-calculator",
  name: "Uninstall the Calculator app",
  prompt: "Uninstall the Calculator app from this Android sessionAdminCtx.",
  setup: [
    // Ensure the calculator is installed (re-install if previously removed)
    async (sessionAdminCtx) => {
      const packages = await sessionAdminCtx.adbShell("pm list packages | grep calc");
      if (!packages.includes("com.google.android.calculator")) {
        await sessionAdminCtx.adbShell(
          "pm install-existing com.google.android.calculator || true",
        );
      }
    },
  ],
  verifications: [
    packageInstalled("com.google.android.calculator", false),
  ],
  timeoutMs: 120_000,
  tags: ["apps", "uninstall"],
};
