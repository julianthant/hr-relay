# Phase 2 · Prove writes and build the tails

**2026-09-09 planning amendment.** The reopened [Phase 2.6](2.6-revalidate-tails-against-canonical-authorities/README.md)
now includes the approved database modernization through visible prerequisite/parallel tasks 2.6.2–8, starting with naming-only changes, before nested final proof at 2.6.8.3 and closure at 2.6.9.
Its [single folder](2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md)
includes remaining timeline T2; active T1 and completed earlier work are preserved. Historical
Phase-2 completion statements below do not claim this new work is implemented or accepted.

This doc is the dedicated home of **Phase 2**, tree node `{#phase-2}`: what historical Parts 2.1–2.5
proved and built, what they left by explicit disposition, and reopened 2.6 downstream revalidation
after 1.6; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-2 -->

<!-- roadmap-status: phase-2 -->
- [x] the controlled commit is MET LIVE — one real Kuali write on doc **4489**, dry run with zero durable rows, forced mismatch refused pre-fence, commit in 16.45 s proved by reload read-back, idempotent re-run `already-present` in 2 ms, both documents restored (D135, 2026-08-04)
- [x] the four tails landed in order against a proven spine — **2g** D134–D145 · **2h** D146–D167 · **2i** D168–D180 · **2j** D181–D190
- [x] the exit gate is CLOSED: every hard criterion MET 2026-08-09, with ONE criterion REASSIGNED (D186) and ONE NAMED GAP carried out (D189), each with a written trigger and an owner (§Left Phase 2 by explicit disposition, §Exit criteria)
- [x] 2j did its job as a gate — four defects every earlier green gate missed, all fixed: the unreachable restore path (D181), the dark `paper-ink` corpus, the two-pixel run-detail panel, the underivable receipt (D187)
- [x] historical Parts **2.1–2.5** are complete and retain their evidence
- [ ] **2.6** waits for 1.6, then migrates/re-proves downstream read models, joins, and operator services without redesigning or rewriting append-only evidence
- [ ] seven residuals ship WITH the phase, each owned by a later node — the notes emitter and the ledger drain, five unpublished notification arms, the knowledge projection, the retention sweep, the phone's delivery path, the empty capture bindings (see *What Phase 2 left standing*)
> 2026-09-03 | D326/D327 authority reset | 1.6 owns stores, lifecycle/configuration writers, and core resolution; 2.6 owns downstream consumers and non-mutating revalidation only
> 2026-09-05 | D334 operator correction | historical Edit Data checkpoint mutation is superseded; 1.6.4 removes the writer, 2.6 Task 1-2 serves read-only completed-value/provenance candidates, and 3.1 Task 11-2 owns the source-bound Rerun modal
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
| the **notes stream** has no emitter | `emitNote` is composed and never called; `.tracker-rebuild/notes/` has never existed, while the Logs section re-reads it per request and a failed run OPENS on it | `{#observed-logs}` (03.1) — `ref dashboard-surfaces` §1.1 |
| the **ledger projector** has no production caller | `createLedgerProjector` is written, unit-proven and guarded; only tests call it. Beat ⑦ writes the durable ledger OUTBOX row, so the audit floor is intact — nothing drains it to a file, and the composed READ half reads an empty corpus | **unowned — reported to the orchestrator**; `ref dashboard-surfaces` §1.2 states it in place |
| **five of seven notification trigger arms** have no publisher | `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure`, `verified-done`. The other two shipped as production publishers (D222 backup health, D262 the open operator gate) | each belongs to the surface or slice that owns the state it announces — `{#dash-defaults}` (03.1) and the first admitted workflow that requires a workflow-specific producer; `ref dashboard-surfaces` §2.6 |
| the **knowledge projection** is unwired | knowledge/fix admission is durable and audited inside its insert transaction (D139); the projection has no caller, so no `KNOWLEDGE.md` exists, and `explain failure <fingerprint>` is not built | `ref operator-trust` §4.1/§4.2 name it in place; no node owns it — **reported** |
| the **retention sweep** is uncalled | the retention-projection model is complete end to end and deliberately unwired (D164); the diagnostics/artifact sweep has no caller | `{#def-retention}` (04) — `never` by D193 |

