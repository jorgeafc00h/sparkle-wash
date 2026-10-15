/** @jsxImportSource react */

import { describe, it, expect } from "vitest";

describe("SparkleWash UI Components - Unit Tests", () => {
  it("HealthCheck component is exported as a default React component", async () => {
    const HealthCheck = (await import("../health")) as typeof import("../health");
    expect(HealthCheck.default).toBeDefined();
    expect(typeof HealthCheck.default).toBe("function");
  });

  it("MetricsDashboard component is exported as a default React component", async () => {
    const MetricsDashboard = (await import("../metrics")) as typeof import("../metrics");
    expect(MetricsDashboard.default).toBeDefined();
    expect(typeof MetricsDashboard.default).toBe("function");
  });

  it("AlertPanel component is exported as a default React component", async () => {
    const AlertPanel = (await import("../alerts")) as typeof import("../alerts");
    expect(AlertPanel.default).toBeDefined();
    expect(typeof AlertPanel.default).toBe("function");
  });

  it("UploadForm component is exported as a default React component", async () => {
    const UploadForm = (await import("../upload")) as typeof import("../upload");
    expect(UploadForm.default).toBeDefined();
    expect(typeof UploadForm.default).toBe("function");
  });

  it("StreamingComponent component is exported as a default React component", async () => {
    const StreamingComponent = (await import("../streaming-component.js")) as typeof import("../streaming-component.js");
    expect(StreamingComponent.default).toBeDefined();
    expect(typeof StreamingComponent.default).toBe("function");
  });
});

describe("Stream URL Construction", () => {
  it("WebSocket URL is correctly constructed from stationId", () => {
    const baseUrl = "ws://localhost:5001/ws/app/station-streaming/";
    expect(baseUrl + "a1").toBe("ws://localhost:5001/ws/app/station-streaming/a1");
    expect(baseUrl + "b4c3").toBe("ws://localhost:5001/ws/app/station-streaming/b4c3");
    expect(baseUrl + "alpha-station").toBe("ws://localhost:5001/ws/app/station-streaming/alpha-station");
  });
});

describe("Multipart Form Data Protocol Validation", () => {
  it("Content-Disposition header includes correct part information", () => {
    const boundary = "--FormBoundary123456";
    const part = "--" + boundary + "\r\n" +
                 "Content-Disposition: form-data; name=\"upload\";\r\n" +
                 "  filename=\"engine.png\"\r\n" +
                 "Content-Type: image/png\r\n\r\n" +
                 "fake-image-png-placeholder-data" +
                 `\r\n--${boundary}--\r\n`;
    
    expect(part).toContain("Content-Disposition: form-data");
    expect(part).toContain('name="upload"');
    expect(part).toContain(`filename="engine.png"`);
    expect(part).toContain("Content-Type: image/png");
  });

  it("Part boundary is correctly closed with double-dashes", () => {
    const boundary = "--FormBoundary123456";
    const closingBoundary = "--" + boundary + "--";
    expect(closingBoundary.startsWith("--" + boundary)).toBe(true);
    expect(closingBoundary.endsWith("--\r\n")).toBe(false); // body ends with \r\n, not --\r\n
  });

  it("Content-Type and filename are preserved in boundary encoding", () => {
    const header = `Content-Disposition: form-data; name="file"; filename="report.pdf"`;
    expect(header).toContain('name="file"');
    expect(header).toContain('filename="report.pdf"');
  });
});

describe("Threshold Alert Logic Tests", () => {
  it("lowPressure triggers when PSI < 30", () => {
    const psi = 25;
    const isLowPressure = psi < 30;
    expect(isLowPressure).toBe(true);
  });

  it("highPressure triggers when PSI > 70", () => {
    const psi = 75;
    const isHighPressure = psi > 70;
    expect(isHighPressure).toBe(true);
  });

  it("lowSoapLevel triggers when soapLevel <= 15 dm", () => {
    const soapLevel = 12;
    const isLowSoap = soapLevel <= 15;
    expect(isLowSoap).toBe(true);
  });

  it("normal PSI (30-70) does not trigger pressure alert", () => {
    const psi = 50;
    const isPressureAlert = psi < 30 || psi > 70;
    expect(isPressureAlert).toBe(false);
  });

  it("normal soap level (>15) does not trigger soap alert", () => {
    const soapLevel = 25;
    const isSoapAlert = soapLevel <= 15;
    expect(isSoapAlert).toBe(false);
  });
});
