# 02 · Phase 2 — prove writes, build the tails

This doc is the dedicated home of **Phase 2**, tree node `{#phase-2}`: its tasks, what is done and
what is left, its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-2 -->

<!-- roadmap-status: phase-2 -->
- [x] the controlled commit is MET LIVE — one real Kuali write on doc **4489**, dry run with zero durable rows, forced mismatch refused pre-fence, commit in 16.45 s proved by reload read-back, idempotent re-run `already-present` in 2 ms, both documents restored (D135, 2026-08-04)
- [x] the four tails landed in order against a proven spine — **2g** D134–D145 · **2h** D146–D167 · **2i** D168–D180 · **2j** D181–D190
- [x] the exit gate is CLOSED: every hard criterion MET 2026-08-09, with ONE criterion REASSIGNED (D186) and ONE NAMED GAP carried out (D189), each with a written trigger and an owner (§Left Phase 2 by explicit disposition, §Exit criteria)
- [x] 2j did its job as a gate — four defects every earlier green gate missed, all fixed: the unreachable restore path (D181), the dark `paper-ink` corpus, the two-pixel run-detail panel, the underivable receipt (D187)
- [ ] seven residuals ship WITH the phase, each owned by a later node — the notes emitter and the ledger drain, five unpublished notification arms, the knowledge projection, the retention sweep, the phone's delivery path, the empty capture bindings (see *What Phase 2 left standing*)
> 2026-08-21 | docs-cohesion 02 | verified against the five reference docs' own `p2-*` status blocks (`reference/{operator-trust,dashboard-surfaces,data-intake-and-edit-data,frontend-backend-integration,guards-and-tests}.md`) and spot-checked in `src/core/{write-sequencer,evidence-receipt}.ts`, `src/services/notifications/**`, `src/infra/ledger/**`, `src/infra/sqlite/migrations.ts` (v10–v13); left: the seven residuals below, each attributed

<!-- /roadmap-status -->

**Goal.** Prove the half the spine could not — a page-scoped external-write transaction with fresh
subject binding, crash recovery and durable dedupe — and **then**, only then, build the base tails
Phase 1 deferred, against a proven spine and a real consumer instead of synthetic fixtures.

**Order mattered, and it paid.** The transaction proof came FIRST because it is the cheapest
falsification of the write-safety contract, and every tail (evidence receipts, Edit Data over
checkpoints, intake manifests) is shaped by what the write path turns out to need. A tail built
before the proof is a tail built against a guess — and the proof did move the tails: D144 made a
transaction node a terminal dependency by moving the READER rather than the writer, which is the
shape 2g's receipt then reused twice (D199, D204).

**The read half arrived already proven.** Person-lookup was Phase 1's exit test (D74), so Phase 2
opened on a spine proven end to end: descriptor → contracts → one-item worker → worker-owned
browser session → spans → the one projection → the four surfaces. Its worked example is
`ref workflow-model` §8.1, marked as-built when that test passed.

### What Phase 2 proved and built

| | What it settled | Where the contract lives |
|---|---|---|
| **Transaction proof** (D122, D127–D130, D135) | one real Kuali write, fenced durable before the click, read back by reload; dry run, forced mismatch and idempotent re-run all refused or settled with zero durable rows | `ref write-safety` §Phase-2 controlled-commit as-built |
| **2g — event / trust layer** (D134–D145) | schema v10, redacted diagnostic capture, the durable actor-keyed inbox, knowledge/fix admission, the ordered ledger projector, D82's receipt DERIVED from authority | `ref operator-trust` §2 · §4 · §6 · §6.1 · §6.3 · `ref dashboard-surfaces` §2.6 |
| **2h — data / intake foundation** (D146–D167) | the 47-id canonical field registry, column mapping, validation/rejection, immutable manifests + rerun diff, the extraction/OCR/roster/normalization stores, the OCR three-producer routes and the classify/group scanner, provider + artifact wiring, durable capture sessions, the Edit Data core | `ref data-intake-and-edit-data` §1–§6 |
| **2i — the operator surface** (D168–D180) | trust surfaces + the bell, the Edit Data rail, Settings + storage doctor with a live backup cadence, the intake surface over schema v12, the token-scoped phone capture surface, the read-only Workflow Explorer, the UI catalog, AI advisories, the archive model + Activity over schema v13 | `ref operator-trust` §1.3 · §5.7 · §5.8 · `ref data-intake-and-edit-data` §2.7 · §5.1 · §5.2 · `ref dashboard-surfaces` §10.2–§13 |
| **2j — the closing gate** (D181–D190) | the scenario corpus and its two-direction audit, the corruption→restore drill (fixtures **and** once live on a copy of the standing database), the 3-worker soak and concurrency matrix, the redaction scan, the capability-inventory re-disposition, every owning doc to as-built | `ref operator-trust` §3 · §3.1 · `ref execution-and-sessions` §7.1 · `ref guards-and-tests` §3.11 · §3.15 · `ref dashboard-surfaces` §2.5 |

### What Phase 2 left standing

Phase 2 is **DONE**, and seven mechanisms it built have no production caller. None is a defect in
what was built — each is a complete, unit-proven mechanism whose producer or delivery path belongs
to a slice that had not been drawn yet. They are listed here so a reader deciding "is Phase 2
complete" is not surprised by them later, and each names the node that owns the fix.

| Residual | State at HEAD | Owner |
|---|---|---|
| the **notes stream** has no emitter | `emitNote` is composed and never called; `.tracker-rebuild/notes/` has never existed, while the Logs section re-reads it per request and a failed run OPENS on it | `{#observed-logs}` (03a) — `ref dashboard-surfaces` §1.1 |
| the **ledger projector** has no production caller | `createLedgerProjector` is written, unit-proven and guarded; only tests call it. Beat ⑦ writes the durable ledger OUTBOX row, so the audit floor is intact — nothing drains it to a file, and the composed READ half reads an empty corpus | **unowned — reported to the orchestrator**; `ref dashboard-surfaces` §1.2 states it in place |
| **five of seven notification trigger arms** have no publisher | `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure`, `verified-done`. The other two shipped as production publishers (D222 backup health, D262 the open operator gate) | each belongs to the surface or slice that owns the state it announces — `{#dash-defaults}` (03a) and the per-workflow `*-dash` nodes; `ref dashboard-surfaces` §2.6 |
| the **knowledge projection** is unwired | knowledge/fix admission is durable and audited inside its insert transaction (D139); the projection has no caller, so no `KNOWLEDGE.md` exists, and `explain failure <fingerprint>` is not built | `ref operator-trust` §4.1/§4.2 name it in place; no node owns it — **reported** |
| the **retention sweep** is uncalled | the retention-projection model is complete end to end and deliberately unwired (D164); the diagnostics/artifact sweep has no caller | `{#def-retention}` (04) — `never` by D193 |
| the **phone capture surface** has no delivery path | the BFF serves no frontend bytes, so `/capture.html` 404s outside the dev server; the tunnel launcher (D175) is unbuilt | `{#def-byte-path}` (04) — D189, builds at the first phone-consuming migration |
| **no workflow can receive a capture handoff** | `CAPTURE_INTAKE_BINDINGS` is empty, and saved-mapping reuse has no store, so every intake upload re-maps | `{#def-capture-binding}` (04) · `ref data-intake-and-edit-data` §2.3/§5.1 |

