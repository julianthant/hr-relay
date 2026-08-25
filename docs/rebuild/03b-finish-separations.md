# 03b · Phase 3b — finish separations

Phase 3 migrates the legacy workflows one at a time. **Phase 3b is the FIRST of them** — separations,
order 8 — chosen deliberately as the hard entry because a big multi-system workflow forces the store
task libraries into existence for every migration after it (D193). This doc carries phase 3's own
tree node `{#phase-3}` and the whole separations subtree; Phase 3 is four docs — **3a** finished the
dashboard (`03a-finish-the-dashboard.md`, `{#dash-defaults}`), **3b** is this one, **3c** migrates
the remaining thirteen workflows (`03c-migrate-the-remaining-workflows.md`, `{#migrations}`), and
**3d** puts Claude on the same dashboard as a second actor (`03d-co-operate-with-claude.md`,
`{#claude-operator}`).

**What lives where.** This doc holds the work, its state at HEAD and its exit. The contracts it
built or amended live in `reference/`. The as-built record of the migration itself — every live
observation, every measured leg, every refusal with its date — stays `docs/migrations/separations.md`,
cited below as **§N**; it is the child plan and it wins on any question of what a live pass actually
saw. The decisions live in `reference/decisions.md`.

## Phase summary
<!-- roadmap: phase-3 -->

