import type { ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock3, Droplets, Languages, type LucideIcon, ParkingSquare } from "lucide-react";
import { confidenceLevel } from "../lib/format";
import type { JobStatus } from "../lib/types";
import { errorText, LOCALES, useI18n, type Locale } from "../i18n";

export function Plate({ plate, size, onClick }: { plate: string | null; size?: "lg"; onClick?: () => void }) {
  const { t } = useI18n();
  const className = `plate ${size === "lg" ? "plate-lg" : ""}`;
  const text = plate ?? t("plate.unread");
  if (onClick) {
    return <button type="button" className={className} onClick={onClick} title={t("plate.track", { plate: text })}>{text}</button>;
  }
  return <span className={className} aria-label={t("plate.aria", { plate: text })}>{text}</span>;
}

const STATUS_STYLE: Record<JobStatus, { tone: string; icon: LucideIcon }> = {
  arrived: { tone: "pill-info", icon: ParkingSquare },
  queued: { tone: "pill-violet", icon: Clock3 },
  in_progress: { tone: "pill-warn", icon: Droplets },
  completed: { tone: "pill-ok", icon: CheckCircle2 },
  cancelled: { tone: "pill-neutral", icon: Ban },
};

export function StatusPill({ status }: { status: JobStatus }) {
  const { t } = useI18n();
  const { tone, icon: Icon } = STATUS_STYLE[status];
  return <span className={`pill ${tone}`}><Icon size={14} aria-hidden />{t(`status.${status}`)}</span>;
}

export function statusIcon(status: JobStatus): LucideIcon {
  return STATUS_STYLE[status].icon;
}

const LEVEL_COLOR = { high: "var(--ok)", medium: "var(--warn)", low: "var(--danger)" };

export function Confidence({ value }: { value: number | null }) {
  const { t } = useI18n();
  const level = confidenceLevel(value);
  const percent = Math.round((value ?? 0) * 100);
  return (
    <div className="confidence">
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("confidence.label")}>
        <span style={{ width: `${percent}%`, background: LEVEL_COLOR[level] }} />
      </div>
      <span className="mono" style={{ color: LEVEL_COLOR[level], fontWeight: 700, fontSize: 13, minWidth: 92, textAlign: "right" }}>
        {percent}% · {t(`confidence.${level}`)}
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

export function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return <div className="banner banner-error" role="alert"><AlertTriangle size={18} aria-hidden />{errorText(error, t)}</div>;
}

export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className={`lang-switch ${compact ? "lang-compact" : ""}`} role="radiogroup" aria-label={t("shell.language")}>
      <Languages size={16} aria-hidden />
      {LOCALES.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id}
          onClick={() => setLocale(l.id as Locale)} title={l.label}>
          {compact ? l.id.toUpperCase() : l.label}
        </button>
      ))}
    </div>
  );
}
