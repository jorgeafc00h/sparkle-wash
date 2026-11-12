# Car Spa (formerly SparkleWash) project guide

Read README.md, docs/ARCHITECTURE.md, and docs/reviews/2026-10-18-code-review.md first.
The active implementation is backend/src/carwash-api, frontend/src/main.tsx → OperationsApp.tsx,
and SparkleWash-iOS (generated Xcode project; edit project.yml for project changes).
The desktop POS is backend/desktop (Electron + React, a Car Spa build of FACTURAS SIMPLES App.Desktop);
read backend/desktop/CLAUDE.md and docs/SPARKLEWASH_INTEGRATION.md before changing it. Its end-to-end spec
(`npx playwright test playwright/tests/carwash` in backend/desktop) runs the real API through src/carwash-api.DevHost.

Run OpenSpec from this directory. Current supported behavior belongs in openspec/specs;
unimplemented product requirements belong in openspec/changes/complete-platform-parity.
OpenAPI describes HTTP routes; OpenSpec describes behavior. Neither is proof of implementation.

Use `make verify` for specs, web type checking/build/tests, and real API integration tests.
Use `make ios-build` and the simulator test command in README.md for native changes.
Never suppress test failures or replace the production app with copied handlers in tests.
Telemetry and upload responses are currently demo stubs. Do not present them as live operations.

Preserve historical work under docs/archive. ai-spec-ui/, backend/ai-spec-ui/, and unused
frontend screens/hooks are experiments, not active entry points. Do not add them to production
without integrating and testing them. No deployed system or Git metadata was available at review.
