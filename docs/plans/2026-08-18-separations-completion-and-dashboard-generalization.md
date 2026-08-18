# Separations completion & dashboard generalization — plan, conformance, decisions (2026-08-18)

> Operator-requested planning document. Answers four questions: (1) is "complete the separations
> backend + frontend, properly connected" the next plan; (2) are we following the rebuild plans,
> and where have we drifted; (3) have the plans been updated to account for the drift; (4) what is
> needed from the operator, in enough detail to decide. Plus the gist of how the plans are
> structured, and the operator's own realization checked against them.
>
> SSOT reminder: this file is a PLAN, not authority. Doc 07 owns phases/exit criteria;
> `docs/migrations/separations.md` §6 owns the separations checklist. If this file disagrees with
> those, they win.

---

## 1 · Direct answers first

| Question | Answer |
|---|---|
| Is "complete separations backend + frontend, connected" the next plan? | **Yes** — with one correction of ordering forced by facts: the backend's only remaining work (the three controlled commits) is **blocked on you** naming §4f2 canary targets, so the immediate executable work is the frontend/wire completion — which is exactly your own realization (§3 below). Backend commits run the day you name targets. |
| Are we following the rebuild plans properly? | **Substantially yes.** The Phase 3 loop (doc 07 §3.1), the bottom-up chunking directive, MAP-EVERYTHING, lego recomposition, zero-writes discipline, and the ratify-in-owning-doc rule have all been honored — every one of the 62 decision rounds through D221 landed in its owning doc. See the conformance table (§5). |
| How have we drifted? | Three kinds: **(a) ratified additions** — work the original plan didn't number but which was absorbed properly (the demo-fidelity dashboard wave, the findings-ledger policy, the wire-hookup protocol); **(b) plan-text staleness** — five named spots where a doc's status sentence lags what later commits settled; **(c) zero silent divergence found** — nothing was built against the plans without being recorded. Details in §5. |
| Have the plans been updated for the drift? | **Mostly.** The additions are ratified (doc 13 normative sentences, `docs/findings/README.md` policy, D219/D220/D221 entries). The five stale spots are NOT yet fixed — they are Track 0 of this plan (§6). ROADMAP.md was regenerated 2026-08-16. |

---

## 2 · The gist of how the plans are structured

Understanding this answers *where any given fact lives* and *why the drift audit is even possible*.

| Layer | What it is | Files |
|---|---|---|
| **Owning docs (normative)** | Each doc OWNS its contracts. A decision is not ratified until its normative text lands in the owning doc, same commit. | `docs/rebuild/00`–`13` — charter · task contract · workflow model · tracker dashboard · (04 below) · parallelism · data intake · **master plan (phases + exit criteria)** · gap audit · write safety · guards · clock/config/secrets · operator trust · frontend-backend integration |
| **Decision changelog (pointer index)** | One line per decision D1–D221, pointing at the owning doc. Never implemented from. | `docs/rebuild/04-reconciliation.md` |
| **Per-migration doc** | Questionnaire answers (§4/§5), exit checklist (§6), and the dated as-built ledger (§9.x) for one workflow. | `docs/migrations/separations.md` |
| **Derived views (regenerated, never authoritative)** | Operator tracking; store catalog. Regenerated at slice boundaries; owning docs win on disagreement. | `ROADMAP.md` · `STORES.md` |
| **Findings ledger** | Backend problems found during frontend sessions are RECORDED here, never fixed in-session; unplanned frontend features get a record instead of being built. Lifecycle: recorded → diagnosed → triaged → **deleted when landed in the owning doc**. | `docs/findings/` (7 files) |
| **Working plans** | Session-scoped execution plans (like this one). The detail-fidelity plan carries the **wire-hookup ledger** — the definitive frontend↔backend connection worklist. | `docs/plans/` |
| **Guard manifests** | Every architecture guard registered both directions; `pending-wire-bindings.json` makes an unserved wire field a DECLARED fact a test enforces, not a hope. | `docs/rebuild/guard-inventory.json` · `config/pending-wire-bindings.json` |

**The two structural principles that matter for this plan:**

1. **Doc 07 §3.1's per-workflow loop** — questionnaire → build → guards → live dry-run →
   **controlled commit on an operator-named target** → rebuild-ready → close-out. Separations is at
   the controlled-commit step; nothing goes live before the single cutover regardless.
2. **The dashboard is workflow-agnostic by construction** — one projection (doc 03 §2.3), actions
   and titles and roles served from descriptors (doc 13 §8.5, D219/D220), gate packets computed
   server-side (doc 09 §14), the archive readable with the descriptor list EMPTY (D179), the
   explorer reading descriptors generically. **Nothing on the dashboard is separations-specific.**

---

## 3 · Your realization, checked against the plans

