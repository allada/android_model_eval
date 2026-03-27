import { Adb } from "@devicefarmer/adbkit";
import type DeviceClient from "@devicefarmer/adbkit/dist/src/adb/DeviceClient.js";

export class AdbService {
  private device: DeviceClient;
  readonly serial: string;

  constructor(serial: string) {
    const client = Adb.createClient();
    this.device = client.getDevice(serial);
    this.serial = serial;
  }

  async shell(command: string): Promise<string> {
    const stream = await this.device.shell(command);
    const buf = await Adb.util.readAll(stream);
    return buf.toString();
  }

  async tap(x: number, y: number): Promise<void> {
    await this.shell(`input tap ${x} ${y}`);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number = 300): Promise<void> {
    await this.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
  }

  // A zero-distance swipe acts as a long-press in Android.
  async longPress(x: number, y: number, durationMs: number = 1000): Promise<void> {
    await this.shell(`input swipe ${x} ${y} ${x} ${y} ${durationMs}`);
  }

  async keyEvent(key: string): Promise<void> {
    const keycode = key.startsWith("KEYCODE_") ? key : `KEYCODE_${key.toUpperCase()}`;
    await this.shell(`input keyevent ${keycode}`);
  }

  async screenshot(): Promise<Buffer> {
    const stream = await this.device.screencap();
    return await Adb.util.readAll(stream);
  }

  async getScreenSize(): Promise<string> {
    const output = await this.shell("wm size");
    return output.trim();
  }

  // Sends a command to the emulator console (e.g. "avd snapshot save foo").
  // Uses `adb emu` which forwards to the emulator's telnet console.
  private async emuCommand(command: string): Promise<string> {
    const proc = Bun.spawn(["adb", "-s", this.serial, "emu", ...command.split(" ")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    if (exitCode !== 0 || stdout.includes("KO")) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`emu command failed: ${stdout.trim()} ${stderr.trim()}`);
    }
    return stdout;
  }

  async saveSnapshot(name: string): Promise<void> {
    await this.emuCommand(`avd snapshot save ${name}`);
  }

  async loadSnapshot(name: string): Promise<void> {
    await this.emuCommand(`avd snapshot load ${name}`);
    // The device goes offline briefly after a snapshot load. Wait for it
    // to come back before returning, so callers don't hit "device offline".
    await this.waitForDevice();
  }

  private async waitForDevice(): Promise<void> {
    const proc = Bun.spawn(["adb", "-s", this.serial, "wait-for-device"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  }

  async deleteSnapshot(name: string): Promise<void> {
    await this.emuCommand(`avd snapshot delete ${name}`);
  }
}
