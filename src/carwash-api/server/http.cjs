const http = require('http');

const PORT = 5873;

const responses = {
  "/healthz": JSON.stringify({ status: "healthy", version: "2.1.0" }),
  "/api/metrics": "[{\"stationId\":\"b4c3\",\"name\":\"Bay #1 foam touch\",\"status\":\"idle\",\"pressurePsi\":52,\"soapLevelDm\":20},{\"stationId\":\"7d5c\",\"name\":\"Bay #2 high pressure\",\"status\":\"washing\",\"pressurePsi\":58.5,\"soapLevelDm\":24}]",
  "/api/metrics/alerts": "[{\"code\":\"lowPressure\",\"value\":32.5},{\"code\":\"highSoapLevel\",\"value\":78}]",
  "/jobs/stats": JSON.stringify({ totalJobs: 12, basicJobs: 5, ceramicJobs: 6, premiumJobs: 1, expressJobs: 0, revenue: 134.5 }),
  "/jobs": JSON.stringify({ total: 5, page: 1, size: 2, records: [{"plateNumber":"ABCD-123","model":"Toyota Camry"},{"plateNumber":"ABCD-456","model":"BMW X5"}] }),
  "/jobs/history": JSON.stringify({ total: 5, page: 1, size: 2, records: [{"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c7","plateNumber":"ABCD-123","model":"Toyota Camry","color":"Blue"},{"plateNumber":"ABCD-456","model":"BMW X5","color":"Gray"}] }),
  "/openapi.json": JSON.stringify({ openapi: "3.1.0", info: { title: "SparkleWash Carwash API", version: "2.1.0" } }),
};

const handler = (req, res) => {
  const parts = req.url.toLowerCase().split("?")[0].replace(/\/$/, "");

  if (parts === "/healthz" || parts === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": 18 });
    res.end('"status":"healthy"\n');
    return;
  }

  if (parts === "/api/metrics" || parts === "/api/metrics/alerts") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": responses[parts].length });
    res.end(responses[parts]);
    return;
  }

  if (parts === "/jobs/stats") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": responses[parts].length });
    res.end(responses[parts]);
    return;
  }

  if (parts === "/jobs") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": responses[parts].length });
    res.end(responses[parts]);
    return;
  }

  if (parts === "/jobs/history") {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": responses[parts].length });
    res.end(responses[parts]);
    return;
  }

  if (parts === "/openapi.json") {
    const body = JSON.stringify({ openapi: "3.1.0", info: { title: "SparkleWash Carwash API", version: "2.1.0" } });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length });
    res.end(body);
    return;
  }

  if (parts.startsWith("/jobs/record")) {
    const id = parts.split("/").pop();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: id || "e8f3c4d9-...", ok: true }));
    return;
  }

  if (parts === "/api/upload") {
    let uploadId = "demo";
    req.on("data", () => {});
    req.on("end", () => { res.writeHead(201, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, uploadId })); });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", "Content-Length": 18 });
  res.end('"error":"not found"\n');
};

const server = http.createServer(handler);

server.listen(PORT, "127.0.0.1", () => console.log("SparkleWash API v2.1.0 listening on http://127.0.0.1:" + PORT));
