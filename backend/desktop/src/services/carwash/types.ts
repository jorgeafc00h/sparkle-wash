// SparkleWash carwash integration — shared contract between the API client/outbox/sync
// (data layer) and the workboard/POS/printing UI. Mirrors the API JSON (camelCase).
// See docs/SPARKLEWASH_INTEGRATION.md.

export type JobStatus = 'arrived' | 'queued' | 'in_progress' | 'completed' | 'cancelled';
export type StaffRole = 'viewer' | 'operator' | 'admin';
export type JobSource = 'camera' | 'desktop-pos';
export type JobPaymentMethod = 'cash' | 'card' | 'transfer' | 'other';
export type JobPaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface VehicleClass {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ServicePackage {
  id: string;
  name: string;
  /** Service lines included in the package. */
  items: string[];
  /** Price (USD) per vehicle class id. */
  prices: Record<string, number>;
  [key: string]: unknown;
}

export interface PackageCatalog {
  currency: string;
  vehicleClasses: VehicleClass[];
  packages: ServicePackage[];
  [key: string]: unknown;
}

export interface JobTransition {
  status: JobStatus;
  at: string;
  actor: string;
  idempotencyKey: string;
}

export interface JobAssignment {
  employeeId: string;
  employeeName: string;
  assignedAt: string;
  idempotencyKey?: string;
}

export interface JobPayment {
  id: string;
  method: JobPaymentMethod;
  amountUsd: number;
  /** POS sale ticket number used as the payment reference (e.g. "C1-000123"). */
  ticketNumber: string | null;
  reference: string | null;
  recordedAt: string;
  actor: string;
  idempotencyKey: string;
}

/** `JobView` from the API. Optional fields are absent/null on jobs created before the desktop POS. */
export interface JobView {
  id: string;
  arrivalId: string;
  plate: string;
  vehicleClass: string;
  packageId: string;
  packageName: string;
  services: string[];
  priceUsd: number;
  currency: string;
  status: JobStatus;
  arrivalAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  elapsedSeconds: number;
  activeSeconds: number | null;
  transitions: JobTransition[];
  assignments: JobAssignment[];
  source?: JobSource | null;
  ticketNumber?: string | null;
  customerName?: string | null;
  note?: string | null;
  payments?: JobPayment[];
  paidUsd?: number;
  paymentStatus?: JobPaymentStatus;
  paidAt?: string | null;
}

/**
 * A job as the desktop knows it: the server copy, or a local copy created offline
 * (`id` starts with `local-`) that the outbox has not synced yet.
 */
export interface CarwashJob extends JobView {
  /** True while the job (or a change to it) is waiting in the outbox. */
  pendingSync?: boolean;
  /** Last outbox error for this job, shown on the card. */
  syncError?: string | null;
}

export interface JobSummary {
  total: number;
  arrived: number;
  queued: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  arrivalsTodayUtc: number;
  completedTodayUtc: number;
  averageCompletedSeconds: number | null;
  arrivalsToday?: number;
  completedToday?: number;
}

export interface Employee {
  id: string;
  name: string;
  active: boolean;
  [key: string]: unknown;
}

export interface CarwashTenant {
  id: string;
  name: string;
  timeZone?: string;
  [key: string]: unknown;
}

export interface CarwashSession {
  sessionToken: string;
  subject: string;
  role: StaffRole;
  expiresAt: string;
  email?: string | null;
  name?: string | null;
  tenant?: CarwashTenant | null;
}

export interface CarwashSettings {
  /** API origin, e.g. "http://localhost:8080" or the cloud host. No trailing slash. */
  apiBaseUrl: string;
  /** Register code printed in work-ticket numbers ("C1" → OT-C1-000045). */
  registerCode: string;
  /** Print the work ticket as soon as a walk-in is created. */
  autoPrintWorkTicket: boolean;
  /** Copies per work ticket (customer copy + vehicle tag). 1–3. */
  workTicketCopies: number;
  /** Footer line on the work ticket. */
  workTicketFooter: string;
  /** Poll interval when the event stream is unavailable (seconds). */
  pollSeconds: number;
}

export const DEFAULT_CARWASH_SETTINGS: CarwashSettings = {
  apiBaseUrl: 'http://localhost:8080',
  registerCode: 'C1',
  autoPrintWorkTicket: true,
  workTicketCopies: 1,
  workTicketFooter: 'Presente este ticket al retirar su vehículo',
  pollSeconds: 15,
};

export interface WalkInInput {
  plate: string;
  vehicleClass: string;
  packageId: string;
  employeeId?: string;
  customerName?: string;
  note?: string;
}

export interface JobPaymentInput {
  method: JobPaymentMethod;
  amountUsd: number;
  ticketNumber?: string;
  reference?: string;
}

export type CarwashSyncState = 'signed-out' | 'offline' | 'connecting' | 'live' | 'polling' | 'error';

export interface CarwashSyncStatus {
  state: CarwashSyncState;
  /** Outbox entries waiting to be sent. */
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** One queued write. Ops replay in `seq` order; `idempotencyKey` makes replays safe. */
export type CarwashOutboxOp =
  | { kind: 'walk-in'; localJobId: string; input: WalkInInput & { ticketNumber: string } }
  | { kind: 'transition'; jobId: string; status: Exclude<JobStatus, 'arrived'> }
  | { kind: 'assign'; jobId: string; employeeId: string }
  | { kind: 'ticket'; jobId: string; ticketNumber: string }
  | { kind: 'payment'; jobId: string; payment: JobPaymentInput };

export interface CarwashOutboxEntry {
  id: string;
  seq: number;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** True once the server rejected the op (4xx). Failed entries are skipped by flush but stay visible. */
  failed?: boolean;
  /**
   * Account the write belongs to (`<api origin>|<tenant id>`). Flushes only send entries of the signed-in
   * scope, so another carwash or server never receives them. Unscoped entries (queued while signed out,
   * or before scoping existed) are claimed by the next scope that flushes.
   */
  scope?: string | null;
  op: CarwashOutboxOp;
}

export const LOCAL_JOB_PREFIX = 'local-';
export const isLocalJobId = (id: string): boolean => id.startsWith(LOCAL_JOB_PREFIX);

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  arrived: 'Llegó',
  queued: 'En cola',
  in_progress: 'En proceso',
  completed: 'Listo',
  cancelled: 'Cancelado',
};

/** Allowed next statuses (mirrors JobStore.TransitionAsync on the API). */
export const NEXT_JOB_STATUSES: Record<JobStatus, Array<Exclude<JobStatus, 'arrived'>>> = {
  arrived: ['queued', 'cancelled'],
  queued: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