**What Phase 2 deliberately does not prove.** Workflow-specific gates and each production system's
receipt/verify quality stay migration-specific — the foundation write sequence is proven, each
workflow still owes its OWN §3.2 controlled-commit proof at its migration. Two later checkpoints
carry that forward, both in `03c`: the **first-gate live checkpoint** at order 4
(oath-signature/emergency-contact — the first live exercise of the completion union plus an approval
gate, park and resolve, end to end on the new base), and the **first workflow-specific production
write checkpoint** at order 6, which validates that workflow's receipt/probe policy on top of the
already-proven transaction kernel.

## Transaction proof — the first real write
<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
- [x] `kuali/save-timekeeper-annotation` is the one-transaction-node proving workflow — one benign, restorable field on a real Kuali RRSS document, with a reload read-back verifier because Kuali's save is UI-silent (D122; `src/domain/contracts/kuali/save-timekeeper-annotation.ts`)
- [x] **dry run**: 6.6 s, staged preview and subject observation, ZERO durable rows — no intent, no fence, no checkpoint (D135, 2026-08-04)
- [x] **forced subject mismatch**: refused at beat ②, zero fence and zero click (D135)
- [x] **ONE controlled commit** on real doc **4489**, 16.45 s, producing a `committed` intent, a transaction checkpoint whose proof is the verifier's reload read-back, both durable outbox rows and the terminal span (D135)
- [x] **idempotent re-run**: `already-present` in 2 ms, no browser and no second click (D135)
- [x] the propagation window MEASURED over four write/restore cycles on doc **4490**, moving this contract's `recoveryAbsence` from `operator-only` to `stabilized` — `minSinceFenceMs: 30_000`, 2 consistent reads 5 s apart, same source state required (`save-timekeeper-annotation.ts:119-125`)
- [x] both documents restored to their captured original `""`, each restore proved by reload read-back (D135)
- [x] the mutation-capability registry lives in `src/base/mutation-capability.ts` and `src/core/write-sequencer.ts` is the ONLY permitted mint, over a runtime-unforgeable WeakSet; `task-driver-boundary` refuses a `commit` outside a capability-validating store driver, against a violating fixture (D127; `commit-routes-through-mutation` retired into it by D188)
- [x] preview / binding / fenced write / read-back / parked-write resolution all reach the operator through the SAME production client (`ref frontend-backend-integration` §6.4, its own `p2-proof` block)
- [x] the proof is RECORDED, not re-runnable — re-running it would be a second real HR write (`ref guards-and-tests` §10.1)
> 2026-08-21 | docs-cohesion 02 | verified against `src/domain/contracts/kuali/save-timekeeper-annotation.ts`, `src/core/write-sequencer.ts`, `src/base/mutation-capability.ts` and the `p2-proof` blocks in `reference/{frontend-backend-integration,guards-and-tests}.md`; left: nothing in this node — each workflow still owes its OWN controlled-commit proof at its migration

<!-- /roadmap-status -->

**What had to be proven, and how.** Choose the smallest controlled record whose prepare and commit
paths are real and whose outcome is independently queryable; build its transaction pair; run the dry
run first and prove staged preview plus subject observation with zero intent and zero commit; inject
a wrong displayed subject and prove zero fence and zero click; then, and only under the explicit
Phase-2 test protocol, perform ONE controlled commit and prove permanent-key dedupe, typed recovery
proof, atomic outboxes, serialized ledger projection and context cleanup. The crash matrix covers an
early `absent`, a repeated but not-yet-aged absence, conflicting observations, stabilized absence,
positive proof, malformed proof and an unavailable target — only the policy-qualified stabilized arm
may create a new intent generation, and every indeterminate arm parks. Had no safe independently
verifiable target existed, Phase 2 would have been blocked and write-heavy migration could not have
begun.

**It is MET live on the operator's own documents (D135, 2026-08-04).** Every number above was
measured on real Kuali documents, not fixtures. `recoveryAbsence: stabilized` is scoped to **this
contract only** — it is a measured property of Kuali's save propagation, not a platform default:
`ucpath/create-termination` and `ucpath/delete-pending-terminations` both remain `operator-only`
precisely because nobody has measured a UCPath window, and inventing a `minSinceFenceMs` is the
banned unverified constant. (`kuali/save-separation-finalization` later inherited a stabilized
policy from its own separately measured window — chunk 5c — not from this one.)

**D128 was wrong the same day, and is withdrawn.** D128 concluded that the operator's documents sat
at a workflow step — `Task 1 - Kristina & TES` — that does not own the `Timekeeper Name:*` field.
Kuali's own `ActionPage` query reports that step's `sectionSettings` as `edit` for the section
holding the field, and the checkbox beside it binds instantly. The two real causes were defects in
**this** repository's driver: a Kuali text gadget debounces into the document model (~700 ms) and
the run fenced and clicked INSIDE that window, and `commit` returned at REQUEST time so the
verifier's `page.reload()` cancelled the in-flight save. Both are fixed and both are now proven on
the wire per run. The generalizable half is the one D128 got right before its conclusion went wrong:
a field being rendered and editable is not evidence the step can write it, and a positive save
signal — HTTP `200` plus a rendered *Form saved* — is worth nothing on its own.

**What the kernel did while the target was still disqualified.** During the D128 run the kernel
behaved exactly as designed: it fenced durable before the click, read back `absent`, parked the
intent `unknown`, wrote ZERO checkpoint / ledger / terminal-span rows, and a later run on the same
key refused in 1 ms with no browser. That is the proof's second result and it is worth as much as
the first — the write path is fail-closed under a target that cannot be written.

**What is still owed.** Write-heavy workflow migration is unblocked, and **each workflow still owes
its own §3.2 controlled-commit proof at its own migration** — the kernel is proven, a store's
receipt/probe policy is not. UCPath and ServiceNow targets are named per migration; OnBase is gated
on the next real upload. Full evidence, measured numbers and durable row ids:
`ref write-safety` §Phase-2 controlled-commit as-built.

## 2g — event / trust layer
<!-- roadmap: p2-2g -->

