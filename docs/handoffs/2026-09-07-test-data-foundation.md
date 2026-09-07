# Test-data foundation detour — approved execution handoff

Approved by the operator on 2026-09-07 after choices 1 B (full consolidation), 2 A
(tracked shared configuration plus ignored private configuration), 3 A (verified one-time
migration), and approval of the complete six-step proposal. This is one detour before Task 1.6.7,
not a new numbered phase. Planning only has been performed; implementation and review are unrun.

## Authority and handoff lifetime

The operator explicitly requested this temporary handoff as the execution-plan owner instead of
a new phase task. The durable requirements are [configuration ownership, D341](../rebuild/reference/clock-config-secrets.md#d341--test-inputs-have-a-separate-owner)
and [testing, §10.5](../rebuild/reference/guards-and-tests.md#105-the-subject-registry--labels-in-the-repo-values-outside-it).
The [Task-1.6.7 owner](../rebuild/plans/phase-1/1.6-implement-canonical-run-and-settings-authorities/task-7-close-the-rebuilt-foundation.md)
owns its dependency and resume boundary. Do not duplicate this assignment into a new phase document.
The detour supervisor owns cleanup: remove this exact handoff only after accepted integration,
required gates, and transfer of completion/proof/remaining-prerequisite facts into §10.5 and Task 7.
Until then it must remain available; consuming the instructions alone does not authorize deletion.

## Assignment and verified Git state

| Assignment | Execution mode and branch | Absolute worktree | Base/prerequisite | Integration and merge condition |
| --- | --- | --- | --- | --- |
| `test-data-foundation` | Create dedicated worktree; `codex/test-data-foundation` | `/Users/julianhein/Projects/hr-worktree-test-data` | The committed approved planning record containing this handoff, reachable from local `master`, descended from `4895bbfead33746682f8ef591d4b3a8e44a4b32e`; preserve Task-6 completion `2875f4e315f8bc56abc4e9dd7574f169cfaae5c2` and integration `440013f193d7f3451828cbc740591248139db077`. Resolve the full plan SHA from the launch prompt and verify file contents. | Supervisor integrates into `/Users/julianhein/Projects/hr-automation-rebuild`, local `master`, with `--no-ff` only after complete independent PASS and candidate gates. Re-review behavioral conflict fixes; run required integration gates, record evidence, remove only this assignment's worktree/ref. No push. |

At planning, the primary checkout was clean on `master` at `4895bbfea`. The proposed detour
branch/path were absent. These are observations, not reservations; recheck refs, worktrees, dirty
ownership and capacity before creation. Do not create implementation checkouts during planning.

The existing `/Users/julianhein/Projects/hr-worktree-foundation-close` belongs to Task 1.6.7,
branch `codex/phase-1-6-foundation-close`, at `3bb9abdb35396250fc260351a05ca9f1c82be41d`.
Its only observed dirty state was its own untracked
`docs/handoffs/2026-09-07-task-1-6-7-preflight.md`; no implementation commit or candidate existed.
It is paused at prerequisites. Do not edit, delete, reset or repurpose that checkout or its handoff.
Its owner must verify and bring it forward to the integrated detour plus amended Task-7 plan before
resuming; the older handoff's database and input-source assumptions are superseded.

One supervisor implements all coupled seams and integrates. No implementation workers are assigned.
One fresh native `sup_review` reviewer (Sol, high) independently reviews the complete frozen candidate,
including migration, privacy, fixture accounting, actual-target evidence, plan changes and gates.
The supervisor fixes findings locally, renews review for affected behavior, and finalizes in the same
session. No sibling task, coordinator, next-phase dispatch or automatic task creation is authorized.
Send Done / Now / Remaining at start/resume and after each verified step, before the next tool call.

## Actual-target evidence and rechecks

The sole actual target is `/Users/julianhein/Projects/hr-automation-rebuild/.tracker` and the private
test configuration beside that checkout's tracked configuration. Never copy credentials, `.env`,
auth profiles, operator documents or the operator root into a worktree or fixture.

| Boundary | Verified 2026-09-07 | Required pre-effect recheck |
| --- | --- | --- |
| Operator database | Operator explicitly requested and this planning session completed a reset: fresh schema 32; all run/runtime tables empty; only schema metadata and the fresh-baseline marker populated. Doctor exited 0: integrity valid, zero foreign-key violations, reconciled zero runs/spans, all pending counts zero. Old run spans, artifacts and the old authority backup were removed. Credentials remained byte-identical; ordinary settings were already defaults. | Doctor, exact root/schema/identity, all relevant counts, and stopped-process/lock observation. No repeat reset and no new backup merely because none exists. If new run data exists, stop before any conversion that assumes emptiness; do not silently discard it. |
| Private credential source | `.tracker/credentials/protected.json`, mode 0600, document/record version 1, revision 2, one history entry and an upgrade binding. Current names: UCPath user/password, timekeeper, roster URL, and Separations canary. Person-lookup canary absent. Only names/shape were inspected. | Authenticate the old private document and identity history through a strict migration-only reader; recheck permissions, no symlinks, source identity/bytes, no concurrent credential writer, and destination state. Never emit values or value-derived fingerprints. |
| Runtime environment | Latest name-only check found only `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` remaining from the previously reported nine retired names. | Normal startup must continue refusing retired names. The detour must not import a canary from `.env` or rewrite `.env`. Task 1.6.7 retains operator cleanup before normal runtime. |
| Live targets | Separations current value exists in credentials; presence does not prove the previously selected replacement was applied or remains available. Person-lookup input is not provisioned. | Migration preserves exactly the authenticated current input. Readiness reports absent/blocked honestly. Task 1.6.7 owns private provisioning/selection confirmation, current-world verification and both live runs; these are not blockers for offline detour implementation or private-file conversion. |
| Existing fixture estate | 94 files matched shared-fixture imports in the planning inventory. Shared data exists in `tests/fixtures`, `tests/unit/fixtures`, parity helpers and the performance fixture. No tracked PDF/XLSX/CSV/TSV assets were found. | Account for all current consumers and classify data versus behavioral helpers/assertions. Counts are discovery observations, not floors or a fixed allowlist. Build one synthetic PDF-path example; do not fabricate a private document collection. |

Storage/check/migration entrypoints must be usable without reading `.env`, launching a browser,
calling providers or starting a dashboard. If a new CLI/bootstrap admission is needed, admit only
these exact test-data operations with tests proving their zero-effect boundary; do not weaken
normal runtime environment admission. Proposed commands are recorded below as implementation
deliverables, not commands that already exist.

## Ordered steps and ownership

### TD1 — shared configuration and one typed reader

- Add `config/test-data.json`, ignored `config/test-data.local.json`, and tracked
  `config/test-data.local.example.json` containing no actual private values.
- Move the existing public subject registry into the shared configuration and remove its old
  `config/test-subjects.json` authority. Preserve labels, dated availability, workflow arms, pending
  declarations, usage restrictions and bidirectional manifest correspondence.
- Put strict schemas/types at `src/domain/test-data.ts`, named input loading/resolution at
  `src/control/test-data.ts`, and reuse the existing test-target resolver where its behavior belongs.
  Implementation may split cohesive helpers within these owned seams without creating a second reader.
- Expose shared sample data, named file references and explicit live-subject resolution. Freeze
  shared data; builders return isolated instances. Do not make importing ordinary fixtures read local
  configuration or initialize credentials, providers, browser sessions or authority databases.
- Resolve relative paths against the declaring config file; tracked fixture targets stay within the
  repository, private paths can refer to explicitly configured external documents. Validate before
  consumption; no upward search, hidden primary-checkout fallback, empty-file substitute or CWD default.
- Add test-only `check`/migration composition and a shared test import entrypoint as needed. Prefer
  `npm run cli -- test-data check --json` for shared configuration and named `--subject`/`--file`
  selection for private input checks. Output names/status/reasons only.

### TD2 — separate test inputs from application configuration

- Remove both canaries from `src/domain/config/catalog.ts` (88 → 86), protected-setting patch/readback
  schemas and live application secret registries. Keep operational credentials and timekeeper behavior.
- Rewire `src/control/test-target-registry.ts`, `src/server/dry-run-scenario/{compose,runtime}.ts`,
  the three existing uncollected live manifests and `scripts/smoke-test-target-document-number.ts`.
  Update CLI/bootstrap wiring and registered environment/reader ownership where affected.
- Keep retired environment names explicitly rejected even after their catalog rows disappear.
  Stop deriving retirement solely from the smaller current catalog if that would revive a name.
- Introduce explicit test-config source metadata in `src/domain/protected-input.ts`; update the
  necessary start-admission, redaction, fingerprint, receipt, write-sequencer, archive and rerun consumers.
  Capture a selected private input once with an opaque source identity; retain it through the run.
  No secret-value hash may become a public comparison surrogate. File edits affect later starts,
  never the captured input, consent or evidence of an existing run.
- Existing timekeeper protection remains independent. No old run is available or required to migrate;
  exercise new-run resume/rerun/archive behavior with synthetic records instead. Do not turn the reset
  into a general removal of unrelated historical schemas or write-safety safeguards.

### TD3 — verified one-time private conversion

- Own the current credential format/schema and its narrowly scoped migration reader/writer,
  test-data private-file writer, CLI composition and associated tests. Current credential history is
  strictly replayed against the old schema; removing keys in place is not a valid conversion.
- Produce a test-free current credential representation while preserving operational credential
  values, current value identities and the non-reuse protection for accepted command/write identities.
  A versioned migration baseline plus value-free retired identity records may replace obsolete
  canary-bearing history; never falsify an old command fingerprint or accept an old request as a new
  command. Any retained old reader is migration-only, not a current source or Settings API surface.
- Transfer authenticated current canary values into the private config. Missing destination is
  created privately; equal existing values allow verified idempotent completion; different values,
  malformed files, ambiguous partial state or a changed source stop without overwrite.
- Stage and verify destination before retiring the source entries. Record private resumable migration
  state where necessary, serialize source/destination writers, and verify every uncertain rename/fsync
  boundary before claiming success. Preserve the source until destination verification succeeds.
  Completion leaves no active credential lookup or `.env` fallback for test targets.
- Provide `npm run cli -- test-data migrate --from-credentials --json` as the explicit conversion
  command, anchored to the verified checkout's credential/configuration roots. Its read-only preflight
  mode is `--plan`; both modes report keys/status only and bypass environment loading solely because
  they are transaction-free local test-data operations. Unknown options/targets refuse before writes.
- Prove the conversion using synthetic old documents, including the actual v1/revision-2/history-plus-
  upgrade-binding shape. Existing general upgrade/backup readers must pin the old schemas where
  necessary; a reduced live catalog must not silently drop old inputs or masquerade as their schema.
  Test-target import through retired Settings/environment paths must refuse by name or use the explicit
  verified test-data conversion, never recreate an active Settings entry. Preserve non-test upgrade/
  restore obligations and Phase 2.6's separately scheduled adapter deletion.
- After deterministic candidate proof and independent PASS, perform the approved actual-target
  conversion using the reviewed integrated code from the primary checkout. The command must accept
  the exact rebuild target and emit only sanitized completion/presence evidence. Verify credentials
  unchanged in value and new input ownership, then doctor the database. No browser or live transaction.

### TD4 — complete shared-fixture consolidation

- Inventory reusable data across unit, architecture, structural scenario, parity, performance and
  script consumers. Record each moved/consolidated source and each justified local behavioral helper
  in this handoff while work is active; transfer the concise final ownership map into §10.5.
- Shared fixture data belongs under `tests/fixtures/` with one discoverable import interface.
  Migrate existing consumers, including cross-tier imports from `tests/unit/fixtures`; delete obsolete
  data definitions/re-export shims after migration. Shared configuration supplies reusable inputs,
  not a monolithic collection of every literal in every test.
- Preserve independently specified expected answers, case-specific invalid values, behavioral mock
  helpers and architecture violation fixtures at their owners. Do not compute expected answers from
  the same shared input under test. Preserve synthetic subject rules, dataset sizes, deterministic
  clocks and scenario membership; no real HR values in tracked fixtures.
- Add a minimal synthetic PDF asset and a meaningful consumer proving named path resolution and
  readable bytes. Private PDF paths remain local and missing private data cannot make ordinary
  coverage require a developer's machine. No new PDF extraction feature or private asset ingestion.

### TD5 — finish proofs and reconcile all affected plans

- Complete the proof matrix and gate schedule below. Update current instructions and established
  operating guidance, keeping existing AGENTS/CLAUDE twins identical. D341 is approved target text,
  not as-built evidence, until this implementation is accepted.
- Update the 1.6 overview/Task 7, 2.6, 3.1 overview/Settings task 9-2, 3.2 authoring/acceptance,
  3.3 acceptance and 6F packaged proof to consume the finished foundation. Preserve phase order,
  unrelated completed evidence and separately assigned retirement/controlled-write work.
- Amend configuration/test contracts, environment/guard ownership and guard inventory when a guard
  is actually added or retired. Regenerate manifest/catalog/roadmap only through their commands.
  No new roadmap phase/node is needed; Task 1.6.7 cannot close until this detour is complete.
- Record the database reset as a dated operational fact. Future migration/recovery proof uses
  reproducible synthetic fresh/v29 fixtures, not removed operator data or fabricated historical results.

### TD6 — independent review, integration, actual conversion and cleanup

- Freeze candidate base/head, full changed-input map and gate evidence. Mark awaiting independent
  review, then obtain one fresh complete `sup_review` verdict. Review all TD1–TD5 requirements and
  proof rows, including actual-target feasibility; do not substitute a self-audit or partial PASS.
- Fix findings locally; rerun affected focused/full proof and renew review when behavior changes.
  Integrate `--no-ff` only after PASS and candidate gates. Run integration gates and perform TD3's
  actual-file conversion through that exact reviewed code, then verify the target. A failed conversion
  leaves the detour incomplete; diagnose safely, repair/review/gate if code changes, and retry only
  the explicit idempotent conversion after state is understood.
- Transfer completion, conversion and review/gate identities to the durable contract evidence and
  Task-7 dependency record. Remove the detour worktree/ref and this exact handoff only after nothing
  depends on its unique contents. Do not resume Task 1.6.7 or create its next session automatically.
  The same independent reviewer must assess the sanitized actual-conversion evidence addendum before
  final closure; a pre-conversion PASS alone does not certify that the real conversion succeeded.

## Required proof matrix

| ID | Boundary and proof | Forbidden result |
| --- | --- | --- |
| P1 | Clean checkout with no local config; named shared samples and synthetic PDF usable; mutable fixture copies isolated | Local credential/file access or machine dependence during offline tests |
| P2 | Duplicate/unknown keys, invalid values, unreadable/missing requested file, relative path under changed CWD, separate worktree | Silent override, guessed root, plausible default, cross-checkout private fallback |
| P3 | Label/workflow/kind mismatch; gone/unknown/consumed/pending subject with malformed/unavailable private config; valid available positive control | Private read/browser before availability admission; defect mislabeled as unavailable |
| P4 | Both canaries absent from Settings schema/catalog/readback; retired env injection and retired Settings set operation refused | Second test-data authority or revived environment source |
| P5 | New private-source binding through start/confirm, checkpoint/receipt, public surfaces/logs, resume/rerun/archive; edit source between start and later use | Value/digest leakage, source retargeting, loss of redaction or repeat authorization |
| P6 | Missing/equal/conflicting destination; source changes; failure before staging, after destination settlement, during source retirement; same/different retry | Source destroyed before verification, duplicate overwrite, false success, accepted identity reuse |
| P7 | Real-shaped credential history and upgrade binding; operational credentials and identity fences preserved; old input schemas isolated | Malformed credential authority, rewritten historical fingerprint, general upgrade proof weakened |
| P8 | Full fixture-consumer accounting; unchanged scenario collection, synthetic ranges, performance dataset and relevant rendered scene content | Data duplicated behind shims, assertions removed, expected answers coupled to implementation |
| P9 | Actual reset-root preflight, reviewed conversion, private readback, byte/value-safe credential comparison and healthy doctor | Restored/deleted runs, private values in evidence, invented target availability |

## Gate schedule and reproducible commands

Read D191 and the Task-7 **Gate schedule and review coverage** section. Recreate that exact temporary
two-worker Vitest adapter for this checkout: import its real `vitest.config.ts`, set root and each
project `maxWorkers` to 2, and assert deep equality after removing only those fields. Do not use a
vanished scratch path, a CLI flag that leaves project workers unchanged, or a copied config fork.
Record the adapter hash, imported config identity and verified effective worker count. Rebind it for
integration. All membership, isolation, floors, timeouts and assertions remain unchanged.

| Boundary | Commands and scheduling |
| --- | --- |
| Iteration | Focused new/existing test-data, credential, registry, composition, source-bound identity and fixture tests through `npm test -- --config "$task_gate_config" <exact-file-selectors>`. Record the actual selectors and titles. Group related corrections; no full run per green micro-step. |
| Implementation commits/candidate | `npm run typecheck`; `npm run lint`; then, without compiler/linter contention, `npm test -- --coverage --config "$task_gate_config" && node --import tsx scripts/suite-size.ts`. Generate changed outputs first, then `npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check`. Run `npm run test:parity` after coverage. |
| Candidate feature checks | Implemented shared/private `test-data check` modes, synthetic migration success/failure matrix and negative guards. Prove no local file requirement in the offline gate. Full coverage contains architecture; no duplicate standalone architecture run is required by this new assignment. Task 1.6.7 retains its own explicit standalone requirement. |
| Integration | Re-run the candidate gate family against the merged tree, rebind the adapter, then the approved actual-file conversion/check/doctor. Do not run coverage alongside compiler/linter or parity; serialize mutable generators and their freshness checks. |
| Documentation-only recording | Applicable roadmap-binding/document-link/instruction checks, twin equality/chain size, generated freshness and `git diff --check`. Reuse code evidence only with exact unchanged-input proof under D191; changed behavior invalidates affected gates/review. |

Parity changes are limited to consequences of this approved source/fixture change. Preserve scene
behavior and pixel tolerance; if source fingerprints alone change, verify and review the exact
derived metadata change. No unrelated layout/copy refreeze. Follow `/ui` if an actual frontend
consumer needs editing. Preserve performance fixture output; run the benchmark if its generated
behavior or performance-sensitive implementation changes, not for import relocation alone.

## Stop conditions and exclusions

Stop on foreign ownership, changed actual-root assumptions, active processes/writers, source/destination
conflict, private validation uncertainty, a material new contract choice, or a failing required gate.
Routine file organization and focused fixes remain supervisor-owned. No weakening redaction,
source identity, unknown-write refusal, provider credential handling, coverage or schema checks.
No old run migration, recovery of deleted operator data, `.env` rewrite, broad legacy cleanup,
cutover, UCPath submit, Kuali finalization, additional phase dispatch or push.

## Planning verification

Scoped planning verification passed on 2026-09-07 before the exact-path planning commit:

| Check | Result and tested scope |
| --- | --- |
| `npm run lint` | Exit 0; current executable tree unchanged by this documentation-only plan. |
| Focused two-worker gate | `npm test -- --config "$task_gate_config" tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/architecture/test-target-registry.test.ts tests/unit/architecture/settings-catalog.test.ts`: exit 0, 3 files / 44 tests. Adapter recreated from Task 7’s checked recipe; root and per-project workers exactly 2 with all other config equal (resolved config inspected; adapter SHA-256 `e78b67697168a42a07064cab44f017aff2acc8026c880add48583ed44d3dd6c5`). This proves existing bindings/registry/catalog coherence, not future 86-row behavior. |
| `npm run roadmap` / `npm run roadmap:check` | Generated output refreshed; freshness exit 0. |
| `npm run build:manifest:check` / `npm run stores:catalog:check` | Both current, exit 0. |
| Local documentation checks | 66 existing local link targets resolve; all 9 existing instruction twins equal; largest project instruction chain 15,916 UTF-8 bytes, below 32,768; `git diff --check` clean. |
| Unchanged executable inputs | Compared prerequisite integration `440013f193d7f3451828cbc740591248139db077` to planning base `4895bbfead33746682f8ef591d4b3a8e44a4b32e`: no source/test/script/config/dependency/compiler/runner input differences. This plan changes only instructions, contracts, plans, handoff and generated roadmap. Task-6’s recorded typecheck/full-coverage evidence remains baseline evidence under D191; neither full gate was rerun or claimed as proof of D341. |

No implementation gate, independent candidate review, private migration execution or live acceptance
is claimed by this planning record. The final launch prompt supplies the verified committed plan SHA.
The assignment is ready for implementation once that committed content/base is reverified. Missing
person-lookup input and retired-env cleanup remain Task-1.6.7 live prerequisites, not a reason to skip
this detour’s offline proof or actual private-file conversion. Recheck volatile actual-target facts.

## Execution record (supervisor, 2026-09-07)

Worktree `/Users/julianhein/Projects/hr-worktree-test-data`, branch `codex/test-data-foundation`
from `f68dc9a5b355336d3a755081d8d99ddd7ad9fed3`. Actual root rechecked before any effect (names and
shape only): `.tracker/credentials/protected.json` is schemaVersion 1, revision 2, one history
entry, an applied upgrade binding, five names including the Separations canary and no
person-lookup EID; `.tracker/state.db` is schema 32 with zero commands/audits; no
`config/test-data.local.json` exists. The paused foundation-close worktree was not touched.

**TD4 ownership map.** Moved with `git mv` and importer rewrites (typecheck clean after the move):
to `tests/fixtures/`: `phase1c-contract-fixtures`, `phase1f-run-fixtures`, `receipt-run-fixtures`,
`run-lifecycle-fixtures`, `operator-command-fixtures`, `archive-fixtures`; to `tests/helpers/`:
`phase1f-executor-harness`, `ucpath-termination-fixtures`, `separations-composition-fixtures`,
`kuali-finalization-fixtures`, `duo-ceremony-fixtures`, `protected-secret-source`. Unit-only
modules stay under `tests/unit/fixtures/` and `tests/unit/helpers/` (new: `test-data-source.ts`).
The durable map is `tests/fixtures/README.md`, enforced by the `test-data-ownership` guard.

**Proof matrix status.** P1–P8 proven offline (file map in `ref guards-and-tests` §10.5 completion
record). P9 pending integration. Defects found by the proofs and fixed in the candidate: v2-only
reader in the credential store's pre-rename check; identity-blind under-lock re-plan in the
migration; historical seven-name protected readback rejected by the audit grammar.

**Candidate frozen (2026-09-07), awaiting independent review.** Commits on `codex/test-data-foundation`
above base `f68dc9a5b`: `d69cda56c`, `eec6a9c39`, `ec1a55432`, `e2e6027a0`, then this recording
commit as the candidate tip. Gate evidence and the parity-refreeze classification are recorded in
`ref guards-and-tests` §10.5 (candidate paragraph before the pending review line). Excluded from the
candidate: the paused foundation-close worktree and its handoff, the unrelated stash on master, the
operator root under `.tracker/`, `.env`, and the still-pending Task 1.6.7 live prerequisites
(person-lookup EID input, retired-env cleanup). P9 stays open until the reviewed integration and the
approved private conversion run from the primary checkout.

**Review round 1 (2026-09-07): BLOCKED** on candidate `a97c8832a` — compaction-truncated coverage
plus required findings F1 (pre-D341 protected journal rows unreadable through the live grammar) and
F2 (architecture-helper importer accounting), advisories A1–A4. All fixed in `3a3fa427f`; the
finding ledger and dispositions live in `ref guards-and-tests` §10.5. Round 2 is a fresh complete
review of the whole candidate.

**Candidate refrozen for round 2:** implementation head `3a3fa427f`, gates green (438 files / 5509 tests,
parity 259, no reference change); this recording commit is the round-2 tip.

**Review round 2 (2026-09-07): BLOCKED** on candidate `92bd0883c` — reviewer compaction; no required
finding; P1–P8 recorded satisfied; advisories A5 (registry prose), A6 (unchanged-plan destination
re-verification under the lock) and A7 (decoded duplicate keys) fixed in `63aa8cca6` with tests that
fail against the pre-fix code. Ledger and carried limits live in `ref guards-and-tests` §10.5. Round 3
is a fresh bounded assignment: the fix commit plus the six carried limits.

**Candidate refrozen for round 3:** implementation head `63aa8cca6`, gates green (438 files / 5510 tests,
parity 259, no reference change); this recording commit is the round-3 tip.

**Review round 3 (2026-09-07): PASS (bounded)** on candidate `fff3be61f` — the fix commit and the six
carried limits all inspected or independently rerun; no required finding; advisories A8 (vacuous
never-by-value proofs) and A9 (key refusal wording) fixed in `1e5b4b7b4`. Ledger in
`ref guards-and-tests` §10.5. Round 4 is a bounded fresh review of the A8/A9 delta only.

**Candidate refrozen for round 4:** implementation head `1e5b4b7b4`, gates green (438 files / 5510 tests,
parity 259, no reference change); this recording commit is the round-4 tip.
