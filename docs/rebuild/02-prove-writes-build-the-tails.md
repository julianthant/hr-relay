# 02 · Phase 2 — prove writes, build the tails

This doc is the dedicated home of **Phase 2**, tree node `{#phase-2}`: its tasks, what is done and
what is left, its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-2 -->

<!-- roadmap-status: phase-2 -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2 — the transaction proof, then the deferred base tails) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Goal.** Prove the half the spine could not: a page-scoped external-write transaction with fresh
subject binding, crash recovery, and durable dedupe. **Then**, and only then, build the base tails
that Phase 1 deferred — now against a proven spine and a real consumer instead of synthetic
fixtures.

**Order matters here.** The transaction proof comes FIRST, before the tails. It is the cheapest
possible falsification of the write-safety contract, and every tail (evidence receipts, Edit Data
over checkpoints, intake manifests) is shaped by what the write path actually turns out to need. A
tail built before the transaction proof is a tail built against a guess.

**The read half already happened.** Person-lookup was Phase 1's exit test (D74), so the spine
arrives here already proven end to end: descriptor → contracts → one-item worker → worker-owned
browser session → spans → the one projection → the four surfaces. Its worked example
is in doc 02 §8; mark it as-built when the exit test passes.

**Then: the deferred base tails.** Each was a Phase-1 work item that D74 moved behind the first
live proof. They land in this order, because each is a consumer of the one before:

**What Phase 2 still does not prove.** Workflow-specific gates and each production system's receipt/
verify quality remain migration-specific. The foundation write sequence itself is no longer deferred
to order 6. One later checkpoint remains:
- **First-gate live checkpoint — order 4** (oath-signature/emergency-contact): the first live exercise
  of the completion union + an approval gate (park/resolve) end to end on the new base.
- **First workflow-specific production write checkpoint — order 6** validates that workflow's
  receipt/probe policy on top of the already-proven transaction kernel.

## Transaction proof — the first real write
<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's transactional work items and its target status) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Transactional work items.** Choose the smallest controlled test-instance or sacrificial test
record whose prepare and commit paths are real and whose outcome is independently queryable. Build
its transaction pair. First run dry-run and prove staged preview plus subject observation capability
with zero intent/commit. Inject a wrong displayed subject and prove zero fence/click. Then, only
under the explicit Phase-2 test protocol, perform one controlled commit, inject process crashes at
the supported seams in repeatable fixtures, and prove permanent-key dedupe, typed recovery proof,
atomic outboxes, serialized ledger projection, and context cleanup. The crash matrix includes an
early `absent`, repeated but not-yet-aged absence, conflicting observations, stabilized absence,
positive proof, malformed proof, and unavailable target; only the policy-qualified stabilized arm
may create a new intent generation, while every indeterminate arm parks. If no safe independently
verifiable target exists, Phase 2 is blocked; write-heavy workflow migration may not begin.
**Target status (§3.8) — as-built 2026-08-04 (D135; supersedes the same-day D128 revision).** The
Kuali write half is **MET live on the operator's own documents.** Every Phase-2 write criterion
except the 2g ledger projector is now met against doc **4489**: dry run 6.6 s with zero durable rows;
forced mismatch refused at beat ②; ONE controlled commit in 16.45 s producing a `committed` intent,
a transaction checkpoint whose proof is the verifier's reload read-back, and both outbox rows; the
idempotency re-run answering `already-present` in 2 ms with no browser and no second click; the
propagation window measured over four write/restore cycles on doc 4490 so `recoveryAbsence` moved
from `operator-only` to `stabilized`; and both documents restored to their captured original `""`
with each restore proved by reload read-back.

The same-day D128 conclusion — that step `Task 1 - Kristina & TES` does not own the
`Timekeeper Name:*` field — **was wrong and is withdrawn.** Kuali's own `ActionPage` query reports
that step's `sectionSettings` as `edit` for the section holding the field, and the checkbox beside it
binds instantly. Two defects in THIS repository's driver were hiding the write: a Kuali text gadget
debounces into the document model (~700 ms) and the run fenced and clicked inside that window, and
`commit` returned at REQUEST time so the verifier's `page.reload()` cancelled the in-flight save.
Both are fixed and both are now proven on the wire per run. UCPath and ServiceNow targets are still
being named; OnBase is gated on the next real upload. Full evidence, measured numbers and durable row
ids: doc 09 §Phase-2 controlled-commit as-built.

## 2g — event / trust layer
<!-- roadmap: p2-2g -->

