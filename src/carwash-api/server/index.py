import sys, http.server, urllib.parse, json, os
from pathlib import Path, Path as P

class APIHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_json(self, code, data):
        body = json.dumps(data)
        encoded = f"HTTP/1.1 {code} OK\rContent-Length: {len(body)}\rContent-Type: application/json\r\n\r\n{body}"
        self.wfile.write(encoded.encode())

    def do_GET(self):
        q = urllib.parse.urlparse(self.path.split("?")[0]).path
        if q in ["/healthz", "/health"]:
            return self.send_json(200, {"status": "healthy", "pid": os.getpid(), "version": "1.0.0"})
        if q == "/api/metrics":
            return self.send_json(200, [{"stationId":"b4c3","name":"Bay #1 foam touch","status":"idle","pressurePsi":52.0,"soapLevelDm":20},{"stationId":"7d5c","name":"Bay #2 high pressure","status":"washing","pressurePsi":58.5,"soapLevelDm":24},{"stationId":"a1f2","name":"Bay #3 detail","status":"idle","pressurePsi":48.0,"soapLevelDm":19},{"stationId":"e8f1","name":"Bay #4 diamond polish","status":"cleaning","pressurePsi":63.2,"soapLevelDm":26}])
        if q == "/api/metrics/alerts":
            return self.send_json(200, [{"code":"lowPressure","value":32.5,"threshold":45.0,"severity":"warning"},{"code":"highSoapLevel","value":78.0,"threshold":90.0,"severity":"info"}])
        if q == "/jobs/stats":
            return self.send_json(200, {"totalJobs":12,"basicJobs":5,"ceramicJobs":6,"premiumJobs":1,"expressJobs":0,"revenue":134.5})
        if q.startswith("/jobs/history"):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(q).query)
            page = int(params.get("page",[1])[0])
            size = int(params.get("size",[2])[0])
            jobs = [
                {"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c7","plateNumber":"ABCD-123","model":"Toyota Camry","color":"Blue","category":"basic","employeeName":"Maria Lopez","completedAt":1718968302},
                {"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c8","plateNumber":"ABCD-456","model":"BMW X5","color":"Gray","category":"ceramic","employeeName":"David Kim","completedAt":1718968277},
                {"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c9","plateNumber":"ABCD-789","model":"Toyota Camry","color":"Blue","category":"basic","employeeName":"Maria Lopez","completedAt":1718968243},
                {"id":"e8f3c4d9-2a1b-4390-b042-d502f19417ca","plateNumber":"XYS-111","model":"BMW X5","color":"Gray","category":"ceramic","employeeName":"David Kim","completedAt":1718968212},
                {"id":"e8f3c4d9-2a1b-4390-b042-d502f19417cb","plateNumber":"ABC-070","model":"Toyota Camry","color":"Blue","category":"basic","employeeName":"Maria Lopez","completedAt":1718965943}
            ]
            start = max(0,(page-1)*size)
            items = jobs[start:start+size]
            return self.send_json(200, {"records":items,"total":len(jobs),"page":page,"size":size})
        if q.startswith("/jobs/record/"):
            return self.send_json(200, {"plateNumber":"ABCD-123","model":"Toyota Camry","color":"Blue","category":"basic","employeeName":"Maria Lopez","completedAt":1718968302})
        if q == "/jobs":
            return self.send_json(200, {"total":5,"records":[{"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c7","plateNumber":"ABCD-123","model":"Toyota Camry","category":"basic"},{"id":"e8f3c4d9-2a1b-4390-b042-d502f19417c8","plateNumber":"ABCD-456","model":"BMW X5","category":"ceramic"}]})
        if q == "/openapi.json":
            try:
                with open(Path(__file__).parent.parent.resolve() / "api-spec.openapi.yaml") as f:
                    return self.send_json(200, json.loads(f.read()))
            except:
                pass
            return self.send_json(200, {"info":{"title":"SparkleWash Carwash API","version":"2.1.0"}})
        return self.send_json(404, {"error":"not found"})

    def do_POST(self):
        cl = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(cl).decode() if cl else ""
        q = urllib.parse.urlparse(self.path.split("?")[0]).path
        if q == "/api/upload":
            return self.send_json(201, {"ok":True,"uploadId":"demo"})
        if q.startswith("/jobs/record/"):
            return self.send_json(200, {"status":"updated","durationMs":1723})
        return self.send_json(404, {"error":"not found"})

    def do_DELETE(self):
        q = urllib.parse.urlparse(self.path.split("?")[0]).path
        if q.startswith("/jobs/record/"):
            return self.send_json(204)
        return self.send_json(405, {})

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", 5873), APIHandler)
    print("* SparkleWash API listening on http://localhost:5873/")
    server.serve_forever()
