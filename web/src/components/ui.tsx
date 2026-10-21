import type { ReactNode } from "react";
import { Ban, CheckCircle2, Clock3, Droplets, type LucideIcon, ParkingSquare } from "lucide-react";
import { confidenceLevel, STATUS_LABEL } from "../lib/format";
import type { JobStatus } from "../lib/types";

export function Plate({ plate, size, onClick, title }: { plate: string | null; size?: "lg"; onClick?: () => void; title?: string }) {
  const className = `plate ${size === "lg" ? "plate-lg" : ""}`;
  const text = plate ?? "UNREAD";
  if (onClick) {
    return <button type="button" className={className} onClick={onClick} title={title ?? `Track ${text}`}>{text}</button>;
  }
  return <span className={className} aria-label={`Plate ${text}`}>{text}</span>;
}

const STATUS_STYLE: Record<JobStatus, { tone: string; icon: LucideIcon }> = {
  arrived: { tone: "pill-info", icon: ParkingSquare },
  queued: { tone: "pill-violet", icon: Clock3 },
  in_progress: { tone: "pill-warn", icon: Droplets },
  completed: { tone: "pill-ok", icon: CheckCircle2 },
  cancelled: { tone: "pill-neutral", icon: Ban },
};

export function StatusPill({ status }: { status: JobStatus }) {
  const { tone, icon: Icon } = STATUS_STYLE[status];
  return <span className={`pill ${tone}`}><Icon size={14} aria-hidden />{STATUS_LABEL[status]}</span>;
}

export function statusIcon(status: JobStatus): LucideIcon {
  return STATUS_STYLE[status].icon;
}

const LEVEL_COLOR = { high: "var(--ok)", medium: "var(--warn)", low: "var(--danger)" };
const LEVEL_TEXT = { high: "High", medium: "Check", low: "Low" };

export function Confidence({ value }: { value: number | null }) {
  const level = confidenceLevel(value);
  const percent = Math.round((value ?? 0) * 100);
  return (
    <div className="confidence">
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="OCR confidence">
        <span style={{ width: `${percent}%`, background: LEVEL_COLOR[level] }} />
      </div>
      <span className="mono" style={{ color: LEVEL_COLOR[level], fontWeight: 700, fontSize: 13, minWidth: 82, textAlign: "right" }}>
        {percent}% · {LEVEL_TEXT[level]}
      </span>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={22} aria-hidden /></div>
      <strong style={{ color: "var(--text-2)" }}>{title}</strong>
      {children}
    </div>
  );
}

export function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className="avatar" title={name} aria-label={name}>{initials}</span>;
}
