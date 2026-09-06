# Task 2-2 · Implement the settings catalog and protected root
<!-- roadmap: p1f-settings-store -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** NEW `src/domain/config/catalog.ts` (the closed 88-row registry, §D331.1/§D331.9);
`src/domain/config/{schema,resolve,provenance,settings,snapshot,snapshot-generations,runtime-generation}.ts`
(A4 deleted: `CONFIG_ENV_BINDINGS`, the env application and the `"env"` provenance arm gone, `resolveConfig`
deleted with its thirteen importers, `settings > default`; `operator.timekeeperName` leaves `ConfigSchema`
under generation 5's retirement arm); `src/infra/config/settings-file.ts` (the `settings/` root: two
documents, one lock, prepare/rollback per target, the private-file protocol, the D321 coupling per
document); `src/server/settings-runtime.ts`, `src/server/settings/**`, the existing
`src/server/dashboard/commands/settings-service.ts` adapter, `src/domain/dashboard/bootstrap.ts` +
`src/server/dashboard/queries/bootstrap.ts` solely for P14's schema hashes (source-owner paths
corrected during C858cc3dc R03 verification, 2026-09-04), the kernel's
`apply-protected-settings` arm (§D331.5's two CAS arms, marked envelope, `{present, valueId, updatedAt}`
readback); `src/domain/secrets.ts` (A5 deleted: migrated names read from the protected store only, the
`config-and-secret` dual channel gone, `providerModelChain`'s `legacyModelEnv` fallback gone,
`optionalTestTargetSecret` from the store); `src/domain/runtime-environment.ts` +
`scripts/secure-env-bootstrap.ts` (`RETIRED_ENVIRONMENT_KEYS` refused by name; the `.env` allowlist is the
five provider families); `src/domain/runtime-dependencies.ts`; `src/infra/sqlite/backup-service.ts` +
`recovery-contracts.ts` for the `manifestVersion` 2 WRITE shape only (the two ordinary documents plus
protected presence metadata, P15 — the READ widening is Task 6's); the nine `resolveConfigWithProvenance`
call sites, minimally (the `env` argument drops); `tests/unit/architecture/settings-catalog.test.ts` with
its `active` inventory entry and the `config-snapshot-generations` entry's invariant text extended for the
`retired-leaves-are-a-closed-list` arm (same commit as P38); P39's sixteen deliberately edited files;
`src/dashboard/surfaces/settings-model.ts`, `src/dashboard/surfaces/settings.tsx` and their focused tests
only for the D331.5 request-shape transition below. **Does not touch:** `migrations.ts`,
`authority-database.ts` (Task 1 landed the singleton), the run-record service, the worker loop, or the
Settings SURFACE beyond the approved producer-only exception: translate the existing draft to D331.5's
leaf operations and remove the impossible `env` provenance branch, with no DOM, copy, style, served
inventory or parity-reference change. The full Settings/Setup interface remains 3.1; the settings-editor
query keeps serving DCC3's eight-leaf inventory derived from the catalog until then (A8). **Owes:**
§D331.11 P1–P15, P17–P19, P21–P32, P33's protected half, P34–P39,
P41; §D332.11 M14's schema half (generation 5 registered; a pre-floor snapshot with the leaf parses).
**Gate:** base + those proofs + `npm run test:parity` green UNCHANGED. **Deletion tests:** P3/P4 (A4 —
compile-time red at every caller, runtime red under a hostile `process.env`), P34 plus the
`secrets-single-source` WRITE arm (A5), P38's negative control (A7's arm `retired-leaves-are-a-closed-list`
on the existing `config-snapshot-generations` entry). **Order:** wave 2, peer 2.

- [x] The catalog, the `.tracker/settings/` root with two documents and one lock, the two CAS arms,
  write-only protected values with presence/revision readback (§D331.1–§D331.6; P1, P2, P5–P12, P21–P32).
- [x] The environment leaves the resolver and the accessors in THIS task — A4 and A5 are deleted with the
  catalog, not carried; every migrated key is `RETIRED_ENVIRONMENT_KEYS`; provider API keys alone stay in
  `.env` (§D331.8; P3, P4, P34, P35).
- [x] Host-derived display as the catalogued default (P36), credentials and canary references in the
  store (P32), permissions/symlink/redaction/restart-scope/concurrent-update proofs (P13–P15, P17–P19,
  P22–P25, P33 protected half, P37), generation 5's retirement (P38), P39's deliberate edits, P41.

#### Approved focused-session plan (2026-09-04)

**Outcome and exclusions.** One supervisor implements the complete D331 settings authority and the
Task-2-2 portions of D332 without redesign: the 88-row catalog; catalog-derived ordinary schema;
environment-free resolver; generation-5 retirement; the two-document `.tracker/settings/` repository;
ordinary/protected CAS commands and presence-only readback; A4/A5 retirement; provider-only `.env`;
backup-manifest-v2 write/verification; and D183 dispositions for every new served leaf. The narrow `/ui`
Operate-mode exception above keeps the existing eight-leaf page functional while the wire changes. It
does not implement 3.1's expanded Settings interface. Task 5 still owns full composition/runtime
consumer cutover; Task 6 owns pre-floor upgrade/read widening; no real `.env`, `.tracker`, browser or live
system is touched.

