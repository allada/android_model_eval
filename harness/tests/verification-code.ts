import type { TestCase } from "../types.ts";

export function makeVerificationCodeTest(): TestCase {
  const code = String(Math.floor(100000 + Math.random() * 900000));

  return {
    id: "get-verification-code",
    name: "Get verification code from text message",
    prompt:
      "You just received a text message with a verification code. Open the Messages app, find the verification code, and tell me what it is.",
    setup: [
      "settings put secure sms_default_application com.google.android.apps.messaging",
      "content delete --uri content://sms",
      async (sessionAdminCtx) => {
        await sessionAdminCtx.adbShell(
          `content insert --uri content://sms --bind address:s:555-1234 --bind body:s:'Your verification code is ${code}. It expires in 10 minutes.' --bind type:i:1 --bind read:i:0 --bind seen:i:0 --bind date:l:${Date.now()}`,
        );
      },
      "input keyevent HOME",
    ],
    verifications: [],
    rawOutputCheck: (rawOutput: string) => {
      const found = rawOutput.includes(code);
      return {
        pass: found,
        message: found
          ? `Model reported verification code ${code}`
          : `Model did not report verification code ${code} in output`,
      };
    },
    timeoutMs: 120_000,
    tags: ["messaging", "verification"],
  };
}