<!-- roadmap-status: p2-2g -->
- [x] **schema v10** — the five durable trust tables plus the indexed `failures.fingerprint` (D134; `src/infra/sqlite/migrations.ts`)
- [x] **automatic redacted diagnostic capture**, two-phase: `prepare` redacts and writes attachments to the content-addressed store with nothing durable moved, then the bundle `persist`s inside the SAME authority transaction as the terminal CAS (D137)
- [x] the **durable actor-keyed notification inbox** — the row commits before ANY OS delivery, a repeat FOLDS in place on `(actorId, dedupeFingerprint)`, and the trigger union is ids, closed codes and counts with no free-text argument (D134/D138; `notification-durability` active)
- [x] **knowledge / fix admission** audited INSIDE the insert transaction; insert-only, supersession expressed forward by the new record (D139; `knowledge-fix-integrity` active)
- [x] the **ordered actor-attributed ledger projector** — five ordered durable facts, `seq` assigned BEFORE the append so the window is repairable, partitioned by the entry's own `confirmedAt` in UTC (D145; `ledger-projector` active)
- [x] **D82's `RunEvidenceReceipt` DERIVED from authority**, not minted at settlement — a pure function of the run record, terminal result/failure, checkpoints + provenance and write intents, with declared per-field redaction and an UNDECLARED leaf failing loud (D140–D143)
- [x] the receipt survived three later corrections without changing shape: the stamp must be a fact about the RUN (D199), a gate's durable record is not a checkpoint (D203/D204), an unreachable wire arm is a false absence (D237)
- [ ] `createLedgerProjector` has **no production caller** — beat ⑦ writes the durable ledger OUTBOX row, so the audit floor is intact, but nothing drains it to a file and the composed read half reads an empty corpus (`ref dashboard-surfaces` §1.2); **unowned, reported**
- [ ] FIVE of the seven notification trigger arms have no publisher — `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure`, `verified-done`; the two that shipped are D222's backup-health watch and D262's open-operator-gate watch (`ref dashboard-surfaces` §2.6) → `{#dash-defaults}` and the per-workflow `*-dash` nodes
- [ ] the knowledge PROJECTION has no caller, so no `KNOWLEDGE.md` exists, and `explain failure <fingerprint>` is not built (`ref operator-trust` §4.1/§4.2); **unowned, reported**
> 2026-08-21 | docs-cohesion 02 | verified against the `p2-2g` blocks in `reference/{operator-trust,dashboard-surfaces,frontend-backend-integration,guards-and-tests}.md` and spot-checked in `src/core/{evidence-receipt,diagnostic-capture}.ts`, `src/services/notifications/**`, `src/infra/ledger/ledger-projector.ts`, `src/infra/sqlite/migrations.ts`; left: the three unwired producers above

<!-- /roadmap-status -->

**What 2g was.** The rest of the event/trust layer over 1f's minimal durable `FailureRecord` and
terminal-result authorities: automatic redacted diagnostic bundles, rich failure/evidence
projections, terminal run evidence receipts and `explain run`, the durable actor-keyed notification
inbox (read/unread and snooze per D79b), knowledge/fix records, and ordered actor-attributed ledger
projection with recovery verification. **D82's acceptance test applies to this tail:** the receipt
must let the operator complete their double-check without opening UCPath.

**COMPLETE 2026-08-04 → 08-08 (D134–D145).** Its normative contracts are `ref operator-trust` §2,
§4, §6, §6.1 and §6.3, and `ref dashboard-surfaces` §2.6 (the notification model) — each carries its
own `p2-2g` status block, and those blocks are the per-contract truth this section indexes.

**Two shapes 2g established that the rest of the program reuses.** First, **a durable record is
stamped with a fact about ITSELF** — which is why the receipt is derived rather than minted, why
`evidenceReceipts.insert` refuses a divergent rebuild by name, and why D199 later had to move the
stamp off the reading process's build fingerprint and onto the run's own retained one. Second, **when
a durable row and a reader disagree about a fact's shape, the READER moves** — D144's transaction
node as terminal evidence is the first instance, and D203/D204's gate-as-evidence and D237's
`gate_results` reader are the second and third. Both rules exist because the alternative in each
case was making a durable row lie about its own contents.

**The mutable row is deliberate and bounded.** The notification inbox is the ONE authority row that
is UPDATED: a repeated identical trigger folds into the row its `(actorId, dedupeFingerprint)` owns,
advancing `count`, `lastSeenAt` and a version by exactly one, because the folded firings leave no
rows to derive those values from and `ref dashboard-surfaces` §2.6 forbids spamming the inbox.
Identity and `createdAt` are frozen by trigger. The ledger tables in the SAME migration go the other
way — abort-on-delete, one `assigned → appended` transition, immutable seq/digest/partition. That
asymmetry is the point, and it must not leak: nothing that records what was actually filed is
mutable.

**D82 was met, but not on the day the receipt became derivable.** The receipt has been derivable
since D140–D144; the panel that renders it was **two pixels wide** at every viewport from 1i-spine
until 2j found it (D187), so the acceptance bar was unmet ON SCREEN through a dozen green gates. The
fix and its lesson belong to §2j below; what belongs here is that a derivation being correct is not
the same claim as an operator being able to read it.

## 2h — data / intake foundation
<!-- roadmap: p2-2h -->

<!-- roadmap-status: p2-2h -->
- [x] the **canonical field registry** is closed at 47 ids and frozen against the RECORDED D58/D68 scan, checked in both directions (D146; `src/domain/fields/registry.ts:56-110`, `config/canonical-field-inventory.json` at legacy `4deabc5a`)
- [x] **column mapping**: mapping identity, the layout fingerprint, per-cell coercion, the suggestion scorer and `defineIntakeProjection`'s object-identity proof, all bundle-safe (D147; `ref data-intake-and-edit-data` §2.1–§2.6)
- [x] **validation, rejection, the immutable intake manifest and the rerun diff**, on schema **v11**'s ABORT-on-rewrite authority (D148/D159; §5/§5.0/§4.9)
- [x] the **extraction / OCR / roster / normalization stores** — the extraction store's two tasks (D149/D152), the roster store with its honest port split (D163), the normalization store including D178's `ai` arm (D165/D178)
- [x] **OCR**: one admission gate three producers cannot bypass, the generated instruction, the form registry and the classify/group scanner (D151–D161), live-proven on the real 44-page I-9 scan
- [x] the **i9 sectioned form** (D160/D161)
- [x] **executor / worker provider + artifact wiring** (D162–D169), with `artifact-effect-boundary` active: the path-free content-addressed ref, temp→fsync→atomic-rename, crash-boundary recovery, byte-identical idempotency and an AST canary against direct filesystem access from a task impl
- [x] **durable capture sessions**, photo artifacts and the finalize outbox, crash matrix slimmed per D79d (D167)
- [x] the **Edit Data core** — `run.edit-checkpoint`, declaration-gated by `capabilities.editData`
- [x] the retention-projection model end to end, **unwired by design** (D164; §4.1)
- [x] **legacy change accounting RETIRED** (D150) — the two repositories stop touching each other; live re-verification at each workflow's migration replaces the diff
- [ ] two 2h designs have no caller and both are named in place: the saved-mapping STORE (§2.3 — every intake upload re-maps) and a descriptor that DECLARES an artifact projection (§4.1); **unowned, reported**
- [ ] descriptor-driven upload / capture / spreadsheet / bare START methods — no registered workflow declares one, so the run modal has one method kind (D251, `ref frontend-backend-integration` §5.1.1) → the first declaring workflow, `{#order-2}` (downloads) and `{#order-3}` (the OCR pipeline)
- [ ] progressive OCR **Review** records — the store exists; the `review` panel kind and its wire section are declared-unserved (D184) → `{#order-3}`
> 2026-08-21 | docs-cohesion 02 | verified against the `p2-2h` blocks in `reference/{data-intake-and-edit-data,frontend-backend-integration,guards-and-tests}.md` and spot-checked in `src/domain/{fields,intake,ocr}/**`, `src/stores/{extraction,roster,ocr,normalization}/**`, `src/infra/sqlite/migrations.ts:863-908`; left: the two uncalled designs and the two surfaces waiting on a declaring workflow

