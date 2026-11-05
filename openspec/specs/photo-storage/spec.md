# Photo storage

## Purpose
Describe the implemented protected photo storage route while preserving the separate legacy upload acknowledgment.

## Requirements

### Requirement: Bounded JPEG upload
POST `/api/stations/{stationId}/photos` SHALL require the ingestion key and a known station. It SHALL accept one or two `photos` multipart JPEG parts, reject malformed multipart and structurally invalid JPEG data with 400, and reject actual request bodies above 524288 bytes with 413. Successful storage SHALL return 201 with photo IDs and metadata.

#### Scenario: Chunked oversized upload
- **WHEN** a chunked multipart body exceeds 524288 actual bytes without a declared Content-Length
- **THEN** the API returns 413 and stores no photo

### Requirement: Protected retrieval and retention
GET `/api/stations/{stationId}/photos` SHALL list retained metadata and GET `/api/photos/{photoId}` SHALL return retained JPEG bytes; both require the ingestion key. Photos older than 30 days SHALL be removed. Storage SHALL retain at most 1000 photos and 50 MiB by pruning oldest photos. A lower count can be configured.

#### Scenario: Count retention
- **WHEN** the count limit is one and a second photo is stored
- **THEN** the first photo becomes unavailable and the second can be retrieved after API restart