<!-- roadmap-status: p2-2g -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's deferred-base-tails table, row 2g) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| Tail | Content | Owner |
|---|---|---|
| **2g** | Rest of the event/trust layer over 1f's minimal durable `FailureRecord` and terminal-result authorities: automatic redacted diagnostic bundles, rich failure/evidence projections, terminal run evidence receipts + `explain run`, durable actor-keyed notification inbox (read/unread + snooze per D79b), knowledge/fix records, and ordered actor-attributed ledger projection + recovery verification. **D82 acceptance test applies here:** the receipt must let the operator complete their double-check without opening UCPath | Docs 03/09/11/12 |

## 2h — data / intake foundation
<!-- roadmap: p2-2h -->

<!-- roadmap-status: p2-2h -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's deferred-base-tails table, row 2h) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| Tail | Content | Owner |
|---|---|---|
| **2h** | Data-service/intake foundation: extraction/normalization/ocr/roster stores; production provider pools/adapters/consumers over 1f's generic admission core; generic/duplicate-safe column mapping; strict validation/rejection; immutable intake manifests + rerun diff; the OCR three-producer routes + classify/group scanner stack (operator-added scope, D151/D157/D158); the i9 sectioned form (D160); executor/worker provider + artifact wiring (D162); durable capture sessions/photo artifacts/finalize outbox (crash matrix slimmed per D79d); Edit Data core; stable-keyed local artifact projector. **COMPLETE 2026-08-08 (D146–D167).** | Docs 01/03/06/12 |

## 2i — the operator surface (A–G)
<!-- roadmap: p2-2i -->

<!-- roadmap-status: p2-2i -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's deferred-base-tails table, row 2i) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| Tail | Content | Owner |
|---|---|---|
| **2i** | Rest of the operator surface: evidence/failure/notification/run-explain views, storage health/backups, Edit Data + intake + capture UI, generated UI catalog, optional read-only AI advisories, and the **read-only Workflow Explorer** over tasks/delegation/scenarios/source links. **COMPLETE 2026-08-09 (D168–D180).** The explorer's EDIT half (doc 12 §5.3/§5.4 Phase B) is the one named exclusion — see the exit criteria below. | Docs 03/06/12 |

## 2j — the closing gate
<!-- roadmap: p2-2j -->

<!-- roadmap-status: p2-2j -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's deferred-base-tails table, row 2j) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| Tail | Content | Owner |
|---|---|---|
| **2j** | Base integration/restore/soak + documentation gate: full scenario corpus, corruption→restore drill, dependency/control/capture concurrency matrix, worker teardown/multi-worker soak, redaction scan, capability-inventory validation, then update every owning doc to as-built. **COMPLETE 2026-08-09 (D181–D186).** | Docs 03/05/10/12 + this plan |

## Left Phase 2 by explicit disposition
<!-- roadmap: phase2-dispositions -->

<!-- roadmap-status: phase2-dispositions -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 2's workflow-editor scope) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Workflow editor scope (D79a — DSL mode TRIMMED).** The read-only explorer is 2i. Editing is
limited to presentation overrides (hot-applied through their strict atomic file) plus a closed set
of safe typed policy fields, each passing compile + scenario + diff + version-bump +
restart-gated atomic apply + rollback. **The DSL graph-authoring mode is cut entirely** — no
second authoring pipeline, no codegen, no exclusive source-vs-DSL mode, no synthetic workflow
built to prove it. §b Q12's own phrasing expected everything real to stay source-authored, and no
concrete DSL-authored workflow was ever named. Selectors, driver operations, schemas, bind
functions, and write-proof/subject rules stay code-only; anything the closed editor cannot express
generates a **code-change brief**, never partial config. Reinstating the mode requires a new,
explicit operator architecture decision; a migration questionnaire cannot enable it.

**The two criteria that left Phase 2 by explicit disposition** — the explorer's EDIT half (D186)
and the production BFF serving no frontend bytes (D189) — are recorded in full, with their triggers
and their owners, in §Exit criteria below, where 07 §3 wrote them.

## Integration amendment — Phase 2's share (07 §7)

_Moved from 07-master-plan §7.1's two deferral bullets and §7.2's transaction-proof / `2g` / `2h` / `2i` rows on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

- Data-service contract/impl work and its mapping/capture/Edit Data UI are deferred to `2h` under
  D74; only their boundary primitives and command type shells land earlier where required.
- Product Settings, Archive, Explorer, Activity, rich evidence/failure projections and bundles,
  intake/capture, and
  progressive Review remain Phase-2 tails; their wire primitives and command-family type shells
  land earlier only where `1b`/`1c`/`1e` need them to prevent later protocol breakage.

