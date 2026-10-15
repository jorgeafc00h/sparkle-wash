import React, { useEffect, useState } from "react";
import type { WebSocketEvent } from "./types";

type StationProps = { readonly stationId: string };

export default function StreamingComponent({ stationId }: StationProps) {
  const wsUrl = `ws://localhost:5001/ws/app/station-streaming/${stationId}`;
  const [payload, setPayload] = useState<WebSocketEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log(`[WebSocket] Connected to ${stationId}`);
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const data: WebSocketEvent = JSON.parse(event.data);
        if (cancelled) return;
        setPayload(data);
        // Emit custom event for accessibility
        window.dispatchEvent(
          new CustomEvent("telemetry-update", { detail: data })
        );
      } catch (e) {
        setError(`Failed to parse message: ${event.data}`);
      }
    };

    socket.onerror = () => {
      console.log(`[WebSocket] Connection error for ${stationId}, will reconnect...`);
    };

    socket.onclose = () => {
      if (cancelled) return;
      setTimeout(() => {
        // Attempt to reconnect
        const newSocket = new WebSocket(wsUrl);
        // Re-use the same handlers (in a real app, use a ref pattern)
        newSocket.onmessage = (e) => socket.onmessage?.(e);
        newSocket.onerror = () => { /* no-op in reconnection */ };
      }, 5000);
    };

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [stationId]);

  const displayError = error !== null ? (
    <div style={{ color: "#dc2626", fontSize: "0.875rem" }}>
      {error}
    </div>
  ) : (payload) ? (
    <pre
      style={{
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        color: "#1f2937",
        background: "#f9fafb",
        padding: "8px",
        borderRadius: "4px",
        margin: 0,
        fontSize: "0.8rem",
      }}
    >
      {JSON.stringify(payload, null, 2)}
    </pre>
  ) : (
    <div style={{ color: "#9ca3af", fontSize: "0.875rem" }}>
      Connecting to stream for station "{stationId}"...
    </div>
  );

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "12px 16px",
        margin: "8px 0",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "4px" }}>
        📡 Station Stream
      </div>
      {displayError}
    </div>
  );
}
