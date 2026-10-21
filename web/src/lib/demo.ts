import catalogJson from "../../../contracts/v1/service-packages.json";
import stationsJson from "../../../contracts/v1/stations.json";
import alertsJson from "../../../contracts/v1/alerts.json";
import type { SparkleApi } from "./api";
import { ApiError } from "./api";
import { normalizePlate } from "./format";
import type {
  CameraRole, Device, DeviceInput, DeviceWithKey, DismissReason, Invitation, Member, Role, Team, Tenant, TenantInput,
  ArrivalObservation, Catalog, ChangeTopic, Employee, Job, JobStatus, JobSummary, PlateTimeline, Station, StationAlert,
} from "./types";

const catalog = catalogJson as Catalog;
const CAMERAS = ["entrance-cam", "bay1-cam", "bay2-cam", "exit-cam"];
const PLATE_POOL = ["P482913", "M771204", "C55821", "AB123CD", "P903377", "N1CO42", "P118450", "TX4410", "P660021", "SV2026"];
const ROLE_OF: Record<string, CameraRole> = { "entrance-cam": "entry", "bay1-cam": "bay", "exit-cam": "exit" };
const CAR_COLORS = ["#ef4444", "#f8fafc", "#3b82f6", "#111827", "#9ca3af", "#22c55e", "#f59e0b"];

let counter = 0;
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const iso = (offsetSeconds = 0) => new Date(Date.now() - offsetSeconds * 1000).toISOString();

/** A stylised side-view car with a plate, so demo arrivals have evidence photos without a camera. */
export function demoPhoto(plate: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
<rect width="320" height="200" fill="url(#g)"/><rect y="150" width="320" height="50" fill="#334155"/>
<path d="M40 140 Q48 98 96 92 L132 66 Q160 54 204 60 L246 92 Q284 98 288 140 Z" fill="${color}" stroke="#0f172a" stroke-width="3"/>
<path d="M140 72 Q162 64 198 68 L226 92 L134 92 Z" fill="#7dd3fc" opacity=".55"/>
<circle cx="96" cy="146" r="20" fill="#0f172a"/><circle cx="96" cy="146" r="9" fill="#94a3b8"/>
<circle cx="236" cy="146" r="20" fill="#0f172a"/><circle cx="236" cy="146" r="9" fill="#94a3b8"/>
<rect x="124" y="114" width="84" height="24" rx="3" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
<text x="166" y="132" font-family="monospace" font-size="16" font-weight="700" text-anchor="middle" fill="#0f172a">${plate}</text>
<text x="10" y="18" font-family="monospace" font-size="11" fill="#94a3b8">ESP32-CAM ${new Date().toLocaleTimeString("es-SV")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function misread(plate: string): string {
  const swaps: Record<string, string> = { "0": "O", "8": "B", "1": "I", "5": "S" };
  const index = plate.split("").findIndex((c) => c in swaps);
  return index < 0 ? plate : plate.slice(0, index) + swaps[plate[index]] + plate.slice(index + 1);
}

export interface DemoOptions {
  /** Seed a busy morning (default). False starts an empty carwash, as right after registering. */
  seed?: boolean;
  tenant?: Partial<TenantInput>;
}

const randomToken = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 57]).join("");

/**
 * In-browser simulation of the whole flow: cameras report plates, staff confirm, jobs move
 * through the board, and bay cameras keep sighting cars that already have a job.
 */
export class DemoApi implements SparkleApi {
  readonly mode = "demo" as const;
  private arrivals: ArrivalObservation[] = [];
  private jobList: Job[] = [];
  private photos = new Map<string, string>();
  private listeners = new Set<(topic: ChangeTopic) => void>();
  /** Started empty, as right after registering: no bay telemetry, and cars only arrive once an entrance camera is linked. */
  private fresh = false;
  private devicesList: Device[] = [];
  private members: Member[] = [];
  private invitations: Invitation[] = [];
  private tenantData: Tenant;
  private staff: Employee[] = [
    { id: "e1", name: "Maria Garcia", active: true },
    { id: "e2", name: "Luis Hernandez", active: true },
    { id: "e3", name: "Ana Martinez", active: true },
    { id: "e4", name: "Carlos Rivera", active: true },
  ];

