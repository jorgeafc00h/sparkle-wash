import { describe, expect, it } from "vitest";
import { firmwareVersion, mdnsHost, needsFirmwareUpdate, suggestCameraId } from "../lib/cameras";

describe("camera helpers", () => {
  it("reads the firmware version and flags cameras older than 1.2", () => {
    expect(firmwareVersion("sparklewash-cam/1.1")).toEqual({ major: 1, minor: 1 });
    expect(needsFirmwareUpdate("sparklewash-cam/1.1")).toBe(true);
    expect(needsFirmwareUpdate("sparklewash-cam/1.2")).toBe(false);
    expect(needsFirmwareUpdate("sparklewash-cam/2.0")).toBe(false);
    expect(needsFirmwareUpdate(undefined)).toBe(false);
    expect(needsFirmwareUpdate("other-firmware")).toBe(false);
  });

  it("suggests the next free id per role", () => {
    expect(suggestCameraId("bay", [])).toBe("bay1-cam");
    expect(suggestCameraId("bay", [{ cameraId: "bay1-cam" }, { cameraId: "bay2-cam" }])).toBe("bay3-cam");
    expect(suggestCameraId("entry", [{ cameraId: "entrance-cam" }])).toBe("entrance2-cam");
  });

  it("builds the mDNS host the firmware announces", () => {
    expect(mdnsHost("bay_2-cam")).toBe("sparklecam-bay-2-cam.local");
  });
});
