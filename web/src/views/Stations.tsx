import { AlertTriangle, Gauge, Waves } from "lucide-react";
import { useApi } from "../lib/context";
import { timeAgo } from "../lib/format";
import { usePoll } from "../lib/hooks";
import type { Station } from "../lib/types";
import { Empty } from "../components/ui";

const PRESSURE = { min: 45, max: 60, scale: 100 };
const SOAP = { low: 35, scale: 100 };

export function StationsView() {
  const api = useApi();
  const { data: stations } = usePoll(() => api.stations(), 3000);
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Bays</h1>
          <p className="page-sub">Pressure and soap readings from each wash bay controller.</p>
        </div>
      </header>
      {stations === null ? <div className="skeleton" style={{ height: 200 }} />
        : stations.length === 0 ? <div className="card"><Empty icon={Gauge} title="No bay telemetry yet" /></div>
          : <div className="grid stations">{stations.map((s) => <StationCard key={s.stationId} station={s} />)}</div>}
    </>
  );
}

function StationCard({ station }: { station: Station }) {
  const pressureOk = station.pressurePsi >= PRESSURE.min && station.pressurePsi <= PRESSURE.max;
  const soapOk = station.soapLevelDm >= SOAP.low;
  const tone = station.status === "error" ? "pill-danger" : station.status === "idle" ? "pill-neutral" : "pill-info";
  return (
    <article className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-label={station.name}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 16 }}>{station.name}</h2>
          <span className="subtle mono">{station.stationId} · {timeAgo(station.timestamp)}</span>
        </div>
        <span className={`pill ${tone}`} style={{ textTransform: "capitalize" }}>{station.status}</span>
      </div>
      <Meter icon={<Gauge size={14} aria-hidden />} label="Pressure" value={`${station.pressurePsi} psi`}
        percent={(station.pressurePsi / PRESSURE.scale) * 100} ok={pressureOk} note={`Normal ${PRESSURE.min}–${PRESSURE.max} psi`} />
      <Meter icon={<Waves size={14} aria-hidden />} label="Soap" value={`${station.soapLevelDm} dm`}
        percent={(station.soapLevelDm / SOAP.scale) * 100} ok={soapOk} note={`Refill below ${SOAP.low} dm`} />
    </article>
  );
}

function Meter({ icon, label, value, percent, ok, note }: {
  icon: React.ReactNode; label: string; value: string; percent: number; ok: boolean; note: string;
}) {
  return (
    <div className="gauge">
      <div className="gauge-row">
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{icon}{label}</span>
        <strong className="mono" style={{ color: ok ? "var(--text)" : "var(--warn)" }}>
          {!ok && <AlertTriangle size={13} aria-label="Out of range" style={{ verticalAlign: -2, marginRight: 4 }} />}{value}
        </strong>
      </div>
      <div className="meter"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: ok ? "var(--ok)" : "var(--warn)" }} /></div>
      <span className="subtle">{note}</span>
    </div>
  );
}
