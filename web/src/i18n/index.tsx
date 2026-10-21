import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import type { Catalog, ServicePackage, VehicleClass } from "../lib/types";
import { en } from "./en";
import { es, type MessageKey } from "./es";

export const LOCALES = [
  { id: "es", label: "Español", intl: "es-SV" },
  { id: "en", label: "English", intl: "en-US" },
] as const;
export type Locale = (typeof LOCALES)[number]["id"];
export const DEFAULT_LOCALE: Locale = "es";
const MESSAGES: Record<Locale, Record<MessageKey, string>> = { es, en };
const STORAGE_KEY = "sparklewash.locale";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** {name} placeholders plus a minimal ICU-style plural: {count, plural, one {…} other {…}}. */
export function format(template: string, vars: Record<string, string | number> = {}, intl = "es-SV"): string {
  const plural = new Intl.PluralRules(intl);
  return template
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name: string, one: string, other: string) =>
      plural.select(Number(vars[name])) === "one" ? one : other)
    .replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translator(locale: Locale): Translate {
  const intl = LOCALES.find((l) => l.id === locale)!.intl;
  return (key, vars) => format(MESSAGES[locale][key] ?? es[key] ?? key, vars, intl);
}

interface I18n {
  locale: Locale;
  intl: string;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18n>({
  locale: DEFAULT_LOCALE, intl: "es-SV", setLocale: () => {}, t: translator(DEFAULT_LOCALE),
});

function storedLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LOCALES.some((l) => l.id === stored)) return stored as Locale;
  } catch { /* storage blocked */ }
  return DEFAULT_LOCALE; // Spanish unless the person picked another language; not the browser's language.
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? storedLocale());
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo(() => ({
    locale, setLocale, t: translator(locale), intl: LOCALES.find((l) => l.id === locale)!.intl,
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Server and demo errors are English and technical; show staff a localized explanation instead. */
export function errorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return t("error.invalid");
      case 401: return t("error.session");
      case 403: return t("error.forbidden");
      case 404: return t("error.notFound");
      case 409: return t("error.conflict");
      case 503: return t("signin.serverNotConfigured");
    }
  }
  if (error instanceof TypeError) return t("error.network");
  return t("error.generic");
}

// ---- catalog text ----
export function className(vehicleClass: VehicleClass, locale: Locale, catalog?: Catalog): string {
  if (locale === (catalog?.locale ?? "es")) return vehicleClass.name;
  return vehicleClass.translations?.[locale]?.name ?? vehicleClass.name;
}

export function packageText(pkg: ServicePackage, locale: Locale, catalog?: Catalog) {
  const translation = locale === (catalog?.locale ?? "es") ? undefined : pkg.translations?.[locale];
  return {
    name: translation?.name ?? pkg.name,
    subtitle: translation?.subtitle ?? pkg.subtitle,
    tagline: translation?.tagline ?? pkg.tagline,
    items: translation?.items ?? pkg.items,
  };
}

// ---- dates, money, durations ----
export function useFormat() {
  const { intl, t } = useI18n();
  return useMemo(() => {
    const relative = new Intl.RelativeTimeFormat(intl, { numeric: "auto", style: "short" });
    return {
      money: (amount: number, currency = "USD") =>
        new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount),
      clock: (iso: string) => new Date(iso).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" }),
      today: () => new Date().toLocaleDateString(intl, { weekday: "long", month: "long", day: "numeric" }),
      ago: (iso: string | null, now: number = Date.now()) => {
        if (!iso) return t("time.never");
        const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
        if (seconds < 10) return t("time.justNow");
        if (seconds < 60) return relative.format(-Math.floor(seconds), "second");
        if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), "minute");
        if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), "hour");
        return relative.format(-Math.floor(seconds / 86400), "day");
      },
      camera: (cameraId: string) => cameraLabel(cameraId, t),
    };
  }, [intl, t]);
}

export function cameraLabel(cameraId: string, t: Translate): string {
  const base = cameraId.replace(/[-_]?cam(era)?$/i, "").toLowerCase();
  if (/^(entrance|entry|entrada)$/.test(base)) return t("camera.entrance");
  if (/^(exit|salida)$/.test(base)) return t("camera.exit");
  const bay = base.match(/^(?:bay|bahia)[-_ ]?(\d+)$/);
  if (bay) return t("camera.bay", { n: bay[1] });
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
