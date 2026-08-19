# Handoff — Phase 3 completion (separations + the dashboard it forces into existence)

**For:** an orchestrator session (Opus, xhigh effort) dispatching focused Opus-high subagents,
~300–350k tokens each.
**From:** the 2026-08-18 planning/execution session (Fable 5).
**Working plan this executes:** `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md`
— read it first, in full. It carries the glossary (what `§4f2`, "canary", "ALWAYS-GATE",
"controlled commit", "fence", "wire ledger" mean), the conformance/drift audit, and the operator's
own framing. This handoff is the EXECUTION layer on top of it: what to dispatch, in what order,
with what acceptance bar, and what to ask the operator before starting.

---

## 0 · Read this before you plan anything

### 0.1 The five things that will bite you if you skip them

1. **You are not alone in this working tree.** At least one other Claude session edits this repo
   concurrently, including files you will touch (`docs/rebuild/03-tracker-dashboard.md`,
   `docs/rebuild/04-reconciliation.md`, `src/dashboard/**`). Invoke the **`custom-hr-tree-guard`**
   skill before any multi-file operation or commit. Never `git add -A`, never `git stash`, never
   `git clean`. Stage by explicit pathspec; when a doc has both your hunk and theirs, filter the
   patch (this session did it twice with a small Python hunk-splitter — see §6.3).
2. **Decision numbers collide.** On 2026-08-18 two sessions both minted **D222** for unrelated
   decisions, and the loser had to renumber across nine files after the fact. **Re-read
   `docs/rebuild/04-reconciliation.md` at HEAD immediately before you mint a number, and mint it in
   the same commit as its normative text.** Highest at this handoff: **D225**. Reserve your block
   out loud in your first commit if you expect to mint several.
3. **A decision is not ratified until its normative text lands in the OWNING doc, in the same
   commit that records it.** `04-reconciliation.md` gets a one-line pointer only — it is an index,
   never a spec, and you may never implement from it.
4. **Guards catch real defects. Never declare around one.** In this session the archive guard
   refused a new value-import (it would have made an archived run un-renderable without its
   descriptor) and the redaction audit refused two undeclared wire leaves. Both were genuine; both
   were fixed at the cause. If a guard fails, the guard is probably right.
5. **`npm run build:manifest` after ANY edit inside a descriptor's import closure** (that includes
   `src/base/**` and most of `src/domain/**`). A stale manifest is a red gate, not silent drift.

### 0.2 The gate, every time

```bash
npm run typecheck && npm run lint && npm run test:coverage
```

`test:coverage` is the per-commit gate (D191) and is a strict superset of `test` + `test:architecture`.
Baseline at this handoff: **2017 tests / 211 files green**, 61 active guards, schema v14, parity
147/147 in ASSERT mode. Any subagent that reports "done" without this output is reporting a claim,
not a result — verify per `superpowers:verification-before-completion`.

### 0.3 Where truth lives

| Layer | File(s) | Rule |
|---|---|---|
| Owning docs (normative) | `docs/rebuild/00`–`13` | Each owns its contracts. Doc 03 = dashboard, 09 = write safety, 13 = the wire, 02 = workflow model, 07 = phases/exit criteria, 12 = operator trust |
| Decision index | `docs/rebuild/04-reconciliation.md` | Pointer only |
| This migration | `docs/migrations/separations.md` | §4/§5 questionnaire · **§6 exit checklist** · §9.x dated as-built (latest: §9.18) |
| Findings ledger | `docs/findings/` | Backend problems found in frontend sessions are RECORDED, never fixed in-session. Delete a record when its fix lands in the owning doc |
| Wire worklist | `docs/plans/2026-08-13-detail-fidelity-audit.md` §"Wire-hookup ledger" | **17 rows still `to declare`** — the definitive frontend↔backend connection list |
| Derived views | `ROADMAP.md`, `STORES.md` | Regenerate at slice boundaries; owning docs win |

---

## 1 · State at handoff (2026-08-18)

**Backend — separations is at 7 of 9 exit criteria** (`separations.md` §6). Built and live-proven:
all chunks 1→6c, the composed 18-node graph, the live dry run through a real operator gate approval
to a real preview terminal on doc 4502. **Zero durable write rows** exist beyond the 2026-08-04
Phase-2 proof. Open: the **three controlled commits** (operator-blocked, §2.1) and the
**browser-profile-wedge regression record** (§9.17 item 5).

