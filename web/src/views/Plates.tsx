import { useEffect, useState, type FormEvent } from "react";
import { Camera, History, Link2, LogOut, Search } from "lucide-react";
import { useApi } from "../lib/context";
import { formatDuration, normalizePlate } from "../lib/format";
import { usePoll } from "../lib/hooks";
import type { JobStatus, PlateTimeline } from "../lib/types";
import { useFormat, useI18n } from "../i18n";
import { Empty, ErrorBanner, Plate, StatusPill, statusIcon } from "../components/ui";

type Entry =
  | { kind: "sighting"; at: string; cameraId: string; confidence: number | null; linked: boolean; exit: boolean }
  | { kind: "status"; at: string; status: JobStatus; packageName: string };

const STATUS_TONE: Record<JobStatus, string> = {
  arrived: "var(--accent)", queued: "var(--violet)", in_progress: "var(--warn)", completed: "var(--ok)", cancelled: "var(--text-3)",
};

export function entriesFor(timeline: PlateTimeline): Entry[] {
  const entries: Entry[] = [
    ...timeline.sightings.map((s) => ({
      kind: "sighting" as const, at: s.capturedAt, cameraId: s.cameraId, confidence: s.confidence, linked: !!s.jobId,
      exit: s.cameraRole === "exit",
    })),
    ...timeline.jobs.flatMap((j) => j.transitions.map((t) => ({ kind: "status" as const, at: t.at, status: t.status, packageName: j.packageName }))),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export function PlatesView({ initialPlate, onSearch }: { initialPlate: string; onSearch: (plate: string) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const [query, setQuery] = useState(initialPlate);
  const [timeline, setTimeline] = useState<PlateTimeline | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const { data: recent } = usePoll(() => api.recentSightings(40), 30_000, ["arrivals", "jobs"]);
  const { data: version } = usePoll(async () => Date.now(), 60_000, ["jobs", "arrivals"]);
  const recentPlates = [...new Set((recent ?? []).map((s) => s.confirmedPlate ?? s.plateCandidate).filter(Boolean) as string[])].slice(0, 8);

  useEffect(() => { setQuery(initialPlate); }, [initialPlate]);
  useEffect(() => {
    if (!initialPlate) { setTimeline(null); return; }
    let live = true;
    api.plateTimeline(initialPlate)
      .then((result) => { if (live) { setTimeline(result); setError(null); } })
      .catch((e) => live && setError(e));
    return () => { live = false; };
  }, [api, initialPlate, version]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const plate = normalizePlate(query);
    setInvalid(!plate);
    if (plate) onSearch(plate);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("plates.title")}</h1>
          <p className="page-sub">{t("plates.subtitle")}</p>
        </div>
      </header>
      <form onSubmit={submit} role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search">
          <Search size={18} aria-hidden />
          <label className="sr-only" htmlFor="plate-search">{t("plates.number")}</label>
          <input id="plate-search" className={`input input-plate ${invalid ? "input-error" : ""}`} placeholder="P123456" value={query}
            autoComplete="off" spellCheck={false} onChange={(e) => setQuery(e.target.value.toUpperCase())} style={{ fontSize: 17 }}
            aria-invalid={invalid} aria-describedby={invalid ? "plate-search-error" : undefined} />
        </div>
        <button className="btn btn-primary" type="submit">{t("plates.track")}</button>
      </form>
      {invalid && <p id="plate-search-error" className="error-text" role="alert" style={{ marginBottom: 12 }}>{t("plates.invalid")}</p>}
      {recentPlates.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 24 }}>
          <span className="subtle">{t("plates.recent")}</span>
          {recentPlates.map((p) => <Plate key={p} plate={p} onClick={() => onSearch(p)} />)}
        </div>
      )}
      <ErrorBanner error={error} />
      {timeline ? <TimelineCard timeline={timeline} />
        : !error && <div className="card"><Empty icon={History} title={t("plates.lookup")}>{t("plates.lookupBody")}</Empty></div>}
    </>
  );
}

function TimelineCard({ timeline }: { timeline: PlateTimeline }) {
  const { t } = useI18n();
  const f = useFormat();
  const entries = entriesFor(timeline);
  const spent = timeline.jobs.filter((j) => j.status === "completed").reduce((sum, j) => sum + j.priceUsd, 0);
  return (
    <div className="grid two-col">
      <section className="card" aria-label={t("plates.timeline")}>
        <div className="card-head">
          <h2 className="card-title"><History size={16} aria-hidden />{t("plates.timeline")}</h2>
          <span className="subtle">{t("plates.events", { count: entries.length })}</span>
        </div>
        <div className="card-pad">
          {entries.length === 0 ? <Empty icon={Camera} title={t("plates.noSightings")} /> : (
            <ol className="timeline">
              {entries.map((e, i) => {
                if (e.kind === "sighting") {
                  const Icon = e.exit ? LogOut : Camera;
                  return (
                    <li key={i} className="tl-item">
                      <span className="tl-dot" style={{ background: e.exit ? "var(--ok-soft)" : "var(--surface-2)", color: e.exit ? "var(--ok)" : "var(--text-2)" }}>
                        <Icon size={15} aria-hidden />
                      </span>
                      <span className="tl-body">
                        <strong>{e.exit ? t("plates.left", { camera: f.camera(e.cameraId) }) : t("plates.seenBy", { camera: f.camera(e.cameraId) })}</strong>
                        <span className="subtle">
                          {f.clock(e.at)} · {f.ago(e.at)}
                          {e.confidence != null && ` · ${t("plates.read", { percent: Math.round(e.confidence * 100) })}`}
                          {e.linked && <> · <Link2 size={12} aria-hidden style={{ verticalAlign: -1 }} /> {t("plates.onJob")}</>}
                        </span>
                      </span>
                    </li>
                  );
                }
                const Icon = statusIcon(e.status);
                return (
                  <li key={i} className="tl-item">
                    <span className="tl-dot" style={{ background: STATUS_TONE[e.status], color: "var(--bg)" }}><Icon size={15} aria-hidden /></span>
                    <span className="tl-body">
                      <strong>{t(`status.${e.status}`)} · {e.packageName}</strong>
                      <span className="subtle">{f.clock(e.at)} · {f.ago(e.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
      <section className="card card-pad" aria-label={t("plates.summary")} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Plate plate={timeline.plate} size="lg" />
        {timeline.openJob ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="label">{t("plates.currentJob")}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={timeline.openJob.status} />
              <strong>{timeline.openJob.packageName}</strong>
            </div>
            <span className="subtle">{t("plates.onSite", { duration: formatDuration(timeline.openJob.elapsedSeconds) })}</span>
          </div>
        ) : <span className="pill pill-neutral" style={{ alignSelf: "flex-start" }}>{t("plates.noOpenJob")}</span>}
        {timeline.leftAt && <span className="pill pill-ok" style={{ alignSelf: "flex-start" }}><LogOut size={13} aria-hidden />{t("plates.leftAt", { time: f.clock(timeline.leftAt) })}</span>}
        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: 0 }}>
          <Stat label={t("plates.visits")} value={String(timeline.visits)} />
          <Stat label={t("plates.spent")} value={f.money(spent)} />
          <Stat label={t("plates.lastSeen")} value={f.ago(timeline.lastSeenAt)} />
          <Stat label={t("plates.sightings")} value={String(timeline.sightings.length)} />
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px" }}>
      <dt className="subtle">{label}</dt>
      <dd style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{value}</dd>
    </div>
  );
}
