import type { TestCase } from "../types.ts";

export function makeVerificationCodeTest(): TestCase {
  const code = String(Math.floor(100000 + Math.random() * 900000));

  return {
    id: "get-verification-code",
    name: "Get verification code from text message",
    prompt:
      "You just received a text message with a verification code. Open the Messages app, find the verification code, and tell me what it is.",
    setup: [
      "input keyevent HOME",
      async (sessionAdminCtx) => {
        // Use the emulator console to simulate an incoming SMS.
        // `content insert` into the SMS provider silently fails on Android 16+.
        await sessionAdminCtx.adbEmu(
          `sms send 555-1234 Your verification code is ${code}. It expires in 10 minutes.`,
        );
      },
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
