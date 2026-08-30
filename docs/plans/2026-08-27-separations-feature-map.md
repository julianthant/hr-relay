# Feature map — every workflow vs. separations — 2026-08-27

_Coordinator read-out, assembled from two `sup-scout` passes over the reference docs and the code at `integration/03b` (HEAD `2a164941`). A reading aid, not a spec: every row cites its owner; where a row and its owner disagree, the owner wins. Board: `docs/plans/03b-board.md`._

---

## Part 1 — What every workflow gets from the platform

### 1.1 Authoring

| Feature | What it does | Owner | Code |
|---|---|---|---|
| One descriptor builder | `defineWorkflowDescriptor` — the ONE client-safe declaration per workflow | ref workflow-model §1 | `src/base/workflow.ts:1003` |
| Branch / parallel nodes | branch cases and parallel branches name nodes DOWNSTREAM; forward refs checked at `build()` | D104 | `src/base/workflow.ts:1278`, `:1298` |
| Contract fingerprint | per-descriptor `contractFingerprint` from its source closure | ref workflow-model | `src/base/workflow.ts:1014`, `:251` |
| Build manifest | `npm run build:manifest` recomputes every fingerprint; `descriptor-coverage` fails on a diff | ref workflow-model | `src/domain/workflow/build-manifest.ts:75` |
| Pending-impl-bindings gate | a contract used by a descriptor but implemented by no store must be listed; guard fails both ways | D107 | `config/pending-impl-bindings.json` |
| Typed task declaration | `defineTask(driver, contract, impl)` for browser tasks, `defineTask(contract, impl)` for service/workflow tasks | ref task-contract | `src/base/task.ts:335-368` |
| Driver declaration | `declareDriver` / `declareDriverFor` binds a store's exact `DriverDeclaration` | ref task-contract | `src/base/task.ts:69-84` |
| Composition root | `WORKFLOW_MODULES` — every registry and projection derives from it | ref workflow-model §1.2/§1.3 | `src/control/workflow-registry.ts:34` |
| Browser-safe mirror | `WORKFLOW_DESCRIPTORS`, pinned identical in order to `WORKFLOW_MODULES` | ref workflow-model §1.2 | `src/workflows/descriptor-registry.ts:22` |

### 1.2 Execution

| Feature | What it does | Owner | Code |
|---|---|---|---|
| Run state machine | drives a run through nodes → checkpoints → terminal result | ref workflow-model | `src/base/workflow.ts:1245-1603` |
| Run executor | executes one run; parks a write on ambiguity (`WriteParkedError`) | ref execution-and-sessions | `src/core/run-executor.ts:190`, `:327` |
| Worker pool / loop | supervised pool, stop-escalation stages, graceful stop; `--pool-index` required | ref execution-and-sessions | `src/core/worker-loop.ts:387-486`, `:913` |
| Run fan-out | queued-runs fan-out, active-runs-for-item, `enqueue` policy | ref execution-and-sessions | `src/core/run-fan-out.ts:32-101` |
| Session providers | typed browser session providers (worker / deterministic / unwired) | ref execution-and-sessions | `src/base/session.ts:135-191` |
| Worker session manager | live browser sessions per worker | ref execution-and-sessions | `src/core/worker-sessions.ts:357` |
| Duo ceremony gate / lease | unattended Duo MFA lease across the three ceremonies | ref write-safety §14.11 | `src/core/duo-ceremony-gate.ts:150`, `src/base/duo-ceremony-lease.ts:46-82` |
| dryRun support | every descriptor exposes dry-run reachability (`WorkflowDryRunSupport`) | ref workflow-model | `src/base/workflow.ts:480` |
| Checkpoint `claimGeneration` | gate-park + resume (2 executions / 1 attempt) no longer collide | D214 | `src/infra/sqlite/migrations.ts:994` (v14) |
| Runtime composition roots | dashboard / worker / OCR / explain / storage / dry-run composers | ref execution-and-sessions | `src/core/runtime-composition.ts:84-179` |

### 1.3 Write safety

