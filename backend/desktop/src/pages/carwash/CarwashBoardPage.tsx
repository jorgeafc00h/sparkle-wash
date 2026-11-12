// Lavado — live workboard of the car washes: Llegó → En cola → En proceso →
// Listo. Jobs come from the Car Spa API (shared with the iOS app) and are
// created offline-first through the carwash slice's outbox.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Car, CloudOff, Plus, Printer, RefreshCw, UserPlus, X, ArrowRight, Wallet, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { usePermissionCheck } from '@/hooks/useLocalUsers';
import {
  assignJobEmployee,
  flushCarwashOutbox,
  refreshCarwash,
  selectCarwashEmployees,
  selectCarwashJobs,
  selectCarwashSession,
  selectCarwashSyncStatus,
  transitionJob,
} from '@/store/slices/carwashSlice';
import {
  JOB_STATUS_LABELS,
  NEXT_JOB_STATUSES,
  type CarwashJob,
  type CarwashSyncState,
  type Employee,
  type JobStatus,
} from '@/services/carwash/types';
import { receiptDateTime } from '@/services/printing/ReceiptDocument';
import { NewServiceModal } from '@/components/carwash/NewServiceModal';
import { useCarwashInit } from '@/components/carwash/useCarwashInit';
import { useWorkTicketPrinter } from '@/components/carwash/useWorkTicketPrinter';
import { buildBoard, formatElapsed, jobElapsedMs } from '@/components/carwash/carwashUi';
import { isUntrackedLegacyJob } from '@/services/carwash/posCarwashLines';

const SYNC_LABEL: Record<CarwashSyncState, { label: string; variant: 'success' | 'info' | 'warning' | 'error' | 'neutral' }> = {
  'signed-out': { label: 'Sin sesión', variant: 'neutral' },
  offline: { label: 'Sin conexión', variant: 'warning' },
  connecting: { label: 'Conectando…', variant: 'info' },
  live: { label: 'En vivo', variant: 'success' },
  polling: { label: 'Sondeo', variant: 'info' },
  error: { label: 'Error de sincronización', variant: 'error' },
};

const COLUMNS: Array<{ status: Exclude<JobStatus, 'cancelled'>; title: string; testId: string }> = [
  { status: 'arrived', title: 'Llegó', testId: 'carwash-col-arrived' },
  { status: 'queued', title: 'En cola', testId: 'carwash-col-queued' },
  { status: 'in_progress', title: 'En proceso', testId: 'carwash-col-in_progress' },
  { status: 'completed', title: 'Listo (hoy)', testId: 'carwash-col-completed' },
];