  constructor(options: boolean | DemoOptions = true) {
    const { seed = true, tenant } = typeof options === "boolean" ? { seed: options, tenant: undefined } : options;
    this.tenantData = {
      // A registered (fresh) carwash keeps exactly what was typed; the sample carwash gets sample details.
      id: "demo", name: tenant?.name ?? "SparkleWash Escalón", city: tenant ? tenant.city ?? null : "San Salvador",
      country: tenant?.country ?? "SV", phone: tenant ? tenant.phone ?? null : "+503 2222-3333",
      timeZone: tenant?.timeZone ?? "America/El_Salvador", createdAt: iso(86400 * 30),
    };
    this.members = [{ tenantId: "demo", subject: "demo", email: "tu@ejemplo.com", name: "Tú (demo)", role: "admin", addedAt: iso(86400 * 30) }];
    if (!seed) { this.staff = []; this.fresh = true; return; }
    this.members.push({ tenantId: "demo", subject: "demo-maria", email: "maria@ejemplo.com", name: "Maria Garcia", role: "operator", addedAt: iso(86400 * 20) });
    this.invitations = [{ id: "inv-demo", email: "luis@ejemplo.com", role: "viewer", invitedAt: iso(3600 * 5) }];
    const statuses = [-54, -63, -71];
    this.devicesList = (["entrance-cam", "bay1-cam", "exit-cam"] as const).map((cameraId, i) => ({
      id: `dev${i}`, name: ["Cámara de entrada", "Bahía 1", "Cámara de salida"][i], cameraId, role: ROLE_OF[cameraId],
      keyHint: "…" + randomToken(4), createdAt: iso(86400 * (25 - i)), disabled: false, online: true, lastSeenAt: iso(12 + i * 7),
      lastStatus: { rssi: statuses[i], uptimeMs: 3_600_000 * (30 - i * 7), freeHeap: 96_000 - i * 4000, firmware: "sparklewash-cam/1.1", fps: 2.4 - i * 0.2, ip: `192.168.1.${50 + i}` },
      observations: [214, 187, 160][i], keyRotatedAt: null,
    }));
    const opened = [
      { plate: "P118450", cls: "suv", pkg: "renew", status: "in_progress" as JobStatus, age: 1900, washMinutes: 0, staff: ["e1", "e3"] },
      { plate: "C55821", cls: "car", pkg: "essential", status: "queued" as JobStatus, age: 760, washMinutes: 0, staff: ["e2"] },
      { plate: "TX4410", cls: "pickup", pkg: "supreme", status: "arrived" as JobStatus, age: 240, washMinutes: 0, staff: [] },
      { plate: "SV2026", cls: "car", pkg: "quick", status: "completed" as JobStatus, age: 3600, washMinutes: 14, staff: ["e4"] },
      { plate: "M771204", cls: "xl", pkg: "essential", status: "completed" as JobStatus, age: 5400, washMinutes: 38, staff: ["e2"] },
    ];
    for (const seedJob of opened) {
      const arrival = this.observe("entrance-cam", seedJob.plate, 0.93, seedJob.age);
      this.arrivals = this.arrivals.map((a) => a.id === arrival.id
        ? { ...a, confirmedPlate: seedJob.plate, vehicleClass: seedJob.cls, confirmedBy: "demo", confirmedAt: iso(seedJob.age - 30) } : a);
      const job = this.createJob(this.arrivals.find((a) => a.id === arrival.id)!, seedJob.pkg, seedJob.age);
      // Spread the seeded steps over the visit so timers and timelines look like a real morning.
      const path: JobStatus[] = ["queued", "in_progress", "completed"];
      const offsets = [seedJob.age - 120, seedJob.age * 0.6, seedJob.age * 0.6 - seedJob.washMinutes * 60];
      path.slice(0, path.indexOf(seedJob.status) + 1).forEach((step, i) => this.move(job.id, step, iso(offsets[i])));
      for (const employeeId of seedJob.staff) this.assign(job.id, employeeId);
    }
    this.observe("bay2-cam", "P118450", 0.88, 600);
    this.observe("entrance-cam", "P482913", 0.91, 45);
    this.observe("entrance-cam", misread("P903377"), 0.57, 15);
  }

