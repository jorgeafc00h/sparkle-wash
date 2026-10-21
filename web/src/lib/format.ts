import type { JobStatus } from "./types";

/** Same rule as the API: uppercase ASCII letters and digits, 3-12 characters. */
export function normalizePlate(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length >= 3 && cleaned.length <= 12 ? cleaned : null;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function secondsSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 1000);
}

export const NEXT_STATUS: Partial<Record<JobStatus, JobStatus>> = {
  arrived: "queued",
  queued: "in_progress",
  in_progress: "completed",
};

export function confidenceLevel(confidence: number | null): "high" | "medium" | "low" {
  if (confidence == null) return "low";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function idempotencyKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${random}`.slice(0, 128);
}
