export type VehicleClass = { id: 'car' | 'suv' | 'xl' | 'pickup'; name: string };
export type ServicePackage = {
  id: 'quick' | 'essential' | 'renew' | 'supreme';
  name: string;
  subtitle: string;
  items: string[];
  prices: Record<VehicleClass['id'], number>;
};
export type ServiceCatalog = { currency: 'USD'; vehicleClasses: VehicleClass[]; packages: ServicePackage[] };

const classIds = ['car', 'suv', 'xl', 'pickup'] as const;
const packageIds = ['quick', 'essential', 'renew', 'supreme'] as const;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid package catalog');
  return value as Record<string, unknown>;
};

export function parseCatalog(value: unknown): ServiceCatalog {
  const catalog = object(value);
  if (catalog.currency !== 'USD' || !Array.isArray(catalog.vehicleClasses) || !Array.isArray(catalog.packages)) throw new Error('Invalid package catalog');
  const classes = catalog.vehicleClasses.map(object);
  const packages = catalog.packages.map(object);
  if (classes.length !== 4 || packages.length !== 4) throw new Error('Incomplete package catalog');
  for (let i = 0; i < 4; i++) {
    if (classes[i].id !== classIds[i] || typeof classes[i].name !== 'string' || !classes[i].name) throw new Error('Invalid vehicle class');
    const entry = packages[i];
    if (entry.id !== packageIds[i] || typeof entry.name !== 'string' || !entry.name ||
        typeof entry.subtitle !== 'string' || !Array.isArray(entry.items) ||
        entry.items.length === 0 || !entry.items.every(item => typeof item === 'string' && item.length > 0)) throw new Error('Invalid service package');
    const prices = object(entry.prices);
    if (!classIds.every(id => Number.isSafeInteger(prices[id]) && (prices[id] as number) >= 0)) throw new Error('Invalid package price');
  }
  return value as ServiceCatalog;
}
