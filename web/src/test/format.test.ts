import { describe, expect, it } from "vitest";
import { cameraLabel, confidenceLevel, formatDuration, idempotencyKey, normalizePlate, timeAgo } from "../lib/format";

describe("format", () => {
  it("normalizes plates like the API", () => {
    expect(normalizePlate("p-123 456")).toBe("P123456");
    expect(normalizePlate("ab")).toBeNull();
    expect(normalizePlate("A".repeat(13))).toBeNull();
  });

  it("formats durations compactly", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 05s");
    expect(formatDuration(3 * 3600 + 7 * 60)).toBe("3h 07m");
  });

  it("describes relative time", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo("2026-10-21T11:59:55Z", now)).toBe("just now");
    expect(timeAgo("2026-10-21T11:45:00Z", now)).toBe("15m ago");
  });

  it("grades OCR confidence", () => {
    expect(confidenceLevel(0.92)).toBe("high");
    expect(confidenceLevel(0.6)).toBe("medium");
    expect(confidenceLevel(null)).toBe("low");
  });

  it("labels cameras and builds API-safe idempotency keys", () => {
    expect(cameraLabel("entrance-cam")).toBe("Entrance");
    expect(cameraLabel("bay2_cam")).toBe("Bay2");
    expect(idempotencyKey("assign")).toMatch(/^assign-[A-Za-z0-9-_]{8,}$/);
  });
});
