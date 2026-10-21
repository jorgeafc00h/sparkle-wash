#!/usr/bin/env python3
"""SparkleWash Proxy v1.0 - SPA server + API gateway on port 8082."""

import json
import socket
import socketserver
import sys


STATUS_CODES = {"200": "OK", "405": "Method Not Allowed", "404": "Not Found"}
INDEX_HTML = b"<!DOCTYPE html><html lang='en'><head><title>SquareWash</title></head><body id='root' class='app'>Loading...</body></html>"
CONTENT_TYPES_JSON_BASE = {"name": "SparkleWash API Gateway", "status": "ok"}
REVENUE = {"basic": 567.80, "ceramic": 1890.00, "premium": 892.50, "express": 145.00}
JOBS_DATA = [
    {"job_id": 1, "type": "basic", "plate": "AB-123-CD", "car_model": "Honda Civic", "color": "red"},
    {"job_id": 2, "type": "ceramic", "plate": "XY-789-ZA", "car_model": "Tesla Model 3", "color": "white"},
    {"job_id": 3, "type": "basic",   "plate": "EF-456-GH", "car_model": "Toyota Camry",   "color": "blue"}
]
STAFF = [
    {"rank": 1, "name": "Maria Garcia",     "jobs_completed": 23, "revenue": "$1,890.00"},
    {"rank": 2, "name": "Alex Chen",        "jobs_completed": 18, "revenue": "$1,456.00"}
]
KPI = {"daily_jobs_completed": 47, "total_revenue_2026_01": "$2,350.00", "top_performer_name": "Maria Garcia"}
PORT, HOST = 8082, "0.0.0.0"


def make_http(status_str):
    return "HTTP/1.1 %s\r\n" % status_str.encode() + b"\r\n"

def build_response(body_bytes=None, content_type="text/html"):
    if body_bytes:
        body_len = len(body_bytes)
        lines = [b"Content-Length: " + str(body_len).encode(), b"\r\n", make_http(status), b"".join([body_bytes[:32768], b"."])]
    return b"".join(lines)

def http_error(response_type):
    body = {
        405: b"GET only.",
        404: b"Not Found", 
        403: b"Forbidden",
        502: b"Bad Gateway"
    }.get(response_type, b"Not Allowed")
    return b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: %d\r\n\r\n%s" % (len(body), body)

def http_ok(body_bytes, content_type="application/json"):
    lines = [b"HTTP/1.1 200 OK"]
    if body_bytes:
        lines.append(b"Content-Length: " + str(len(body_bytes)).encode() + b"\r\n")
        lines.append(b"Content-Type: %s\r\n" % content_type.encode())
    else:
        lines.append(b"Content-Type: %s\r\n" % content_type.encode())
    return b"\r\n".join(lines) + b"\r\n"


def get_response(path):
    p = (path or "").lstrip("/").split("?")[0].split("!")[0]
    if not p:
        return http_ok(INDEX_HTML, "text/html")
    if "/kpi/" in path or "/api/kpi/summary" == path:
        return http_ok(json.dumps(KPI).encode(), "application/json")
    if "/health" in path or "/healthz" in path:
        return http_ok(json.dumps(CONTENT_TYPES_JSON_BASE).encode(), "application/json")
    if "/revenue/by-category/" in path and len(path.split("/")) > 5:
        cat = path.split("/")[-1]
        val = REVENUE.get(cat, {}).get("basic", 0.0) or 0.0
        return http_ok(json.dumps({cat: val}).encode(), "application/json")
    if "/revenue/by-category" in path and len(path.split("/")) <= 5:
        return http_ok(json.dumps({}))
    if "/jobs/history" in path:
        return http_ok(json.dumps({"jobs": JOBS_DATA}).encode())
    if "/leaderboard" in path or "/employees/leaderboard" == path:
        return http_ok(json.dumps({"employees": STAFF}).encode())
    if "/settings" in path:
        return http_ok(json.dumps({"endpoint": "localhost:8123", "demo_mode": True}).encode())
    if "/assets/" in path:
        return b"HTTP/1.1 404 Not Found\r\nContent-Length: %d\r\n\r\nNot Found" % len(b"Not Found")
    return http_error(405)


class RequestHandler(socketserver.StreamRequestHandler):
    protocol_version = "HTTP/1.1"

    def finish(self):
        pass

    def handle(self):
        try:
            buf = bytearray(65536)
            while len(buf) < 65536:
                try:
                    chunk = self.request.recv(8192)
                except (socket.timeout, socket.error):
                    break
                if not chunk:
                    break
                buf.extend(chunk)

            resp_bytes = bytes(buf[:len(buf)])
            if len(resp_bytes) < 18 or b"\r\n\r\n" not in resp_bytes:
                return
            crlf = resp_bytes.find(b"\r\n\r\n")
            first_line = resp_bytes[:crlf].decode("ascii", errors="replace").strip()
            parts = first_line.split(maxsplit=2)
            if len(parts) < 2:
                return
            method, raw_path = parts[0], (parts[1] or "").lstrip("///")

            if method != "GET":
                self.send(b"HTTP/1.1 405 Method Not Allowed\r\n\r\nGET only")
                return

            response = get_response(raw_path)
            if response:
                try:
                    self.request.send(response)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        except Exception as e:
            try:
                self.request.sendall(b"HTTP/1.1 503\r\nContent-Length: 22\r\n\r\nService Error")
            except:
                pass


class ProxyServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32

    @staticmethod
    def get_request_class():
        return RequestHandler

    def bind(self, address=None):
        try:
            super().bind(address)
        except OSError as e:
            if "Address already in use" in str(e).lower():
                raise RuntimeError("Bind failed") from e
            raise

    def serve_forever(self, numthreads=32):
        self.numthreads = numthreads
        print("Listening on port %d" % self.server_address[1])
        while True:
            try:
                client = self.socket.accept()
                handler = RequestHandler(client)
                handler.handle()
            except (ConnectionResetError, BrokenPipeError):
                continue


if __name__ == "__main__":
    srv = ProxyServer((HOST, PORT))
    srv.serve_forever()
