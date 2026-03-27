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
  // Serializes all operations on this device so snapshot save/load
  // can't overlap with other adb commands. Each operation chains onto this.
  opQueue: Promise<void>;
}

export class DevicePool {
  private devices: Map<string, DeviceState>;
  // All sessions ever created. Never deleted (except via removeSession).
  private sessions = new Map<string, DeviceSession>();

  constructor(serials: string[]) {
    this.devices = new Map(
      serials.map((serial) => [serial, { serial, adb: new AdbService(serial), activeSessionId: null, opQueue: Promise.resolve() }]),
    );
    console.error(`DevicePool initialized with ${serials.length} device(s): ${serials.join(", ")}`);
  }

  /// Register a new session on the device with the fewest sessions.
  initializeSession(): { deviceSessionId: string; handle: SessionHandle } {
    const id = randomUUID();
    const device = this.leastLoadedDevice();

    this.sessions.set(id, { serial: device.serial, snapshotName: null, dirty: false });
    console.error(`Session ${id} registered on ${device.serial}`);
    return {
      deviceSessionId: id,
      handle: { adb: device.adb, serial: device.serial, dirty: false },
    };
  }

  /// Swap to the correct session if needed, then run the callback while
  /// holding the device lock. The entire callback runs exclusively —
  /// no other operation can touch the device until it completes.
  withSession<T>(deviceSessionId: string, fn: (handle: SessionHandle) => Promise<T>): Promise<T> {
    const session = this.sessions.get(deviceSessionId);
    if (!session) throw new Error("Unknown device session. Call init-device-session first.");

    const device = this.devices.get(session.serial)!;
    return this.withDeviceLock(device, async () => {
      await this.swapTo(device, deviceSessionId);
      return fn({ adb: device.adb, serial: device.serial, dirty: session.dirty });
    });
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
    if (!device) return;

    await this.withDeviceLock(device, async () => {
      if (device.activeSessionId === deviceSessionId) {
        device.activeSessionId = null;
      }

      if (session.snapshotName) {
        try {
          await device.adb.deleteSnapshot(session.snapshotName);
          console.error(`Deleted snapshot ${session.snapshotName} on ${session.serial}`);
        } catch (err) {
          console.error(`Failed to delete snapshot ${session.snapshotName}:`, err);
        }
      }
    });

    this.sessions.delete(deviceSessionId);
    console.error(`Session ${deviceSessionId} removed`);
  }

  // Pick the device with the fewest sessions assigned to it.
  private leastLoadedDevice(): DeviceState {
    let best: DeviceState | null = null;
    let bestCount = Infinity;
    const counts = new Map<string, number>();
    for (const session of this.sessions.values()) {
      counts.set(session.serial, (counts.get(session.serial) ?? 0) + 1);
    }
    for (const device of this.devices.values()) {
      const count = counts.get(device.serial) ?? 0;
      if (count < bestCount) {
        best = device;
        bestCount = count;
      }
    }
    return best!;
  }

  // Swap the device to the target session, saving/loading snapshots as needed.
  private async swapTo(device: DeviceState, targetSessionId: string): Promise<void> {
    if (device.activeSessionId === targetSessionId) return;

    // Save current owner's state.
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

    // Load target session's snapshot.
    const targetSession = this.sessions.get(targetSessionId);
    if (targetSession?.snapshotName) {
      console.error(`Swapping in session ${targetSessionId}: loading ${targetSession.snapshotName}`);
      await device.adb.loadSnapshot(targetSession.snapshotName);
    }

    device.activeSessionId = targetSessionId;
  }

  // Serialize async operations on a device. Each call waits for the previous
  // one to finish before starting, preventing concurrent adb access during
  // snapshot save/load.
  private withDeviceLock<T>(device: DeviceState, fn: () => Promise<T>): Promise<T> {
    const result = device.opQueue.then(fn, fn);
    // Swallow errors in the queue chain so one failure doesn't block future ops.
    device.opQueue = result.then(() => {}, () => {});
    return result;
  }
}
