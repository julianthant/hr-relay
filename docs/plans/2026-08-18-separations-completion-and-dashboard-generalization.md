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

## 0 · How to read the references in this document

Every shorthand used below, decoded once here. Inline explanations are also repeated at the point
of use, so you never have to scroll back.

**Document numbers ("doc 07", "doc 09"…).** The rebuild's plan is split across fourteen owning
documents in `docs/rebuild/`, numbered 00–13. The ones cited here:

| Doc | File | Owns |
|---|---|---|
| doc 02 | `02-workflow-model.md` | how a workflow graph is defined and executed (nodes, attempts, checkpoints, retries) |
| doc 03 | `03-tracker-dashboard.md` | the dashboard: queue, run detail, projections, the shell/rail |
| doc 04 | `04-reconciliation.md` | the decision changelog — one line per decision, pointing at the doc that owns it |
| doc 07 | `07-master-plan.md` | phases, the per-workflow migration loop, exit criteria, the cutover |
| doc 09 | `09-write-safety.md` | how a real HR write is made safe (the seven "beats", fences, parks, the identity gate) |
| doc 12 | `12-operator-trust.md` | evidence receipts, the explorer, advisories — the surfaces that let you trust a run |
| doc 13 | `13-frontend-backend-integration.md` | the wire: what the backend serves and how the frontend consumes it |

**"D" numbers (D12, D179, D193, D221…).** Ratified decisions. Each one is a numbered, dated entry
in doc 04 with its full normative text in whichever doc owns the topic. When this file says
"D193", it means "the decision numbered 193, which you can look up". The ones cited here are
explained inline where they appear.

**"§" section references.** A section inside a named document. Bare "§" references in the
separations context mean sections of `docs/migrations/separations.md`, which is structured as:

- **§3** — how the workflow gets built (your bottom-up chunking directive).
- **§4a–§4g** — the seven big design questions you answered before building, one lettered section
  each: §4a the termination-type mapping · §4b what happens when Kronos is down · §4c what happens
  when UCPath filed but Kuali didn't finalize · §4d the identity gate applies in every run mode ·
  §4e how the Kuali form is written (staged once, saved once, read back once) · **§4f** the proof
  requirements, split f1–f4 (see below) · §4g the final-pay radio is hardcoded by your ruling.
- **§4f1–§4f4** — the four proof sub-questions: **f1** no I-9 packet in this workflow · **f2** the
  *controlled commit runs against a production "canary" — a real document/person that YOU name and
  approve at the time* (this is the famous "§4f2 canary") · **f3** the probe-to-fence time bound
  must be *measured live, never guessed* · **f4** the scenario inventory stays open with a
  map-everything directive.
- **§5** — the twelve-item operator questionnaire (all answered 2026-08-12).
- **§6** — the exit checklist: nine checkboxes that define "this workflow is done".
- **§9.1, §9.2 … §9.17** — the dated as-built ledger: one numbered entry per work chunk or live
  pass, recording what actually happened. §9.16 is the 2026-08-14 read-only completion pass;
  §9.17 is chunk 6c, the composed dry run that reached its preview terminal.

**Recurring terms:**

