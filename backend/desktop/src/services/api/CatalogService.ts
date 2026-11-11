// Catalog service — loads government catalogs from API with bundled JSON fallback

import type { Catalog, CatalogOption, CatalogDTO, CatalogCollection } from '../../types/catalog';
import { API_CONFIG, API_ENDPOINTS, API_HEADERS } from '../../config/api';
import { appStorage } from '../storage/ElectronStorage';
import bundledCatalogs from '../../data/catalogs.json';

const LAST_SYNC_KEY = 'catalog_last_sync';
const SYNC_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function toDomainCatalog(dto: CatalogDTO): Catalog {
  const options: CatalogOption[] = (dto.options ?? []).map((opt, idx) => ({
    id: `${dto.id}-${opt.code}-${idx}`,
    code: opt.code,
    description: opt.description,
    departamento: opt.departamento,
    municipality: opt.municipality,
    catalogId: dto.id,
    isActive: true,
    sortOrder: idx,
  }));
  return {
    id: dto.id,
    name: dto.name,
    isActive: true,
    options,
    totalOptions: options.length,
    lastUpdated: new Date().toISOString(),
  };
}

function loadBundled(): Catalog[] {
  const collection = bundledCatalogs as CatalogCollection;
  return (collection.catalogs ?? []).map(toDomainCatalog);
}

class CatalogService {
  constructor(private isProduction: boolean = false) {}

  async shouldSync(): Promise<boolean> {
    const raw = await appStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return true;
    const lastSync = Number(raw);
    if (!lastSync || Number.isNaN(lastSync)) return true;
    return Date.now() - lastSync > SYNC_TTL_MS;
  }

  async updateLastSyncDate(): Promise<void> {
    await appStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  }

  /**
   * Fetch catalogs from the API. Falls back to the bundled JSON if the
   * request fails, so municipios/departments are always available.
   */
  async getCatalogs(): Promise<Catalog[]> {
    const baseUrl = this.isProduction
      ? API_CONFIG.production.baseUrl
      : API_CONFIG.development.baseUrl;
    const url = `${baseUrl}${API_ENDPOINTS.CATALOG}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CatalogCollection;
      const catalogs = (data.catalogs ?? []).map(toDomainCatalog);
      if (catalogs.length > 0) return catalogs;
      // Empty response — fall back to bundled
      return loadBundled();
    } catch (err) {
      console.warn('CatalogService: API fetch failed, using bundled catalogs', err);
      return loadBundled();
    }
  }

  async getCatalogById(id: string): Promise<Catalog | null> {
    const catalogs = await this.getCatalogs();
    return catalogs.find((c) => c.id === id) ?? null;
  }

  async searchCatalogOptions(
    catalogId: string,
    term: string,
    departamento?: string,
  ): Promise<CatalogOption[]> {
    const catalog = await this.getCatalogById(catalogId);
    if (!catalog) return [];
    const needle = term.toLowerCase();
    return catalog.options.filter((o) => {
      if (departamento && o.departamento !== departamento) return false;
      if (!needle) return true;
      return (
        o.code.toLowerCase().includes(needle) ||
        o.description.toLowerCase().includes(needle)
      );
    });
  }

  async getCatalogStats(): Promise<Record<string, number>> {
    const catalogs = await this.getCatalogs();
    return Object.fromEntries(catalogs.map((c) => [c.id, c.options.length]));
  }

  async loadCatalogsIntelligently(): Promise<Catalog[]> {
    return this.getCatalogs();
  }

  async syncCatalogs(): Promise<Catalog[]> {
    const result = await this.getCatalogs();
    await this.updateLastSyncDate();
    return result;
  }

  async searchOptions(catalogId: string, term: string): Promise<CatalogOption[]> {
    return this.searchCatalogOptions(catalogId, term);
  }

  async getStats(): Promise<{ totalCatalogs: number; totalOptions: number; lastSync: string | null }> {
    const catalogs = await this.getCatalogs();
    const totalOptions = catalogs.reduce((sum, c) => sum + c.options.length, 0);
    const raw = await appStorage.getItem(LAST_SYNC_KEY);
    const lastSync = raw ? new Date(Number(raw)).toISOString() : null;
    return { totalCatalogs: catalogs.length, totalOptions, lastSync };
  }
}

let _instance: CatalogService | null = null;
let _lastEnv: boolean | null = null;

export const getCatalogService = (isProduction: boolean = false): CatalogService => {
  if (!_instance || _lastEnv !== isProduction) {
    _instance = new CatalogService(isProduction);
    _lastEnv = isProduction;
  }
  return _instance;
};
