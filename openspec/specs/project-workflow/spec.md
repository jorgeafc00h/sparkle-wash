# Project workflow

## Purpose
Maintain one current specification root, explicit platform ownership, and checks that execute actual implementations.

## Requirements

### Requirement: Canonical specifications
The root openspec directory SHALL contain the implemented baseline. Desired missing features SHALL remain in an open change and a parity matrix. Historical specs and completion reports SHALL be labeled as historical evidence, not current acceptance criteria.

#### Scenario: Contributor looks up feature status
- **WHEN** a contributor reads README.md and the review matrix
- **THEN** they can distinguish tested demo functionality from missing production capabilities

### Requirement: Real implementation checks
The project SHALL provide `make verify` for strict OpenSpec validation, web type checking/build/tests and API integration tests. Backend tests SHALL start Program.BuildApp rather than copy route bodies. CI SHALL fail when a required check fails.

#### Scenario: Production station contract regresses
- **WHEN** the live metrics handler returns a nested array
- **THEN** the integration test for flat station objects fails
