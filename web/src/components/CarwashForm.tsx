import { useI18n } from "../i18n";
import { COUNTRIES, countryName, TIME_ZONES, zoneForCountry, zoneLabel } from "../lib/regions";
import type { TenantInput } from "../lib/types";

export interface CarwashErrors { name?: true; phone?: true }

/** Carwash details, used at registration and in Administración > Autolavado. */
export function CarwashFields({ value, onChange, errors }: {
  value: TenantInput; onChange: (next: TenantInput) => void; errors: CarwashErrors;
}) {
  const { t, intl } = useI18n();
  const zones: string[] = TIME_ZONES.includes(value.timeZone as never) ? [...TIME_ZONES] : [value.timeZone, ...TIME_ZONES];
  return (
    <div className="form-grid">
      <div className="field span-2">
        <label className="label" htmlFor="cw-name">{t("register.name")}</label>
        <input id="cw-name" className={`input ${errors.name ? "input-error" : ""}`} value={value.name} maxLength={80} autoComplete="organization"
          placeholder="Lavado El Rápido" onChange={(e) => onChange({ ...value, name: e.target.value })}
          aria-invalid={!!errors.name} aria-describedby={errors.name ? "cw-name-error" : undefined} />
        {errors.name && <p id="cw-name-error" className="error-text">{t("register.nameInvalid")}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="cw-city">{t("register.city")}</label>
        <input id="cw-city" className="input" value={value.city ?? ""} maxLength={80} autoComplete="address-level2"
          onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </div>
      <div className="field">
        <label className="label" htmlFor="cw-country">{t("register.country")}</label>
        <select id="cw-country" className="input" value={value.country}
          onChange={(e) => onChange({ ...value, country: e.target.value, timeZone: zoneForCountry(e.target.value) })}>
          {COUNTRIES.map((code) => <option key={code} value={code}>{countryName(code, intl)}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="cw-phone">{t("register.phone")}</label>
        <input id="cw-phone" className={`input ${errors.phone ? "input-error" : ""}`} value={value.phone ?? ""} inputMode="tel" autoComplete="tel"
          placeholder="+503 2222-3333" maxLength={24} onChange={(e) => onChange({ ...value, phone: e.target.value })}
          aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "cw-phone-error" : undefined} />
        {errors.phone && <p id="cw-phone-error" className="error-text">{t("register.phoneInvalid")}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="cw-zone">{t("register.timeZone")}</label>
        <select id="cw-zone" className="input" value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })}>
          {zones.map((zone) => <option key={zone} value={zone}>{zoneLabel(zone)}</option>)}
        </select>
      </div>
    </div>
  );
}
