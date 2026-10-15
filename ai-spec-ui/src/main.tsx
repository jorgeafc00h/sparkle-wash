/** @jsxRuntime automatic */
/** @jsxFragment React */
import React from "react";
import { createRoot } from "react-dom/client";
import HealthCheck from "./health";
import MetricsDashboard from "./metrics";
import AlertPanel from "./alerts";
import UploadForm from "./upload";
import StreamingComponent, type StationProps from "./streaming-component";
import type { WebSocketEvent } from "./types";

declare global {
  interface Window {
    telemetry?: (event: WebSocketEvent) => void;
    __DSH_BOOT: unknown;
  }
}

const health = React.createElement(HealthCheck, {});
const metrics = React.createElement(MetricsDashboard, {});
const alerts = React.createElement(AlertPanel, {});
const upload = React.createElement(UploadForm, {});
const streamB4C3 = React.createElement(StreamingComponent, { stationId: "b4c3" } as StationProps);

type AppUI = typeof health | typeof metrics | typeof alerts | typeof upload | typeof streamB4C3;

/**
 * @title SparkleWash Carwash UI
 * @version 1.0.0-alpha
 * @description
 * Built using Graphify-style open specifications (self-documenting code + runnable
 * tests). This UI is published to https://openspec.dev as a spec-backed project.
 */
const App: React.FC = () => {
  const container = document.createElement("div");
  container.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  container.style.margin = "1rem auto";
  container.style.maxWidth = "960px";
  container.style.background = "#f8fafc";
  container.style.borderRadius = "12px";
  container.style.overflow = "hidden";

  const headerBg = "#0f766e"; // tealspring green from sparklevash brand

  return (
    <div style={{ padding: 8 }}>
      <header
        style={{
          padding: 16,
          background: `linear-gradient(180deg, ${headerBg}, #0ea5e9)`,
          color: "#fff",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <h1 style={{ fontSize: 1.2, margin: 0, letterSpacing: "-0.02em" }}>
          SparkleWash Carwash API
        </h1>
        <p style={{ fontSize: "0.75rem", opacity: "0.9", margin: "4px 0 0", lineHeight: 1.3 }}>
          Graphify-style open specs .NET 8 Minimal API • React UI • Vitest Tests
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          padding: 16,
        }}
      >
        {health}
        {metrics}
        {alerts}
        {upload}
        {streamB4C3}
      </div>

      <style>{`
        :root .app-font { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
        code, pre { font-family: "SFMono-Regular", Consolas, Liberation Mono, Menlo, monospace !important; }
      `}</style>
    </div>
  );
};

const root = createRoot(container);
root.render(React.createElement(App));

console.log("✅ SparkleWash UI loaded (Graphify-style open spec pattern)");
