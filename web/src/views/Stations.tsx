import type { ReactNode } from "react";
import { AlertTriangle, Gauge, Waves } from "lucide-react";
import { useApi } from "../lib/context";
import { usePoll } from "../lib/hooks";
import type { Station } from "../lib/types";
import { useFormat, useI18n } from "../i18n";
import type { MessageKey } from "../i18n/es";
import { Empty } from "../components/ui";

const PRESSURE = { min: 45, max: 60, scale: 100 };
const SOAP = { low: 35, scale: 100 };

export function StationsView() {
  const api = useApi();
  const { t } = useI18n();
  const { data: stations } = usePoll(() => api.stations(), 3000);
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("bays.title")}</h1>
          <p className="page-sub">{t("bays.subtitle")}</p>
        </div>
      </header>
      {stations === null ? <div className="skeleton" style={{ height: 200 }} />
        : stations.length === 0 ? <div className="card"><Empty icon={Gauge} title={t("bays.none")} /></div>
          : <div className="grid stations">{stations.map((s) => <StationCard key={s.stationId} station={s} />)}</div>}
    </>
  );
}

function StationCard({ station }: { station: Station }) {
  const { t } = useI18n();
  const f = useFormat();
  const pressureOk = station.pressurePsi >= PRESSURE.min && station.pressurePsi <= PRESSURE.max;
  const soapOk = station.soapLevelDm >= SOAP.low;
  const tone = station.status === "error" ? "pill-danger" : station.status === "idle" ? "pill-neutral" : "pill-info";
  const statusKey = `bays.status.${station.status}` as MessageKey;
  return (
    <article className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-label={station.name}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 16 }}>{station.name}</h2>
          <span className="subtle mono">{station.stationId} · {f.ago(station.timestamp)}</span>
        </div>
        <span className={`pill ${tone}`}>{t(statusKey) === statusKey ? station.status : t(statusKey)}</span>
      </div>
      <Meter icon={<Gauge size={14} aria-hidden />} label={t("bays.pressure")} value={`${station.pressurePsi} psi`}
        percent={(station.pressurePsi / PRESSURE.scale) * 100} ok={pressureOk} note={t("bays.pressureNormal", { min: PRESSURE.min, max: PRESSURE.max })} />
      <Meter icon={<Waves size={14} aria-hidden />} label={t("bays.soap")} value={`${station.soapLevelDm} dm`}
        percent={(station.soapLevelDm / SOAP.scale) * 100} ok={soapOk} note={t("bays.soapRefill", { low: SOAP.low })} />
    </article>
  );
}

function Meter({ icon, label, value, percent, ok, note }: {
  icon: ReactNode; label: string; value: string; percent: number; ok: boolean; note: string;
}) {
  const { t } = useI18n();
  return (
    <div className="gauge">
      <div className="gauge-row">
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{icon}{label}</span>
        <strong className="mono" style={{ color: ok ? "var(--text)" : "var(--warn)" }}>
          {!ok && <AlertTriangle size={13} aria-label={t("bays.outOfRange")} style={{ verticalAlign: -2, marginRight: 4 }} />}{value}
        </strong>
      </div>
      <div className="meter"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: ok ? "var(--ok)" : "var(--warn)" }} /></div>
      <span className="subtle">{note}</span>
    </div>
  );
}