**What Phase 2 deliberately does not prove.** Workflow-specific gates and each production system's
receipt/verify quality stay migration-specific — the foundation write sequence is proven, each
workflow still owes its OWN §3.2 controlled-commit proof at its migration. Each admitted Phase 4
packet (`ref workflow-model` §1.6.2) must name any first-gate live checkpoint and every
workflow-specific production-write checkpoint it requires. D319/D329 retire the old preassigned
order numbers as build authority; candidate evidence may inform the packet but cannot schedule it.

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
| **2i** | Settings / doctor / storage, Archive and version bump, Explorer overlay, Activity, worker/session controls, the remaining product shell states | every product surface in `ref frontend-backend-integration` §5 has query / patch / command / authority coverage | **MET for bounded Settings** — DCC1–DCC3 supplies editor/apply/readback/preflight; broader Settings capabilities retain named deferrals. The worker-control and Explorer residues retain their owning dispositions (§5, D186). |

Every "state at HEAD" cell above is the summary of a `p2-*` status block in `ref
frontend-backend-integration`; that doc is the per-contract truth, and this table is the index.

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings and checked 2026-08-21 against its
`_phase: 2_` markers — **23 rounds carry the marker and all 23 are indexed below** (rounds 23 and 24
are Phase 1's; round 46 onward is `platform`). The ratification act and the normative pointer stay
in the ledger; this is the phase index and nothing here is normative._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 22 | 2026-08-04 | D122 | **the proof target** — the Kuali RRSS timekeeper annotation, its reload read-back arm, the one permitted capability mint, and `actionId` instability |
| 25–27 | 2026-08-04 | D127–D130 | the identity-gate scope for the proof (D127); the controlled commit and what the target taught (D128 — **later withdrawn by D135** — and D129); the UCPath receipt probe (D130) |
| 28–29 | 2026-08-04 | D132–D133 | the parity lane that could not fail; the config leaf that bricked every existing database (read-forward, never back-filled) |
| 30–34 | 2026-08-04 | D134–D145 | **tail 2g** — the Kuali write lands and D128 is withdrawn (D135), the parked write outliving a refactor (D136), diagnostic capture (D137), the durable inbox (D138), knowledge records (D139), the receipt derived from authority (D140–D143), a transaction node as terminal evidence (D144), the ledger projector (D145) |
| 35–38 | 2026-08-05 → 08-08 | D146–D169 | **tail 2h** — the canonical field vocabulary (D146–D149), the two repositories stop touching each other (D150), the OCR/scanner stack (D151–D159), the i9 sectioned form (D160/D161), the executor as provider consumer (D162–D169) |
| 39–44 | 2026-08-09 | D170–D180 | **tail 2i** — the durable intake session (D170/D171), the intake grid's consumer (D172/D173), the phone reaching capture and nothing else (D174/D175), the explorer + catalog surface (D176/D177), the advisory that never becomes evidence (D178), the archive model and the report that reads it (D179/D180) |
| 45 | 2026-08-09 | D181–D190 | **tail 2j, the gate** — the restore path that could not have worked (D181), the soak (D182), the redaction sweep (D183), the capability-inventory re-disposition (D184/D188), the corpus-layout audit (D185), **D186** the explorer's EDIT half reassigned, **D187** the dark parity corpus / two-pixel panel / underivable receipt, **D189** the production BFF serves no frontend bytes, **D190** the safety-critical coverage floor |

**D131 is a retired gap — never reuse it.**

**Two decisions that BIND Phase 2 were ratified after it closed, and are `platform`, not Phase 2.**
D191 (2026-08-12) made `test:coverage` the per-commit gate on D190's own recommendation, and D193
(2026-08-12) confirmed both Phase-2 dispositions and set the Phase-3 entry. They are cited in the
sections above as evidence; they are not counted here, because the ledger's phase markers own that
question and this table must agree with them.

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 2's hard exit criteria, with every bullet's final disposition) on 2026-08-20 (3b); re-verified and re-cast as a checklist on 2026-08-21._

