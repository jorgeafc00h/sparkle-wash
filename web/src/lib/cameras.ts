import type { CameraRole, Device } from "./types";

/** Firmware 1.2 is the first with Bluetooth setup and Bonjour/mDNS. */
export const CURRENT_FIRMWARE = { major: 1, minor: 2 };

/** "sparklewash-cam/1.1" → { major: 1, minor: 1 }; null when the camera never reported a known version. */
export function firmwareVersion(firmware: string | null | undefined): { major: number; minor: number } | null {
  const match = /sparklewash-cam\/(\d+)\.(\d+)/.exec(firmware ?? "");
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

export function needsFirmwareUpdate(firmware: string | null | undefined): boolean {
  const version = firmwareVersion(firmware);
  if (!version) return false;
  return version.major < CURRENT_FIRMWARE.major || (version.major === CURRENT_FIRMWARE.major && version.minor < CURRENT_FIRMWARE.minor);
}

/** The host name firmware 1.2 announces on the local network. */
export function mdnsHost(cameraId: string): string {
  return `sparklecam-${cameraId.replace(/_/g, "-")}.local`;
}

const BASE_ID: Record<CameraRole, string> = { entry: "entrance-cam", bay: "bay1-cam", exit: "exit-cam" };

/** A camera ID for the role that isn't taken yet: entrance-cam, entrance2-cam… / bay1-cam, bay2-cam… */
export function suggestCameraId(role: CameraRole, existing: Pick<Device, "cameraId">[]): string {
  const taken = new Set(existing.map((d) => d.cameraId));
  if (!taken.has(BASE_ID[role])) return BASE_ID[role];
  const stem = role === "bay" ? "bay" : role === "entry" ? "entrance" : "exit";
  for (let n = 2; n < 100; n++) {
    const id = `${stem}${n}-cam`;
    if (!taken.has(id)) return id;
  }
  return `${stem}-${Date.now().toString(36)}-cam`;
}