| Feature | What it does | Owner | Code |
|---|---|---|---|
| `WriteSafety` on every commit contract | per-system instantiation of the write-safety primitives | ref write-safety §2.1/§2.2 | `src/domain/write-safety-primitives.ts` |
| Write sequencer | the kernel's terminal-evidence commit sequence (beat ⑦) | ref write-safety §3 | `src/core/write-sequencer.ts:584`, `:834` |
| Staged-page discard | fail-loud if a staged page is discarded mid-commit | ref write-safety §3.3 | `src/core/write-sequencer.ts:131` |
| Crash-window recovery | positive proof or stabilized negative proof after a crash | ref write-safety §4 | `src/core/write-recovery.ts:160` |
| Parked-write resolution | typed, intent-scoped resolution executor | ref write-safety §4.1 | `src/core/write-recovery.ts:462` |
| UNKNOWN discrimination | `WriteRecoveryDecisionSchema` never collapses unknown into done | ref write-safety §7 | `src/core/write-recovery.ts:90` |
| Write-binding resolution | rebuilt commit input checked against the actual TXN node | ref write-safety | `src/core/write-resolution-binding.ts:66-414` |
| ALWAYS-GATE | the wrong-PERSON control before every commit; three ceremonies | ref write-safety §14 | `src/domain/trust/gate-decisions.ts:84-109` |
| Durable outbox | pending-write record that survives a crash | ref write-safety | `src/domain/outbox.ts` |
| Double-submit prevention | ledger check before any second commit attempt | ref write-safety §5 | write-sequencer commit path |
| Immutable transaction ledger | append-only ledger of committed writes (projector exists, unused in prod — doc-noted gap) | ref write-safety §6.1 | — |

### 1.4 Intake

| Feature | What it does | Owner | Code |
|---|---|---|---|
| Canonical field registry | shared vocabulary for every intake source | ref data-intake §1 | `src/domain/` |
| Column mapping | operator-defined, per-source persistence, fuzzy suggestions | ref data-intake §2 | `src/domain/` |
| Extraction tasks | `extraction/extract-spreadsheet`, `extraction/extract-pdf-pages` | ref data-intake §3 | — |
| OCR pipeline | three producers admitted identically; I-9 as one form across two sections | ref data-intake §4 | — |
| Intake manifest | mapped dataset → N inputs → pre-run rejection review → readiness → enqueue | ref data-intake §5 | `src/core/capture-intake-handoff.ts` |
| Edit Data | typed field patches; fail-closed edit-during-resume | ref data-intake §6 | dashboard |
| Live mobile capture | recoverable artifact-intake source; takes the intake column | ref data-intake §5.1, D278 | — |
| Test-subject registry | `config/test-subjects.json` — LABELs not people; availability-dated; EIDs only via `secrets.ts` | ref guards-and-tests §10.5 | `src/domain/secrets.ts:95`, `:168` |

### 1.5 Dashboard

| Feature | What it does | Owner |
|---|---|---|
| Span event model | every task / run / worker / session emits a typed span (`src/core/span-emitter.ts:49-293`) | ref dashboard-surfaces §1 |
| The ONE projection | server-computed; the wire carries surfaces, not rows (`src/domain/workflow/artifact-projection.ts`) | ref dashboard-surfaces §2.2 |
| Queue | the day's work, one row per run | §9.2 |
| Run detail | open and follow a run live | §9.3 |
| Receipts / gate ceremony | the ALWAYS-GATE ceremony + parked-write resolution | §9.4 |
| Archive · Activity · Explorer | the three read surfaces | §9.5 |
| Notifications | durable inbox + bell | §9.6 |
| Intake · capture · Edit Data | dashboard side of §1.4 | §9.7 |
| Failures | `FailureRecord`s rendered to the operator | ref operator-trust §2.1 |

### 1.6 Operator trust

| Feature | What it does | Owner | Code |
|---|---|---|---|
| `FailureRecord` | what happened, why it is credible, what is uncertain | ref operator-trust §2.1 | — |
| Diagnostic bundle | auto-collected evidence on failure | §2.2 | — |
| `RunEvidenceReceipt` | per-run credibility receipt; refs must resolve | §2.3 | `src/core/evidence-receipt.ts:339`, `:412`, `:1021` |
| Rerun transparency | prior attempts shown on a rerun | §2.4 | — |
| `cli explain` | explain a run from authority | §2.5 | `npm run cli -- explain` |
| Knowledge / FixRecord | evidence-only fix history | §4 | — |
| Capability dispositions | how each legacy capability closes | ref guards-and-tests §3.11 | — |

### 1.7 Proof