**The gate is CLOSED. Every hard criterion is MET as of 2026-08-09 (D181–D190), with ONE criterion
REASSIGNED (D186) and ONE NAMED GAP carried out (D189).** Neither is a waiver — each names a
trigger and an owner, and both are stated in full in §Left Phase 2 by explicit disposition above.

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | **Docs updated** — `ref workflow-model` §8 marked as-built; any contract flaw found is fixed in the owning doc first | **MET** 2026-08-09 (2j) | §8.1 is the as-built: the worked example ran live as D74's exit test and records the five deltas that run forced (D121/D122 fold identity, D123 `skipped`, D124 terminal duration, D125 session-acquire bound, D172's union input) plus what §8 structurally does not exercise. Every contract flaw the live runs found was fixed in its owning doc first, in the same commit that recorded it — the D-series discipline itself |
| 2 | **Transaction dry-run + controlled write proof** — preview with zero commit span/intent; a fresh matching subject proof; forced mismatch/unknown produce no intent or click; the match yields ONE external transaction, one committed intent, one typed transaction-output checkpoint plus validated proof, one ledger entry, one terminal span; a later fresh same-key run performs no second click | **ALL MET LIVE** 2026-08-04 (D135) | Dry run 6.6 s with zero durable rows; mismatch refused at beat ② with zero fence and zero click; ONE commit on real doc **4489** in 16.45 s producing a `committed` intent, a transaction checkpoint proved by the verifier's reload read-back, both outbox rows and the terminal span; the idempotency re-run answered `already-present` in 2 ms with no browser. *(This line read **NOT MET (D128)** until 2026-08-09 — a bookkeeping lag, not a finding: D135 withdrew D128 the SAME DAY and both §Transaction proof and `ref write-safety` §Phase-2 controlled-commit as-built recorded MET on 08-04.)* |
| 3 | **Crash / outbox fixtures and context-exclusive lease tests green under multiple workers** | **MET** 2026-08-04, closed out in 2j (D182) | Over the REAL Kuali store and a real authority database: crash injection at every inner four-row-primitive seam and every outer beat-⑦ seam, the present/absent recovery arms, browser-context cleanup on a post-fence park, and two workers on one database admitting exactly one fence. Recovery demonstrates that one `absent` observation cannot retry, that durable `not_before` scheduling occupies no worker, and that only contract-qualified negative settlement may increment the generation |
| 4 | **The ordered ledger projector's concurrency / tail-loss arms** *(moved into 2g when the projector did)* | **MET** (D145, soaked D182) | `tests/unit/ledger-projector.test.ts` pins two projectors racing one `(system,date)` lease with no duplicate sequence, crash catch-up with exact-byte re-derivation, and the torn-tail / gap / duplicate / digest-mismatch refusals; `ledger-projector` active. 2j's soak closes it: after 3 workers × 30 runs on one database, `projectAll()` reports every partition `projected` and the whole-database invariant sweep is `valid` (`ref execution-and-sessions` §7.1) |
| 5 | **Read-only explorer renders the as-built graph / task / UI / scenario / result dependencies and exact source links** | **MET** 2026-08-09 (2i-G, D176) | The projection derives from the ONE composition root and `workflow-editor-compile-integrity` asserts the round-trip over the REAL registry in both directions — node identities/order/kinds/`dependsOn` equal `descriptorRuntimeNodes`, rendered task ids equal `workflowProjections(...).contracts`, every UI id equals the catalog's own `taskUses`, and every printed source link resolves to a git-tracked file. `ref operator-trust` §5.7 records the two named exclusions |
| 5b | *…and every supported constrained EDIT passes compile + scenario + diff + version + restart-gated atomic apply + rollback* | **REASSIGNED** by D186, not waived | No DSL authoring mode exists to test (D79a). The Phase-B editor is deferred on D79a's own argument one level down — a sample of one production workflow would fix its closed policy union and override schema. `ref operator-trust` §5.3 names the trigger (the second production workflow whose presentation/policy an operator wants to change without a code change); §5.4's apply protocol is unchanged. `workflow-editor-compile-integrity` holds Phase A's read-only boundary and its inventory entry records that it carries no Phase-B arms. Owner: `{#def-explorer-edit}` |
| 6 | **Every terminal fixture emits a complete evidence receipt/confidence or a structured failure + redacted diagnostic bundle, and D82 is demonstrated on a REAL receipt** — the operator completes a double-check from the row alone | **MET** 2026-08-09 (D187) | Derivable since D140–D144, but unmet ON SCREEN until 2j: the panel rendering it was two pixels wide at every viewport since 1i-spine while the accessibility tree reported every word. The panel now claims its width, `buildRunEvidenceReceipt` no longer refuses a run whose upstream node has no checkpoint, and the corpus carries its first POPULATED receipt reference — derived from authority, because a receipt cannot be authored (D141) |
| 7 | **A failed OS notification delivery still leaves a durable unread inbox item** | **MET** 2026-08-08 (D138) | `notification-durability` active and pinning the order — the row commits before any delivery is attempted, and a delivery that throws is never written back |
| 8 | **Capture fixtures** — open/finalizing sessions survive restart; duplicate/reordered requests do not duplicate photos or handoffs; the phone origin cannot reach a non-capture route | **MET** 2026-08-09 (2h-F D167 + 2i-F D174/D175) | Restart-with-open-session, restart-mid-finalize converging to ONE artifact and ONE handoff, no duplicate photos/handoffs, and failed→retry-finalize in `tests/unit/capture-durability.test.ts`; the token-scoped closed union with fail-closed enumeration and the Host gate in `tests/unit/server/capture-surface.test.ts`, `capture-durability-and-scope` active. 2j's C9/C10 add the two-caller kernel race and the two-projector race over one pending outbox |
| 9 | **AI-advisory fixtures** — redaction, strict output, explicit provider exhaustion, zero authority edge | **MET** 2026-08-09 (2i-G, D178) | One fixture per arm plus the activated `ai-advisory-no-authority` guard; `ref operator-trust` §4.4 is the as-built |
| 10 | **A real-shaped copied authority DB passes corruption → read-only degraded → checksummed-backup restore → projection rebuild**, with claims / dependencies / checkpoints / intents / outboxes / capture handoffs intact | **MET** 2026-08-09 (2j, D181) | Drilled twice: in fixtures over a seeded real-shaped database through `composeStorageCommand` (`tests/unit/storage-restore-drill.test.ts`), and ONCE live on a COPY of the standing local authority database — corruption named read-only in 0.92 s, restore in 0.99 s, doctor healthy in 0.71 s, with 14 runs / 2 checkpoints / 2 write intents / 2 outbox rows preserved including the real Kuali commit's durable footprint. `cli storage restore` did not exist before this slice and could not have — nothing in production had ever recorded the runtime-lock snapshot its stopped-system proof derives from (`ref dashboard-surfaces` §2.5) |
| 11 | **Archive model (D80) proven** | **MET** 2026-08-09 (2i-G, D179) | All five clauses pinned in `tests/unit/archive-model.test.ts` against the real authority database and the real command kernel, one `it` per clause: a bump archives the prior-version run and leaves the current-version one alone (and the run ROW survives); `buildArchivedRunDetail` renders a stored record with the descriptor list **empty**, the only way "zero old-version code paths" is checkable; a ledger partition written before the bump is byte-identical after it; relaunch mints a run carrying the CURRENT version and fingerprint, is not a retry, leaves the archived record identical and refuses a stale content digest; and a non-terminal prior-version run refuses the apply by name with **nothing archived at all**. Registry drift between review and apply is a sixth fixture; `archive-invariants` active |
| 12 | **The production BFF serves frontend bytes** | **NAMED GAP** carried out by D189, not met-by-silence | `http-server.ts` has no static handler and `api.ts` 404s every unrouted path, so `dashboard:prod` names a mode the runtime never parses and 2i-F's phone capture surface has no delivery path. Nothing regresses — the operator's path has always been Vite on 5174 beside the BFF on 3938. Deferred deliberately: those bytes ride the one internet-exposed path behind the capture Host gate, and the tunnel launcher (D175) is unbuilt, so bytes alone would not make the phone reachable. Owner: the first migration that needs the phone in production → `{#def-byte-path}`; `ref frontend-backend-integration` §6.9 normative; `legacy-route-static` stays honestly **open** |

