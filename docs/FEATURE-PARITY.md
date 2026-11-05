# Feature parity as of 2026-10-19

| Capability | API | Web | iOS | Hardware |
| --- | --- | --- | --- | --- |
| Package menu and price matrix | Shared fixture, tested | Mounted | Mounted | N/A |
| Plate observations and confirmation | Durable, keyed, tested | Review and open job | Review and open job | Physical sender pending |
| Job lifecycle and whole-carwash counts | Durable, tested | Mounted | Mounted | N/A |
| Employee assignments | Durable, tested | Mounted | Mounted | N/A |
| Inventory ledger and reservations | Durable, tested | Read-only stock | Read-only stock | N/A |
| Google staff roles | Verified API route, tests | Client integrated; credentials needed | Client integrated; credentials needed | N/A |
| N1CO job payments and receipts | Signed webhook inbox; reconciliation pending | Pending | Pending | N/A |
| Camera evidence in job views | Retained by arrival | Pending | Pending | Physical camera pending |
| Job streaming and offline behavior | Station stream only | HTTP refresh | HTTP refresh and read cache | Pending |
| Deployment and end-to-end acceptance | Pending | Pending | Pending | Pending |

See `openspec/changes/complete-platform-parity/tasks.md` for numbered tasks and evidence. A checked task covers only its stated implementation, not full platform parity.
