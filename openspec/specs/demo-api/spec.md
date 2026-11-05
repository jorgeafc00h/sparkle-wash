# Demo API

## Purpose
Describe the actual .NET 10 prototype contract. Hard-coded data and acknowledgment-only uploads are not operational IoT or payment services.

## Requirements

### Requirement: Flat station snapshots
The API SHALL return a flat JSON array from GET `/api/metrics`. Each station SHALL contain stationId, name, status, pressurePsi, soapLevelDm and an ISO timestamp. Before any station reading is ingested, responses SHALL identify the sample source using `X-SparkleWash-Data-Source: demo`. After ingestion, responses SHALL identify `station-ingest` as the source.

#### Scenario: Read the sample fleet
- **WHEN** a client requests `/api/metrics`
- **THEN** it receives four station objects, not an array wrapping another array, with numeric pressure and soap readings and a demo header

### Requirement: Demo alert list
GET `/api/metrics/alerts` SHALL return an array with code, value, threshold and severity fields. Before ingestion these are fixed examples, not threshold evaluation of the sample fleet. After ingestion alerts SHALL be derived from persisted station readings.

#### Scenario: Request alerts
- **WHEN** a client requests the alerts endpoint
- **THEN** it receives the lowPressure and highPressure sample alerts

### Requirement: Infrastructure routes and unsupported paths
The API SHALL serve GET `/healthz`, GET and POST `/health`, and an OpenAPI document at GET `/openapi.json`. Unknown `/api` and `/ws` routes SHALL return 404 even when the SPA is present.

#### Scenario: Unsupported streaming request
- **WHEN** a client requests `/ws/app-station-streaming/b4c3`
- **THEN** it receives 404 rather than a claimed live connection or HTML success

### Requirement: Legacy upload acknowledgment
POST `/api/upload` SHALL preserve the demo acknowledgment contract: reject absent or zero content length with 400 and lengths above 524288 bytes with 422; otherwise return 200 JSON with ok true. Multipart file parts named photos, or non-form text containing photos, SHALL omit uploadId; other accepted bodies SHALL include an arbitrary uploadId. GET `/api/upload/{uploadId}` SHALL echo any ID with 200. These routes SHALL NOT be described as file storage or payment verification.

#### Scenario: Photo acknowledgment is not persistence
- **WHEN** a client uploads a photos file part under the limit
- **THEN** the API responds with ok true without storing or serving the photo

#### Scenario: Oversized declared upload
- **WHEN** Content-Length exceeds 524288 bytes
- **THEN** the response status is 422, not the historical 418 claim
