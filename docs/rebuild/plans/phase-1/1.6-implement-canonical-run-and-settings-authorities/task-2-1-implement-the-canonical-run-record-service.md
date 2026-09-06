# Task 2-1 · Implement the canonical run-record service
<!-- roadmap: p1f-run-store -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** NEW `src/core/run-record-service.ts` (the §D330.5 operation set with its closed refusal union
and the canonical owner of lifecycle mutations; Tasks 3/4 cut over the remaining callers and activate
§D330.10's ONLY-caller guard); `src/infra/sqlite/run-store-contracts.ts` (strict request/result schemas,
including the required full claim token and named claim refusals); the lifecycle repositories in
`src/infra/sqlite/authority-database.ts` over `tasks` / `archived_runs` / `deleted_runs` (create with the
two-source watermark and the tombstone check; `claimNext` with the token REQUIRED IN FULL, the dependency
and disposition predicates and the §D330.6 order in one write transaction; `renewClaim`;
`workerTransition`; the composite `terminalize`; `requeue`; `archive`; `delete`/`deleteArchived` with the
member tree leaves-first, gate records, tombstone-first and `ordinal_source = tombstone`; `read` three-way;
`list` ordered; as-built throws converted to named refusal arms); `src/domain/authority.ts` run-record
types (existence union and refusal union); `src/domain/run/record.ts` (the actual strict persisted
`RunRecordSchema` owner, including the fields D330 requires such as `cancelRequested`; source-owner
path corrected during C858cc3dc R02 verification, 2026-09-04, without a contract change);
`src/domain/commands.ts` and `src/infra/sqlite/storage-records.ts` only for D333's strict internal
lifecycle-journal record arm and table-schema union (operator-approved during S2; product commands,
the command kernel and DDL remain unchanged);
`src/infra/sqlite/migrations.ts` for ONE additive `v31` migration only (rebuild the
`archive_relaunches` source relation so deleting an archived source preserves a live descendant's
lineage, while the row remains owned/deletable only by its NEW run, exactly §D330.9); the generated
`src/domain/workflow/generated-build-manifest.ts`; `tests/unit/run-record-service/`.
**Does not touch:** any migration except the admitted `v31`, any composition root, the command kernel,
the queue-root builder, the worker loop,
`src/domain/config/**`, `src/infra/config/**`, `secrets.ts`, the settings runtime (2-2's). **Owes:**
§D330.11 #1–#23, #25, #26 over the real service and a temporary database (never a hand-inserted `tasks`
row, §D330.10); §D331.11 P33's claim half (an absent token refuses, never skips); the table-class
coverage rows extended to every service method (§D330.10); A6 read-forward proven by #25 over
NULL-ordinal rows; direct fresh-v31 and v30→v31 proofs that an archived-source delete preserves the
live descendant's relaunch row and deletion of the NEW run removes it only behind that run's tombstone.
**Gate:** base + those proofs. **Deletion tests:** #16 (every `*_never_deleted`
trigger enumerated at test time — 17 as-built plus the floor's) and #25 (the watermark reads
tombstones; drop the tombstone columns and it is red). **Order:** wave 2, peer 1.

- [x] The service and repository API for the closed operation set with named refusals, three-way
  `read`, ordered `list` and CAS on `version` alone (§D330.2, §D330.4, §D330.5, §D330.6).
- [x] The invariants: one-transaction first-eligible claim with the full token, claim fence vs.
  operator CAS, composite terminalize, retry/restart/relaunch lineages, archive-if-identical, D308 tree
  delete behind the tombstone with gate records and the two-source watermark (§D330.1, §D330.6–§D330.9).
- [x] §D330.11 #1–#23, #25, #26 and P33's claim half, red-capable against the displaced writers; the
  coverage rows for every service method.

#### Approved focused-session plan (2026-09-04)

**Approval and correction.** The operator approved the proposed Task-2-1 plan by requesting its
supervisor prompt, then explicitly chose option A on 2026-09-04 when the feasibility check exposed the
schema conflict: this task owns one additive `v31` migration. The rejected alternatives were a new
serial prerequisite or weakening D330's retained-lineage rule. No other DDL or contract change is
admitted.