**Frontend — the detail-fidelity wave is complete (R1–R8)** and the 08-14→08-18 push landed queue
rows, workflow roles/rail, run-detail step durations, the archive card, the Activity cross-tab, and
(this session) the **categorical timeline (D225)** on the real wire. Remaining work is the wire
ledger's 17 rows plus ~23 open findings records.

**Decisions this session ratified, which you inherit as settled:**

| D | What it settles | Owning doc |
|---|---|---|
| **D12 (amended)** | The gate-age pill carries NO age; the age lives in the row footer meta and the log panel — the demo's own layout, confirmed by the operator against the reference | doc 03 |
| **D223** | The archived detail follows the demo: **five tabs** (Summary/Logs/Data/People/Evidence) and an **Export** control. The archive snapshot must FREEZE section payloads (schema bump, read-forward per D133); Export writes exactly the display-redacted `ArchivedRunDetailWire` | doc 03 §10.2 |
| **D225** | The run-detail timeline is CATEGORICAL — a segment is a descriptor-declared category, not a node; declarations are exhaustive-or-refused; a gate-resume re-execution folds into `×N` | doc 03 |
| — | **No AI sanity check.** `legacy-tool-ops-sanity-check-record` retired; the §14.2 gate packet's deterministic comparisons ARE the check | doc 12 §4.4 |

**Operator's dry-run practice set (separations §9.18): Kuali docs 4537, 4502, 4495.** These are
PRACTICE subjects, **not** controlled-commit canaries. Constraint: S7 refuses a future-dated
separation at `plan`, so **4502** is the full-chain composed dry-run subject today, **4537** owes a
read-only mapping pass, and **4495** unlocks after 09/02/2026.

---

## 2 · The work, decomposed for dispatch

Three tracks. **Track B runs now; Track A waits on the operator; Track C gates the whole thing.**
The operator explicitly ratified this ordering ("yes. run it.").

Each unit below is sized for ONE subagent at 300–350k tokens. Each names its scope, its acceptance
bar, and whether it can run in parallel. **Units marked ⛓ are sequential** (they touch the same
files or depend on each other's output); units marked ⚡ are independent and belong in a parallel
worktree fan-out per the global CLAUDE.md worktree discipline.

### 2.1 Track A — backend completion (blocked at A1 on the operator)

| Unit | Scope | Parallel | Acceptance |
|---|---|---|---|
| **A1** | **OPERATOR DECISION — name the §4f2 canary.** See §3.1 for the exact question and the four options with their consequences | — | An answer in the transcript, recorded into `separations.md` §9.19 |
| **A2–A4** ⛓ | The three controlled commits: ① `clear-pending` sweep · ② UCPath termination filing · ③ Kuali finalization save. Each is ONE real write against the approved target, with fence + reload read-back proof, then restore where restorable | ⛓ (one at a time, live) | Durable evidence per doc 09 §Phase-2 as-built: `committed` intent, transaction checkpoint, outbox rows, terminal span, and an idempotent re-run answering `already-present`. Recorded in `separations.md` §9.x with measured numbers and row ids |
| **A5** ⛓ | Discharge what only the commits can: `probeToFenceMaxMs` per-beat decomposition (§4f3) · confirm D207's provisionally-reused 30 s Kuali propagation window · assert the seven unobserved Kuali payload shapes incl. the two D217 date fields (epoch-ms) · exercise the `would-prepare` preview arm live | ⛓ after A2–A4 | Each obligation named MET with its measurement in the as-built |
| **A6** ⚡ | **Live retry on the composed graph.** D221's fix (a retry advances the ITEM's attempt) is landed and unit-tested but never exercised live. Use a dry-run subject — **not canary-blocked** | ⚡ | A real retried run reaching a terminal state, recorded |
| **A7** ⚡ | **Root-cause the browser-profile wedge** (§9.17 item 5: one worker profile failed session acquisition three times at the full 60 s `sessionAcquireMs` bound while a fresh profile logged in in 17.9 s). Root-cause, fix, pin a regression | ⚡ | §6's regression checkbox closes; a test pins the failure mode |
| **A8** ⛓ | Close-out per doc 07 §3.1 step 7: regression scenarios, knowledge records, capability dispositions, docs to as-built → mark separations **rebuild-ready** | ⛓ last | `separations.md` §6 at 9/9 |

