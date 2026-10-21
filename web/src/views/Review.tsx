import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, CarFront, ScanLine, Timer } from "lucide-react";
import { useApi, useToast } from "../lib/context";
import { confidenceLevel, normalizePlate } from "../lib/format";
import { usePoll } from "../lib/hooks";
import type { ArrivalObservation, Catalog } from "../lib/types";
import { className, errorText, packageText, useFormat, useI18n } from "../i18n";
import { Confidence, Empty, ErrorBanner, Plate } from "../components/ui";

function useArrivalPhoto(arrival: ArrivalObservation | null) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (arrival) void api.arrivalPhotoUrl(arrival).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [api, arrival?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function Thumb({ arrival }: { arrival: ArrivalObservation }) {
  const url = useArrivalPhoto(arrival);
  return url ? <img className="thumb" src={url} alt="" /> : <span className="thumb" aria-hidden />;
}

export function ReviewView() {
  const api = useApi();
  const { t } = useI18n();
  const f = useFormat();
  const { data: pending, error, refresh } = usePoll(() => api.pendingArrivals(), 15_000, ["arrivals"]);
  const { data: catalog } = usePoll(() => api.catalog(), 300_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!pending?.length) return null;
    return pending.find((a) => a.id === selectedId) ?? pending[0];
  }, [pending, selectedId]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("review.title")}</h1>
          <p className="page-sub">{t("review.subtitle")}</p>
        </div>
        {pending && <span className="pill pill-warn"><ScanLine size={14} aria-hidden />{t("review.waiting", { count: pending.length })}</span>}
      </header>
      <ErrorBanner error={error} />
      <div className="grid two-col">
        <section className="card" aria-label={t("review.selected")}>
          {selected && catalog
            ? <ReviewForm key={selected.id} arrival={selected} catalog={catalog} onDone={() => void refresh()} />
            : pending === null
              ? <div className="card-pad"><div className="skeleton" style={{ height: 280 }} /></div>
              : <Empty icon={CarFront} title={t("review.caughtUp")}>{t("review.caughtUpBody")}</Empty>}
        </section>
        <section className="card" aria-label={t("review.list")}>
          <div className="card-head"><h2 className="card-title"><Timer size={16} aria-hidden />{t("review.queue")}</h2></div>
          <div className="card-pad" style={{ padding: 8 }}>
            {pending?.length ? (
              <div className="queue-list">
                {pending.map((a) => (
                  <button key={a.id} type="button" className="queue-item" aria-current={a.id === selected?.id}
                    onClick={() => setSelectedId(a.id)}>
                    <Thumb arrival={a} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                      <Plate plate={a.plateCandidate} />
                      <span className="subtle">{f.camera(a.cameraId)} · {f.ago(a.receivedAt)}</span>
                    </span>
                    {confidenceLevel(a.confidence) !== "high" &&
                      <span className="pill pill-warn" title={t("review.lowConfidence")}><AlertTriangle size={13} aria-hidden />{t("review.check")}</span>}
                  </button>
                ))}
              </div>
            ) : <p className="subtle" style={{ padding: 12 }}>{t("review.noCars")}</p>}
          </div>
        </section>
      </div>
    </>
  );
}

function ReviewForm({ arrival, catalog, onDone }: { arrival: ArrivalObservation; catalog: Catalog; onDone: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { t, locale } = useI18n();
  const f = useFormat();
  const photo = useArrivalPhoto(arrival);
  const [plate, setPlate] = useState(arrival.plateCandidate ?? "");
  const [vehicleClass, setVehicleClass] = useState(catalog.vehicleClasses[0]?.id ?? "car");
  const [packageId, setPackageId] = useState("essential");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizePlate(plate);
  const chosen = catalog.packages.find((p) => p.id === packageId);
  const lowConfidence = confidenceLevel(arrival.confidence) !== "high";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!normalized) { setError(t("review.invalidPlate")); return; }
    setBusy(true);
    setError(null);
    try {
      await api.confirmArrival(arrival.id, normalized, vehicleClass);
      const job = await api.openJob(arrival.id, packageId);
      toast("ok", t("review.opened", { plate: job.plate, package: job.packageName }));
      onDone();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review">
      <div className="review-photo">
        {photo ? <img src={photo} alt={t("review.photoAlt", { plate: arrival.plateCandidate ?? t("plate.unread") })} />
          : <div className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />}
        <div className="photo-overlay">
          <span className="glass"><Camera size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 6 }} />{f.camera(arrival.cameraId)}</span>
          <span className="glass mono">{f.clock(arrival.capturedAt)}</span>
        </div>
      </div>
      <form className="review-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="plate">{t("review.plate")}</label>
          <input id="plate" className={`input input-plate ${error && !normalized ? "input-error" : ""}`} value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false}
            aria-describedby="plate-help" maxLength={16} />
          <Confidence value={arrival.confidence} />
          <p id="plate-help" className="help">{lowConfidence ? t("review.helpLow") : t("review.helpHigh")}</p>
        </div>
        <div className="field" role="radiogroup" aria-labelledby="class-label">
          <span id="class-label" className="label">{t("review.vehicleClass")}</span>
          <div className="segmented">
            {catalog.vehicleClasses.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={vehicleClass === v.id} className="seg"
                onClick={() => setVehicleClass(v.id)}>{className(v, locale, catalog)}</button>
            ))}
          </div>
        </div>
        <div className="field" role="radiogroup" aria-labelledby="package-label">
          <span id="package-label" className="label">{t("review.package")}</span>
          <div className="package-grid">
            {catalog.packages.map((p) => {
              const text = packageText(p, locale, catalog);
              return (
                <button key={p.id} type="button" role="radio" aria-checked={packageId === p.id} className="package"
                  onClick={() => setPackageId(p.id)} title={`${t("review.includes")}: ${text.items.join(", ")}`}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong>{text.name}</strong>
                    <span className="package-price">{f.money(p.prices[vehicleClass] ?? 0, catalog.currency)}</span>
                  </span>
                  <span className="subtle">{text.subtitle}</span>
                </button>
              );
            })}
          </div>
          {chosen && (
            <p className="help">{t("review.includes")}: {packageText(chosen, locale, catalog).items.join(" · ")}</p>
          )}
        </div>
        {error && <p className="error-text" role="alert"><AlertTriangle size={15} aria-hidden />{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t("review.opening") : normalized && chosen
            ? t("review.submit", { plate: normalized, price: f.money(chosen.prices[vehicleClass] ?? 0, catalog.currency) })
            : t("review.submitNoPlate")}
        </button>
      </form>
    </div>
  );
}