> *"…the plan should be we should complete all the functionality of the dashboard from the
> separations workflow and build it in the way the plans mentioned so that all the other workflows
> can use that as well — archive runs, versioning, workflow explorer, run modal, etc."*

**This is already the plans' architecture — you are not proposing a change, you are ratifying the
ordering.** Two existing decisions say exactly this:

- **D193** chose separations as the Phase 3 entry *because a big multi-system workflow forces the
  store task libraries into existence* — one migration mints what every later workflow reuses.
- The same argument, one layer up, is what the detail-fidelity wave + wire-hookup ledger already
  do for **surfaces**: every field the queue row, run modal, context rail, archive card, or gate
  panel needs is grown on the GENERIC wire schema and served from the ONE projection — separations
  is merely the first workflow rich enough (18 nodes, a gate, 3 transactions, a ledger line, an
  archive-worthy terminal) to exercise every arm.

So the plan below treats **separations as the forcing function for completing the dashboard**, and
"complete" is defined by three closed lists that already exist: the **wire-hookup ledger** (~17
rows still `to declare`), the **findings ledger** (~24 open records), and the detail-fidelity
plan's five named tails. When those lists are empty and one composed separations run renders
correctly on every surface, the dashboard is done *for every future workflow*, not just this one.

---

## 4 · What we have done (compressed; ROADMAP.md §1–§3 has the full record)

| Area | State |
|---|---|
| Platform (kernel, write safety, evidence, storage, intake, capture, restore) | **Done and proven** — Phases 0–2 closed; controlled commit proven live (D135) |
| Separations backend | **7 of 9 exit criteria** (§6): all five chunks + composition built; composed live dry run reached a real **preview terminal** (§9.17); real run on canary 4510 refused pre-gate, correctly; **zero write rows** beyond the 2026-08-04 proof |
| Platform fixes the live passes forced | D212–D218, D221 — all landed with tests (span-wire fork, `.or()` union, checkpoint claim-generation, preview probe order, profile root, projection disk-tail, item-scoped retry) |
| Dashboard | Detail-fidelity wave **complete R1–R8**; queue rows, taxonomy rail (D219/D220), run-detail durations, archive (filter/retention/ledger read-through), activity cross-tab all landed on the REAL wire; parity 147/147 ASSERT-mode green |
| Gates | `npm run test` 1998/209 green (2026-08-16) · guards 61 active · schema v14 |

---

## 5 · Conformance & drift audit

### Followed (the load-bearing disciplines, verified)

| Plan rule | Evidence |
|---|---|
| Ratify-in-owning-doc, same commit | All of D194–D221 carry their owning-doc edit in the ratifying commit |
| Bottom-up chunking + lego recomposition (separations §3) | Chunks 1→6c landed in exactly the directed order; composition is descriptor assembly, no conditional branching added |
| MAP-EVERYTHING (§4f4) | Full dropdown captures (16+sentinel), whole-grid reads, all twelve formKeys, live doc inventory dated in the as-built |
| Zero writes before controlled commit | Asserted from authority after every live pass, not from logs |
| Findings-ledger policy (operator rule, 2026-08-14) | 7 files; backend problems recorded not fixed in frontend sessions; landed records deleted |
| Wire-hookup 4-part protocol | UI + wire schema + `pending-wire-bindings.json` + doc 13 sentence, same commit — enforced by `wire-connectivity.test.ts` |
| Guard inventory two-way sync | 61/8/2 matches `tests/unit/architecture/` exactly |

### Drift by addition — ratified, not silent

| Addition | Was it absorbed into the plans? |
|---|---|
| Demo-fidelity dashboard wave (build every surface 1:1 to the rebuild-demo NOW, wire later) | **Yes** — operator instruction recorded in the detail-fidelity plan; every gap carries a declared-unserved entry; doc 13 got the normative sentences |
| Findings-ledger workflow | **Yes** — `docs/findings/README.md` records the standing operator rules |
| Phase 3 entry at order 8 instead of order 1 | **Yes** — D193, with the reasoning; §3.3's ordering deliberately NOT re-sequenced |
| Workflow roles / rail presentation | **Yes** — D219/D220, operator-ruled, in doc 02 §1.2.1 + doc 03 §Shell |

### Plan-text staleness — the honest list (Track 0 fixes these)

