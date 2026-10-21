import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, History, Link2, Search } from "lucide-react";
import { useApi } from "../lib/context";
import { cameraLabel, clockTime, formatDuration, money, normalizePlate, STATUS_LABEL, timeAgo } from "../lib/format";
import { usePoll } from "../lib/hooks";
import type { JobStatus, PlateTimeline } from "../lib/types";
import { Empty, Plate, StatusPill, statusIcon } from "../components/ui";

type Entry =
  | { kind: "sighting"; at: string; cameraId: string; confidence: number | null; linked: boolean }
  | { kind: "status"; at: string; status: JobStatus; packageName: string };

const STATUS_TONE: Record<JobStatus, string> = {
  arrived: "var(--accent)", queued: "var(--violet)", in_progress: "var(--warn)", completed: "var(--ok)", cancelled: "var(--text-3)",
};

export function entriesFor(timeline: PlateTimeline): Entry[] {
  const entries: Entry[] = [
    ...timeline.sightings.map((s) => ({ kind: "sighting" as const, at: s.capturedAt, cameraId: s.cameraId, confidence: s.confidence, linked: !!s.jobId })),
    ...timeline.jobs.flatMap((j) => j.transitions.map((t) => ({ kind: "status" as const, at: t.at, status: t.status, packageName: j.packageName }))),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export function PlatesView({ initialPlate, onSearch }: { initialPlate: string; onSearch: (plate: string) => void }) {
  const api = useApi();
  const [query, setQuery] = useState(initialPlate);
  const [timeline, setTimeline] = useState<PlateTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: recent } = usePoll(() => api.recentSightings(40), 10_000);
  const recentPlates = [...new Set((recent ?? []).map((s) => s.confirmedPlate ?? s.plateCandidate).filter(Boolean) as string[])].slice(0, 8);

  useEffect(() => {
    setQuery(initialPlate);
    if (!initialPlate) { setTimeline(null); return; }
    let live = true;
    setError(null);
    api.plateTimeline(initialPlate)
      .then((t) => live && setTimeline(t))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Lookup failed"));
    return () => { live = false; };
  }, [api, initialPlate]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const plate = normalizePlate(query);
    if (!plate) { setError("Enter 3 to 12 letters or digits."); return; }
    onSearch(plate);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Plate tracker</h1>
          <p className="page-sub">Every camera sighting and job step for a vehicle, newest first.</p>
        </div>
      </header>
      <form onSubmit={submit} role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search">
          <Search size={18} aria-hidden />
          <label className="sr-only" htmlFor="plate-search">Plate number</label>
          <input id="plate-search" className="input input-plate" placeholder="P123456" value={query} autoComplete="off" spellCheck={false}
            onChange={(e) => setQuery(e.target.value.toUpperCase())} style={{ fontSize: 17 }} />
        </div>
        <button className="btn btn-primary" type="submit">Track</button>
      </form>
      {recentPlates.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 24 }}>
          <span className="subtle">Seen recently:</span>
          {recentPlates.map((p) => <Plate key={p} plate={p} onClick={() => onSearch(p)} />)}
        </div>
      )}
      {error && <div className="banner" role="alert"><AlertTriangle size={18} aria-hidden />{error}</div>}
      {timeline ? <TimelineCard timeline={timeline} />
        : !error && <div className="card"><Empty icon={History} title="Look up a plate">Search, or tap a plate anywhere in the console.</Empty></div>}
    </>
  );
}

function TimelineCard({ timeline }: { timeline: PlateTimeline }) {
  const entries = entriesFor(timeline);
  const spent = timeline.jobs.filter((j) => j.status === "completed").reduce((sum, j) => sum + j.priceUsd, 0);
  return (
    <div className="grid two-col">
      <section className="card" aria-label="Timeline">
        <div className="card-head">
          <h2 className="card-title"><History size={16} aria-hidden />Timeline</h2>
          <span className="subtle">{entries.length} events</span>
        </div>
        <div className="card-pad">
          {entries.length === 0 ? <Empty icon={Camera} title="No sightings yet" /> : (
            <ol className="timeline">
              {entries.map((e, i) => {
                if (e.kind === "sighting") {
                  return (
                    <li key={i} className="tl-item">
                      <span className="tl-dot" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><Camera size={15} aria-hidden /></span>
                      <span className="tl-body">
                        <strong>Seen by {cameraLabel(e.cameraId)}</strong>
                        <span className="subtle">
                          {clockTime(e.at)} · {timeAgo(e.at)}{e.confidence != null && ` · ${Math.round(e.confidence * 100)}% read`}
                          {e.linked && <> · <Link2 size={12} aria-hidden style={{ verticalAlign: -1 }} /> on job</>}
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
                      <strong>{STATUS_LABEL[e.status]} · {e.packageName}</strong>
                      <span className="subtle">{clockTime(e.at)} · {timeAgo(e.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
      <section className="card card-pad" aria-label="Vehicle summary" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Plate plate={timeline.plate} size="lg" />
        {timeline.openJob ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="label">Current job</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={timeline.openJob.status} />
              <strong>{timeline.openJob.packageName}</strong>
            </div>
            <span className="subtle">On site for {formatDuration(timeline.openJob.elapsedSeconds)}</span>
          </div>
        ) : <span className="pill pill-neutral" style={{ alignSelf: "flex-start" }}>No open job</span>}
        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: 0 }}>
          <Stat label="Visits" value={String(timeline.visits)} />
          <Stat label="Spent" value={money(spent)} />
          <Stat label="Last seen" value={timeAgo(timeline.lastSeenAt)} />
          <Stat label="Sightings" value={String(timeline.sightings.length)} />
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