const ADVANCE_LABEL: Partial<Record<JobStatus, string>> = {
  queued: 'A la cola',
  in_progress: 'Iniciar',
  completed: 'Terminar',
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function PaymentChip({ job }: { job: CarwashJob }) {
  const paid = job.paidUsd ?? 0;
  // Opened before payment tracking: settled outside the POS, nothing to collect.
  if (isUntrackedLegacyJob(job)) return null;
  if (job.paymentStatus === 'paid' || (paid >= job.priceUsd && job.priceUsd > 0)) {
    return <Badge variant="success" size="sm" data-testid="carwash-pay-chip">Pagado</Badge>;
  }
  if (paid > 0) {
    return <Badge variant="warning" size="sm" data-testid="carwash-pay-chip">Abono ${paid.toFixed(2)}</Badge>;
  }
  return <Badge variant="neutral" size="sm" data-testid="carwash-pay-chip">Por cobrar ${job.priceUsd.toFixed(2)}</Badge>;
}

interface JobCardProps {
  job: CarwashJob;
  now: number;
  canCharge: boolean;
  onAdvance: (job: CarwashJob, status: Exclude<JobStatus, 'arrived'>) => void;
  onCancel: (job: CarwashJob) => void;
  onAssign: (job: CarwashJob) => void;
  onPrint: (job: CarwashJob) => void;
  onCharge: (job: CarwashJob) => void;
}

function JobCard({ job, now, canCharge, onAdvance, onCancel, onAssign, onPrint, onCharge }: JobCardProps) {
  const next = NEXT_JOB_STATUSES[job.status].find((s) => s !== 'cancelled');
  const canCancel = NEXT_JOB_STATUSES[job.status].includes('cancelled');
  const employees = Array.from(new Set(job.assignments.map((a) => a.employeeName)));
  const unpaid = job.paymentStatus !== 'paid' && (job.paidUsd ?? 0) < job.priceUsd && !isUntrackedLegacyJob(job);
  return (
    <div
      data-testid="carwash-job-card"
      data-job-id={job.id}
      data-status={job.status}
      className="rounded-lg border border-brand-200 bg-white p-3 shadow-sm space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-lg font-bold tracking-wider text-brand-900" data-testid="carwash-job-plate">{job.plate}</p>
          <p className="text-xs text-slate-600 truncate">{job.packageName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-mono text-slate-500" data-testid="carwash-job-ticket">{job.ticketNumber ?? 'Sin orden'}</p>
          <p className="text-sm font-semibold tabular-nums text-accent-700" data-testid="carwash-job-elapsed" title={`Ingreso ${receiptDateTime(job.arrivalAt)}`}>
            {formatElapsed(jobElapsedMs(job, now))}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <PaymentChip job={job} />
        {job.pendingSync && <Badge variant="info" size="sm" data-testid="carwash-pending-badge">Pendiente de sync</Badge>}
        {job.syncError && <Badge variant="error" size="sm" title={job.syncError} data-testid="carwash-error-badge">Error de sync</Badge>}
        {job.customerName && <span className="text-xs text-slate-500 truncate">{job.customerName}</span>}
      </div>

      <p className="text-xs text-slate-600" data-testid="carwash-job-employees">
        {employees.length > 0 ? employees.join(', ') : <span className="text-slate-400">Sin empleado</span>}
      </p>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {next && (
          <Button size="sm" data-testid="carwash-advance" onClick={() => onAdvance(job, next)}>
            {ADVANCE_LABEL[next] ?? JOB_STATUS_LABELS[next]} <ArrowRight size={14} />
          </Button>
        )}
        {unpaid && canCharge && job.status !== 'cancelled' && (
          <Button size="sm" variant="secondary" data-testid="carwash-charge" onClick={() => onCharge(job)}>
            <Wallet size={14} /> Cobrar
          </Button>
        )}
        <Button size="sm" variant="ghost" data-testid="carwash-print" aria-label={`Imprimir ticket de ${job.plate}`} title="Imprimir / reimprimir ticket de trabajo" onClick={() => onPrint(job)}>
          <Printer size={14} />
        </Button>
        {job.status !== 'completed' && (
          <Button size="sm" variant="ghost" data-testid="carwash-assign" aria-label={`Asignar empleado a ${job.plate}`} title="Asignar empleado" onClick={() => onAssign(job)}>
            <UserPlus size={14} />
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="ghost" data-testid="carwash-cancel-job" aria-label={`Cancelar ${job.plate}`} title="Cancelar servicio" onClick={() => onCancel(job)}>
            <X size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function CarwashBoardPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const { canOpen } = usePermissionCheck();
  const session = useAppSelector(selectCarwashSession);
  const jobs = (useAppSelector(selectCarwashJobs) as CarwashJob[] | undefined) ?? [];
  const employees = (useAppSelector(selectCarwashEmployees) as Employee[] | undefined) ?? [];
  const sync = useAppSelector(selectCarwashSyncStatus);
  const { print } = useWorkTicketPrinter();
  const now = useNow();

  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CarwashJob | null>(null);
  const [assignTarget, setAssignTarget] = useState<CarwashJob | null>(null);
  const [assignEmployee, setAssignEmployee] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useCarwashInit();

  const { columns, summary } = useMemo(() => buildBoard(jobs, now, search), [jobs, now, search]);
  const canCharge = canOpen('/pos');
  const signedIn = !!session;

  async function syncNow() {
    setRefreshing(true);
    try {
      await dispatch(flushCarwashOutbox()).unwrap();
      await dispatch(refreshCarwash()).unwrap();
    } catch (err) {
      toast.error(`No se pudo sincronizar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function advance(job: CarwashJob, status: Exclude<JobStatus, 'arrived'>) {
    try {
      await dispatch(transitionJob({ jobId: job.id, status })).unwrap();
    } catch (err) {
      toast.error(`No se pudo cambiar el estado: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function confirmCancel() {
    const job = cancelTarget;
    setCancelTarget(null);
    if (job) await advance(job, 'cancelled');
  }

  async function confirmAssign() {
    const job = assignTarget;
    if (!job || !assignEmployee) return;
    setAssignTarget(null);
    try {
      await dispatch(assignJobEmployee({ jobId: job.id, employeeId: assignEmployee })).unwrap();
      toast.success('Empleado asignado');
    } catch (err) {
      toast.error(`No se pudo asignar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function printJob(job: CarwashJob) {
    const result = await print(job);
    if (result.ok) toast.success(`Ticket ${result.job.ticketNumber ?? ''} impreso`.trim());
    else toast.warning(`No se pudo imprimir el ticket: ${result.error}`);
  }

  const cardProps = {
    now,
    canCharge,
    onAdvance: (j: CarwashJob, s: Exclude<JobStatus, 'arrived'>) => void advance(j, s),
    onCancel: setCancelTarget,
    onAssign: (j: CarwashJob) => { setAssignEmployee(''); setAssignTarget(j); },
    onPrint: (j: CarwashJob) => void printJob(j),
    onCharge: (j: CarwashJob) => navigate(`/pos?carwashJob=${encodeURIComponent(j.id)}`),
  };

  if (!signedIn && jobs.length === 0) {
    return (
      <div data-testid="carwash-board">
        <PageHeader title="Lavado" subtitle="Órdenes de trabajo de Car Spa" />
        <EmptyState
          icon={<Car size={32} />}
          title="Car Spa no está conectado"
          message="Inicia sesión con Google y configura la API para ver y crear servicios de lavado."
        />
        <div className="text-center mt-3">
          <Link to="/settings/carwash" data-testid="carwash-go-settings" className="inline-flex items-center gap-1 text-accent-600 hover:underline text-sm">
            <Settings2 size={14} /> Ir a la configuración de Car Spa
          </Link>
        </div>
      </div>
    );
  }

  const state = SYNC_LABEL[sync.state] ?? SYNC_LABEL.offline;

  return (
    <div data-testid="carwash-board" className="space-y-4">
      <PageHeader
        title="Lavado"
        subtitle="Órdenes de trabajo de Car Spa"
        actions={
          <>
            <div className="flex items-center gap-2 text-xs text-slate-500" data-testid="carwash-sync-status">
              <Badge variant={state.variant} size="sm">{sync.state === 'offline' && <CloudOff size={12} className="mr-1" />}{state.label}</Badge>
              {sync.pending > 0 && <Badge variant="warning" size="sm" data-testid="carwash-pending-count">{sync.pending} pendiente{sync.pending === 1 ? '' : 's'}</Badge>}
              {sync.lastSyncedAt && <span>Últ. sync {receiptDateTime(sync.lastSyncedAt).slice(-5)}</span>}
            </div>
            <Button variant="secondary" size="sm" data-testid="carwash-sync" loading={refreshing} onClick={() => void syncNow()}>
              <RefreshCw size={16} /> Sincronizar
            </Button>
            <Button size="sm" data-testid="carwash-new-service" onClick={() => setNewOpen(true)}>
              <Plus size={16} /> Nuevo servicio
            </Button>
          </>
        }
      />

      {sync.lastError && sync.state === 'error' && (
        <p className="text-xs text-error" data-testid="carwash-sync-error">{sync.lastError}</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="carwash-summary">
        {[
          { label: 'En sitio', value: summary.onSite, id: 'onsite' },
          { label: 'En proceso', value: summary.inProgress, id: 'inprogress' },
          { label: 'Listos hoy', value: summary.doneToday, id: 'done' },
          { label: 'Por cobrar', value: summary.toCollect, id: 'tocollect' },
        ].map((s) => (
          <Card key={s.id} className="p-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-2xl font-bold text-brand-900" data-testid={`carwash-summary-${s.id}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <input
        type="search"
        data-testid="carwash-search"
        aria-label="Buscar por placa o número de orden"
        placeholder="Buscar por placa o número de orden…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md rounded-md border border-brand-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {COLUMNS.map((col) => {
          const list = columns[col.status];
          return (
            <section key={col.status} data-testid={col.testId} aria-label={col.title} className="rounded-lg bg-brand-50 p-2 space-y-2 min-h-[8rem]">
              <h2 className="px-1 text-sm font-semibold text-brand-800 flex items-center justify-between">
                {col.title}
                <span className="text-xs font-normal text-slate-500">{list.length}</span>
              </h2>
              {list.length === 0 && <p className="text-xs text-slate-400 px-1 py-3 text-center">Sin vehículos</p>}
              {list.map((job) => <JobCard key={job.id} job={job} {...cardProps} />)}
            </section>
          );
        })}
      </div>

      <NewServiceModal isOpen={newOpen} onClose={() => setNewOpen(false)} />

      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void confirmCancel()}
        title="Cancelar servicio"
        message={cancelTarget ? `¿Cancelar el servicio de ${cancelTarget.plate}${cancelTarget.ticketNumber ? ` (${cancelTarget.ticketNumber})` : ''}? No se puede deshacer.` : ''}
        confirmLabel="Cancelar servicio"
        cancelLabel="Volver"
        variant="danger"
      />

      <Modal
        isOpen={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        title={assignTarget ? `Asignar empleado — ${assignTarget.plate}` : 'Asignar empleado'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignTarget(null)}>Cancelar</Button>
            <Button onClick={() => void confirmAssign()} disabled={!assignEmployee} data-testid="carwash-assign-confirm">Asignar</Button>
          </>
        }
      >
        <Select
          label="Empleado"
          id="carwash-assign-employee"
          data-testid="carwash-assign-select"
          value={assignEmployee}
          onChange={(e) => setAssignEmployee(e.target.value)}
          placeholder="Elige un empleado"
          options={employees.filter((e) => e.active !== false).map((e) => ({ label: e.name, value: e.id }))}
        />
      </Modal>
    </div>
  );
}