  /** Simulates one camera event, as the vision gateway would post it. */
  tick(): void {
    const open = this.jobList.filter((j) => j.status === "in_progress" || j.status === "queued");
    if (open.length > 0 && Math.random() < 0.45) {
      const job = open[Math.floor(Math.random() * open.length)];
      // Cars being washed are spotted in the bay, and sometimes already rolling out at the exit.
      const camera = job.status !== "in_progress" ? "entrance-cam" : Math.random() < 0.35 ? "exit-cam" : "bay1-cam";
      this.observe(camera, job.plate, 0.8 + Math.random() * 0.18);
      return;
    }
    const waiting = this.arrivals.filter((a) => !a.jobId && !a.dismissedAt && a.cameraRole === "entry");
    const known = new Set([...this.jobList.filter((j) => j.status !== "completed" && j.status !== "cancelled").map((j) => j.plate),
      ...waiting.map((a) => a.plateCandidate)]);
    const fresh = PLATE_POOL.filter((p) => !known.has(p));
    if (fresh.length === 0 || waiting.length >= 4) return;
    if ((this.fresh || this.devicesList.length > 0) && !this.devicesList.some((d) => d.role === "entry" && !d.disabled)) return;
    const plate = fresh[Math.floor(Math.random() * fresh.length)];
    const confidence = 0.45 + Math.random() * 0.5;
    this.observe("entrance-cam", confidence < 0.6 ? misread(plate) : plate, confidence);
  }

