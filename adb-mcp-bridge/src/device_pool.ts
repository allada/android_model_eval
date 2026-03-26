import { randomUUID } from "node:crypto";
import { AdbService } from "./adb_service.js";

export interface SessionHandle {
  adb: AdbService;
  serial: string;
  // Set to true by mutating tool handlers; triggers snapshot save on eviction.
  dirty: boolean;
}

interface DeviceState {
  serial: string;
  currentSessionId: string | null;
}

export class DevicePool {
  private devices: Map<string, DeviceState>;
  // TODO(allada) We have a memory leak here, but for this test I'm not going to worry
  // about it. (ie: we never evict old sessions and have no way to do so).
  private activeSessions = new Map<string, SessionHandle>();
  // Insertion-ordered: oldest session is first. Used to pick eviction victim.
  private sessionOrder: string[] = [];

  constructor(serials: string[]) {
    this.devices = new Map(
      serials.map((serial) => [serial, { serial, currentSessionId: null }]),
    );
    console.error(`DevicePool initialized with ${serials.length} device(s): ${serials.join(", ")}`);
  }

  /// Claim a device for a new session. Evicts the oldest session if all devices are busy.
  async acquire(): Promise<{ deviceSessionId: string; handle: SessionHandle }> {
    const id = randomUUID();
    let device = this.findIdleDevice();

    if (!device) {
      // Evict the oldest session to free a device.
      device = await this.evictOldest();
    }

    device.currentSessionId = id;
    const handle: SessionHandle = {
      adb: new AdbService(device.serial),
      serial: device.serial,
      dirty: false,
    };
    this.activeSessions.set(id, handle);
    this.sessionOrder.push(id);
    console.error(`Device session ${id} acquired ${device.serial}`);
    return { deviceSessionId: id, handle };
  }

  /// Look up the handle for an active device session.
  getHandle(deviceSessionId: string): SessionHandle | undefined {
    return this.activeSessions.get(deviceSessionId);
  }

  // Snapshot and detach the oldest session, freeing its device.
  private async evictOldest(): Promise<DeviceState> {
    // Note(allada): Expensive, but this is not really high performance code or
    // in the critical path.
    const victimId = this.sessionOrder.shift();
    if (!victimId) throw new Error("No sessions to evict");

    const handle = this.activeSessions.get(victimId);
    if (!handle) throw new Error("Eviction target has no handle");

    this.activeSessions.delete(victimId);

    const device = this.devices.get(handle.serial);
    if (!device) throw new Error("Eviction target has no device");

    if (handle.dirty) {
      const snapName = `mcp-session-${victimId}`;
      try {
        console.error(`Saving snapshot ${snapName} on ${handle.serial}...`);
        await handle.adb.saveSnapshot(snapName);
        console.error(`Snapshot ${snapName} saved on ${handle.serial}`);
      } catch (err) {
        console.error(`Failed to save snapshot during eviction of ${victimId}:`, err);
      }
    }

    console.error(`Evicted session ${victimId} from ${device.serial}`);
    device.currentSessionId = null;
    return device;
  }

  private findIdleDevice(): DeviceState | null {
    for (const device of this.devices.values()) {
      if (device.currentSessionId === null) {
        return device;
      }
    }
    return null;
  }
}