**Verified prerequisites.** Task 1's schema-floor proof merge `5b1fb626` is an ancestor of the current
integration line; `d2fe05dd` was the prior common wave baseline, and runtime source has not changed since
that baseline. Snapshot `02942b40` is incomplete historical implementation evidence only: inspect and
reuse reviewed current-contract hunks, never cherry-pick it wholesale or import its deleted coordinator
artifacts. Before either wave peer starts, integrate the approved 2-1 and 2-2 plans on `master`, record
that exact common SHA, and recheck the worktree path, branch and four-worktree repository budget.

**Implementation sequence.** The supervisor keeps the cross-layer judgment and performs these steps in
order:

1. Verify the common wave base, Task 1 floor/singleton, exact owned paths, proof ledger and snapshot
   limits. Establish synthetic private roots only.
2. Land the catalog, generated ordinary schema, host-display fact input, settings-over-default resolver,
   and generation-5 retirement. Remove the resolver's environment parameter and adapt every compiler-
   discovered caller in the same change.
3. Land the protected schemas and shared settings root: two documents, one lock/reaper, per-target
   prepare/rollback, private-file admission, independent revisions, D321 journal coupling and both CAS
   arms. Add the marked protected command, presence-only readback and schema hashes.
4. Move migrated credentials, canaries, model chains and other operator-managed leaves to their single
   catalogued authorities. Refuse every migrated environment name before value access and retain only
   the five provider-key families in `.env`.
5. Add manifest-v2 write and current-v2 verification for the two ordinary files plus protected presence
   metadata. Preserve manifest-v1 and pre-floor compatibility for Task 6's bounded read widening. Add
   every required D183 disposition.
6. Apply the producer-only UI adaptation with no rendered/reference change. Complete the assigned proof
   and intended-red matrix, regenerate the build manifest, run the gates, commit the exact candidate and
   record `awaiting independent review` without marking the task complete.

**Acceptance.** Map §D331.11 P1–P15, P17–P19, P21–P32, P33's protected half, P34–P39 and P41, plus
§D332.11 M14's schema half, to a real test and intended-red oracle. P16/P20 remain Task 5; P40 remains
3.1; Task 6 retains full upgrade and pre-floor manifest reading. Run the focused settings/config,
command, bootstrap, backup, redaction, activity-export, diagnostic, worker/dry-run and snapshot tests,
then:

```text
npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check
npm run test:architecture
npm run test:parity
```

Parity must pass unchanged. Any needed contract change returns to a newly numbered 0.3 task. Any test
run is paired with lint, and generated descriptor closure changes use `npm run build:manifest` before
the check.

