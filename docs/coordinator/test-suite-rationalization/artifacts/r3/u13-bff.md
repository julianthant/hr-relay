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

### Per-file negative-control or equivalent map

Each row names one exact passing case from the final JSON result. “Negative” means the case injects
an invalid, missing, corrupt, absent, disconnected, or forbidden state and asserts its distinct
refusal/result. “Direct” means the case varies a load-bearing fact and asserts the discriminating
output at the owning seam.

| File | Kind | Exact full case title |
| --- | --- | --- |
| `activity-export.test.ts` | negative | the Activity report's CSV export (D240) exports an absent quantile's REASON, never a zero |
| `activity-report.test.ts` | negative | the Activity report (D180) refuses the old receipt-digest path when keyed pseudonym evidence is missing |
| `archive-capture-resource.test.ts` | negative | DCA4 archived capture resource reports physical absence without inventing a policy-derived purge |
| `archive-capture-routes.test.ts` | negative | DCA4 exact archived capture routes cancels the production Archive reader lease when the real HTTP client disconnects |
| `bff-flow.test.ts` | negative | BFF spine flow (start plan -> kernel -> spans -> projection) marks the People axis unavailable when one current Separations row lacks persisted evidence |
| `bootstrap-storage-arms.test.ts` | negative | bootstrap storage summary projects retained preflight failures with their exact blocks and remediation |
| `context-data-edit.test.ts` | negative | context-data edit projection (2i-C) names the omitted step behind an asserted value, and never calls it a correction |
| `cross-date-search-snapshot-token.test.ts` | direct | cross-date search snapshot token binds export selection to the exact process signer, authority source, query, and generation |
| `cross-date-search.test.ts` | negative | cross-date search query refuses a page limit above the public maximum |
| `dashboard-http-server.test.ts` | negative | dashboard HTTP request ownership aborts the exact routed Request and settles route cleanup when the client disconnects before headers |
| `dashboard-read-scan-bounds.test.ts` | negative | D5 · the member preview slices before it joins (audit P2) names the absence when the fold has seen no member of a group that claims some |
| `dashboard-stream.test.ts` | negative | dashboard stream hub resnapshots worker cards when a lease moves without any span |
| `data-origins.test.ts` | negative | dataOriginViewsOf (D252) names the commit nodes a read can statically reach, and NONE for a graph with no write |
| `diagnostic-bundle-readback.test.ts` | negative | E29 diagnostic bundle readback refuses a missing id and a traversal-shaped id |
| `explorer-edit-service.test.ts` | negative | Explorer edit service turns an operational policy edit with no descriptor allowlist into a reviewed code-change brief |
| `explorer-override-store.test.ts` | negative | Explorer override atomic repository refuses an access error while 'reading a claim' instead of treating it as absence |
| `explorer-query.test.ts` | negative | the contract field census (D227) never records an INPUT leaf as an observation — the graph binds it |
| `failure-status.test.ts` | negative | failureStatus answers a safe typed 409 for an expected receipt-comparison authority refusal |
| `identity-gate-section.test.ts` | negative | the identity-gate run-detail section (ref write-safety §14.4) advertises the section for a parked-gate run and for no other lifecycle |
| `intake-surface.test.ts` | negative | D170 intake upload route refuses a file the grid edge cannot read, and mints no session |
| `operator-xlsx-export-service.test.ts` | negative | operator XLSX export service refuses a search selection from a foreign authority snapshot before composing bytes |
| `operator-xlsx-workbook.test.ts` | negative | operator XLSX workbook refuses search rows outside the selected DCR3 authority order |
| `parked-write-section.test.ts` | negative | the parked-write run-detail section (ref write-safety §4.1) leaks no direct identifier or permanent key into the served bytes |
| `queue-row-actions.test.ts` | negative | queue-row action descriptors — the per-status set serves delete on every terminal row and on no other, never for a delegated child |
| `queue-row-subject-title.test.ts` | negative | the subject-derived queue-row title (ref dashboard-surfaces §1.2) keeps the start-input title while the declared node has produced no checkpoint |
| `request-identity.test.ts` | negative | BFF request identity refuses a configured actor id or extra identity field outside solo mode |
| `run-comparison.test.ts` | negative | run receipt comparison query emits one typed refusal for every expected D289 identity, cardinality, and registry failure |
| `run-detail-captures.test.ts` | negative | DCA3/D292 run capture authority refuses an empty verified capture index rather than projecting a plausible empty receipt |
| `run-detail-gate-outcome.test.ts` | negative | D237 — a settled gate's panel names the verdict, the approver and the instant serves a REJECTION as a rejection — a receipt that could only describe approvals is not a record |
| `run-detail-step-omission.test.ts` | negative | run detail under step omission (D307) refuses to call a done run with an omitted step verified-done |
| `run-detail-timeline-categories.test.ts` | negative | D225 — the descriptor's declared timeline REFUSES a declaration that leaves a node out, naming the node |
| `run-detail-timeline-collision.test.ts` | negative | D258 — a pre-D214 run with two executions at one span identity PARSES, where the whole wire used to be refused |
| `run-detail-timeline-duration.test.ts` | negative | a timeline event's own measured duration reports a step still in flight as absent, naming the missing end |
| `run-queue-projection.test.ts` | negative | THE run/queue projection (D81) stays loudly degraded when the JSONL itself is corrupt |
| `run-status-derivation.test.ts` | negative | D268 — one run-status derivation agrees on cancelled for a run whose span ended discarded before authority settled |
| `settings-facts.test.ts` | negative | settings facts — system hosts (SE40) names no test host when the deployment provisions none |
| `start-plan-omissions.test.ts` | negative | start plan step omissions (D307) refuses invalid facts before a plan row, a run identity or a transaction exists |
| `verified-byte-response.test.ts` | negative | verified byte response lease failures disposes after takeBody rejects and preserves that primary failure |

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
