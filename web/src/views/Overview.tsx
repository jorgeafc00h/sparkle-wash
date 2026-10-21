import type { ReactNode } from "react";
import { AlertTriangle, Camera, CheckCircle2, Droplets, Gauge, Link2, ScanLine, Timer } from "lucide-react";
import { useApi } from "../lib/context";
import { cameraLabel, formatDuration, timeAgo } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { Empty, Plate } from "../components/ui";

export function OverviewView({ onReview, onTrack }: { onReview: () => void; onTrack: (plate: string) => void }) {
  const api = useApi();
  const { data: summary } = usePoll(() => api.jobSummary(), 5000);
  const { data: pending } = usePoll(() => api.pendingArrivals(), 4000);
  const { data: sightings, error } = usePoll(() => api.recentSightings(12), 3000);
  const { data: alerts } = usePoll(() => api.alerts(), 15_000);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Live floor</h1>
          <p className="page-sub">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        {pending && pending.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={onReview}>
            <ScanLine size={18} aria-hidden />Review {pending.length} arrival{pending.length === 1 ? "" : "s"}
          </button>
        )}
      </header>
      {error && <div className="banner" role="alert"><AlertTriangle size={18} aria-hidden />{error}</div>}
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi icon={<ScanLine size={16} />} tone="var(--warn)" label="Waiting review" value={pending?.length} />
        <Kpi icon={<Droplets size={16} />} tone="var(--accent)" label="In the bays"
          value={summary ? summary.inProgress + summary.queued + summary.arrived : undefined} />
        <Kpi icon={<CheckCircle2 size={16} />} tone="var(--ok)" label="Done today" value={summary?.completedTodayUtc} />
        <Kpi icon={<Timer size={16} />} tone="var(--violet)" label="Avg. visit"
          value={summary ? formatDuration(summary.averageCompletedSeconds) : undefined} />
      </div>
      <div className="grid two-col">
        <section className="card" aria-label="Camera feed">
          <div className="card-head">
            <h2 className="card-title"><Camera size={16} aria-hidden />Camera feed</h2>
            <span className="pill pill-ok"><span className="dot live-dot" aria-hidden />Live</span>
          </div>
          {sightings === null ? <div className="card-pad"><div className="skeleton" style={{ height: 240 }} /></div>
            : sightings.length === 0 ? <Empty icon={Camera} title="No plates yet">Readings from the ESP32 cameras show up here.</Empty>
              : (
                <div className="feed">
                  {sightings.map((s) => (
                    <div key={s.id} className="feed-item">
                      <span className="cam-icon"><Camera size={16} aria-hidden /></span>
                      <div className="feed-body">
                        <div className="feed-row">
                          <Plate plate={s.confirmedPlate ?? s.plateCandidate} onClick={() => onTrack(s.confirmedPlate ?? s.plateCandidate ?? "")} />
                          {s.jobId
                            ? <span className="pill pill-info"><Link2 size={13} aria-hidden />On job</span>
                            : s.confirmedAt
                              ? <span className="pill pill-ok"><CheckCircle2 size={13} aria-hidden />Confirmed</span>
                              : <span className="pill pill-warn"><ScanLine size={13} aria-hidden />Needs review</span>}
                        </div>
                        <span className="subtle">{cameraLabel(s.cameraId)} · {timeAgo(s.receivedAt)}
                          {s.confidence != null && ` · ${Math.round(s.confidence * 100)}%`}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>
        <section className="card" aria-label="Equipment alerts">
          <div className="card-head"><h2 className="card-title"><Gauge size={16} aria-hidden />Equipment</h2></div>
          <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {alerts === null ? <div className="skeleton" style={{ height: 120 }} />
              : alerts.length === 0 ? <Empty icon={CheckCircle2} title="All bays normal" />
                : alerts.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`pill ${a.severity === "danger" ? "pill-danger" : "pill-warn"}`}>
                      <AlertTriangle size={13} aria-hidden />{a.severity === "danger" ? "Act now" : "Watch"}
                    </span>
                    <span style={{ flex: 1 }}>
                      <strong>{ALERT_TEXT[a.code] ?? a.code}</strong>
                      <span className="subtle"> {a.stationId ? `· ${a.stationId} ` : ""}· {a.value} (limit {a.threshold})</span>
                    </span>
                  </div>
                ))}
          </div>
        </section>
      </div>
    </>
  );
}

export const ALERT_TEXT: Record<string, string> = {
  lowPressure: "Low water pressure",
  highPressure: "High water pressure",
  lowSoapLevel: "Soap running low",
};

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