**Outcome and exclusions.** One supervisor implements D330's canonical run-record service, its closed
operation/refusal boundary and Task-2-1 proof matrix. The adapter remains the sole SQL owner. The
service accepts an injected post-commit queue-root publisher and proves authority commits before
evidence; it does not import or edit the server builder. Tasks 3/4 retain production caller cutover and
guard activation, so their staged direct callers may compile but no new bypass is added. Task 4 retains
proof #24 and Task 4/3 own full cancellation proof #27. Settings, composition, product commands/the
command kernel, workers, live state and UI remain outside this task. The narrow D333 lifecycle-journal
schemas and table-schema union named in the seam are the sole exception.

**Verified prerequisites.** Task 1's proof merge `5b1fb626` is an ancestor of the current integration
line. The previous R02 launch stopped during intake and produced no candidate; its worktree/branch are
absent. Before either wave peer starts, use the exact `master` commit containing both approved focused
plans as the common base; verify Task 1 ancestry, clean owned paths, worktree capacity, and the absence
of both planned path and branch. Full baseline gates passed at pre-plan `c77d2b76`: 411 files / 5,040
tests, manifest current, and 269 assertion-only parity tests with unchanged references.

**Implementation sequence.** Stable supervisor steps:

1. **S1 — admit the exact base and seam.** Verify the common wave base, Task 1 floor, linked D330/D331
   contracts, current repository/request schemas, proof ledger, exact owned paths and exclusions.
2. **S2 — establish the closed service boundary.** Add strict operation, existence and named-refusal
   types; extend the persisted run record for D330 fields; require the full runtime token; keep later
   production-caller cutover compiling without claiming §D330.10's final guard.
3. **S3 — implement atomic authority behavior.** Extend the adapter/service for create, claim/renew,
   worker/operator transitions, composite terminalize, requeue, retry/restart/relaunch, archive,
   total read/list and D308 tree delete. Preserve attempt on requeue; use task+tombstone watermarks;
   validate parent/retry sources, eligibility, dependencies and disposition; publish the queue root only
   after commit through the injected dependency.
4. **S4 — preserve relaunch lineage through schema and cascade.** Add only `v31`; make
   `archive_relaunches` owned by the NEW run so an archived-source deletion retains its row and a NEW-run
   deletion removes it behind that run's tombstone. Prove fresh and v30 upgrade shapes and fail-loud
   integrity. Do not fold Task 6's stopped-system upgrade command into this migration.
5. **S5 — discharge the proof matrix.** Use the real service over temporary databases for D330.11
   #1–#23, #25, #26, P33's claim half, every-service-method table-class coverage, A6 NULL-ordinal
   read-forward and the red controls for #16/#25. Fixtures create lifecycle state through the service,
   never hand-insert `tasks` rows.
6. **S6 — freeze the candidate.** Regenerate the build manifest, run focused and full gates, inspect
   exclusions, commit exact owned paths by logical category, then record the immutable candidate range,
   gate evidence and `awaiting independent review`. Stop; do not merge, push or mark the task complete.

**Acceptance and gates.** Every caller-known refusal returns a closed result rather than throwing; each
mutation is one authority transaction and advances authority generation exactly once; read/list are
total and ordered; claim, lineages, archive/delete, ordinals and evidence ordering match D330. Use real
temporary SQLite authorities and map every assigned proof name to its intended-red oracle. Run focused
run-record, migration, storage and table-class suites, then:

```text
npm run build:manifest
npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check
npm run test:architecture
npm run test:parity
```

Parity must pass unchanged. Any test run is paired with lint. A needed contract change returns to a
newly numbered 0.3 task; a behavior-changing conflict fix requires a renewed independent review.

