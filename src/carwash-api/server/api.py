#!/usr/bin/env python3
import socket, json, urllib.parse

HOST, PORT = "localhost", 5873
CRLF = chr(13) + chr(10)

responses = {
    "/healthz": ("200 OK", '{"status":"healthy"}'),
    "/api/metrics": ('200 OK', '[{"id":"b4c3","name":"Bay#1 foam touch","status":"idle","pressurePsi":52,"soapLevelDm":20},{"id":"7d5c","name":"Bay#2 high pressure","status":"washing","pressurePsi":58.5,"soapLevelDm":24}]'),
    "/api/metrics/alerts": ('200 OK', '[{"code":"lowPressure","value":32.5},{"code":"highSoapLevel","value":78}]'),
    "/jobs/stats": ("200 OK", '{""totalJobs"":12,""basicJobs"":5,""ceramicJobs"":6,""premiumJobs"":1,""expressJobs"":0}'),
    "/jobs": ('200 OK', '[{"plateNumber":"ABCD-123","model":"Toyota Camry"},{"plateNumber":"ABCD-456","model":"BMW X5"}]'),
    "/jobs/history": ('200 OK', '{""total"":5,""page"":1,""records"":[{""plateNumber"":""ABCD-123"",...}]}'),
}

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind((HOST, PORT))
sock.listen(64)

print("SparkleWash API v2.1.0 running on http://" + HOST + ":" + str(PORT), flush=True)

while True:
    try:
        client, addr = sock.accept()
    except socket.timeout:
        continue

    request = client.recv(8192).decode("utf-8", errors="ignore")
    if not request.strip():
        client.close()
        continue

    first = request.split(CRLF)[0]
    parts = first.split(None, 2)
    method = parts[0].rstrip()
    path_raw = parts[1].rstrip() if len(parts) > 1 else ""

    cl = -1
    try:
        body_end = request.rsplit(CRLF, 2)[-2]
        for line in body_end.split(CRLF):
            line = line.strip()
            if line.lower().startswith("content-length:"):
                try:
                    cl = int(line.split(": ", 1)[1])
                except:
                    pass
    except:
        pass

    path_key = urllib.parse.unquote(path_raw).lower()

    if method.upper() == "POST":
        if path_key.startswith("/api/upload"):
            uid = path_key[9:]  # strip "/api/upload"
            body_bytes = json.dumps({"ok": True, "uploadId": uid})
        elif len(paths_raw) > 13 and path_key.startswith("/jobs/record/"):
            rid = path_key.split("/")[-1]
            body_bytes = json.dumps({"plateNumber": "ABCD-" + rid, "model": "Toyota Camry"})
        else:
            body_bytes = b'{"ok":true}'
        response = "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r{}".format(len(body_bytes), body_bytes)
    elif method.upper() == "DELETE" and "/record/" in path_key:
        response = 'HTTP/1.1 204 No Content\r\n\r\n'
    elif path_key in responses:
        status, body_str = responses[path_key]
        if len(body_str) > 50:
            decoded = json.loads(body_str)
            body_bytes = json.dumps(decoded).encode("utf-8")
        else:
            try:
                body_bytes = body_str.encode("utf-8")
            except:
                body_bytes = b"{}"
        status_code = int(status.split()[1])
        response = "HTTP/1.1 {} OK\r\n".format(status) + "Content-Type: application/json\r\n" + "Content-Length: {}\r\n\r\n{}".format(len(body_bytes), body_bytes.decode("utf-8"))
    else:
        response = "HTTP/1.1 404 Not Found\r\n\r\n{'error': 'not found'}"

    client.sendall(response.encode())
    client.close()

sock.close()
