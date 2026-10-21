import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CircleDollarSign, Clock3, LogOut, UserPlus, X } from "lucide-react";
import { useApi, useToast } from "../lib/context";
import { formatDuration, NEXT_STATUS, secondsSince } from "../lib/format";
import { useNow, usePoll } from "../lib/hooks";
import type { ArrivalObservation, Catalog, Employee, Job } from "../lib/types";
import { className, errorText, packageText, useFormat, useI18n } from "../i18n";
import { Empty, ErrorBanner, Initials, Plate, statusIcon } from "../components/ui";

const COLUMNS = ["arrived", "queued", "in_progress", "completed"] as const;
const SLOW_WASH_SECONDS = 45 * 60;

export function BoardView({ onTrack }: { onTrack: (plate: string) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const { data: jobs, error, refresh } = usePoll(() => api.jobs(), 15_000, ["jobs"]);
  const { data: employees } = usePoll(() => api.employees(), 60_000);
  const { data: catalog } = usePoll(() => api.catalog(), 300_000);
  const { data: sightings } = usePoll(() => api.recentSightings(100), 15_000, ["jobs"]);
  const today = new Date().toDateString();
  const visible = (jobs ?? []).filter((j) =>
    j.status !== "cancelled" && (j.status !== "completed" || new Date(j.completedAt!).toDateString() === today));

  // Latest exit-camera sighting per job: a car seen leaving while still "washing" probably needs "Mark done".
  const exits = useMemo(() => {
    const map = new Map<string, ArrivalObservation>();
    for (const s of sightings ?? []) if (s.jobId && s.cameraRole === "exit" && !map.has(s.jobId)) map.set(s.jobId, s);
    return map;
  }, [sightings]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("board.title")}</h1>
          <p className="page-sub">{t("board.subtitle")}</p>
        </div>
      </header>
      <ErrorBanner error={error} />
      <div className="board">
        {COLUMNS.map((status) => {
          const Icon = statusIcon(status);
          const items = visible.filter((j) => j.status === status);
          return (
            <section key={status} className="column" aria-label={t(`status.${status}`)}>
              <div className="column-head">
                <Icon size={16} aria-hidden />
                <h2 style={{ fontSize: 15 }}>{t(`status.${status}`)}</h2>
                <span className="column-count">{items.length}</span>
              </div>
              {jobs === null
                ? <div className="skeleton" style={{ height: 150 }} />
                : items.length === 0
                  ? <Empty icon={Icon} title={t("board.empty")}>{t(`board.hint.${status}`)}</Empty>
                  : items.map((job) => (
                    <JobCard key={job.id} job={job} employees={employees ?? []} catalog={catalog}
                      exit={exits.get(job.id)} onChanged={refresh} onTrack={onTrack} />
                  ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function JobCard({ job, employees, catalog, exit, onChanged, onTrack }: {
  job: Job; employees: Employee[]; catalog: Catalog | null; exit?: ArrivalObservation;
  onChanged: () => void; onTrack: (plate: string) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t, locale } = useI18n();
  const f = useFormat();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const next = NEXT_STATUS[job.status];
  const open = job.status !== "completed" && job.status !== "cancelled";
  const seconds = !open ? job.elapsedSeconds
    : job.status === "in_progress" && job.startedAt ? secondsSince(job.startedAt, now) : secondsSince(job.arrivalAt, now);
  const slow = job.status === "in_progress" && seconds > SLOW_WASH_SECONDS;
  const available = employees.filter((e) => e.active && !job.assignments.some((a) => a.employeeId === e.id));
  const pkg = catalog?.packages.find((p) => p.id === job.packageId);
  const vehicle = catalog?.vehicleClasses.find((v) => v.id === job.vehicleClass);
  const leaving = job.status === "in_progress" && exit;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast("ok", success);
    } catch (e) {
      toast("error", errorText(e, t));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <article className="card job" aria-label={t("board.jobFor", { plate: job.plate })}>
      <div className="job-top">
        <Plate plate={job.plate} onClick={() => onTrack(job.plate)} />
        <span className={`mono ${slow ? "timer-warn" : "muted"}`} style={{ fontSize: 13, display: "inline-flex", gap: 4, alignItems: "center" }}
          title={job.status === "in_progress" ? t("board.timeInBay") : open ? t("board.timeSinceArrival") : t("board.totalTime")}>
          {slow ? <AlertTriangle size={13} aria-label={t("board.runningLong")} /> : <Clock3 size={13} aria-hidden />}
          {formatDuration(seconds)}
        </span>
      </div>
      <div>
        <strong>{pkg ? packageText(pkg, locale, catalog!).name : job.packageName}</strong>
        <div className="job-meta">
          <span>{vehicle ? className(vehicle, locale, catalog!) : job.vehicleClass.toUpperCase()}</span>
          <span><CircleDollarSign size={13} aria-hidden />{f.money(job.priceUsd, job.currency)}</span>
        </div>
      </div>
      {leaving && <p className="exit-hint" role="status"><LogOut size={15} aria-hidden />{t("board.seenLeaving", { time: f.clock(exit.capturedAt) })}</p>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="avatars">
          {job.assignments.length
            ? job.assignments.map((a) => <Initials key={a.employeeId} name={a.employeeName} />)
            : <span className="subtle">{t("board.nobody")}</span>}
        </div>
        {open && available.length > 0 && !assigning && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssigning(true)}>
            <UserPlus size={15} aria-hidden />{t("board.assign")}
          </button>
        )}
      </div>
      {assigning && (
        <div style={{ display: "flex", gap: 6 }}>
          <label className="sr-only" htmlFor={`assign-${job.id}`}>{t("board.assignEmployee")}</label>
          <select id={`assign-${job.id}`} className="input" style={{ minHeight: 36 }} defaultValue=""
            onChange={(e) => {
              const employee = available.find((x) => x.id === e.target.value);
              if (!employee) return;
              setAssigning(false);
              void run(() => api.assignEmployee(job.id, employee.id), t("board.assigned", { name: employee.name, plate: job.plate }));
            }}>
            <option value="" disabled>{t("board.choose")}</option>
            {available.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button type="button" className="btn btn-sm icon-btn" style={{ width: 36 }} aria-label={t("board.cancelAssign")} onClick={() => setAssigning(false)}>
            <X size={15} aria-hidden />
          </button>
        </div>
      )}
      {open && (
        <div className="job-actions">
          {next && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => run(() => api.transitionJob(job.id, next), t("board.moved", { plate: job.plate, status: t(`status.${next}`) }))}>
              {t(`action.${job.status as "arrived" | "queued" | "in_progress"}`)}<ArrowRight size={15} aria-hidden />
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost btn-danger" style={{ flex: "0 0 auto" }} disabled={busy}
            onClick={() => {
              if (window.confirm(t("board.cancelConfirm", { plate: job.plate })))
                void run(() => api.transitionJob(job.id, "cancelled"), t("board.cancelled", { plate: job.plate }));
            }}>
            {t("board.cancel")}
          </button>
        </div>
      )}
    </article>
  );
}
