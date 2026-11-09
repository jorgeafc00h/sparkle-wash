export type Station = {
  stationId: string;
  name: string;
  status: string;
  pressurePsi: number;
  soapLevelDm: number;
  timestamp: string;
};
export type Alert = { code: string; value: number; threshold: number; severity: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseStations(value: unknown): Station[] {
  if (!Array.isArray(value)) throw new Error('Station response is not an array');
  const seen = new Set<string>();
  return value.map(item => {
    if (!object(item) || typeof item.stationId !== 'string' || !item.stationId || seen.has(item.stationId) ||
        typeof item.name !== 'string' || typeof item.status !== 'string' ||
        !finite(item.pressurePsi) || !finite(item.soapLevelDm) ||
        typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))) {
      throw new Error('Invalid station snapshot');
    }
    seen.add(item.stationId);
    return item as Station;
  });
}

export function parseAlerts(value: unknown): Alert[] {
  if (!Array.isArray(value)) throw new Error('Alert response is not an array');
  return value.map(item => {
    if (!object(item) || typeof item.code !== 'string' || !finite(item.value) ||
        !finite(item.threshold) || typeof item.severity !== 'string') throw new Error('Invalid alert');
    return item as Alert;
  });
}
export function pressureState(value: number): 'warning' | 'good' | 'danger' { return value < 45 ? 'warning' : value <= 60 ? 'good' : 'danger'; }
export function soapState(value: number): 'danger' | 'warning' | 'good' { return value < 35 ? 'danger' : value <= 55 ? 'warning' : 'good'; }