<!-- /roadmap-status -->

**What 2h was.** The data-service and intake foundation: the extraction / normalization / OCR /
roster stores; production provider pools, adapters and consumers over 1f's generic admission core;
generic duplicate-safe column mapping; strict validation and rejection; immutable intake manifests
plus the rerun diff; the OCR three-producer routes and the classify/group scanner stack (operator-
added scope, D151/D157/D158); the i9 sectioned form (D160); executor and worker provider plus
artifact wiring (D162); durable capture sessions, photo artifacts and the finalize outbox (D167);
the Edit Data core; and the stable-keyed local artifact projector.

**COMPLETE 2026-08-05 → 08-08 (D146–D167).** Its normative contracts are `ref
data-intake-and-edit-data` §1–§6, with the wire half in `ref frontend-backend-integration` §6.6 —
each carries its own `p2-2h` status block, and those blocks are the per-contract truth this section
indexes.

**The registry is closed, and closed against a RECORDED scan.** 47 canonical field ids, frozen
against the D58/D68 scan of the legacy corpus at a FIXED legacy commit, checked in both directions
by its guard: an id in the registry with no inventory row fails, and an inventory row with no id
fails. This is the shape the whole tail depends on — a mapping is only as trustworthy as the
vocabulary it maps INTO, and a vocabulary that can grow silently during a migration is a vocabulary
that cannot be diffed against what legacy actually had.

**What 2h changed about the two repositories.** D150 retired legacy change accounting: nothing here
reads legacy's working tree and legacy work blocks no rebuild gate. The risk that retirement had to
answer — a ported selector or page-state fact going stale after legacy fixed it — is covered by
**live re-verification at each workflow's migration**, which the charter already makes mandatory and
pre-authorized. A selector checked against the live system beats one diffed against legacy's copy of
it. `config/legacy-change-accounting.json` stays as a frozen historical record and is never extended;
`legacy-selector-port-provenance` is unaffected, because it pins all 406 keys to a FIXED legacy
commit's blobs.

**One design is unwired ON PURPOSE, and two are unwired by omission — the difference matters.** The
retention-projection model (§4.1, D164) is complete end to end and deliberately has no caller: its
sweep is `{#def-retention}`, ruled `never` by D193 unless the operator asks. The saved-mapping store
(§2.3) and an artifact-projection-declaring descriptor (§4.1) are different — nothing decided against
them, they simply have no consumer yet, which is why every intake upload re-maps from scratch today.
Both are named in place in the owning doc rather than left to be discovered; neither has a node, and
both are reported.

## 2i — the operator surface (A–G)
<!-- roadmap: p2-2i -->

<!-- roadmap-status: p2-2i -->
- [x] **2i-A/B, the trust surfaces + the bell** — the receipt and the failure record render from authority (`trust.tsx` over `queries/run-detail.ts`, D140/D142), and the durable inbox has a bell (D138; `ref frontend-backend-integration` §5.1.6)
- [x] **2i-C, the Edit Data rail** — the `context-data` wire carries the policy, `authority.version` is the generation token, drafts re-parse into the recorded scalar's type, and all five save arms plus the three consume arms are pinned (D168; `edit-data-field-policy` active)
- [x] **2i-D, Settings + the storage doctor + the live backup cadence** (D169) — one backup at process start, a coalesced verified backup on each 15-minute tick only when the store is dirty, and a graceful-drain backup inside `stop()` (`ref dashboard-surfaces` §2.5)
- [x] **2i-E, the intake surface over schema v12** — the durable session, the upload route, all six command arms and the first real projection (D170–D173; `ref data-intake-and-edit-data` §2.7/§2.8/§5.2)
- [x] **2i-F, the token-scoped phone capture surface** — the fragment token, the uniform refusal, the bundler and the derived handoff ids (D174/D175; `ref data-intake-and-edit-data` §5.1, `capture-durability-and-scope` active)
- [x] **2i-G, the read-only Workflow Explorer + the UI catalog** — the explorer is a projection of the ONE composition root, guarded in both directions over the REAL registry; source links RESOLVE against a real listing and a miss is `unresolved` carrying the path it tried; the catalog surface serves the COMMITTED artifact and refuses a stale one (D176/D177)
- [x] **AI advisories** — redaction, strict output, explicit provider exhaustion and zero authority edge, one fixture per arm plus `ai-advisory-no-authority` active (D178)
- [x] **the archive model + Activity report over schema v13** — UPDATE and DELETE aborted in SQL, the version bump, the ledger read-through, the CSV export (D179/D180/D223/D236/D240)
- [x] the rail's CAS-conflict arm — silently reported *saved* until D253 fixed it — is now exhaustive at the discriminant and guarded (`ref data-intake-and-edit-data` §6.4.1)
- [ ] the phone surface has **no production delivery path**: the BFF serves no frontend bytes, so `/capture.html` 404s outside the dev server (D189) → `{#def-byte-path}`
- [ ] **no workflow can receive a capture handoff** — `CAPTURE_INTAKE_BINDINGS` is empty → `{#def-capture-binding}`
- [~] Settings is read-only — `apply-settings` is the kernel's ONE deferred arm (`ref frontend-backend-integration` §3.4) → `{#def-settings}`
- [ ] six of seven **worker / session controls** have kernel arms and no control (`ref frontend-backend-integration` §5); **unowned, reported**
- [ ] the Explorer's **live-run overlay** and **scenario-coverage claims** stay excluded BY DECISION, not for want of a wire — run facts belong to the run-detail timeline, claims belong to the executable corpus (`ref operator-trust` §5.7)
- [ ] the Explorer's **EDIT half** is reassigned out of Phase 2 (D186) → `{#def-explorer-edit}`, and §Left Phase 2 by explicit disposition below
> 2026-08-21 | docs-cohesion 02 | verified against the `p2-2i` blocks in `reference/{operator-trust,data-intake-and-edit-data,frontend-backend-integration,guards-and-tests}.md`; spot-checked `src/dashboard/surfaces/{archive,activity,explorer,settings,context-rail}.tsx` and `src/server/dashboard/queries/explorer.ts`; left: the two delivery gaps, the Settings write path, the six worker controls, and both Explorer halves

<!-- /roadmap-status -->

**What 2i was.** The rest of the operator surface: evidence, failure, notification and run-explain
views; storage health and backups; Edit Data, intake and capture UI; the generated UI catalog;
optional read-only AI advisories; and the **read-only Workflow Explorer** over tasks, delegation,
scenarios and source links.

**COMPLETE 2026-08-09 (D168–D180).** Its normative contracts are `ref operator-trust` §1.3, §5.7 and
§5.8; `ref data-intake-and-edit-data` §2.7, §5.1 and §5.2; and `ref dashboard-surfaces` §10.2–§13,
with the wire half in `ref frontend-backend-integration` §6.7 — each carries its own `p2-2i` status
block, and those blocks are the per-contract truth this section indexes.

