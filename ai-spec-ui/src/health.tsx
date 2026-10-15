import React, { useState } from "react";

export default function HealthCheck(): React.JSX.Element {
  const [healthData] = React.useState({ status: "healthy", ok: true, message: "healthy" } as const);

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif", border: "1px solid #e5e7eb", borderRadius: "8px", margin: "4px" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>System Health</h2>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span
          role="status"
          aria-label="system status"
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "9999%",
            backgroundColor: healthData.ok ? "#22c55e" : "#ef4444",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ color: healthData.ok ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
          {healthData.status}
        </span>
      </div>
      <p style={{ margin: "8px 0 0", color: "rgba(29,29,31,0.7)", fontSize: "0.875rem" }}>
        {healthData.message}
      </p>
    </div>
  );
}

export type HealthProps = {};