**Supervisor sizing and wave assignment.** One supervisor fits: service API, adapter transactions, the
single coupled lineage migration and proof family require continuous lifecycle judgment. Splitting them
would create overlapping ownership in `authority-database.ts`, schemas and tests. Task 2-2 is an
independent peer. The peers use separate worktrees and serialize full coverage, architecture, parity,
roadmap generation and integration. Generated-manifest conflicts are resolved only by regeneration from
the combined tree, never by hand-editing generated output.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.2-1` | `codex/phase-1-6-run-record` | `/Users/julianhein/Projects/hr-worktree-run-record` | Verified common `master` SHA containing Task 1 and both approved wave plans; record it before either peer starts | Task-2-1 seam above, only additive `v31`, temporary SQLite roots and injected test publishers; no real runtime/live state | Assigned proof matrix; focused migration/run/storage suites; full gate, architecture and unchanged parity | Freeze the independently reviewed candidate. The 2-1 supervisor merges it first with `--no-ff` to `master`, runs integration gates, removes this worktree/local branch, records review/merge/gate/cleanup evidence, and marks only Task 2-1 complete. Task 2-2 then integrates; its supervisor regenerates the combined manifest and runs its own merge gates. |

**Task 2-1 completed (2026-09-04).** The independently accepted immutable implementation candidate is
`bc82fe47e9ee51e3ec46b15eb51367a124c463bb`, range
`aaffe367084c95e06606a3b42cb058b541acd1a8..bc82fe47e9ee51e3ec46b15eb51367a124c463bb`,
on `codex/phase-1-6-run-record` in `/Users/julianhein/Projects/hr-worktree-run-record`. The exact base
remained reachable from `master` and contained Task 1 merge `5b1fb626` plus both approved wave plans;
the primary checkout was not used. The implementation commits are `c291dc30` (canonical service and
D333 journal arm), `423c3a7a` (the sole additive v31 migration), `0146a2a6` (proof matrix),
`a060b4f8` (first-review corrections), `52942ebd` (parked-write continuation correction), and
`bc82fe47` (fail-loud gate-resume metadata correction).

| Candidate evidence | Result |
|---|---|
| Initial independent `/review` by `/root/sup_analyst_run_record_review` at `0146a2a6` | CHANGES REQUIRED — parked-gate continuation was lost; terminalization missed active descendants; distinct terminal self-edge/rename remained mutable |
| Red-capable corrections | PASS — each finding reproduced before correction; parked continuation, direct/nested tree settlement and terminal self-edge/rename now have five public-service regressions |
| Renewed independent `/review` by the same reviewer at `a060b4f8` | CHANGES REQUIRED — canonical `parked-write → queued` could not carry its mandatory continuation node; the three prior findings remained resolved |
| Parked-write correction | PASS — both write-resolution arms and the no-continuation mutant failed before correction; canonical CAS-fenced resume now requires and persists `startAt`; direct Task-3 callers remain untouched |
| Renewed independent `/review` by the same reviewer at `52942ebd` | CHANGES REQUIRED — gate resume accepted queued metadata that its adapter then discarded; every prior finding remained resolved |
| Gate-resume correction | PASS — the lossy request failed before correction; gate resolution now returns named `illegal-transition` without writing when queued metadata is present |
| Final independent `/review` by `/root/sup_analyst_run_record_review` at `bc82fe47` | PASS — high confidence; all prior findings resolved; no new correctness, concurrency, security, documentation or scope finding |
| Focused run-record service | PASS — 40 tests; typecheck and lint green |
| `npm run build:manifest` | PASS — regenerated byte-identically |
| `npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check` | PASS — 5,082 tests; 85.48% statements, 76.31% branches, 89.53% functions, 87.55% lines; manifest current. An earlier unrelated 16-process storage-lock timing assertion failed once, passed focused, and passed in both later complete reruns |
| `npm run test:architecture` | PASS — 73 files / 745 tests |
| `npm run test:parity` | PASS — 269 tests; assertion-only references unchanged |
| Scope/exclusions | PASS — only the recorded Task-2-1 seam, D333 exception and one v31 migration changed; no Tasks 3–4, settings, live state or push |
| Integration | PASS — candidate evidence commit `bb98dabc` merged `--no-ff` to `master` as `49120609`; the merge parents are prior `master` `94d70886` and accepted candidate `bb98dabc` |
| Integration gates | PASS — manifest regenerated byte-identically; typecheck and lint green; 5,082 coverage tests at 85.48% statements, 76.31% branches, 89.53% functions and 87.55% lines; manifest check green; architecture 73 files / 745 tests; unchanged parity 269 tests |
| Cleanup and preservation | PASS — `codex/phase-1-6-run-record`, `/Users/julianhein/Projects/hr-worktree-run-record` and the temporary integration worktree were removed; the dirty primary checkout retained its exact pre-integration status and unstaged/staged content hashes; no push; Task 2-2 remains unintegrated |

Status is `complete`. Fresh independent review accepted the final behavior-changing correction before
integration; the required merge, integration gates and cleanup are complete. Task 2-2 integrates afterward.