### 2.2 Track B — dashboard completion (runs now)

Ordered so each unit is proven by the separations run that exercises it. **B1 is the highest-value
unit in this handoff** — it is the one surface a real separations run needs a human on.

| Unit | Scope | Parallel | Acceptance |
|---|---|---|---|
| **B1** ⛓ | **Identity-approval ceremonies.** Today only one-click approve exists; `src/dashboard/app/command-dispatch.ts` refuses *choose-among-candidates*, *type-the-EID*, and *rejection-reason* **by name**. Build all three against the SERVER-computed `approvalShape` (doc 09 §14 — server-computed precisely so a frontend cannot quietly downgrade every gate to one click). Add the missing **gated parity fixture** (no fixture authors an `identity-gate` section today) | ⛓ (owns the gate surface) | The three ceremonies drive the real command endpoint; a parity fixture photographs a gated run; doc 09 §14 / doc 13 get the normative sentences |
| **B2** ⚡ | **The two recorded honesty gaps** (§9.17 item 7): (a) a settled gated run's panel cannot say its gate was approved, by whom, when — D204 already serves the approver, so this is a pure read; (b) a preview (dry-run) run's outcome chip reads `verified-done`, the label reserved for independently-verified real completions | ⚡ | Both surfaces state the truth; tests pin both; the §9.17 records are struck |
| **B3** ⚡ | **Run modal (run-start) batch** — typed-input `examples[]`/`parserLabel`, `capability.note` + method tabs, active-run policy control, per-workflow unstartable reasons. All four are wire-ledger rows with demo shape oracles named | ⚡ | Four ledger rows leave `to declare`; `pending-wire-bindings.json` and doc 13 updated in the same commits |
| **B4** ⚡ | **Queue rows finish** — the remaining `QueueBaseFields` batch (`runNumber`, `linkedRunIds`, `facts[]`/`extractedCount`, `memberPreview`+`groupNoun`, member `eid`+outcomes, `pipeline[].durationSec`, `rejectedCount`, `containment`), the **rename control** (kernel command exists, no UI), and the **bulk** command strip + result-vector band | ⚡ (ONE batched wire change with the projector, per the ledger's own note) | `docs/findings/queue-rows.md` reaches zero; doc 03's queue-row delta extended |
| **B5** ⛓ | **Archive finish, per D223** — freeze section payloads into the archive snapshot (schema bump, read-forward), render the five tabs, add Export; plus evidence-tile fields, per-attempt history, and `LEDGER_PRESENTATION_DECLARATIONS` (empty today — **separations' three commit contracts are its first three entries**) and an e2e test archiving a run that filed a ledger line | ⛓ (schema work) | `archive-invariants` still proves every tab renders with the descriptor list EMPTY; `docs/findings/archive.md` reaches zero |
| **B6** ⚡ | **Explorer finish** — field-level contract rows (Field · System · Recorded), the descriptor's prose (graph summary + per-node purpose), a node's `when` condition in words. (D186's EDIT half stays deferred — do not build it) | ⚡ | `docs/findings/explorer.md` reaches zero |
| **B7** ⚡ | **Worker-card / session-footer wire batch** + **context-rail batch** + the remaining ledger rows (preflight/doctor popover, cross-day search corpus, command-result `conflict` arm, delegation links, member roster/conveyor, `GateDecisionWire.kind`, `OutcomeWire.text`) | ⚡ (two batched changes) | Wire ledger reaches **zero `to declare`** |
| **B8** ⛓ | **Findings sweep to zero-or-decided** + decide `span.patched` (declared vocabulary, zero production emitters — build the emitter or retire the arm by decision) | ⛓ last | `docs/findings/` is empty or every remainder carries a dated decision |

### 2.3 Track C — the connection proof (after B1–B5, before claiming "properly connected")

One end-to-end pass, using the **`custom-e2e-verify`** skill as the base methodology: drive the REAL
dashboard against a REAL composed separations **dry** run on doc 4502 — plan → start → gate parks →
approve through B1's ceremony → resume → preview terminal → archive it — then verify every surface
reads that one run correctly (queue row, run modal, timeline, receipt, activity, archive card,
explorer), **each UI assertion paired with an independent authority-database check** so the UI
cannot mark its own homework. Close with the **ONE deliberate parity re-freeze** for the whole wave
(`npm run test:parity:update`), reviewed, not repeated per-unit.

When the operator names a canary, the same pass re-runs over the real commits as A8's evidence.

---

## 3 · Questions to put to the operator BEFORE dispatching

Ask these first, in one batch, and wait. Explain each the way the planning doc does — the operator
has said plainly that unexplained shorthand (`§4f2`, D-numbers) is not actionable, so **spell out
what you are asking and what each answer causes**.

### 3.1 The canary (blocks all of Track A)

> Separations' own rule §4f2 says the proof that a write really lands is ONE real, operator-approved
> write against a real production target — *"target named by you at the time."* Three writes need
> that proof: the pending-transaction sweep, the UCPath termination filing, and the Kuali
> finalization save. The facts that constrain the choice:
> - **Doc 4524 is gone** — its Kuali action was completed 2026-08-14 and Kuali serves no form for it.
> - **Doc 4510 / EID 10001799** is legal TODAY for the *standalone* Kuali-finalization commit, but
>   the *composed* graph refuses it before the gate because that person's only employment row is
>   `Inactive` (live-proved, run `ee9824f7`). For 4510 to run composed you would have to make an
>   active terminable employment exist in UCPath — an act in UCPath, not in code.
> - **The UCPath termination commit has no candidate at all**, and the pending-sweep's committed arm
>   has no live subject (deleting `T002209631` removed the only mapped one).
> - The practice set you named — 4537, 4502, 4495 — are future-dated, so the composed graph refuses
>   them at `plan` (rule S7). They are dry-run practice, not commit targets.
>
> Options: **(a)** restore 4510's subject in UCPath → potentially all three commits in ONE composed
> run, which is exactly the §4c assertion; **(b)** name a fresh document whose subject has an active
> employment (needs a cheap read-only mapping pass first); **(c)** split — do the standalone Kuali
> commit on 4510 now and the other two later; **(d)** defer all three and let Track B proceed.
> The previous session recommended **(c) now + (a)/(b) when convenient**.

### 3.2 Scope confirmations worth getting in writing

- **B5's archive schema bump** freezes log/data/people payloads into every future archived record,
  which grows the database per archived run. Confirm that is wanted (D223 says yes; confirm the
  size implication is understood).
- **B4's bulk command strip** operates on many runs at once. Confirm the operator wants bulk
  cancel/retry/hide available, given every command is real and CAS-bound.
- **The `span.patched` decision (B8)**: build the emitter that was always intended, or retire the
  vocabulary arm? A declared event type nothing emits misleads every reader of the schema.
- **Track C's parity re-freeze** regenerates reference screenshots. Confirm the operator wants it at
  wave end (the standing convention) rather than reviewing each change's references individually.

### 3.3 A question the orchestrator should answer for itself, not ask

Do NOT ask the operator how to decompose the work, which model to use per subagent, or whether to
use worktrees. The global CLAUDE.md settles all three: parallel independent tasks get worktrees with
named branches and the orchestrator merges sequentially with `--no-ff`; sequential tasks commit
directly to master in order; trivial work goes straight to master.

---

## 4 · Dispatch mechanics

### 4.1 Sizing and model

- One unit per subagent, Opus at high effort, ~300–350k tokens. If a unit exceeds that, split it at
  a natural seam (wire schema + projector in one, UI + tests in the next) and dispatch ⛓.
- **B4 and B7 each say "ONE batched wire change"** — that is a correctness note, not a budget note.
  Splitting the batch across subagents causes repeated projector churn and repeated re-freezes.
  Split the UI consumption if you must; keep the wire change whole.

### 4.2 What every dispatch prompt must carry

1. The unit's scope, verbatim from §2, plus the exact files it may touch.
2. **The four house rules**: fail loud (no unverified silent fallbacks — see the project CLAUDE.md's
   own section, it is the founding rule); ratify in the owning doc in the same commit; run
   `build:manifest` after descriptor-closure edits; register a new guard in
   `docs/rebuild/guard-inventory.json` in the same commit as the guard file.
3. **The tree-guard instruction**: other sessions are live in this working tree; stage by explicit
   pathspec; never `git add -A`/`stash`/`clean`; a foreign dirty file is another agent's live work.
4. **The commit instruction**: commit as you go, by logical category — never one mega-commit at the
   end. Never push.
5. **The verification instruction**: the unit is not done until `typecheck && lint && test:coverage`
   is green and the subagent has pasted the counts.
6. **The decision-number instruction**: if the unit mints a decision, re-read
   `04-reconciliation.md` at HEAD first and mint in the same commit as the normative text.

### 4.3 After every subagent returns (mandatory, from the global CLAUDE.md)

```bash
git -C <worktree> log --oneline master..HEAD     # commits exist on the expected branch?
git -C <worktree> status                          # clean?
git -C <worktree> rev-parse --abbrev-ref HEAD     # the expected feature/task-N branch?
git -C <worktree> diff --stat master..HEAD        # every file inside the assigned scope?
```

Any file outside scope — and **especially any deletion** — is stop-and-investigate before merging.
Merge with `--no-ff` in dispatch order, resolve conflicts yourself (never dispatch a conflict
resolution — the subagent lacks cross-task context), then `git worktree remove` + `git branch -d`
immediately. End the batch with `git worktree list` and `git branch --list 'feature/*'` and surface
anything left behind.

### 4.4 Live work (Track A, and Track C's driving half)

Live access is **pre-authorized and always available** — never ask whether it is up, never ask to
spend the session, never ask about Duo (Duo Autopilot clears it hands-off). Use the **`playwright-cli`
skill**, headless by default; never the Chrome MCP extension. Always `close` the session and sweep
orphans (`playwright-cli list` → `close-all`). The safety boundary for a live workflow run is
`dryRun=true`; a controlled commit is the deliberate exception and needs A1's named target.

---

## 5 · Definition of done for this handoff

1. `separations.md` §6 reads **9 of 9**.
2. The wire-hookup ledger has **zero `to declare`** rows.
3. `docs/findings/` is empty or every remaining record carries a dated decision.
4. Track C's one composed run renders correctly on **every** surface, each assertion paired with an
   authority check.
5. Parity re-frozen **once**, deliberately, at wave end.
6. `ROADMAP.md` and `STORES.md` regenerated at the boundary; doc 07 §3.1's status block refreshed.
7. Separations is marked **rebuild-ready** — which, per D89/D93, still means nothing goes live until
   the single all-at-once cutover.

At that point the dashboard is complete **for every workflow that follows**, which is the operator's
own stated reason for doing separations first.

---

## 6 · Appendix — traps this session actually hit

### 6.1 The decision-number collision
Two sessions minted D222 within minutes. Renumbering cost edits across nine files plus a committed
doc. **Check HEAD immediately before minting; mint and ratify in one commit.**

### 6.2 A guard failure that looked like paperwork and was not
Importing a helper from the queue projector into the run-detail query made the ARCHIVE read path
value-reach `src/base/workflow.ts`. `archive-invariants` refused it — correctly: D179's whole claim
is that an archived run renders with its originating descriptor absent. The fix was to move the pure
helper to `src/server/dashboard/support.ts` (one implementation, two callers, no layer inversion),
**not** to widen the guard.

### 6.3 Splitting a mixed doc hunk
When `docs/rebuild/03-tracker-dashboard.md` held both sessions' additions, this worked:
`git diff <file> > p.patch`, split the patch on `@@` boundaries in Python, keep only the hunks
containing your marker, write `p.patch.mine`, `git apply --cached p.patch.mine`, then commit that
path. For an append-only file like `04-reconciliation.md`, build the staged blob as
`git show HEAD:<file>` + your block and stage it with `git hash-object -w` + `git update-index
--cacheinfo`.

### 6.4 The stale singleton
The dashboard BFF is a singleton (port pinned by `config/runtime-isolation.json`, D181's `server`
role lock admits one holder). A long-running instance serves the descriptor fingerprints it booted
with, so runs it plans are structurally unclaimable by a worker built from the current tree — every
gate green, every live run impossible. **Before blaming a live run, compare the SERVED descriptor
fingerprint against the tree's: one `GET /api/v1/explorer` answers it.** Restarting the BFF is the
whole remedy.
