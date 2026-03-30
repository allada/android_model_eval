/** Session info returned by the admin API. */
export interface DeviceSessionInfo {
  deviceSessionId: string;
  deviceSerial: string;
  screenWidth: number;
  screenHeight: number;
  screenshotUrl: string;
}

/**
 * HTTP client for the adb-mcp-bridge admin API.
 * Used by the harness for session lifecycle, setup, and verification.
 */
export class AdminClient {
  private baseUrl: string;

  constructor(adminUrl: string) {
    this.baseUrl = adminUrl.replace(/\/$/, "");
  }

  /** Create a new device session. */
  async initDeviceSession(): Promise<DeviceSessionInfo> {
    const res = await fetch(`${this.baseUrl}/initDeviceSession`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`initDeviceSession failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<DeviceSessionInfo>;
  }

  /** Run a raw ADB shell command on the session's device. */
  async runAdbCommand(deviceSessionId: string, command: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/runAdbCommand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, command }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`runAdbCommand failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { output: string };
    return data.output;
  }

  /** Load an emulator snapshot on the session's device. */
  async loadSnapshot(deviceSessionId: string, name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/loadSnapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, name }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`loadSnapshot failed (${res.status}): ${body}`);
    }
  }

  /** Download a file from a URL and send it to a path on the device. */
  async downloadFile(deviceSessionId: string, url: string, destPath: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/downloadFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, url, destPath }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`downloadFile failed (${res.status}): ${body}`);
    }
  }

  /** Run an emulator console command on the session's device. */
  async runEmuCommand(deviceSessionId: string, command: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/runEmuCommand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, command }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`runEmuCommand failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { output: string };
    return data.output;
  }

  /** Start screen recording for a device session. */
  async startRecording(deviceSessionId: string, outputPath: string): Promise<{ startedAtMs: number }> {
    const res = await fetch(`${this.baseUrl}/startRecording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId, outputPath }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`startRecording failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<{ startedAtMs: number }>;
  }

  /** Stop screen recording for a device session. */
  async stopRecording(deviceSessionId: string): Promise<{ stoppedAtMs: number }> {
    const res = await fetch(`${this.baseUrl}/stopRecording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`stopRecording failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<{ stoppedAtMs: number }>;
  }

  /** Remove a device session and clean up its snapshot. */
  async removeDeviceSession(deviceSessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/removeDeviceSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSessionId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`removeDeviceSession failed (${res.status}): ${body}`);
    }
  }
}