*(Live person-lookup, `descriptor-coverage`, surface rendering and speed sanity all moved to Phase 1's
exit under D74. The historical D13 live-lift parity gate stays rejected — D88 isolates the runtimes,
and new surfaces are validated by strict fixtures plus isolated live proof.)*

### What ships WITH the phase, and who owns it

Phase 2 is complete; nine mechanisms it built have no production caller or no delivery path. None
blocks the exit — each is listed so a later reader is not surprised, and each names its owner.

| Residual | Owner |
|---|---|
| the notes stream has no emitter (`emitNote` composed, never called) | `{#observed-logs}` — 03.1 |
| `createLedgerProjector` has no production caller (the beat-⑦ outbox row IS durable) | **unowned — reported** |
| five of seven notification trigger arms have no publisher | `{#dash-defaults}` — 03.1, and the first admitted workflow that requires each workflow-specific producer |
| the knowledge projection has no caller; `explain failure <fingerprint>` unbuilt | **unowned — reported** |
| the retention sweep has no caller; the 14/8/5 policy and a configurable backup path | `{#def-retention}` — 04, `never` by D193 |
| Broader legacy Settings capabilities remain deferred; the bounded editor, backend `apply-settings`, persisted readback and preflight controls are active under DCC1–DCC3 | `{#def-settings}` — 04 |
| six of seven worker / session controls have kernel arms and no control | **unowned — reported** |