| Existing item | Integration addition | Exit evidence |
|---|---|---|
| **Phase-2 transaction proof** | wire preview, binding, fenced write, read-back, receipt/failure, write-parked resolution and command conflict through the same production client | the trust UI is backed by real intent/proof/ledger state, never fixture prose |
| **2g** | Receipt/Failure/captures over 1f's minimal durable failure/result authority, rerun diff, notifications/search, archive snapshot generation and lazy detail resources | terminal and archived runs remain explainable without live-system or old-code access |
| **2h** | descriptor upload/capture/spreadsheet starts, intake mapping/manifests, progressive Review records and Edit Data | complete upload→review→manifest/fan-out and correction→same-run/new-run flows |
| **2i** | Settings/doctor/storage, Archive/version bump, Explorer overlay, Activity, worker/session controls and remaining product shell states | every product surface in doc 13 §5 has query/patch/command/authority coverage |

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

_Moved from 07-master-plan §3 (Phase 2's hard exit criteria, with every bullet's final disposition) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Hard exit criteria (Phase 2) — ALL MET 2026-08-09, with ONE criterion explicitly REASSIGNED
(the explorer's edit half, D186).** Every bullet below carries its final disposition. The one
reassignment is not a waiver: doc 12 §5.3 names the trigger that ends the deferral, and §5.4's apply
protocol is unchanged by it.
- *(Live person-lookup, `descriptor-coverage`, surface rendering, and speed sanity all moved to
  Phase 1's exit—see D74. The historical D13 live-lift parity gate remains rejected: D88 isolates
  the runtimes. New surfaces are validated by strict fixtures + isolated live proof, per §4.)*
- ~~Docs updated: doc 02 §8 marked as-built; any contract flaw found is fixed in the owning doc
  first.~~ **MET 2026-08-09 (2j).** Doc 02 §8.1 is the as-built: the worked example ran live as
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
  exit line was simply never updated to match §3.8 and doc 09 §Phase-2 controlled-commit as-built,
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
  sweep is `valid` (doc 05 §7.1, D182). Recovery demonstrates that one `absent` observation cannot retry, durable
  `not_before` scheduling occupies no worker, and only contract-qualified negative
  settlement may increment the generation.
- ~~Read-only explorer accurately renders the as-built person-lookup graph/task/UI/scenario/result
  dependencies and exact source links.~~ **MET 2026-08-09 (2i-G, D176).** The projection is derived
  from the ONE composition root and `workflow-editor-compile-integrity` asserts the round-trip over
  the REAL registry in both directions — node identities/order/kinds/`dependsOn` equal
  `descriptorRuntimeNodes`, rendered task ids equal `workflowProjections(...).contracts`, every UI id
  equals the catalog's own `taskUses`, and every printed source link resolves to a git-tracked file.
  Doc 12 §5.7 records the two named exclusions (the live-run overlay; scenario coverage *claims*).
  ~~Every supported constrained edit passes compile+scenario+
  diff+version+restart-gated atomic apply+rollback; every prohibited code/selector/proof edit
  refuses loudly and generates a code-change brief.~~ (No DSL authoring mode exists to test — D79a.)
  **The EDIT half is Phase B and is DEFERRED OUT OF PHASE 2 by D186 (2026-08-09)**, on D79a's own
  argument one level down: an editor exists to avoid a code change per tweak *across many
  workflows*, and this tree has one production workflow plus the one-node transaction proof, so
  building it now would fix its closed policy union and override schema against a sample of one.
  The criterion is **reassigned, not waived** — doc 12 §5.3 names the trigger that ends the
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
    `ai-advisory-no-authority` guard; doc 12 §4.4 is the as-built.
  - ~~A real-shaped copied authority DB passes corruption → read-only degraded mode →
    checksummed-backup restore → projection rebuild with claims/dependencies/checkpoints/intents/
    outboxes/capture handoffs intact.~~ **MET 2026-08-09 (2j, D181).** Drilled twice: in fixtures
    over a seeded real-shaped database through `composeStorageCommand`
    (`tests/unit/storage-restore-drill.test.ts`), and ONCE live on a COPY of the standing local
    authority database — corruption named read-only in 0.92 s, restore in 0.99 s, doctor healthy in
    0.71 s, with 14 runs / 2 checkpoints / 2 write intents / 2 outbox rows preserved including the
    real Kuali controlled commit's durable footprint. `cli storage restore` did not exist before
    this slice and could not have: nothing in production had ever recorded the runtime-lock
    snapshot its stopped-system proof is derived from. Measured numbers: doc 03 §2.5 D181.
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
  both halves plus the guard arm. Doc 13 §6.9 is the normative record;
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
  `archive-invariants` is active. Doc 03 §10.2's *D179 — the archive model as-built* is the
  normative record.