**Two exclusions here are DECISIONS, and one is a deferral — a reader must not confuse them.** The
Explorer's live-run overlay and its scenario-coverage *claims* are excluded because run facts belong
to the run-detail timeline and claims belong to the executable corpus; nothing is waiting on a wire
and nothing will change them without a new decision. The Explorer's **EDIT half** is different: it is
a Phase-2 exit criterion **reassigned** by D186 with a named trigger, recorded in full below and
owned by `{#def-explorer-edit}`.

**The credential that had to survive a QR (D174).** The capture token reaches a phone through a
scanned link, which looks like it forces a secret into a URL and breaks `ref clock-config-secrets`'
"no secret-bearing URLs" rule. It does not: a URL fragment is never transmitted to any server, so
`/capture.html#t=<token>` puts the credential in the one part of a link no proxy, access log or
`Referer` header can see, and the phone then presents it in a header. Because the asset URL carries
no token, the ingress allowlist is a fixed path set with nothing interpolated. Every way a token can
fail to name a live session — unknown, malformed, expired, discarded — answers **identically**,
because a varying refusal is an existence oracle on a public origin; refusals AFTER the token
resolves are named in full, since by then the caller has proven it holds the secret.

**2i built the surface; 2j found that one of them could not be read.** The run-detail panel that
renders the receipt and the failure record was **two pixels wide** at every viewport from 1i-spine
until D187, and the accessibility tree reported every word of it. That is why this tail's completion
date and D82's acceptance date differ, and it is the reason the parity corpus exists in the form it
does — see §2j.

## 2j — the closing gate
<!-- roadmap: p2-2j -->

<!-- roadmap-status: p2-2j -->
- [x] the **executable scenario corpus** and `scenario-coverage`, audited in BOTH directions, plus D185's corpus-layout audit — a file of neither kind, an unregistered claim and a manifest row nothing executes all fail (`ref operator-trust` §3/§3.1, `ref guards-and-tests` §3.10)
- [x] the **corruption → restore drill**, twice: in fixtures over a seeded real-shaped database through `composeStorageCommand`, and ONCE live on a COPY of the standing local authority database — corruption named read-only in 0.92 s, restore in 0.99 s, doctor healthy in 0.71 s, with 14 runs / 2 checkpoints / 2 write intents / 2 outbox rows preserved including the real Kuali controlled commit's durable footprint (D181; `ref dashboard-surfaces` §2.5)
- [x] the **dependency / control / capture concurrency matrix** and the **3-worker × 30-run soak** — `projectAll()` reports every ledger partition `projected` and the whole-database invariant sweep is `valid` (D182; `ref execution-and-sessions` §7.1)
- [x] the **redaction surface scan** — `redaction-surface-scan` is the one sweep over every egress class (D183; `ref guards-and-tests` §3.15)
- [x] the **capability-inventory re-disposition** (D184/D188) — 27 entries closed with real targets, the rest moved to the milestone that will genuinely build them, and the guard now refuses an entry `open` at or before the runtime's own `completedThrough`, an unresolvable target, and evidence that only says "the legacy file still exists"
- [x] **D190** closed the safety-critical coverage floor (70.08 % → 99.43 % on `run-queue-projection.ts`) and **D191** made `test:coverage` the per-commit gate
- [x] every owning doc brought to as-built
- [ ] `ScenarioManifest`'s preflight fault set has **no runner** and `preflight-coverage` stays `planned` with D188's real trigger — the first migration that adds one; the declaration side is held by `runtime-dependency-coverage` (`ref operator-trust` §3.1, `ref guards-and-tests`)
- [ ] the **component layer has no test lane** — this tree renders no React outside the parity corpus, and the parity lane is OUTSIDE the per-commit gate, so a `.tsx` change is gated only by typecheck/lint/unit until someone runs `npm run test:parity` → `{#test-tiers}`
- [ ] **D91's BRANCH half is UNMET** and its Phase-2-exit trigger has passed: `coverage.thresholds` configures lines/statements/functions only, so branches are report-only at a measured 71.76 % (`ref guards-and-tests` §3.14/§10.10) → `{#test-tiers}`
- [ ] **D85 parts 2 and 3 never landed** — there is no `cli test workflow <id> --dry-run` and no `TestTargetRegistry` (`ref guards-and-tests` §10.5/§10.9) → `{#test-tiers}` under R10
- [ ] the 14/8/5 retention sweep and a configurable backup path — both `wont-build-unless-asked` by D193 → `{#def-retention}`
> 2026-08-21 | docs-cohesion 02 | verified against the `p2-2j` blocks in `reference/{operator-trust,guards-and-tests,frontend-backend-integration,dashboard-surfaces}.md`; left: the preflight runner, the component/parity lane, D91's branch half and D85's parts 2–3, all four owned by `{#test-tiers}` or D188's migration trigger

<!-- /roadmap-status -->

**What 2j was.** The base integration / restore / soak / documentation gate: the full scenario
corpus, the corruption→restore drill, the dependency / control / capture concurrency matrix, worker
teardown and the multi-worker soak, the redaction scan, capability-inventory validation, and then
every owning doc updated to as-built.

**COMPLETE 2026-08-09 (D181–D190).** Its normative contracts are `ref operator-trust` §3 and §3.1,
`ref execution-and-sessions` §7.1, `ref guards-and-tests` §3.11 and §3.15, and `ref
dashboard-surfaces` §2.5, with `03c` §Non-workflow capability closure inventory holding the D58
closure — each carries its own `p2-2j` status block.

### What 2j found, because that is what a gate is for

Four real defects, every one of them green on every earlier gate.

1. **`cli storage restore` could not have worked.** The offline restore service has demanded a
   one-time stopped-system proof since Phase 1c, and `RecoveryStopProofStore` refuses to issue one
   without a recorded `RecoveryRuntimeLockSnapshot` — but **nothing in production had ever recorded a
   snapshot**: `recordRuntimeState` had no caller and `.tracker-rebuild/locks`, pinned as a distinct
   isolated resource since D88, was never created. The whole restore path was complete, tested and
   unreachable from its first day (D181). The fix is one lock file per role, written before the
   authority database opens and released after its handle closes, with the snapshot COMPOSED at
   observation time from both files — a shared snapshot would need a read-modify-write from two
   processes, and a lost update there would report a running server as stopped. Liveness is
   OBSERVED (`process.kill(pid, 0)`, `EPERM` counts as alive) and the observation writes nothing: a
   crashed holder must not brick recovery at the one moment it is needed, and rewriting another
   process's lock file to make a restore possible would be fabricating the fact.
2. **Every `paper-ink` parity reference had been photographed DARK** since the corpus existed. The
   harness stamped `data-demo-theme` on `<html>`/`<body>` with a post-navigation `page.evaluate`,
   while `LoadedApp` renders its own on the app root and `tokens.css` scopes the palette off the
   BARE selector — so the root re-themed its subtree from inside, out of React state nothing had
   touched. The semantic half AGREED with the pixels, so there was nothing to diff. The fix is
   `page.addInitScript` seeding the product's own stored preference BEFORE navigation, plus an
   `assertThemeApplied` that refuses when the three writers disagree (D187).
