import { idempotencyKey } from "./format";
import type {
  ArrivalObservation, Catalog, Employee, Job, JobStatus, JobSummary, PlateTimeline, Session, Station, StationAlert,
} from "./types";

/** Everything the console needs. Implemented by the live HTTP API and by the in-browser demo. */
export interface SparkleApi {
  readonly mode: "live" | "demo";
  session(): Promise<Session>;
  catalog(): Promise<Catalog>;
  pendingArrivals(): Promise<ArrivalObservation[]>;
  recentSightings(limit?: number): Promise<ArrivalObservation[]>;
  arrivalPhotoUrl(arrival: ArrivalObservation): Promise<string | null>;
  confirmArrival(id: string, plate: string, vehicleClass: string): Promise<ArrivalObservation>;
  openJob(arrivalId: string, packageId: string): Promise<Job>;
  jobs(): Promise<Job[]>;
  jobSummary(): Promise<JobSummary>;
  transitionJob(id: string, status: JobStatus): Promise<Job>;
  employees(): Promise<Employee[]>;
  assignEmployee(jobId: string, employeeId: string): Promise<Job>;
  plateTimeline(plate: string): Promise<PlateTimeline>;
  stations(): Promise<Station[]>;
  alerts(): Promise<StationAlert[]>;
  signOut(): Promise<void>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class HttpApi implements SparkleApi {
  readonly mode = "live" as const;
  private readonly photoCache = new Map<string, string>();

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  static async signIn(baseUrl: string, idToken: string): Promise<HttpApi> {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (response.status === 503) throw new ApiError(503, "Google sign-in is not configured on the server.");
    if (!response.ok) throw new ApiError(response.status, "This Google account is not on the staff list.");
    const body = (await response.json()) as { sessionToken: string };
    return new HttpApi(baseUrl, body.sessionToken);
  }

  get sessionToken() { return this.token; }

  private async request<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (init.body) headers["Content-Type"] = "application/json";
    if (init.key) headers["Idempotency-Key"] = init.key;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let message = response.statusText || `HTTP ${response.status}`;
      try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* no JSON body */ }
      if (response.status === 401) message = "Your session expired. Sign in again.";
      if (response.status === 403) message = "Your role can't do that. Ask an admin.";
      throw new ApiError(response.status, message);
    }
    return (await response.json()) as T;
  }

  session() { return this.request<Session>("/api/auth/session"); }
  catalog() { return this.request<Catalog>("/api/packages"); }
  pendingArrivals() { return this.request<ArrivalObservation[]>("/api/arrivals?pending=true&limit=50"); }
  recentSightings(limit = 30) { return this.request<ArrivalObservation[]>(`/api/arrivals?limit=${limit}`); }

  async arrivalPhotoUrl(arrival: ArrivalObservation) {
    if (!arrival.photoId) return null;
    const cached = this.photoCache.get(arrival.id);
    if (cached) return cached;
    const response = await fetch(`${this.baseUrl}/api/arrivals/${arrival.id}/photo`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) return null;
    const url = URL.createObjectURL(await response.blob());
    this.photoCache.set(arrival.id, url);
    return url;
  }

  confirmArrival(id: string, plate: string, vehicleClass: string) {
    return this.request<ArrivalObservation>(`/api/arrivals/${id}/confirm`, {
      method: "POST", body: JSON.stringify({ plate, vehicleClass }),
    });
  }

  openJob(arrivalId: string, packageId: string) {
    return this.request<Job>("/api/jobs", {
      method: "POST", body: JSON.stringify({ arrivalId, packageId }), key: `open-${arrivalId}-${packageId}`.slice(0, 128),
    });
  }

  jobs() { return this.request<Job[]>("/api/jobs"); }
  jobSummary() { return this.request<JobSummary>("/api/jobs/summary"); }

  transitionJob(id: string, status: JobStatus) {
    return this.request<Job>(`/api/jobs/${id}/transition`, {
      method: "POST", body: JSON.stringify({ status }), key: `${status}-${id}`.slice(0, 128),
    });
  }

  employees() { return this.request<Employee[]>("/api/employees"); }

  assignEmployee(jobId: string, employeeId: string) {
    return this.request<Job>(`/api/jobs/${jobId}/employees`, {
      method: "POST", body: JSON.stringify({ employeeId }), key: idempotencyKey("assign"),
    });
  }

  plateTimeline(plate: string) { return this.request<PlateTimeline>(`/api/plates/${encodeURIComponent(plate)}/timeline`); }

  async stations() {
    const response = await fetch(`${this.baseUrl}/api/metrics`);
    return response.ok ? ((await response.json()) as Station[]) : [];
  }

  async alerts() {
    const response = await fetch(`${this.baseUrl}/api/metrics/alerts`);
    return response.ok ? ((await response.json()) as StationAlert[]) : [];
  }

  async signOut() {
    await fetch(`${this.baseUrl}/api/auth/session`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
  }
}
