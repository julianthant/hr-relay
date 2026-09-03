# R3c supervisor report — deletion acceptance, retired-path guard, T1b states

**Status:** COMPLETE — u29–u32 done; integrated gate green on the run branch at the frozen tree `13268597` (+ the parity refreeze `7caa3fa9` and this report, both evidence-only); ready for the coordinator's `--no-ff` merge into `feature/03c-workflow-migration`. No handoff.

**Mode:** coordinated-read-only
(`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3c-migration/board.md`, read at primary HEAD
`50791d79`, blob `e6766336`; never written)

**Coordination:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9` · R3c (session `133425d0`, relaunch of the lost `8dacde07`)

**Worktree / branch:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` ·
`feature/phase-3c-migration-c57c2dec9-r3c-deletion-acceptance`, base `c258677b` (= integrated `feature/03c-workflow-migration` tip at launch)

**Scope:** u29–u32 exactly as briefed. No feature work, no external write, no board write, no other branch or worktree touched, no
replacement Separations canary chosen.

## Outcome by unit

| Unit | Outcome | Commits |
|---|---|---|
| u29 — deletion/conversion (supervisor) | Every step identity (group, node ids, D315 entries, D307 omission) folded into `src/workflows/separations/workflow.ts`; the five harnesses import them from `../workflow.js`; `separations-identity-check` converted to `defineWorkflow`; 22 files / 657 lines deleted; flow node-fragment API retired; transitional "not yet converted" arm retired from registry, Explorer and `workflow-layout`; executor re-parse cleanup; forced doc edits with byte-identical twins; manifest + roadmap regenerated | `06eb7494`, `6db1766e`, `877894cf`, `ab04231c` |
| u30 — retired-path/escape-hatch guard (sup-opus) | `workflow-authoring-budget` guard + inventory entry: four arms, 24 violating fixtures + positive controls, closed decision-cited allowlists; seven review findings applied and each fixture mutation-verified red | `db7bbd5c`, `44f74d54` |
| u31 — equivalence, grouping proof, T1b states (supervisor) | Equivalence + grouping/options-only proofs green at `ab04231c` (11 files / 108 tests, unmodified fixtures); Person Lookup `live-read` T1b **met** on a fresh isolated root (result `66ea3863…`, run `3bf3d260…`, attempt 1, 0/0/0); Separations typed blocked arm recorded (result `c36b2b6b…`, `blocked` / `not-started` / `subject-unavailable`); no replacement canary | none (proof only) |
| u32 — gates + report (supervisor) | first full pass found one text-conformance false positive (a prose `timeline:` in the folded file's comment), one trailing blank line, a stale manifest after that wording fix, and the expected fingerprint-only parity drift; each fixed and the whole chain re-run green on the frozen tree; this report | `7cfe6c38`, `13268597`, `7caa3fa9`, report commit |

## u29 — deletion inventory (before → after)

Verified by read at `c258677b` before deleting (the R3b inventory was exact; one correction: the `nodes.ts` files were D315
`defineStepEntries` values for four steps and flow fragments only for `identity-check`/`job-summary`).

| Path at `c258677b` | Kind | Disposition |
|---|---|---|
| `src/workflows/separations/{kuali-extraction,identity-check,job-summary,kronos-timecard,ucpath-transaction,kuali-finalization}/step.ts` (6) | step group declared beside the folder | folded into `separations/workflow.ts` (`defineWorkflowStep`) |
| `…/{same six}/node-ids.ts` (6) | node id constants | folded |
| `…/{same six}/nodes.ts` (6) | entry identities (4 × `defineStepEntries`, 2 × flow fragment factory) | folded; the two fragment factories became `defineStepEntries` |
| `…/{kronos-timecard,ucpath-transaction,kuali-finalization}/omission.ts` (3) | D307 omission declarations | folded |
| `src/workflows/separations/identity-check/{descriptor,module}.ts` (2) | last hand-authored descriptor/module pair | replaced by `identity-check/workflow.ts` (`defineWorkflow`); module composed at the registry root like every other |
| `src/base/flow.ts` node-fragment region (`defineWorkflowStepNodeFactory`, `.wire()`, `.pipe()`, `FlowFragment`/`TaskNodeFragment`/`TransactionNodeFragment`/`OperatorGateNodeFragment`/`NodeFragmentOf`) | fragment factory API | deleted (376 lines); compiler's gate conditional now reads the identity's own `when` |
| `src/domain/workflow/source-layout.ts` `descriptorSourcePath`/`moduleSourcePath`; `src/control/workflow-registry.ts` `isDefinitionBackedModule` + optional `definition`; Explorer descriptor/module path branch; `workflow-layout` `definitionBacked` arm | transitional "not yet converted" path | deleted |
| `src/core/run-executor.ts:800,818` | no-op re-parse | one fail-loud `requireStoredCheckpoint` narrowing |

Authored-artifact inventory after (`db7bbd5c`), per D312's four:

| Workflow | `workflow.ts` | structural scenario | dry-run declaration | migration doc | beyond four |
|---|---|---|---|---|---|
| `person-lookup` | `src/workflows/person-lookup/workflow.ts` | `tests/scenario/workflows/person-lookup/structural.scenario.test.ts` | `…/dry-run.scenario.ts` | `docs/migrations/person-lookup.md` | none |
| `separations` (composition) | `src/workflows/separations/workflow.ts` (1,509 lines: presentation, input/result schemas, six step sections, the definition) | `tests/scenario/workflows/separations/structural.scenario.test.ts` | `…/dry-run.scenario.ts` | `docs/migrations/separations.md` | `docs/migrations/separations-legacy-behavior.md` (the migration doc's legacy-behavior supplement, pre-D312) and `tests/scenario/dashboard/separations/**` (T2/T3 proofs of the gate/needs-you/wired surfaces, ref guards-and-tests §10.11/§10.12) — both closed exemptions in the u30 guard |
| `separations-kuali-read` | `separations/kuali-extraction/workflow.ts` | `tests/scenario/separations-kuali-read.scenario.test.ts` (pre-canonical root path) | none | shares `separations.md` | none |
| `separations-identity-check` | `separations/identity-check/workflow.ts` | `tests/scenario/separations-identity-check.scenario.test.ts` | none | shares `separations.md` | none |
| `separations-kronos-timecard` | `separations/kronos-timecard/workflow.ts` | `tests/scenario/separations-kronos-timecard.scenario.test.ts` | none | shares `separations.md` | none |
| `separations-ucpath-termination` | `separations/ucpath-transaction/workflow.ts` | `tests/scenario/separations-ucpath-termination.scenario.test.ts` | none | shares `separations.md` | none |
| `separations-kuali-finalization` | `separations/kuali-finalization/workflow.ts` | `tests/scenario/workflows/separations-kuali-finalization/structural.scenario.test.ts` | `…/dry-run.scenario.ts` | shares `separations.md` | none |

`src/workflows/` now holds exactly `descriptor-registry.ts` + eight `workflow.ts` files; `job-summary/` has no folder (a declared
group with no harness). Everything else a workflow uses is behavior-owned in `src/stores/**` (tasks), `src/domain/**` (schemas,
contracts) and `src/infra/**` (drivers).

**Public equivalence, stated per identifier.** A probe serialized every public field of all seven registered workflows
(descriptor presentation, surfaces, details, verdicts, subject projection, timeline, step omissions, node purposes, scenarios,
node graph with `when`/replay/transaction policy, projections' steps/gates/systems/contracts/dry-run, module role/stores/intake,
match keys/titles over canonical examples) before (`c258677b`) and after (`ab04231c`). Byte-identical everywhere except:

- `contractFingerprint` of all seven — moves because `src/base/workflow-definition.ts` is in every closure (manifest regenerated, `build:manifest:check` current);
- `separations-identity-check` only: `timelineDeclared` false → true, timeline five per-node default groups → two declared groups `[job-summary: job-summary]`, `[identity-check: name-search, comparison, identity-approval, approval]` in the hand descriptor's node order. Node graph, steps projection, gate, contracts, stores (`ucpath` browser + `workflow:separations` headless) and every presentation field unchanged. This is the one wire change the conversion forces (a D315 identity is owned by its step, so a harness cannot declare per-node groups); the four harnesses converted in R3 crossed the same line.

The R1 equivalence fixtures (`tests/unit/workflow-definition-equivalence.test.ts`) are unmodified and green.

**Rule consequence recorded (not a new decision).** D265 §1.2.2 rule 2's "declared category with no folder fails" cannot survive
D312 (the composition's one `workflow.ts` authors every identity and `job-summary` carries no harness, so its folder would be
empty). Applying D312 §1.6.1 item 5 ("a guard MAY require [folders] to agree with group keys, but the tuples define membership")
the `workflow-layout` arm (b) now reads: every step folder is a declared group AND a registered harness address; a declared group
needs no folder; a workflow folder holds exactly its `workflow.ts`. Recorded as a dated note under §1.2.2 rule 2, in the guard
inventory invariant and in the root twins. Flagged here for the coordinator in case the operator wants the D265 text itself amended
rather than annotated.

## u30 — guard fixtures and red lines

`tests/unit/architecture/workflow-authoring-budget.test.ts` (owner `ref workflow-model` §1.6.1; inventory entry `workflow-authoring-budget`,
active, milestone `3-workflow-migration`). One pure audit over (registered modules, one git-visible tree listing + parsed sources);
every fixture is written to a temp root, read back through the same collector, and asserted against a clean baseline first. The
real tree is asserted non-empty per arm (sources > 500 with two named live files; ≥ 2 `workflow.ts` equal to the registered
`workflowSourcePath` set; 9 allowlist entries all still present; 2 exemptions + 4 pre-canonical scenarios present, > 10 artifact files).

| Arm | Refuses | Violating fixtures (each red-capable; `44f74d54` mutation-verified) |
|---|---|---|
| (a) retired names (D317) | `WorkflowRecipe` / `defineWorkflowRecipe` / `compileWorkflowRecipe` / `workflow-recipe` specifier / `recipe.ts` / `defineWorkflowStepNodeFactory` anywhere in `src`/`tests`/`scripts`; the bare identifier `recipe` inside the authoring seam (AST identifiers only — the comment "login recipe" and `defineVerifiedLoginRecipe` pass, with live assertions) | `retired-recipe-type-anywhere-in-the-program`, `retired-node-fragment-factory-in-a-test`, `retired-workflow-recipe-specifier`, `a-file-named-recipe-ts`, `bare-recipe-identifier-inside-the-authoring-seam` |
| (b) hand-authored path beside `workflow.ts` (D317) | under `src/workflows/**`: `defineWorkflowDescriptor(`, `flow(`, `composeWorkflowModule(`, any-depth import of `base/flow.js`; ≠ 1 `defineWorkflow(` per `workflow.ts` | `flow-builder-imported-and-called-beside-workflow-ts`, `flow-builder-imported-three-levels-up-from-a-step-folder`, `descriptor-hand-authored-under-src-workflows`, `stores-composed-inside-a-workflow-folder`, `two-defineWorkflow-calls-in-one-workflow-file` |
| (c) workflow-keyed generic adapter (D316) | any string literal equal to a registered id in `src/dashboard/**`, `src/server/**`, `src/services/**` outside an exact `(file, id)` allowlist; a stale or uncited allowlist entry | `generic-server-branch-keyed-by-workflow-id`, `generic-dashboard-dispatch-table-keyed-by-workflow-id`, `allowlisted-file-branching-on-a-DIFFERENT-workflow-id`, `another-file-branching-on-an-allowlisted-workflow-id`, `stale-D316-allowlist-entry`, `uncited-D316-allowlist-entry` |
| (d) fifth authored artifact (D312) | per registered id: `workflow.ts` + ≤ 1 structural scenario + ≤ 1 dry-run declaration + ≤ 1 migration doc; files under `src/workflows/` attributed by registered folder (longest prefix — a harness folder's extra file is the HARNESS's), elsewhere by exact segment/stem or `<id>` + `-`/`_`/`.` (longest id wins); closed exemptions | `fifth-authored-artifact-for-a-workflow`, `fifth-artifact-under-tests-scenario`, `fifth-artifact-inside-a-harness-folder-belongs-to-the-harness`, `fifth-artifact-in-a-folder-suffixing-a-registered-id`, `fifth-artifact-whose-stem-suffixes-a-registered-id-with-an-underscore`, `two-structural-scenarios-for-one-workflow`, `stale-artifact-exemption`, `stale-pre-canonical-structural-scenario` |

Closed allowlists (9 `(file, id)` pairs, each citing the decision its site's own comment names): `src/server/dry-run-scenario/compose.ts`
and `manifests.ts` (`separations`, `separations-kuali-finalization`, `person-lookup`) → D318 / ref guards-and-tests §10.9 (T1b manifest
loader); `src/server/dashboard/compose.ts` (`separations`) → D289 (receipt comparison needs the current Separations descriptor);
`src/server/dashboard/projectors/run-queue-projection.ts` ×2 and `src/server/activity-person-pseudonym-backfill/service.ts`
(`separations`) → D288 (Separations-only pseudonyms). Exemptions: `docs/migrations/separations-legacy-behavior.md` (migration-doc
supplement), `tests/scenario/dashboard/<id>/**` (§10.11/§10.12 T2/T3 proofs), and the four harnesses' pre-canonical
`tests/scenario/<id>.scenario.test.ts` paths (exact, not generalized). Overlap with `workflow-layout` is deliberate: that guard
refuses any FILE beside a `workflow.ts`; this one refuses the SOURCE shapes and names, so neither can be weakened alone.

## u31 — equivalence, grouping proof, T1b states

**Public equivalence and grouping proof** — at `ab04231c` (unchanged through `44f74d54`, which touches only a guard and the inventory):
`tests/unit/workflow-definition-equivalence.test.ts` (R1 fixtures, unmodified), `tests/unit/workflow-definition-mutation-proof.test.ts`
(grouping/options-only mutation proof), `tests/unit/workflows/**` (registry ↔ descriptor tuple), `descriptor-coverage`, the three canonical
T1 structural scenarios and the four harness scenarios: `Test Files 11 passed (11)` · `Tests 108 passed (108)`. The probe diff in u29
above is the per-identifier statement.

**Person Lookup `live-read` T1b (D318)** — `npm run cli -- dry-run-scenario person-lookup --subject person-lookup-canary`, arm
`live-read`, `dryRun=false`, executed twice in this worktree's isolated authority (`.tracker-rebuild/state.db`), both durable and
insert-only:

| Attempt | Result row | Verdict | Run / trace | Wall | Assertions |
|---|---|---|---|---|---|
| 22:39 PDT, on the root R3 left behind (already holding R3's attempt-1 run `c1f4ad74…` of the same item) | `0c8b2425-06de-4588-9657-437fd4119d39` | `failed` | `e87093af-aaa3-4d87-8eb9-37b60d1714f5` / `pl-213934-e870`, attempt **2**, terminal `done`, 39,232 ms | 39.2 s | six met (`nodes-reached`, `nodes-excluded`, `gate-results`, `write-safety-deltas` 0/0/0, `receipt`, `terminal`); `checkpoints` failed — the three read checkpoints are attempt-2 rows (fresh reads, D314: another run's rows are never replayed) and the manifest pins attempt 1. The same case R3 recorded ("a first-attempt manifest cannot match" a second attempt of the item); not a product defect, not a manifest change I may make. |
| 22:11 PDT, on a fresh root (prior root moved to `/Users/julianhein/.claude/jobs/133425d0/tmp/tracker-rebuild-superseded-20260902-221143/`; runtime activated once by a BFF boot on 3938 that was stopped before the run) | `66ea3863-2951-4ad9-92b7-4e444eff4959` | **`met`** | `3bf3d260-7738-4d97-b947-216ee46371d1` / `pl-221147-3bf3`, attempt **1**, terminal `done`, 34,823 ms | 34.8 s | all seven met: `nodes-reached`, `nodes-excluded`, `checkpoints`, `gate-results`, `write-safety-deltas`, `receipt`, `terminal`; whole-authority `write_intents` / `write_attempts` / `durable_outbox` = 0 / 0 / 0 |

The 21:39 row's hours read 04:39/04:40 UTC in the table; the 22:11 row 05:11/05:12 UTC. No browser session outlived either run
(`playwright-cli list` → `(no browsers)`; no listener on 3938/5174 after).

**Separations T1b — typed blocked arm (D284, no replacement chosen)** — `npm run cli -- dry-run-scenario separations --subject
finalization-canary` → `blocked: needs finalization-canary; registry says gone, last observed 2026-09-01`; durable row
`c36b2b6b-9bf8-4f28-b9a9-cf97cb695d9a`, scenario `separations/dry-run`, verdict `blocked`, `execution_state = not-started`, no run/trace
id, `assertions = [{ subject-availability: blocked, subject-unavailable }]`, `wall_time_ms = 2`, recorded before any environment read
or browser (`config/test-subjects.json`: `finalization-canary` → `gone`, `lastObserved 2026-09-01`, DOCUMENT_NOT_IN_ACTION_LIST).
That row lives in the superseded root copy above (it was recorded before the fresh root was minted).

## Review record

Target `db7bbd5c` (u30 guard). Axes run: Correctness + Tests in one `sup-opus` read-only review (the guard touches no `src/`;
it is a scanner with closed allowlists, so the risks are a scanner that resolves nothing and an allowlist keyed too loosely).
Skipped: Standards (*lint/typecheck/guard-manifest green; house style restated in the brief*), Spec (*the spec is D312/D316/D317,
tabled in the brief*), Silent failures (*the review's Q7 covered the fail-loud rule: no catch-and-return, unreadable file throws*),
Performance (*test-time scanner*), Docs (*the inventory entry was checked by the same reviewer*), Security (*no trust boundary*).
u29 (supervisor-owned) was not sent to a worker reviewer: its equivalence is proved mechanically by the before/after probe and the
unmodified R1 fixtures, and the gates below; the one compiler change (`operatorGate` result typing) is pinned by the two source
errors it fixed and the 169-test affected-suite run.

| # | Axis · severity | Finding | Disposition |
|---|---|---|---|
| 1 | Correctness · medium | raw NUL bytes as the allowlist pair separator (file read as binary by `grep`) | fixed `44f74d54` — `\u001f` escape via one `pairKey` helper; NUL count 0 |
| 2 | Correctness · medium | arm (d) attributed a harness folder's extra file to `separations` | fixed — attribution by registered `workflowSourceFolder`, longest prefix; fixture `fifth-artifact-inside-a-harness-folder-belongs-to-the-harness` |
| 3 | Correctness · medium | arm (d) escape: `tests/scenario/separations-extra/` and `separations_extra.md` attributed to nothing | fixed — segment/stem match on `-`, `_`, `.`; two fixtures |
| 4 | Tests · medium | arm (c) pair-exactness unproven (fixtures ran with an empty allowlist) | fixed — `(fileA, idY)` and `(fileB, idX)` refuse while `(fileA, idX)` passes; mutation-verified against file-keyed and id-keyed implementations |
| 5 | Tests · low | arm (b) had no repo-level negative control | fixed — scanned `workflow.ts` set must equal the registered `sourcePath` set and be ≥ 2 |
| 6 | Tests · low | no fixture for a three-level `../../../base/flow.js` import or a fifth file inside a harness folder | fixed — both fixtures added |
| 7 | low | `?? "its workflow.ts"` message fallback | fixed — unresolved owner throws naming file + id |

Verified by the reviewer without finding: AST identifier scan (comment "login recipe" and `defineVerifiedLoginRecipe` pass with fixtures),
two `defineWorkflow(` refused, any-depth `base/flow.js` regex, exact `(file, id)` allowlist key (derived count 9, not the ten sites the
worker's report said — two literals share one `case` site), the three named prefix-hazard paths not charged to `separations`, every fixture
regex message-specific, clean baseline asserted first, no assertion-free test, unreadable file throws.

Count: Correctness 4 · worst medium — Tests 3 · worst medium — all 7 fixed in `44f74d54`; post-fix verification by the supervisor:
`workflow-authoring-budget` + `guard-manifest` + `workflow-layout` → 3 files / 52 tests green, NUL count 0.

## Gates (u32) — frozen tree at `13268597` (parity references `7caa3fa9`; report docs-only)

All gates run by the supervisor in this worktree with `HRAUTO_LEGACY_REPO` exported. The foreign dev dashboard was stopped
(`pkill -INT -f scripts/dev-dashboard.ts`) immediately before each full pass; a Codex session restarted one mid-pass at 22:13:57
(reddening the three real-port suites environmentally on the first pass, exactly R3b's case) and again at 22:58 after the final pass
had finished — the final pass ran with zero listeners.

| Gate | Tree | Result |
|---|---|---|
| `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` | — | `claude: role policy valid (4 workers)` |
| `npm run typecheck` | `13268597` | 0 `error TS` lines, exit 0 |
| `npm run lint` (`--max-warnings 0`) | `13268597` | exit 0 |
| `npm run test:coverage` (alone, no listener) | `13268597` | `Test Files 402 passed (402)` · `Tests 4941 passed (4941)` · Duration 140.34s · All files 85.47 % stmts / 76.54 % branches / 89.42 % funcs / 87.42 % lines · exit 0 |
| `npm run test:parity` (first assert, at `44f74d54`) | | RED: 208 a11y reference drifts, 0 visual-first drifts — every drift the served descriptor-hash prefix (all seven fingerprints moved); the two `diagnostic-bundle-dialog` gallery specs and the JSON evidence verification failed as a cascade of the same drift |
| `npm run test:parity:update` | `13268597` (frozen) | `287 passed`; 499 reference files changed, 684 files total (228 a11y / 228 meta / 228 png), nothing outside `tests/parity/references/`; `git diff -U0` over the references: 1,016 changed lines, **1,016 hash/fingerprint, 0 identity-check timeline, 0 other** (classified mechanically) |
| `npm run test:parity` (re-assert) | `7caa3fa9` content | `287 passed (55.6s)`, exit 0 |
| `npm run build:manifest:check` | `13268597` | `src/domain/workflow/generated-build-manifest.ts is current.` |
| `npm run stores:catalog:check` | `13268597` | `docs/rebuild/reference/stores.md store catalog is current.` (regenerated during u29: zero diff) |
| `npm run roadmap:check` | `13268597` | `docs/roadmap/index.html is fresh.` |
| `git diff --check` and `git diff c258677b --check` | `13268597` | both clean (exit 0) |
| `cmp AGENTS.md CLAUDE.md` | `13268597` | identical |
| Live systems | — | two Person Lookup `live-read` runs and one BFF activation boot (u31); `playwright-cli list` → `(no browsers)` after every step; no external write anywhere |

First full pass at `44f74d54` (recorded, not hidden): coverage 398/402 files — `workflow-definition-conformance` (text regex hit the
prose `timeline:` in the folded file's comment; fixed `7cfe6c38`) plus `compose-real-port`, `worker-pool-composition`,
`worker-pool-parallel-proof` (`owner-proof-unconfigured` on 5174 — the foreign dashboard that started mid-pass; pass in the final
run); `git diff c258677b --check` exit 2 (one new blank line at EOF in `source-layout.ts`; fixed `7cfe6c38`). Second pass at
`7cfe6c38`: coverage 401/402 — `descriptor-coverage` refused the manifest as stale because the wording fix moved the composition's
bytes without regeneration; fixed `13268597`. `13268597` and `7caa3fa9` change only the generated manifest and parity references,
so the final pass above is the gate of record for the whole range `c258677b..HEAD`.

## Worker ledger (R3c)

All workers ran sequentially inside this one worktree (allowance 1, no worker worktrees, no worker branches); every row is closed —
nothing to remove.

| Unit | Role · visible description | Result |
|---|---|---|
| u30 | `[sup-opus] phase-3c-migration C57c2dec9 R3c U30 — retired-path and escape-hatch guard` | done: `db7bbd5c`; 184k tokens; no sup-scout used |
| u30-review | `[sup-opus] phase-3c-migration C57c2dec9 R3c U30-review — correctness + tests of the authoring-budget guard` | read-only; 7 findings (table above); 122k tokens |
| u30-fix | `[sup-opus] phase-3c-migration C57c2dec9 R3c U30-fix — apply review findings to the authoring-budget guard` | done: `44f74d54`; each new fixture mutation-verified red; 153k tokens |

Harness-internal task ids are not reproduced here (tool policy); the visible descriptions above are the exact dispatch names.

## Residue for R3d / the coordinator

- **D265 §1.2.2 wording vs D312** (recorded, not decided): rule 2's "declared category with no folder fails" is now annotated
  as superseded by D312 §1.6.1 item 5 (a step folder exists iff it carries a harness). If the operator prefers the D265 body text
  rewritten rather than annotated, that is an R3d doc edit.
- **Per-workflow glue outside the four-artifact budget**: `src/server/dry-run-scenario/compose.ts` and `manifests.ts` map each
  workflow id to its `dry-run.scenario.ts` module (D318 T1b loader). A new workflow must edit both — a fifth/sixth touched file.
  Allowlisted in the u30 guard citing D318/§10.9 rather than fixed (product/design call: derive the loader from the registry or
  keep the explicit map).
- **First-attempt manifests and a reused item**: a `live-read` re-run of an item that already completed in the same authority is
  attempt 2 and fails only `checkpoints` (row `0c8b2425…`). R3 and R3c both worked around it with a fresh root. Whether a T1b manifest
  should pin the attempt is a `ref guards-and-tests` §10.4 question for the coordinator/operator, not a code change made here.
- **Separations T1b** stays blocked on the typed `gone` arm; no replacement canary chosen (D284). Rows `c36b2b6b…` (blocked) and
  the two Person Lookup rows are in this worktree's superseded root copy (path above) and fresh root respectively.
- **R3d docs package unchanged**: guide unwritten; `ref stores` catalog mention, ref workflow-model §5.6/§5.8 text, and the
  broader root-rules rewrite remain u33–u36. This run edited docs only where the deletion made them false.
- `docs/migrations/i9-lookup.md` exists for an unregistered candidate; the u30 guard starts budgeting it the moment `i9-lookup`
  registers (worker note).
- Environment: no dev dashboard was listening when the u32 window opened (`pkill` matched nothing); the BFF booted once on 3938 for
  the fresh-root activation and was stopped (`exit 0`) before the live run.

## Board check

Re-read at primary HEAD `211413a8` (blob `c2de84f8`) after the gates: the board changed since intake (`50791d79`, blob
`e6766336`) only in progress rows — R3 closed via `c258677b`, R3c marked in progress for session `133425d0`, R3d briefed with
"needs R3c integrated", progress 3/8. No fact, decision, unit scope or dependency governing R3c moved; no conflict to record.
The board was not written.