| # | Where | What it still says | What is true |
|---|---|---|---|
| 1 | `separations.md` header (lines 3–13) | "STATUS: READY TO BUILD … Chunk 1 starts now" | All chunks landed; status is §6's 7-of-9 with the canary as blocker |
| 2 | doc 07 §3.1 dated status block | Retry re-collision "is NOT pinned as a regression" | Closed same day as **D221** (`tests/unit/retry-item-attempt.test.ts`); separations §6 already reflects it |
| 3 | `docs/findings/README.md` index | dashboard-projection "2", workflow-taxonomy "1 (recorded)" | 1 open; both taxonomy records resolved (D219/D220) |
| 4 | detail-fidelity plan's wire ledger | `actions[]` row "booked"; QueueBaseFields batch "to declare" | Consumer landed (`ebe2bac`); the batch PARTLY landed (dryRun/warnings/gateOpenedAt/displayName served) — rows need re-statement |
| 5 | ROADMAP.md | — | Regenerated 2026-08-16 (`964c539`); currently accurate |

**Nothing was found that was built contrary to a plan without a record.** The drift is documentation
lag, not divergence of the built thing from the ratified thing.

---

## 6 · The execution plan

### Track 0 — plan repairs (first, one docs commit)

Fix staleness items 1–4 above. Cheap, and it makes every later status claim checkable.

### Track A — separations backend completion *(operator-blocked at step 1)*

| # | Step | Blocked on |
|---|---|---|
| A1 | **You name the §4f2 canary target(s)** — see §7, Decision 1 | **YOU** |
| A2 | Controlled commit ① — `clear-pending` sweep (needs a subject WITH a pending UCPath transaction — none exists today) | A1 |
| A3 | Controlled commit ② — UCPath termination filing (no candidate exists today) | A1 |
| A4 | Controlled commit ③ — Kuali finalization (doc 4510 is legal on the STANDALONE graph today) | A1 |
| A5 | Obligations only the commits can discharge: `probeToFenceMaxMs` per-beat decomposition · D207's provisional `stabilized` window confirmed · the seven unasserted Kuali wire shapes incl. the two D217 date epoch-ms shapes · the `would-prepare` preview arm live | A2–A4 |
| A6 | One live retry on the composed graph (D221 landed, never exercised live) — can run on any dry-run subject, **not** canary-blocked | nothing |
| A7 | Root-cause the browser-profile wedge (§9.17 item 5) + pin its regression — closes §6's last regression checkbox | nothing |
| A8 | Close-out per doc 07 §3.1 step 7: regression scenarios, knowledge records, capability dispositions, docs → **rebuild-ready** | A2–A7 |

A6 and A7 are executable now; they run alongside Track B.

### Track B — dashboard completion, separations as the forcing function *(executable now)*

Ordered so each step is proven by the separations run that exercises it.

