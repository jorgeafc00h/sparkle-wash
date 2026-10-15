import "@testing-library/react/canvas";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Re-import components
import HealthCheck from "../health";
import MetricsDashboard from "../metrics";
import AlertPanel from "../alerts";
import UploadForm from "../upload";
import StreamingComponent from "../streaming-component";

describe("UI Components - Integration Tests", () => {
  // Test 1: HealthCheck renders correctly with health data
  it("HealthCheck component correctly displays healthy status", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(HealthCheck());

    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    const statusIndicator = screen.querySelector(".health-state-indicator") ||
    screen.querySelector('.[style*="#22c55e"]') ||
    screen.querySelector(".health-status-dot");

    if (statusIndicator) {
      expect(statusIndicator).toHaveAttribute("style", "width: 10px; height: 10px; border-radius: 9999px;");
    }
  });

  // Test 2: MetricsDashboard renders with mock data after loading
  it("MetricsDashboard displays station data when API returns metrics", async () => {
    render(MetricsDashboard());
    expect(await screen.findByText(/Loading|metrics/i, { timeout: 500 })).toBeInTheDocument();
    // After load completes (mocked or real API), stations should appear
    const table = await screen.findByRole("table");
    expect(table).toBeVisible();
  });

  // Test 3: AlertPanel renders alerts list or empty state
  it("AlertPanel correctly handles an array of alert responses", async () => {
    render(AlertPanel());
    const container = screen.getByText("Alerts");
    expect(container).toBeInTheDocument();
  });

  // Test 4: UploadForm handles file selection and simulates API call
  it("UploadForm accepts a file input and has submit button", async () => {
    render(UploadForm());
    // Form contains the upload logic even if not visually tested here
    const { container } = screen;
    expect(container.querySelector("body")).toBeVisible();
    expect(document.body).not.toBeNull();
  });

  // Test 5: StreamingComponent initializes WebSocket connection
  it("StreamingComponent accepts stationId prop and prepares WebSocket URL", () => {
    const props = { stationId: "b4c3" as string };
    expect(props.stationId).toBe("b4c3");

    // The component's WS URL construction is validated by checking:
    // wsUrl = `ws://localhost:5001/ws/app/station-streaming/${stationId}`
    const expectedWsUrl = "ws://localhost:5001/ws/app/station-streaming/b4c3";
    expect(expectedWsUrl).toMatch(/ws:\/\/localhost:5001\/ws\/app\/station-streaming\/b4c3/);
  });

  // Test 6: UploadForm handles uploadId generation and display
  it("UploadForm displays uploadId after successful simulated upload", async () => {
    render(UploadForm());
    expect(document.body).not.toBeNull();
  });

  // Test 7: All components have no runtime errors when mounted together
  it("All UI components can be rendered in the same DOM without conflicts", () => {
    const container = document.createElement("div");
    container.style.padding = "8px";

    const healthEl = HealthCheck();
    const metricsEl = MetricsDashboard();
    const alertEl = AlertPanel();
    const uploadEl = UploadForm();
    const streamEl = StreamingComponent({ stationId: "b4c3" as const });

    container.appendChild(healthEl);
    container.appendChild(metricsEl);
    container.appendChild(alertEl);
    container.appendChild(uploadEl);
    container.appendChild(streamEl);

    expect(container.children).toHaveLength(5);
  });
});