3. **The run-detail panel was two pixels wide** at every viewport since 1i-spine. Its root is a flex
   child that never claimed a width, so it sized to content and its own
   `grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail)]` resolved to `2px 376px` — the entire column
   holding the failure record and the evidence receipt. The accessibility tree reported every word,
   which is exactly why review after review passed over an empty column, and why **D82's acceptance
   bar was unmet ON SCREEN through a dozen green gates and two deliberate reference reviews** (D187).
4. **`buildRunEvidenceReceipt` answered HTTP 500 on a reachable path.** It minted a `verificationId`
   for every node but emitted the verification row conditionally, while a downstream derived fact
   cites its upstream nodes by that same mint — so `assertEvidenceRefsResolve` correctly refused the
   whole receipt whenever an upstream node had no checkpoint. That is `ref workflow-model` §5.4's
   `startAt` resume with injected context, i.e. the Edit Data path: production-reachable, not a
   fixture corner. Every record-less node now emits `unknown`, which is the honest verdict and
   exactly what the verification section is for (D187).

**The rule the four share.** Each was invisible because something ADJACENT to the broken thing was
working: the accessibility tree reported the panel's words, the semantic half agreed with the dark
pixels, the restore path's own unit tests passed over a precondition production never produced, and
the receipt derived fine for every run whose nodes all had checkpoints. **When a test asserts through
one representation of a surface, something must assert the other** — and a reference corpus nobody
looks at records defects instead of catching them.

## Left Phase 2 by explicit disposition
<!-- roadmap: phase2-dispositions -->

<!-- roadmap-status: phase2-dispositions -->
- [x] **D186** — the Workflow Explorer's EDIT half is REASSIGNED out of Phase 2, on D79a's own argument one level down; the trigger that ends the deferral is named (`ref operator-trust` §5.3) and §5.4's apply protocol is unchanged by it
- [x] **D189** — the production BFF **serves no frontend bytes**, so `dashboard:prod` names a mode the runtime never parsed and 2i-F's phone capture surface has no delivery path; deferred deliberately, with an owner (`ref frontend-backend-integration` §6.9)
- [x] **D79a** — the DSL graph-authoring mode is CUT ENTIRELY, and reinstating it requires a new explicit operator architecture decision; a migration questionnaire cannot enable it
- [x] both dispositions confirmed 2026-08-12 and carried onto the deferral shelf — `{#def-explorer-edit}` → 04 §Edit a workflow's presentation / policy without a code change, `{#def-byte-path}` → 04 §Run the dashboard without the dev server / use the phone page in production
- [ ] neither is a waiver: each ships as a named criterion with a trigger and an owner, and `config/legacy-capabilities.json`'s `legacy-route-static` stays honestly **open**
> 2026-08-21 | docs-cohesion 02 | verified against `reference/decisions.md` D186/D189, `ref operator-trust` §5.3, `ref frontend-backend-integration` §6.9 and 04's two deferral sections; left: nothing to decide here — both are owned on the shelf

<!-- /roadmap-status -->

**Two Phase-2 criteria left the phase by explicit disposition, not by silence.** Both are recorded
in full in §Exit criteria below with their evidence; this section is the statement of WHY each was
allowed to leave, and where it now lives.

**1 · The Workflow Explorer's EDIT half — REASSIGNED (D186, 2026-08-09).** The read-only explorer
shipped in 2i-G and its criterion is MET. Phase B — the constrained editor — is deferred on D79a's
own argument applied one level down: **an editor exists to avoid a code change per tweak across MANY
workflows, and this tree has one production workflow plus the one-node transaction proof.** Building
it now would fix its closed policy union and its override schema against a sample of one, which is
the most expensive way to get a schema wrong. The criterion is reassigned, not waived: `ref
operator-trust` §5.3 names the trigger that ends the deferral — the **second** production workflow
whose presentation or policy an operator wants to change without a code change — and §5.4's apply
protocol (compile + scenario + diff + version bump + restart-gated atomic apply + rollback) is
unchanged by the delay. `workflow-editor-compile-integrity` holds Phase A's read-only boundary today
and its inventory entry records that it carries no Phase-B arms. **Owner:** `{#def-explorer-edit}`,
04 §Edit a workflow's presentation / policy without a code change.

**What the editor may never express, whenever it is built (D79a — DSL mode TRIMMED).** Editing is
limited to presentation overrides, hot-applied through their strict atomic file, plus a closed set of
safe typed policy fields. **The DSL graph-authoring mode is cut entirely** — no second authoring
pipeline, no codegen, no exclusive source-vs-DSL mode, no synthetic workflow built to prove it. The
questionnaire's own phrasing expected everything real to stay source-authored, and no concrete
DSL-authored workflow was ever named. Selectors, driver operations, schemas, bind functions and
write-proof/subject rules stay **code-only**; anything the closed editor cannot express generates a
**code-change brief**, never partial config. Reinstating the mode requires a new, explicit operator
architecture decision — a migration questionnaire cannot enable it.

**2 · The production BFF serves no frontend bytes — NAMED GAP (D189, 2026-08-09).**
`http-server.ts` has no static handler and `api.ts` 404s every unrouted path, so `npm run
dashboard:prod` names a mode the runtime never parses, and **2i-F's token-scoped phone capture
surface has no delivery path in production** — `/capture.html` is allow-listed by the Host gate and
nothing serves it. Nothing regresses: the operator's working path has always been the Vite dev
server on 5174 beside the BFF on 3938. It is deferred deliberately for two reasons that compound.
Those bytes would be served on the one surface exposed to the public internet, through the capture
ingress, behind the gate whose whole contract is *"a phone origin reaches capture routes and nothing
else"* — so shipping them is a security change, not a build-config change. And the tunnel launcher
(D175) is unbuilt anyway, so static bytes alone would not make the phone reachable. **Owner:** the
first migration that needs the phone in production, building both halves plus the guard arm;
`{#def-byte-path}`, 04 §Run the dashboard without the dev server / use the phone page in production.
`ref frontend-backend-integration` §6.9 is the normative record, and
`config/legacy-capabilities.json`'s `legacy-route-static` stays honestly **open**.

## Integration amendment — Phase 2's share

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §7.1's two deferral bullets and §7.2's transaction-proof / `2g` / `2h` / `2i` rows on 2026-08-20 (3b); re-verified 2026-08-21 against `ref frontend-backend-integration`'s own `p2-*` status blocks._

**Why this table exists.** Every Phase-2 tail had a wire half, and the risk the amendment answers is
protocol breakage: a surface built later against a shape the kernel had already frozen. The rule was
that only boundary primitives and command-family type shells land early, where `1b`/`1c`/`1e` need
them; everything else waits for its tail. Both deferrals held.

- Data-service contract/impl work and its mapping / capture / Edit Data UI were deferred to `2h`
  under D74; only their boundary primitives and command type shells landed earlier.
- Product Settings, Archive, Explorer, Activity, rich evidence/failure projections and bundles,
  intake/capture and progressive Review were Phase-2 tails; their wire primitives and command-family
  type shells landed earlier only where `1b`/`1c`/`1e` needed them.

