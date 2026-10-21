import { useState } from "react";
import { AlertTriangle, ArrowRight, CircleDollarSign, Clock3, UserPlus, X } from "lucide-react";
import { useApi, useToast } from "../lib/context";
import { formatDuration, money, NEXT_ACTION, NEXT_STATUS, secondsSince, STATUS_LABEL } from "../lib/format";
import { useNow, usePoll } from "../lib/hooks";
import type { Employee, Job, JobStatus } from "../lib/types";
import { Empty, Initials, Plate, statusIcon } from "../components/ui";

const COLUMNS: { status: JobStatus; hint: string }[] = [
  { status: "arrived", hint: "Confirmed, waiting for a bay" },
  { status: "queued", hint: "Lined up for a bay" },
  { status: "in_progress", hint: "Being washed now" },
  { status: "completed", hint: "Finished today" },
];
const SLOW_WASH_SECONDS = 45 * 60;

export function BoardView({ onTrack }: { onTrack: (plate: string) => void }) {
  const api = useApi();
  const { data: jobs, error, refresh } = usePoll(() => api.jobs(), 4000);
  const { data: employees } = usePoll(() => api.employees(), 60_000);
  const today = new Date().toDateString();
  const visible = (jobs ?? []).filter((j) =>
    j.status !== "cancelled" && (j.status !== "completed" || new Date(j.completedAt!).toDateString() === today));

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Job board</h1>
          <p className="page-sub">Move each car along as it goes through the wash. Tap a plate to see where it has been.</p>
        </div>
      </header>
      {error && <div className="banner" role="alert"><AlertTriangle size={18} aria-hidden />{error}</div>}
      <div className="board">
        {COLUMNS.map(({ status, hint }) => {
          const Icon = statusIcon(status);
          const items = visible.filter((j) => j.status === status);
          return (
            <section key={status} className="column" aria-label={STATUS_LABEL[status]}>
              <div className="column-head">
                <Icon size={16} aria-hidden />
                <h2 style={{ fontSize: 15 }}>{STATUS_LABEL[status]}</h2>
                <span className="column-count">{items.length}</span>
              </div>
              {jobs === null
                ? <div className="skeleton" style={{ height: 150 }} />
                : items.length === 0
                  ? <Empty icon={Icon} title="Nothing here">{hint}</Empty>
                  : items.map((job) => <JobCard key={job.id} job={job} employees={employees ?? []} onChanged={refresh} onTrack={onTrack} />)}
            </section>
          );
        })}
      </div>
    </>
  );
}

function JobCard({ job, employees, onChanged, onTrack }: {
  job: Job; employees: Employee[]; onChanged: () => void; onTrack: (plate: string) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const next = NEXT_STATUS[job.status];
  const open = job.status !== "completed" && job.status !== "cancelled";
  const seconds = !open ? job.elapsedSeconds
    : job.status === "in_progress" && job.startedAt ? secondsSince(job.startedAt, now) : secondsSince(job.arrivalAt, now);
  const slow = job.status === "in_progress" && seconds > SLOW_WASH_SECONDS;
  const available = employees.filter((e) => e.active && !job.assignments.some((a) => a.employeeId === e.id));

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast("ok", success);
      onChanged();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card job" aria-label={`Job for ${job.plate}`}>
      <div className="job-top">
        <Plate plate={job.plate} onClick={() => onTrack(job.plate)} />
        <span className={`mono ${slow ? "timer-warn" : "muted"}`} style={{ fontSize: 13, display: "inline-flex", gap: 4, alignItems: "center" }}
          title={job.status === "in_progress" ? "Time in the bay" : open ? "Time since arrival" : "Total time"}>
          {slow ? <AlertTriangle size={13} aria-label="Running long" /> : <Clock3 size={13} aria-hidden />}
          {formatDuration(seconds)}
        </span>
      </div>
      <div>
        <strong>{job.packageName}</strong>
        <div className="job-meta">
          <span style={{ textTransform: "uppercase" }}>{job.vehicleClass}</span>
          <span><CircleDollarSign size={13} aria-hidden />{money(job.priceUsd, job.currency)}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="avatars">
          {job.assignments.length
            ? job.assignments.map((a) => <Initials key={a.employeeId} name={a.employeeName} />)
            : <span className="subtle">No one assigned</span>}
        </div>
        {open && available.length > 0 && !assigning && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssigning(true)}>
            <UserPlus size={15} aria-hidden />Assign
          </button>
        )}
      </div>
      {assigning && (
        <div style={{ display: "flex", gap: 6 }}>
          <label className="sr-only" htmlFor={`assign-${job.id}`}>Assign employee</label>
          <select id={`assign-${job.id}`} className="input" style={{ minHeight: 36 }} defaultValue=""
            onChange={(e) => {
              const employee = available.find((x) => x.id === e.target.value);
              if (!employee) return;
              setAssigning(false);
              void run(() => api.assignEmployee(job.id, employee.id), `${employee.name} assigned to ${job.plate}`);
            }}>
            <option value="" disabled>Choose…</option>
            {available.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button type="button" className="btn btn-sm icon-btn" style={{ width: 36 }} aria-label="Cancel assigning" onClick={() => setAssigning(false)}>
            <X size={15} aria-hidden />
          </button>
        </div>
      )}
      {open && (
        <div className="job-actions">
          {next && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => run(() => api.transitionJob(job.id, next), `${job.plate}: ${STATUS_LABEL[next]}`)}>
              {NEXT_ACTION[job.status]}<ArrowRight size={15} aria-hidden />
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost btn-danger" style={{ flex: "0 0 auto" }} disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel the job for ${job.plate}? This can't be undone.`))
                void run(() => api.transitionJob(job.id, "cancelled"), `${job.plate} cancelled`);
            }}>
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}
