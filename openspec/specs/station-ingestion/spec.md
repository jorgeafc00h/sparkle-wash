# Station ingestion and recorded washes

## Purpose
Describe the implemented direct HTTP ingestion path. MQTT transport and hardware integration remain in the open platform parity change.

## Requirements

### Requirement: Keyed station telemetry
When `SPARKLEWASH_INGEST_KEY` is configured, POST `/api/stations/{stationId}/telemetry` SHALL require that value in `X-SparkleWash-Ingest-Key`. Valid readings SHALL be persisted to the configured JSON data file, replacing that station's current snapshot. Invalid station IDs, statuses, names, pressure or soap levels SHALL be rejected. Without a configured key, ingestion SHALL be unavailable.

#### Scenario: Unauthorized reading
- **WHEN** a request omits the ingestion key
- **THEN** the API returns 401 and does not change the station snapshot

### Requirement: Persistent station readings and derived alerts
After at least one valid reading, GET `/api/metrics` SHALL return persisted station snapshots and `X-SparkleWash-Data-Source: station-ingest`. GET `/api/metrics/alerts` SHALL derive low pressure below 45 psi, high pressure above 60 psi and low soap below 35 dm from those snapshots. Server restart SHALL preserve the snapshots.

#### Scenario: Low pressure and soap
- **WHEN** a station reports 42 psi and 30 dm
- **THEN** the alerts response contains lowPressure and lowSoapLevel for that station

### Requirement: Recorded wash history and summary
A keyed POST `/api/stations/{stationId}/washes` SHALL store a completed wash for an existing station with a valid category and revenue. GET `/api/washes/history` SHALL return recorded washes newest first, with a limit of 1 through 100. GET `/api/metrics/summary` SHALL aggregate recorded wash count and revenue. History SHALL retain at most 1000 records and survive restart.

#### Scenario: Recorded revenue
- **WHEN** a known station records a basic wash with revenue 12.50 USD
- **THEN** history contains that wash and the summary includes it in count and revenue