| Term | Meaning |
|---|---|
| **Controlled commit** | Doc 07's step 5 for any write workflow: ONE real, operator-approved write against a real system, proving the write actually *lands* (a dry run can never prove that). Done once per commit contract, with full fence/read-back evidence. |
| **Canary** | The real production target (a document + person) you approve for that one real write. Named by you, never invented by the code. |
| **ALWAYS-GATE** | Doc 09 §14's identity-approval gate: before any separation write, a human (you) reviews an evidence packet about *who* is being terminated and approves it. "ALWAYS" because no run mode, preset, or resume can skip it. |
| **Approval shape** | A server-computed field on the gate packet telling the UI *which* approval ceremony to render — one-click confirm, choose-among-candidates, or type-the-EID. Server-computed so the frontend can't quietly downgrade every gate to one click. |
| **EID** | Employee ID — the UCPath person identifier (e.g. 10001799). |
| **LDW** | Last Day Worked — a date field on the separation form. |
| **RRSS document** | The Kuali form type a separation lives on (e.g. "doc 4510" = Kuali RRSS document number 4510). |
| **Pending sweep / `clear-pending`** | The first of the three write transactions: before filing a new termination, it clears any *pending* (not-yet-approved) termination transaction already sitting in UCPath for that person. Its "committed arm" = the code path where it actually finds and clears one. |
| **Fence** | Doc 09's core safety device: a durable database row written BEFORE the browser clicks Save, so if anything is uncertain afterwards the system knows a write may have landed and *parks* instead of retrying blindly. |
| **`probeToFenceMaxMs`** | The measured upper bound on the time between the read-only probe (which checks the target's current state) and the fence being written. If the gap is too big the probe is stale. §4f3 requires this be measured on real runs, never guessed. |
| **Propagation / "stabilized" window** | How long after a write you must wait before a re-read that *doesn't* see the value can be trusted as "it really didn't land" (rather than "it hasn't shown up yet"). D135 measured Kuali's at 30 s; D207 lets the separations Kuali write reuse that number *provisionally* until its own controlled commit confirms it. |
| **Preview terminal / dry run** | A dry run executes the whole workflow with the write structurally absent; it ends at a "preview terminal" — a terminal record describing what the real run WOULD do, with zero durable write rows. The `would-prepare` arm is the preview branch that stages the form pages; the `already-present` arm is the branch that reports "this write already exists, nothing to do". |
| **Wire / wire schema** | The typed contract between backend and frontend — every field the dashboard renders is served over "the wire" from one projection. |
| **Wire-hookup ledger** | A table in `docs/plans/2026-08-13-detail-fidelity-audit.md` listing every dashboard element that is BUILT and rendering but whose backend field is not served yet. Each row names the field, the consumer, and the demo file that pins its exact shape. |
| **`pending-wire-bindings.json`** | A config file where every such unserved field is formally declared; a test (`wire-connectivity.test.ts`) fails if a declared field never gets served or a served field was never declared. Makes "not wired yet" a tracked fact instead of a hope. |
| **Findings ledger** | `docs/findings/` — your standing rule: backend problems discovered while doing frontend work get *recorded* there (never fixed mid-session), and unplanned frontend ideas get a record instead of being built. Records are deleted when the fix lands in the owning doc. |
| **Parity lane / re-freeze** | `npm run test:parity` — a corpus of 147 frozen reference screenshots + accessibility trees the dashboard must match pixel-for-pixel. "Re-freezing" = deliberately regenerating the references (via `test:parity:update`) after an intentional visual change; done once per wave, never automatically. |
| **CAS** | Compare-and-swap: every state change presents the version it read; if the row moved meanwhile, the change is refused instead of overwriting someone else's. |
| **`span.patched`** | A declared event type in the run-event vocabulary intended to push incremental run-detail updates; it turned out nothing in production ever emits it — a "dead channel" awaiting a build-or-retire decision. |
| **Scenario IDs (S7, S61…)** | Numbered rows in the separations scenario inventory (§4f4's map). E.g. S7 is the rule that refuses to *plan* a separation whose Last Day Worked is still in the future; S61 is the dry-run-leaves-nothing-behind scenario. |
| **`T00…` numbers** | UCPath transaction numbers (e.g. `T002209631`, the pending termination you deleted on 2026-08-14). |
| **`verified-done`** | The highest confidence label an evidence receipt can carry — "the run finished AND its terminal claim was independently verified". A *preview* run's chip showing this label is one of the two recorded honesty gaps. |

---

## 1 · Direct answers first

| Question | Answer |
|---|---|
| Is "complete separations backend + frontend, connected" the next plan? | **Yes** — with one correction of ordering forced by facts: the backend's only remaining work (the three controlled commits — the three real writes done once each against an approved target) is **blocked on you** naming the §4f2 canary targets (the real documents/people those writes are allowed to touch). So the immediate executable work is the frontend/wire completion — which is exactly your own realization (§3 below). Backend commits run the day you name targets. |
| Are we following the rebuild plans properly? | **Substantially yes.** The per-workflow migration loop (doc 07 §3.1: questionnaire → build → guards → live dry run → controlled commit → rebuild-ready → close-out), your bottom-up chunking directive, the map-everything rule, lego recomposition, the zero-writes discipline, and the ratify-in-owning-doc rule have all been honored — every one of the 62 decision rounds through D221 landed its normative text in its owning doc. See the conformance table (§5). |
| How have we drifted? | Three kinds: **(a) ratified additions** — work the original plan didn't number but which was absorbed properly (the demo-fidelity dashboard wave, the findings-ledger policy, the wire-hookup protocol); **(b) plan-text staleness** — five named spots where a doc's status sentence lags what later commits settled; **(c) zero silent divergence found** — nothing was built against the plans without being recorded. Details in §5. |
| Have the plans been updated for the drift? | **Mostly.** The additions are ratified (doc 13 normative sentences, `docs/findings/README.md` policy, decisions D219/D220/D221). The five stale spots are NOT yet fixed — they are Track 0 of this plan (§6). `ROADMAP.md` was regenerated 2026-08-16. |

---

## 2 · The gist of how the plans are structured

Understanding this answers *where any given fact lives* and *why the drift audit is even possible*.

| Layer | What it is | Files |
|---|---|---|
| **Owning docs (normative)** | Each doc OWNS its contracts. A decision is not ratified until its normative text lands in the owning doc, in the same commit that records it. | `docs/rebuild/00`–`13` (see §0's table for the ones cited here) |
| **Decision changelog (pointer index)** | One line per decision D1–D221, pointing at the owning doc. Never implemented from — it tells you where to look, not what to build. | `docs/rebuild/04-reconciliation.md` |
| **Per-migration doc** | For each workflow being migrated: the questionnaire answers (§4/§5), the exit checklist (§6), and the dated as-built ledger (§9.x) recording every chunk and live pass. | `docs/migrations/separations.md` |
| **Derived views (regenerated, never authoritative)** | Operator tracking; store catalog. Regenerated at slice boundaries; owning docs win on any disagreement. | `ROADMAP.md` · `STORES.md` |
| **Findings ledger** | Backend problems found during frontend sessions are RECORDED, never fixed in-session; unplanned frontend features get a record instead of being built. Lifecycle: recorded → diagnosed → triaged → **deleted when landed in the owning doc**. | `docs/findings/` (7 files) |
| **Working plans** | Session-scoped execution plans (like this one). The detail-fidelity plan carries the **wire-hookup ledger** — the definitive list of frontend elements waiting on a backend field. | `docs/plans/` |
| **Guard manifests** | Every architecture guard test registered in a manifest, checked in both directions (a guard can't silently vanish, a manifest entry can't lack a test). `pending-wire-bindings.json` does the same for unserved wire fields. | `docs/rebuild/guard-inventory.json` · `config/pending-wire-bindings.json` |

**The two structural principles that matter for this plan:**

1. **Doc 07 §3.1's per-workflow loop.** Every migrating workflow walks the same seven steps:
   operator questionnaire → build from reusable store tasks → guard suite green → **live dry run**
   against every real system it touches (with zero durable write rows asserted) → **controlled
   commit** on an operator-named target (the one real write that proves landing) → marked
   rebuild-ready → close-out (regression scenarios, knowledge records, capability dispositions).
   Separations is standing at the controlled-commit step. Nothing goes live before the single
   all-at-once cutover regardless — "rebuild-ready" is a certification, not a deployment.
2. **The dashboard is workflow-agnostic by construction.** One projection feeds every surface
   (doc 03 §2.3); a run's available actions, its title, its rail placement all come from what its
   workflow *descriptor declares*, not from hardcoded per-workflow UI (doc 13 §8.5, D219/D220 —
   the decisions that gave every workflow module a declared role and made the rail list only main
   workflows); the identity gate's approval ceremony is chosen by the server (doc 09 §14); the
   archive can be read back with the descriptor list literally EMPTY (D179 — the decision that an
   archived run must need no old code to render). **Nothing on the dashboard is
   separations-specific.** Build a surface once, and every later workflow gets it for free.

---

## 3 · Your realization, checked against the plans

> *"…the plan should be we should complete all the functionality of the dashboard from the
> separations workflow and build it in the way the plans mentioned so that all the other workflows
> can use that as well — archive runs, versioning, workflow explorer, run modal, etc."*

**This is already the plans' architecture — you are not proposing a change, you are ratifying the
ordering.** Two existing decisions say exactly this:

- **D193** (2026-08-12, the decision that picked separations as the Phase 3 entry point) chose it
  *because a big multi-system workflow forces the store task libraries into existence* — one
  migration mints the UCPath/Kuali/Kronos task families every later workflow reuses, instead of
  trickling them in through small reads.
- The same argument, one layer up, is what the detail-fidelity wave + wire-hookup ledger already
  do for **surfaces**: every field the queue row, run modal, context rail, archive card, or gate
  panel needs is grown on the GENERIC wire schema and served from the ONE projection — separations
  is merely the first workflow rich enough (18 nodes, a human gate, 3 real-write transactions, a
  ledger line, an archive-worthy terminal) to exercise every arm of every surface.

So the plan below treats **separations as the forcing function for completing the dashboard**, and
"complete" is defined by three closed lists that already exist: the **wire-hookup ledger** (~17
rows of built-but-unserved dashboard elements), the **findings ledger** (~24 open records), and
the detail-fidelity plan's five named tails (§6, Track B). When those lists are empty and one
composed separations run renders correctly on every surface, the dashboard is done *for every
future workflow*, not just this one.

---

## 4 · What we have done (compressed; `ROADMAP.md` §1–§3 has the full record)

| Area | State |
|---|---|
| Platform (execution kernel, write safety, evidence, storage, intake, capture, restore) | **Done and proven** — Phases 0–2 closed; the one authorized real write proven live 2026-08-04 (D135: fence → click → read-back → settle, idempotent re-run in 2 ms) |
| Separations backend | **7 of 9 exit-checklist items met** (§6 of the separations doc): all five chunks + the composed 18-node workflow built; the composed live dry run ran the whole pipeline — plan → start → real gate approval → resume — to a real **preview terminal** (§9.17); the real (not-dry) run on doc 4510 refused before the gate, correctly, because its subject has no active employment; **zero write rows** exist beyond the 2026-08-04 proof |
| Platform fixes the live passes forced | D212–D218 and D221 — all landed with tests. In plain terms: a stale-grid read fixed, a search that crashed on multi-person matches fixed, checkpoint identity extended so a gate park/resume can't collide with itself (D214), dry-run previews now probe first like the real path (D215), one browser profile root name (D216), the two Kuali date fields joined the staged write set (D217), the dashboard projection now reads worker events from disk across processes (D218), and a failed run is retryable again because a retry now advances the *item's* attempt (D221) |
| Dashboard | Detail-fidelity wave **complete R1–R8** (eight review regions, all fixed and gated); queue rows, the workflow rail with roles, run-detail step durations, the archive card (instance filter / computed retention / ledger read-through), and the Activity report's per-workflow cross-tab all landed on the REAL wire; parity 147/147 green in assert mode |
| Gates | `npm run test` 1998 tests / 209 files green (2026-08-16) · 61 active guards · authority schema v14 |

---

## 5 · Conformance & drift audit

### Followed (the load-bearing disciplines, verified)

| Plan rule | Evidence |
|---|---|
| Ratify-in-owning-doc, same commit | All of D194–D221 carry their owning-doc edit in the ratifying commit |
| Bottom-up chunking + lego recomposition (your §3 directive: store tasks first, one provable sub-workflow per system, then compose; variability by recomposition, never by branches inside one monolith) | Chunks 1→6c landed in exactly the directed order; the composition is descriptor assembly with no conditional branching added |
| MAP-EVERYTHING (§4f4: every chunk exhaustively maps what it touches) | Full dropdown captures (16 options + the blank sentinel), whole-employment-grid reads, all twelve Kuali form keys, a dated live document inventory in the as-built |
| Zero writes before the controlled commit | Asserted from the authority database after every live pass (counting actual write-intent/attempt/outbox rows), never from logs |
| Findings-ledger policy (your standing rule, 2026-08-14) | 7 files; backend problems recorded not fixed in frontend sessions; landed records deleted on landing |
| Wire-hookup 4-part protocol (UI ports the demo + wire schema grows the field + `pending-wire-bindings.json` entry + doc 13 sentence, all in one commit) | Enforced by `wire-connectivity.test.ts` in both directions |
| Guard inventory two-way sync | 61 active / 8 retired / 2 planned matches `tests/unit/architecture/` exactly |

### Drift by addition — ratified, not silent

| Addition | Was it absorbed into the plans? |
|---|---|
| Demo-fidelity dashboard wave (your instruction: build every surface 1:1 to the rebuild-demo NOW, structured so the backend knows what to serve later) | **Yes** — instruction recorded in the detail-fidelity plan; every gap carries a declared-unserved entry; doc 13 got the normative sentences |
| Findings-ledger workflow | **Yes** — `docs/findings/README.md` records the standing operator rules |
| Phase 3 entry at order 8 (separations) instead of order 1 | **Yes** — D193, with the reasoning; the master plan's §3.3 migration ordering deliberately NOT re-sequenced |
| Workflow roles / rail presentation (a chunk harness renders as a step of its composition, not a peer workflow; the rail lists main workflows only) | **Yes** — D219/D220, operator-ruled, in doc 02 §1.2.1 + doc 03 §Shell |

### Plan-text staleness — the honest list (Track 0 fixes these)

| # | Where | What it still says | What is true |
|---|---|---|---|
| 1 | `separations.md` header (lines 3–13) | "STATUS: READY TO BUILD … Chunk 1 starts now" | All chunks landed; real status is §6's 7-of-9 with the canary naming as the blocker |
| 2 | doc 07 §3.1's dated status block | The retry re-collision "is NOT pinned as a regression" | It was closed the same day, as D221, with its regression test (`tests/unit/retry-item-attempt.test.ts`); the separations doc already reflects it, doc 07 wasn't re-touched |
| 3 | `docs/findings/README.md` index | dashboard-projection "2 open", workflow-taxonomy "1 (recorded)" | dashboard-projection has 1 open; both taxonomy records were resolved by D219/D220 |
| 4 | the detail-fidelity plan's wire ledger | the bulk `actions[]` row says "booked"; the QueueBaseFields batch says "to declare" | The consumer landed (`ebe2bac`), and the batch PARTLY landed (dryRun / warnings / gate-age / displayName are served now) — the rows need re-statement |
| 5 | `ROADMAP.md` | — | Regenerated 2026-08-16 (`964c539`); currently accurate |

**Nothing was found that was built contrary to a plan without a record.** The drift is
documentation lag, not divergence of the built thing from the ratified thing.

---

## 6 · The execution plan

### Track 0 — plan repairs (first, one docs commit)

Fix staleness items 1–4 above. Cheap, and it makes every later status claim checkable against the
docs instead of against memory.

### Track A — separations backend completion *(operator-blocked at step 1)*

Context: the composed workflow contains **three fenced write transactions** — ① the pending sweep
(clear any pending termination already in UCPath), ② the UCPath termination filing itself, ③ the
Kuali finalization save. Each owes ONE controlled commit: one real execution against a target you
approve, with fence + read-back evidence. That is the last substantive checkbox in §6.

| # | Step | Blocked on |
|---|---|---|
| A1 | **You name the §4f2 canary target(s)** — the real document(s)/person(s) the three writes may touch. See §7, Decision 1 for the full facts and options | **YOU** |
| A2 | Controlled commit ① — the pending sweep's committed arm. Needs a subject who actually HAS a pending UCPath termination to clear — **no such subject exists today** (deleting `T002209631` removed the only one) | A1 |
| A3 | Controlled commit ② — the UCPath termination filing. **No candidate target exists today** (see Decision 1) | A1 |
| A4 | Controlled commit ③ — the Kuali finalization save. Doc **4510** is legal for this TODAY on the standalone finalization workflow (the composed workflow refuses 4510 pre-gate because its subject's employment is Inactive) | A1 |
| A5 | Obligations only the commits can discharge: the `probeToFenceMaxMs` per-beat measurement (§4f3 — how long between probe and fence, measured not guessed) · confirming D207's provisionally-reused 30 s Kuali propagation window on this write's own evidence · asserting the seven Kuali wire-payload shapes not yet observed live (incl. the two D217 date fields, which Kuali stores as epoch-milliseconds) · exercising the `would-prepare` preview arm live | A2–A4 |
| A6 | One live retry on the composed graph — D221's fix (a retry advances the item's attempt, so it no longer collides with its own checkpoint) is landed and tested but **never exercised on a real run**. Can run on any dry-run subject; **not** canary-blocked | nothing |
| A7 | Root-cause the browser-profile wedge (§9.17 item 5: one worker profile failed session acquisition three times at the full 60 s bound while a fresh profile logged in in 17.9 s — recorded as a shape, cause unknown) and pin its regression — closes §6's last regression checkbox | nothing |
| A8 | Close-out per doc 07 §3.1 step 7: regression scenarios, knowledge records, capability-register dispositions, docs to as-built → separations is marked **rebuild-ready** | A2–A7 |

A6 and A7 are executable now; they run alongside Track B.

### Track B — dashboard completion, separations as the forcing function *(executable now)*

Ordered so each step is proven by the separations run that exercises it.

| # | Step | Why this order / what it generalizes |
|---|---|---|
| B1 | **Identity-approval ceremonies.** The gate currently supports only one-click approve; the other two ceremonies the server can demand — *choose among candidate people* and *type the EID to confirm* — plus the rejection-reason flow are refused by name in `src/dashboard/app/command-dispatch.ts` until built. Build them against the server-computed approval shape (doc 09 §14), plus the missing parity fixture that photographs a gated run | Separations' ALWAYS-GATE is the only live gate; every later gated workflow inherits the ceremony. **Highest value: this is the one surface a real separations run needs a human on.** |
| B2 | **The two recorded honesty gaps** (§9.17 item 7): (a) a settled gated run's detail panel cannot currently say "its gate was approved, by whom, when" — even though D204 already put the approver into the served wire; (b) a preview (dry-run) run's outcome chip reads `verified-done`, the label reserved for independently-verified real completions | Trust-surface truthfulness; both are pure reads of facts the wire already serves |
| B3 | **Run modal (run-start) batch** — the typed-input examples and parser label, the workflow capability note, the active-run policy control, per-workflow "why can't I start this" reasons | The "run modal" you named; all four rows sit in the wire-hookup ledger with their exact shapes pinned by the demo |
| B4 | **Queue rows finish** — the remaining row-field batch (run number `#N`, linked-run chip, extracted-facts counts, member fields), the rename control (the kernel command exists, no UI control does), the bulk-selection command strip + its result-vector band | ONE batched wire change with the projection, per the ledger's own note |
| B5 | **Archive finish** — evidence-tile detail fields, per-attempt history, and `LEDGER_PRESENTATION_DECLARATIONS`: a table where each commit contract declares how its ledger line should be presented (its action label and confirmation field). It is EMPTY today — **separations' three commit contracts become its first three entries**, which is exactly the per-workflow reuse seam you described. Plus an end-to-end test that archives a run which actually filed a ledger line | "Archive runs + versioning": the D179 archive model (frozen row + pointers, readable with zero descriptor code, UPDATE/DELETE aborted in SQL) is done; this is the last presentation layer on top of it |
| B6 | **Explorer finish** — the three open findings: field-level contract rows (Field · System · Recorded), the descriptor's prose (graph summary + per-node purpose), and a node's `when` condition rendered in words | The read-only Workflow Explorer half. (The EDIT half stays deferred by D186 — an editor shaped by a sample of one workflow would be wrong; its trigger is the *second* production workflow whose policy you want to change.) |
| B7 | **Worker-card / session-footer wire batch** (worker identity, elapsed clock, lease-wait block, browser-health grid, crashed arm, the Stop button's version field) + the context-rail batch (data-point provenance: step, staged/policy tags, freshness, feeds-into) + the remaining ledger rows | The two big "ONE batched change" rows in the ledger; closes it |
| B8 | **Findings-ledger sweep to zero-or-decided**; the `span.patched` dead channel decided (Decision 5) | The definition of "frontend done" |

### Track C — connection proof (after B1–B5, before calling anything "properly connected")

One end-to-end pass: drive the REAL dashboard against a REAL composed separations **dry** run —
plan it in the UI → start it → the gate parks and you approve through the new B1 ceremony → resume
→ preview terminal → archive the run — then verify every surface reads that one run correctly
(queue row, run modal, timeline, receipt, activity report, archive card, explorer), with each UI
assertion paired against a direct authority-database check so the UI can't be marking its own
homework. Close with the ONE deliberate parity re-freeze. When you name the canary, the same pass
re-runs over the real commits as Track A's final evidence.

### Track D — dashboard hardening, pre-cutover budgets — ratified 2026-08-20 (D264), see the audit plan (`docs/plans/2026-08-20-dashboard-architecture-audit.md`)

---

## 7 · Needed from YOU — the decisions, in detail

### Decision 1 — the §4f2 controlled-commit canary *(blocks Track A; the critical path)*

**What is being asked.** Your own questionnaire answer §4f2 says: the proof that a write really
lands is ONE real commit against a production target — *"target named by you at the time."* That
time is now, and there are three writes to prove: the pending sweep, the UCPath termination
filing, and the Kuali finalization save. Naming a canary means: pointing at a real Kuali
separation document (and the person on it) and saying "these three writes may run for real against
this one."

The facts that constrain the choice (from the §9.16/§9.17 live passes):

- **Doc 4524 is gone.** It was the recorded natural candidate since chunk 5c — but its Kuali
  action was completed by someone on 2026-08-14, and Kuali no longer serves a form for it. The
  recommendation is void on the facts.
- **Doc 4510 / EID 10001799 is half-usable.** It is the best-mapped open document. The
  *standalone* Kuali-finalization workflow can legally commit on it TODAY. But the *composed*
  workflow refuses it before the gate ever opens, because UCPath shows exactly one employment row
  for that person and it is `Inactive` — and a workflow that files a termination refuses a subject
  it cannot terminate. (Verified live: UCPath itself would accept the EID — the refusal is our
  graph's own, correct, rule.)
- **The UCPath termination commit has no candidate at all.** No mapped open document has a subject
  with an active, terminable employment.
- **The pending sweep's committed arm has no subject at all.** When you deleted pending
  transaction `T002209631` (which correctly cleared the canary path at the time), it also removed
  the only mapped person who *had* a pending row to sweep.
- Live document inventory (2026-08-14): **4502** open (the dry-run subject) · **4510** open ·
  **4495** open but its Last Day Worked is `09/02/2026`, still in the future, so scenario rule S7
  refuses to plan it · **4524** completed/gone.

| Option | What you do | What it proves | What it leaves open |
|---|---|---|---|
| **1a — restore 4510's subject** | In UCPath, make an ACTIVE terminable employment exist for EID 10001799 (an operator act inside UCPath, not code) — and optionally stage-and-abandon a pending termination first, so the sweep has something real to clear | Potentially **all three commits in ONE composed run** — which is literally §4c's designed assertion (UCPath files for real, Kuali finalizes, and the durable evidence is the receipt pair) | Whether creating that state in production UCPath is acceptable is precisely the judgment only you can make |
| **1b — name a fresh document/subject** | Pick another open RRSS document whose subject genuinely has an active employment (ideally with a pending transaction for the sweep) | Same as 1a, on a subject that may already be in the right state naturally | Requires a read-only mapping survey first (cheap, pre-authorized — a live read pass like §9.16's) to confirm the subject's state |
| **1c — split the proof** | Approve the **standalone Kuali-finalization commit on doc 4510 now**; do the termination + sweep commits later, when a valid subject exists via 1a or 1b | One of the three commits lands immediately; unblocks part of A5 (the Kuali wire-shape assertions, the date fields' epoch-ms proof) and B5's first ledger declaration | The composed one-run §4c assertion and the other two commits still wait |
| **1d — wait** | Defer all commits; Track B proceeds regardless | Nothing new | Separations stays at 7 of 9 indefinitely |

**My recommendation: 1c now, plus 1a-or-1b when convenient.** 1c banks a real, restorable commit
this week on a document that is legal today, and nothing about it forecloses the composed one-run
proof later.

### Decision 2 — the gate-age pill *(small; unblocks a queue-row finding)*

For a run waiting at the identity gate, the backend now serves *how long it has been waiting*
(`gateOpenedAt`). The queue row's status pill doesn't draw it — decision D12 (an early
queue-presentation ruling) said the waiting pill shows no age, but your later direction during the
frontend work pointed the other way, and the finding was parked as explicitly your call.
**Pick: draw the age on the waiting pill (amending D12), or ratify D12 as-is and close the
finding.**

### Decision 3 — the D192 sanity-check advisory disposition

Background: D192 (2026-08-12) retired two of the three legacy AI advisory tools and kept one —
the "record sanity check" (an AI reads the staged HR record and flags oddities) — deferred until
separations, where it was to render beside the identity gate. The §9.17 pass observed that the
gate packet's own `comparisons` array (the server's deterministic side-by-side of disconfirming
evidence) now materially covers what that advisory was for. Closing a capability-register entry is
deliberately an operator decision, so it was not auto-closed.
**Pick: close the register entry as replaced by the gate packet, or keep the AI advisory arm on
the books for a later build.**

### Decision 4 — the decide-first findings *(each needs a stance, not code)*

| Finding | The question, in full |
|---|---|
| Activity "hours saved" tile | The demo shows an hours-saved number; no source of operator-minutes-per-run exists anywhere in the system. Options: declare a visible per-workflow estimate (labelled as an estimate), or drop the tile. A fabricated-looking precise number is the one thing the trust rules forbid. |
| Write-ledger from Activity | The Activity report's wire cannot reach the write ledger (the fsync'd file recording every real filing). The archive CARD can reach it now (landed 08-15). Options: add a pointer projection so Activity can link to ledger lines, or ratify that ledger reading belongs to the archive card only. |
| Export buttons (activity + archive) | The demo has export affordances; no export writers exist in the backend. Options: build real exporters now, or remove the affordances until Phase 3 shapes them against a real run corpus (the deferral table's existing stance for search/export). |
| Archive Logs/Data/People tabs | The D179 archive model deliberately froze the final projected ROW plus pointers — not the full tab payloads (logs, extracted data, people). Options: extend the archive model (a schema change) to freeze tab payloads too, or ratify the card as the archive's whole surface. |
| `span.patched` channel | A declared run-event type intended for incremental run-detail updates has had zero production emitters since it was defined. Options: build the emitter that was always intended, or retire the vocabulary entry by decision (a vocabulary arm nothing emits is dead weight that misleads readers of the schema). |

### Decision 5 — ratify this plan's ordering

Explicit approval that **Track B runs now** (alongside A6/A7) while Track A waits on Decision 1 —
i.e. your own realization, adopted as the plan of record.

---

## 8 · Definition of done, for this plan

1. Track 0 staleness fixed; 2. the separations exit checklist at 9 of 9 (needs Decision 1);
3. the wire-hookup ledger has zero `to declare` rows; 4. the findings ledger is zero-or-decided;
5. Track C's one composed run renders correctly on every surface with paired authority checks;
6. parity re-frozen once, deliberately; 7. `ROADMAP.md`/`STORES.md` regenerated at the boundary.
At that point separations is rebuild-ready and the dashboard is complete **for every workflow that
follows** — which was the point.
