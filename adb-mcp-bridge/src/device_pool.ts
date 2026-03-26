import { randomUUID } from "node:crypto";
import { AdbService } from "./adb_service.js";

export interface SessionHandle {
  adb: AdbService;
  serial: string;
  dirty: boolean;
}

interface DeviceSession {
  serial: string;
  snapshotName: string | null;
  dirty: boolean;
}

interface DeviceState {
  serial: string;
  adb: AdbService;
  // The session that last used this device (whose state is currently on it).
  activeSessionId: string | null;
}

export class DevicePool {
  private devices: Map<string, DeviceState>;
  // All sessions ever created. Never deleted (except via removeSession).
  private sessions = new Map<string, DeviceSession>();

  constructor(serials: string[]) {
    this.devices = new Map(
      serials.map((serial) => [serial, { serial, adb: new AdbService(serial), activeSessionId: null }]),
    );
    console.error(`DevicePool initialized with ${serials.length} device(s): ${serials.join(", ")}`);
  }

  /// Register a new session on any available device.
  initializeSession(): { deviceSessionId: string; handle: SessionHandle } {
    const id = randomUUID();
    // Pick the first device. With session swapping, all devices are always
    // available — there's no "busy" concept.
    const device = this.devices.values().next().value!;

    this.sessions.set(id, { serial: device.serial, snapshotName: null, dirty: false });
    console.error(`Session ${id} registered on ${device.serial}`);
    return {
      deviceSessionId: id,
      handle: { adb: device.adb, serial: device.serial, dirty: false },
    };
  }

  /// Ensure the device is in the right state for this session, then return the handle.
  /// If another session currently owns the device, snapshots it first, then loads ours.
  async ensureSession(deviceSessionId: string): Promise<SessionHandle> {
    const session = this.sessions.get(deviceSessionId);
    if (!session) throw new Error("Unknown device session. Call init-device-session first.");

    const device = this.devices.get(session.serial)!;

    if (device.activeSessionId === deviceSessionId) {
      // Fast path: we already own the device.
      return { adb: device.adb, serial: device.serial, dirty: session.dirty };
    }

    // Swap: save current owner's state, then load ours.
    if (device.activeSessionId) {
      const currentSession = this.sessions.get(device.activeSessionId);
      if (currentSession?.dirty) {
        const snapName = `mcp-session-${device.activeSessionId}`;
        console.error(`Swapping out session ${device.activeSessionId}: saving ${snapName}`);
        await device.adb.saveSnapshot(snapName);
        currentSession.snapshotName = snapName;
        currentSession.dirty = false;
      }
    }

    // Load our snapshot if we have one.
    if (session.snapshotName) {
      console.error(`Swapping in session ${deviceSessionId}: loading ${session.snapshotName}`);
      await device.adb.loadSnapshot(session.snapshotName);
    }

    device.activeSessionId = deviceSessionId;
    return { adb: device.adb, serial: device.serial, dirty: session.dirty };
  }

  /// Get the serial for an existing session.
  getSessionSerial(deviceSessionId: string): string {
    const session = this.sessions.get(deviceSessionId);
    if (!session) throw new Error("Unknown device session.");
    return session.serial;
  }

  /// Mark a session as dirty (device state was modified).
  markDirty(deviceSessionId: string): void {
    const session = this.sessions.get(deviceSessionId);
    if (session) session.dirty = true;
  }

  /// Remove a session and delete its snapshot from the emulator.
  async removeSession(deviceSessionId: string): Promise<void> {
    const session = this.sessions.get(deviceSessionId);
    if (!session) return;

    const device = this.devices.get(session.serial);

    // If this session is the active one on its device, clear that.
    if (device?.activeSessionId === deviceSessionId) {
      device.activeSessionId = null;
    }

    // Delete the snapshot if one was saved.
    if (session.snapshotName && device) {
      try {
        await device.adb.deleteSnapshot(session.snapshotName);
        console.error(`Deleted snapshot ${session.snapshotName} on ${session.serial}`);
      } catch (err) {
        console.error(`Failed to delete snapshot ${session.snapshotName}:`, err);
      }
    }

    this.sessions.delete(deviceSessionId);
    console.error(`Session ${deviceSessionId} removed`);
  }
}
