/** @jsxImportSource react */
import React from "react";

// Re-export components for tests to re-resolve them after module resolution
export { default as HealthCheck } from "../src/health";
export { default as MetricsDashboard } from "../src/metrics";
export { default as AlertPanel } from "../src/alerts";
export { default as UploadForm } from "../src/upload";
export { default as StreamingComponent } from "../src/streaming-component";