| Tier | What it is | Owner | Where |
|---|---|---|---|
| T1a | ONE structural scenario per workflow, no browser, every derived coverage point claimed | ref guards-and-tests §10.3 | `tests/scenario/workflows/<id>/structural.scenario.test.ts` |
| T1b | live-rehearsal checkpoint manifest; no `.test.` segment, uncollectable by vitest | §10.4 | `tests/scenario/workflows/<id>/dry-run.scenario.ts` |
| Dry-run scenario runner | evaluates a T1b manifest against a live run; durable `dry_run_scenario_results` | §10.6 | `src/core/dry-run-scenario-runner.ts:35-192` |
| T2 dashboard scenarios | real projection + real command kernel + real authority DB, no browser | §10.7 | `tests/scenario/dashboard/**` |
| T4 | agent-operated parallel tier | §10.8 | — |
| Parity lane | 218 asserts / 151 reference pairs; `PARITY_UPDATE=1` is the one refreeze | ref frontend-backend-integration §5 | `tests/parity/dashboard-reference.spec.ts` |
| Guard inventory | `docs/rebuild/guard-inventory.json` ↔ `tests/unit/architecture/` both directions | root CLAUDE.md | `guard-manifest.test.ts` |
| Coverage floors | `npm run test:coverage` (D191 — the per-commit gate) | §10.10 | — |

### 1.8 Config · clock · secrets · isolation

| Feature | What it does | Code |
|---|---|---|
| Config resolver | `env > settings.json > default`, exactly once, with provenance | `src/domain/config/resolve.ts:405-409` |
| Secrets single source | the only module allowed to read a credential from `process.env` | `src/domain/secrets.ts:280-300` |
| Clock | one clock; `manualClock` is test-only | `src/domain/clock.ts:28`, `:41` |
| Immutability | registry exports deep-frozen at module load | `src/domain/immutability.ts:1` |
| Runtime isolation | state root / ports / locks / session namespace distinct from legacy | `config/runtime-isolation.json` |

**Registered workflows today (7):** `person-lookup` · `separations-kronos-timecard` · `separations-kuali-read` · `separations-identity-check` · `separations-ucpath-termination` · `separations-kuali-finalization` · `separations`. Only `separations` and `separations-kuali-finalization` carry the full T1a/T1b pair.

---

## Part 2 — The separations workflow

### 2.1 The family — one composition, five proof-chunk sub-descriptors

The five sub-descriptors are scaffolding for proof and live verification; the composition never delegates to them at runtime (doc 03b lines 117–120).

| id | descriptor | nodes (ordered) | systems | write nodes |
|---|---|---|---|---|
| **`separations`** | `src/workflows/separations/descriptor.ts:632` | resolve-action → document → { plan → name-search → subject → job-summary → employment ‖ timecard-search → timecard → dates ‖ termination-type } → department-option → comparison → **GATE identity-approval** → approval → clear-pending (TXN) → file-termination (TXN) → receipt → finalize-kuali (TXN) → result — **19 nodes** | Kuali, UCPath, New Kronos | `clear-pending`, `file-termination`, `finalize-kuali` |
| `separations-kuali-read` | `kuali-extraction/descriptor.ts:128` | resolve-action, document, plan, termination-type | Kuali | — |
| `separations-kronos-timecard` | `kronos-timecard/descriptor.ts:276` | timecard-search, timecard, dates | New Kronos | — |
| `separations-identity-check` | `identity-check/descriptor.ts:220` | name-search, subject, comparison, GATE, approval | UCPath | — |
| `separations-ucpath-termination` | `ucpath-transaction/descriptor.ts:263` | clear-pending, file-termination, receipt | UCPath | 2 TXN |
| `separations-kuali-finalization` | `kuali-finalization/descriptor.ts:331` | finalize-kuali | Kuali | 1 TXN |

dryRun terminal of the composition: the D215 preview terminal on `clear-pending` (`already-present` or `would-prepare`). Sub-descriptor TXN nodes stop after prepare.

### 2.2 Tasks and stores — 31 tasks over 19 nodes

kuali 10 · ucpath 10 · new-kronos 2 · `separations` store 9 pure folds (doc 03b lines 150–155).

