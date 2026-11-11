// Shared fakes for the carwash data-layer tests.
import { CarwashApiError, type CarwashClientLike } from '@/services/carwash/CarwashApiClient';
import type { JobView, PackageCatalog, WalkInInput, JobPaymentInput, JobStatus, Employee } from '@/services/carwash/types';

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
  };
}

export const CATALOG: PackageCatalog = {
  currency: 'USD',
  vehicleClasses: [{ id: 'sedan', name: 'Sedán' }],
  packages: [{ id: 'basic', name: 'Básico', items: ['Exterior', 'Aspirado'], prices: { sedan: 12.5 } }],
};

export const EMPLOYEES: Employee[] = [{ id: 'e1', name: 'Ana', active: true }];

export function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    id: 'srv-1',
    arrivalId: 'arr-1',
    plate: 'P123456',
    vehicleClass: 'sedan',
    packageId: 'basic',
    packageName: 'Básico',
    services: ['Exterior'],
    priceUsd: 12.5,
    currency: 'USD',
    status: 'arrived',
    arrivalAt: '2026-11-11T10:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    elapsedSeconds: 0,
    activeSeconds: null,
    transitions: [],
    assignments: [],
    payments: [],
    paidUsd: 0,
    paymentStatus: 'unpaid',
    ...over,
  };
}

export const networkError = () => new CarwashApiError('sin red', { status: 0, isNetwork: true });
export const httpError = (status: number, body: unknown = { error: `http ${status}` }) =>
  new CarwashApiError((body as { error?: string })?.error ?? `http ${status}`, { status, body });

/** In-memory API double. `online=false` makes every call fail with a network error. */
export class FakeClient {
  online = true;
  token: string | null = null;
  baseUrl = 'http://fake';
  jobs: JobView[] = [];
  calls: Array<{ method: string; args: unknown[] }> = [];
  failNext: Record<string, CarwashApiError | undefined> = {};
  private n = 0;

  private gate(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    if (!this.online) throw networkError();
    const fail = this.failNext[method];
    if (fail) {
      delete this.failNext[method];
      throw fail;
    }
  }
  private find(id: string): JobView {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw httpError(404);
    return j;
  }
  setToken = (t: string | null) => {
    this.token = t;
  };
  getToken = () => this.token;
  setBaseUrl = (u: string) => {
    this.baseUrl = u;
  };
  getBaseUrl = () => this.baseUrl;
  async googleLogin(idToken: string) {
    this.gate('googleLogin', idToken);
    return { sessionToken: 'tok', subject: 's1', role: 'operator' as const, expiresAt: '2099-01-01T00:00:00Z', tenant: { id: 't', name: 'Lavado' } };
  }
  async getSession() {
    this.gate('getSession');
    return { subject: 's1', role: 'operator' as const, expiresAt: '2099-01-01T00:00:00Z', email: 'a@b.c', name: 'Ana' };
  }
  async deleteSession() {
    this.gate('deleteSession');
    return {};
  }
  async getPackages() {
    this.gate('getPackages');
    return CATALOG;
  }
  async listJobs() {
    this.gate('listJobs');
    return this.jobs.map((j) => ({ ...j }));
  }
  async getJob(id: string) {
    this.gate('getJob', id);
    return { ...this.find(id) };
  }
  async getJobsSummary() {
    this.gate('getJobsSummary');
    return {
      total: this.jobs.length, arrived: 0, queued: 0, inProgress: 0, completed: 0, cancelled: 0,
      arrivalsTodayUtc: 0, completedTodayUtc: 0, averageCompletedSeconds: null,
    };
  }
  async listEmployees() {
    this.gate('listEmployees');
    return EMPLOYEES;
  }
  async transitionJob(id: string, status: Exclude<JobStatus, 'arrived'>, key: string) {
    this.gate('transitionJob', id, status, key);
    const j = this.find(id);
    j.status = status;
    return { ...j };
  }
  async assignEmployee(id: string, employeeId: string, key: string) {
    this.gate('assignEmployee', id, employeeId, key);
    const j = this.find(id);
    j.assignments = [...j.assignments, { employeeId, employeeName: 'Ana', assignedAt: 'now' }];
    return { ...j };
  }
  async createWalkIn(input: WalkInInput & { ticketNumber?: string }, key: string) {
    this.gate('createWalkIn', input, key);
    const dup = this.jobs.find((j) => j.plate === input.plate && j.status !== 'completed' && j.status !== 'cancelled');
    if (dup) throw httpError(409, { error: 'Plate already has an open job', job: dup });
    this.n += 1;
    const job = makeJob({
      id: `srv-w${this.n}`,
      plate: input.plate,
      ticketNumber: input.ticketNumber ?? null,
      source: 'desktop-pos',
      arrivalAt: new Date(Date.now() + this.n).toISOString(),
    });
    this.jobs.push(job);
    return { ...job };
  }
  async setJobTicket(id: string, ticketNumber: string, key: string) {
    this.gate('setJobTicket', id, ticketNumber, key);
    const j = this.find(id);
    j.ticketNumber = ticketNumber;
    return { ...j };
  }
  async recordPayment(id: string, payment: JobPaymentInput, key: string) {
    this.gate('recordPayment', id, payment, key);
    const j = this.find(id);
    j.paidUsd = (j.paidUsd ?? 0) + payment.amountUsd;
    j.paymentStatus = j.paidUsd >= j.priceUsd ? 'paid' : 'partial';
    return { ...j };
  }
}

export const asClient = (c: FakeClient): CarwashClientLike => c as unknown as CarwashClientLike;
