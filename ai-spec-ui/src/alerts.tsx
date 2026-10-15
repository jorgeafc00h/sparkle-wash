import React, { useEffect, useState } from "react";
import axios, { AxiosResponse } from "axios";

const ALERTS_BASE = "/api/metrics/alerts" as const;

export default function AlertPanel() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(ALERTS_BASE).then((r: AxiosResponse) => setAlerts(r.data)).catch(() => {});
    setLoading(false);
  }, []);

  const severityColor = (sev: string) => {
    switch (sev?.toLowerCase()) {
      case "critical": return "#7f1d1d";
      case "warning": return "#78350f";
      default: return "#4b5563";
    }
  };

  const severityLabel = (sev?: string) => {
    switch (sev?.toLowerCase()) {
      case "critical": return "Critical";
      case "warning": return "Warning";
      default: return sev || "info";
    }
  };

  if (loading) return <div style={{padding:16}}>Loading alerts…</div>;

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>Alerts</h2>
      {alerts.length === 0 ? (
        <div style={{ color: "#9ca3af", fontSize: "0.85rem" }}>No active alerts.</div>
      ) : (
        alert?.code && alert.severity && alert?.value && alert.threshold ? (
          alerts.map((a, i) => (
            <div
              key={i}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "8px 10px",
                marginBottom: "4px",
                background: a.severity === "critical" ? "#fef2f2" : "rgba(180, 230, 254, 0.3)",
              }}
            >
              <span style={{ fontWeight: 700, color: severityColor(a.severity), fontFamily: "monospace" }}>[{a.code.toUpperCase()}]</span>
              <span style={{ marginLeft: 8, color: a.severity === "critical" ? "#b91c1c" : "#7f4517", fontSize: "0.8rem" }}>
                severity: {a.severity}
              </span>
            </div>
          ))
        ) : (
          "No alert data available."
        )
      )}
    </div>
  );
}

export type AlertsProps = {};