**Supervisor sizing and wave assignment.** One supervisor fits because the catalog, file authority,
command schemas and proof matrix form one coupled authority seam; a second supervisor would overlap the
central schemas, settings repository and acceptance tests. Task 2-1 remains an independently planned
peer, not part of this assignment. File isolation does not isolate fixed ports or test artifacts, so the
two peers serialize full coverage, architecture and parity runs.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.2-2` | `codex/phase-1-6-settings` | `/Users/julianhein/Projects/hr-worktree-settings` | Verified common `master` SHA containing Task 1 and both approved wave plans; record it before either peer starts | Task-2-2 seam above; synthetic settings roots only; no real runtime or live state | Assigned proof matrix; focused suites; full gate, architecture and unchanged parity | Freeze the independently reviewed candidate. Task 2-1 receives PASS and merges first. The 2-2 supervisor then merges `--no-ff` to `master`; behavior-changing conflict fixes require renewed review. Run integration gates, remove this worktree and local branch, record review/merge/gate/cleanup evidence, then mark only Task 2-2 complete. |

#### Task 2-2 completed (2026-09-05)

Task 2-2 is implemented on `codex/phase-1-6-settings` at final revised immutable implementation
candidate `0e38b82f`. The first fresh independent review returned `CHANGES REQUIRED`; all six findings
have regression proofs and fixes. Its renewed review closed those six findings and returned
`CHANGES_REQUIRED` for two newly exposed issues; both have fixes and proof. Its second renewed review
closed those eight findings and exposed one request-admission ordering defect; that finding now has a
pristine-root kernel proof and fix. Its third renewed review closed those nine findings and exposed one
mixed-failure ingress-precedence defect; that finding now has BFF proofs and a fix. The final renewed
review accepted the immutable candidate. It merged without a behavior-changing conflict and passed the
required integration gates. The planned candidate worktree and branch are removed; the temporary
integration worktree and branch remain only until `master` advances to this completion record.

| Evidence | Result |
|---|---|
| Plan and common base | PASS — approved Task-2-2 plan `0d2520f7`; common wave base `aaffe367`, containing Task 1 and both approved wave plans |
| Required peer order | PASS — accepted Task 2-1 completed on `master` at `a5afdb07`; merged into this branch as `57ad0653` before the combined gates |
| Initial candidate commits | `8c9cedd7`, `2945cfea`, `e874505c`, `87118792`, `fa93a623`, `2cd0029f`, `a3305537`, `4fe9c24d`, `4016e2af`, `15bb3c2b`, `01385201`, `f944a2ab`, `fd5f860c`, `d3ac830c`, `e1d9f008`, `8f8777e4` |
| First independent review | `CHANGES REQUIRED` — fresh read-only reviewer `/root/sup_review_settings_2_2` (`sup_review`) reviewed plan `0d2520f7`, base `aaffe367`, Task-2-1 merge `57ad0653`, implementation `8f8777e4` and evidence `5a48faf6` |
| Finding dispositions | `f8ea3551` authenticates protected authority before mutation; `1b877014` returns the assigned value-free settings ingress refusals; `866cbf1f` makes the settings-consumer guard bidirectional; `595647fb` binds backup files to one authenticated SQLite snapshot, materializes both revision-1 files, validates patch leaves and maps merged cross-field failures |
| First renewed review | `CHANGES_REQUIRED` — the same read-only reviewer reviewed implementation `595647fb` and evidence `d0a39d86`; all six prior findings closed, but an exact crash-left protected retry journaled before reconciliation and backup added a second unapproved `AuthorityDatabase` lookup seam |
| Renewed-review dispositions | `711ea001` adds a real child-process `SIGKILL`/kernel-retry regression and reconciles the protected prepare before journal insertion; `54a2f5ed` removes the extra database method, uses three explicit read-only copied-backup audit checks, and pins those checks without weakening the command-write or layering guards |
| Second renewed review | `CHANGES_REQUIRED` — the same read-only reviewer reviewed implementation `54a2f5ed` and evidence `3664b01a`; all eight prior findings closed, but stale protected schema input reached reconciliation before pure request admission and could materialize a pristine settings root |
| Second renewed-review disposition | `28109529` exposes and reuses the protected authority's pure admission before reconciliation; its kernel regression proves exact `schema-mismatch`, zero authority reads, no pristine-root materialization and no SQLite command/audit/current mutation |
| Third renewed review | `CHANGES_REQUIRED` — the same read-only reviewer reviewed implementation `28109529` and evidence `39aedaeb`; all nine prior findings closed, but mixed invalid leaf requests could outrank stale schema or ordinary patch-fingerprint refusals at BFF ingress |
| Third renewed-review disposition | `0e38b82f` centralizes raw ordinary patch fingerprint derivation and applies schema/fingerprint precedence before leaf classification; three BFF regressions prove the ordered refusal and zero authority effects for mixed failures |
| Accepted review | PASS — the same fresh read-only `sup_review` reviewer reviewed immutable implementation `0e38b82f` and evidence `a2f19bd0`; no findings and all ten prior findings closed |
| Final revised candidate commits | `f8ea3551`, `1b877014`, `866cbf1f`, `595647fb`, `711ea001`, `54a2f5ed`, `28109529`, `0e38b82f`; final implementation head `0e38b82f` |
| Authorized ownership amendment | Operator selected option A: Task 2-2 may add the transaction-safe, read-only historical protected-command `writeId` lookup in `src/infra/sqlite/authority-database.ts`. `d3ac830c` supplies it, strict request validation, restart/non-adjacent reuse proof and production dashboard composition; no other Task-1/Task-2-1 ownership moved. |
| Full revised gate | PASS — typecheck; lint; coverage 5,178 tests with all ratified floors passing; build-manifest check |
| Supplemental gates | PASS — architecture 74 files / 754 tests; parity 269/269 |
| Focused revised proof | PASS — combined settings, backup, config, command, ingress, catalog, composition and recovery suites: 10 files / 503 tests; exact lint, typecheck and `git diff --check` clean |
| Parity provenance | The combined manifest changed descriptor and implementation fingerprints. `8f8777e4` refreshes only the resulting hash/provenance fields and hash pixels: 210 accessibility references, 210 metadata references and 31 PNGs. Audit found no DOM, copy, control, layout or style change. |
| Isolation | PASS — synthetic empty ignored mode-0600 `.env`; no real `.env`, `.tracker`, live state, browser transaction, submit or push touched |
| Integration | PASS — accepted evidence head `e1cfb9bd` merged `--no-ff` as `33d6a6e9`; merge parents are prior `master` `fbc23dc1` and accepted candidate `e1cfb9bd`; no behavior-changing conflict |
| Integration gates | PASS — typecheck; lint; coverage 5,178 tests with every ratified floor passing; build-manifest check; architecture 74 files / 754 tests; unchanged parity 269/269; roadmap current |
| Cleanup and preservation | PASS — `codex/phase-1-6-settings`, `/Users/julianhein/Projects/hr-worktree-settings` and the temporary integration worktree were removed; the dirty primary checkout retained its exact pre-integration status and unstaged/staged content hashes; no push |

Status is `complete`. Fresh independent review accepted the candidate after all ten findings were
resolved; the required merge, integration gates and cleanup are complete. Task 3 integrates afterward.
