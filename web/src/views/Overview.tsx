import type { ReactNode } from "react";
import { AlertTriangle, Camera, CheckCircle2, Droplets, Gauge, Link2, LogOut, ScanLine, Timer } from "lucide-react";
import { useApi, useLive } from "../lib/context";
import { formatDuration } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { useFormat, useI18n } from "../i18n";
import type { MessageKey } from "../i18n/es";
import { Empty, ErrorBanner, Plate } from "../components/ui";

export function OverviewView({ onReview, onTrack }: { onReview: () => void; onTrack: (plate: string) => void }) {
  const api = useApi();
  const live = useLive();
  const { t } = useI18n();
  const f = useFormat();
  const { data: summary } = usePoll(() => api.jobSummary(), 20_000, ["jobs"]);
  const { data: pending } = usePoll(() => api.pendingArrivals(), 15_000, ["arrivals"]);
  const { data: sightings, error } = usePoll(() => api.recentSightings(12), 15_000, ["arrivals", "jobs"]);
  const { data: alerts } = usePoll(() => api.alerts(), 15_000);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("floor.title")}</h1>
          <p className="page-sub">{capitalizeFirst(f.today())}</p>
        </div>
        {pending && pending.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={onReview}>
            <ScanLine size={18} aria-hidden />{t("floor.review", { count: pending.length })}
          </button>
        )}
      </header>
      <ErrorBanner error={error} />
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi icon={<ScanLine size={16} />} tone="var(--warn)" label={t("floor.waiting")} value={pending?.length} />
        <Kpi icon={<Droplets size={16} />} tone="var(--accent)" label={t("floor.inBays")}
          value={summary ? summary.inProgress + summary.queued + summary.arrived : undefined} />
        <Kpi icon={<CheckCircle2 size={16} />} tone="var(--ok)" label={t("floor.doneToday")} value={summary ? (summary.completedToday ?? summary.completedTodayUtc) : undefined} />
        <Kpi icon={<Timer size={16} />} tone="var(--violet)" label={t("floor.avgVisit")}
          value={summary ? formatDuration(summary.averageCompletedSeconds) : undefined} />
      </div>
      <div className="grid two-col">
        <section className="card" aria-label={t("floor.feed")}>
          <div className="card-head">
            <h2 className="card-title"><Camera size={16} aria-hidden />{t("floor.feed")}</h2>
            {live.state === "live"
              ? <span className="pill pill-ok"><span className="dot live-dot" aria-hidden />{t("shell.live")}</span>
              : <span className="pill pill-warn"><span className="dot" aria-hidden />{t("shell.reconnecting")}</span>}
          </div>
          {sightings === null ? <div className="card-pad"><div className="skeleton" style={{ height: 240 }} /></div>
            : sightings.length === 0 ? <Empty icon={Camera} title={t("floor.noPlates")}>{t("floor.noPlatesBody")}</Empty>
              : (
                <div className="feed">
                  {sightings.map((s) => (
                    <div key={s.id} className="feed-item">
                      <span className="cam-icon">{s.cameraRole === "exit" ? <LogOut size={16} aria-hidden /> : <Camera size={16} aria-hidden />}</span>
                      <div className="feed-body">
                        <div className="feed-row">
                          <Plate plate={s.confirmedPlate ?? s.plateCandidate} onClick={() => onTrack(s.confirmedPlate ?? s.plateCandidate ?? "")} />
                          {s.cameraRole === "exit"
                            ? <span className="pill pill-ok"><LogOut size={13} aria-hidden />{t("floor.leaving")}</span>
                            : s.jobId
                              ? <span className="pill pill-info"><Link2 size={13} aria-hidden />{t("floor.onJob")}</span>
                              : s.confirmedAt
                                ? <span className="pill pill-ok"><CheckCircle2 size={13} aria-hidden />{t("floor.confirmed")}</span>
                                : <span className="pill pill-warn"><ScanLine size={13} aria-hidden />{t("floor.needsReview")}</span>}
                        </div>
                        <span className="subtle">{f.camera(s.cameraId)} · {f.ago(s.receivedAt)}
                          {s.confidence != null && ` · ${Math.round(s.confidence * 100)}%`}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>
        <section className="card" aria-label={t("floor.equipment")}>
          <div className="card-head"><h2 className="card-title"><Gauge size={16} aria-hidden />{t("floor.equipment")}</h2></div>
          <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {alerts === null ? <div className="skeleton" style={{ height: 120 }} />
              : alerts.length === 0 ? <Empty icon={CheckCircle2} title={t("floor.allNormal")} />
                : alerts.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`pill ${a.severity === "danger" ? "pill-danger" : "pill-warn"}`}>
                      <AlertTriangle size={13} aria-hidden />{a.severity === "danger" ? t("floor.actNow") : t("floor.watch")}
                    </span>
                    <span style={{ flex: 1 }}>
                      <strong>{alertText(a.code, t)}</strong>
                      <span className="subtle"> {a.stationId ? `· ${a.stationId} ` : ""}· {a.value} ({t("floor.limit", { value: a.threshold })})</span>
                    </span>
                  </div>
                ))}
          </div>
        </section>
      </div>
    </>
  );
}

function alertText(code: string, t: (key: MessageKey) => string): string {
  const key = `alert.${code}` as MessageKey;
  return ["alert.lowPressure", "alert.highPressure", "alert.lowSoapLevel"].includes(key) ? t(key) : code;
}

function Kpi({ icon, tone, label, value }: { icon: ReactNode; tone: string; label: string; value: number | string | undefined }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">
        <span className="kpi-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }} aria-hidden>{icon}</span>
        {label}
      </span>
      {value === undefined ? <span className="skeleton" style={{ height: 36, width: 80 }} /> : <span className="kpi-value">{value}</span>}
    </div>
  );
}

/** "miércoles, 21 de octubre" → "Miércoles, 21 de octubre" (CSS capitalize would capitalize every word). */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
