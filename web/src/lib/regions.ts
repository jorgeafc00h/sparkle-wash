// Countries and time zones offered at registration. The API accepts any ISO country code and IANA zone;
// these are the markets SparkleWash targets first.
export const COUNTRIES = ["SV", "GT", "HN", "NI", "CR", "PA", "MX", "CO", "DO", "PR", "US", "ES"] as const;

export const TIME_ZONES = [
  "America/El_Salvador", "America/Guatemala", "America/Tegucigalpa", "America/Managua", "America/Costa_Rica",
  "America/Panama", "America/Mexico_City", "America/Bogota", "America/Santo_Domingo", "America/Puerto_Rico",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/Madrid",
] as const;

const ZONE_BY_COUNTRY: Record<string, string> = {
  SV: "America/El_Salvador", GT: "America/Guatemala", HN: "America/Tegucigalpa", NI: "America/Managua",
  CR: "America/Costa_Rica", PA: "America/Panama", MX: "America/Mexico_City", CO: "America/Bogota",
  DO: "America/Santo_Domingo", PR: "America/Puerto_Rico", US: "America/New_York", ES: "Europe/Madrid",
};

export const zoneForCountry = (country: string) => ZONE_BY_COUNTRY[country] ?? "America/El_Salvador";

export function countryName(code: string, intl: string): string {
  try { return new Intl.DisplayNames([intl], { type: "region" }).of(code) ?? code; } catch { return code; }
}

export function zoneLabel(zone: string): string {
  return zone.split("/").pop()!.replace(/_/g, " ");
}

/** Same checks as the API's TenantDirectory.Normalize, so the form can explain problems before submitting. */
export function validateCarwash(input: { name: string; phone?: string }): { name?: true; phone?: true } {
  const errors: { name?: true; phone?: true } = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) errors.name = true;
  const phone = input.phone?.trim();
  if (phone && (phone.length < 6 || phone.length > 24 || !/^[0-9+ ()-]+$/.test(phone))) errors.phone = true;
  return errors;
}