| Item | Integration addition | Exit evidence | State at HEAD |
|---|---|---|---|
| **Transaction proof** | preview, binding, fenced write, read-back, receipt/failure, write-parked resolution and command conflict, all through the same production client | the trust UI is backed by real intent/proof/ledger state, never fixture prose | **MET** — `ref frontend-backend-integration` §6.4's `p2-proof` block records nothing left on the integration side |
| **2g** | Receipt / Failure / captures over 1f's minimal durable failure/result authority, rerun diff, notifications and search, archive snapshot generation and lazy detail resources | terminal and archived runs stay explainable without live-system or old-code access | **MET, two sections unserved** — capture BYTES on the receipt and the `context-evidence` rail section, both blocked on the artifact byte route (§3.6, D184) |
| **2h** | descriptor upload / capture / spreadsheet starts, intake mapping and manifests, progressive Review records, Edit Data | complete upload→review→manifest/fan-out and correction→same-run/new-run flows | **MET for spreadsheet + Edit Data + capture authority**; the descriptor-driven start methods and the Review surface wait on a declaring workflow (D251/D184) |
| **2i** | Settings / doctor / storage, Archive and version bump, Explorer overlay, Activity, worker/session controls, the remaining product shell states | every product surface in `ref frontend-backend-integration` §5 has query / patch / command / authority coverage | **MET except three**: Settings is read-only (`apply-settings` deferred), six of seven worker controls have kernel arms and no control, and both Explorer halves stay out (§5, D186) |

Every "state at HEAD" cell above is the summary of a `p2-*` status block in `ref
frontend-backend-integration`; that doc is the per-contract truth, and this table is the index.

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 22 | 2026-08-04 | D122 | **the proof target**: the Kuali RRSS timekeeper annotation, its reload read-back arm, the one permitted capability mint, and `actionId` instability |
| 25–27 | 2026-08-04 | D127–D130 | the identity-gate scope for the proof; the controlled commit and what the target taught (D128 — later withdrawn by D135 — and D129); the UCPath receipt probe (D130) |
| 28–29 | 2026-08-04 | D132–D133 | the parity lane that could not fail; the config leaf that bricked every existing database (read-forward, never back-filled) |
| 30–34 | 2026-08-04 | D134–D145 | **tail 2g** — the Kuali write lands and D128 is withdrawn (D135), the parked write outliving a refactor (D136), diagnostic capture (D137), the durable inbox (D138), knowledge records (D139), the receipt derived from authority (D140–D143), a transaction node as terminal evidence (D144), the ledger projector (D145) |
| 35–38 | 2026-08-05 → 08-08 | D146–D169 | **tail 2h** — the canonical field vocabulary (D146–D149), the two repositories stop touching each other (D150) and the OCR/scanner stack (D151–D159), the i9 sectioned form (D160/D161), the executor as provider consumer (D162–D169) |
| 39–44 | 2026-08-09 | D170–D180 | **tail 2i** — the durable intake session (D170/D171), the intake grid's consumer (D172/D173), the phone reaching capture and nothing else (D174/D175), the explorer + catalog surface (D176/D177), the advisory that never becomes evidence (D178), the archive model and the report that reads it (D179/D180) |
| 45 | 2026-08-09 | D181–D190 | **tail 2j, the gate** — the restore path that could not have worked (D181), the soak (D182), the capability inventory re-disposition (D184/D188), **D186** the explorer's EDIT half reassigned, **D187** the dark parity corpus / two-pixel panel / underivable receipt, **D189** the production BFF serves no frontend bytes |

