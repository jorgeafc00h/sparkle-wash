import http.server, socketserver, urllib.parse, json
HOST = "localhost"
PORT = 5873

STATIONS = [
    {"stationId": "b4c3", "name": "Bay #1 foam touch", "status": "idle", "pressurePsi": 52.0, "soapLevelDm": 20},
    {"stationId": "7d5c", "name": "Bay #2 high pressure", "status": "washing", "pressurePsi": 58.5, "soapLevelDm": 24},
    {"stationId": "a1f2", "name": "Bay #3 detail", "status": "idle", "pressurePsi": 48.0, "soapLevelDm": 19},
    {"stationId": "e8f1", "name": "Bay #4 diamond polish", "status": "cleaning", "pressurePsi": 63.2, "soapLevelDm": 26}
]

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_text(self, code, text):
        body = json.dumps(text).replace("\n", "\\n").replace(",", "\\,").replace("}", "\\}").replace("{", "\\{")[:-1] if isinstance(text, list) else json.dumps(text).replace("\r\n", "\r")
        encoded = "HTTP/1.1 " + str(code) + " OK\rContent-Length: " + str(len(body)) + "\rContent-Type: application/json\r\r" + body
        self.wfile.write(encoded.encode("utf-8"))

    def do_GET(self):
        q = self.path.split("?")[0].lower()
        qs = urllib.parse.urlparse(self.path).query.split("&")
        page, size = 1, 2
        for kv in qs:
            if "=" in kv: k, v = kv.split("=", 1)
            elif not kv: k = kv; v = None
            else: continue
            if k == "page": page = int(v)
            elif k == "size": size = int(v)
        if q in ("/healthz", "/health"): self.send_text(200, {"status": "healthy"})
        elif q == "/api/metrics": self.send_text(200, STATIONS)
        elif q == "/api/metrics/alerts": self.send_text(200, [{"code":"lowPressure","value":32.5,"threshold":45.0},{"code":"highSoapLevel","value":78.0,"threshold":90.0}])
        elif q == "/jobs/stats": self.send_text(200, {"totalJobs":12,"basicJobs":5,"ceramicJobs":6,"premiumJobs":1,"expressJobs":0,"revenue":134.5})
        elif q == "/jobs": self.send_text(200, {"total":5,"records":[{"plateNumber":"ABCD-123","model":"Toyota Camry"},{"plateNumber":"ABCD-456","model":"BMW X5"}]})
        elif q == "/jobs/history" or (q.startswith("/jobs/history") and q != "/"): 
            start = max(0, (page - 1) * size)
            items = [{"plateNumber":"ABCD-123","model":"Toyota Camry","color":"Blue","category":"basic"},{"plateNumber":"ABCD-456","model":"BMW X5","color":"Gray","category":"ceramic"}]
            self.send_text(200, {"records": items, "total": len(items)})
        elif q.startswith("/jobs/record/"):
            rid = q[12:]
            self.send_text(200, {
                "plateNumber": f"ABCD-{rid}", 
                "model": "Toyota Camry" if rid in ("5","7") else "BMW X5",
                "color": "Blue" if rid.startswith("5") else "Gray"
            })
        elif q == "/jobs/record": self.send_text(200, {"plateNumber": "ABCD-123"})
        else: self.send_text(404, {"error": "not found"})

    def do_POST(self):
        qlen = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(qlen) if qlen else b""
        q = self.path.split("?")[0].lower()
        if q == "/api/upload": self.send_text(201, {"ok": True})
        elif q.startswith("/jobs/record/"): self.send_text(200, {"status": "updated", "durationMs": 1723})
        else: self.send_text(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/jobs/record/"): self.send_text(204)
        else: self.send_text(202, {"status": "soft_deleted"})

    def log_message(self, *args): pass

socketserver.TCPServer.address_family = lambda s: socket.AF_INET6
if __name__ == "__main__":
    with socketserver.TCPServer((HOST, PORT), Handler) as server:
        print(f"SparkleWash API listening on http://{HOST}:{PORT}")
        server.serve_forever()
