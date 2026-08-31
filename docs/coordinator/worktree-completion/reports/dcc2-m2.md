# DCC2 M2 — invariant disposition

Read-only `sup_analyst_dcc2_m2_invariant_disposition` (Terra/high), 2026-08-30. No files/index/test or external state changed by analyst.

## Decision

Merge frozen `13175b13340fec7b5326207fe54f98078d481d7d` into DCC2 using `--no-ff --no-commit`. Keep baseline's sole preflight authority/executor and actual-settlement semantics; transplant only required unique hardening. Pin resolved candidate tree for independent review. Heavy gates require coordinator slot; commit only after gates.

| Seam | Disposition | Required result |
|---|---|---|
| Timeout/settlement | Conflicting; baseline owner governs | Keep baseline `src/domain/preflight.ts` executor/authority. Abort on deadline, await actual settlement, reject late healthy result. Remove alternate `src/core/preflight-executor.ts` and `src/server/dashboard/preflight-authority.ts` implementation, not merely their call sites. |
| Authority location/replay | Superseded | One baseline `createPreflightAuthority`, baseline bootstrap composition, exact command-id replay/CAS. No second server authority. |
| Rerun ingress | Missing in baseline | Preserve branch Host/Origin loopback validation, bounded streamed JSON, distinct 400/413 refusals, rate limit, single active admission in baseline route. Hold admission until baseline authority settles. |
| Vite ownership | Missing in baseline | Preserve branch nonce proof in dev-dashboard script, Vite config, domain/dashboard-frontend-owner, infra/providers/local-vite-probe; adapt baseline server/preflight/dashboard-runners and composition. Marker-only foreign listeners refuse. |
| Preflight redaction | Missing in baseline | Port branch closed safe reason-code behavior for runtime/filesystem/process-lock failures. Never append caught raw messages. |
| Storage traversal/stream diagnosis | Missing in baseline | Preserve branch descriptor-relative no-follow bounded traversal and explicit span_stream diagnosis in storage-doctor, authority-database and recovery-contracts. No authority substitution. |
| Reverse missing-span | Missing on branch | Preserve baseline check of every current live authority run against queued roots, alongside branch stronger corpus validation. Entire-directory absence alone is not sufficient. |
| Storage-wire redaction | Conflicting; baseline protection governs | Keep baseline StorageDiagnosticMessageSchema and storage-doctor redaction-audit dispositions while adapting richer branch wire arms; plain z.string summaries insufficient. |
| Settings/Explorer/reporting/UI | Superseded | Preserve all newer baseline routes, command composition, clients, docs, tests and current UI. No branch reversions. |

## Exact evidence

- Frozen `clock-config-secrets.md:1003-1006,1059-1070`: timeout aborts but awaits actual detector settlement; refresh awaits all selected detectors.
- Frozen `src/domain/preflight.ts:66-121,300-330`: governing executor and authority; ordered aggregate failures.
- Frozen `tests/unit/preflight-runtime-dependencies.test.ts:420-523`: no detached sibling and no prompt return after deadline.
- Branch `src/core/preflight-executor.ts:65-96` and `tests/unit/preflight-runtime-dependencies.test.ts:705-725`: immediate timeout response; branch authority `88-118` holds admission separately. This is different behavior, not equivalence.
- Branch `src/server/dashboard/routes/api.ts:100-270`, `tests/unit/server/bff-flow.test.ts:326-492`: ingress/body/rate/admission safeguards; frozen route `158-162` only parses JSON and dispatches.
- `docs/rebuild/reference/dashboard-surfaces.md:221-236`: D282 forbids weakening queue refusal or substituting authority.
- Frozen `src/infra/sqlite/storage-doctor.ts:354-378`: reverse current authority-to-span missing check.
- Branch `storage-doctor.ts:562-634`, `authority-database.ts:1877-1980`: roots resolved forward without reverse per-live-run diagnosis.
- Frozen `src/domain/dashboard/storage.ts:92-129` versus branch `18-110`: baseline diagnostic-message restriction must not be deleted.

## Conflicts and confidence

High confidence. Timeout is a substantive behavior conflict resolved by the frozen normative owner, not taste. Storage wire is technical reconciliation: preserve richer span_stream diagnosis plus baseline reverse check and redaction. No operator call required. Only a newer ratified owner changing timeout semantics or D282 would alter this disposition.

M1 consulted via durable report; no new agents. Supervisor independently observed the normative timeout text before dispatch and verified intake focused tests (47 preflight + 97 storage), typecheck and lint. Those gates establish initial coherence, not merged correctness.