**D131 is a retired gap — never reuse it.**

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 2's hard exit criteria, with every bullet's final disposition) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Hard exit criteria (Phase 2) — ALL MET 2026-08-09, with ONE criterion explicitly REASSIGNED
(the explorer's edit half, D186).** Every bullet below carries its final disposition. The one
reassignment is not a waiver: ref operator-trust §5.3 names the trigger that ends the deferral, and §5.4's apply
protocol is unchanged by it.
- *(Live person-lookup, `descriptor-coverage`, surface rendering, and speed sanity all moved to
  Phase 1's exit—see D74. The historical D13 live-lift parity gate remains rejected: D88 isolates
  the runtimes. New surfaces are validated by strict fixtures + isolated live proof, per §4.)*
- ~~Docs updated: ref workflow-model §8 marked as-built; any contract flaw found is fixed in the owning doc
  first.~~ **MET 2026-08-09 (2j).** Ref workflow-model §8.1 is the as-built: the worked example ran live as
  D74's exit test, and §8.1 records the five deltas the live run forced (D121/D122 fold identity,
  D123 `skipped`, D124 terminal duration, D125 session-acquire bound, D172's union input) plus what
  §8 structurally does not exercise. Every contract flaw the live runs found was fixed in its owning
  doc first, in the same commit that recorded it — that is the D-series discipline itself.
- ~~Transaction dry-run shows prepare preview and zero commit span/intent. Controlled write proof
  records a fresh matching subject proof; the forced mismatch/unknown variants produce no intent or
  click. The controlled match yields one external transaction, one committed intent, one typed
  transaction-output checkpoint plus validated proof, one ledger entry, one terminal span; a later
  fresh same-key run performs no second click.~~ **ALL MET live 2026-08-04 (D135).** Dry run 6.6 s
  with zero durable rows; the forced mismatch refused at beat ② with zero fence and zero click; ONE
  controlled commit on doc **4489** in 16.45 s producing a `committed` intent, a transaction
  checkpoint whose proof is the verifier's reload read-back, both outbox rows and the terminal span;
  the idempotency re-run answered `already-present` in 2 ms with no browser and no second click.
  *(This bullet read **NOT MET (D128)** until 2026-08-09. D128 concluded the operator's documents sat
  at a step that did not own the field; D135 withdrew that conclusion the SAME DAY — Kuali's own
  `ActionPage` query reports the step's `sectionSettings` as `edit`, and the two real causes were
  defects in this repository's driver: a ~700 ms gadget debounce the run fenced inside, and a
  `commit` that returned at request time so the verifier's reload cancelled the in-flight save. The
  exit line was simply never updated to match §3.8 and ref write-safety §Phase-2 controlled-commit as-built,
  both of which recorded MET on 2026-08-04.)*
- ~~Crash/outbox fixtures and context-exclusive lease tests remain green under
  multiple workers.~~ **MET 2026-08-04, and closed out in 2j (D182).** Over the REAL Kuali store and a real authority database:
  crash injection at every inner four-row-primitive seam and every outer beat-⑦ seam, the present /
  absent recovery arms, browser-context cleanup on a post-fence park, and two workers on one
  database admitting exactly one fence. ~~**The ordered LEDGER PROJECTOR fixtures are not buildable
  yet** — beat ⑦ writes the ledger outbox row, but the serialized JSONL projector is a 2g tail and
  does not exist, so its concurrency/tail-loss arms move to 2g with it.~~ **The projector landed in
  2g (D145) and its arms landed with it:** `tests/unit/ledger-projector.test.ts` pins two projectors
  racing one `(system,date)` lease with no duplicate sequence, crash catch-up with exact-byte
  re-derivation, and the torn-tail / gap / duplicate / digest-mismatch refusals, with
  `ledger-projector` active. 2j's soak closes the last of it: after 3 workers × 30 runs on one
  database, `projectAll()` reports every partition `projected` and the whole-database invariant
  sweep is `valid` (ref execution-and-sessions §7.1, D182). Recovery demonstrates that one `absent` observation cannot retry, durable
  `not_before` scheduling occupies no worker, and only contract-qualified negative
  settlement may increment the generation.
- ~~Read-only explorer accurately renders the as-built person-lookup graph/task/UI/scenario/result
  dependencies and exact source links.~~ **MET 2026-08-09 (2i-G, D176).** The projection is derived
  from the ONE composition root and `workflow-editor-compile-integrity` asserts the round-trip over
  the REAL registry in both directions — node identities/order/kinds/`dependsOn` equal
  `descriptorRuntimeNodes`, rendered task ids equal `workflowProjections(...).contracts`, every UI id
  equals the catalog's own `taskUses`, and every printed source link resolves to a git-tracked file.
  Ref operator-trust §5.7 records the two named exclusions (the live-run overlay; scenario coverage *claims*).
  ~~Every supported constrained edit passes compile+scenario+
  diff+version+restart-gated atomic apply+rollback; every prohibited code/selector/proof edit
  refuses loudly and generates a code-change brief.~~ (No DSL authoring mode exists to test — D79a.)
  **The EDIT half is Phase B and is DEFERRED OUT OF PHASE 2 by D186 (2026-08-09)**, on D79a's own
  argument one level down: an editor exists to avoid a code change per tweak *across many
  workflows*, and this tree has one production workflow plus the one-node transaction proof, so
  building it now would fix its closed policy union and override schema against a sample of one.
  The criterion is **reassigned, not waived** — ref operator-trust §5.3 names the trigger that ends the
  deferral (the second production workflow whose presentation/policy an operator wants to change
  without a code change) and §5.4's apply protocol is unchanged by it. `workflow-editor-compile-
  integrity` holds Phase A's read-only boundary today and its inventory entry records that it
  carries no Phase-B arms.
- **Tail criteria** (formerly Phase-1 exits, now due here) — **ALL MET; the last two closed
  2026-08-09 in 2j.**
  - ~~every terminal fixture emits a complete evidence receipt/confidence or a structured failure +
    redacted diagnostic bundle, and **D82 is demonstrated on a real receipt** — the operator
    completes a double-check from the row alone.~~ **MET 2026-08-09 (D187).** The receipt has been
    derivable since D140–D144, but the panel that renders it was **two pixels wide** at every
    viewport since 1i-spine — the accessibility tree reported every word while the screen showed an
    empty column, so D82's acceptance bar was unmet ON SCREEN while passing every gate. The panel
    now claims its width, `buildRunEvidenceReceipt` no longer refuses a run whose upstream node has
    no checkpoint, and the corpus carries its first POPULATED receipt reference — derived from
    authority through adapter #2, because a receipt cannot be authored (D141).
  - ~~Failed OS notification delivery still leaves a durable unread inbox item.~~ **MET
    2026-08-08 (D138)**; `notification-durability` is active and pins the order — the row is
    committed before any delivery is attempted, and a delivery that throws is never written back.
  - ~~Capture fixtures prove open/finalizing sessions survive restart and that duplicate/reordered
    requests do not duplicate photos or handoffs; the phone origin cannot reach a non-capture
    route.~~ **MET 2026-08-09 (2h-F D167 + 2i-F D174/D175).** Restart-with-open-session,
    restart-mid-finalize converging to ONE artifact and ONE handoff, no duplicate photos/handoffs,
    and failed→retry-finalize are pinned in `tests/unit/capture-durability.test.ts`; the
    token-scoped closed union with fail-closed enumeration and the Host gate are pinned in
    `tests/unit/server/capture-surface.test.ts`, with `capture-durability-and-scope` active. 2j's
    C9/C10 add the two-caller kernel race and the two-projector race over one pending outbox.
  - ~~AI-advisory fixtures prove redaction, strict output, explicit provider exhaustion, and zero
    authority edge.~~ **MET 2026-08-09 (2i-G, D178)**, one fixture per arm plus the activated
    `ai-advisory-no-authority` guard; ref operator-trust §4.4 is the as-built.
  - ~~A real-shaped copied authority DB passes corruption → read-only degraded mode →
    checksummed-backup restore → projection rebuild with claims/dependencies/checkpoints/intents/
    outboxes/capture handoffs intact.~~ **MET 2026-08-09 (2j, D181).** Drilled twice: in fixtures
    over a seeded real-shaped database through `composeStorageCommand`
    (`tests/unit/storage-restore-drill.test.ts`), and ONCE live on a COPY of the standing local
    authority database — corruption named read-only in 0.92 s, restore in 0.99 s, doctor healthy in
    0.71 s, with 14 runs / 2 checkpoints / 2 write intents / 2 outbox rows preserved including the
    real Kuali controlled commit's durable footprint. `cli storage restore` did not exist before
    this slice and could not have: nothing in production had ever recorded the runtime-lock
    snapshot its stopped-system proof is derived from. Measured numbers: ref dashboard-surfaces §2.5 D181.
- **NAMED GAP carried out of Phase 2, not met-by-silence (2j, D189): the production BFF serves no
  frontend bytes.** `http-server.ts` has no static handler and `api.ts` 404s every unrouted path, so
  `npm run dashboard:prod` names a mode the runtime never parses and **2i-F's token-scoped
  phone capture surface has no delivery path in production** — `/capture.html` is allow-listed by
  the Host gate and nothing serves it. Nothing else regresses: the operator's working path has
  always been the Vite dev server on 5174 beside the BFF on 3938. It is deferred deliberately —
  those bytes would be served on the one surface exposed to the public internet through the capture
  ingress, behind the gate whose whole contract is "a phone origin reaches capture routes and
  nothing else", and the tunnel launcher (D175) is unbuilt anyway, so static bytes alone would not
  make the phone reachable. Owner: the first migration that needs the phone in production, building
  both halves plus the guard arm. Ref frontend-backend-integration §6.9 is the normative record;
  `config/legacy-capabilities.json`'s `legacy-route-static` stays honestly **open**.
- ~~**Archive model (D80) proven**~~ — **MET 2026-08-09 (2i-G, D179).** All five clauses are pinned
  in `tests/unit/archive-model.test.ts` against the real authority database and the real command
  kernel, one `it` per clause: a bump archives the prior-version run and leaves the current-version
  one alone (and the run ROW survives — archiving is a display lifecycle, not a delete);
  `buildArchivedRunDetail` renders a stored record with the descriptor list **empty**, which is the
  only way "zero old-version code paths" is checkable; a ledger partition written before the bump
  is **byte-identical** after it; relaunch mints a run carrying the CURRENT version and fingerprint,
  is not a retry, leaves the archived record identical and refuses a stale content digest; and a
  non-terminal prior-version run refuses the apply by name with **nothing archived at all**, not
  even the run that was eligible. Registry drift between review and apply is a sixth fixture.
  `archive-invariants` is active. Ref dashboard-surfaces §10.2's *D179 — the archive model as-built* is the
  normative record.
