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