  private observe(cameraId: string, plate: string, confidence: number, ageSeconds = 0): ArrivalObservation {
    const normalized = normalizePlate(plate);
    const open = this.jobList.find((j) => j.plate === normalized && j.status !== "completed" && j.status !== "cancelled");
    const id = nextId();
    const observation: ArrivalObservation = {
      id, deviceEventId: `${cameraId}-${normalized}-${Date.now()}`, cameraId, plateCandidate: normalized,
      confidence: Math.round(confidence * 100) / 100, capturedAt: iso(ageSeconds + 1), receivedAt: iso(ageSeconds),
      photoId: id, confirmedPlate: null, vehicleClass: null, confirmedBy: null, confirmedAt: null, jobId: open?.id ?? null,
      cameraRole: ROLE_OF[cameraId] ?? "entry",
    };
    const device = this.devicesList.find((d) => d.cameraId === cameraId && !d.disabled);
    if (device) { device.lastSeenAt = iso(); device.online = true; device.observations += 1; }
    this.photos.set(id, demoPhoto(normalized ?? "?", CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]));
    this.arrivals = [observation, ...this.arrivals].slice(0, 300);
    this.emit(open ? "jobs" : "arrivals");
    return observation;
  }

  private createJob(arrival: ArrivalObservation, packageId: string, ageSeconds = 0): Job {
    const pkg = catalog.packages.find((p) => p.id === packageId);
    if (!pkg || !arrival.vehicleClass || !arrival.confirmedPlate) throw new ApiError(400, "Unknown detailing package");
    const job: Job = {
      id: nextId(), arrivalId: arrival.id, plate: arrival.confirmedPlate, vehicleClass: arrival.vehicleClass,
      packageId: pkg.id, packageName: pkg.name, services: pkg.items, priceUsd: pkg.prices[arrival.vehicleClass],
      currency: catalog.currency, status: "arrived", arrivalAt: arrival.receivedAt, startedAt: null, completedAt: null,
      cancelledAt: null, elapsedSeconds: 0, activeSeconds: null,
      transitions: [{ status: "arrived", at: iso(ageSeconds), actor: "demo" }], assignments: [],
    };
    this.jobList = [job, ...this.jobList];
    this.arrivals = this.arrivals.map((a) => (a.id === arrival.id ? { ...a, jobId: job.id } : a));
    this.emit("jobs");
    this.emit("arrivals");
    return job;
  }

  private move(id: string, status: JobStatus, at: string = iso()): Job {
    const job = this.jobList.find((j) => j.id === id);
    if (!job) throw new ApiError(404, "Job not found");
    const allowed = (status === "cancelled" && ["arrived", "queued", "in_progress"].includes(job.status)) ||
      (job.status === "arrived" && status === "queued") || (job.status === "queued" && status === "in_progress") ||
      (job.status === "in_progress" && status === "completed");
    if (job.status === status) return this.view(job);
    if (!allowed) throw new ApiError(409, "Invalid job transition");
    const now = at;
    job.status = status;
    if (status === "in_progress") job.startedAt = now;
    if (status === "completed") job.completedAt = now;
    if (status === "cancelled") job.cancelledAt = now;
    job.transitions = [...job.transitions, { status, at: now, actor: "demo" }];
    this.emit("jobs");
    return this.view(job);
  }

  private assign(id: string, employeeId: string): Job {
    const job = this.jobList.find((j) => j.id === id);
    const employee = this.staff.find((e) => e.id === employeeId);
    if (!job || !employee) throw new ApiError(404, "Not found");
    if (job.assignments.some((a) => a.employeeId === employeeId)) throw new ApiError(409, "Employee is already assigned or job is closed");
    job.assignments = [...job.assignments, { employeeId, employeeName: employee.name, assignedAt: iso() }];
    this.emit("jobs");
    return this.view(job);
  }

  private view(job: Job): Job {
    const end = job.completedAt ?? job.cancelledAt ?? new Date().toISOString();
    const span = (from: string) => Math.max(0, Math.round((new Date(end).getTime() - new Date(from).getTime()) / 1000));
    return { ...job, elapsedSeconds: span(job.arrivalAt), activeSeconds: job.startedAt ? span(job.startedAt) : null };
  }

  async session() {
    return { role: "admin" as const, subject: "demo", email: "tu@ejemplo.com", name: "Tú (demo)", expiresAt: iso(-8 * 3600), tenant: { ...this.tenantData } };
  }
  async catalog() { return catalog; }
  // Same rule as the API: no job yet, not dismissed, and seen by an entrance camera.
  async pendingArrivals() { return this.arrivals.filter((a) => !a.jobId && !a.dismissedAt && (a.cameraRole ?? "entry") === "entry"); }
  async recentSightings(limit = 30) { return this.arrivals.slice(0, limit); }
  async arrivalPhotoUrl(arrival: ArrivalObservation) { return this.photos.get(arrival.id) ?? null; }

  async confirmArrival(id: string, plate: string, vehicleClass: string) {
    const normalized = normalizePlate(plate);
    if (!normalized || !catalog.vehicleClasses.some((v) => v.id === vehicleClass)) throw new ApiError(400, "Invalid plate or vehicle class");
    const index = this.arrivals.findIndex((a) => a.id === id);
    if (index < 0) throw new ApiError(404, "Arrival not found");
    const prior = this.arrivals[index];
    if (prior.dismissedAt) throw new ApiError(409, "Arrival was dismissed");
    if (prior.confirmedAt) {
      if (prior.confirmedPlate === normalized && prior.vehicleClass === vehicleClass) return prior;
      throw new ApiError(409, "Arrival was already confirmed differently");
    }
    const confirmed = { ...prior, confirmedPlate: normalized, vehicleClass, confirmedBy: "demo", confirmedAt: iso() };
    this.arrivals[index] = confirmed;
    this.emit("arrivals");
    return confirmed;
  }

  async openJob(arrivalId: string, packageId: string) {
    const arrival = this.arrivals.find((a) => a.id === arrivalId);
    if (!arrival) throw new ApiError(404, "Arrival not found");
    if (!arrival.confirmedAt) throw new ApiError(409, "Arrival needs staff confirmation");
    if (arrival.dismissedAt) throw new ApiError(409, "Arrival was dismissed");
    const existing = this.jobList.find((j) => j.arrivalId === arrivalId ||
      (j.plate === arrival.confirmedPlate && j.status !== "completed" && j.status !== "cancelled"));
    if (existing) throw new ApiError(409, "Arrival or plate already has an open job, or idempotency key was reused");
    return this.view(this.createJob(arrival, packageId));
  }

  async jobs() { return this.jobList.map((j) => this.view(j)); }

  async jobSummary(): Promise<JobSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const done = this.jobList.filter((j) => j.status === "completed");
    const count = (s: JobStatus) => this.jobList.filter((j) => j.status === s).length;
    return {
      total: this.jobList.length, arrived: count("arrived"), queued: count("queued"), inProgress: count("in_progress"),
      completed: done.length, cancelled: count("cancelled"),
      arrivalsTodayUtc: this.jobList.filter((j) => j.arrivalAt.slice(0, 10) === today).length,
      completedTodayUtc: done.filter((j) => j.completedAt!.slice(0, 10) === today).length,
      averageCompletedSeconds: done.length === 0 ? null
        : Math.round(done.reduce((sum, j) => sum + this.view(j).elapsedSeconds, 0) / done.length),
    };
  }

  async transitionJob(id: string, status: JobStatus) { return this.move(id, status); }
  async employees() { return this.staff; }
  async assignEmployee(jobId: string, employeeId: string) { return this.assign(jobId, employeeId); }

  async plateTimeline(plate: string): Promise<PlateTimeline> {
    const normalized = normalizePlate(plate);
    if (!normalized) throw new ApiError(400, "Invalid plate");
    const jobs = this.jobList.filter((j) => j.plate === normalized).map((j) => this.view(j));
    const sightings = this.arrivals.filter((a) => a.plateCandidate === normalized || a.confirmedPlate === normalized);
    const leftAt = jobs[0] ? sightings.find((a) => a.jobId === jobs[0].id && a.cameraRole === "exit")?.capturedAt ?? null : null;
    return {
      plate: normalized, openJob: jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ?? null,
      visits: jobs.length, lastSeenAt: sightings[0]?.capturedAt ?? null, leftAt, jobs, sightings,
    };
  }

  async stations(): Promise<Station[]> {
    if (this.fresh) return [];
    const wobble = () => (Math.random() - 0.5) * 4;
    return (stationsJson as Station[]).map((s) => ({
      ...s, pressurePsi: Math.round((s.pressurePsi + wobble()) * 10) / 10, timestamp: iso(),
    }));
  }

  async alerts() { return this.fresh ? [] : (alertsJson as StationAlert[]); }
  async signOut() {}

  // ---------------- administration (mirrors the API's rules) ----------------
  async dismissArrival(id: string, reason: DismissReason) {
    const index = this.arrivals.findIndex((a) => a.id === id);
    if (index < 0) throw new ApiError(404, "Arrival not found");
    if (this.arrivals[index].jobId) throw new ApiError(409, "Arrival already has a job");
    this.arrivals[index] = { ...this.arrivals[index], dismissedAt: iso(), dismissReason: reason };
    this.emit("arrivals");
    return this.arrivals[index];
  }

  async tenant() { return { ...this.tenantData }; }

  async updateTenant(input: TenantInput) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80 || !/^[A-Za-z]{2}$/.test(input.country)) throw new ApiError(400, "Invalid carwash details");
    this.tenantData = { ...this.tenantData, ...input, name, country: input.country.toUpperCase(), city: input.city?.trim() || null, phone: input.phone?.trim() || null };
    return { ...this.tenantData };
  }

  async devices() {
    const now = Date.now();
    return this.devicesList.map((d) => ({
      ...d, online: !d.disabled && !!d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < 120_000,
    }));
  }

  async createDevice(input: DeviceInput): Promise<DeviceWithKey> {
    const name = input.name.trim();
    const cameraId = input.cameraId.trim().toLowerCase();
    if (name.length < 2 || name.length > 60 || !/^[a-z0-9_-]{1,64}$/.test(cameraId) || !["entry", "bay", "exit"].includes(input.role))
      throw new ApiError(400, "Invalid device name, camera id or role");
    if (this.devicesList.some((d) => d.cameraId === cameraId && !d.disabled)) throw new ApiError(409, "Another active device already uses this camera id");
    const id = randomToken(16).toLowerCase();
    const secret = randomToken(43);
    const device: Device = {
      id, name, cameraId, role: input.role, keyHint: "…" + secret.slice(-4), createdAt: iso(), disabled: false, online: false,
      lastSeenAt: null, lastStatus: null, observations: 0, keyRotatedAt: null,
    };
    this.devicesList = [...this.devicesList, device];
    // A simulated camera comes online a few seconds after it is linked.
    window.setTimeout(() => {
      device.lastSeenAt = iso();
      device.lastStatus = { rssi: -60, uptimeMs: 4000, freeHeap: 98_000, firmware: "sparklewash-cam/1.1", fps: 2.2, ip: "192.168.1.77" };
    }, 6000);
    return { device: { ...device }, deviceKey: `swd.demo.${id}.${secret}` };
  }

  async rotateDevice(id: string): Promise<DeviceWithKey> {
    const device = this.devicesList.find((d) => d.id === id);
    if (!device) throw new ApiError(404, "Device not found");
    const secret = randomToken(43);
    device.keyHint = "…" + secret.slice(-4);
    device.keyRotatedAt = iso();
    return { device: { ...device }, deviceKey: `swd.demo.${id}.${secret}` };
  }

  async setDeviceDisabled(id: string, disabled: boolean) {
    const device = this.devicesList.find((d) => d.id === id);
    if (!device) throw new ApiError(404, "Device not found");
    if (!disabled && this.devicesList.some((d) => d.id !== id && !d.disabled && d.cameraId === device.cameraId))
      throw new ApiError(409, "Another active device already uses this camera id");
    device.disabled = disabled;
    if (disabled) device.online = false;
    return { ...device };
  }

  async team(): Promise<Team> {
    return { members: this.members.map((m) => ({ ...m })), invitations: this.invitations.map((i) => ({ ...i })), configured: [], you: "demo" };
  }

  async invite(email: string, role: Role) {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || !["viewer", "operator", "admin"].includes(role)) throw new ApiError(400, "Invalid email or role");
    if (this.invitations.some((i) => i.email === normalized) || this.members.some((m) => m.email?.toLowerCase() === normalized))
      throw new ApiError(409, "Already invited or already on the team");
    this.invitations = [{ id: randomToken(12), email: normalized, role, invitedAt: iso() }, ...this.invitations];
  }

  async revokeInvitation(id: string) {
    if (!this.invitations.some((i) => i.id === id)) throw new ApiError(404, "Invitation not found");
    this.invitations = this.invitations.filter((i) => i.id !== id);
  }

  async setMemberRole(subject: string, role: Role) {
    const member = this.members.find((m) => m.subject === subject);
    if (!member) throw new ApiError(404, "Member not found");
    if (member.role === "admin" && role !== "admin" && this.members.filter((m) => m.role === "admin").length === 1)
      throw new ApiError(409, "A carwash needs at least one admin");
    member.role = role;
  }

  async removeMember(subject: string) {
    if (subject === "demo") throw new ApiError(409, "You can't remove yourself");
    const member = this.members.find((m) => m.subject === subject);
    if (!member) throw new ApiError(404, "Member not found");
    this.members = this.members.filter((m) => m !== member);
  }

  async addEmployee(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) throw new ApiError(400, "Invalid employee name");
    if (this.staff.some((e) => e.active && e.name.toLowerCase() === trimmed.toLowerCase())) throw new ApiError(409, "Active employee name already exists");
    const employee = { id: randomToken(12), name: trimmed, active: true };
    this.staff = [...this.staff, employee];
    return employee;
  }

  async setEmployeeActive(id: string, active: boolean) {
    const employee = this.staff.find((e) => e.id === id);
    if (!employee) throw new ApiError(404, "Employee not found");
    employee.active = active;
    return { ...employee };
  }

  subscribe(onChange: (topic: ChangeTopic) => void, onState?: (state: "live" | "reconnecting") => void) {
    this.listeners.add(onChange);
    onState?.("live");
    return () => { this.listeners.delete(onChange); };
  }

  private emit(topic: ChangeTopic) {
    for (const listener of this.listeners) listener(topic);
  }

  static cameras = CAMERAS;
}