| Node | Task contract | Store | System | Kind |
|---|---|---|---|---|
| resolve-action | KualiSearchSeparationAction | kuali | Kuali Action List | read |
| document | KualiReadSeparationDocument | kuali | Kuali RRSS form | read |
| plan | SeparationsReadSeparationPlan | separations | pure fold | derived |
| termination-type | SeparationsMatchTerminationType | separations | pure fold | derived |
| name-search | SearchPersonOrg | ucpath | UCPath | read |
| subject | SeparationsMatchSeparationSubject | separations | pure fold | derived |
| comparison | SeparationsMatchIdentity | separations | pure fold | derived (binds the gate packet) |
| identity-approval | `identityApprovalGate` | — | operator | GATE |
| approval | SeparationsVerifyIdentityApproval | separations | pure fold | derived |
| job-summary | UcpathReadJobSummary | ucpath | UCPath Person Org grid | read |
| employment | SeparationsMatchActiveEmployment | separations | pure fold | derived |
| department-option | SeparationsMatchDepartmentOption | separations | pure fold | derived |
| timecard-search | NewKronosSearchEmployee | new-kronos | WFD | read |
| timecard | NewKronosReadSeparationTimecard | new-kronos | WFD grid | read |
| dates | SeparationsReadSeparationDates | separations | pure fold | derived |
| clear-pending | UcpathStagePendingTerminationSweep / UcpathDeletePendingTerminations | ucpath | UCPath | TXN (prepare / commit) |
| file-termination | UcpathStageTermination / UcpathCreateTermination | ucpath | UCPath Smart HR | TXN (prepare / commit) |
| receipt | SeparationsVerifyTerminationReceipt | separations | pure fold, `replay: always-rerun` | derived |
| finalize-kuali | KualiStageSeparationFinalization / KualiSaveSeparationFinalization | kuali | Kuali | TXN (prepare / commit) |

### 2.3 Rules specific to separations

| Rule | In ≤ 15 words | Owner | Code |
|---|---|---|---|
| ALWAYS-GATE on every run | no similarity-tier bypass, no run-mode skip | D77 / D202 / D204 / D211 / D226; migrations §4d | `identity-check/nodes.ts:64` |
| Gate packet binding | packet carries the whole write plan; digest binds approval to exact bytes | D211; ref write-safety §14.5 | `separations/descriptor.ts:439-467` |
| Gate shape derivation | `one-click` / `choose-a-candidate` / `type-the-eid` / reject computed server-side | D226 | `src/domain/separations/identity-evidence.ts:339` |
| Gate durable record | lands in `gate_results`, not `run_checkpoints`; receipts read it as dependency evidence | D203 / D204 | `src/domain/separations/identity-approval.ts:71` |
| `identity-gate-before-commit` guard | audits BOTH sinks (every TXN node + terminal result) for gate ancestry | doc 03b exit row 6 | `tests/unit/architecture/identity-gate-before-commit.test.ts` |
| `clear-pending` — `already-present` arm | sweep probe finds nothing pending → settles before staging; zero intent / checkpoint / transition | D215 | `src/core/write-sequencer.ts:1110-1178` |
| `clear-pending` — `would-prepare` arm | dry run probes in the real path's order, reports what the real run would do | D215; doc 03b :497-503 | `src/core/write-sequencer.ts:2015-2220` |
| `clear-pending` — COMMITTED arm | **no live witness yet**; only honest window is re-running ① right after ② files | doc 03b :552 `[!]` | — |
| D207 `stabilized` window | Kuali finalization's recovery-absence window is PROVISIONAL until ③ | D207; doc 03b :417-418 | `src/domain/write-safety-primitives.ts:67` |
| D217 wire-payload shapes | seven `submitDocumentV2` shapes RECORDED, not asserted, until ③ (10→12 staged fields; `Date` = epoch ms vs `MM/DD/YYYY`) | D217; doc 03b :413-449 | `kuali-finalization/nodes.ts:35-41` |
| S7 future-date refusal | a future-dated LDW / separation date is "not yet eligible" — what gates 4537 to 08-28 | migrations §6 (~1441) | `src/domain/separations/separation-dates.ts` |
| S5 same-key mutex | `enqueue: "reject-active"` per document | doc 03b :134-138 | `separations/descriptor.ts:656` |
| S2 non-separation doc refusal | a non-RRSS Kuali document read must refuse — never exercised live | migrations §9.4 | `src/stores/kuali/tasks/read-separation-document.ts` |
| S22 already-Inactive | single-row Inactive employment blocks a 2nd termination — unconditional fold | doc 03b :367-369 | `src/domain/separations/employment-selection.ts` |
| S30 / S31 pending sweep fenced | legacy's unfenced first mutation is its own TXN here | — | `ucpath-transaction/nodes.ts:39-44` |
| S32 / S33 HDH branch NOT ported | unreadable Kronos hard-fails instead of skipping | migrations §4b | deliberately absent |
| S56 comments baseline | `""` is a real baseline when the comments control is empty | doc 03b :419 | `kuali-finalization/nodes.ts:20-22` |
| S58 final-pay radio | "Does not need Final Pay (student employee)" — operator-ratified constant | migrations §4g | kuali stage task |
| S59 finalization proof | one save + one reload read-back proves the write (no receipt exists) | doc 03b :412 | `src/stores/kuali/tasks/{stage,save,verify}-separation-finalization.ts` |

