// CarwashApiClient — typed client for the SparkleWash API.
//
// Transport: the Electron main-process proxy (`window.electronAPI.carwashFetch`,
// no CORS from the app://dist origin) when the base URL is absolute and the bridge
// exists; plain `fetch` otherwise (browser/dev, where the base URL may be relative,
// e.g. "/carwash-api" → Vite dev proxy). Every write takes an idempotency key.

import type {
  CarwashSession,
  CarwashJob,
  Employee,
  JobPaymentInput,
  JobStatus,
  JobSummary,
  JobView,
  PackageCatalog,
  WalkInInput,
} from './types';

export class CarwashApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly isNetwork: boolean;

  constructor(message: string, opts: { status: number; body?: unknown; isNetwork?: boolean }) {
    super(message);
    this.name = 'CarwashApiError';
    this.status = opts.status;
    this.body = opts.body ?? null;
    this.isNetwork = opts.isNetwork ?? false;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface CarwashTransportRequest {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface CarwashTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Set by the Electron proxy when it could not reach the server (status 0). */
  error?: string;
}

export type CarwashTransport = (req: CarwashTransportRequest) => Promise<CarwashTransportResponse>;

interface ElectronCarwashBridge {
  carwashFetch?: (config: CarwashTransportRequest) => Promise<CarwashTransportResponse>;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export function getElectronCarwashBridge(): ElectronCarwashBridge | null {
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: ElectronCarwashBridge }).electronAPI : undefined;
  return api && typeof api.carwashFetch === 'function' ? api : null;
}

export function normalizeBaseUrl(url: string): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Default transport: Electron bridge for absolute URLs, otherwise fetch. */
export const defaultTransport: CarwashTransport = async (req) => {
  const bridge = getElectronCarwashBridge();
  if (bridge && isAbsoluteUrl(req.baseUrl)) {
    return bridge.carwashFetch!(req);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const response = await fetch(`${req.baseUrl}${req.path}`, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    return { status: response.status, headers, body: await response.text() };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: 0,
      headers: {},
      body: '',
      error: aborted ? 'El servidor no respondió a tiempo' : 'No se pudo conectar con el servidor',
    };
  } finally {
    clearTimeout(timer);
  }
};

export interface CarwashApiClientOptions {
  baseUrl: string;
  token?: string | null;
  transport?: CarwashTransport;
  timeoutMs?: number;
}

export interface GoogleLoginResponse {
  sessionToken: string;
  subject: string;
  role: CarwashSession['role'];
  expiresAt: string;
  tenant?: CarwashSession['tenant'];
}

export type SessionInfo = Omit<CarwashSession, 'sessionToken'>;

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class CarwashApiClient {
  private baseUrl: string;
  private token: string | null;
  private readonly transport: CarwashTransport;
  private readonly timeoutMs: number;

  constructor(opts: CarwashApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.token = opts.token ?? null;
    this.transport = opts.transport ?? defaultTransport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = normalizeBaseUrl(url);
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: CarwashTransportResponse;
    try {
      response = await this.transport({
        baseUrl: this.baseUrl,
        path,
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new CarwashApiError(err instanceof Error ? err.message : 'Error de red', { status: 0, isNetwork: true });
    }
    if (response.status === 0) {
      throw new CarwashApiError(response.error || 'No se pudo conectar con el servidor', { status: 0, isNetwork: true });
    }
    const parsed = parseBody(response.body);
    if (response.status >= 200 && response.status < 300) return parsed as T;
    const apiMessage = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : null;
    throw new CarwashApiError(apiMessage || `Error del servidor (${response.status})`, { status: response.status, body: parsed });
  }

  // ── Auth ───────────────────────────────────────────────────────────
  googleLogin(idToken: string): Promise<GoogleLoginResponse> {
    return this.request('POST', '/api/auth/google', { body: { idToken }, auth: false });
  }
  getSession(): Promise<SessionInfo> {
    return this.request('GET', '/api/auth/session');
  }
  deleteSession(): Promise<unknown> {
    return this.request('DELETE', '/api/auth/session');
  }

  // ── Reads ──────────────────────────────────────────────────────────
  getPackages(): Promise<PackageCatalog> {
    return this.request('GET', '/api/packages');
  }
  listJobs(): Promise<JobView[]> {
    return this.request('GET', '/api/jobs');
  }
  getJob(id: string): Promise<JobView> {
    return this.request('GET', `/api/jobs/${encodeURIComponent(id)}`);
  }
  getJobsSummary(): Promise<JobSummary> {
    return this.request('GET', '/api/jobs/summary');
  }
  listEmployees(): Promise<Employee[]> {
    return this.request('GET', '/api/employees');
  }

  // ── Writes (idempotency key required) ──────────────────────────────
  transitionJob(id: string, status: Exclude<JobStatus, 'arrived'>, idempotencyKey: string): Promise<JobView> {
    return this.request('POST', `/api/jobs/${encodeURIComponent(id)}/transition`, { body: { status }, idempotencyKey });
  }
  assignEmployee(id: string, employeeId: string, idempotencyKey: string): Promise<JobView> {
    return this.request('POST', `/api/jobs/${encodeURIComponent(id)}/employees`, { body: { employeeId }, idempotencyKey });
  }
  createWalkIn(input: WalkInInput & { ticketNumber?: string; source?: 'desktop-pos' | 'camera' }, idempotencyKey: string): Promise<JobView> {
    return this.request('POST', '/api/jobs/walk-in', { body: { source: 'desktop-pos', ...input }, idempotencyKey });
  }
  setJobTicket(id: string, ticketNumber: string, idempotencyKey: string): Promise<JobView> {
    return this.request('POST', `/api/jobs/${encodeURIComponent(id)}/ticket`, { body: { ticketNumber }, idempotencyKey });
  }
  recordPayment(id: string, payment: JobPaymentInput, idempotencyKey: string): Promise<JobView> {
    return this.request('POST', `/api/jobs/${encodeURIComponent(id)}/payments`, { body: payment, idempotencyKey });
  }
}

/** The subset of the client the outbox/sync/slice depend on (easy to fake in tests). */
export type CarwashClientLike = Pick<
  CarwashApiClient,
  | 'googleLogin' | 'getSession' | 'deleteSession' | 'getPackages' | 'listJobs' | 'getJob' | 'getJobsSummary'
  | 'listEmployees' | 'transitionJob' | 'assignEmployee' | 'createWalkIn' | 'setJobTicket' | 'recordPayment'
  | 'setToken' | 'getToken' | 'setBaseUrl' | 'getBaseUrl'
>;

export type { CarwashJob };
