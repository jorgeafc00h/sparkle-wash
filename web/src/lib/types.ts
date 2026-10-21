// Mirrors the SparkleWash API records (camelCase JSON from ASP.NET Core).

export type JobStatus = "arrived" | "queued" | "in_progress" | "completed" | "cancelled";
export type Role = "viewer" | "operator" | "admin";

export interface CatalogTranslation { name?: string; subtitle?: string; tagline?: string; items?: string[] }
export interface VehicleClass { id: string; name: string; translations?: Record<string, CatalogTranslation> }
export interface ServicePackage {
  id: string; name: string; subtitle: string; tagline: string; items: string[]; prices: Record<string, number>;
  translations?: Record<string, CatalogTranslation>;
}
/** Text is in `locale` (Spanish); `translations` carries other languages. */
export interface Catalog { currency: string; locale: string; vehicleClasses: VehicleClass[]; packages: ServicePackage[] }

export interface ArrivalObservation {
  id: string;
  deviceEventId: string;
  cameraId: string;
  plateCandidate: string | null;
  confidence: number | null;
  capturedAt: string;
  receivedAt: string;
  photoId: string | null;
  confirmedPlate: string | null;
  vehicleClass: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  jobId?: string | null;
  cameraRole?: CameraRole | null;
  dismissedAt?: string | null;
  dismissReason?: DismissReason | null;
}

export type CameraRole = "entry" | "bay" | "exit";
export type DismissReason = "misread" | "duplicate" | "staff" | "not-a-customer" | "other";

export interface JobTransition { status: JobStatus; at: string; actor: string }
export interface JobAssignment { employeeId: string; employeeName: string; assignedAt: string }

export interface Job {
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
}

export interface JobSummary {
  total: number; arrived: number; queued: number; inProgress: number; completed: number; cancelled: number;
  arrivalsTodayUtc: number; completedTodayUtc: number; averageCompletedSeconds: number | null;
  arrivalsToday?: number; completedToday?: number;
}

export interface Employee { id: string; name: string; active: boolean }

export interface PlateTimeline {
  plate: string;
  openJob: Job | null;
  visits: number;
  lastSeenAt: string | null;
  leftAt?: string | null;
  jobs: Job[];
  sightings: ArrivalObservation[];
}

export interface Station {
  stationId: string; name: string; status: string; pressurePsi: number; soapLevelDm: number; timestamp: string;
}
export interface StationAlert {
  stationId?: string; code: string; value: number; threshold: number; severity: "warning" | "danger";
}

export interface Tenant {
  id: string; name: string; city: string | null; country: string; phone: string | null; timeZone: string; createdAt: string;
}
export interface TenantInput { name: string; city?: string; country: string; phone?: string; timeZone: string }
export interface Session { role: Role; subject: string; expiresAt: string; email?: string | null; name?: string | null; tenant: Tenant }

export interface DeviceStatus { rssi?: number | null; uptimeMs?: number | null; freeHeap?: number | null; firmware?: string | null; fps?: number | null; ip?: string | null }
export interface Device {
  id: string; name: string; cameraId: string; role: CameraRole; keyHint: string; createdAt: string; disabled: boolean;
  online: boolean; lastSeenAt: string | null; lastStatus: DeviceStatus | null; observations: number; keyRotatedAt: string | null;
}
export interface DeviceInput { name: string; cameraId: string; role: CameraRole }
export interface DeviceWithKey { device: Device; deviceKey: string }

export interface Member { tenantId: string; subject: string; email: string | null; name: string | null; role: Role; addedAt: string }
export interface Invitation { id: string; email: string; role: Role; invitedAt: string }
export interface Team { members: Member[]; invitations: Invitation[]; configured: { subject: string; role: Role }[]; you: string }

export type ChangeTopic = "arrivals" | "jobs";
export type ConnectionState = "live" | "reconnecting";