<!-- roadmap-status: phase-3 -->
- [x] step 1 questionnaire — all twelve §5 items and every §4a–§4g decision answered 2026-08-12, including 5A/5B's freshness values (D193, `docs/migrations/separations.md` §5)
- [x] step 2 author — nineteen nodes, one ALWAYS-GATE, three fenced transactions, four stores (`src/workflows/separations/descriptor.ts`, `module.ts`; D211, D261)
- [x] step 3 guards — `descriptor-coverage`, `write-safety-contract`, `identity-gate-before-commit`, `scenario-coverage`, `gate-coverage` all green over this descriptor; `config/pending-impl-bindings.json` is the empty set, so every contract it names is implemented
- [x] step 4 live dry run — MET 2026-08-14 at the preview terminal (run `7565a88d` / `sp-105939-7565`, doc 4502, §9.17) and re-proved through the dashboard 2026-08-20 (run `e1b8ae3e` / `sp-081217-e1b8`, §9.22) and off one typed document number (run `1e0b7cc2` / `sp-105225-1e0b`, §9.24)
- [ ] step 5 controlled commits — all three OPEN. The canary is doc 4537, named 2026-08-19 and mapped live (§9.19); S7 admits it on Pacific calendar day **2026-08-28**
- [ ] step 6 rebuild-ready — blocked by step 5; the open exit criterion is the only one of nine
- [ ] step 7 close-out — regression scenarios, knowledge records, capability dispositions, docs to as-built (Track A row A8)
> 2026-08-20 | docs-cohesion 03b | verified against src/workflows/separations/**, src/stores/{kuali,ucpath,new-kronos,separations}/**, config/pending-impl-bindings.json and the §9.x record; left: the three commits and everything only they discharge
<!-- /roadmap-status -->

### What Phase 3b is, and why separations went first

**The entry was an operator choice, made 2026-08-12 and ratified as D193.** The seven-step loop has
always left *which workflow goes first* to the operator, and the reasoning behind this answer is the
part that generalizes: a big multi-system workflow **forces the store task libraries into
existence**. Separations touches UCPath (the termination write and two identity reads), Kuali (the
separation-document read plus the finalization write), and **new-kronos** — a driver, a login recipe
and timecard reads that did not exist at all. So one migration mints the write family, the read
family and a whole new system store in one pass, and every later migration draws from them.
Entering through the small reads would have trickled the same stores in a task at a time, spending
the same total effort with the reuse arriving last rather than first.

**The trade was taken with eyes open.** Doc 03c's risk ordering is **not** re-sequenced by this
choice — separations sits at order 8 because it is the deepest write-safety proof, and that is still
the honest read of the risk. Entering there is a decision about *which proof is bought first*, never
a claim that the proof is cheaper. Every workflow still owes doc 03c's exit criteria in full,
separations included.

**What the entry actually bought, measured against the code at HEAD.** Four stores now carry real
tasks that later migrations reuse: `kuali` 10 tasks, `ucpath` 10, `new-kronos` 2 (the store built
whole here), and the pure `separations` mini-store 9 folds. The conventions those stores settled —
D194's one-task-per-page-visit rich-extraction rule, D196's five rules for every store slice after
`new-kronos`, D197's five more for a store being CUSTOMIZED, D201's read-reports-the-page /
fold-does-the-judging split — are the reuse, and they are why the second migration is a smaller
piece of work than this one was.

### The seven-step loop, for separations

Doc 03c owns the loop; this is where separations stands in it. Steps 1–4 are met; 5 is open on a
calendar date; 6 and 7 follow it.

| Step | State | Evidence |
|---|---|---|
| 1 · **§b questionnaire** | **MET** 2026-08-12 | §5's twelve items and §4a–§4g, all answered in one operator sitting; nothing was built before it |
| 2 · **author the workflow** | **MET** | `src/workflows/separations/descriptor.ts` (1,098 lines), `module.ts` — four stores, nineteen nodes, three transaction nodes, one ALWAYS-GATE |
| 3 · **guards green** | **MET** | the full gate is green at HEAD; `descriptor-coverage` regenerates the build manifest, `write-safety-contract` pairs every commit, `identity-gate-before-commit` walks both sinks, `scenario-coverage` audits the 21 declared scenario ids |
| 4 · **live dry run** | **MET**, three times over | §9.17 (the preview terminal), §9.22 (driven from the real dashboard), §9.24 (from one typed document number) — zero durable write rows proved from authority on every one |
| 5 · **controlled commit** | **OPEN — all three** | canary doc 4537 named 2026-08-19 and mapped live (§9.19); ② the UCPath filing unblocks **2026-08-28**, then ① the sweep on the row ② creates, then ③ the Kuali finalization |
| 6 · **rebuild-ready** | blocked by 5 | doc 03c's rule: an open criterion blocks rebuild-ready status; a dry-run success is never converted into a write-safety claim |
| 7 · **close-out** | blocked by 5–6 | Track A row A8 |

### The honest state at HEAD

Verified 2026-08-20 against the code and the migration record, not against the earlier prose (D252's
rule). Where the two disagreed the code won and the line says so.

- **The workflow is BUILT and RUNS LIVE.** Every chunk landed; the composed graph has reached a real
  preview terminal three separate ways, and since D261 it starts from one typed Kuali document
  number in the run modal.
- **Nothing has been written by it, anywhere.** The authority database holds exactly `write_intents`
  **2**, `write_attempts` **3**, `durable_outbox` **2** — every one of them 2026-08-04's Phase-2
  controlled commit on Kuali doc 4489 — and **zero** `run_checkpoints` for `clear-pending`,
  `file-termination` or `finalize-kuali` across every run this database has ever held. That count
  has been re-asserted from authority at §9.14, §9.17, §9.20 and §9.22 and has not moved.
- **The exit checklist stands at 8 of 9.** The open one is the controlled-commit evidence, and it is
  open on a *date*, not on a defect: the canary is named, mapped and structurally ready.
- **Two things the tree said that the code does not support**, both corrected here and in the tree:
  the `{#operator-calls}` node still listed the gate-age pill and D192's re-disposition as open, and
  both were settled by the operator on 2026-08-18 — the pill half of D12 is amended in
  `reference/dashboard-surfaces.md` and rendered (`src/dashboard/surfaces/queue.tsx:281`), and
  `legacy-tool-ops-sanity-check-record` is `retired` in `config/legacy-capabilities.json` with the
  ruling's own words. What IS still open there is a different call, named below.
- **One name in the migration record is stale**: §6 calls the gate guard
  `identity-gate-before-separation-commit`; the guard is `identity-gate-before-commit`
  (`tests/unit/architecture/identity-gate-before-commit.test.ts`, `guard-inventory.json:315`).

## Separations — order 8, the first migration
<!-- roadmap: order-8 -->

<!-- roadmap-status: order-8 -->
- [x] the §b questionnaire, all twelve items plus §4a–§4g (2026-08-12, §5)
- [x] the graph as built — nineteen nodes over four stores, no branch and no `when` anywhere (`descriptor.ts`; D211, D261)
- [x] the start door — ONE typed document number, the action id resolved by the graph (D260 refused it, D261 built it; live §9.24)
- [x] the ALWAYS-GATE — server-computed ceremony, the packet binding every value the approval authorizes (D77, D202, D204, D211, D226)
- [x] the subject/canary inventory mapped live and dated — 4537 (the canary), 4502 (the dry-run subject), 4495 (the S7 refusal path); 4510 and 4524 both evaporated between passes (§9.16, §9.19)
- [ ] the three controlled commits — the last substantive item; ② 2026-08-28, then ①, then ③
- [ ] `config/test-subjects.json` — the registry below moves into config under cohesion step 5.2c, with any sensitive value read through `src/domain/secrets.ts` and referenced by label
> 2026-08-20 | docs-cohesion 03b | node list and start door verified against src/workflows/separations/descriptor.ts; registry recomposed from §9.12/§9.16/§9.19/§9.24; left: the commits and the config registry
<!-- /roadmap-status -->

### The questionnaire answers that shaped the graph

Five of §5's twelve answers are visible in the descriptor's shape, and they are the ones a later
migration should read first because each one is a rule rather than a value.

1. **No delegation (item 10).** One descriptor over reused tasks; the `ChildRunExecutor` seam stays
   unwired. "Recomposition" means assembling a DESCRIPTOR from proven chunks, not spawning child
   runs — so the five sub-workflow descriptors stay exactly what §3 said they were: the scaffolding
   that made each piece provable (`module.ts`, `role: composition`; D219/D220).
2. **No branch and no `when`, anywhere (§3.1).** Scenario variability is served by recomposition,
   never by conditionals; §4b's hard-fail removed the one arm legacy had (skip Kronos for a non-HDH
   department), and §4d says no run mode changes the graph at all. A graph with no conditional edge
   cannot grow one by accident.
3. **Every read lands before anything is written (§4e).** The whole write half consumes typed
   variables rather than re-deriving at fill time, which is what puts the gate in the gap between
   the two halves — and what makes the packet's write-plan block load-bearing.
4. **`maxAgeMs: Infinity` on the three reads (§5A).** A separation document is a saved, stable
   artifact; refresh is a deliberate operator RE-RUN, never an age check firing mid-run. The
   affordance is `reRead: {ordinal, reason}` in the canonical input, which makes a re-read a NEW
   logical item with fresh checkpoints and its own gate — and it changes no permanent key, so a
   re-read can never file a second termination.
5. **`enqueue: "reject-active"` per item, where the item is the document.** S5 is why the same-key
   write mutex matters more than the enqueue policy: legacy's enqueue-supersede only cancels
   non-terminal prior runs, so a completed document could be re-run with nothing but two live page
   probes between it and a second termination.

### The graph as built — nineteen nodes over four stores

Read from `src/workflows/separations/descriptor.ts` at HEAD. Chunk 6a composed **eighteen**; D261
added `resolve-action` as a new head node on 2026-08-20, and nothing else in the graph moved — no
edge, gate, permanent key or `when` changed.

```
resolve-action ─► document ─┬─► plan ─┬─► name-search ─┐
                            │         │                ├─► subject ─► job-summary ─► employment ─┐
                            │         │   (document) ──┘                   │                     │
                            │         └─► timecard-search ─► timecard ─► dates                   │
                            └─► termination-type                    department-option ◄──────────┘
                                             └────────────┬───────────────┘
                                                          ▼
                                        comparison ─► GATE identity-approval ─► approval
                                                                                    │
       ┌────────────────────────────────────────────────────────────────────────────┘
       ▼
  clear-pending (TXN) ─► file-termination (TXN) ─► receipt ─► finalize-kuali (TXN) ─► result
```

| Store | What it contributes | Tasks at HEAD |
|---|---|---|
| `kuali` | the Action-List resolve, the whole-form read, the one-pass finalization stage/save/verify | 10 (`src/stores/kuali/tasks/`) |
| `ucpath` | Person Org search, the job-summary grid read, the pending sweep and the termination filing | 10 (`src/stores/ucpath/tasks/`) |
| `new-kronos` | employee search (which leaves the subject SELECTED) and the timecard-window read | 2 (`src/stores/new-kronos/tasks/`) |
| `separations` | the nine pure folds — plan, termination type, subject, employment, department option, dates, identity comparison, approval check, receipt check | 9 (`src/stores/separations/tasks/`) |

Six of the nineteen carry the operator-approved **categorical timeline** (D225, ruled 2026-08-18):
*Kuali extraction · Identity check · Job summary · Kronos timecard · UCPath transaction · Kuali
finalization*. The gate is a MEMBER of *Identity check* — a wait is a state of a step, not a step of
its own — and the always-rerun re-executions around a gate resume fold into their category's `×N`
marker instead of drawing duplicate segments.

### The start door (D260 → D261)

**D260 refused to build it, correctly, and named the trigger.** A typed-text start surface carries
exactly ONE varying value per run, and `separations` needed two — the document number and the Kuali
action id. Rather than bend the rule, D260 named two shapes and handed the operator the choice.

**The operator chose, verbatim: *"document number should work. no need action id."*** That is
D260's shape 2 — make `actionId` a graph OUTPUT — and it took one day. `resolve-action` filters
Kuali's own Action List by the typed number and reads the matched row's `href`; the ingress becomes
`{documentNumber, timekeeperName, searchTimeoutMs?, reRead?}` with `timekeeperName` as a declared
CONSTANT, and the modal has one box. Nothing about D260 was withdrawn.

Four properties of that build are worth carrying to the next workflow's door:

- **The refusal is where the value is.** A document nobody holds an action on is a real and common
  state (a completed step LEAVES the list), so `document-not-in-action-list` refuses by name and
  prints the numbers the list did show. Two DISTINCT action ids refuse rather than choose, because
  choosing is how the wrong person's separation gets filed.
- **Two matched links is the ordinary row, not an ambiguity.** Kuali publishes the number in both
  `Document #` and `Document Title`, so the surface claims `recipe-resolves` and deliberately NOT
  `exactly-one-visible`; the invariant it actually holds is one distinct ACTION.
- **Deriving the id STRENGTHENED the check it looked like it replaced.** D129's document-number
  proof is now made twice — against the link's anchored accessible name and against the opened
  document's own level-1 heading.
- **`timekeeperName` is a per-OPERATOR constant, not a per-RUN one.** Baking it into a bundle-safe
  descriptor satisfies the rule and is the weakest thing in the change; its trigger is a SECOND
  timekeeper, at which point it becomes a typed field (D260 shape 1) rather than a second constant.
  The trigger is written in the descriptor where somebody will read it.

**The fingerprint moved** — `2c9cb58e…` → `c9a7c426…` — so every stored `separations` checkpoint
stopped replaying across the change. That is the honest cost, not a defect: the run's identity
genuinely moved because its input schema is a different shape, and a checkpoint miss means the next
run re-reads live.

### The identity gate

The ALWAYS-GATE is why this migration exists in the shape it does, and it is the one surface a real
separations run needs a human on.

**Why ALWAYS, and not on a similarity tier (D77).** The motivating incident is the wrong-person
filing `T002173685`. `classifyNameSimilarity("Hernandez, Jose Santos", "Santos Hernandez")` returns
**`same`**, because the token alignment tolerates extra tokens on the longer side — and legacy fires
its wrong-person control only on `different`. So the incident that motivated the gate would not have
tripped a tier-triggered gate. That single fact is the argument for ALWAYS-GATE in one line.

**What it dominates (D202).** The guard audits BOTH sinks — every transaction node AND the terminal
result — because a read-only chunk whose product is an *approved subject* is bound by a later
composition as a write's `expected` side. A path is gated when it reaches the gate's own ANCESTRY;
the violation the guard caught on this descriptor's first draft was a side read the gate never
depended on, which is data the operator never saw.

**What it binds (D211).** The packet carries the WRITE PLAN — the template and reason code, the
reconciled dates, the department option, the empl record — not just the person, and §14.5's digest
binds the approval to exactly those bytes. Before that, the operator approved a person while the
dates and the template their approval was about to authorize sat only in the graph: *an approval of
a person is not an approval of a date, and the two were the same click.*

**What the durable record is (D203/D204).** A gate produces a `gate_results` row, not a
`run_checkpoints` row. The kernel's provenance collector reads that row as a dependency's evidence
and the evidence RECEIPT does too — one `operator`-sourced fact dated at `resolvedAt`, with no
output leaves. Nothing fabricates a checkpoint for it.

**How it is asked (D226).** Three ceremonies — `one-click`, `choose-a-candidate`, `type-the-eid` —
plus a rejection arm, and the shape is computed SERVER-side
(`src/domain/separations/identity-evidence.ts:339`). A frontend free to choose the control could
quietly turn every gate into one click, which is `ref write-safety` §14.6's rubber-stamping risk
manufactured by accident; a shape this build has no ceremony for refuses by name rather than
downgrading. It has been driven live eight times (§9.6 twice, §9.14 twice, §9.20 twice, §9.22 once,
§9.24 derived-and-not-clicked).

### The canary registry — every subject this migration has mapped

**This is the first canary registry in the program**, and it is prose until cohesion step 5.2c moves
it into `config/test-subjects.json`. Subjects are named by **Kuali document number only** — a
document number is not a person. EIDs and names stay out of the repository entirely and will be read
through `src/domain/secrets.ts` from an ignored `.env` when the registry becomes config (R10).

A live inventory belongs in an as-built with a date on it, never in a plan sentence: **two named
canaries have already evaporated between passes.** Every row below carries the pass that observed it.

| Label | What kind of subject it is | Availability, and when it was observed | What it is good for |
|---|---|---|---|
| **doc 4537** | the **§4f2 canary** — an open document whose subject has exactly ONE Active terminable employment, a termination type that resolves, and a department option the document already holds | **open**, mapped live **2026-08-19** (§9.19). Its Last Day Worked is `08/28/2026`, so S7 refuses at `plan` until Pacific calendar day **2026-08-28** | controlled commit ② (UCPath filing) on/after 08-28, then ① (the sweep, on the row ② creates), then ③ (Kuali finalization). Its `transactionNumber` is EMPTY, so ③ writes into an empty field rather than over a stale one |
| **doc 4502** | the full-chain **dry-run** subject — active job, past last day worked, no pending transaction, which under D215 is the subject whose `clear-pending` preview settles `already-present` at beat ① | **open**; driven live 2026-08-14 (§9.17), 2026-08-19 (§9.20, five retries), 2026-08-20 (§9.22 and §9.24) | every composed dry run; D215's `already-present` arm; D221's retry lineage; Track C's connection proof; D261's one-typed-number proof |
| **doc 4495** | a **future-dated** document — separation date `09/02/2026` | **open**; last observed 2026-08-19 (§9.19 §7) | the S7 refusal path, proved live (§9.17a run 4); the standalone read workflows; a fresh full-chain subject from 2026-09-02 |
| **doc 4510** | was the `no-active-job` witness (its subject is Inactive in Person Org) and the best-mapped standalone-finalization target | **GONE** — its action was completed between 2026-08-14 and 2026-08-19; `ActionPage` answers `document: null` and both date controls resolve to zero nodes (§9.19 §7) | nothing further. Its record stands as §9.16/§9.17's evidence, including the live `NO_ACTIVE_EMPLOYMENT` refusal (run `ee9824f7`) |
| **doc 4524** | was the natural Kuali controlled-commit candidate from §9.12 | **GONE** — action completed 2026-08-14, between two passes on the same day (§9.16 §3) | nothing further; the recommendation was withdrawn on the facts, not on a judgement |
| **(no subject)** | a subject holding a **PENDING** UCPath termination | **none exists.** Deleting `T002209631` cleared the canary path exactly as intended and removed the only mapped subject with anything for the sweep to delete (§9.16 §4, §9.19 §5) | `clear-pending`'s COMMITTED arm. Its one honest window is re-running ① immediately after ② files, before an approver clears the row — an operator call, named under §Smaller operator calls open |

**Historical Phase-2 evidence, outside this registry.** Kuali docs **4489** and **4490** were the
subjects of the now-retired annotation proof workflow; they are not current workflow entries or
separations canaries. Their records remain the baseline for the earlier absence evidence: 4489 carries the ONE controlled commit this program has
made (2026-08-04), and 4490 is where the propagation window was measured over four write/restore
cycles. Both were restored to their captured original values, each restore proved by reload
read-back.

**One correction the registry exists to prevent.** §9.18 recorded 4537's subject as the name in the
Kuali action list's person column; that column is the SUBMITTER, and the document's own subject is a
different person (§9.19 §1). A record that names the wrong person is one nobody can act on.

### 1 · new-kronos timecard read
<!-- roadmap: sep-1 -->

<!-- roadmap-status: sep-1 -->
- [x] the `new-kronos` store built whole — real driver, login recipe, published UI registry, 16 ported selectors live-re-verified (D196; `src/stores/new-kronos/`)
- [x] two page-visit read tasks under D194's rich-extraction convention, and the `separations-kronos-timecard` chunk harness
- [x] the virtualized grid read terminates on RANGE COVERAGE, not on the scrollbar (D205, 2026-08-13)
- [x] live proof MET at attempt 17 — run `sk-171645-4adf`, a 64-day window, 67 days covered, terminal `done` in 39.6 s (§9.2)
- [ ] a cold WFD profile's FIRST Employee Search can present a result row whose identity cell is still empty; the driver correctly refuses to read a row whose subject it cannot name, and whether that wants a bounded wait is the driver owner's call (§9.20 item 7, recorded not diagnosed)
> 2026-08-20 | docs-cohesion 03b | verified against src/stores/new-kronos/{driver,tasks,session.ts} and §9.1/§9.2/§9.2a; left: the cold-profile first-search observation
<!-- /roadmap-status -->

**What it built.** The first store authored whole under D194 — and therefore the store that settled
five rules for every store slice after it (D196): a store is semantic-ready and structurally
complete or it is not a store; its selectors are published to the UI registry; its login recipe
proves the application by CONTENT; its read tasks are one-per-page-visit; and its driver never
leaks a raw `Page`/`Locator`.

**What the live proof cost, and what that bought.** Seventeen attempts and ten defects. The last two
were unreachable by any fixture and are the reason the rules exist:

- **A loop that terminates on the WIDGET can be right about the widget and wrong about the answer
  (D205).** The read stopped when `scrollTop` refused to advance — TRUE, because the position was
  being written to ui-grid's PINNED viewport, which is synced from the body container and drives no
  virtualization. A true statement about the wrong thing reported a 14-of-35-day read as whole. The
  fix terminates on what the gathered set must CONTAIN (`timecardRangeCoverage` — the same invariant
  the fold already refused on, now ONE implementation shared by the loop and the fold), and the
  algorithm moved out of a `page.evaluate` closure behind a port where a fake grid runs it, because
  an algorithm inside a closure is untestable by construction.
- **"Bind columns by header NAME" became a different hardcoded offset.** The names were queried
  `document`-wide (catching the pinned `Date` header) while the cells came from a body row that has
  none. Nothing threw. Read names from the same container as the cells, and compare the counts.

**What is left.** Nothing for the migration. One recorded observation stays open: §9.20 item 7's
cold-profile first-search refusal, which is a driver-owner question rather than a separations one.

### 2 · Kuali separation-document read
<!-- roadmap: sep-2 -->

<!-- roadmap-status: sep-2 -->
- [x] a READ family beside `kuali`'s existing write family — the first store CUSTOMIZED under D194, settling five more rules (D197; 14 more selectors live-re-verified)
- [x] the pure `separations` mini-store (`sessions: []`, `effect: "read"`) — nine folds at HEAD
- [x] §4a's termination-type map captured LIVE: 16 options plus a blank sentinel, exact-match-only, no default arm (`src/domain/separations/termination-type.ts`)
- [x] live proof PASSED — five runs, all terminal `done` on attempt 1, the last three with `verified` receipts over real documents (§9.4)
- [x] the two platform items it surfaced, both landed: the receipt binds to its own run's fingerprint (D199) and a worker sweeps its own worker id on the strength of the lease it just won (D200)
- [ ] S2's refusal — a non-separation Kuali document — has never been exercised against a real one; the operator's Action List has only ever held RRSS separation forms (§9.4)
> 2026-08-20 | docs-cohesion 03b | verified against src/stores/kuali/tasks/read-separation-document.ts, src/stores/separations/tasks/, src/domain/separations/termination-type.ts; left: S2 live
<!-- /roadmap-status -->

**What it built.** The whole-form read in ONE page visit — the employee, the dates, the comments and
every control's own option list as that run observed it — plus the pure fold that resolves the
termination type to a UCPath template and reason code. Measured: a cold Kuali login is 23.5 s, the
whole-form read on top of a ready session **3.42 s**, and a warm document node 5.4–5.6 s end to end.
The read costs about as much as a single document open, which is the argument for reading the whole
surface while standing on the page.

**What the live lane caught that no fixture could — a receipt that stated something false.** The
person fields were declared `direct-identifier` on every arm leaf, so `last4` ran over the arm
DISCRIMINATOR: the receipt said `employee.name.state = "sent"` (the last four characters of
`"present"`). Only the `value` leaf is the identifier. The general rule is D197.

**Its honest cost, recorded rather than hidden.** An evidence-classification change moves receipt
BYTES for every already-settled run, and D82's insert correctly refuses the divergent rebuild by
name. The two runs that FOUND the defect are permanently frozen at their pre-fix derivation; they
are left as they are, and the fix was re-proved on three fresh runs rather than by rewriting
authority. That trade is what D199 later generalized.

### 3 · UCPath employment grid + the ALWAYS-GATE
<!-- roadmap: sep-3 -->

<!-- roadmap-status: sep-3 -->
- [x] the rich whole-grid Person Org read, classified by a separate pure fold (D201; `src/stores/ucpath/tasks/read-job-summary.ts`)
- [x] the identity-approval gate node with a SERVER-computed approval shape (D202) and the guard auditing both sinks (`identity-gate-before-commit.test.ts`)
- [x] a gate result is dependency evidence in the kernel (D203) and on the evidence receipt (D204)
- [x] first live gated run — parked, a REAL approval through the real command endpoint, resumed, terminal `done` with a `verified-done` receipt (`si-161551-774c`, §9.6)
- [x] `.or()` on a three-arm page-outcome union replaced by a settle-then-classify pair after a four-result page resolved two elements at once (D213)
> 2026-08-20 | docs-cohesion 03b | verified against src/stores/ucpath/tasks/read-job-summary.ts, src/domain/separations/identity-evidence.ts, tests/unit/architecture/identity-gate-before-commit.test.ts; nothing left
<!-- /roadmap-status -->

**A read task must not classify its own answer (D201).** Legacy computes "all rows terminated" and
"two concurrent jobs" as THROWS inside its Job Summary page module, and only when the search happened
to render a multi-row grid — so a single-employment person who is already terminated is never checked
at all, and the first live subject of this chunk was exactly that. The rich read returns the whole
grid with statuses VERBATIM and classifies nothing; the disposition is an unconditional pure fold.
The absent arms split the same way: empl record, HR status and business unit refuse a blank (a blank
means the extraction read a non-employment row), while the nine descriptive cells carry
`{state:"absent", reason}`.

**What the live lane proved that no fixture could — S22, on a real person.** The first subject was
already terminated in UCPath: one employment row, `Inactive`, reached by auto-detail. That is S22's
silent-risk scenario exactly, the case where legacy's all-terminated guard never executes and the run
proceeds to file a SECOND termination. Here the classification is unconditional, the disposition came
back `no-active-job`, the employment comparison LED the packet as a disagreement, and the gate
refused to be a one-click approve.

**What it cost.** About 29 s of live reading on a cold session and two milliseconds of judgment
(`Job Summary` 22.94 s including browser launch and the UCPath SSO chain, `Name Search` 6.24 s on the
ready session, the identity comparison 4 ms). The second UCPath search — the one legacy performs only
when its name tier says `different` — costs 6.2 s, which is the honest price of §14.2's
two-candidate presentation existing on every run.

**What it caught — D203, and it is the shape this program keeps meeting.** A post-gate node failed
with *"declared dependency `identity-approval` has no checkpoint record"*. The message was TRUE about
a record that cannot exist. The fix moves the READER, never fabricates the row.

### 4 · UCPath termination WRITE
<!-- roadmap: sep-4 -->

<!-- roadmap-status: sep-4 -->
- [x] two fenced transactions on one store — the pending sweep and the filing (D206; `src/stores/ucpath/tasks/{stage,create}-*.ts`, `delete-pending-terminations.ts`)
- [x] the Smart HR wizard's PREPARE arm live-proven end to end for a real active employee, reaching the beat-③ subject observation, `Transaction ID` reading `"NEW"` (§9.9)
- [x] structural commit-freedom proved from durable state — zero intents and zero checkpoints, five refusals for five (§9.9)
- [x] a duplicate-filing defect caught by the first live read of the in-progress grid (§9.8)
- [ ] the COMMIT arm — controlled commit ②, blocked until 2026-08-28 (Track A)
- [ ] `clear-pending`'s COMMITTED arm has no live witness at all, and no mapped subject can give it one (see the registry)
- [ ] two UCPath facts still ported legacy knowledge, not rebuild-verified: whether the confirmation dialog renders the `T…` inline, and the propagation window between submit and searchability. `recoveryAbsence` therefore stays `operator-only` — a guessed `minSinceFenceMs` is the banned unverified constant
> 2026-08-20 | docs-cohesion 03b | verified against src/stores/ucpath/tasks/ and §9.7–§9.9; left: the commit arm and everything only it can measure
<!-- /roadmap-status -->

**Two screen families, two write transactions, on one store (D206).** The sweep clears any pending
termination already sitting on the subject's record so the filing below is not the second one; the
filing is the real HR write. Each carries its own permanent key, its own probe and its own landing
proof. The first live read found a closed vocabulary the code could not match — a real defect that a
fixture built from the same code could never have found.

**What is genuinely blocked, and what is merely unmeasured.** The commit arm is blocked on the
canary's date. `probeToFenceMaxMs`'s per-beat decomposition is *unmeasured*, and the reason it stays
unmeasured is worth reading once: it was recorded twice as riding on the preview terminal, and a
settled preview emits ONE event with no beat decomposition and **has no fence at all**, so reaching
it could never have produced the number. It rides with the controlled commits (§9.17 item 4).

### 5a/b/c · Kuali finalization WRITE
<!-- roadmap: sep-5 -->

<!-- roadmap-status: sep-5 -->
- [x] ONE transaction node behind the same gate — twelve staged fields, one save, one reload read-back, one fence, one permanent key (§4e; `src/stores/kuali/tasks/{stage,save,verify}-separation-finalization.ts`)
- [x] all twelve `submitDocumentV2` `formKey`s captured PASSIVELY off Kuali's own `ActionPage` query, on a document open that sent nothing extra (§9.12, §9.16)
- [x] §4e's section-ownership caveat DISCHARGED for all twelve fields across three documents and two workflow steps (§9.16 §1, §9.19 §3)
- [x] `exactly-one-editable` proved on three open documents, discharging D208's caveat that a selector mapped on a read-only record is not verified for the editable page
- [x] the step-13 date write-backs folded into the one-pass staged set — ten fields become twelve, no graph change (D217)
- [x] a live dry run staged all ten, abandoned, and the document was proved unchanged (S61) — real doc 4524, 8.06 s, zero durable rows
- [ ] seven wire-payload shapes are RECORDED, not asserted — including both D217 dates, whose `Date` gadget model value is epoch milliseconds while the staged value is `MM/DD/YYYY`. Only a real `submitDocumentV2` payload settles them
- [ ] D207's `stabilized` recovery-absence window is PROVISIONAL — transferred with the mechanism from the Phase-2 Kuali write, and provisional until this write's own controlled commit confirms it
> 2026-08-20 | docs-cohesion 03b | verified against src/stores/kuali/tasks/*separation-finalization.ts and §9.10–§9.12/§9.15/§9.16; left: the seven shapes and D207's confirmation, both commit-only
<!-- /roadmap-status -->

**An ADDRESS is not an EXPECTATION, and the page the app itself loads often answers the question for
free.** Chunk 5a recorded that filling the nine unknown `formKey`s would be "a one-line change". The
live capture got all ten on the first try, passively, off Kuali's own `ActionPage` GraphQL query —
and the sentence was still wrong. The mutation sends the document MODEL, which holds a `Date` as
epoch milliseconds, a `Dropdown`/`Radios` as `{id,label}` and `Checkboxes` as an array of them, so
writing the keys in and leaving the comparison as `data[formKey] === "<the staged string>"` would
have made the payload check **unable to pass** for six of ten fields — turning every landed save into
a post-fence park. A check that can only fail is the same defect as one that cannot.

**The tempting middle ground failed too.** The `Department*` option `000719 -  Supply Chain Services`
carries a double space in Kuali's model while the driver reads options through
`HTMLOptionElement.text`, which strips and collapses — so a label comparison is provably wrong before
it is ever run. Five fields are asserted, five are RECORDED and named, and the controlled commit
closes them by observing the real payload.

**D217's amendment cost nothing structurally and everything evidentially.** Adding the two step-13
dates moved no edge, gate, `dependsOn` or permanent key, and D211's packet already carried both
values so the approval's digest already covered them. What changed is the honesty ledger: both
controls carry `exactly-one-visible` from a read-only pass and NOT D208's `exactly-one-editable`,
neither `formKey` had been observed (so the table admitted `null` rather than a guess), and §4e's
section caveat — discharged for ten fields — RE-OPENED for exactly these two. A discharge is scoped
to what was verified. §9.16 and §9.19 then closed it again for all twelve, on two further documents.

**Legacy's "write it only when it moved" was a property of its INCREMENTAL drafts, not of the write.**
Under one-pass staging a conditional field would need an expectation composed from the page's own
prior value, which is the re-read the model forbids — so unconditional staging is the simpler AND the
more honest form.

### 6a · THE COMPOSITION
<!-- roadmap: sep-6a -->

<!-- roadmap-status: sep-6a -->
- [x] eighteen nodes composed from tasks five chunk harnesses had already proved — zero new browser tasks minted, five new pure folds (2026-08-14, §9.13). Nineteen since D261
- [x] one ALWAYS-GATE dominating both sinks; three fenced transactions in write-safety's order — sweep, filing, finalization
- [x] the gate PACKET carries the write plan the approval authorizes: dates, template, reason code, department option, empl record (D211)
- [x] the "this graph composes no plan" arm is REQUIRED with a stated reason, not optional — an optional block is one a composition can forget to fill while every gate still renders
- [x] `receipt` sits between the filing and the finalization on purpose: §5 item 2's answer is that the UCPath receipt is the PAIR `(transactionNumber, approvalStatus)`, because D130 proved a **Denied** transaction carries a well-formed `T…`
> 2026-08-20 | docs-cohesion 03b | node list, gate ancestry and the packet's write-plan block verified against src/workflows/separations/descriptor.ts; nothing left
<!-- /roadmap-status -->

**A gate DEPENDENCY is not a gate PACKET, and the difference is the digest an approval binds to
(D211).** Chunks 4 and 5 each hung a resolved value off the gate — the `{template, reasonCode}` map,
the Kuali department option — precisely so a refusal would land before a human was asked, and each
recorded the same open item: the value is a gate dependency and is not rendered INTO the packet.
That reads like presentation and is not. §14.5 binds an approval to the digest of the exact packet
shown, so a value the gate merely DEPENDS on is a value the approval does not cover. Moving them
inside the packet makes a reconciled separation date that moves after approval re-derive a different
digest and RE-OPEN the gate.

**Where a refusal lands is decided by what the graph PRODUCES.** Chunk 3 reports "no active job" and
lets the human decide, which is right for a workflow whose product is an approved subject. The
composition FILES a termination, so a grid it cannot reduce to ONE row is a run that cannot compute
what it is about to write, and it refuses before the gate opens.

### 6b · composed LIVE pass
<!-- roadmap: sep-6b -->

<!-- roadmap-status: sep-6b -->
- [x] the whole read chain live on TWO real subjects — thirteen nodes from the Kuali document to the identity packet — parked, approved through the real command endpoint, resumed; zero durable write rows proved from authority (§9.14)
- [x] §14.5's digest binding proved LIVE: the stored gate result's `evidenceDigest` is byte-identical to the `comparison` checkpoint's
- [x] D214 — the checkpoint key gains `claimGeneration` (schema v14, `src/infra/sqlite/migrations.ts:994`), read forward so every historical row keeps a byte-identical `record_key`
- [x] D215 — a dry run probes in the REAL path's order and REPORTS `already-present` instead of performing it (zero intent, zero checkpoint, zero transition)
- [x] a measured cost for the gate-resume re-run of `timecard-search`: 30.4 s, measured twice
> 2026-08-20 | docs-cohesion 03b | D214 verified at src/infra/sqlite/migrations.ts (v14, nullable claim_generation); D215's preview arm verified in the sequencer; nothing left
<!-- /roadmap-status -->

**Two platform defects only a gated composition could expose, and both are the same mistake: a model
that was true of the ordinary case and silently wrong outside it.**

**(1) A run ATTEMPT is not one execution of its graph (D214).** The checkpoint key was
`(workflow, item, node, attempt)` — right for a graph that runs once per attempt. A gate park and its
resume are TWO executions inside one attempt by design, with an `always-rerun` node re-executing
across the boundary also by design. So the second execution's genuinely different observation landed
on the first's key and the immutable insert refused it: *a composed graph could not pass its own
gate*, and the one live run that survived did so only because a crash had bumped the attempt. The fix
is the identity the platform already had — `claimGeneration`, +1 per claim, never reset. The three
tempting alternatives each break something: writing NO row strands terminal evidence; advancing the
attempt rewrites an immutable envelope; UPDATE or delete-and-reinsert is D144/D199's forbidden
overwrite. The same defect had a second face nobody looked at — both executions emitted the same span
path, so the projector's fold collapsed them.

**(2) A rehearsal that fails where the performance succeeds is a false rehearsal (D215).**
`executeDryRun` evaluated `prepare` with no probe, and for the ORDINARY separations subject — one
with nothing pending — the real run's beat-① probe settles `already-present` before a page is staged,
while the preview staged a grid with no row to bind and *refused*. It was the common case, not the
corner. `stop-after-prepare` names where a preview STOPS; a preview that skipped beat ① was stopping
in the right place having started in the wrong one. Where the real path refuses — ambiguous, unknown,
parked, mid-submit — the preview refuses too: *a preview that answered where the real run stops is
the same defect from the other side.*

### 6c · PREVIEW TERMINAL reached
<!-- roadmap: sep-6c -->

<!-- roadmap-status: sep-6c -->
- [x] the composed dry run reached its **preview terminal** through the REAL pipeline — run `7565a88d` / `sp-105939-7565`, doc 4502, terminal `done` at `2026-08-14T18:05:17.874Z` (§9.17)
- [x] `transaction.previewed`, the preview-bound terminal record (schema `86cd007a…`) and the receipt's live `DRY_RUN_PREVIEW` warning naming the probe — all three
- [x] D215's `already-present` arm settled off a LIVE probe, and D214 exercised across three claim generations
- [x] the composed REAL (not dry) run on doc 4510 refused `NO_ACTIVE_EMPLOYMENT` before the gate (`ee9824f7`) — a RESULT, not a blocker
- [x] the D58 capability-disposition sweep for separations — three entries, all correctly dispositioned (§9.17 item 6)
- [x] the fourth defect reaching it found: D215's `not-observed` subject verdict had never reached the span WIRE leaf, so the FIRST preview that ever settled killed the worker one emit short of its terminal — fixed with its regression case at `e1ba81b`
> 2026-08-20 | docs-cohesion 03b | verified against §9.17 and src/events/types.ts's restated union; nothing left
<!-- /roadmap-status -->

**Two schemas that call each other PARITY TWINS still fork on the arm nobody could reach.** D215's
fourth subject verdict landed in the kernel's union with a comment explaining exactly why, and never
reached `src/events/types.ts` — the leaf the JSONL writer parses. `span-events.test.ts` opens by
promising it pins that restatement "so the two can never quietly fork", and its round-trip list
covered eight event shapes with **no `transaction.previewed` case at all**: the arm nobody could
execute was the arm nobody pinned, and every unit gate passed because a fixture `SpanEmitter` does
not parse the wire schema. Enumerate the VALUES a producer can emit, not just the shapes; and a test
double that skips the boundary's validation makes that boundary untested by construction.

**The kernel was right throughout.** The crash landed after the preview was computed and before
anything settled — zero intent, zero fence, zero checkpoint — and D200's lease-as-evidence sweep
released the orphaned claim on the next boot, after which the run finished.

**One §3.2 expectation was CORRECTED rather than met.** §4f3's `probeToFenceMaxMs` per-beat
measurement does not ride on the preview terminal and never could: a preview has no fence. It rides
with the controlled commits.

### Track A · separations backend completion
<!-- roadmap: track-a -->

<!-- roadmap-status: track-a -->
- [x] A1 the §4f2 canary is NAMED — Kuali doc 4537 (operator, 2026-08-19) — and mapped live the same day: one Active terminable employment, a resolvable termination type, all four owning sections `edit`, all twelve staged controls exactly one editable node (§9.19)
- [ ] A2–A4 the three controlled commits, in the order the facts force: ② UCPath filing → ① pending sweep on the row ② creates → ③ Kuali finalization. Blocked on a DATE: S7 admits 4537 on Pacific calendar day **2026-08-28**
- [ ] A5 the obligations only the commits discharge — `probeToFenceMaxMs` per beat, D207's 30 s window on this write's own evidence, the seven Kuali payload shapes, the `would-prepare` preview arm live
- [x] A6 the first live RETRY on the composed graph — six retries through the real command endpoint across two logical items, every one minting the item's next unspent attempt, no collision, one reaching terminal `done` (§9.20)
- [x] A7 the browser-profile wedge ROOT-CAUSED and fixed — Duo's WebAuthn counter is per CREDENTIAL and Duo Autopilot's copy is per BROWSER PROFILE (D243/D244)
- [!] ①'s COMMITTED arm has no witness and no mapped subject can give it one; the only honest window is re-running ① immediately after ② files, before an approver clears the row — an operator call for 08-28
- [ ] A8 close-out → separations **rebuild-ready**: regression scenarios, knowledge records, capability dispositions, owning docs to as-built
> 2026-08-20 | docs-cohesion 03b | A6 verified against §9.20's seven-run lineage table, A7 against duo-autopilot/src/{background,sign-count}.js and tests/unit/duo-sign-count.test.ts; left: A2–A5 and A8, all downstream of 08-28
<!-- /roadmap-status -->

**Track A is the last substantive work separations owes**, and it is one operator sitting plus its
close-out. The plan that named it is
`docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` §6; its ordering was
ratified by the operator the same day (Decision 5: Track B now, Track A on the canary).

| # | Step | State at HEAD |
|---|---|---|
| A1 | Name the §4f2 canary | **done** — doc 4537, 2026-08-19, mapped live (§9.19) |
| A2–A4 | The three controlled commits, ② → ① → ③ | **waits for 2026-08-28** — a date, not a defect |
| A5 | The obligations only the commits discharge | after A2–A4 |
| A6 | One live retry on the composed graph | **done** 2026-08-19 (§9.20) |
| A7 | Root-cause the browser-profile wedge | **done** — D243/D244, live-proved |
| A8 | Close-out → rebuild-ready | after A2–A7 |

**Why the order is ② → ① → ③, and not the numeric one.** ③ takes `transactionNumber` as INGRESS and
has no `match-active-employment` and no S7 check, so the standalone finalization graph is runnable on
4537 *today* — and running it now would either write a fabricated transaction number onto a real HR
document or leave the field naming nothing. The write would land and the record would be false.
① needs a subject with a PENDING UCPath transaction, and 4537's has five approved ones and none
pending, so its committed arm's only live window is the moment right after ② files.

**A6, in one line, because it is the half people forget.** D221 landed with its unit test on
2026-08-14 and had never run live; §9.20 exercised it six times across two lineages (attempts 2→3 on
one item, 2→3→4→5→6 on another), with one retried run replaying **eight** checkpoints written by two
earlier runs at two different attempts, `timecard-search` re-executing at three separate attempts,
and the last of them reaching terminal `done` at the preview terminal with zero durable write rows.

**A7, in one line, because the fix must prevent the first refusal rather than recover from it.** A
cold profile's import stamp jumped the shared Duo counter to `now` while every warm profile crept by
`+1` and could never catch up; one behind-counter assertion is refused as a cloned key AND burns that
profile's device binding permanently. The presented value is now `max(stored + 1, nowSec)`
(`duo-autopilot/src/sign-count.js`), and the runtime refuses on Duo's own rendered refusal in 9.52 s
naming the real cause instead of burning the bound and blaming Duo hand-approval.

### Dashboard · wire separations
<!-- roadmap: sep-dash -->

<!-- roadmap-status: sep-dash -->
- [x] all nine wire squares filled — the last (notifications) closed by D262 on 2026-08-20; each verified against the code below, not against the tree
- [x] the connection proof: the REAL dashboard drove a REAL composed dry run and every UI claim was paired with an independent authority read (Track C, §9.22) — five defects found, all fixed the same day (D256–D259 and the shape-hazard correction)
- [ ] T1 — the structural fixture scenario plus the live dry-run scenario with checkpoints (R10; cohesion step 5.2). `tests/scenario/separations.scenario.test.ts` is the structural half today and is not yet in the T1 layout
- [ ] T2 — a dashboard scenario over the wired surfaces (R10; cohesion step 5.2)
> 2026-08-20 | docs-cohesion 03b | nine squares verified against src/workflows/separations/descriptor.ts (inputRun · timeline · nodePurposes · subjectProjection · presentation · verdicts), src/domain/archive/ledger-resolution.ts:167, src/services/notifications/gate-park.ts wired at src/server/dashboard/compose.ts:497, src/dashboard/app/identity-ceremony.ts; left: the two PROOF lines
<!-- /roadmap-status -->

A migration's `Dashboard · wire` task supplies DECLARATIONS and a proof, never a new surface — the
surfaces are doc 03a's `{#dash-defaults}`. Separations was the forcing function for most of them, so
the squares filled as Track B built them; the table below is the separations half, verified in the
code at HEAD.

| # | Square | What separations declares | Verified at |
|---|---|---|---|
| 1 | **Run modal** | `surfaces.inputRun` — one `document-number` rule, no `otherwise` arm, `timekeeperName` as a constant, two examples that are real document numbers (D250/D251, D261) | `descriptor.ts` `surfaces.inputRun` |
| 2 | **Queue row** | `subjectProjection` (UCPath's displayed name, never the Kuali form's claim), `presentation.title`/`subtitle`, `category`, `verdicts`, `enqueue: reject-active` (D230–D235) | `descriptor.ts`; §9.22's row-by-row pairing |
| 3 | **Run detail** | the six declared timeline CATEGORIES over nineteen nodes, legacy's step vocabulary kept (D225); the Data rail derives direction from each node's task-contract `effect` (D252) | `descriptor.ts` `timeline` |
| 4 | **Gate ceremony** | the ALWAYS-GATE's three server-shaped ceremonies plus rejection (D226); the settled decision read off the durable `gate_results` row (D237) | `src/dashboard/app/identity-ceremony.ts`; `identity-approval.ts:71` |
| 5 | **Archive** | separations' three commit contracts are the FIRST `LEDGER_PRESENTATION_DECLARATIONS` entries — and two of the three declare that they have NO confirmation number, with the reason (D223) | `src/domain/archive/ledger-resolution.ts:167` |
| 6 | **Explorer** | `nodePurposes` — the descriptor's own words for all nineteen nodes — plus the field census and the declared `when` in words (D227–D229) | `descriptor.ts` `nodePurposes` |
| 7 | **Activity** | separations in the per-workflow cross-tab and in the write-ledger block, which is served as an explicit D81 carve-out (D236) | `src/domain/dashboard/activity.ts:219`; `surfaces/activity.tsx:27` |
| 8 | **Notifications** | a park at the ALWAYS-GATE publishes a needs-you row to the durable inbox by re-derivation over authority, never by the park's own transaction (D262) | `src/services/notifications/gate-park.ts`, composed at `src/server/dashboard/compose.ts:497` |
| 9 | **Connection proof** | every surface read against the real composed run, each UI assertion paired with authority (Track C) | `docs/migrations/separations.md` §9.22 |

**Two of the three ledger declarations refuse to serve a confirmation column, and that is a property
of the write.** UCPath issues no receipt for an in-progress-grid delete, and Kuali's save is
UI-silent — its proof is a reload READ-BACK, which is evidence that the document holds the values and
is stronger than a receipt without being one. Serving the document number there would let a reader
take it for a confirmation.

**What Track C's proof cost, and why it was worth it.** Every one of the five defects it found had
passed every unit, architecture and scenario gate: a REPLAYED node was indistinguishable from one
that never ran on every surface that folds spans; every live elapsed was frozen at page load; the
`wf <hash>` shape-hazard chip was structurally always on (comparing a run's one-workflow fingerprint
against the whole eight-workflow SET hash); the open run-detail panel did not follow its run, so the
evidence receipt was unreachable from a panel you had open; and one poisoned 2026-08-14 run was
blocking every archive. None was reachable without connecting the two halves.

## Platform fixes the live runs forced
<!-- roadmap: platform-fixes -->

<!-- roadmap-status: platform-fixes -->
- [x] D218 — the run/queue projector tails the span stream FROM DISK, cross-process; the in-process `onEvent` hook is DELETED so "append first, fold after" is structural (`compose.ts:598`, `command-service.ts:159`)
- [x] D221 — a retry is the ITEM's next unspent attempt, taken from authority inside the enqueue's own transaction (`authority-database.ts:3782`); live-proved §9.20
- [x] D219/D220 — a chunk harness is a step of its composition, declared as a required module ROLE; "proves machinery, belongs to no composition" is its own arm (`src/domain/workflow/module-role.ts`)
- [x] D222 — the backup hazard moved from the every-view banner to the durable inbox, published on state TRANSITIONS only (`src/domain/notification-triggers.ts:92`). Ratified under phase 3a; it lands here because it is one of the same sweep
- [x] D243/D244 — Duo's shared WebAuthn signature counter, root-caused and pinned by this repository's own gate (`duo-autopilot/src/sign-count.js`, `tests/unit/duo-sign-count.test.ts`)
- [x] D216 — both repos name their browser-profile root `.auth`; the SESSION namespace is the distinct half (`config/runtime-isolation.json`)
> 2026-08-20 | docs-cohesion 03b | all six verified present at the file:line cited; nothing left
<!-- /roadmap-status -->

Six platform corrections that only live runs of a composed, gated, multi-process workflow could
force. Their normative text lives in the reference docs each owns; what belongs here is why a
migration was the thing that found them.

**A projection fed by an in-process hook is correct only while every emitter lives in that process,
and nothing fails when that stops being true (D218).** The worker is a separate OS process, so every
run enqueued after the dashboard booted served an EMPTY timeline while its full span history sat in
`spans/*.jsonl`. It hid because run STATUS joins authority per surface and LOGS re-read the notes
JSONL per request, so the two surfaces BESIDE the timeline kept working and the gap read as a
rendering quirk.

**Every component of an ITEM-scoped key must itself be item-scoped (D221).** D214 closed the
collision one ATTEMPT could hold; the same collision one level up — across RUNS of one item — stayed
open, because `run`/`retry` minted a new run for the same logical item at attempt 1. **A separations
run that failed at or after `timecard-search` could not be retried at all.** Fixing the field's
MEANING rather than the key's SHAPE moved nothing on disk: no migration, no schema version, every
stored `record_key` byte-identical.

**An alert lane that lives inside the thing it reports on cannot report that thing's death (D222).**
Backup stale/missing publishes `storage-degraded` on transitions only, while authority-unavailable
KEEPS the banner — the inbox is an authority table, and an authority that cannot be written cannot
record a notification about its own death.

**A counter kept per WRITER cannot describe a resource shared by many writers (D243/D244).** Duo's
counter is per CREDENTIAL; Duo Autopilot's copy is per BROWSER PROFILE; doc 05 §1 partitions profiles
per `(worker, system, instance, configFingerprint)`. So N writers shared one server-side counter and
none could see another's copy. The pin lives in THIS repository's gate rather than the extension's
own lane, because `duo-autopilot/` is a hard runtime dependency and a rule pinned where
`npm run test:coverage` cannot see it is a rule no per-commit gate checks.

## The workflow tree — folders are the rail and the timeline
<!-- roadmap: workflow-tree -->

<!-- roadmap-status: workflow-tree -->
- [x] D265 ratified — the rule, the separations mapping and the `workflow-layout` guard's invariant are written (`ref workflow-model` §1.2.2, 2026-08-21)
- [x] `src/workflows/separations/` gains six step folders — `kuali-extraction` · `identity-check` · `job-summary` · `kronos-timecard` · `ucpath-transaction` · `kuali-finalization` — each holding its node fragments; the composition's `timeline` is one category per folder
- [x] the five harnesses move INTO the step they prove (`descriptor.ts` + `module.ts`, role `chunk-harness of separations, step <folder>`); ids unchanged; the three write harnesses import `identity-check/`'s fragments instead of restating them
- [x] `kuali-timekeeper-annotation` DISMANTLED (D266): workflow, module, four `kuali/*-timekeeper-annotation` tasks + contracts + UI-registry entries, its scenario file and claims, the `proving` role arm and the `Test equipment` group; parity references re-frozen; `guard-inventory.json`'s D188 successor re-pointed
- [x] the FIRST T1 pair — `tests/scenario/workflows/separations-kuali-finalization/{structural.scenario.test.ts, dry-run.scenario.ts}`, seeded from the valid real-sequencer proof shape (`ref guards-and-tests` §10.3/§10.4, D266)
- [ ] run the T1b manifest live against the finalization canary and record `met` — registry, insert-only result authority and CLI runner are built; the honest target is unavailable until 2026-08-28. The 2026-08-25 production CLI execution recorded immutable result `d0a75e7f-b021-4e9e-a288-a8e6266fe2b4` as `blocked`/`not-started`, with `run_id = null` and `trace_id = null`, before browser composition; that refusal is evidence for the blocker, not a green T1b result
- [x] `module-role.ts`: `chunk-harness` gains `step`; the registry refuses a `step` that `of` does not declare
- [x] the `workflow-layout` guard + its `guard-inventory.json` activation; `descriptor-coverage` and `workflow-editor-compile-integrity` derive a descriptor's path from its ROLE
- [x] `npm run build:manifest` regenerated; the D191 gate green; rendered rail/picker/Explorer inspected and intentional D266 visible changes re-frozen/asserted by parity
> 2026-08-21 | workflow-tree ruling | drawn from the operator's ruling; D265 ratified in ref workflow-model §1.2.2; nothing under `src/workflows/` has moved yet — the move is the next session's code unit
> 2026-08-21 | workflow-tree ruling | D266 the same session — `proving/` withdrawn; `kuali-timekeeper-annotation` dismantled into the Kuali finalization step's T1 pair
> 2026-08-25 | test-tiers | source/test retirement and runner machinery complete; the rail has only main workflows, picker/Explorer nest all five marked harnesses, and the unavailable finalization canary produced durable blocked result `d0a75e7f-b021-4e9e-a288-a8e6266fe2b4` (`not-started`, no run/trace). The only remaining T1b step is the date-gated live green on 2026-08-28
<!-- /roadmap-status -->

**The ruling (2026-08-21).** Eight sibling folders under `src/workflows/` — `separations` beside the
five `separations-*` harnesses that are its steps, `kuali-timekeeper-annotation` beside daily HR
work — told an author nothing the operator's surfaces have to say three times over (D219/D220/D241).
The operator's direction: one `separations/` folder, its timeline steps as sub-folders, and only
`separations` on the rail — *"organized down to the folder level."* `ref workflow-model` §1.2.2 owns
the rule; this section is what it means for separations and what the code unit does.

| `src/workflows/separations/<step>/` | Timeline label (D225) | Harness inside (id unchanged) |
|---|---|---|
| `kuali-extraction/` | Kuali extraction | `separations-kuali-read` |
| `identity-check/` | Identity check | `separations-identity-check` |
| `job-summary/` | Job summary | none — proved inside `identity-check`'s harness |
| `kronos-timecard/` | Kronos timecard | `separations-kronos-timecard` |
| `ucpath-transaction/` | UCPath transaction | `separations-ucpath-termination` |
| `kuali-finalization/` | Kuali finalization | `separations-kuali-finalization` |

**`kuali-timekeeper-annotation` — what it was, and the ruling that dismantles it (D266).** It was
not a leftover and not a migration: the purpose-built one-transaction-node workflow that carried
Phase 2's controlled-commit proof (D135) — one benign, restorable field on a real Kuali RRSS
document, the reload read-back as the only landing proof, the propagation window measured on it
(doc 02). The first draft of this section kept it as "test equipment" under `proving/`. The operator
ruled otherwise the same day: *"this is just a part of the testing framework … it should be
dismantled and could be used to create the dry run and scenario for the Kuali separation workflow."*
So it goes — workflow, module, tasks, contracts, UI entries, scenario, the `proving` arm and the
`Test equipment` group — and what was valuable in it is re-seeded where `ref guards-and-tests` §10
says a proof of machinery lives: the FIRST T1 pair in the tree, for the Kuali finalization step
(`separations-kuali-finalization`): `structural.scenario.test.ts` keeps the valid real-sequencer
proof shape over the current descriptor (zero write-intent, transaction-checkpoint and outbox rows
for preview/refusal arms, with the ordinary upstream task checkpoints allowed), and
`dry-run.scenario.ts` is the live manifest
`cli dry-run-scenario` runs against the finalization canary. §3.4's proof of record and D207's window
are history and stay cited; the Kuali write proof going forward is chunk 5c's own commit.

**What the code unit does NOT do.** No id changes (`separations-identity-check` stays
`separations-identity-check`; a path move re-stamps no run, receipt or checkpoint), no change to how
the rail filters main workflows, no change to startability or to the §3.2 proofs each harness holds.
The intentional picker/Explorer hierarchy delta is that ALL five harnesses now nest under
Separations, including the Kronos harness whose own HR category remains `timekeeping`; grouping by
`role.of` happens before category partitioning. The three write harnesses stop carrying their own
copy of the identity-gate nodes and import `identity-check/`'s — the functional simplification that
required `build:manifest` regeneration.

## Smaller operator calls open
<!-- roadmap: operator-calls -->

<!-- roadmap-status: operator-calls -->
- [!] `clear-pending`'s COMMITTED arm has no live witness, and none of the mapped subjects can give it one. The only honest window is re-running ① immediately after ② files on 2026-08-28, before an approver clears the row — otherwise the arm ships proved by fixture and by the sequencer, never by a real deletion. **Your call on 08-28**
- [x] keep or retire `kuali-timekeeper-annotation` — **ANSWERED 2026-08-21: RETIRE (D266)**, dismantled into the testing framework as the Kuali finalization step's T1 pair (§The workflow tree)
- [x] the gate-age pill (D12 vs the later direction) — **ANSWERED 2026-08-18**: the status pill carries NO age (*"the word names the work, not the wait"*); the age renders in the row's footer meta and in the log panel. `reference/dashboard-surfaces.md` carries the amendment; `src/dashboard/surfaces/queue.tsx:281` renders it
- [x] D192's re-disposition of `legacy-tool-ops-sanity-check-record` — **ANSWERED 2026-08-18**: no AI feature; the §14.2 packet's server-computed `comparisons` array is the sanity check, deterministically. The register entry is `retired` with the ruling's own words (`config/legacy-capabilities.json:1266`)
- [x] A6's first live retry as evidence — delivered 2026-08-19 (§9.20)
> 2026-08-20 | docs-cohesion 03b | the two doc-side items were verified CLOSED against reference/dashboard-surfaces.md, src/dashboard/surfaces/queue.tsx and config/legacy-capabilities.json — the tree still listed both as open and is corrected; left: the ① witness call
<!-- /roadmap-status -->

**Three of the four calls this node was drawn for are settled**, and they were settled before this
doc was written — which is exactly the drift a two-way binding exists to catch. The one that remains
is a real decision with a real deadline, and it cannot be made earlier than the day the canary
unblocks: whether to spend the narrow window after ② files to give ①'s committed arm its only
possible live witness, or to accept that arm as proved by the sequencer and its fixtures and say so
in the close-out. Both are defensible; neither is a default.

**A second call opened and closed 2026-08-21.** Keep or retire `kuali-timekeeper-annotation`: the
recommendation was keep; the ruling is RETIRE (D266) — it is part of the testing framework, and its
harness seeds the Kuali finalization step's T1 pair (§The workflow tree, above).

**Also settled, recorded so nobody re-opens them:** the Activity hours-saved tile is DROPPED (D239),
archive tabs and export are closed by D223/D240, and `span.patched` is RETIRED (D254).

## Decisions this phase ratified

Checked against `reference/decisions.md`'s `_phase: 3b_` markers on 2026-08-20. The ratification act
and the normative pointer stay in the ledger; this is the phase index.

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 47 | 2026-08-12 | D193 | **the Phase-3 entry is separations** — with the solo/local scope clause and the storage stance in the same ruling |
| 48 | 2026-08-12 | D194, D196 | the rich-extraction convention (one task per page visit) and the five rules `new-kronos` settled for every store after it. *(D195, in the same round, is phase 3a.)* |
| 49 | 2026-08-12 | D197, D198 | the first store CUSTOMIZED under D194 — `kuali` gains a read family — and a wire contract is connected both ways or it is on the books |
| 50 | 2026-08-12 | D199, D200 | the two platform items chunk 2 surfaced: a receipt binds to its OWN run's fingerprint; a worker sweeps its own id on the strength of the lease it just won |
| 51 | 2026-08-12 | D201–D205 | the UCPath identity read and the ALWAYS-GATE — read-reports/fold-judges (D201), the gate built and its guard widened to both sinks (D202), the gate result as kernel evidence (D203) and as receipt evidence (D204), and the virtualized read terminating on the answer (D205) |
| 52 | 2026-08-14 | D206 | one store, two screen families, two fenced write transactions |
| 53 | 2026-08-14 | D207 | a measured propagation window transfers with the MECHANISM, and the transfer is provisional until that write's own controlled commit |
| 54 | 2026-08-14 | D208–D210 | the dry-run platform slice — `exactly-one-editable` as a distinct evidence strength (D208), dry-runnability derived from the GRAPH (D209), and a preview's terminal being a different RECORD rather than a fabricated outcome (D210) |
| 55 | 2026-08-14 | D211 | the gate packet carries the WRITE PLAN, and the digest binds the approval to it |
| 56 | 2026-08-14 | D212, D213 | the timecard loop's range proof (D212) and `.or()` as a mutual-exclusion CLAIM (D213) |
| 57 | 2026-08-14 | D214, D215 | the two blockers the composed live pass surfaced — the claim generation in the checkpoint key, and the preview that must probe first |
| 58 | 2026-08-14 | D216 | both repos name their browser-profile root `.auth`; the session namespace is the distinct half |
| 59 | 2026-08-14 | D217 | §4e's date staging — ten fields become twelve, and a new staged field inherits NO evidence |
| 60 | 2026-08-14 | D218 | the projector consumes the span stream FROM DISK, cross-process |
| 61 | 2026-08-14 | D219, D220 | a chunk harness is a step of its composition; "proves machinery, belongs to no composition" is its own role arm |
| 62 | 2026-08-14 | D221 | **a retry is the ITEM's next attempt** |
| 66 | 2026-08-19 | D226 | the identity gate's three ceremonies, and an unknown `approvalShape` refusing by name |
| 77 | 2026-08-20 | D245, D246 | the parked write gets a way in and keeps its way out |
| 84–86 | 2026-08-20 | D260–D262 | the start door refused with its trigger named (D260), then BUILT — the graph resolves its own action id (D261) — and the gate park published as the product's one needs-you moment (D262) |
| 89 | 2026-08-21 | D265 | **the workflow tree IS the rail and the timeline** — one folder per rail workflow, one sub-folder per timeline step, test equipment under `proving/`; role ↔ path pinned by `workflow-layout` |
| 90 | 2026-08-21 | D266 | **the crash-test dummy is dismantled** — `kuali-timekeeper-annotation` goes; its harness becomes the first T1 pair (Kuali finalization); `proving` / `Test equipment` / `proving/` / D127's exemption retire with it |

**Ratified elsewhere, load-bearing here.** D77 (the ALWAYS-GATE itself, Phase 0) is what this
migration implements; D222, D223, D225 and D230–D242 (phase 3a) are the dashboard defaults the wire
squares fill; D243/D244 and D247 carry `_phase: platform_` in the ledger and are listed under
§Platform fixes because a separations live run is what forced them.

## Exit criteria

The **nine per-workflow criteria** are doc 03c §Exit criteria, which every migration answers.
`docs/migrations/separations.md` §6 owns separations' own copy of the checklist. Separations stands
at **8 of 9**, and the ninth is open on a calendar date.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | **§5 questionnaire answered and every §4 decision answered** | **MET** 2026-08-12 | all twelve §5 items plus §4a–§4g in one sitting, including item 5's residuals 5A/5B (the freshness values and the date fields' override column) |
| 2 | **`typecheck` + `lint` + `test:coverage` green (D191); `descriptor-coverage`; every commit contract passes `write-safety-contract` and transaction pairing** | **MET** | green at HEAD; the build manifest regenerates clean |
| 3 | **Every input/output/result/command/detail/evidence parses strict; every UI id, scenario id and subject observation resolves; no raw `Page`/`Locator`/selector outside the system driver** | **MET** | `strict-boundary-schemas`, `semantic-ui-registry`, `scenario-coverage`, `task-driver-boundary` |
| 4 | **Live dry-run green against Kuali, UCPath and New Kronos — submit-free, zero durable write rows ASSERTED** | **MET** 2026-08-14, re-proved twice since | run `7565a88d` / `sp-105939-7565` to the preview terminal (§9.17); run `e1b8ae3e` / `sp-081217-e1b8` driven from the real dashboard (§9.22); run `1e0b7cc2` / `sp-105225-1e0b` from one typed number (§9.24). Zero write rows proved from authority every time |
| 5 | **Controlled-commit evidence for every commit/probe/verify on an operator-approved target** | **OPEN — all three** | the canary is doc 4537, named 2026-08-19 and mapped live (§9.19). **② unblocks on Pacific calendar day 2026-08-28** (S7 passes on equality), then ① on the row ② creates, then ③ once a real `transactionNumber` exists. Unavailable safe evidence BLOCKS rebuild-ready; a dry-run success is never converted into a write-safety claim |
| 6 | **`identity-gate-before-commit` green — every commit and the terminal result graph-reachable only through the gate** | **MET** | the guard walks both sinks (`tests/unit/architecture/identity-gate-before-commit.test.ts`), and §14.5's digest binding is proved LIVE: the stored gate result's `evidenceDigest` is byte-identical to the `comparison` checkpoint's (§9.14) |
| 7 | **D58 capability dispositions updated for every legacy capability this workflow touches; legacy source and tests preserved** | **MET** 2026-08-14, and its one finding since CLOSED | three entries touched, none stale under D188's arm, no legacy path deleted (§9.17 item 6). The flagged item — D192's condition on `legacy-tool-ops-sanity-check-record` — was closed by the operator on 2026-08-18 and the entry is `retired` |
| 8 | **Regression scenario + knowledge record for anything the live lane finds; owning docs and the nearest `CLAUDE.md` updated** | **MET** | D212/D213 (`d00b66c`, `1d019ee`), D214/D215, the `already-present` receipt arm (`b73b546`), the span-wire fork (`e1ba81b`), D221 (`tests/unit/retry-item-attempt.test.ts`, live-proved §9.20) and the browser-profile wedge (D243/D244, `tests/unit/duo-sign-count.test.ts`, both arms verified RED pre-fix) |
| 9 | **§2.6 confirmed and ratified — D194 in `ref task-contract` §2.8, pointer in the ledger round 48, ref stores §1 updated** | **MET** 2026-08-12 | every read task this migration authored is authored under it |

**The three confirmation obligations that only criterion 5 can discharge**, so they are not separate
criteria and must not be counted as met: D207's provisional `stabilized` recovery-absence window;
D215's `would-prepare` preview arm observed against a real settlement; and D217's two date
write-backs' WIRE SHAPES (their `formKey`s are captured, but a `Date` gadget's model value is epoch
milliseconds, so only the real payload settles them). §4f3's `probeToFenceMaxMs` per-beat measurement
rides with them for the reason §9.17 item 4 established: a preview has no fence.

### What Phase 3c reads from this phase as met

The second migration is entitled to assume all of the following, none of which depends on criterion
5. This is the reuse D193 bought.

1. **The store task libraries exist.** `kuali` (10 tasks), `ucpath` (10), `new-kronos` (2, built
   whole), and the pure `separations` mini-store (9 folds) — with D194/D196/D197's conventions
   settled and ref stores regenerated. A later migration adds tasks to a store that already has a
   driver, a login recipe, a published UI registry and live-verified selectors.
2. **The ALWAYS-GATE is built and proved live**, with its server-computed ceremonies (D226), its
   packet binding every value the approval authorizes (D211), its durable record readable as
   dependency evidence by both the kernel and the receipt (D203/D204), and its guard auditing both
   sinks (D202). A gated workflow inherits all of it.
3. **A typed start door is a solved problem, including when the ingress needs a value nobody types.**
   D260 states the rule; D261 shows the escape hatch — derive the value as a graph OUTPUT — and what
   it costs (a moved fingerprint, and a refusal arm per way the derivation can fail).
4. **The `Dashboard · wire` pattern is proved end to end.** Nine squares, filled by DECLARATIONS on
   the descriptor plus one entry table for the ledger, with the connection proved against a real run
   and each UI claim paired to authority. Doc 03c's `Dashboard · wire <workflow>` template is this
   table with the workflow's name substituted.
5. **The platform corrections a composed, gated, multi-process workflow forces have all landed** —
   the cross-process projector, the item-scoped retry attempt, the claim generation in the checkpoint
   key, the probing dry run, the module roles, and the Duo counter. A second migration should not
   re-discover any of them.

**What Phase 3c must NOT assume.** No controlled-commit evidence exists for any separations write, so
nothing about the UCPath termination or Kuali finalization write paths is proved beyond `prepare`;
`recoveryAbsence` for the UCPath termination stays `operator-only` until a propagation window is
measured; and `clear-pending`'s COMMITTED arm has never run against a real pending row.
