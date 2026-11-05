export type Arrival = {
  id: string; cameraId: string; receivedAt: string; plateCandidate: string | null;
  confirmedPlate: string | null; vehicleClass: string | null; photoId: string | null;
  confidence: number | null;
};
export type JobStatus = 'arrived' | 'queued' | 'in_progress' | 'completed' | 'cancelled';
export type Job = {
  id: string; arrivalId: string; plate: string; vehicleClass: string; packageId: string;
  packageName: string; priceUsd: number; status: JobStatus; arrivalAt: string;
  elapsedSeconds: number; activeSeconds: number | null; services: string[];
  assignments: { employeeId: string; employeeName: string }[];
};
export type Employee = { id: string; name: string; active: boolean };
export type Inventory = {
  item: { id: string; sku: string; name: string; unit: string; reorderPoint: number };
  onHand: number; reserved: number; available: number; needsReorder: boolean;
};

const countKeys = [
  'total', 'arrived', 'queued', 'inProgress', 'completed', 'cancelled',
  'arrivalsTodayUtc', 'completedTodayUtc'
] as const;
export type Summary = Record<typeof countKeys[number], number> & { averageCompletedSeconds: number | null };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullableText = (value: unknown) => value === null || text(value);

function list<T>(value: unknown, validate: (item: Record<string, unknown>) => boolean): T[] {
  if (!Array.isArray(value) || !value.every(item => {
    const entry = record(item);
    return entry !== undefined && validate(entry);
  })) throw new Error('Invalid operations list');
  return value as T[];
}

export const parseArrivals = (value: unknown) => list<Arrival>(value, item =>
  text(item.id) && text(item.cameraId) && date(item.receivedAt) &&
  nullableText(item.plateCandidate) && nullableText(item.confirmedPlate) &&
  nullableText(item.vehicleClass) && nullableText(item.photoId) &&
  (item.confidence === null || (typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1)));

export const parseJobs = (value: unknown) => list<Job>(value, item =>
  [item.id, item.arrivalId, item.plate, item.vehicleClass, item.packageId, item.packageName].every(text) &&
  typeof item.status === 'string' && ['arrived', 'queued', 'in_progress', 'completed', 'cancelled'].includes(item.status) &&
  date(item.arrivalAt) && nonnegative(item.priceUsd) && nonnegative(item.elapsedSeconds) &&
  (item.activeSeconds === null || nonnegative(item.activeSeconds)) &&
  Array.isArray(item.services) && item.services.every(text) &&
  Array.isArray(item.assignments) && item.assignments.every(assignment => {
    const entry = record(assignment);
    return entry !== undefined && text(entry.employeeId) && text(entry.employeeName);
  }));

export const parseEmployees = (value: unknown) => list<Employee>(value, item =>
  text(item.id) && text(item.name) && typeof item.active === 'boolean');

export const parseInventory = (value: unknown) => list<Inventory>(value, stock => {
  const item = record(stock.item);
  return item !== undefined && [item.id, item.sku, item.name, item.unit].every(text) &&
    [item.reorderPoint, stock.onHand, stock.reserved, stock.available].every(nonnegative) &&
    typeof stock.needsReorder === 'boolean';
});

export function parseSummary(value: unknown): Summary {
  const summary = record(value);
  if (!summary || !countKeys.every(key => nonnegative(summary[key])) ||
      !(summary.averageCompletedSeconds === null || nonnegative(summary.averageCompletedSeconds))) {
    throw new Error('Invalid job summary');
  }
  return summary as Summary;
}