| # | Step | Why this order / what it generalizes |
|---|---|---|
| B1 | **Identity-approval ceremonies** — choose-a-candidate, type-the-EID, rejection-reason (refused by name in `command-dispatch.ts` today), driven by the server-computed `approvalShape` (doc 09 §14); plus the missing gated parity fixture | Separations' ALWAYS-GATE is the only live gate; every later gated workflow inherits the ceremony. **Highest value: this is the one surface a real separations run needs a human on.** |
| B2 | The two recorded honesty gaps (§9.17 item 7): a settled gated run's panel states its gate WAS approved (D204's wire already carries approver/instant); a preview run's outcome chip stops reading `verified-done` | Trust-surface truthfulness; both are pure reads of served facts |
| B3 | **Run modal (run-start) batch** — typed-input `examples[]`/`parserLabel`, capability note, active-run policy, per-workflow unstartable reasons | The "run modal" you named; all four rows sit in the wire ledger with demo shape oracles |
| B4 | **Queue rows finish** — the remaining `QueueBaseFields` batch (runNumber, linked-run, facts/extracted counts, member fields), rename control, bulk `actions[]` generic arm + result-vector band | ONE batched wire change with the projector, per the ledger's own note |
| B5 | **Archive finish** — evidence-tile fields, per-attempt history, `LEDGER_PRESENTATION_DECLARATIONS` (each commit contract declares its action-label/confirmation leaf — **separations' three commit contracts are the first three entries**), an e2e test that archives a run which filed a ledger line | "Archive runs + versioning": the D179 model is done; this is the last presentation layer, and the declaration table is exactly the per-workflow reuse seam you described |
| B6 | **Explorer finish** — field-level contract rows, descriptor prose, `when` conditions in words (3 findings) | The read-only explorer half (D186's EDIT half stays deferred by decision) |
| B7 | **Worker-card / session-footer wire batch** + context-rail batch + remaining ledger rows | The two big "ONE batched change" rows; closes the ledger |
| B8 | Findings-ledger sweep to zero-or-decided; `span.patched` channel decided (Decision 5) | The definition of "frontend done" |

### Track C — connection proof (after B1–B5, before calling anything "properly connected")

One end-to-end pass, per the e2e methodology: drive the REAL dashboard against a REAL composed
separations **dry** run — plan → start → gate ceremony (B1, through the real command endpoint) →
resume → preview terminal → archive the run — then verify every surface reads that one run
correctly (queue row, run modal, timeline, receipt, activity, archive, explorer), each assertion
paired with an authority-side check. Close with the ONE deliberate parity re-freeze. When you name
the canary, the same pass re-runs over the real commits as A8's evidence.

---

## 7 · Needed from YOU — the decisions, in detail

### Decision 1 — the §4f2 controlled-commit canary (blocks Track A; the critical path)

The facts that constrain it (`separations.md` §9.16/§9.17):

- **Doc 4524 is gone** (Kuali action completed 2026-08-14; no form renders). The standing
  recommendation is void.
- **Doc 4510 / EID 10001799**: best-mapped open document. Legal TODAY for the **standalone**
  Kuali-finalization commit; the **composed** graph refuses it pre-gate (`NO_ACTIVE_EMPLOYMENT` —
  its one employment row is `Inactive`).
- **No candidate exists** for the UCPath termination commit, and the pending-sweep's COMMITTED arm
  has **no live subject** (deleting `T002209631` removed the only one).
- Inventory: 4502 open (dry-run subject) · 4510 open · 4495 open but future LDW so S7 refuses at
  `plan` · 4524 gone.

| Option | What you do | What it proves | What it leaves open |
|---|---|---|---|
| **1a — restore 4510's subject** | Make an ACTIVE terminable employment exist for EID 10001799 in UCPath (an operator act in UCPath, not code) — optionally also stage-and-leave a pending termination so the sweep has something to sweep | Potentially **all three commits in ONE composed run** — §4c's exact assertion (UCPath files real, Kuali finalizes, receipt pair + ledger) | Whether you can/should create that state in production UCPath is precisely the judgment only you can make |
| **1b — name a fresh document/subject** | Pick another open RRSS document whose subject genuinely has an active employment (and, ideally, a pending transaction for the sweep) | Same as 1a on a subject that may already be in the right state | Requires the mapping pass first (a read-only survey run — cheap, pre-authorized) |
| **1c — split the proof** | Standalone Kuali-finalization commit on 4510 NOW; termination + sweep commits when a subject exists | One of three commits lands immediately; unblocks A5's Kuali wire-shape assertions and the archive ledger declaration for that contract | The composed one-run §4c assertion and the other two commits still wait |
| **1d — wait** | Defer all commits; Track B proceeds | Nothing new | Separations stays at 7/9 indefinitely |

**My recommendation: 1c now + 1a-or-1b when convenient.** 1c banks a real commit this week on a
document that is legal today, and nothing in it forecloses the composed one-run proof later.

### Decision 2 — the gate-age pill (small, unblocks a queue-row finding)

The wire serves a real `gateOpenedAt` age; `StatusPill` renders none for `waiting` per D12, but
your later direction pointed the other way. **Pick: draw the age on the waiting pill, or ratify
D12 as-is and close the finding.**

### Decision 3 — D192 `legacy-tool-ops-sanity-check-record` disposition

§9.17 item 6: its deferral condition ("renders beside the identity gate at order 8") is materially
satisfied by the §14.2 packet's `comparisons` array. **Pick: close the capability-register entry as
`replaced` by the packet, or keep the advisory arm on the books for a later build.** (Closing an
inventory entry is deliberately an operator decision.)

### Decision 4 — the decide-first findings (each needs a stance, not code)

| Finding | The question |
|---|---|
| Activity "hours saved" tile | There is no operator-minutes source. Invent a declared per-workflow estimate (visible as an estimate), or drop the tile? |
| Write-ledger from Activity | The report's wire can't reach ledger lines. Add a pointer projection, or leave ledger reading to the archive card (where it now works)? |
| Export buttons (activity + archive) | Build real export writers, or remove the affordances until Phase 3 shapes them against a real corpus? |
| Archive Logs/Data/People tabs | The archive MODEL froze the projected row + pointers, not tab payloads. Extend the model (schema work), or ratify the card as the archive's whole surface? |
| `span.patched` channel | Declared vocabulary, zero production emitters since 1i-spine. Build the emitter that was always intended, or retire the vocabulary by decision? |

### Decision 5 — ratify this plan's ordering

Explicit approval that **Track B runs now** (with A6/A7) while Track A waits on Decision 1 — i.e.
your own realization, adopted as the plan of record.

---

## 8 · Definition of done, for this plan

1. Track 0 staleness fixed; 2. §6 exit checklist 9/9 (needs Decision 1); 3. wire-hookup ledger has
zero `to declare` rows; 4. findings ledger zero-or-decided; 5. Track C's one composed run renders
correctly on every surface with paired authority checks; 6. parity re-frozen once, deliberately;
7. ROADMAP/STORES regenerated at the boundary. At that point separations is rebuild-ready and the
dashboard is complete **for every workflow that follows** — which was the point.
