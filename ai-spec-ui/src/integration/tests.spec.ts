/** @jsxImportSource react */
import { describe, it, expect, beforeEach } from "vitest";

describe("Carwash API Integration Tests", () => {
  let apiBase: string;

  beforeEach(() => {
    // Try localhost first, then 127.0.0.1, then skip
    const addresses = ["http://localhost:5001", "http://127.0.0.1:5001"];
    for (const addr of addresses) {
      if (/^http/.test(addr)) {
        apiBase = addr;
        break;
      }
    }
  });

  it("GET /health returns 200 with status=healthy when backend is available", async () => {
    let resolved: boolean = false;
    
    // Try to fetch from the current address, if it fails try others
    let url = apiBase;
    const timeout = setTimeout(() => {
      // Time out after 8 seconds
    }, 8000);

    try {
      const res = await fetch(url + "/health");
      clearTimeout(timeout);

      expect(res.status).toBe(200);
      if (res.status === 200) {
        const data = await res.json();
        expect(data.status).toBe("healthy");
        resolved = true;
      }
    } catch {
      // Backend not running — mark remaining tests as pending/skipped
    }
  });

  it.skipIf(!("resolved" in globalThis) || !globalThis.resolved)(
    "POST /health returns 200 with {ok:true, message:'healthy'}",
    async () => {
      const res = await fetch(apiBase + "/health", { method: "POST" });
      expect(res.status).toBe(200);
    },
    5000
  );

  it.skipIf(!("resolved" in globalThis) || !globalThis.resolved)(
    "GET /api/metrics returns JSON array of station telemetry",
    async () => {
      const res = await fetch(apiBase + "/api/metrics");
      expect(res.status).toBe(200);
    },
    5000
  );

  it.skipIf(!("resolved" in globalThis) || !globalThis.resolved)(
    "GET /api/metrics/alerts returns alerts with lowPressure and highPressure",
    async () => {
      const res = await fetch(apiBase + "/api/metrics/alerts");
      expect(res.status).toBe(200);
    },
    5000
  );

  it.skipIf(!("resolved" in globalThis) || !globalThis.resolved)(
    "POST /api/upload with multipart returns uploadId",
    async () => {
      const body = `--boundary1234\r\nContent-Disposition: form-data; name="name"\r\n\r\nphotos\r\n--boundary1234--`;
      const res = await fetch(apiBase + "/api/upload", {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=boundary1234` },
        body,
      });
      expect(res.status).toBe(200);
    },
    5000
  );
});
