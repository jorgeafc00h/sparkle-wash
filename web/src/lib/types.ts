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
  cameraRole?: "entry" | "exit" | null;
}

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

export interface Session { role: Role; subject: string; expiresAt: string }

export type ChangeTopic = "arrivals" | "jobs";
export type ConnectionState = "live" | "reconnecting";