_Note: the "S" numbers are legacy-behavior finding IDs (`docs/migrations/separations-legacy-behavior.md`), cited non-sequentially — not a gate ladder._

### 2.4 Test subjects (`config/test-subjects.json`)

| Label | Kuali doc | Role | Availability |
|---|---|---|---|
| `finalization-canary` | **4537** | D284 sole test subject; one explicit arm for each separations workflow | available (read-only verified 2026-08-28; finalization arm pending three derived/filed leaves) |

D284 retired every other active label on 2026-08-28. Docs 4495, 4502, 4510, 4524 and 4568 remain
dated migration evidence in `docs/migrations/separations.md` §§9.16–9.31, not runnable identities.

### 2.5 Proof surface

| Item | Where | Detail |
|---|---|---|
| T1a structural | `tests/scenario/workflows/separations/structural.scenario.test.ts` | 24 tests / 129 assertions (2026-08-27) |
| T1a structural (finalization) | `tests/scenario/workflows/separations-kuali-finalization/structural.scenario.test.ts` | 15 tests |
| T1b manifest | `tests/scenario/workflows/separations/dry-run.scenario.ts` | 15 checkpoints at attempt 1 (two `timecard-search` claim generations); terminal `done` at the D215 preview on `clear-pending`; 0/0/0 write rows |
| T1b live `met` | `dry_run_scenario_results` `0cc71a31-4119-4588-b96b-0fd5e568abe6` | run `91cf5356…`, trace `sp-064438-91cf`, 121 s, 2026-08-27 |
| T2 dashboard scenarios | `tests/scenario/dashboard/separations/{wired-surfaces,identity-gate,needs-you-and-ledger}.scenario.test.ts` | 26 tests over the real projection + command kernel + authority DB |
| Knowledge records | doc 03b exit row 8 | D212 / D213 (`d00b66c`, `1d019ee`), D214 / D215, `b73b546`, `e1ba81b`, D221, D243 / D244 |

### 2.6 03b exit table (doc 03b lines 804–816)

| # | Criterion | Status |
|---|---|---|
| 1 | §5 questionnaire + §4 decisions answered | MET 2026-08-12 |
| 2 | gates green; descriptor-coverage; write-safety-contract | MET |
| 3 | strict boundary parsing; no raw Page/Locator outside driver | MET |
| 4 | live dry run green, submit-free, zero durable writes | MET 2026-08-14, re-proved ×2 |
| **5** | **controlled-commit evidence for every commit / probe / verify** | **OPEN — ① ② ③ on 4537, date-gated to 2026-08-28 (R2)** |
| 6 | identity-gate-before-commit green, gate dominates both sinks | MET (§9.14 live digest match) |
| 7 | D58 capability dispositions updated | MET 2026-08-14 |
| 8 | regression scenario + knowledge record per live-lane finding | MET |
| 9 | §2.6 / D194 confirmed | MET 2026-08-12 |

### 2.7 Open lines

| Line | Doc 03b | What is open |
|---|---|---|
| sep-1 (Kronos timecard) | :288 | closed 2026-08-27 (§9.20 item 7 / §9.28) |
| sep-2 (Kuali read) | :324 | S2 refusal never exercised live — needs a non-RRSS doc in the Action List; parked |
| sep-3 (job summary + gate) | :350 | nothing left |
| sep-4 (UCPath termination) | :392-394 | COMMIT arm blocked to 08-28; `clear-pending` COMMITTED arm has no witness; two ported UCPath facts (dialog `T…` inline, propagation window) unverified → `recoveryAbsence: operator-only` |
| sep-5 (Kuali finalization) | :419-420 | D217 shapes recorded not asserted; D207 window provisional |
| Track A · A2–A4 | :550 | the three controlled commits ② → ① → ③ |
| Track A · A5 | :551 | what only the commits discharge: `probeToFenceMaxMs`, D207's 30 s window, seven shapes, `would-prepare` live |
| Track A · A8 | :553 | close-out to as-built — after A2–A7 |

### 2.8 Where this sits on the board

R1 (date-independent seams) is closing — u18 / u11 / u12 / u13 merged, u14 done at `b87dc560`. R2 = the 08-28 canary (u1–u5). R3 = discharge + A8. R4 = the 09/02 two-chain parallel proof. `docs/plans/2026-08-27-03b-runs.md`.
