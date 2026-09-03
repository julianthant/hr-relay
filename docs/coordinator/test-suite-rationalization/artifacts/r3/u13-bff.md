# R3a u13 — BFF/server route and wire audit

## Pre-edit ownership ledger

Recorded on 2026-09-02 before any R3a source/test edit, at base
`39598d2fb9c0964e3ac819c5b3de3538724a8380`. The coordinator board is read-only; its intake blob is
`066e588b1397a57cb53d41af91514789e7ceedda`.

| Retained test file | Unique boundary risk / failure oracle |
| --- | --- |
| `tests/unit/server/activity-export.test.ts` | Activity export request parsing, exact served axes, and refusal wire |
| `tests/unit/server/activity-report.test.ts` | Activity report projection over authoritative run evidence |
| `tests/unit/server/archive-capture-resource.test.ts` | Frozen archive capture identity and immutable resource status |
| `tests/unit/server/archive-capture-routes.test.ts` | Archive HTTP identity, digest, download headers, disconnect cancellation, and path-free errors |
| `tests/unit/server/bff-flow.test.ts` | Composed BFF route/kernel/projection flow, mutation admission, SSE, and attachment transfer |
| `tests/unit/server/bootstrap-storage-arms.test.ts` | Bootstrap storage-health wire arms and refusal distinctions |
| `tests/unit/server/context-data-edit.test.ts` | Edit Data read/write command boundary and canonical checkpoint identity |
| `tests/unit/server/cross-date-search-snapshot-token.test.ts` | Search continuation token snapshot/identity binding |
| `tests/unit/server/cross-date-search.test.ts` | Cross-date query ordering, pagination, and malformed/foreign refusal |
| `tests/unit/server/dashboard-http-server.test.ts` | Node-to-Hono adaptation, abort/backpressure ownership, shutdown, and transfer-error retention |
| `tests/unit/server/dashboard-read-scan-bounds.test.ts` | Bounded day/log/archive reads and fail-loud out-of-scope evidence rejection |
| `tests/unit/server/dashboard-stream.test.ts` | SSE hello/snapshot/change lifecycle and subscription teardown |
| `tests/unit/server/data-origins.test.ts` | Descriptor-derived data-origin/freshness projection |
| `tests/unit/server/diagnostic-bundle-readback.test.ts` | Diagnostic bundle identity, verified bytes, and corruption refusal |
| `tests/unit/server/explorer-edit-service.test.ts` | Explorer edit validation/application contract and conflict results |
| `tests/unit/server/explorer-override-store.test.ts` | Override claim/journal crash recovery and exact replay |
| `tests/unit/server/explorer-query.test.ts` | Explorer projection from the module/descriptor authority |
| `tests/unit/server/failure-status.test.ts` | Named failure-class-to-status mapping without substring fallback |
| `tests/unit/server/identity-gate-section.test.ts` | Conditional identity gate surface and impossible-history refusal |
| `tests/unit/server/intake-surface.test.ts` | Upload/session/manifest/rerun boundary with immutable artifact input |
| `tests/unit/server/operator-xlsx-export-service.test.ts` | Actor-attributed export command, snapshot continuation, and evidence atomicity |
| `tests/unit/server/operator-xlsx-workbook.test.ts` | Deterministic XLSX bytes and exact redacted column/axis contract |
| `tests/unit/server/parked-write-section.test.ts` | Parked-write resolution surface over write authority and proof schemas |
| `tests/unit/server/queue-row-actions.test.ts` | Legal command affordances from authoritative lifecycle facts |
| `tests/unit/server/queue-row-subject-title.test.ts` | Queue subject/title identity without positional or inferred fallback |
| `tests/unit/server/request-identity.test.ts` | Strict solo actor derivation and caller-material refusal |
| `tests/unit/server/run-comparison.test.ts` | Exact-run comparison identity and schema-bound evidence |
| `tests/unit/server/run-detail-captures.test.ts` | Live capture index/origin/corruption projection and foreign-run refusal |
| `tests/unit/server/run-detail-gate-outcome.test.ts` | Gate-result authority in run detail |
| `tests/unit/server/run-detail-step-omission.test.ts` | Omission versus executed/skipped result semantics |
| `tests/unit/server/run-detail-timeline-categories.test.ts` | Timeline group/category projection from descriptors and spans |
| `tests/unit/server/run-detail-timeline-collision.test.ts` | Multiple executions at one historical span identity remain distinct |
| `tests/unit/server/run-detail-timeline-duration.test.ts` | Duration derivation from durable start/end evidence |
| `tests/unit/server/run-queue-projection.test.ts` | Queue/day wire fold, authority joins, and lifecycle projection |
| `tests/unit/server/run-status-derivation.test.ts` | Exhaustive status derivation and distinct terminal outcomes |
| `tests/unit/server/settings-facts.test.ts` | Served Settings provenance and restart/current status facts |
| `tests/unit/server/start-plan-omissions.test.ts` | Complete/schema-valid omissions before start authority |
| `tests/unit/server/verified-byte-response.test.ts` | Verified-byte lease selection, method/range refusal, and disposal ordering |

Explicitly outside R3a: `worker-pool-composition.test.ts`, `worker-pool-parallel-proof.test.ts`, and
`worker-supervisor.test.ts` belong to R3b u15/u17/u18. The Scout found no deletion-safe duplicate:
generic HTTP disconnect, Archive-route disconnect, query-level archive absence, and HTTP resource
absence observe different seams and failure oracles.

## Verification record

No file or case was deleted, moved, or merged. The table's second column is the per-file risk and
red-capable failure oracle: source inspection confirmed that each retained file drives its named
boundary directly and asserts the returned wire, status, bytes, authority, refusal, or cleanup
state. The verbose gate printed the `unit` project, every file, and every complete behavior/refusal
title, providing the profile's equivalent evidence without manufacturing 38 temporary production
mutations.

```text
u13_tests=(${(f)"$(sed -n '/| Retained test file |/,/^$/p' \
  docs/coordinator/test-suite-rationalization/artifacts/r3/u13-bff.md \
  | rg -o 'tests/unit/server/[^`]+\.test\.ts' | sort -u)"})
npm exec vitest run -- --project unit ${u13_tests[@]} --reporter=verbose

Test Files  38 passed (38)
Tests       717 passed (717)
Duration    8.55s (real 9.27s)
```

This gate ran while the legitimate dashboard remained on PIDs 95609/95590 at 3938/5174. The carried
Archive real-client-disconnect case passed in 362ms. Its direct abort/lease assertion is distinct
from the generic HTTP adapter's transfer-cancellation oracle and from query-level absence; no
equivalence justified consolidation.
