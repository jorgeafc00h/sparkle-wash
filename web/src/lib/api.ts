import { idempotencyKey } from "./format";
import type {
  ArrivalObservation, Catalog, ChangeTopic, ConnectionState, Device, DeviceInput, DeviceWithKey, DismissReason, Role, Team,
  Tenant, TenantInput, Employee, Job, JobStatus, JobSummary, PlateTimeline, Session, Station, StationAlert,
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
  dismissArrival(id: string, reason: DismissReason): Promise<ArrivalObservation>;
  // ---- administration ----
  tenant(): Promise<Tenant>;
  updateTenant(input: TenantInput): Promise<Tenant>;
  devices(): Promise<Device[]>;
  createDevice(input: DeviceInput): Promise<DeviceWithKey>;
  rotateDevice(id: string): Promise<DeviceWithKey>;
  setDeviceDisabled(id: string, disabled: boolean): Promise<Device>;
  team(): Promise<Team>;
  invite(email: string, role: Role): Promise<void>;
  revokeInvitation(id: string): Promise<void>;
  setMemberRole(subject: string, role: Role): Promise<void>;
  removeMember(subject: string): Promise<void>;
  addEmployee(name: string): Promise<Employee>;
  setEmployeeActive(id: string, active: boolean): Promise<Employee>;
  /** Pushes "arrivals"/"jobs" change notifications; returns an unsubscribe function. */
  subscribe(onChange: (topic: ChangeTopic) => void, onState?: (state: ConnectionState) => void): () => void;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class HttpApi implements SparkleApi {
  readonly mode = "live" as const;
  private readonly photoCache = new Map<string, string>();

  /** `onUnauthorized` runs when the session expired or was revoked (e.g. after a role change). */
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly onUnauthorized?: () => void) {}

  static async signIn(baseUrl: string, idToken: string, onUnauthorized?: () => void): Promise<HttpApi> {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) throw new ApiError(response.status === 503 ? 503 : 401, "Google sign-in failed");
    const body = (await response.json()) as { sessionToken: string };
    return new HttpApi(baseUrl, body.sessionToken, onUnauthorized);
  }

  static async registrationOpen(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/tenants/registration`);
      return response.ok && ((await response.json()) as { open: boolean }).open;
    } catch { return false; }
  }

  /** Creates a carwash with the Google account behind `idToken` as its admin, and signs in. */
  static async register(baseUrl: string, idToken: string, input: TenantInput, onUnauthorized?: () => void): Promise<HttpApi> {
    const response = await fetch(`${baseUrl}/api/tenants/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, ...input }),
    });
    if (!response.ok) throw new ApiError(response.status, "Registration failed");
    const body = (await response.json()) as { sessionToken: string };
    return new HttpApi(baseUrl, body.sessionToken, onUnauthorized);
  }

  get sessionToken() { return this.token; }

  private async request<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (init.body) headers["Content-Type"] = "application/json";
    if (init.key) headers["Idempotency-Key"] = init.key;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (response.status === 401) this.onUnauthorized?.();
    if (!response.ok) {
      let message = response.statusText || `HTTP ${response.status}`;
      try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* no JSON body */ }
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

  // Per-carwash bay data (the public /api/metrics belongs to the default site only).
  async stations() { return (await this.request<{ stations: Station[] }>("/api/bays")).stations; }
  async alerts() { return (await this.request<{ alerts: StationAlert[] }>("/api/bays")).alerts; }

  dismissArrival(id: string, reason: DismissReason) {
    return this.request<ArrivalObservation>(`/api/arrivals/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) });
  }

  tenant() { return this.request<Tenant>("/api/tenant"); }
  updateTenant(input: TenantInput) { return this.request<Tenant>("/api/tenant", { method: "PUT", body: JSON.stringify(input) }); }
  devices() { return this.request<Device[]>("/api/devices"); }
  createDevice(input: DeviceInput) { return this.request<DeviceWithKey>("/api/devices", { method: "POST", body: JSON.stringify(input) }); }
  rotateDevice(id: string) { return this.request<DeviceWithKey>(`/api/devices/${id}/rotate`, { method: "POST" }); }
  setDeviceDisabled(id: string, disabled: boolean) {
    return this.request<Device>(`/api/devices/${id}/status`, { method: "POST", body: JSON.stringify({ disabled }) });
  }
  team() { return this.request<Team>("/api/team"); }
  async invite(email: string, role: Role) {
    await this.request("/api/team/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
  }
  async revokeInvitation(id: string) { await this.request(`/api/team/invitations/${id}`, { method: "DELETE" }); }
  async setMemberRole(subject: string, role: Role) {
    await this.request(`/api/team/members/${encodeURIComponent(subject)}/role`, { method: "POST", body: JSON.stringify({ role }) });
  }
  async removeMember(subject: string) { await this.request(`/api/team/members/${encodeURIComponent(subject)}`, { method: "DELETE" }); }
  addEmployee(name: string) { return this.request<Employee>("/api/employees", { method: "POST", body: JSON.stringify({ name }) }); }
  setEmployeeActive(id: string, active: boolean) {
    return this.request<Employee>(`/api/employees/${id}/status`, { method: "POST", body: JSON.stringify({ active }) });
  }

  async signOut() {
    await fetch(`${this.baseUrl}/api/auth/session`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
  }

  subscribe(onChange: (topic: ChangeTopic) => void, onState?: (state: ConnectionState) => void) {
    // EventSource can't send an Authorization header, so read the SSE stream with fetch.
    const controller = new AbortController();
    const connect = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/events`, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: "text/event-stream" }, signal: controller.signal,
        });
        if (response.status === 401) { this.onUnauthorized?.(); return; }
        if (!response.ok || !response.body) throw new ApiError(response.status, "event stream unavailable");
        onState?.("live");
        attempt = 0;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            try { onChange((JSON.parse(data.slice(6)) as { topic: ChangeTopic }).topic); } catch { /* ignore malformed frame */ }
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      onState?.("reconnecting");
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(30_000, 2000 * 2 ** attempt)));
      if (!controller.signal.aborted) void connect(attempt + 1);
    };
    void connect(0);
    return () => controller.abort();
  }
}
