import React, { useEffect, useState } from "react";
import axios, { AxiosError, type AxiosResponse } from "axios";

const METRICS_BASE = "/api/metrics" as const;

export default function MetricsDashboard() {
  const [stations, setStations] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(METRICS_BASE)
      .then((r: AxiosResponse<{ status: "ok"; data: string }>) => {
        setStations(JSON.parse(r.data.data || "[]"));
      })
      .catch((e: AxiosError) => setError(e.response?.data || "Failed to fetch metrics"));
    setLoading(false);
  }, []);

  const statusColor = (status?: string) =>
    status === "idle" ? "#22c55e" : status === "washing" ? "#3b82f6" : "#ef4444";

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif", border: "1px solid #e5e7eb", borderRadius: "8px", margin: "4px" }}>
      {error ? (
        <p style={{ color: "#dc2626", fontSize: "0.8rem" }}>{error}</p>
      ) : loading ? (
        <div>🔄 Loading metrics...</div>
      ) : (
        <>
          <h2 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>Station Metrics</h2>
          {stations.length === 0 ? (
            <p style={{ color: "#9ca3af" }}>No data available.</p>
          ) : (
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}
            >
              <thead style={{ borderBottom: "2px solid #e5e7eb" }}>
                <tr style={{ color: "#6b7280", fontWeight: 600 }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Station ID</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Pressure (psi)</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Soap level (dm)</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "6px 8px", color: "#4b5563" }}>{s.stationId}</td>
                    <td style={{ padding: "6px 8px", color: "#1f2937" }}>{s.name}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 6px",
                          borderRadius: "9999px",
                          fontSize: "0.7rem",
                          backgroundColor: statusColor(s.status) + "22",
                          color: statusColor(s.status),
                          textTransform: "uppercase",
                        }}
                      >
                        {s.status || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {s.pressurePsi === undefined ? "—" : `${s.pressurePsi} psi`}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {s.soapLevelDm === undefined ? "—" : `${s.soapLevelDm} dm`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export type MetricsProps = {};