At Phase 2 exit, four **test-lane** gaps left 2j the same way. D329 now assigns the mutable shared
test work to `{#workflow-authoring-core}`, the per-workflow cases to the two 3.2 acceptance tasks,
and the final audit to `{#workflow-candidate-freeze}`; the exception remains the
first: `preflight-coverage` stays `planned` behind D188's trigger (the first migration that adds a
preflight runner); there is no component render lane and the parity lane sits outside the per-commit
gate; D91's BRANCH half is unmet at a measured 71.76 %. D85's parts 2 and 3 did not land in Phase 2;
R10 later built them as `cli dry-run-scenario`, `config/test-subjects.json` and durable result rows.

**And the standing obligation Phase 2 hands forward:** the transaction kernel is proven, so
write-heavy migration is unblocked — but **each workflow still owes its OWN controlled-commit proof
at its own migration**, because a store's receipt and probe policy is not proven by another store's.

## Subphase plans

- [Phase 2.1 · Controlled write proof](2.1-controlled-write-proof/README.md)
- [Phase 2.2 · Evidence and operator trust](2.2-evidence-and-operator-trust/README.md)
- [Phase 2.3 · Data and intake foundation](2.3-data-and-intake-foundation/README.md)
- [Phase 2.4 · Operator services and read models](2.4-operator-services-and-read-models/README.md)
- [Phase 2.5 · Closing verification](2.5-closing-verification/README.md)
- [Phase 2.6 · Revalidate tails against canonical authorities](2.6-revalidate-tails-against-canonical-authorities/README.md)
