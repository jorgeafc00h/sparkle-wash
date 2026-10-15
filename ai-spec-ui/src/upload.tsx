import React, { useState } from "react";
import axios, { AxiosResponse } from "axios";

const UPLOAD_ENDPOINT = "/api/upload" as const;

export default function UploadForm() {
  const [loading, setLoading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const onSubmit = React.useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setUploadId(null);

    let fd = new FormData(e.currentTarget);
    let boundary = "----WebKitFormBoundary" + Math.floor(Math.random() * 1e9).toString(36);

    // Build multipart body
    const parts: Array<{ contentDisposition: string; contentType?: string; data?: any }>[] = [];
    let fileIndex = -1;

    for (const [k, v] of Object.entries(fd)) {
      const val = fd.get(k);
      if (val instanceof File) fileIndex++;
      parts.push({
        contentDisposition: `form-data; name="${k}${fileIndex ? '; filename="' + v.name + '"' : ''}"${v.filename ? '; filename="' + v.filename + '"' : ''}`,
        contentType: k === "file" ? v.type || "application/octet-stream" : undefined,
        data: typeof val === "string" ? val : val?.toString(),
      });
    }

    const body = `--${boundary}\r\n`;
    let bodyPart = true;
    for (const p of parts) {
      if (!bodyPart) body += "\r\n";
      body += p.contentDisposition + "\r\n";
      if (p.contentType) body += `Content-Type: ${p.contentType}\r\n\r\n`;
      else body += "\r\n";

      const safeData = typeof p.data === "string" ? p.data : btoa(p.data as string).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      body += safeData + "\r\n--" + boundary + "--\r\n";
    }

    try {
      // Simulate upload for demo (in real app, send FormData as-is)
      await new Promise((res) => setTimeout(res, 50));

      const uploadId = "upload-" + Math.random().toString(36).slice(2, 12);
      setUploadId(uploadId);
      setMessage("✓ Successfully uploaded!");
    } catch (err) {
      setMessage("Error: " + String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>Photo Upload</h2>
      {uploadId ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            background: "#ecfdf5",
            color: "#065f46",
            fontSize: "0.85rem",
            marginBottom: "8px",
          }}
        >
          <strong>📮 Upload ID:</strong> <code style={{ fontFamily: "monospace" }}>{uploadId}</code>
          {" — "}
          <a href={`/api/upload/${uploadId}`} style={{ color: "#0891b2" }}>view metadata</a>
        </div>
      ) : (
        message && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "6px",
              background: message.includes("Error") ? "#fef2f2" : "#eff6ff",
              color: message.includes("Error") ? "#b91c1c" : "#1e40af",
              fontSize: "0.85rem",
              marginBottom: "8px",
            }}
          >
            {message}
          </div>
        )
      )}
      <form onSubmit={onSubmit}>
        {!uploadId && (
          <input type="file" name="name" id="photo" accept="image/*" style={{ fontSize: "0.8rem", marginBottom: 4 }} />
        )}

        {(!uploadId || false) && (
          <label style={{ display: "block", margin: "6px 0", fontSize: "0.8rem" }}>
            <input type="checkbox" style={{ marginRight: 4 }} /> Include metadata field
          </label>
        )}

        <button
          disabled={loading}
          type="submit"
          style={{
            marginTop: "6px",
            padding: "8px 16px",
            background: loading ? "#e5e7eb" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Uploading…" : "Select File → Upload"}
        </button>
      </form>
    </div>
  );
}

export type UploadProps = {};
