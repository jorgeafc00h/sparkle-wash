# Station streaming

## Purpose
Describe the implemented server-side MQTT and WebSocket transport. Client subscriptions remain in the open platform parity change.

## Requirements

### Requirement: Authenticated MQTT bridge
When broker host, user and password are configured, the API SHALL connect to that broker and subscribe to `sparklewash/stations/+/telemetry`. It SHALL validate station IDs and bounded JSON payloads, persist accepted readings, and reconnect after disconnection with a 2–30 second backoff. TLS SHALL be used by default; plaintext MQTT SHALL be allowed only for a loopback test broker.

#### Scenario: Broker restart
- **WHEN** the broker stops and starts again
- **THEN** the bridge resubscribes and later station readings are persisted and delivered without restarting the API

### Requirement: Bounded authenticated WebSocket stream
`/ws/app-station-streaming/{stationId}` SHALL require a configured stream key sent in `X-SparkleWash-Stream-Key` for WebSocket upgrades. It SHALL send the latest station snapshot when available, coalesce queued updates, send updates no faster than once per second, and send an idle heartbeat every 15 seconds by default. It SHALL accept at most 50 concurrent clients. Ordinary HTTP GET requests SHALL still receive 404.

#### Scenario: Unauthorized stream
- **WHEN** a WebSocket client omits the stream key
- **THEN** the upgrade is rejected and no station readings are sent
