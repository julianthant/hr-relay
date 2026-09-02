# Migration plan — `separations` (order 8, the Phase-3 entry)

> **STATUS (2026-09-01): BUILT; controlled completion BLOCKED because the sole canary is gone.**
> D300 replaced the three person-value canary secrets with one closed document-number reference and
> the primary-checkout admission passed. R1/u1 then ran the exact composed `dryRun=true` command from
> clean source `e635584e`; its fresh Kuali Action List search failed
> `DOCUMENT_NOT_IN_ACTION_LIST` for `finalization-canary` / doc 4537 before `plan`, S7, any gate, or
> any write (§9.33). Exact-run authority is 0 `write_intents`, 0 `write_attempts`, 0
> `durable_outbox`; the failure's write state is `not-attempted`. D284's no-substitution rule now
> keeps that sole registry row as `gone`, last observed 2026-09-01. No replacement is chosen here.
> Therefore ② UCPath filing → immediate ① UCPath pending sweep → ③ Kuali finalization remains wholly
> unconsumed, and each future write still requires its own operator ALWAYS-GATE after a newly named
> canary completes a green rehearsal. R3 obligations remain separately owned. Historical preview
> and calendar-admission proofs remain at §9.17–§9.31.
>
> *(Historical header, true 2026-08-12→08-14: the §5 questionnaire was fully answered 2026-08-12 —
> 5A/5B freshness values, §2.6/D194, §4a–§4g, the §3 build-strategy directive — flipping this doc
> from BLOCKED to READY TO BUILD, and chunk 1 started the same day.)*

**What this doc is.** The first Phase-3 migration doc, and therefore the convention every later one
follows (roadmap §Governance: migration docs are **children** of the master plan — they answer §3.4 and
record what a workflow reuses/adds; they never re-order the program). Chosen as the Phase-3 entry by
the operator on 2026-08-12 (**D193**) because a big multi-system workflow forces the store task
libraries into existence — see doc 03c §Phase summary's entry block for the reasoning.

**Sources.** Legacy is read **read-only** as a frozen reference (D93/D94). Every legacy fact below is
cited to `legacy:<path>:<line>` at commit **`1bffbd65`** (2026-08-06), and anything ported into code
later must carry that provenance in the code itself. Rebuild contracts come from the owning docs:
ref write-safety (write safety, §14 identity gate), ref workflow-model (graph/gates/delegation), ref task-contract (task contracts),
ref clock-config-secrets (freshness/instance), ref operator-trust (evidence/trust), ref data-intake-and-edit-data (intake). The scenario-by-scenario
account of what legacy actually does — **S1–S63** and the dangerous-pattern list — lives in the
sibling doc `separations-legacy-behavior.md`; this doc cites its S-numbers rather than restating it.

**How this doc is organised.**

| § | Contents |
|---|---|
| **1** | Overview — what the workflow does, the `T002173685` incident, the ALWAYS-GATE |
| **2** | Stores — what exists today, what this migration mints, and the proposed rich-extraction convention |
| **3** | Build strategy — the bottom-up "lego" decomposition and what composition can actually use |
| **4** | **Open decisions** — one entry per genuinely open item, each as options + pros/cons + a recommendation, each now carrying the operator's 2026-08-12 answer |
| **5** | The §b questionnaire (doc 03c §The §b migration questionnaire) — twelve items, each with a **verdict line**, its draft, and the recorded answer |
| **6** | Exit criteria (doc 03c §Exit criteria) |
| **7** | Open items that are NOT for this questionnaire |
| **8** | Cross-references |

**The format rule (operator directive, 2026-08-12).** Nothing in §4 is an open-ended question.
Every open item is presented as **concrete options with pros and cons, plus a recommendation**, so
the operator's work is choosing rather than composing. Where an item is genuinely pure operator
knowledge with no derivable options (what an I-9 separation *is*, whether a test instance exists),
it says so in as many words and offers the shapes the answer could take.

---

## 1. Overview

### 1.1 What this workflow does

One Kuali RRSS separation document → one terminated employee, across three systems.

| # | Step | System | What happens |
|---|---|---|---|
| 1 | Read the separation document | **Kuali Build** | Six fields off the RRSS separation form: employee name, EID, last day worked, separation date, termination type, location (`legacy:src/systems/kuali/navigate.ts:179-224`) |
| 2 | Resolve + check identity | **UCPath** | Workforce Job Summary read for the EID → department, department id, payroll title code, payroll title, and the legal name used for the identity comparison (`legacy:src/workflows/separations/workflow.ts:583-701`) |
| 3 | Check for an existing termination | **UCPath** | SS Smart HR search by EID for a `TER` row; reuse an approved one inside a 14-day window, otherwise sweep any pending termination rows for that EID (`legacy:src/workflows/separations/steps/transaction-check.ts:66-190`) |
| 4 | Write org data back to the doc | **Kuali** | Department, payroll title code, payroll title into the separation form (`legacy:src/systems/kuali/navigate.ts:402-476`) |
| 5 | Read the timecard | **New Kronos** | Employee search → timecard → date range → **last punch date, sick dates, holiday dates** (`legacy:src/systems/new-kronos/navigate.ts:852-894`) |
| 6 | Reconcile the dates | — | Last day worked = last punch (Kronos overrides Kuali); separation date = max(LDW, last sick, last holiday); **termination effective date = separation date + 1 day** (`legacy:src/workflows/separations/schema.ts:45-81`) |
| 7 | File the termination | **UCPath** | Smart HR Templates → Smart HR **Transactions**: template `UC_VOL_TERM`/`UC_INVOL_TERM`, effective date, Empl ID, reason code, comments, the **Override Last Date Worked** checkbox + Last Date Worked field, then **Save and Submit** → read back a `T…` number (`legacy:src/workflows/separations/steps/ucpath-transaction.ts:65-237`) |
| 8 | Finalize the Kuali doc | **Kuali** | Termination effective date, `Submitted Termination Template` checkbox, `Transaction Number`, the final-pay radio, audit comments, then **Save** (`legacy:src/workflows/separations/steps/kuali-finalize.ts:35-101`) |

**Two corrections to the shorthand, recorded so the questionnaire is answered against reality:**

1. **New Kronos yields DATES, not hours.** Legacy extracts `{lastPunchDate, sickDates[], holidayDates[]}`; the timecard's Amount column and any hour totals are **not read** (`legacy:src/systems/new-kronos/navigate.ts:791-798`). "Sick/holiday hours" is not a legacy capability — if the rebuild wants hours, that is new scope and item 6 must say so.
2. **The UCPath write is Smart HR Templates, not PayPath and not Job Data.** Legacy never touches the PayPath or Job Data components in this workflow; those selectors exist for other workflows only.

### 1.2 The motivating incident, and the gate that answers it

Doc 03c §Recommended migration order puts separations at order 8 because of the **wrong-person termination `T002173685`**. A
graduating student's Kuali doc carried EID `10833507` ("Hernandez, Jose Santos"); UCPath rendered the
name as "Santos Hernandez", the similarity classifier returned `different`, a name search on the
common name resolved a **career** maintenance worker (`10401814`, employed since 2016), and the
override filed a real termination against him (`legacy:src/workflows/separations/CLAUDE.md:44,204`;
scenario **S17**). A permanent-key fence would have fenced that write perfectly and filed it anyway —
the key was derived from the wrong person.

**Ref write-safety §14 ALWAYS-GATE applies to this migration in full.** Manual identity approval on **every**
separation, both separation types, **no auto-approve-on-match** (operator ratification 2026-07-24,
D77). This is a deliberate **widening** of legacy, which gates only on the `different` tier and lets
`same`/`similar` proceed silently (**S14/S15/S16/S17**). Two values are explicitly left to this
questionnaire by ref write-safety §14.7: the **approval freshness limit** (item 5, residual **5A** —
**answered 2026-08-12: kept at the drafted 4 hours, because D8/ref write-safety §14.7 make `Infinity` illegal
for identity facts — see §5 residual 5A**) and whether **I-9 separations** show a different candidate
packet than Kuali separations
(**answered 2026-08-12: separations does not involve the I-9 packet at all, so the question resolves
out of scope for this workflow** — §4f1). §4d then settles the other half in this workflow's favour:
the gate holds in **every** run mode, with no preset, prefill or resume path able to disable it. Also note doc
ref write-safety §14.6 risk #1: an always-gate's dominant failure is rubber-stamping, which is why the packet leads
with **disconfirming** evidence and why an ambiguous decision must not be dispatchable by the same
click as an unambiguous one. The behavior review's **S25/S26** show the other half of the risk —
legacy's gate is switchable off by a run mode, which is §4d.

---

## 2. Stores

### 2.1 What exists today

**`src/stores/`:** `ucpath`, `crm`, and `kuali` have real drivers, login recipes, UI registries and
tasks. `new-kronos`, `old-kronos`, `onbase`, `servicenow`, `i9`, and `sharepoint` are session
declarations with `declareDriver(…, "unwired")` and **zero** tasks. `ref stores` is the derived
catalog of that reality; §4 of it already records the two gaps this migration closes (the ucpath
write family, and the kuali separation read/finalization family).

### 2.2 `ucpath` — existing store, new write family

| Task | Effect | New / reuse | Note |
|---|---|---|---|
| `ucpath/search-person-org` | read | **reuse** | Exists (person-lookup). Candidate resolution for the gate packet may reuse it as-is |
| `ucpath/read-job-summary` | read | **new** | Workforce Job Summary: dept, dept id, payroll title code, payroll title, legal name. Must pick the effective-dated row at or before the separation date, on both tabs |
| `ucpath/find-existing-termination` | read | **new** | The ref write-safety §12 probe by name. Match on Person ID **exactly** + effective date + `/Terminat/i`; legacy deliberately removed name matching after a real duplicate-name collision |
| `ucpath/read-termination-status` | read | **new** | The approved-reuse check on SS Smart HR, with the 14-day window and "unreadable effdt ⇒ never reuse" (**S27/S28/S29**) |
| `ucpath/clear-pending-terminations` | prepare + **commit** | **new** | The date-agnostic sweep. Deletes rows, so it is a fenced mutation (item 1B / ref write-safety §13 item 5; **S30/S31**) |
| `ucpath/fill-termination` | prepare | **new** | Template → effective date → create → Empl ID → reason code → continue → comments → **Override Last Date Worked** + Last Date Worked, each positively read back (**S49**) |
| `ucpath/submit-termination` | **commit** | **new** | Save and Submit. Timeout with neither banner nor confirmation refuses to report success (**S51**) |
| `ucpath/verify-termination-receipt` | read | **new** | The keyed deep link `?Action=U&UC_TRANSACT_ID=T…`, the record-field anchors, and the **pair** `(transactionNumber, approvalStatus)` |

### 2.3 `kuali` — existing store, new read + write family

| Task | Effect | New / reuse | Note |
|---|---|---|---|
| `kuali/read-timekeeper-annotation` | read | **reuse (pattern)** | The document-identity proof (level-1 heading = document number) is the reusable half |
| `kuali/save-timekeeper-annotation` · `kuali/verify-timekeeper-annotation` | commit · read | **reuse (pattern)** | The proven `save-verify` shape every Kuali write below copies (§4e) |
| `kuali/read-separation-document` | read | **new** | The six fields off the RRSS separation form |
| `kuali/fill-separation-org-data` | prepare | **new** | Department (dropdown; code-match tier first, no-match ⇒ throw — **S55**), payroll title code, payroll title |
| `kuali/fill-timekeeper-tasks` | prepare | **new** | `Request Acknowledged - In Progress` + timekeeper name (**S42**) |
| `kuali/fill-separation-finalization` | prepare | **new** | Term-eff date, `Submitted Termination Template`, `Transaction Number`, final-pay radio (§4g), appended comments — the comment fill must read the existing value first and refuse rather than blank it (**S56**) |
| `kuali/save-separation-document` | **commit** | **new** | The navbar Save. Legacy's 3-deep `.or()` fallback chain does **not** port (D122: the anchors resolve to exactly one node each) |
| `kuali/verify-separation-document` | read | **new** | Reload read-back — Kuali's save is UI-silent, so this is mandatory (**S59**, §4e) |

### 2.4 `new-kronos` — the store built whole here

| Piece | New / reuse | Note |
|---|---|---|
| Driver + UI registry + page states | **new** | Replaces `declareDriver("new-kronos", "unwired")`. Search runs in either a `portal-frame-*` iframe or top-level — both contexts are probed |
| Login recipe + session verifier | **new** | Must prove **two** independent facts (a server-issued session artifact and the absence of every sign-in form) — a URL is never the conclusion (D120) |
| `new-kronos/search-employee` | **new** | Both-context polling; a found signal beats the no-results sentinel. A timeout is **not** a negative (**S35**, §4b) |
| `new-kronos/open-timecard` | **new** | Go To must be visible **and** enabled; failure throws (never "no punches") (**S36**) |
| `new-kronos/verify-timecard-subject` | **new** | Exact match on the employee-id element only — page-wide text is forbidden. This is the wrong-person control on the read side (**S37**) |
| `new-kronos/set-timecard-range` | **new** | Dual-mode date inputs; verify by calendar date and fail loud rather than apply a wrong window (**S40**) |
| `new-kronos/read-separation-timecard` | **new** | Last punch date, sick dates, holiday dates. Year resolved against the applied window, never against "now" (**S41**) |
| `SemanticTimecardDriver` seam | **reuse** | `src/stores/common/timecard.ts` — already ported with provenance and written for this exact milestone |

### 2.5 Pure workflow mini-store (`separations`, `sessions: []`, `effect: "read"`)

Date reconciliation (LDW / separation date / effective date `+1`), voluntary-vs-involuntary
classification, reason-code mapping (**fail loud on unmapped**, §4a), the comment builders, the
Kronos window computation, and the name-similarity classification feeding the gate packet. All pure
compute, all unit-testable with `fakeCtx`, none of it touching a browser. The shape to copy is
`workflow:person-lookup/read-active-status` (ref stores §2) — a sessionless, artifact-free,
provider-free fold over prior node outputs.

### 2.6 The rich-extraction store convention — RATIFIED as D194

> **Status: ANSWERED 2026-08-12 — Option A adopted, ratified as D194.** The normative text lives in
> **ref task-contract §2.8** (task contracts owns "how wide a read task's output is", the same way §2.7 owns
> "how much a task owes"); the derived view is ref stores §1 "How stores work"; the pointer row is
> ref decisions round 48. Ref data-intake-and-edit-data is **not** an owner — it owns intake (column mapping, roster, capture), and
> this is a task-authoring rule, so putting it there would have split one contract across two docs.
> The options below are kept as the record of what was chosen from.

**The proposal, in the operator's words.** A store task should extract *everything useful* from a
page visit, so a later workflow that wants one more field from that page never writes extraction
code again. The example given: `readCrm(dates)` today, `readCrm(eid, dates)` tomorrow — the consumer
asks, the store already has it.

**Why it is being decided now, in this doc.** Separations mints the largest block of new read tasks
in the program — the Kuali separation document, the New Kronos timecard, the UCPath Job Summary — and
every one of them is a page that later migrations will want more fields from (onboarding wants the
same Job Summary; `kronos-pay-rule` at order 6 wants the same timecard). Whatever convention is
chosen here is the one those tasks get authored under, and re-authoring a task's output schema after
runs exist is expensive: a contract's schema hash is bound into run records, checkpoints and evidence
receipts (D110/D114/D82).

**The measured evidence from this tree** (checked in code 2026-08-12, not assumed).
`crm/read-onboarding-record` and `crm/read-onboarding-dates` both call the same
`resolveExactCrmOnboardingRecord(page, input)`: the same `?q=` search, the same drill-in, the same
`/hr/ONB_ViewOnboarding` record page, the same per-record field reads
(`src/stores/crm/driver/interpreter.ts:350-377`, called at `:499` and `:529`). The dates task then
visits **one additional page** — `/hr/ONB_ShowOnboardingHistory?id=…`
(`interpreter.ts:106-109, 401-409`). So they are **not** two different pages: they share an entire
page visit and differ by one extra page. Sharper still, `openAndReadCrmRecord` already reads
`First Day of Service (Effective Date)` on that shared page (`interpreter.ts:279`) — the *record*
task holds the value and drops it from its output, and the *dates* task re-runs the whole search and
drill-in to read the very same cell again (`interpreter.ts:553-555`). That is the duplication the
proposal is about, and it is real.

#### Option A — one task per PAGE VISIT, extracting the full useful surface into one rich FIXED strict schema ★ **recommended**

A task's identity is "I visited this page and read what it has." Consumers project downstream
through field-path dependencies and pure folds, never by re-scraping. The precedent is already in
the tree: `person-lookup`'s `active-status` node is a pure fold over two prior node outputs
(`src/workflows/person-lookup/descriptor.ts:130-141`), and its `crm-dates` node projects a single
field path out of a prior output rather than re-reading it
(`requireFact(outputs.searching.selection.selected, "searching", "selection.selected").emplId`,
`descriptor.ts:142-150`). Under A, CRM would be `read-onboarding-record` (everything on the record
page, `First Day of Service` included) plus `read-onboarding-history` (the transitions), and
`invitedOn`/`startsOn`/`completedOn` would become a pure fold — one fewer full search + drill-in per
run.

- *Pros:* zero extraction code for every future consumer of that page — the field is already in the
  output, so a new workflow writes a `bind`, not a driver operation. No duplicate scraping of the
  same page (the CRM case above disappears). The output schema stays **fixed**, so schema hashes,
  provenance coverage, terminal-result derivation and evidence receipts all keep working exactly as
  built. It matches how the two shipped workflows already consume tasks.
- *Cons:* provenance is validated to cover **every** canonical output leaf on every run (the
  executor's read-completion validation), so a broken or newly-missing field can fail a workflow that
  never needed it — **unless** the schema gives that field an explicit absent arm. The mitigation is
  already a proven shape in this tree: `{state:"absent", reason}` per date in
  `ReadOnboardingDatesOutputSchema` (`interpreter.ts:474-476, 540-558`), which reports absence as
  data *after* the page state and subject are proven, and still throws on a malformed non-blank
  value. Second cost: redaction classification is per leaf and an undeclared leaf fails loud (ref operator-trust
  §D140), so a rich task owes a wider classification table up front.
- *Net:* the cons are one-time authoring obligations on the task; the pros compound across every
  later migration.

#### Option B — runtime-parameterized selection, `readCrm(fields…)` (the literal proposal)

The consumer names the fields it wants; the task reads and returns exactly those.

- *Pros:* smallest call-site surface — the consumer's intent is visible at the call, and a run only
  pays for what it asked for.
- *Cons:* the output **shape becomes a function of a runtime argument**, and that is what the
  rebuild's identity machinery binds to. A contract has one output schema and one schema hash; runs,
  checkpoints, terminal results and evidence receipts all bind that hash and the produced value's
  digest (D110/D114/D82). Satisfying a variable field set means either one wide all-optional record
  (which no longer proves what was actually read, and would not survive
  `strict-boundary-schemas`) or a separate contract per field set (which is Option A with extra
  steps). It also conflates two different decisions — *which page do I visit* and *which fields do I
  want* — in one parameter, so a caller can accidentally change navigation by editing a field list.
- *Net:* reject as stated. The operator's underlying goal ("consumers never write extraction code")
  is fully delivered by A; only the parameterization is the problem.

#### Option C — status quo: a narrow task per need

- *Pros:* smallest per-run blast radius — a task reads three fields, so three fields is all that can
  break, and provenance/redaction obligations stay tiny.
- *Cons:* near-duplicate tasks re-scrape the same page. **Checked, and honest:**
  `crm/read-onboarding-record` and `crm/read-onboarding-dates` **do visit the same page** — the
  identical search + drill-in + record page — and the dates task additionally visits one more
  (`/hr/ONB_ShowOnboardingHistory`). So this is not a case of two tasks legitimately grouped by two
  different page visits; it is one shared visit duplicated, plus one extra page. (Where two tasks
  genuinely *do* visit different pages, the convention groups by page visit and they stay separate —
  the history page would remain its own task under Option A too.) The other cost is that extraction
  gets re-written per workflow: separations' Job Summary read and onboarding's Job Summary read would
  be two tasks over one page.
- *Net:* keep only if the operator judges the wider provenance/redaction surface unacceptable.

#### What adopting A means concretely

- Separations' new read tasks are authored **rich from day one**: `kuali/read-separation-document`
  returns the whole useful separation-form surface (not only the six fields step 1 needs),
  `ucpath/read-job-summary` returns the whole effective-dated row surface, and
  `new-kronos/read-separation-timecard` returns the whole parsed timecard surface it can prove.
- Each such schema declares an explicit absent arm for any field that can legitimately be blank, so a
  broken field is `absent` **with a reason** rather than a hard failure of an unrelated workflow —
  and never a silent blank.
- Each such task declares its per-leaf redaction classification at authoring time (ref operator-trust §D140).
- The convention is then ratified as **D194** in ref task-contract §2.8 + ref stores §1, and later migrations
  inherit it.

**Recommendation: Option A.** It delivers the operator's stated goal exactly (consumers never write
extraction code), it is the only option that keeps the fixed-schema identity the write-safety and
evidence machinery depends on, and it has a working precedent in this tree for both halves — the
rich read with per-field absent arms, and the pure downstream fold.

`ANSWER (operator), 2026-08-12` — **Option A. Adopted and ratified as D194.**

One task per page visit, extracting the full useful surface into one **fixed strict** schema;
consumers project downstream and never re-scrape. The literal `read(fields…)` parameterization
(Option B) is rejected for the reason B's own analysis gives — an output shape that is a function of
a runtime argument cannot carry the fixed schema hash that runs, checkpoints, terminal results and
receipts bind. Both authoring costs are accepted: an explicit `{state:"absent", reason}` arm on every
field that can legitimately be blank, and a declared redaction classification per leaf.

**Scope, stated so it is not over-read: existing tasks are NOT rewritten now.** The convention binds
every **new** task from today and every task this migration authors; a store merges its duplicate
extractions when it is next touched for other reasons, because re-authoring a shipped output schema
moves a hash existing run records already bind. The `crm` record/dates pair is the first known merge
target — one shared page visit, one duplicated `First Day of Service` read — and the CRM **history**
page stays its own task either way, because it is a genuinely second visit.

Where it landed: **ref task-contract §2.8** (normative), ref stores §1 (derived), ref decisions round 48 (pointer).

---

## 3. Build strategy — bottom-up chunks, composed like lego (operator directive, 2026-08-12)

Separations is the biggest workflow in the program. The operator's directive is that it is **not**
built as one slice: it is **decomposed bottom-up** into chunks that each stand alone and each get
proved before anything is composed.

**The order is store tasks → per-system sub-workflows → composition.**

1. **Store tasks first.** Every task in §2's inventory is authored against its strict contract with
   its scenarios and pure-logic unit tests, in the store that owns it (ref task-contract). A task is finished
   when its contract parses, its guards are green, and its driver operations resolve against the
   **live** system (selector re-verification is mandatory at migration — D150 replaced legacy change
   accounting with exactly this).
2. **Then one small sub-workflow per system interaction**, each provable **alone**, each its own
   commit-sized slice:
   - **`separations-kuali-read`** — open the doc, prove the document identity, read the six fields.
     Read-only; its proof is a live dry-run.
   - **`separations-kronos-timecard`** — search, open the timecard, **prove the subject** off
     `.emp-nav-id` before reading anything, set the range, read the punch/sick/holiday dates.
     Read-only; brings the whole `new-kronos` store into existence (driver + login recipe + UI
     registry). Its proof is a live read against a real timecard.
   - **`separations-ucpath-termination`** — the termination write, built as a **single-transaction-node
     workflow following the `kuali-timekeeper-annotation` pattern**: one `.transaction()` node with a
     `prepare` arm, a `commit` arm, `dryRun: "stop-after-prepare"`, a declared `probePolicy` and
     `probeToFenceMaxMs`, and a terminal result derived from the node
     (`src/workflows/kuali-timekeeper-annotation/descriptor.ts`). A graph with a single node is the
     smallest thing that can carry a real fence, which is exactly why that shape was built.
   - **`separations-kuali-finalization`** — the finalization write, same single-transaction-node
     shape, its own permanent key and its own read-back proof.
   Each write sub-workflow owes its own **controlled-commit proof on an operator-approved target**
   (doc 03c §Phase summary step 5) — and that is a real gate, not a formality: it is what lets the composed
   workflow inherit two proven writes instead of proving both at once, at the end, on the largest
   graph in the program.
   > 2026-08-21 — D265: the five sub-workflow IDS above are unchanged, but their HOME moves — each
   > harness lives inside the step folder it proves under `src/workflows/separations/<step>/`
   > (`kuali-extraction` · `identity-check` · `job-summary` · `kronos-timecard` · `ucpath-transaction`
   > · `kuali-finalization`), and `kuali-timekeeper-annotation` moves under `src/workflows/proving/`.
   > `ref workflow-model` §1.2.2 owns the rule; doc 03b §The workflow tree is the code unit.
   > 2026-08-21 — D266: `kuali-timekeeper-annotation` (the "pattern" the two write sub-workflows above
   > followed) is DISMANTLED; its real-sequencer harness seeds the first T1 pair, for
   > `separations-kuali-finalization` (`tests/scenario/workflows/separations-kuali-finalization/`).
3. **Then compose.** The full `separations` descriptor is assembled from the proven pieces with the
   ALWAYS-GATE identity node sitting **before** the transaction nodes (ref write-safety §14.3 — a gate is a long
   wait and D26 forbids any park between `prepare` and `commit`).

**What composition can actually use today — the honest note.** Two mechanisms exist and they are not
equivalent:

| Mechanism | Status in this tree | What it costs at composition |
|---|---|---|
| **One descriptor, many nodes** (reads → gate → transaction → transaction) | **Built and proven.** Both shipped workflows use it; ref write-safety §12's worked example is literally two transaction nodes in one separations graph | Nothing. The sub-workflows' *tasks* compose directly; the sub-workflow descriptors stay as proving harnesses |
| **Real child runs** (`child-run` node / delegation, ref workflow-model §3.2) | **A typed seam that is NOT wired.** `ChildRunExecutor` is an optional dependency of the run executor, `composeWorkerRuntime` never supplies it, and a `child-run` node therefore fails loud with `capability-unavailable` — "refusing to skip a delegation" (`src/core/run-executor.ts:1350-1356`, `src/server/worker/compose.ts:502-537`) | Wiring the executor seam **plus** the enqueue/join transaction, the fan-out manifest, and a worker able to claim the child workflow — a slice of its own, not a step of this one |

So the default composition is **one descriptor over reused tasks**, and the sub-workflow descriptors
are the scaffolding that made each piece provable. Choosing real child runs instead is a **decision,
not a detail** — it is questionnaire item 10, and answering it "delegate" means this migration also
owns wiring the delegation seam. Note legacy already delegates once, conditionally, to
person-lookup (`legacy:src/workflows/separations/workflow.ts:235`), so the answer to item 10 is not
automatically "no delegation".

**The rule that keeps this honest:** every chunk is its own commit, its own guards, and its own
proof. A chunk that cannot be proved alone is a sign the decomposition is wrong, not a reason to
compose early.

**NO FRONTEND WORK IN ANY CHUNK — BUT EXPOSE EVERYTHING THE FRONTEND WILL NEED (operator directive,
2026-08-12).** No chunk of this migration builds UI: no components, no surfaces, no dashboard `.tsx`.
Every chunk instead makes its workflow fully operable through the machinery that already exists —
the start-plan and command endpoints, and the queue/run-detail wires, which render a registered
workflow off the registry automatically (**verify that; do not build it**). What a chunk DOES owe is
the server side of everything a frontend will later need: wire schemas, BFF endpoints, command arms
and projection state. **If a fact the frontend will need is not yet served, serve it on the wire
behind a strict schema — and stop there.**

Concretely, for the chunks where this is easiest to get wrong:

- **Chunk 3 (the UCPath termination write)** — ref write-safety §14's ALWAYS-GATE identity approval becomes a
  **command arm plus wire state ONLY**. The approval UI comes later; the gate's packet, its
  freshness bound and its resolution command are all server-side facts served on the wire.
- **Chunk 6 (composition)** — exposes start / approve / resume endpoints. No surfaces.
- **Parity** — a chunk may re-freeze references only for a MECHANICAL delta (a registry stamp, a
  toolbar entry, a catalog count) that the corpus genuinely demands, and must verify the diff is
  exactly that delta before accepting it. A mechanical refreeze is not frontend work; authoring a
  reference for a new surface would be.

### 3.1 Scenario variability is handled by LEGO RECOMPOSITION, never by branches (operator directive, 2026-08-12)

**The directive, plainly.** Different real-world situations are served by **moving and swapping
sub-workflow chunks and customizing store items** — not by growing conditional branches inside one
monolithic workflow. When a case needs a different shape (a separation whose dates come from
somewhere other than a Kronos timecard, a type that files under a different template, a variant that
skips a system entirely), the answer is a **different composition over the same proven chunks**, not
an `if` inside `separations`.

**Why this is a design rule and not a preference.** A branch inside a live write workflow multiplies
what every guard, scenario and controlled-commit proof has to cover, and ref workflow-model §5.5's freshness walk
must conservatively union **every reachable branch** until its discriminator is a validated value —
so each added branch widens the safety envelope of runs that never take it. Recomposition keeps each
composition's graph small enough to prove, and keeps the chunks themselves single-purpose.

**What it binds concretely.**

- The §3 chunks are the lego bricks: they are authored to be recomposable, not to be one workflow's
  private steps. A chunk's contract is the store task family it uses, not the descriptor that first
  consumed it.
- Two answers below are expressed through this rule rather than through a branch: §4b's
  "special cases where the Kuali-carried date alone would suffice" (those fail today; when one
  surfaces, it becomes a **composition** without the timecard chunk, designed then), and §4f4's
  not-in-legacy types (a type needing a different template or effective-date rule becomes its own
  composition, not a branch inside this one).
- It does **not** mean real child runs. Delegation is item 10 and stays unwired (§3's table);
  recomposition here means assembling a **descriptor** from proven tasks, which is the mechanism this
  tree already has.

### 3.2 MAP EVERYTHING as you build (operator directive, 2026-08-12)

**The directive.** The operator cannot enumerate every real-world scenario up front (§4f4), so the
scenario inventory stays deliberately open — and the substitute is that **every build chunk maps
exhaustively everything it touches**, whether or not this migration needs it:

- **Every dropdown's complete option list** — not only the options the current mapping uses. §4a's
  Kuali *Type of Termination* capture is the first instance and the reason the map can be made
  exhaustive at all; the department dropdown (**S55**) and the reason-code list get the same
  treatment.
- **Every status, type, state and branch the chunk encounters** on the pages it visits — recorded
  with its live-observation date, the same way a selector is.
- **Every field the page carries**, which is exactly what **§2.6/D194** already requires of the read
  tasks: one task per page visit returning the full useful surface. The mapping directive and the
  extraction convention are the same instinct at two altitudes — capture the whole surface once,
  while you are standing on the page.

**What it buys.** Later scenario work (and later migrations against the same pages) finds its raw
material already captured, so nothing is re-mapped and no scenario is invented from memory. Captures
are **read-only** page observations, standing pre-authorized by the charter's live-verification
clause, and they cost one page visit each inside work the chunk is already doing.

---

## 4. Open decisions

Each entry: **context** (with S-numbers and legacy citations) → **options with pros and cons** →
**recommendation** → the operator's answer slot. These are the items where the draft in §5 is either
a refusal, a blank, or a widening of legacy that the operator has to ratify. The questionnaire items
in §5 point here rather than repeating the options.

### 4a. Unmapped termination type → template and reason code

*Behavior review: dangerous pattern **D1**; scenarios **S9 / S10 / S11**. Questionnaire item 6.*

**Context.** Two independent decisions, both defaulting today.

- **Vol/Invol** is a three-string deny-list — `INVOLUNTARY_TYPES = ["Never Started Employment",
  "Graduated/No longer a Student", "Appointment Expired"]`, and
  `isVoluntaryTermination = !INVOLUNTARY_TYPES.includes(type)`
  (`legacy:src/systems/kuali/navigate.ts:230-241`). Any dropdown option the code has never seen — new,
  renamed, or simply unknown — is **voluntary** and picks `UC_VOL_TERM`
  (`legacy:src/workflows/separations/workflow.ts:497-504`).
- **The reason code** falls through three tiers: exact map hit → **bidirectional** substring fuzzy
  match → the constant `"Resign - No Reason Given"`
  (`legacy:src/workflows/separations/schema.ts:200-223`). The fuzzy tier matches either direction, so
  a Kuali type of `"Other"` matches `"Accepted Another Job"` (because "accepted an**other** job"
  contains "other") and files a resignation-for-another-job reason. A documented type like `"Death"`
  matches nothing, is not in the involuntary list, and is filed as a **voluntary**
  `Resign - No Reason Given`. Neither path logs a warning.
- **S11**: a second, divergent `INVOLUNTARY_TYPES` with only two entries exists and is barrel-exported
  (`legacy:src/workflows/separations/config.ts:25-28`, `index.ts:21`) — unused for decisions today,
  but a stale duplicate waiting to be picked up.
- **The blocker:** the complete Kuali *Type of Termination* option list is recorded **nowhere** in the
  legacy repo (behavior review §5 item 1, `unknown — needs live observation`).

**Options.**

**Option A — fail loud on any unmapped type, and live-capture the full Kuali dropdown so the map is exhaustive. ★ recommended**
- *Pros:* no plausible-but-wrong reason code can reach a live termination — the exact pattern this
  tree bans. The capture turns "unmapped" from a routine event into a rare one, so failing loud is
  cheap in practice. Modeling the type as one closed enum with one `{template, reasonCode}` mapping
  kills S11's divergent-constant class structurally, not by discipline. The capture itself is a
  **read-only** Kuali snapshot, standing pre-authorized by the charter, and costs one page visit.
- *Cons:* the map must be captured before the first run authoring completes. If Kuali later adds a
  dropdown option, runs on that option fail until the map is extended — which is the intended cost,
  but it is a real operational cost the operator should accept explicitly.

**Option B — keep a default arm (legacy behavior).**
- *Pros:* a run never blocks on an unknown type.
- *Cons:* this is dangerous pattern D1 verbatim. A wrong reason code on a filed HR termination is
  invisible to everyone downstream, and `Death → voluntary resignation, no reason given` is the
  worked example the source already contains. **Reject.**

**Option C — map-then-flag: apply a best-guess reason code, mark the run for review.**
- *Pros:* the run completes and the operator gets a signal; useful if wrong reason codes are trivially
  correctable in UCPath after the fact.
- *Cons:* the flag arrives **after** the irreversible write. A notification is not a control. Legacy
  source states nothing about post-hoc correctability, so this option depends entirely on an operator
  fact nobody in this repo has.

**Recommendation: A.** Refuse the unmapped type by name, and settle it with one read-only live capture
of the dropdown that produces the exhaustive `terminationType → {template, reasonCode}` table. That
capture is also the prerequisite for §4f4 (rehire/deceased/retiree/LOA) — none of those can be scoped
without the option list.

`ANSWER (operator), 2026-08-12` — **Option A. Fail loud on ANY unmapped termination type, and
live-capture the complete Kuali dropdown option list so the map is exhaustive.**

- **The refusal.** An unmapped or blank *Type of Termination* refuses **by name**, before any staging.
  Legacy's three-tier fall-through — exact hit → bidirectional substring fuzzy → the constant
  `"Resign - No Reason Given"` — does **not** port at any tier; the fuzzy tier is deleted outright
  (it is what makes `"Other"` file as *Accepted Another Job*). The type is modeled as ONE closed enum
  with ONE `{template, reasonCode}` mapping, which kills **S11**'s divergent-constant class
  structurally rather than by discipline.
- **The capture.** The complete option list is captured live, read-only, **during chunk work** — it
  belongs to the `separations-kuali-read` chunk, not to answering this questionnaire. It is
  pre-authorized by the charter's live-verification clause and costs one page visit. Its output is
  the exhaustive `terminationType → {template, reasonCode}` table, recorded with its observation date
  like any other live fact.
- **The operational cost is accepted explicitly.** If Kuali later adds or renames a dropdown option,
  runs on that option **fail** until the map is extended. That is the intended cost of A, and it is
  the whole point: a wrong reason code on a filed HR termination is invisible to everyone downstream.
- **This is the first instance of §3.2's MAP-EVERYTHING directive**, not a one-off: the same chunk
  captures the department dropdown (**S55**) and every other option list it stands in front of.

`ANSWER (operator), 2026-08-13 — the one open item this answer left, item (a): APPROVED.`
**`Never Started Employment` → `{template: UC_INVOL_TERM, reasonCode: NSE}`.**

Chunk 2's capture (§9.3) closed §4a with data except for one option: `Never Started Employment` had no
reason code, because legacy classifies it involuntary, carries no map entry for it, and files the
**voluntary** default under an involuntary template — and §4a forbids inventing the pairing legacy's
own comment block claims. **Chunk 4's live UCPath capture supplied it** (§9.7): the real
`UC_INVOL_TERM` reason list served by production on 2026-08-13 contains **`NSE` = "Never Started
Employment"**, verbatim. So the pairing is now a **live-verified observation on the target control**,
which is exactly the bar §4a set, and the operator approved it on that basis.

- The map gains ONE line; nothing else about §4a moves. Exact-match only, no fuzzy tier, no default
  arm, and the refusal vocabulary is unchanged.
- §9.3's capture table row 7 changes from **REFUSES** to the mapped pair, and
  `auditTerminationTypeMapCoverage` stays bidirectionally consistent — the entry moves from an
  explicitly reasoned `unmapped` to a `mapped` one, so coverage neither gains nor loses a key.
- **What this does NOT do:** it does not restore legacy's behavior. Legacy files `UC_INVOL_TERM` with
  `Resign - No Reason Given`; the map files `UC_INVOL_TERM` with `NSE`. Legacy is wrong here and stays
  wrong; this is the correction the capture made possible.

---

### 4b. Kronos unreachable, or the timecard read fails

*Behavior review: dangerous patterns **D2** and **D5**; scenarios **S34–S37**, **S43**, with **S32/S33** as the contrast. Questionnaire items 6 and 9.*

**Context.** Legacy collapses "no card", "empty card" and "unreadable card" into outcomes that all
produce a `Done` run.

- **S35:** a 15-second search with no signal is logged as a warning and returned as **NOT FOUND**
  (`legacy:src/systems/new-kronos/navigate.ts:174-178`, duplicated at `:195-200`). Downstream,
  `found:false` is indistinguishable from "this person is genuinely not timekept here", and
  `timecardRead` is set **true**, so the separation date is *derived* as if a card had been read.
- **S36/S37:** the Go-To failure and the wrong-employee timecard both now **throw** — but inside a
  settled `ctx.parallel` block, so the handler only logs
  (`legacy:src/workflows/separations/workflow.ts:870-880`), and `logSettledRejection` returns a boolean
  the New Kronos branch **does not check** (`legacy:src/workflows/separations/settled.ts:4-13`). The
  run files a real termination on the Kuali LDW and terminates **`Done`**; the operator's only signal
  is a red log line.
- **The measured cost.** On 2026-07-31 a daemon page-state leak (**S43**) made **20 of 21** found
  employees hit the Go-To failure, and every one of those runs completed
  (`legacy:src/workflows/separations/CLAUDE.md:199`). Before the `timecardRead` gate existed, three
  real Kuali docs — **4445, 4461, 4471** — had a changed Separation Date written back with the audit
  comment *"Updated Separation Date from … per Kronos timesheet"*, citing a timesheet that was never
  opened (`CLAUDE.md:200`).
- **The contrast that matters.** **S32:** for a positively-determined non-HDH department, legacy skips
  Kronos entirely, keeps the Kuali dates **verbatim**, derives nothing and writes no "per Kronos"
  comment — and that asymmetry was itself a defect fix. **S33:** an unknown or empty department still
  **runs** Kronos (fail-safe). So legacy already distinguishes "not applicable" from "failed", in one
  direction only.

**Options.**

**Option A — park for the operator on any unreachable, failed, or unverifiable Kronos read. ★ recommended**
- *Pros:* the timecard is the write's *payload* — the last punch becomes the LDW and the derived
  separation date becomes the termination effective date — so an unread card means the run cannot
  compute the value it is about to file. Parking converts all three `Done`-on-a-lie rows into one
  named waiting state the operator can act on, and preserves the run's place and its prior work
  (unlike a hard fail). It also forces the data model to keep "no card" / "card empty" / "card
  unreadable" distinct, which is **S34/S38**'s open defect.
- *Cons:* a Kronos outage stalls the queue rather than draining it. The resume path must accept an
  operator-supplied LDW, and that supplied value is an override that has to be recorded in authority
  as such — and the identity gate stays mandatory on the resume path regardless (§4d).

**Option B — proceed without a timecard ONLY for the closed set where Kronos is structurally not applicable, and say so on the run.**
- *Pros:* keeps the one genuinely valid absence flowing. That closed set today has exactly **one**
  member: a **positively-determined non-HDH department** (**S32**) — legacy already skips Kronos
  there, keeps the Kuali dates verbatim, and writes no "per Kronos" comment; an unknown or empty
  department still runs Kronos (**S33**). The "Kronos not read" fact is carried on the run, on the
  queue row, and — by omission of the clause — in the UCPath comment.
- *Cons:* the boundary must be a **positive determination**, never a failed read. Inverting that
  direction is precisely what produced the three wrongly-modified Kuali docs. Adopt B as the *closed
  exception inside* A, not as an alternative to it.

**Option C — hard-fail (terminalize `failed`) on any Kronos problem.**
- *Pros:* simplest possible rule; nothing proceeds on unknown data.
- *Cons:* a transient outage discards the run's completed work (Kuali read, identity gate approval,
  existing-termination probe) and the operator restarts from zero — including re-approving the gate. A
  park keeps all of it. **Reject in favour of A + B.**

**Recommendation: A, with B's single non-HDH case as the only proceed-without-timecard arm**, marked
on the run and excluded from the "per Kronos" comment. Independent of which option is chosen, one fix
is not optional: a search **timeout must never be reported as `found:false`** (S35 / pattern D5). "The
check could not run" and "the check found nothing" are different values, and the tree already
forbids conflating them.

`ANSWER (operator), 2026-08-12` — **Option C. HARD-FAIL, always. The operator's words: "if kronos is
not available, the entire thing fails."**

Any unreachable Kronos, any failed search, any timecard that will not open, any wrong-subject
timecard, any unreadable card — the run **terminalizes `failed`**. It does not park (A is not
adopted), and it does not proceed on the Kuali dates (B is not adopted).

- **The recorded nuance.** Special cases may exist where the **Kuali-carried date alone would
  suffice**. Those **also fail for now.** The operator will flag a real case when one surfaces, and
  the arm gets **designed then** — as a **§3.1 recomposition** (a composition without the timecard
  chunk), never as a conditional branch bolted into this workflow.
- **What this retires from the draft:** §4b Option B's "closed non-HDH exception" is **not** adopted,
  so legacy's **S32** department gate does **not** port as a proceed-without-timecard arm. There is
  today **no** path through this workflow that files a termination without a read timecard. Item 6's
  department-gate bullet and item 9's non-HDH/unknown-department scenarios are corrected to match, and
  §4d's parenthetical ("a preset may skip Kronos") is void — **no run mode changes the graph at all.**
- **The cost is accepted, and it is Option C's own con:** a transient Kronos outage discards the run's
  completed work — the Kuali read, the existing-termination probe, and the identity-gate approval —
  and the operator restarts from zero, re-approving the gate. That is the price of never filing a
  termination on a date nobody read.
- **Why hard-fail here but PARK in §4c**, and the rule behind both: this failure is **pre-write** —
  nothing external has been filed, so failing costs only work. §4c's failure is **post-write** — a
  real termination exists, so failing would abandon a half-finished external state and parking is the
  only honest outcome. Fail before the fence, park after it.
- **Non-negotiable regardless of option, and it stands:** a search **timeout is never `found:false`**
  (**S35** / pattern D5). "The check could not run" is its own value and terminalizes `failed` with
  that reason; it is never collapsed into "this person is not timekept here". Same for **S34/S38** —
  "no card", "card empty" and "card unreadable" stay three distinct values in the data model even
  though all three currently fail, because the day the operator flags a real special case, those are
  the values the new composition will be selected on.

---

### 4c. Partial completion — UCPath submitted, Kuali finalization fails

*Behavior review: scenarios **S57** and **S60**. Questionnaire items 2 and 11.*

**Context.** The termination is filed for real, then finalization throws (department option mismatch
**S55**, unreadable existing comments **S56**, or a save failure), and the run lands `failed`.

- What the operator **has**: the transaction number is on the row. `ctx.updateData({transactionNumber})`
  is called inline at both UCPath success points precisely so a later finalization failure cannot drop
  it (`legacy:src/workflows/separations/steps/ucpath-transaction.ts:101,189`; rationale
  `legacy:src/workflows/separations/CLAUDE.md:221`). Recovery is edit-and-resume with
  `transactionNumber` prefilled, which skips `identity-check`, `transaction-check` **and**
  `ucpath-transaction`, re-running only the Kuali finalization
  (`legacy:src/workflows/separations/workflow.ts:1127-1136`).
- What the operator does **not** have: any named state saying "UCPath done, Kuali not." The row says
  `failed` with an error string; the distinction lives in the operator's head.
- The adjacent case, **S57**: when the transaction number is empty at finalization, legacy
  deliberately fills everything *except* the number and saves the document "blank for manual entry"
  (`legacy:src/workflows/separations/steps/kuali-finalize.ts:54-57`), then fails the run.

**Options.**

**Option A — a parked run, resumable by the operator, with the transaction number carried durable. ★ recommended**
- *Pros:* names the state instead of leaving it in the operator's head. The termination is real, so the
  run is `partial` (item 11's draft already says so), parked at the finalization transaction with the
  receipt pair `(transactionNumber, approvalStatus)` on the run record as durable authority rather
  than a remembered fact. Resume re-enters only the Kuali finalization transaction node, under its own
  permanent key — and resume **cannot** re-file the termination, because the UCPath node's permanent
  key already fenced and settled (ref write-safety's same-key mutex refuses a second fence).
- *Cons:* the resume path must **not** inherit legacy's skip-everything semantics. **S26/D7** is the
  proof of why: a prefilled field silently disabling the identity gate is exactly how the wrong-person
  control gets switched off. A resume must re-prove the document identity and keep the gate (§4d).

**Option B — bounded auto-retry of the finalization before parking.**
- *Pros:* the transient causes (a dropped Kuali session, a slow save) close with no operator time, and
  retrying the *same* operation is explicitly not a fallback under this tree's rules.
- *Cons:* it does not cover the causes legacy actually hit — a department option that matches nothing
  (S55) and unreadable prior comments (S56) both re-refuse identically on retry — and it must still
  park after the bound. So it is an optimization **inside** A, never a substitute for it.

**Option C — treat it as done-with-warning.**
- *Pros:* the queue drains; the external HR record is, after all, correct.
- *Cons:* **reject.** The Kuali document is the local record of a real termination; a `done` run whose
  document was never finalized is the same class as **S59** (unverified save reported as success) and
  **S36** (unread timecard reported as success) — the two failures this whole migration exists to end.
  Item 11's draft already declares this outcome `partial`, not `done`.

**Recommendation: A, with B allowed strictly as an inner same-operation retry.** Settle **S57** in the
same answer: with the receipt pair required *before* finalization (item 2's draft), "save the Kuali
form blank for manual entry" cannot arise — the finalization transaction is never entered without a
receipt, so legacy's deliberate half-finished document goes away. Confirm that is wanted.

`ANSWER (operator), 2026-08-12` — **Option A. A PARKED run, resumable by the operator, with the
transaction number carried DURABLY.**

- **Parked, not failed.** The termination is real and irreversible, so the run parks at the Kuali
  finalization transaction instead of terminalizing. (Contrast §4b: that failure is pre-write, this
  one is post-write — fail before the fence, park after it.)
- **The transaction number is durable authority, not a remembered fact.** The receipt **pair**
  `(transactionNumber, approvalStatus)` is on the run record before finalization is ever entered, so
  the operator does not reconstruct it from a log line or their memory.
- **Resume re-enters only the Kuali finalization node**, under its own permanent key. Resume
  **cannot** re-file the termination: the UCPath node's permanent key already fenced and settled, and
  ref write-safety's same-key mutex refuses a second fence.
- **Resume does NOT inherit legacy's skip-everything semantics.** It re-proves the document identity
  and it keeps the identity gate (**§4d**) — a prefilled field silently disabling the wrong-person
  control is **S26/D7** verbatim and does not port.
- **On Option B:** not part of the answer. A bounded retry of the *same* operation inside the
  finalization node stays a permitted implementation detail (retrying the same operation is
  explicitly not a fallback under this tree's rules), and it never substitutes for the park — it
  covers a dropped session, not **S55**'s unmatched department option or **S56**'s unreadable
  comments, which re-refuse identically.
- **S57 is settled structurally, not by preference.** With the receipt pair required *before*
  finalization (item 2), the finalization transaction is never entered without a number, so legacy's
  deliberate "save the Kuali form blank for manual entry" half-finished document cannot arise. It is
  not a rejected option; it is an unreachable state.

---

### 4d. The identity gate under run modes and resumes

*Behavior review: dangerous pattern **D7**; scenarios **S25** and **S26**. Questionnaire items 5, 6 and 10.*

**Context.** Legacy's wrong-person control is switchable off by a *date*-related convenience.

```ts
// legacy:src/workflows/separations/workflow.ts:556-557, 578
const presetSkippedKronos   = ctx.shouldSkipStep("kronos-search");
const kronosSkippedByInput  = lastDayWorkedPrefilled || presetSkippedKronos;
const identitySkipped       = txnNumberPrefilled || kronosSkippedByInput;
```

Choosing the "Transactions only" preset, or prefilling `lastDayWorked` on an edit-and-resume, means
**no Job Summary fetch at all** — no name comparison, no `identity-check`, no department gate — and a
real termination is then filed against whatever EID the Kuali form carried
(`legacy:src/workflows/separations/workflow.ts:583, 605-611`). Legacy's justification is that the
operator "asserted the data" (`:543-551`), but the operator asserted the **dates**, not the
**identity** — and the identity gate is the control that exists because of `T002173685`.
**S25** is the same hole from the other side: an operator-approved EID from the review forces the
chosen EID and skips the gate entirely, with no re-verification binding the approval to the evidence
it was granted on.

**Options.**

**Option A — ALWAYS-GATE in every mode; no preset, prefill, or resume path can disable it. ★ recommended (and this is what ref write-safety §14 / D77 already ratified)**
- *Pros:* it is the ratified contract, not a new position. It deletes pattern D7 structurally rather
  than by discipline: the guard `identity-gate-before-separation-commit` (ref write-safety §14.6 guard #2,
  already in §6's exit criteria) proves every commit is graph-reachable only through the gate node, so
  a future edit cannot reintroduce the skip. It also makes **S25** well-formed, because the approval
  binds to an evidence digest and is re-checked on resume — item 5's draft: an identical digest inside
  the freshness limit proceeds, a changed candidate re-opens the gate regardless.
- *Cons:* every "transactions only"-style run pays one Job Summary read and one operator decision.
  That is the price the `T002173685` incident already paid for once.

**Option B — the gate is skippable with a per-run explicit operator override recorded in authority.**
- *Pros:* a genuinely repetitive resume (§4c's finalization-only path) would not re-ask.
- *Cons:* an override that exists gets used routinely, and ref write-safety §14.6 risk #1 is rubber-stamping — a
  one-click "skip the gate" is the most rubber-stampable control that could be built. The honest
  version of what B wants is not a skip but "the same gate, pre-filled with the prior approval's
  digest, proceeding when the digest is unchanged and inside the freshness limit" — which is exactly
  what A already provides. B therefore collapses into A.

**Option C — legacy behavior: derive the skip from a date-related prefill.**
- *Pros:* none that survive the incident.
- *Cons:* **reject.** It is pattern D7 verbatim, and the derivation chain means a *data* convenience
  disables an *identity* control — the operator would not even see that they had turned it off.

**Recommendation: A.** The one place a run mode may legitimately change the graph is the **timecard
read** (a preset may skip Kronos, per §4b's closed non-HDH case) — never the identity node. That is
also the behavior review's own recommendation at S26.

`ANSWER (operator), 2026-08-12` — **Option A. ALWAYS-GATE in EVERY run mode. No preset, no prefill,
no resume path, and no run mode of any kind can disable identity approval.**

- Every separation, both separation types, every mode, every resume: manual identity approval, no
  auto-approve-on-match. This ratifies ref write-safety §14 / D77 for this migration with no exception carved
  anywhere.
- Legacy's derivation chain — `txnNumberPrefilled || lastDayWorkedPrefilled || presetSkippedKronos`
  ⇒ no Job Summary, no name comparison, no gate — does **not** port in any form. Pattern **D7** dies
  structurally: the guard `identity-gate-before-separation-commit` (§6) proves every commit is
  graph-reachable **only** through the gate node, so a later edit cannot reintroduce the skip.
- **S25** becomes well-formed: an approval binds to an evidence digest and is re-checked on resume —
  an identical digest inside the freshness limit proceeds; a changed candidate re-opens the gate
  regardless. (The freshness limit itself is item 5's residual **5A**.)
- **Amended by §4b's answer:** the recommendation's one carve-out above — "a preset may skip
  Kronos" — is **void**. With the timecard read hard-failing rather than skipping, **no run mode
  changes the graph at all** in this workflow. A future "Kuali dates only" case is a §3.1
  **recomposition**, which is a different descriptor with its own gate node, not a mode that edits
  this one.

---

### 4e. The Kuali save read-back — confirm-only

*Behavior review: dangerous pattern **D3**; scenario **S59**. Questionnaire item 2.*

**Context.** This one is largely settled and is here for confirmation, not composition. Legacy's
`clickSave` is a click, a **swallowed** `networkidle` wait, a fixed 2-second sleep, and an
unconditional success log, with **zero** read-back
(`legacy:src/systems/kuali/navigate.ts:634-651`) — so even a hung save prints "Kuali form saved". The
one partial mitigation is `verifyTxnNumberFilled`, which re-reads the transaction number **before**
the click and refuses to save with a blank one (`:602-624`) — a pre-save check, not a post-save proof
— and the `kuali-finalization-saved` screenshot is deliberately taken *before* the click because a
successful save navigates away (`legacy:src/workflows/separations/steps/kuali-finalize.ts:86-97`).
The rebuild has already proved the hazard on this exact system: **D128** — HTTP `200`, a rendered
`Form saved`, and nothing persisted. The answer already exists as built, controlled-commit-proven
code: `kuali/verify-timekeeper-annotation`, the reload read-back that is the *only* landing proof
(D135; ref stores §2, `kuali`). Item 2's draft already declares `save-verify` for both Kuali writes.

**The one real option axis** is *how many read-backs*, which is really a restatement of item 1D
(how many Kuali transaction nodes there are).

**Option A — one reload read-back per save, i.e. one per commit node. ★ recommended**
- *Pros:* it is the kernel's own beat ⑥ — no new mechanism, no new contract shape. Each fence gets its
  own proof, so a post-fence absence parks and names **which** write is unproven. It is byte-for-byte
  the shape already proven live on real doc 4489 (fence → click → reload read-back → settle in
  16.45 s).
- *Cons:* one extra document reload per Kuali write — roughly the ~6 s cold document open plus the
  ~8–10 s fill→save→reload→verify cycle measured under D78, the same numbers item 3's draft uses for
  `probeToFenceMaxMs`.

**Option B — a single end-of-fill verification covering every Kuali write at once.**
- *Pros:* one reload instead of N; the fastest possible run.
- *Cons:* it breaks the beat structure. A fence is per transaction, so one trailing verify cannot say
  which fence landed, and a post-fence absence would park an **ambiguous set** of intents instead of
  one — which is the opposite of what parking is for. It is only coherent if every Kuali write is
  collapsed into ONE transaction node, which is a different answer to item 1D, not a different answer
  to this item.

**Recommendation: A.** The operator's real choice here is item 1D — one Kuali transaction node means
one read-back; two nodes mean two.

`ANSWER (operator), 2026-08-12` — **the STAGED-VARIABLES model: read everything into variables first,
stage every Kuali field in ONE pass at the end, ONE save, ONE reload read-back that verifies every
written field against the exact staged variables.**

The four beats, in the operator's order:

1. **All reads land first as typed checkpoints — "variables".** The Kuali separation document, the
   UCPath Job Summary, the existing-termination probe, the New Kronos timecard, and the reconciled
   dates are each a node output the run holds. Nothing is written to Kuali while the run is still
   reading.
2. **`kuali/fill-separation-finalization` stages EVERY field in one pass, from those variables**, at
   the end of the run. Department, payroll title code, payroll title, timekeeper tasks/name,
   termination effective date, `Submitted Termination Template`, `Transaction Number`, the final-pay
   radio (§4g) and the appended comments are all staged from stored variables — never re-read off the
   page, never recomputed at fill time.
3. **ONE save.**
4. **ONE reload read-back**, verifying **every** written field against the **exact staged variables**
   it was given — not against a fresh derivation, and not against the page's own echo.

**This answers item 1D as well: mutations C and D collapse into ONE Kuali transaction node.** Legacy's
early org-data write (step 4, before Kronos and UCPath) does **not** port as a separate save; it is
staged with everything else at the end. Note what this is and is not: it is Option **A**'s rule — one
reload read-back per commit node — applied to a graph that has exactly **one** Kuali commit node. It
is **not** Option B, which stays rejected for B's own reason: a trailing verify covering several
fences cannot say which fence landed, and a post-fence absence would park an ambiguous set of intents
instead of one.

**The read-back is non-negotiable.** D128 is the standing proof on this exact system: a Kuali save can
answer HTTP `200` with a rendered `Form saved` and persist **nothing**. A positive save signal is
worth nothing; the reload read-back is the only landing proof.

**Caveat, recorded rather than assumed away.** Kuali serializes only the **current workflow step's
section** (D128/D135). If the finalization fields turn out to span sections owned by **different**
workflow steps, then one save cannot carry them and the structure forces **one save + one read-back
per step** — each its own fence, each its own permanent key, per Option A's rule. That is a fact to be
**discovered at the first live dry-run** of `separations-kuali-finalization`, not designed around now
and not assumed false. The staged-variables model is unchanged either way: the variables are still
read first and staged in one pass; only the number of (save, read-back) pairs can grow.

**ANSWERED 2026-08-14 by chunk 5c's live pass (§9.12) — ONE save stands.** The ten fields do span
three sections (`m9LaWN3zL` ×7, `cF6IPyCVw` ×2, `a_Alfq9a2` ×1, read off Kuali's own `ActionPage`
query), and **all three report `sectionSettings: "edit"` at BOTH live workflow steps** — `Task 1 - Jan`
and `Task 1 - Kristina & TES` served the identical ten-entry map. So the structure is not forced to
grow: one fence, one save, one reload read-back, one permanent key. Two cautions ride with the answer:
the section is a gadget id in the form template and is **not** derivable from the rendered headings,
and the map is a property of the STEP, so a step nothing has stood on could still report `hide`.

**One consequence to carry into item 5.** Reading everything first and writing at the end deliberately
**widens the gap** between each read and the write it feeds — and the identity gate sits inside that
gap as a human wait. The per-read `maxAge` values are what bound that gap, which is exactly why item
5's values are the one residual left open.

#### AMENDMENT (operator), 2026-08-14 — the staged set is TWELVE. `Last Day Worked` and `Separation Date` join it.

Chunk 5a asked the one question §4e's original answer left genuinely open (§9.10 judgement 3, and the
orchestrator's disposition 3 that they stay unstaged): legacy's **step 13** writes `Last Day Worked`
and `Separation Date` back onto the Kuali document when date reconciliation moved them, and neither
appears in §4e's normative field list nor in §5 item 1's five-mutation table. 5a recorded the gap and
invented no rule for it. The operator answered it, verbatim:

> **"so what we are doing here is to collect all data first and then fill in the forms at the end."**

**That is this section's own model, applied to two more fields — so the MODEL DOES NOT CHANGE and the
staged set grows by two.** Beats 1–4 are untouched: every read still lands first as a typed variable,
ONE prepare still stages every field in one pass, ONE save, ONE reload read-back against the exact
staged variables. What changes is the size of "every field": **ten → twelve**.

**Where the two values come from.** The `dates` node's RECONCILED output and nowhere else —
`lastDayWorked` (the New Kronos last punch) and `separationDate` (`max(lastDayWorked, last sick, last
holiday)`). Never re-read off the Kuali document at fill time, never recomputed. Both already ride
inside ref write-safety §14.2's packet as `dates.lastDayWorked` / `dates.separationDate` (D211), so the digest
the operator's approval binds to already covers them; they are not repeated into the packet's
`document` block, because the packet is a PRESENTATION of decisions and one value rendered twice is a
value that can disagree with itself.

**The motivating live case is on the record.** §9.14, doc **4524**, 2026-08-14: the Kuali document
carried `06/18/2026` and the reconciliation moved the separation date forward to **`07/03/2026`** on a
holiday (`separationDateChanged: true`, `separationDeterminingLeave: holiday`). Under the pre-amendment
staged set that run would have filed a UCPath termination effective `07/04/2026` and left the source
document asserting `06/18/2026` — two systems disagreeing about the same separation, with the Kuali
document being the one a human reads later. That is the concrete cost the amendment removes.

**Both are staged UNCONDITIONALLY, and that is the honest form here.** Legacy writes them only when
reconciliation moved them; that condition is a property of legacy's **incremental drafts** — it saves
the document several times across its flow and touches a control only when it has a reason to — and
not a property of one-pass staging. Under this model the staged set IS the document's finalized state,
and beat 4 compares every written field against the exact staged variable. A conditionally staged
field would therefore need an expectation composed from *the page's own prior value*, which is exactly
the re-read beat 2 forbids; and the read-back would have to carry a rule about which fields it is
allowed to skip, which is a second place for the write's definition to live. When nothing moved, the
reconciled value **equals** what the document already carries — so the unconditional save writes the
same string back, and the one read-back proves the outcome either way.

**Three obligations this amendment creates, none of them waived.** They are §9.15's list.

1. **Neither control is live-verified EDITABLE.** Both carry `exactly-one-visible` from the
   2026-08-12 read-only pass (§9.3) and NOT the `exactly-one-editable` arm 5c added — that pass
   verified the ten controls that were staged then. D208's whole point is that these are different
   evidence strengths. Both write paths carry `// live-verify: next-live-pass`.
2. **Neither `formKey` has ever been observed**, so both are `null` in
   `KUALI_RRSS_FINALIZATION_FORM_KEYS` and `kualiFinalizationFormKeysMissing()` names them. A
   fabricated key makes the commit's wire proof a check that cannot fail. They would be unassertable
   even with a key, because a Kuali `Date` gadget's model value is epoch milliseconds and not the
   staged `MM/DD/YYYY` string (§9.12 item 2) — so the wire-asserted set stays at five.
3. **§4e's section caveat RE-OPENS for exactly these two.** §9.12 item 1 discharged it for the ten
   fields, which sit in three sections all reporting `sectionSettings: "edit"` at both live workflow
   steps. `Last Day Worked` and `Separation Date` sit in the *Employee Information* block, whose
   section id nothing has read. If it reports `hide` at a live step, one save cannot carry them and
   the structure grows exactly as the original caveat says — one (save, read-back) pair per step,
   each with its own fence and its own permanent key. **The staged-variables model is unchanged
   either way.**

None of the three touches the landing proof, which was never the wire check: the reload read-back now
compares **twelve** fields with the same exact equality and no tolerance arm, so a document that kept
its stale date is an `absent` naming `separationDate` and the write parks.

_(Built 2026-08-14 — §9.15. Ratified as **D217** in ref decisions.)_

---

### 4f. The pure-operator items — no legacy basis, options where options exist

These four have no derivable draft. Each is presented with the shapes its answer could take, so the
operator picks a shape rather than composing from scratch.

#### 4f1. The I-9 separation candidate packet (item 6; ref write-safety §14.7)

**Context.** The operator distinguishes **Kuali separations** and **I-9 separations**, and ref write-safety
§14.7 asks whether the I-9 type shows a **different** candidate packet at the gate. There is no
legacy basis: I-9 Check was split into its own workflow on 2026-07-17 and no I-9-separation branch
exists anywhere in the legacy separations code to derive one from.

- **Option (i) — one packet for both types, with the separation type recorded as a field. ★ recommended default.** *Pros:* one packet composition to build, one gate surface to guard, no divergence risk between two wrong-person controls. *Cons:* if an I-9 separation genuinely turns on evidence a Kuali separation does not carry, the operator sees a packet missing the decisive field.
- **Option (ii) — a declared packet variant per separation type.** *Pros:* each type shows the evidence its decision actually needs. *Cons:* two compositions to keep in step and two redaction classifications; and the wrong-person control must be provably identical in both, or the weaker packet becomes the attack surface.
- **Option (iii) — blocked until the operator describes what an I-9 separation is.** *Pros:* invents nothing. *Cons:* blocks item 6 and therefore the whole questionnaire.

**Recommendation:** (i) as the default, escalating to (ii) **only** if the operator can name at least
one field that must differ. No named field ⇒ no variant.

#### 4f2. Test versus production instance (item 6; ref clock-config-secrets §4)

**Context.** Ref clock-config-secrets §4 wants a per-run test/prod instance decision; whether a UCPath or Kuali *test*
instance exists for this workflow is operator knowledge that neither repo records.

- **Option (i) — a real UCPath/Kuali test instance, if one exists.** *Pros:* the full write path including `Save and Submit` gets exercised with no real termination filed. *Cons:* only useful if its selectors and workflow steps match production, which is itself a live-verification job; and a green test-instance run is explicitly **not** the controlled-commit evidence doc 03c §Phase summary step 5 requires.
- **Option (ii) — an operator-approved production canary: one named separation the operator accepts will be filed for real, with the approval recorded. ★ recommended for the commit proof.** *Pros:* it **is** the required evidence; it is exactly how D128 and D135 were done. *Cons:* irreversible, and it needs a real pending separation with the operator present.
- **Option (iii) — blocked until the operator names a target.** *Pros:* honest if neither exists. *Cons:* blocks §6's controlled-commit criterion.

**Recommendation:** (ii) for the commit proof — it is the only option that satisfies the exit
criterion — with (i) used for fill/prepare rehearsal *if* a test instance exists. Either way, naming
the target is doc 03c §Phase summary step-5 operator work, which §7 already records.

#### 4f3. `probeToFenceMaxMs` for the UCPath termination (item 3)

**Context.** Item 3's draft sets **45 s** for the Kuali writes from D78's measured cycle, and
deliberately **does not draft** the UCPath termination: its preparation is a multi-step wizard
(template → effective date → create → Empl ID → reason code → continue → comments → LDW override) and
no rebuild measurement of that sequence exists.

- **Option (i) — measure it on the first live dry-run and set the bound from the measurement. ★ recommended.** *Pros:* the bound becomes a fact rather than a guess, and the measurement is free — `dryRun:"stop-after-prepare"` means the run reaches exactly the end of preparation and stops with zero durable footprint. *Cons:* the bound cannot be authored before that run, so the descriptor lands with the measurement as a blocking follow-up.
- **Option (ii) — adopt the Kuali 45 s value provisionally.** *Pros:* unblocks authoring immediately. *Cons:* a guessed constant bounding the longest preparation in the program — the same shape as the `minSinceFenceMs` D128 forbids inventing.
- **Option (iii) — set a deliberately generous bound (say 5 minutes) and tighten later.** *Pros:* never fails spuriously. *Cons:* a bound that cannot fire is not a bound; it would pass the guard while proving nothing.

**Recommendation:** (i), with the measurement plan stated in one line so it is not left vague — the
first `separations-ucpath-termination` **live dry-run** records probe-complete → prepare-complete off
the run's own per-beat spans, the interval is read from `explain run`, and the bound is set at a
stated multiple of the measured worst case, with the measurement cited in the descriptor beside the
constant.

#### 4f4. Rehire, deceased, retiree, LOA (item 9's not-in-legacy list)

**Context.** Legacy has **no branch** for any of these. Rehire lives in onboarding; deceased, retiree
and LOA exist only as reason-code entries. Item 9 already names them as needing an operator answer
rather than a draft.

- **Option (i) — out of scope for this migration; each is an unsupported termination type that fails loud at §4a's exhaustive map. ★ recommended for the first landing.** *Pros:* consistent with §4a; invents no behavior; the refusal names the type, so the operator learns immediately which types the map is missing. *Cons:* those separations are handled by hand until a later slice.
- **Option (ii) — in scope, each as its own branch and scenario set.** *Pros:* one migration covers the real caseload. *Cons:* it multiplies the scenario corpus and the template/reason-code map on the largest workflow in the program, with no legacy behavior to port for any of them — pure new design on a write-heavy migration.
- **Option (iii) — partial: map the reason codes so the termination files correctly, but add no branch.** *Pros:* the common case works with minimal new surface. *Cons:* correct only if none of them needs a different template, effective-date rule, or final-pay answer — which is exactly the fact the operator has to supply.

**Recommendation:** (i) for the first landing, promoting a named type to (iii) as soon as the operator
confirms it maps to an existing template with no rule change. §4a's dropdown capture is the
prerequisite either way — the map cannot be made exhaustive without it.

`ANSWER (operator), 2026-08-12 — 4f1 / 4f2 / 4f3 / 4f4:`

**4f1 — separations does NOT involve the I-9 packet. "i9 and kuali separations is very different."**
There is **no I-9 branch** in this workflow: an I-9 separation is a different thing, not a variant of
this one. Ref write-safety §14.7's deferred question resolves as **out of scope for this migration**. In
practice the gate therefore shows **one** packet composition — option (i)'s outcome — but for a
stronger reason than (i) offered: it is not that both types share a packet, it is that this workflow
has only one type. Nothing here is a claim about what an I-9 separation needs; if one is ever
automated it is its own migration with its own questionnaire (and, per §3.1, its own composition).

**4f2 — option (ii): an operator-approved PRODUCTION canary.** No test instance is used for the
commit proof. One named separation the operator accepts will be filed for real, with the approval
recorded — exactly how D128 and D135 were done, and the only thing that satisfies doc 03c §Phase summary step 5.
**The specific canary target is named by the operator when the controlled-commit step is reached, and
is never invented here** (§7's first bullet stands unchanged).

**4f3 — option (i): measure `probeToFenceMaxMs` on the first live dry-run. No guessed constant.** The
first `separations-ucpath-termination` live dry-run records probe-complete → prepare-complete off the
run's own per-beat spans; the interval is read from `explain run`; the bound is set at a stated
multiple of the measured worst case, with the measurement cited in the descriptor beside the constant.
The descriptor lands with that measurement as a **blocking follow-up**, not with a placeholder — (ii)
and (iii) are both rejected, (ii) because it guesses and (iii) because a bound that cannot fire is not
a bound.

**4f4 — the scenario inventory stays OPEN, and the substitute is the MAP-EVERYTHING directive (§3.2).**
The operator cannot enumerate every real-world scenario now, and would rather not pretend to: instead,
**every build chunk maps exhaustively everything it touches** — full dropdown option lists, every
status, type and branch it encounters — so that later scenario work finds its raw material already
captured and **nothing gets re-mapped**. This is deliberately not a choice among (i)/(ii)/(iii):
rehire, deceased, retiree and LOA are not being declared in or out of scope by fiat. What *is* settled
is the behavior in the meantime, and it comes from **§4a**, not from here: any type the exhaustive map
does not carry **fails loud and names itself**, so the first landing behaves as (i) without the
inventory being closed. Promotion of a named type happens when the operator flags it, against the
captured option list. Cross-links: **§4a** (the dropdown capture that supplies the raw material),
**§2.6/D194** (the same instinct at task level — capture the page's whole surface while standing on
it), **§3.1** (a type needing a different template or date rule becomes its own composition, not a
branch here).

---

### 4g. The final-pay radio — an unconditional business assertion

*Behavior review: dangerous pattern **D9**; scenario **S58**. Questionnaire item 1C/6.*

**Context.** Legacy selects *Does not need Final Pay (student employee)* on **every** separation,
unconditionally, with no reference to whether the employee is a student, their job code, or anything
the run read (`legacy:src/systems/kuali/navigate.ts:510-512`). There is no comment justifying it and
no test asserting the choice is correct — only that the fill happens. This migration's
`kuali/fill-separation-finalization` writes that radio into a real document, so the value has to be
decided rather than inherited.

**Options.**

**Option A — derive it from data the run already read (e.g. the Job Summary payroll title code / job description), with an explicit refusal when the data does not determine an answer. ★ recommended**
- *Pros:* the value stops being an assertion and becomes a read fact with provenance; it is right for
  career employees as well as students; a case the rule does not cover fails loud instead of filing a
  wrong answer on a real document.
- *Cons:* needs the operator to state the rule (which job codes / titles are "student"), and any case
  outside it blocks until the rule is extended.

**Option B — keep the hardcoded choice, but record it explicitly as an operator-ratified constant with the reason in the code.**
- *Pros:* zero new logic; if RRSS separations really are always student separations, this is simply
  true and the comment makes it auditable.
- *Cons:* it stays a business assertion with no data behind it; the first career-employee RRSS
  separation writes a wrong answer silently, and nothing in the run would show it.

**Option C — make it an operator input on the gate packet.**
- *Pros:* a human decides per run, on the same screen where they already approve identity.
- *Cons:* adds a decisive field to a gate whose entire design leads with disconfirming identity
  evidence; ref write-safety §14.6 risk #1 (rubber-stamping) argues against bolting unrelated decisions onto it.

**Recommendation: A if the operator can state the rule; otherwise B with the ratification recorded in
the code and in item 6's answer.** What is not acceptable is carrying the constant forward silently —
that is exactly S58's verdict.

`ANSWER (operator), 2026-08-12` — **Option B. Keep the final-pay radio HARDCODED, exactly as legacy
does.**

Stated plainly, because it is a business assertion and not a derivation: **the operator asserts that
*Does not need Final Pay (student employee)* is the correct answer on every RRSS separation this
workflow files — it is written on every doc.** The value is therefore selected unconditionally, with
no reference to job code, title, or anything the run read. Option A is not adopted: there is no rule
to derive it from, because there is nothing to derive.

What B requires and what this answer accepts:

- The constant is recorded in the code as an **operator-ratified business assertion**, dated, citing
  this answer — so the next reader finds a ratification, not an inherited magic value. That is the one
  thing S58 actually objected to: legacy carries it with no comment and no test asserting it is right.
- The residual risk is named rather than hidden: if an RRSS separation ever reaches this workflow for
  someone the assertion does not cover, it writes that answer silently and nothing in the run would
  show it. The operator accepts that, and the correction path is the same as everywhere else here —
  flag the case, and it is designed then (§3.1).

---

## 5. The §b questionnaire (doc 03c §The §b migration questionnaire — twelve items)

**Read this first — the operator asked for exactly one thing from this section.** *"Rephrase those
questions like §4 and ask me in the same format if I still have to answer them — I'm not sure if they
are the same questions you asked in §4."* They largely **are** the same questions: §4 is where the
genuinely open decisions were pulled out and given options, and §5's items are the doc 03c §The §b migration questionnaire
template those decisions came from. So every item below now opens with a **one-line verdict** in one
of three classes, and only the last class is work for the operator:

| Verdict | Meaning |
|---|---|
| **ANSWERED via §4x / §2.6** | The operator already answered it on 2026-08-12 under a §4 heading. Nothing more is owed; the cross-reference names where. |
| **DRAFT STANDS** | The draft is derived from legacy plus the owning docs and needs no operator judgement — it is design work. It is recorded as the answer. |
| **STILL NEEDS OPERATOR** | A genuine residual. Presented in the full §4 format — context → options with pros/cons → recommendation → `ANSWER` slot. |

**Item 5 (freshness `maxAge` values, as two residuals 5A and 5B) was the one item in the last
class — and it was answered by the operator on 2026-08-12 (see item 5 below).** As of that date, no
item remains in the STILL NEEDS OPERATOR class; every item is answered or standing. Each item keeps
its `DRAFT — operator to confirm/correct` line as the record of what was derived.

### 1. Real commits — which actions mutate the external system?

> **VERDICT: ANSWERED via §4e (C+D collapse into one Kuali node), §4g (D's final-pay value) and §4c
> (A's post-commit failure policy) — no further operator input.** The five-mutation list itself is
> DRAFT STANDS: A/B/E are derived from legacy plus ref write-safety §13, and E's refusal follows from §4d.

*What the answer determines:* every mutating action needs a prepare contract, a commit contract, one
transaction lease scope, a stable idempotency key, an expected subject, a post-prepare semantic
observation, a normalizer/matcher, and mismatch/unknown evidence (ref write-safety §2). This is the list the
whole write-safety kernel is instantiated from.

**DRAFT — operator to confirm/correct.** Legacy performs **five** distinct external mutations:

| # | Mutation | System | Draft treatment |
|---|---|---|---|
| A | **Save and Submit the termination transaction** | UCPath Smart HR | A real `commit`. Permanent key `<eid>\|termination\|<terminationEffDate>` (ref write-safety §12's worked example uses exactly this shape). Expected subject = the operator-approved EID from the gate; the staged page's Empl ID field is the post-prepare observation |
| B | **Delete pending termination rows** for the EID | UCPath Smart HR | It deletes rows, so it is a mutation and ref write-safety §13 item 5 explicitly asks whether it is modeled as a first-class fenced write. **Draft: yes — its own commit contract**, keyed `<eid>\|pending-sweep\|<runId>` and run as a separate transaction node before the create (**S30/S31**) |
| C | **Save the Kuali finalization** (term-eff date, template checkbox, transaction number, final-pay radio, comments) | Kuali | A real `commit` with a `save-verify` completion arm — Kuali's save is UI-silent (D78), so a reload read-back is mandatory (**§4e**). Key `<documentNumber>\|finalization\|<transactionNumber>`. The final-pay radio's *value* is **§4g** |
| D | **Write org data into the Kuali doc** (department, payroll title code, payroll title) and the **timekeeper name** | Kuali | Draft: a **second Kuali transaction node**, not a free-floating write. It is benign and restorable, but it is still a save on a real document and the rebuild has no "small write" category. How many Kuali nodes there are is the same choice as **§4e** |
| E | **Rewrite the employee NAME on the Kuali doc** on the `similar` tier | Kuali | **Draft: do NOT port.** Legacy does this even in dry-run (`legacy:.../workflow.ts:634-649`), and `KRONOS-SELECTORS.md:83-84` documents that field as read-only. Rewriting an identity field on the source document to make a match succeed is the wrong direction for a wrong-person control (**S15**, pattern D8) |

**RECORDED ANSWER (2026-08-12).** The draft stands, with one structural amendment from **§4e**:
**C and D are ONE Kuali transaction node, not two.** Every Kuali field — org data, payroll titles,
timekeeper tasks/name, term-eff date, template checkbox, transaction number, final-pay radio,
comments — is staged in one pass from stored variables at the end of the run, saved once, and proved
by one reload read-back (§4e's caveat about step-owned sections is the one thing that could split it,
and it is a live-dry-run finding, not a design choice). Legacy's early org-data write does not port as
a separate save. **A** and **B** stand as drafted (B keyed `<eid>|pending-sweep|<runId>`, its own
fenced node before the create, per ref write-safety §13 item 5). **E** stands refused — the `similar`-tier name
rewrite does not port, which §4d independently requires: an identity field on the source document is
not something a wrong-person control may edit to make itself pass. **D**'s final-pay value is §4g
(hardcoded, operator-ratified).

---

### 2. Completion check per submit

> **VERDICT: ANSWERED via §4e (how many read-backs, and against what) and §4c (partial completion) —
> no further operator input.** The per-mutation arms (`receipt` / typed sweep outcome / `save-verify`)
> are DRAFT STANDS: they are ref write-safety §2's own vocabulary applied to the D130 finding.

*What the answer determines:* which of ref write-safety §2's three completion arms each commit declares —
`receipt`, `save-verify`, or `upload-verify`/argued `unverifiableByPage`. Getting this wrong is how a
"looked submitted" becomes a `done`.

**DRAFT — operator to confirm/correct.**

- **A (UCPath termination) → `receipt`, and the receipt is the PAIR `(transactionNumber, approvalStatus)`, never the number alone.** The 2026-08-04 live probe (D130, ref write-safety §13 item 6) proved a **Denied** transaction carries a perfectly well-formed `T…`, and recorded that legacy's own `interpretPostSubmitTxnReadback` tests only `/^T\d{6,}$/` — a real latent defect. The number lives on **SS Smart HR Transactions** (`UC_EXTENSIONS.UC_SS_TBH.GBL`) detail, anchored on the PeopleSoft record-field ids `#UC_SS_TRANSACT_UC_TRANSACT_ID` / `#UC_SS_TRANSACT_APPR_STATUS` (there is no role+label anchor), reached by the keyed deep link `?Action=U&UC_TRANSACT_ID=T…`. An unknown id renders the ordinary search form **silently**, so the reader must assert the field resolved *and* that its text equals the requested id.
- **B (pending sweep) → its own typed outcome, not a receipt.** Draft: proof is a re-read showing zero pending `TER` rows for that EID. Legacy returns a count and refuses to collapse a thrown sweep into `0` (**S31**) — that refusal ports.
- **C and D (Kuali) → `save-verify`.** Kuali's save is UI-silent (no toast, no banner), so a **reload read-back** is mandatory and "clicked without error" is never proof — the same arm already built and controlled-commit-proven as `kuali/verify-timekeeper-annotation` (D135). **How many read-backs, and why one-per-node: §4e.**
- **Partial completion** — UCPath receipt obtained, Kuali finalization fails — is **§4c**.

**Open, and legacy cannot answer it:** whether the post-submit confirmation dialog renders the `T…`
inline. Legacy says it **cannot** be read from the dialog and re-navigates
(`legacy:src/workflows/separations/CLAUDE.md:147`), and ref write-safety §13 item 6 records that as ported
legacy knowledge, **not** rebuild-verified. Settling it needs one real submit (§7).

**RECORDED ANSWER (2026-08-12).** The draft stands. **A** → `receipt`, and the receipt is the **pair**
`(transactionNumber, approvalStatus)` — never the number alone, because D130 proved a **Denied**
transaction carries a perfectly well-formed `T…`. **B** → its own typed outcome (a re-read showing
zero pending `TER` rows), and legacy's refusal to collapse a thrown sweep into `0` ports. **C+D** →
`save-verify` with **one** reload read-back over **one** Kuali commit node, verifying every written
field against the exact staged variables (**§4e**). Partial completion → parked and resumable
(**§4c**). The one genuinely unsettled fact — whether the post-submit confirmation dialog renders the
`T…` inline — is **live-observation work at the controlled commit**, already routed to §7; it is not a
questionnaire answer and never was.

---

### 3. Double-submit probe policy and age budget per transaction

> **VERDICT: ANSWERED via §4f3 (the UCPath `probeToFenceMaxMs` is measured on the first live dry-run)
> — no further operator input.** `"always"` on every transaction is DRAFT STANDS; the Kuali 45 s value
> stands on D78's measurement.

*What the answer determines:* `"always"` or `"retries-and-recovery-only"` per transaction — required,
no default (ref write-safety §5 / D17) — plus a justified `probeToFenceMaxMs` bounding preparation after the
live probe.

**DRAFT — operator to confirm/correct.** `"always"` for **every** transaction here. The rationale is
the incident class: separations files a real, hard-to-reverse termination, legacy already probes on
every run at three layers, and a probe is one page read against a page the run is already on.
`probeToFenceMaxMs`: **45 s** for the Kuali writes (the value the timekeeper-annotation node carries,
justified from D78's measured ~8–10 s fill→save→reload→verify cycle and a ~6 s cold document open);
the UCPath termination node is **not drafted** — its preparation is a multi-step wizard (template →
effective date → create → Empl ID → reason code → continue → comments → LDW override), and no
rebuild measurement of that sequence exists yet. **The measurement plan and its alternatives: §4f3.**

**RECORDED ANSWER (2026-08-12).** `"always"` for every transaction, as drafted — separations files a
real, hard-to-reverse termination, and a probe is one page read against a page the run is already on.
`probeToFenceMaxMs`: **45 s** for the Kuali write (D78's measured cycle), and the UCPath termination's
bound is **measured on the first live dry-run and set from that measurement** (**§4f3** option i) — no
provisional constant, no generous placeholder. Note the count changed with **§4e**: there is **one**
Kuali transaction node, so one Kuali bound, unless the live dry-run finds the finalization fields span
sections owned by different workflow steps.

---

### 4. Dry-run preview

> **VERDICT: DRAFT STANDS — design work, no operator input needed.** `commit` is structurally absent
> in dry-run (D6, kernel envelope state), so the only authored choice is `stop-after-prepare`, which
> §4f3's measurement plan also depends on. §4e's staged-variables model makes the preview strictly
> richer: the staged values ARE the variables.

*What the answer determines:* what prepare evidence the operator sees, and where the run stops.
`commit` is structurally absent in dry-run (D6, kernel envelope state) — this item is about what the
preview is *worth*.

**DRAFT — operator to confirm/correct.** `dryRun: "stop-after-prepare"` on every transaction node, so
a dry run reads Kuali, resolves and gates identity, reads the timecard, reconciles the dates, and
stages the UCPath transaction — then stops with the staged values previewed and **zero** write
intents, checkpoints, ledger rows, or outbox rows (asserted, not logged). Two legacy dry-run
behaviours **do not port**: the timekeeper-name fill and the `similar`-tier name rewrite both leave
real writes on the Kuali draft during a legacy dry run (**S61**, `legacy:.../CLAUDE.md:158-189`) — and
legacy's own safety argument for that ("an abandoned draft discards its edits") is **stated, never
verified** (behavior review §5 item 2). A dry run in this tree leaves no durable external footprint at
all, which makes the unverified assumption irrelevant rather than merely unlikely.

**RECORDED ANSWER (2026-08-12).** The draft stands, sharpened by **§4e**: because every Kuali field is
staged in one pass from stored variables, a dry run previews the **complete** set of values that would
be written, side by side with the variables they came from — which is also the run that measures
§4f3's bound. Zero write intents, checkpoints, ledger rows or outbox rows, asserted rather than
logged. The two legacy dry-run writes (timekeeper name, `similar`-tier name rewrite) do not port.

---

### 5. Freshness maxAges — justify the *value*, not just its presence

> **VERDICT: ANSWERED — both residuals recorded 2026-08-12.** **5A** the four `maxAge` values: the
> Kuali document, UCPath Job Summary, and New Kronos timecard reads all take the argued-unbounded arm
> — no automatic freshness refresh in separations (see the residual below for the rationale); the
> identity-approval gate result keeps its drafted 4-hour bound because D8/ref write-safety §14.7 forbid
> `Infinity` there. **5B** the override column: every non-forbidden payload field (dates, department,
> titles) is `audited`, never `forbidden` — Option A, not the recommended Option B. §4d answered
> *that* the gate result has a freshness limit and that it is never overridable; **5A now answers
> *what the number is*.** **§4e made this item more load-bearing, not less** — reading everything into
> variables first and writing at the very end deliberately widens the gap these values bound.

*What the answer determines:* per-read staleness limits on everything feeding a write, plus
`forbidden|audited` override status per non-identity field. The guard only checks the field is
*present*; the operator owns justifying that the value is *right*. A too-large window silently reuses
stale data into a live write.

**DRAFT — operator to confirm/correct.** Legacy has **no** freshness model at all — no max-age, no
timestamp staleness check, no re-read-before-write (it relies on positive read-backs and wrong-page
guards instead). So these are rebuild-new values with no legacy basis, drafted from the data's own
staleness risk:

| Read | Draft maxAge | Override | Why |
|---|---|---|---|
| Kuali document fields (name, EID, dates, type) | **10 min** | `forbidden` for EID/name (identity); `audited` for the dates | The doc is operator-editable between runs; legacy deliberately never caches it |
| UCPath Job Summary (dept, titles, legal name) | **10 min** | `audited` for dept/titles; identity `forbidden` | Feeds both a Kuali write and the gate packet |
| New Kronos timecard | **30 min** | `audited` | Punches settle; the derived dates are the write's payload, so this is the riskiest non-identity read |
| Existing-termination probe | **`probeToFenceMaxMs`, not a maxAge** | — | Ref write-safety §5 already bounds probe→fence; a second window here would be two answers to one question |
| **Identity-approval gate result** (ref write-safety §14.5/§14.7) | **DRAFT: 4 hours** — "hours, not days", and `Infinity` is illegal here | never overridable | §14.7 explicitly leaves this value to this questionnaire. On resume the candidate is re-read: identical digest within limit proceeds, a changed candidate re-opens the gate regardless — which is also what makes **§4d** work on a resumed run |

---

#### RESIDUAL 5A — the four `maxAge` values

**Context.** Legacy has **no** freshness model at all, so there is nothing to port and nothing to
confirm against: these are rebuild-new numbers. What makes them real rather than decorative is ref workflow-model
§5.5: when a replayed read can reach a commit node in this run and
`now − observedAt > limit`, the kernel **refuses loudly** and names the re-run as the fix. So a
`maxAge` is not a warning threshold — it is the line at which the run re-reads instead of writing.

Two facts from the answers above set the shape of the choice:

- **The ALWAYS-GATE (§4d) is a human wait sitting between the early reads and every write.** Whatever
  number is chosen for the Kuali document and the Job Summary, an approval that takes longer than it
  means those reads re-run when the run resumes. That is a cost *and* a property: the values the write
  uses were then read **after** the human decision, not before it.
- **§4e widened the gap on purpose.** Every Kuali field is now staged and saved at the *end* of the
  run from variables read at the *start*. These limits are what bound that distance.

**Options.**

**Option A — adopt the drafted values: Kuali document 10 min · UCPath Job Summary 10 min · New Kronos timecard 30 min · identity-approval gate 4 hours. ★ recommended**
- *Pros:* each value is short relative to how fast that data can actually change — the separation
  document is operator-editable between runs, so a 10-minute bound means the run essentially always
  writes what it just read. A re-read is cheap and always safe (~6 s for a cold Kuali document open,
  one Job Summary read); a stale write is neither. The 4-hour gate is exactly ref write-safety §14.7's "hours,
  not days": long enough that an approval given before lunch survives it, short enough that yesterday's
  approval can never be reused. And the re-read after a long gate is a **feature** — the dates the
  termination is filed on were read after the operator approved the person.
- *Cons:* in practice most gated runs will re-read the Kuali document and the Job Summary, because
  human approvals routinely take more than 10 minutes. That is one document open plus one Job Summary
  read per gated run. The Kronos read sits after the gate, so its 30 minutes will rarely bind.

**Option B — one number everywhere: 4 hours for every read, matching the gate.**
- *Pros:* one value to remember; a run whose approval arrives inside the gate's own window never
  re-reads anything, so it is the fastest possible run.
- *Cons:* it makes the write's **payload** exactly as stale-tolerant as the human **decision**, which
  is the wrong asymmetry — an approval ages slowly (it is a judgement about a person), while the dates
  age as fast as somebody can edit the Kuali form. A 4-hour-old read of a document edited 3 hours ago
  files yesterday's dates on a live termination, and §4e's end-of-run write is precisely the shape that
  lets that happen quietly.

**Option C — tighter: Kuali 5 min · Job Summary 5 min · Kronos 15 min · gate 1 hour.**
- *Pros:* the strongest possible guarantee on the data.
- *Cons:* buys very little over A (A already re-reads after most gates) and costs a lot at the gate: a
  1-hour approval window means a lunch break invalidates an approval and re-asks the same question.
  Re-asking a question the operator already answered is what produces **rubber-stamping**, which ref write-safety
  §14.6 names as risk #1 — the dominant failure mode of an always-gate.

**Recommendation: A** — the drafted values, unchanged. They are the only set where the two things that
matter are both true: nothing stale can reach the write, and the gate is not asked twice for one
decision.

`ANSWER (operator), 2026-08-12 — 5A:` **None of the three drafted options. NO automatic freshness
refresh in separations — the Kuali document, UCPath Job Summary, and New Kronos timecard reads all
take the argued-unbounded arm (`maxAgeMs: Infinity`, justified per ref task-contract / ref workflow-model's "`Infinity` must be
argued in a comment" provision); the identity-approval gate result keeps a real bound because D8/
ref write-safety §14.5/§14.7 forbid `Infinity` for identity facts categorically.**

- **The rationale, in the operator's words.** The Kuali separation document is a SAVED, stable
  artifact — once the department saved it, the data does not churn, so an age-triggered re-read buys
  nothing here. The same reasoning extends to the Job Summary and the timecard reads this workflow
  stages: under **§4e** every one of them is read once into a variable at the start of the run and
  never re-derived mid-run, so an internal age check on a value the run itself is about to write back
  adds cost without adding safety.
- **Refresh is deliberate, never automatic.** Freshness in separations comes from an explicit
  operator RE-RUN — including a re-run with operator-supplied values via the Edit Data path
  (D166/D168) — never from an age check silently triggering a re-read mid-run. This replaces the
  drafted 10 min / 10 min / 30 min values outright; none of Option A, B, or C above is adopted as
  written.
- **The identity-approval gate result is excluded from this answer, structurally, not by oversight.**
  ref write-safety §14.5/§14.7 and D8 already make `Infinity` illegal for the gate result — it bounds a human
  judgement's shelf life, not a document's staleness, and none of 5A's own three options ever proposed
  `Infinity` for it either. It keeps the drafted **4 hours** ("hours, not days," per §14.7) — the one
  number this re-scoping does not touch.
- **Scope, stated so it is not over-read.** This answer is **separations-only**. A submit-immediately
  workflow — one with no save step between an operator edit and this workflow's read — has no "saved,
  stable artifact" to point to, and sets its own real, bounded windows in its own §b questionnaire.

---

#### RESIDUAL 5B — the override column on the DATE fields

**Context.** Ref workflow-model §5.5 lets a field be marked `override:"audited"`, which means a stale value can be
**confirmed** by the operator instead of re-read. It is not a silent bypass: the dashboard shows the
checkpoint, its age, the limit and the consuming write node, the confirmation is explicit, it is
scoped to that single resume attempt, it is never persisted onto the item, and it lands in the span
stream as an audited note. Identity, person selection, idempotency-key inputs and write proof are
`forbidden` **by guard** and cannot be marked otherwise — so this question is only about the
**non-identity** fields, and really only about one group of them.

The question: **may the operator confirm a stale LAST-DAY-WORKED / separation date into the write?**
Those dates are the write's payload — the last punch becomes the LDW and the derived separation date
becomes the **termination effective date**.

**Options.**

**Option A — as drafted: dates `audited`, department/titles `audited`, identity and the gate result `forbidden`.**
- *Pros:* an override exists for the annoying case — a run whose timecard read went stale by a couple
  of minutes can be finished instead of restarted, with a full audit trail.
- *Cons:* it lets a human wave through exactly the value the run exists to compute. Under **§4b** the
  operator already chose that an unreadable timecard **fails** rather than falling back to the
  Kuali-carried date; permitting a stale-date override is a quieter version of the same substitution,
  arriving through a dialog instead of a code path.

**Option B — dates `forbidden`; department/titles stay `audited`. ★ recommended**
- *Pros:* consistent with §4b's own posture — no path in this workflow files a termination on a date
  the run did not freshly establish, whether the shortcut comes from a fallback or from a
  confirmation. The fields that stay overridable are the org-data fields, which land on the Kuali
  document where they are visible and correctable, not in the UCPath transaction.
- *Cons:* a run whose timecard read is 31 minutes old must re-run the Kronos read rather than be
  confirmed through. That is one extra timecard read — the same cost §4b already accepted wholesale.

**Option C — everything `forbidden`; no overrides anywhere in this workflow.**
- *Pros:* simplest rule; nothing in a live termination is ever waved through.
- *Cons:* it also removes the one genuinely benign case (a slightly stale department or payroll title),
  forcing a Job Summary re-read for a field whose staleness is visible on the document afterwards. Small
  cost, but it leaves the override machinery entirely unused here, so the next workflow that wants it
  re-litigates the principle from zero.

**Recommendation: B.** Make the dates `forbidden` and keep department/titles `audited`. It is the
answer that matches what the operator already decided in §4b: the dates are the payload, and a payload
the run could not freshly establish is a run that stops.

`ANSWER (operator), 2026-08-12 — 5B:` **Option A, not the recommended Option B — every non-forbidden
payload field is `audited`: the dates (last day worked / separation date) AND department/titles.**

- **The override, precisely.** `audited` means an override exists ONLY via explicit operator
  confirmation in the freshness dialog (ref workflow-model §5.5), and it is always durably recorded — the value
  seen, its age, the limit, the consuming write node, and who confirmed. It is never automatic, never
  a fallback, and never persisted onto the item beyond the single resume attempt it confirms.
- **Why this does not reopen §4b.** §4b's hard-fail is about a FAILED or unreachable Kronos read — no
  card, no signal, wrong subject — and that path stays banned from ever substituting a value; nothing
  here changes it. 5B's `audited` override only ever fires on a **stale but successfully read**
  checkpoint the operator explicitly confirms — a human action, not a failure path, fallback, or
  automatic mechanism. That distinction is what keeps this answer consistent with §4b rather than
  reopening it.
- **The structural `forbidden` set stays untouched.** Identity/person selection, idempotency-key
  inputs, and write proof stay `forbidden` by guard and cannot be marked otherwise by anyone — this
  answer only ever concerns the dates/department/titles group.
- **The derived fact, recorded so it is not mistaken for a contradiction.** Under **5A**'s unbounded
  windows, a Kuali document / Job Summary / timecard checkpoint essentially never goes stale relative
  to the run that read it, so this audited confirmation dialog will **rarely-to-never fire** in
  separations in practice. The policy is still recorded in full — for the override machinery's own
  completeness, and because a future workflow that sets real, bounded §b windows inherits this same
  `audited` policy and will see the dialog fire for real.

---

### 6. Workflow-specific gates and data

> **VERDICT: ANSWERED via §4d (gate always), §4f1 (no I-9 packet), §4f2 (canary), §4a (reason-code
> refusal + dropdown capture), §4g (final-pay radio) and §4b (which CORRECTS the department-gate
> bullet) — no further operator input.** The intake-none and future-date-preflight bullets are DRAFT
> STANDS.

*What the answer determines:* which gates the graph carries, and whether any intake/roster/capture
machinery is involved.

**DRAFT — operator to confirm/correct.**

- **Identity-approval gate: YES, ALWAYS** (ref write-safety §14, D77). Every separation, no auto-approve. **Whether any run mode may skip it: §4d (recommendation: never).**
- **Two separation types.** The operator distinguishes **Kuali separations** and **I-9 separations**; ref write-safety §14.7 asks whether the I-9 type shows a **different candidate packet**. **No draft — legacy has no I-9-separation branch to derive one from** (I-9 Check was split into its own workflow on 2026-07-17). **Options: §4f1.**
- **Intake:** none. Input is one Kuali document number, typed. No column mapping, no roster, no mobile capture, no manifest (ref data-intake-and-edit-data is not involved).
- **Instance:** ref clock-config-secrets §4 per-run test/prod. **No draft** — whether a UCPath or Kuali *test* instance exists for this workflow is operator knowledge. **Options: §4f2.**
- **Department gate (HDH).** Legacy skips the Kronos read for non-HDH departments and does so **fail-safe** — it skips only on a *positive* non-HDH determination, and an unknown department still runs Kronos (**S32/S33**, `legacy:.../workflow.ts:757-788`). Draft: port it, keeping the fail-safe direction, as a branch case rather than a gate. **It is also the one closed proceed-without-timecard arm in §4b.**
- **Future-date preflight.** Legacy refuses a future-dated LDW or separation date ("not yet eligible for separation") (**S7**). Draft: port as a validation refusal.
- **Reason-code default — the one drafted REFUSAL.** Legacy's `mapReasonCode` falls back to **`"Resign - No Reason Given"`** for an unmapped or blank termination type (`legacy:src/workflows/separations/schema.ts:200-223`), and a documented type (`Death`) has no map entry and would land on it. That is a plausible-but-wrong value on a live HR transaction — the exact pattern this tree bans. **Draft: fail loud naming the unmapped type**, and require the map to be extended. **Options, and the dropdown capture that makes the map exhaustive: §4a.**
- **The final-pay radio.** Legacy asserts *Does not need Final Pay (student employee)* unconditionally (**S58**). **No draft — options: §4g.**

**RECORDED ANSWER (2026-08-12), bullet by bullet.**

- **Identity-approval gate:** YES, ALWAYS, in **every** run mode — no preset, prefill or resume path
  can disable it (**§4d**).
- **Two separation types:** does not apply here. **Separations as built does not involve the I-9
  packet** — "i9 and kuali separations is very different" — so there is no I-9 branch and no packet
  variant; ref write-safety §14.7's question resolves **out of scope for this migration** (**§4f1**).
- **Intake:** none, as drafted. One typed Kuali document number; ref data-intake-and-edit-data is not involved.
- **Instance:** an **operator-approved production canary** for the commit proof, target named by the
  operator at doc 03c §Phase summary step 5 (**§4f2**).
- **Department gate (HDH) — CORRECTED by §4b.** It does **not** port as a proceed-without-timecard
  arm. §4b's answer is hard-fail on any unavailable or unreadable Kronos, and the recorded nuance
  covers exactly this case ("special cases where the Kuali-carried date alone would suffice… those
  also fail for now"). So **no** department determination lets a run skip the timecard today. When the
  operator flags a real case, it is designed then as a **§3.1 recomposition**, not as a branch here.
- **Future-date preflight:** port as drafted — a future-dated LDW or separation date is a validation
  refusal (**S7**).
- **Reason-code default:** the drafted **refusal** is adopted, with the fuzzy tier deleted outright and
  the map made exhaustive by a live dropdown capture during chunk work (**§4a**).
- **Final-pay radio:** **hardcoded**, as legacy does — the operator's accepted business assertion,
  written on every doc, recorded in the code as an operator-ratified constant (**§4g**).

---

### 7. Reuse map — which tasks are reused, which are new

> **VERDICT: ANSWERED via §2.6/D194 (how wide every new read task is) — no further operator input.**
> The §2.2–§2.5 inventory itself is DRAFT STANDS: it is derived from the code, and ref stores §1's
> REUSE/CUSTOMIZE/BUILD rule decides each row.

*What the answer determines:* the actual §2 inventory above, and for each new task, its
reusable-base design plus the workflow-specific customization (charter §3/§8).

**DRAFT — operator to confirm/correct.** See **§2.2–§2.5** for the full tables. The shape of the
answer: `ucpath` and `kuali` stores exist with real drivers, login recipes, and UI registries and gain
new task families; **`new-kronos` is a 3-line session declaration with an `"unwired"` driver and zero
tasks** (`src/stores/new-kronos/index.ts`) and is built whole here — that is the largest single piece
of new surface this migration mints, and the main reason it was chosen as the entry. One helper is
already ported and waiting: `src/stores/common/timecard.ts` says in its own header that "the New
Kronos adapter [closes] at order 8", so its `SemanticTimecardDriver` seam is a **reuse**, not a new
design. **How wide each new read task's output should be — the rich-extraction convention — is §2.6,
and it changes how every one of these tasks is authored.**

**RECORDED ANSWER (2026-08-12).** The §2.2–§2.5 inventory stands, authored under **D194**: every new
read task is **one task per page visit returning that page's full useful surface** into one fixed
strict schema, with an explicit `{state:"absent", reason}` arm on every field that can legitimately be
blank and a declared redaction classification per leaf. Concretely —
`kuali/read-separation-document` returns the whole useful separation-form surface (not only the six
fields step 1 needs), `ucpath/read-job-summary` returns the whole effective-dated row surface, and
`new-kronos/read-separation-timecard` returns the whole parsed timecard surface it can prove. That is
the same instinct as §3.2's MAP-EVERYTHING directive, applied to the task's output instead of the
build chunk's notes. `new-kronos` is still built whole here, and `src/stores/common/timecard.ts`'s
`SemanticTimecardDriver` seam is a reuse.

---

### 8. Local artifact effects

> **VERDICT: DRAFT STANDS — design work, no operator input needed.** "Neither" follows from the legacy
> source (screenshots only, no downloads, no workbook). The draft's one open phrasing — the Kronos
> audit capture being "required or explicitly optional" — is settled **required** by item 11's own
> draft, which owes `explain run` "which grid the punch was read from".

*What the answer determines:* whether a read downloads immutable bytes (content-addressed writer) or
the workflow updates a **mutable** local file — the latter requires a stable-keyed blocking outbox
projection, idempotent upsert, and an expected-version concurrent-edit policy.

**DRAFT — operator to confirm/correct.** **Neither.** Legacy separations produces **only
screenshots** — no PDFs, no downloads, no spreadsheet or workbook writes. Screenshots go to the
content-addressed artifact writer as immutable bytes; there is no mutable local target, so no outbox
projection is owed. One legacy capture is worth porting deliberately: the New Kronos audit screenshot
is a **viewport** capture centred on the chosen last-worked row (the timecard is a virtual-scroll
grid, so a full-page shot proves nothing) — it is the evidence that the punch the write used is the
punch the grid showed. Note legacy takes it best-effort inside a swallowing `try/catch`
(`legacy:.../workflow.ts:1002-1014`, pattern D11), so losing the evidence is silent; in this tree the
capture is either required or explicitly optional, never silently dropped.

**RECORDED ANSWER (2026-08-12).** The draft stands: **neither** a mutable local target nor a
downloaded-bytes read — screenshots only, to the content-addressed artifact writer as immutable bytes,
so no outbox projection is owed. The one open phrasing is settled: the New Kronos **viewport** capture
centred on the chosen last-worked row is **REQUIRED**, not best-effort. Item 11 obliges `explain run`
to answer "which punch date the write used and which grid it was read from", and an evidence artifact
that can vanish inside a swallowing `try/catch` (legacy's pattern D11) cannot answer it. A failed
capture fails the node.

---

### 9. Scenario inventory

> **VERDICT: ANSWERED via §4f4 — the inventory stays deliberately OPEN, with §3.2's MAP-EVERYTHING
> directive as the substitute; the timecard-failure policy is §4b, which also CORRECTS two rows below.
> No further operator input now** — the corpus grows from captured material as each chunk lands.

*What the answer determines:* the executable scenario corpus (ref operator-trust §3), which `scenario-coverage`
audits against the graph. Truly impossible variants must be named as impossible, with the reason.
The full traced source is `separations-legacy-behavior.md` §2 (S1–S63).

**DRAFT — operator to confirm/correct.** Legacy handles all of these and each becomes a scenario:

*Timecard:* not found in New Kronos (genuine no-results → fall back to the Kuali LDW, **S34**) · found
but the timecard will not open (**throws** — must not read as "no punches", **S36**) · timecard shows a
**different** employee (throws before any punch is read, **S37**) · timecard opened but no punch rows
(**S38**) · read rejected (`timecardRead=false` → keep Kuali's date verbatim, write no "per Kronos"
comment — three real Kuali docs were wrongly modified before legacy fixed this) · date range spanning
a year boundary (resolve against the applied window; never guess the year, **S41**). **The policy for
every failed/unreachable case is §4b.**

*Prior state:* approved `TER` inside the 14-day window → reuse the number, skip the create (**S27**) ·
prior-job `TER` outside the window → create fresh (**S28**) · unreadable `TER` effective date →
**never** reuse (**S29** — note legacy resolves that uncertainty *toward* creating a real termination,
which is the opposite of this tree's posture) · stale pending termination with a different effective
date → swept before the create (**S30**).

*UCPath write:* Empl ID not recognized (fatal, **S48**) · LDW override cannot be verified (fatal, never
submits, **S49**) · submit succeeded but no `T…` parsed (fatal **before** the Kuali finalization,
**S52**) · submit returned a `T…` with a **Denied** approval status (D130 — the arm legacy does not
have) · save-and-submit timeout with neither banner nor confirmation (refuse to report success,
**S51**) · a matched row whose receipt cannot be read (**S46** — an unreadable receipt is not an absent
transaction).

*Identity:* name tiers `same` / `similar` / `different` (**S14–S17**) · short (<8-digit) EID (**S18**) ·
valid-format wrong-person EID · **operator rejects at the gate** (terminalizes `cancelled`, never falls
through to a write) · approval goes stale / the candidate changes under it → re-gate (**S25**) ·
already-terminated in UCPath (**S21/S22**).

*Other:* non-HDH department (skip Kronos, **S32**) · unknown department (still run Kronos, **S33**) ·
future-dated LDW or separation date (**S7**) · multiple jobs / transfer (pick the effective-dated row
at or before the separation date, **S23**) · blank job code (fail loud, **S24**) · department option
that matches no Kuali dropdown entry (fail loud rather than save a blank required field, **S55**) ·
existing timekeeper comments unreadable (refuse rather than blank them, **S56**) · crash between fence
and confirmation (ref write-safety §4 recovery) · UCPath filed but Kuali not finalized (**S57/S60** — **§4c**).

**Named as not-in-legacy, needing an operator answer rather than a draft:** rehire (no branch exists —
rehire lives in onboarding), deceased/retiree/LOA as distinct paths (only reason-code entries), and
multi-person-per-run (legacy is one doc = one person; multi-doc runs are **sequential batches**, not
fan-out). **Options for the first three: §4f4.**

**RECORDED ANSWER (2026-08-12).** The inventory **stays open by decision**, not by omission: the
operator cannot enumerate every real-world scenario up front and declines to pretend otherwise. In its
place, **§3.2's MAP-EVERYTHING directive** binds every build chunk to exhaustively capture what it
touches — full dropdown option lists, every status/type/branch encountered — so the scenario corpus is
written later from **captured** material rather than from memory, and nothing is re-mapped. The
drafted scenarios above all stand as scenarios; three rows change **outcome** under **§4b**:

- *"not found in New Kronos → fall back to the Kuali LDW" (**S34**)* — no longer a fallback. It
  **fails**, with "no card" / "card empty" / "card unreadable" / "search timed out" kept as four
  **distinct** values in the data model even though all four currently fail, because those are the
  values a future composition would be selected on.
- *"non-HDH department → skip Kronos" (**S32**)* and *"unknown department → still run Kronos"
  (**S33**)* — the skip arm does not port at all, so both now run Kronos and both fail if it cannot be
  read. They stay in the corpus as the legacy behavior this migration deliberately departs from.

The not-in-legacy list (rehire, deceased/retiree/LOA) is neither adopted nor refused by fiat: an
unmapped type **fails loud and names itself** at §4a's exhaustive map, and each is promoted when the
operator flags it — as its own composition if it needs a different template or date rule (**§3.1**).
Multi-person-per-run stays out: one document, one person, one run (item 10).

---

### 10. Delegation and queue policy

> **VERDICT: DRAFT STANDS — design work, no operator input needed; reinforced by §3.1's lego
> directive, and bound by §4c (resume) and §4d (no resume skips the gate).** Lego recomposition is
> assembling a **descriptor** from proven chunks, which this tree already does; it is not the unwired
> `child-run` seam, so **no delegation is wired by this migration**.

*What the answer determines:* enqueue policy, standard actions, and for every child edge the stable
item id, typed result, cardinality/join, child-failure policy, cancel, child retry/parent resume, and
visibility (ref workflow-model §3.2). **It also decides the §3 composition question.**

**DRAFT — operator to confirm/correct.**

- **Enqueue:** `reject-active` per document number — two concurrent runs on one separation document is never intended, and ref write-safety's same-key mutex already refuses the second fence anyway. Note **S5**: legacy's enqueue-supersede only cancels *non-terminal* prior runs, so a completed doc can be re-run with nothing but two live page probes standing between it and a second termination — the permanent key is what makes that durable here.
- **Surface shape:** `single`. One document, one person, one row. Multi-document submissions are separate runs (legacy's sequential batch was a daemon convenience, not a graph property — and **S43** shows what its shared page state cost).
- **Delegation to person-lookup:** legacy delegates conditionally on the `different`/short-EID arms (**S17/S18**). **Draft: do NOT delegate — resolve candidates inline and hand them to the ALWAYS-GATE packet.** Under ALWAYS-GATE the operator sees the candidates on *every* run, so the child run buys presentation the gate already owes, at the price of wiring an unwired seam (§3).
- **If the operator wants real sub-workflow composition instead** (§3's "lego" as actual child runs), this item is where that is decided, and this migration then also owns wiring `ChildRunExecutor` through `composeWorkerRuntime` plus the enqueue/join transaction and the fan-out manifest. That is a real slice; it is not free.
- **Resume/retry actions** must respect **§4c** (a partial completion resumes into finalization only) and **§4d** (no resume path may skip the identity gate).

**RECORDED ANSWER (2026-08-12).** The draft stands whole. `reject-active` per document number;
`single` surface shape; **no delegation** — candidates are resolved inline and handed to the
ALWAYS-GATE packet, which under §4d the operator sees on every run anyway, so a child run would buy
presentation the gate already owes at the price of wiring an unwired seam. The operator's **§3.1 lego
directive does not change this**: recomposition there means composing a **descriptor** from proven
chunks and store tasks — the mechanism this tree has built and proved — not real child runs. The
`ChildRunExecutor` seam stays unwired and this migration does not own wiring it. Resume/retry actions
are bound by **§4c** (a post-commit failure parks and resumes into the Kuali finalization only, under
its own permanent key) and **§4d** (no resume path may skip the identity gate).

---

### 11. Trust contract

> **VERDICT: ANSWERED via §4c (`partial` and the park), §4e (what the read-back proves) and §4d (the
> approval on the receipt) — no further operator input.** The redaction/notification/`explain run`
> bullets are DRAFT STANDS, widened by §2.6/D194's per-leaf classification tables.

*What the answer determines:* what makes each terminal outcome `verified|partial|unknown`, which
artifacts/proofs are required, what is redacted, which failures/notifications fire, and how
`explain run` answers "what happened?" (ref operator-trust §2).

**DRAFT — operator to confirm/correct.**

- **`verified`** requires: the gate's `IdentityApprovalResult` with `approvedBy`/`approvedAt`/`evidenceDigest` (ref write-safety §14.4, carried onto the receipt per D82) **and** the UCPath receipt pair `(transactionNumber, approvalStatus)` read back from the keyed deep link **and** the Kuali finalization's reload read-back proof.
- **`partial`** is the honest outcome when the termination committed with a receipt but the Kuali finalization did not — the external record is correct, the document is not (**S60**; the resume policy is **§4c**).
- **`unknown` parks.** Post-fence absence, an unreadable receipt, or a disagreeing read-back parks the intent and the run (`parked-write`); only proof-of-presence or an operator-confirmed absence releases it (ref write-safety §4.1). A generic retry may not.
- **Redaction:** every evidence leaf needs a declared classification (ref operator-trust §D140) — an undeclared leaf fails loud. Names and EIDs are the sensitive surface here; screenshots stay `restricted`. **If §2.6 Option A is adopted, the classification tables are wider per task and are authored with the task.**
- **Notifications:** the gate opening is the one that matters daily (an open operator gate is already a base trigger), plus run failure, subject mismatch, and unknown write outcome. Triggers carry ids/codes/counts only — never free text — so no captured form contents can leak (D138).
- **`explain run`** must answer, without archaeology: which person was approved and by whom, which candidates were shown, which punch date the write used and which grid it was read from, the exact staged values, the receipt pair, and what the Kuali read-back saw. Contrast **the legacy signal table** (`separations-legacy-behavior.md` §3, "What the operator actually sees"): three failure classes there terminate **`done`**, two of them having produced wrong or unverified real-world effects.

**RECORDED ANSWER (2026-08-12).** The draft stands, reconciled with §4c and §4e:

- **`verified`** is unchanged: the gate's `IdentityApprovalResult` (`approvedBy`/`approvedAt`/
  `evidenceDigest`) **and** the UCPath receipt **pair** **and** the Kuali reload read-back proving
  **every** staged field against its exact staged variable (**§4e**).
- **`partial`** is the terminal disposition for "UCPath filed, Kuali document not finalized" — but the
  run reaches it only by an operator resolution, because **§4c** makes that state **park** first. A
  partial-completion run does not terminalize on its own; it waits, holding the durable receipt pair,
  and resumes into the finalization node.
- **`unknown` parks**, unchanged (post-fence absence, unreadable receipt, disagreeing read-back);
  only proof-of-presence or an operator-confirmed absence releases it, never a generic retry.
- **A Kronos failure is none of these** — under **§4b** it terminalizes **`failed`** before any fence,
  which is why it needs no trust arm: nothing external happened.
- **Redaction:** per-leaf classification on every evidence leaf, undeclared leaf fails loud — and
  under **D194** the tables are **wider per task** and are authored *with* the task, not retrofitted.
- **Notifications and `explain run`:** as drafted. `explain run` additionally owes the staged-variable
  correspondence §4e creates: which variable each written Kuali field came from, and what the
  read-back saw for it.

---

### 12. Authoring boundary

> **VERDICT: DRAFT STANDS — design work, no operator input needed.** The boundary is fixed by D79a
> (selectors, schemas, bindings, proof and graph structure are always code) and D60/charter §23 (an
> advisory can never resolve a gate); §4d and §4g only narrow it further.

*What the answer determines:* which edits the workflow editor may apply as closed
presentation/policy changes, and which requests must become a code-change brief. Selectors, schemas,
bindings, proof, and graph structure are **always** code work (D79a — DSL/codegen is cut, forever).

**DRAFT — operator to confirm/correct.** For this workflow the editable surface is deliberately
**narrow**: labels, ordering and presentation of the gate packet's non-decisive fields, and
notification/severity presentation. Everything that decides *who* gets terminated or *whether* a
write happened stays code — the reason-code map, the date-reconciliation rules, the `+1 day`
effective-date derivation, every selector, the gate's decision packet composition, freshness limits,
probe policy, and the graph itself. Ref operator-trust §4.4's **record-sanity-check advisory** (deferred here by
D192) renders as prose beside the gate and is explicitly **never** an authority: it cannot resolve a
gate (charter §23 / D60) and its suggestions are separately labelled from deterministic findings.

**RECORDED ANSWER (2026-08-12).** The draft stands. The editable surface is labels, ordering and
presentation of the gate packet's non-decisive fields, plus notification/severity presentation —
nothing else. Two of today's answers are explicitly **code, never editable**: the identity gate's
presence in the graph (**§4d** — the `identity-gate-before-separation-commit` guard is what enforces
it) and the final-pay constant (**§4g** — an operator-ratified value in code with its reason, not a
presentation setting). The reason-code map, the date-reconciliation rules, the `+1 day` derivation,
every selector, the packet composition, the freshness limits and the graph itself all stay code.

---

## 6. Exit criteria for this migration (doc 03c §Exit criteria)

Repeated here so the checklist is in one place; the master plan owns the normative text.

- [x] **§5 questionnaire answered and recorded above, and every §4 decision answered** — §4a–§4g and all twelve §5 items landed 2026-08-12, including item 5's residuals 5A/5B (the freshness values and the date fields' override column) — `new-kronos/read-separation-timecard` can now be authored against a real `freshness` field
- [x] `typecheck` + `lint` + `test:coverage` green (D191); the descriptor passes `descriptor-coverage`; every commit contract passes `write-safety-contract` and transaction pairing — green at `1d019ee`
- [x] Every input/output/result/command/detail/evidence parses strict; every UI id, scenario id, and subject observation resolves; no raw Page/Locator/selector outside the system driver
- [x] **Live dry-run green** against Kuali, UCPath, and New Kronos (submit-free, zero durable write rows asserted) — **MET 2026-08-14 (§9.17)**: run `7565a88d` / `sp-105939-7565` on doc 4502 ran the whole read chain live, parked at the ALWAYS-GATE, took a real approval through the real command endpoint, resumed, and reached its **preview terminal** — `transaction.previewed` (`subject: not-observed`, `externalCommit: none`), a terminal `run_results` row bound to the PREVIEW schema hash `86cd007a…` carrying D215's `already-present` settlement off a live probe, and a receipt at `partial`/`unknown` with the load-bearing `DRY_RUN_PREVIEW` warning naming that probe. **Zero durable write rows proved from authority** across both parts of the pass. §4f3's per-beat interval does **not** ride on this run and never could — a preview has no fence — so it moves to the controlled commits (§9.17 item 4). _Historical (§9.14): the two platform blockers, both FIXED as D214/D215; §9.16 §5's stale-BFF blocker, cleared by the restart._ Prior text: the composed graph ran the whole read chain live on two real subjects, parked at the ALWAYS-GATE, took a real approval through the real command endpoint and resumed, with **zero durable write rows proved from authority**. The preview terminal was blocked by two PLATFORM items, neither a write-safety failure — `executeDryRun` previewing `clear-pending`'s prepare without its probe, and an `always-rerun` node colliding with its own checkpoint across a gate resume — and **both are FIXED (D215, D214; platform slice 2, 2026-08-14)**. **What remains is one re-run and nothing else** — §9.16 §5 found the re-run blocked operationally, on a stale singleton dashboard BFF serving a pre-D217 `separations` fingerprint that no current worker can claim a run under; restarting it is the whole remedy, and doc **4502** is the subject (active job, past LDW, no pending row — D215's `already-present` arm). §4f3's per-beat interval rides on that same run
- [ ] **Controlled-commit evidence** for every commit/probe/verify on an **operator-approved target** — unavailable safe evidence **blocks** rebuild-ready status; a dry-run success is never converted into a write-safety claim — **BLOCKED, all three commits open (2026-09-01)**. D300's one-key admission passed in the primary checkout, then R1/u1's current Action List search found sole registry canary 4537 gone before S7/gate/write (§9.33). Run `325cd998…` records `DOCUMENT_NOT_IN_ACTION_LIST`, write state not-attempted and exact-run 0/0/0. D284 retains the sole label as `gone` and permits no substitute. A new operator-named canary must pass a fresh read/S7 observation and green composed rehearsal before ② UCPath filing → immediate ① UCPath pending sweep → ③ Kuali finalization. Each write still requires its own ALWAYS-GATE; freeze source and canonical input from that future successful rehearsal through ③, forbid `reRead` after ②, and stop without retry on UNKNOWN. A2–A5/A8 remain open and R3 obligations remain separately owned. _Historical: doc 4524's recommendation WITHDRAWN (§9.16 §3 — action completed 2026-08-14); doc 4510, once the best-mapped standalone Kuali candidate (composed-graph refusal live-proved 2026-08-14, §9.17 item 2: run `ee9824f7`, `NO_ACTIVE_EMPLOYMENT`, EID 10001799), is also GONE (§9.19 §7: action completed, `document: null`)._
- [x] `identity-gate-before-commit` green — the actual guard is `tests/unit/architecture/identity-gate-before-commit.test.ts`, registered under that name in `docs/rebuild/guard-inventory.json`; every commit is graph-reachable only through the gate node (ref write-safety §14.6 guard #2; the structural half of §4d) — and §14.5's digest binding is proved LIVE (§9.14): the stored gate result's `evidenceDigest` is byte-identical to the `comparison` checkpoint's
- [x] D58 capability dispositions updated for every legacy capability this workflow touches; legacy source and tests preserved — **MET 2026-08-14 (§9.17 item 6)**: three entries touched (`legacy-workflow-separations`, `legacy-tool-debug-kronos`, `legacy-tool-ops-sanity-check-record`), all correctly `open` at the runtime's own milestone, nothing stale under D188's arm, no legacy path deleted. One finding for the operator: **D192's deferral condition on `legacy-tool-ops-sanity-check-record` is now materially satisfied** — the §14.2 packet's `comparisons` array is exactly the prose-observations-beside-the-gate shape D192 asked for — and it is flagged rather than re-dispositioned, because closing an inventory entry is an operator decision
- [x] Regression scenario + knowledge record for anything the live lane finds; owning docs and the nearest `CLAUDE.md` updated — **D212 and D213 landed with their tests (`d00b66c`, `1d019ee`); the two platform items above became D214/D215 and both landed with theirs; the `already-present` receipt arm platform slice 2 named landed at `b73b546`.** **PARTLY MET after §9.17**: the re-run's own defect — D215's `not-observed` subject verdict missing from the span WIRE leaf, which killed the worker on the first preview that ever settled — landed with its regression case at `e1ba81b`. **Of the two findings the pass named rather than pinned, one is now closed**: the retry checkpoint re-collision (§9.17 item 8) landed as **D221** with `tests/unit/retry-item-attempt.test.ts` — the attempt in an item-scoped checkpoint key is the ITEM's attempt, so a retry takes the item's next one and its `always-rerun` executions can no longer land on the retried run's key — and it is now **LIVE-PROVED on the composed graph (§9.20, 2026-08-19)**: six retries through the real command endpoint across two logical items (attempts 2→3 on doc 4510, 2→3→4→5→6 on doc 4502), every one minting the item's next unspent attempt, none refused, no collision, `timecard-search` — §9.18 item 8's own node — re-executed at three separate attempts, one retried run replaying eight checkpoints written by two earlier runs at two different attempts, and the last of them reaching a terminal **`done`** at D215's `already-present` preview terminal with zero durable write rows. **The last one is now CLOSED**: the browser-profile wedge (§9.17 item 5, §9.20 item 6) was root-caused, fixed and live-proved in **§9.21** as **D243/D244** — it was never about the profile. Duo's WebAuthn counter is per CREDENTIAL and Duo Autopilot's copy is per BROWSER PROFILE, so a cold profile's import stamp jumped the shared counter to `now` while every warm profile crept by `+ 1` and could never catch up; one behind-counter assertion is then refused as a cloned key AND burns that profile's Duo device binding permanently, which is both the 60 s wedge and the reason deleting the directory was the only remediation anyone found. Bisected one variable in both directions on the same profile (stored counter 1 063 behind → **60.01 s** refused, no `PS_TOKEN`; the same state with the wall-clock floor → presented 1787193576 and **`logged-in` in 17.83 s**), and the runtime now refuses on Duo's own rendered refusal in **9.52 s** naming the real cause instead of burning the bound and blaming Duo hand-approval. Pinned by `tests/unit/duo-sign-count.test.ts` (the load-bearing case is a two-profile simulation) and two arms in `tests/unit/system-login-recipes.test.ts`, both verified RED pre-fix. §9.20 item 7's unrelated cold-profile New Kronos observation stays open and is a different finding
- [x] **§2.6 confirmed and ratified: D194 recorded in ref task-contract §2.8, pointer in ref decisions round 48, ref stores §1 updated** (2026-08-12) — every new read task this migration authors is authored under it

---

## 7. Open items that are NOT for this questionnaire

- **The controlled-commit target.** A UCPath termination and a Kuali finalization the operator approves. None is invented here; naming one is operator work at doc 03c §Phase summary step 5 (the *shape* of that choice is §4f2). **Two facts narrow the choice as of 2026-08-14 (§9.16):** doc 4524 is out (its action completed and its form no longer renders), and `clear-pending`'s COMMITTED arm has no live subject at all — deleting `T002209631` removed the only mapped subject holding a pending row.
- **Two UCPath facts that need one real submit** (ref write-safety §13 item 6): whether the confirmation dialog renders the `T…` inline, and the propagation window between submit and searchability. Both are currently **ported legacy knowledge**, not rebuild-verified.
- **`recoveryAbsence` for the UCPath termination.** Until a propagation window is measured, a post-fence absence is `operator-only`; inventing a `minSinceFenceMs` is the banned unverified constant (D128's standing rule).
- **The re-run wall's item 2 — a way for an operator to say "read it again" — is BUILT** (2026-08-14,
  §9.13 / D211): `separations`' ingress carries an explicit `reRead: {ordinal, reason}`, so a re-read
  is a NEW logical item with fresh checkpoints and its own gate, and it changes no permanent key.
  Item 1 was closed earlier by **D199**. The general platform shape — an operator affordance on any
  read workflow rather than one workflow's ingress field — is still unbuilt and still worth having.
- **The behavior review's own `unknown — needs live observation` list** (`separations-legacy-behavior.md` §5) — seven items the legacy source cannot answer. Three of them are already routed into decisions above (the Kuali dropdown option list → §4a, whose answer **schedules that capture into the `separations-kuali-read` chunk** as the first instance of §3.2's MAP-EVERYTHING directive; whether an abandoned Kuali draft discards its edits → moot under item 4's draft; whether a "successful" save persisted → settled by §4e). **§4e adds one to the list:** whether the finalization fields all belong to ONE workflow step's section — if not, one save cannot carry them and the node splits, which is a first-live-dry-run finding. The remaining four are live-observation work at build time, not questionnaire answers: whether UCPath auto-redirects for an already-terminated single-record employee (**S22** — the case where the all-terminated guard never runs), the SS Smart HR *search* results-grid scan (live-verified only for the in-progress grid), whether filling the Kuali department first survives the later timekeeper and date writes, and whether `T002173685` has been reversed and student `10833507` ever separated.

---

## 8. Cross-references
| Document | What it owns, relative to this doc |
|---|---|
| `docs/migrations/separations-legacy-behavior.md` | The traced legacy account: the happy path end to end, the **S1–S63 scenario table** (§2), per-scenario detail with source quotations (§3), the eleven dangerous patterns (§4), and the `unknown — needs live observation` list (§5). Every S-number cited above resolves there. |
| `ref stores` | The derived catalog of what every store has today — §1 "How stores work" (the REUSE/CUSTOMIZE/BUILD rule that §2.6's convention would amend), §2 per-store tables, §3 the two shipped workflows' consumption, §4 the gaps this migration closes. Code wins over that file wherever they disagree. |
| `docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md` | §3.1 the Phase-3 entry block, §3.2 exit criteria (§6 above), §3.3 the migration order, **§3.4 the questionnaire template §5 above instantiates**. |
| `docs/rebuild/reference/write-safety.md` | §2 completion arms, §4/§4.1 recovery and operator resolutions, §5 probe policy, §12 the worked two-transaction separations example, §13 the beat structure, **§14 the ALWAYS-GATE** (and §14.7's two values left to this questionnaire). |
| `docs/rebuild/reference/decisions.md` | The decision index — **D193** (separations as the Phase-3 entry) and, if §2.6 is confirmed, **D194**. A pointer index only; never implement from it. |

---

## 9. The mapping appendix — everything each chunk observed live (§3.2 MAP EVERYTHING)

One section per chunk, appended as the chunk is built. Every entry carries its live-observation date
the way a selector does. Captures are **read-only** page observations, standing pre-authorized by the
charter's live-verification clause.

### 9.1 Chunk 1 — New Kronos (UKG Dimensions / WFD), observed 2026-08-12

Read-only, Duo cleared hands-off by Duo Autopilot. Subject: EID `10776990`, window
`06/01/2026`–`08/12/2026`, plus a nonexistent EID (`99999999`) and a common-surname search
(`Nguyen`) to map the negative and multi-result shapes.

**Authentication chain.** Entry `https://ucsd-sso.prd.mykronos.com/wfd/home` redirects to
`https://cust01-prd07-ath01.prd.mykronos.com/authn/XUI/?realm=ucsd_prd_01&service=30847CustomerIDPChain&goto=…`
— **ForgeRock, not TritON**. Heading `Signing on using: Active Directory`. **No login-type picker**
(CRM's realm hazard cannot occur here). Fields are the standard UCSD ones: `input#ssousername`
(`name="urn:mace:ucsd.edu:sso:username"`), `input#ssopassword`, submit
`button[name="_eventId_proceed"]` labelled `Login`. Duo at `api-*.duosecurity.com`. Landing
`…/wfd/home`, title `Home`.

**Measured timings.** Entry → SSO form ≈ 1.5 s · credential submit → landing **3.32 s** ·
browser launch → home ≈ 33 s · Go To → Timecard **6.2 s** · Apply → grid repaint **6.1 s** ·
genuine no-results sentinel **548 ms**.

**Session artifacts** (application host `ucsd-sso.prd.mykronos.com`): `kronosAuthToken`,
`securityToken`, `widgetToken`, `falconAuthCookie`, `ssologin`, `_csrf`, `kronosCookie`, `allTokens`.
(Domain `.prd.mykronos.com`: `AUTHN_TOKEN` — an RS256 JWT whose `sub` is the signed-in person number
— plus `AUTHZ_TOKEN`, `TENANT_AUTHORIZATION`, `authn_ssid`, `VANITY_URL`.)

**Render contexts.** The Employee Search panel renders in **two** places: inside
`iframe[name^="portal-frame-"]` on a fresh home load (suffix is session-scoped —
`portal-frame-172554836363` and `portal-frame-227531434843` observed minutes apart), and **top-level**
after a timecard navigation, where the page has **no named frames at all**.

**Employee Search panel structure.** `heading "Employee Search" [level=1]` ·
`textbox "Search by Employee Name or ID"` · `button "Search"` (disabled until non-empty) ·
`button "Clear Search"` · `button "Advanced Settings"` · `button "Cancel"` ·
`button "Employee Search Close"`. Enter in the textbox submits.

**Search-results structure.** `button "Show Search Results for \"<query>\""` +
`generic: Results for "<query>"` (collapsed search) · two `p.totals-counter` paragraphs rendering
`Total [N]` and `Selected [N]` · a `menu` whose children are one `menuitemradio` per result, each
carrying `aria-label="Name <name> ID <eid>"` and containing `checkbox "Select Item"` and
`button "Name <name> ID <eid>"` · a live region `Search results: N items`. **No results**: the text
`There are no items to display.`, zero slats, and **no** `.totals-counter` paragraphs at all.
Multi-result observed: `Nguyen` → `Total [12]`, 12 slats.

**Go To.** `#goToDropdownButton`, exactly one node in whichever context hosts the panel;
`ng-disabled` until a slat is selected (verified moving `Selected [0]` → `Selected [1]`).
**Complete option list: `Timecard`, `Schedule`, `People`, `Reports`** (role=option, panel context
only). Timecard lands on `https://ucsd-sso.prd.mykronos.com/timekeeping#/timecard`.

**Timecard identity.** `.emp-nav-id` (exactly one) = the EID · `#combo_inptxt`
(`input[role=combobox]`, `title`/`aria-label`/value) = the displayed name, `"Last, First M"`. The
surrounding chrome is `.emp-nav-visible` › `.emp-nav-wrapper` › `.emp-nav-list` /
`.emp-nav-info-btn-group`.

**Pay-period control.** Trigger `button.select-timeframe-button` (icon-only,
`aria-labelledby="quickFindTimeFrameSelectorLabel _timeFrame"`) — exactly one. Label `#_timeFrame`
(class `selected-timeframe`) — exactly one, and **also a button**, which is why legacy's name-regex
recipe matched two nodes and `.first()` was masking it.
**Complete pay-period option list (24):** Previous Pay Period · Current Pay Period · Next Pay Period ·
Previous Schedule Period · Current Schedule Period · Next Schedule Period · Next Schedule Period + 1 ·
Next Schedule Period + 2 · Today · Yesterday · Tomorrow · Week to Date · Month to Date · Last Week ·
Yesterday, Today, Tomorrow · Yesterday Plus 6 Days · Yesterday Minus 13 Days · Last 7 Days ·
Last 30 Days · Current Week · Last 4 Weeks · Last 3 Months · Last 90 Days · Last 4 Quarters. Plus
`button "Select range"`.

**Custom range.** `#startDateTimeInput` / `#endDateTimeInput`, both
`ng-attr-type="{{rangeInput.useNativeDateInput ? 'date' : 'text'}}"` — observed in **text** mode,
rendering values with inconsistent padding (`08/12/2026` beside `6/01/2026`). `button "Apply"`
(`.btn.btn-primary`). After Apply the period label reads back the applied window
(`6/01/2026 - 8/12/2026`), which is what makes S40 a value comparison. **`fill()` is silently
reverted by the Angular digest** (6 samples over 2.4 s all read the pre-fill value); **real
keystrokes stick** (5 samples over 2 s).

**Timecard grid.** Two `.ui-grid-viewport`s. Pinned columns `. · . · Date`; data columns
`Schedule · In · Out · Transfer · Pay code · Amount · Shift · Daily · Period · Absence` (read from
`.ui-grid-header-cell`; header text carries a sort-order suffix, `"In 1"`). Rows are `[role=row]`
with `[role=gridcell]`. **The grid is VIRTUALIZED**: the 73-day window rendered **51** date rows at
`scrollTop: 0` (06/01 … 07/20); scrolling the pinned viewport in `clientHeight × 0.8` steps and
accumulating yielded all **73** days in **9** steps. One calendar day can own multiple data rows and
the date cell renders once, so the date carries forward.

**Pay codes observed in one 73-day window:** `Holiday - Hourly` (amount `4.00`),
`Juneteenth Observed` (`0.00`), `Independence Day Observed` (`0.00`). **Only the first matches the
ported `/holiday/i` rule** — see the open item below. No sick rows were present.

**Statuses/branches encountered:** search → `resolved` | `no-match` | `no-results` | `no-signal`;
timecard → loaded-and-identifiable, window-applied, and the empty-window case (the subject's current
pay period 08/02–08/15 carried zero populated rows, which is S38's real outcome).

**Open item for the operator — the unrecognised holiday pay codes.** `Juneteenth Observed` and
`Independence Day Observed` are real holiday days that the ported classifier does not count, and one
of them (07/03) fell **after** the last counted holiday. Since the separation date is
`max(LDW, last sick, last holiday)`, counting them would move a real termination's effective date.
The chunk-1 behaviour is deliberately **legacy-identical plus visible**: the two regexes are ported
verbatim and every unmatched pay code is surfaced as `unclassifiedPayCodes` rather than dropped.
Options are recorded in the return of the chunk-1 build; nothing is decided here.

`ANSWER (operator), 2026-08-13` — **option A: KEEP LEGACY-IDENTICAL. The zero-hour "Observed"
holiday codes do NOT count toward the separation date.** `Juneteenth Observed` and
`Independence Day Observed` (both amount `0.00`) stay **unclassified and surfaced** in
`unclassifiedPayCodes`; the `/holiday/i` classifier is **not** changed and no zero-amount rule is
added. So `max(LDW, last sick, last holiday)` keeps computing exactly what legacy computes, and the
07/03 row that falls after the last counted holiday does **not** move a real termination's effective
date. The item is closed as **policy**, which is what it always was — chunk 6 composes the date logic
against a decided rule rather than an open question, and the surfaced codes remain the operator's
visibility into every day the rule declined to count.

---

### 9.2 Chunk 1 — the live proof: **MET at attempt 17** (2026-08-12/13)

**Status: CLOSED.** Doc 03c §Phase summary step 4 for chunk 1 is **MET**. Run **`sk-171645-4adf`**
(`4adf2efb-c433-422e-8e89-d7836da59a1f`), EID `10776990` / *Kou, Nathan* over `06/10/2026 –
08/12/2026` (64 days), reached terminal **`done`** against real WFD with a complete, correctly-bound
grid read. The full attempt record — including the two runs that closed it and the tenth defect the
first of them exposed — is in **§9.2a** below; everything from "Honest status" down is the record as
it stood at attempt 14, kept verbatim because the defects it names are the reason the rules exist.

**Measured, run `sk-171645-4adf`** (enqueue `00:16:51.197Z` → terminal `00:17:30.816Z`, **39.6 s**
end to end): `search` checkpoint at `00:17:22.951Z` (**31.8 s**, including a cold browser launch and
the whole SSO + Duo chain), `timecard` checkpoint at `00:17:30.813Z` (**7.9 s** for Go To → subject
proof → range apply → the whole virtualized grid read). The grid: **67 days covered** over a 64-day
window (WFD's pay-period overhang), **1 scroll step**, `columnHeaders`
`Schedule · In · Out · Transfer · Pay code · Amount · Shift · Daily · Period · Absence`,
`lastPunchDate 06/12/2026`, `punchDates ["06/12/2026"]`, `holidayDates ["06/19/2026"]`,
`payCodeDays` `Holiday - Hourly 4.00` · `Juneteenth Observed 0.00` (06/19) ·
`Independence Day Observed 0.00` (07/03), `unclassifiedPayCodes`
`["Independence Day Observed", "Juneteenth Observed"]`. **Those three pay codes are exactly the three
§9.1 recorded from an independent read-only probe of the same EID on 2026-08-12** — which is what
proves the cell binding, not just the day coverage.

---

### 9.2a Chunk 1 — the attempt record (14 failures, then two runs that closed it)

**Honest status *as of attempt 14*.** Doc 03c §Phase summary step 4 (the live dry-run for this chunk) was
**NOT MET**. The
`separations-kronos-timecard` workflow was started against the real system thirteen times through
the real start-plan → command → worker path. **The search half is proved live** — `search` reached
`observed-this-attempt` with a durable checkpoint on runs `sk-123940-ab25`, `sk-125031-54c5`,
`sk-125229-f0c8`, `sk-125512-8fa6` (attempt 1) and `sk-131627-4ca5`. **The timecard half has never
produced a terminal `done`.** No run reached a terminal result, so this chunk has **no evidence
receipt over real data** and the exit criterion stays open.

**What the lane was worth anyway.** Every attempt failed for a DIFFERENT, real reason, and each one
was green on `typecheck`, `lint`, `test:coverage`, `test:architecture` and every scenario. Seven
defects were found and fixed that no fixture could reach; they are recorded in commit
`fix(kronos): six defects the live lane found, and the rules they settle` and, as rules, in ref task-contract
§2.9 and `src/stores/new-kronos/CLAUDE.md`. In order observed:

| Run | Failure | Root cause |
|---|---|---|
| `sk-123452-7b1e` | login refused an authenticating session | `kronosAuthToken` is issued by the WFD app AFTER the URL lands; the probe sampled once |
| `sk-123704-7551` | `Employee Search` button resolved to 0 nodes | `exactlyOne` sampled a client-rendered SPA once |
| `sk-123940-ab25` | timecard step found no query field | the panel collapses to `Show Search` after a search; the context probe used the wrong anchor |
| `sk-124132-9beb` | Go To disabled on an empty panel | the search node was `replay:"checkpoint"`, restoring a VALUE into a browser with no page state |
| `sk-124821-5956` | `employee-not-found` for an employee that exists | WFD renders its empty-grid sentinel while the search is still resolving |
| `sk-125031-54c5` | no Go To control at all | a task may not inherit page state from the previous task — the worker re-verifies the session between leases |
| `sk-125229-f0c8` | `ReferenceError: __name is not defined` | esbuild's `keepNames` helper leaked into a `page.evaluate` callback |
| `sk-131627-4ca5` | `8/13 falls outside the requested range … refusing to guess the year` | **the deepest one** — see below |

**The last attempt is the most informative, and its fix is TEST-PINNED, NOT LIVE-VERIFIED.**
`sk-131627-4ca5` ran the whole path — login, panel, search, selection, Go To, timecard, subject
proof, custom-range apply, virtualized-grid read — and then correctly REFUSED, because the grid
carried a row for `8/13` while the run had asked for `06/07/2026 - 08/12/2026`. That is not
corruption: **WFD renders whole PAY PERIODS**, so a window ending mid-period still paints rows to the
period's end (here 08/15). The fold now resolves each grid row's year against the applied window
WIDENED by one pay period on each side — keeping S41's "exactly one candidate year, never a guess" —
and then DISCARDS the rows that fall outside the window the run asked for. It is covered by unit
tests built from the exact observed shape, and it has **not** been through a live run.

**The two remaining failures were environmental, not defects.** `sk-125420-dc59` and
`sk-125512-8fa6` (attempt 2) failed at `duo-clearance` / `navigate-login-entry` with `about:blank`
after thirteen cold-profile Duo ceremonies in roughly twenty minutes; the SSO chain returned to the
ForgeRock login page rather than the application.

**Two platform findings this chunk did not fix, recorded for whoever owns them.**

1. **A crashed worker wedges its own worker id.** `claimNext` refuses when the worker already owns a
   run in `claimed`/`validating`/`running`, and the D118 claim sweeper lives inside the loop that
   cannot start — so a worker that dies mid-run can never claim again. It was cleared each time by
   starting a DIFFERENT workflow's worker (whose sweeper requeues across workflows) or by a
   `run/cancel` command. A worker that cannot recover its own wedge is an operability gap.
2. **An `always-rerun` node re-writes its checkpoint, so a second run under the same identity fails
   when the observation moved.** Re-running the same EID + window produced
   `run checkpoint … already exists with different content`. Arguably correct — the identity is the
   same and the observation differs — but it means a proving harness cannot simply be re-run, and
   the proof runs above had to vary the window by a day each time to get a fresh item id.

**What is required to close this.** One clean live run on a rested session: the fix for the
pay-period overhang is the only untested code left on the path, and every earlier failure has been
fixed and re-proved past. The measured leg timings are in §9.1.

**Attempt 14 (2026-08-12, from chunk 3's session — one bounded attempt, still NOT MET).** Run
`sk-162032-45bb` (`45bb354b-2ed4-4225-8808-13a5bd690740`), EID `10001754` over a fresh window
`07/06/2026 – 08/09/2026` (varied again for the always-rerun identity quirk). The search half passed
for the sixth time — `search` reached `observed-this-attempt` with a durable checkpoint at
`23:21:11.812Z` — and the timecard half failed on a **NEW, ninth** mode, distinct from all eight
above and from the pay-period overhang that attempt 13 fixed:

> `[new-kronos] timecard grid read covers 14 of 35 days in 07/06/2026 - 08/09/2026 — missing
> 07/06/2026 … and 19 more — the virtualized grid was not scrolled to the end; refusing to derive a
> last punch from a partial read`

The refusal is CORRECT and is the whole point of that check — a last punch derived from 14 of 35 days
would be a plausible-but-wrong separation date. What it says about the chunk is that the virtualized
grid's scroll-to-end is not yet reliable over a five-week window; the durable failure fingerprint
`53336e1c` records `seen 6×`, so this is a recurring class rather than a one-off. Doc 03c §Phase summary step 4
for chunk 1 stayed **OPEN** after this attempt, and the next one owed the scroll loop rather than
another window.

**Attempts 15–17 (2026-08-13) — the scroll loop, then the tenth defect it uncovered (D205).**

**Root cause of the ninth mode.** ui-grid renders the pinned date column and the body columns as
SEPARATE `.ui-grid-viewport` elements, and only the body's scroll drives virtualization — the pinned
one is synced *from* it. The loop wrote `scrollTop` to `viewports[0]`, the pinned column, so the
position moved (or clamped at zero) while the rendered row set never changed, and the loop then
stopped because `scrollTop` "refused to advance". That was a TRUE statement about the wrong widget,
and it was reported as a whole read. The fix drives every viewport and reports geometry from the
BODY one — and, more importantly, stops terminating on the scrollbar at all: the loop now terminates
on `timecardRangeCoverage`, the same invariant `assertTimecardCoversRange` refuses on, and REFUSES
with days-seen against days-expected when it cannot reach it. The algorithm moved out of the
`page.evaluate` closure into `src/stores/new-kronos/driver/grid-scroll.ts` so a fake virtualized grid
can execute it; `tests/unit/new-kronos-grid-scroll.test.ts` pins the whole-window read, the refusal,
and the bounded give-up on a wedged grid.

| Attempt | Run | Window | Outcome |
|---|---|---|---|
| 15 | `sk-171126-e5f4` | `07/13/2026 – 08/11/2026`, EID 10001754 | **`done`** in 43.2 s — first terminal timecard read this chunk has ever produced. 34 days covered, but `populatedRows: 0` and every derived date `null` |
| 16 | `sk-171330-f394` | `06/08/2026 – 08/12/2026`, EID 10776990 | **`done`** in 46.5 s, 69 days, 67 populated rows — **and its values were wrong**, which is how the tenth defect was found |
| 17 | `sk-171645-4adf` | `06/10/2026 – 08/12/2026`, EID 10776990 | **`done`** in 39.6 s, 67 days, correct values matching §9.1's independent probe — **the proof** |

**The tenth defect: the column binding was off by one, and only a grid read that REACHED the fold
could show it.** Attempt 16 returned `payCode: "4.00"` with `amount: ""` and
`unclassifiedPayCodes: ["0.00", "4.00"]`. Nothing threw. The cause: the header row was read
`document`-wide from `.ui-grid-header-cell`, which also matches the PINNED container's header, and
live that leaves `Date` surviving the blank/`.` filter at index 0 — while `cells` come from a body
row, which has no date cell. Every resolved index was therefore one too high: `In` read the Out
column, `Pay code` read Amount, `Amount` read Shift. **"Columns bind by header name" was supposed to
make this impossible and did not**, because the names were read from a WIDER element set than the
cells: the mapping was internally consistent and externally wrong. Headers are now read from the
data viewport's own `.ui-grid-render-container` alone, and a cell-count/header-count disagreement is
its own loud refusal — the cheap invariant that catches this class rather than this instance.

Attempt 15's nulls were honest either way (that subject has no punches in that window, and every
shifted column was empty too), and attempt 16's checkpoint is LEFT in authority holding its shifted
values: it is durable evidence of the defect, not corruption, and insert-only authority is not
rewritten to make history tidier.

**What the coverage refusal is worth, measured.** Both closing runs needed exactly **one** scroll
step, so the loop's many-step path is exercised by the fixture rather than live. The invariant is
what carries the guarantee: a read that had not reached the end of the grid could not have returned
at all.

---

### 9.3 Chunk 2 — Kuali RRSS Separation Request Form, observed 2026-08-12

Read-only, one session, Duo cleared hands-off by Duo Autopilot. Subjects: the operator's **entire
Action List** — three real separation documents, **4510** (action `6a7a33b2ac106d428b3217e0`, step
*Task 1 - Jan*, fully processed), **4502** (`6a766ae6f0549046f7f0dc06`, same step, unprocessed) and
**4495** (`6a73abda824c9a5388e0ceaa`, step *Task 1 - Kristina & TES*, partly processed).

**Entry and enumeration.** The space URL `…/build/space/5e47518b90adda9474c14adb` →
`menuitem "Action List"` → `…/actions`. The Action List is a `table` whose columns are
**Document Type · Document # · Document Title · Submitted By · Workflow Step · Created On · Action
Requested**, and every cell in a row links to the same `…/actions/<actionId>` deep link. **The
document TYPE is a column** — all three rows read `RRSS Separation Request Form` — so the Action
List itself can answer S2 before a document is opened. Search chrome: `textbox "Search"` +
`button "GO"`.

**Client-side paint, measured.** On an in-app route change: no level-1 headings at ~7 ms; at
~258 ms `["Action List", "", "Action"]` — the document heading present and EMPTY; at **~1.77 s** the
real number, the `Form - … - Kuali` title and the form controls together. (A cold open measured
~3.0 s on 2026-08-04.) This is the same three-stage shape D128 recorded and the reason the heading
recipe matches on the VALUE's shape rather than on position.

**The form-type proof (S2).** `document.title` is `Form - <form name> - Kuali` — here
`Form - RRSS Separation Request Form - Kuali`. It is the only unambiguous read of the form's name on
the page: the same string also renders as a link in the space's app list and in every Action-List
row, so a page-wide text match resolves several nodes on a page that is not even showing a document.

**Document chrome.** `heading "<number>" [level=1]` · a submitted stamp
(`Submitted Aug 10, 2026 · 1:25 PM`) · a status chip (`In Progress` on all three) ·
`button "Workflow Status"` · an instructions block (`PLEASE REVIEW AND COMPLETE CHECKLIST - Task 1`)
· `Submitted By`. The stamp, chip and instructions are **observed but NOT read** — they have no
stable role-addressable anchor, and publishing a recipe this chunk could not count at exactly one
node would be fabricated verification.

**Sections.** `heading "Employee Information" [level=2]` → `heading "Tasks" [level=2]` →
`heading "Timekeeper Tasks - Step 1" [level=3]` → `heading "Final Transactions" [level=4]`. Action
bar: `Send Back` · `Save` · `Mark Complete`, exactly one each — unchanged from 2026-08-04.

**Every control, with its exact live accessible name.** All eighteen counted at **exactly one node**
on the live tree.

| Accessible name | Role | Legacy key | Disposition |
|---|---|---|---|
| `Division*` | combobox | — | driver-internal (no legacy key) |
| `Type of Termination*` | combobox | `separationForm.terminationType()` | ported |
| `Location*` | textbox | `separationForm.location()` | ported, **name corrected** |
| `Employee Type*` | combobox | — | driver-internal |
| `Student Title Code*` | combobox | — | driver-internal |
| `Employee Last Name, First Name*` | textbox | `separationForm.employeeName()` | ported |
| `EID*` | textbox | `separationForm.eid()` | already ported (2026-08-04) |
| `Last Day Worked*` | textbox | `separationForm.lastDayWorked()` | ported |
| `Separation Date (Last day actively employed)*` | textbox | `separationForm.separationDate()` | ported, **narrowed** |
| `Additional Separation Comments (Optional)` | textbox | — | driver-internal |
| `Request Acknowledged - In Progress` | checkbox | `timekeeperTasks.requestAcknowledgedCheckbox()` | ported |
| `Timekeeper Name:*` | textbox | `timekeeperTasks.timekeeperName()` | already ported (2026-08-04) |
| `Termination Effective Date*` | textbox | `finalTransactions.terminationEffDate()` | ported |
| `Department*` | combobox | `finalTransactions.department()` | ported |
| `Payroll Title Code*` | textbox | `finalTransactions.payrollTitleCode()` | ported |
| `Payroll Title*` | textbox | `finalTransactions.payrollTitle()` | ported |
| `Submitted Termination Template` | checkbox | `transactionResults.submittedTemplateCheckbox()` | ported |
| `Transaction Number:*` | textbox | `transactionResults.transactionNumber()` | ported |
| `Does not need Final Pay (student employee)` | radio | `transactionResults.doesNotNeedFinalPayRadio()` | ported |
| `Submitted Final Pay Request` · `Does not need Final Pay (transfer employee)` · `Other` | radio | — | driver-internal |
| `Timekeeper/Approver Comments:` | textbox | `timekeeperTasks.timekeeperComments()` | ported |

Group labels observed beside the controls: `Timekeeper Acknowledgement:*`, `UCPath Transactions*`
(which also carries a link to the UCPath Termination Template), `Final Pay Transactions*`.

**S13 is a BROKEN SELECTOR, not an optional field.** Legacy asks for the accessible name
`"Location  *"` — a space before the asterisk — and the live name is `"Location*"` with none, so its
recipe matched **zero nodes on every document**. Its `catch { location = "" }` then reported that as
an absent optional field. Legacy has never once read this field; all three live documents have it
populated, and it is marked required.

---

#### The §4a deliverable — the COMPLETE `Type of Termination` option list

Captured verbatim from all three documents at two different workflow steps. **All three served the
identical 17-option list** (16 real options plus Kuali's `- - -` blank sentinel), so the list is
document- and step-independent and the map can be exhaustive.

| # | Option (verbatim) | Classification | UCPath template | UCPath reason code |
|---|---|---|---|---|
| 0 | `- - -` | — | — | **REFUSES** — `blank-termination-type`; the form is unset |
| 1 | `Accepted Another Job` | voluntary | `UC_VOL_TERM` | `Resign - Accept Another Job` |
| 2 | `Attend School` | voluntary | `UC_VOL_TERM` | `Resign - Attend School` |
| 3 | `Dissatisfied w/Job` | voluntary | `UC_VOL_TERM` | `Resign - Dissatisfied w/ Job` |
| 4 | `Look for Another Job` | voluntary | `UC_VOL_TERM` | `Resign - Look For Another Job` |
| 5 | `Military Service` | voluntary | `UC_VOL_TERM` | `Resign - Military Service` |
| 6 | `Move out of Area` | voluntary | `UC_VOL_TERM` | `Resign - Moved out of Area` |
| 7 | `Never Started Employment` | involuntary | `UC_INVOL_TERM` | `NSE` — **operator-approved 2026-08-13** on chunk 4's live UCPath capture (§9.7); was `REFUSES` |
| 8 | `No Reason Given` | voluntary | `UC_VOL_TERM` | `Resign - No Reason Given` |
| 9 | `Personal Reasons` | voluntary | `UC_VOL_TERM` | `Resign - Personal Reasons` |
| 10 | `Quit without Notice` | voluntary | `UC_VOL_TERM` | `Resign - Quit Without Notice` |
| 11 | `Retirement` | voluntary | `UC_VOL_TERM` | `Voluntary Separation Program` |
| 12 | `Self-Employment` | voluntary | `UC_VOL_TERM` | `Resign - Self Employment` |
| 13 | `Transferring to a different UCSD department (outside of RRSS)` | voluntary | `UC_VOL_TERM` | `Transfer - Intra Location` |
| 14 | `Transferring to another UC Campus (outside of UCSD)` | voluntary | `UC_VOL_TERM` | `Interlocation (BU) Transfer` |
| 15 | `Graduated/No longer a Student` | involuntary | `UC_INVOL_TERM` | `No Longer Student` |
| 16 | `Appointment Expired` | involuntary | `UC_INVOL_TERM` | `Appointment Expired` |

Seeded in `src/domain/separations/termination-type.ts`; `auditTerminationTypeMapCoverage` proves the
map and the capture agree **in both directions**, and every run compares the option list it actually
observed against this capture (`termination-type-options-drifted`), so §4a's accepted operational
cost fires on the first run that stands in front of a changed control rather than on the first run
that happens to select a new option — a pure REORDER counts, because it means the control was
republished.

**Three findings from comparing the capture with legacy's map.**

1. **`Death` is not an option on this form at all.** §4a's worked example — `Death` filed as a
   voluntary `Resign - No Reason Given` — cannot arise from this dropdown. The hazard was real in
   shape and absent in fact.
2. **`Never Started Employment` is genuinely unmapped, and legacy misfiles it.** It is in legacy's
   three-entry `INVOLUNTARY_TYPES` but NOT in its fifteen-entry `REASON_CODE_MAP`, and no fuzzy tier
   matches it (checked: no map key is a substring of it or vice versa) — so legacy files
   `UC_INVOL_TERM` with the **voluntary** default `Resign - No Reason Given`. UCPath's own INVOL_TERM
   list does carry a `Never Started Employment` reason code (per legacy's comment block), but that
   pairing has never been verified against the live UCPath control by this repository and §4a forbids
   inventing one. **This is an OPERATOR ITEM** — see the chunk-2 return.
   **CLOSED 2026-08-13.** Chunk 4 captured the live `UC_INVOL_TERM` reason list off the real UCPath
   control (§9.7) and it contains `NSE` = *"Never Started Employment"*. The pairing is therefore an
   observation, not an invention, and the operator approved it the same day (§4a's 2026-08-13
   addendum). Row 7 above is now `UC_INVOL_TERM` / `NSE`. Legacy's misfiling is unchanged and stays a
   legacy defect: it files that same involuntary template with the **voluntary** default reason.
3. **The fuzzy tier's damage on the LIVE option set is exactly one option.** Every other captured
   option has an exact map entry, so legacy's substring tier is only reachable for
   `Never Started Employment` today. That does not make it safe — it makes it a latent trap that
   fires the day Kuali adds an option — but it is the honest scope of the live exposure.
4. **`Retirement` IS mapped** (`Voluntary Separation Program`), so §4f4's "retiree" case is not an
   unmapped type. Rehire, deceased and LOA are not options on this form at all.

---

#### Every other dropdown, captured whole (§3.2)

**`Division*` (18 incl. sentinel):** `- - -` · Building and Custodial Services · Campus Dining and
Retail · Conference Services · Early Childhood Education Center · Facilities and Building Services ·
Finance, Marketing and Communication · Human Resources · Logistics · Marketing & Client Experience ·
Payables, Travel and Campus Partnerships · Residential Services and Child Care Solutions ·
Residential Services · Retail, Procurement and Partnership · Strategic Procurement · Technology
Program Management · Triton Print & Digital Media · UC San Diego Bookstore.

**`Employee Type*` (5):** `- - -` · Career/Contract · Limited · Student ·
Contingent Worker (volunteer).

**`Student Title Code*` (6):** `- - -` · 4921 - STDT 2 · 4920 - STDT 3 · 4919 - STDT 4 ·
4331 - ELECTED OFCR STDT GOVT · 4944 - STDT RSDNC HALLS.

**`Department*` (6) — the S55 list:** `- - -` · 000141 - Early Childhood Education Center ·
000412 - Housing/Dining/Hospitality · 000414 - Bookstore · 000422 - Triton Print & Digital Media ·
000719 - Supply Chain Services. Note the option text is `<6-digit code> - <description>`, so S55's
"code-match tier first" has a code to match on directly.

**`Final Pay Transactions*` (4 radios, no sentinel):** `Submitted Final Pay Request` ·
`Does not need Final Pay (student employee)` · `Does not need Final Pay (transfer employee)` ·
`Other`. §4g ratified the second as an unconditional business assertion; the read returns which one
the document already carries, and doc 4510 carried exactly that one while 4502 and 4495 carried none.

---

#### States, values and shapes the three documents encountered

| Fact | 4510 | 4502 | 4495 |
|---|---|---|---|
| Workflow step | Task 1 - Jan | Task 1 - Jan | Task 1 - Kristina & TES |
| Type of Termination | Graduated/No longer a Student | Appointment Expired | Appointment Expired |
| Last Day Worked / Separation Date | 06/10/2026 both | 03/31/2026 both | **09/02/2026** both |
| Timekeeper Name | populated | **blank** | populated |
| Request Acknowledged | checked | **unchecked** | checked |
| Termination Effective Date | 06/11/2026 | **blank** | **blank** |
| Department | 000412 - HDH | **`- - -`** | 000412 - HDH |
| Payroll Title Code / Title | 004921 / STDT 2 | **blank / blank** | 004920 / STDT 3 |
| Submitted Termination Template | checked | **unchecked** | **unchecked** |
| Transaction Number | T002209631 | **blank** | **blank** |
| Final Pay radio | student employee | **none selected** | **none selected** |
| Timekeeper/Approver Comments | blank | populated | blank |

**This table is why the absent arms exist.** An unprocessed separation document is blank in five
fields and sits on the blank sentinel in a sixth; a rich read without explicit absent arms would fail
every document the department has not yet worked. Two shape notes: values arrive
whitespace-padded (`"Clisea, Fleina "`, `"Hospitality Information "`), and **doc 4495's dates are in
the FUTURE** relative to the read — a department legitimately files a separation in advance, so the
read reports the parsed date and S7's refusal stays a precondition of *filing a termination*, not of
*reading a form*.

---

### 9.4 Chunk 2 — the live proof: **PASSED**, five runs, 2026-08-12

Doc 03c §Phase summary step 4 (the live dry-run for this chunk) is **MET**. Five runs were started through the
real start-plan → command → worker path against the real Kuali production space; **all five reached
terminal `done` on attempt 1**, and the last three held `verified` evidence receipts over real data
at settlement. Two later attempts to re-prove the same three documents against the final tree
**failed for a platform reason, not a chunk reason** — see *The re-run wall* below.

| Trace | Document | Result | `document` node | Queued → terminal |
|---|---|---|---|---|
| `sd-140241-ca44` | 4510 (processed) | done (receipt frozen, see below) | 26.90 s | 32.95 s |
| `sd-140505-28ff` | 4502 (unprocessed) | done (receipt frozen, see below) | 5.37 s | 6.43 s |
| `sd-140917-2b9e` | 4510 | **done, receipt `verified`** | — | 8.68 s |
| `sd-140921-3385` | 4502 | **done, receipt `verified`** | — | 5.01 s |
| `sd-140921-c0af` | 4495 (future-dated) | **done, receipt `verified`** | 5.64 s | 10.59 s |

**Measured legs.** Browser launch + Kuali login (cold profile, Duo cleared hands-off) → session ready
**23.5 s**; the whole-form read on top of a ready session **3.42 s**; a warm-profile document node
end to end **5.4–5.6 s**; the pure `termination-type` fold **2 ms**. The read is one navigation and
~20 control reads, and it costs about as much as a single Kuali document open — which is the
argument for reading the whole surface while standing on the page.

**What the live lane proved that no fixture could.** The receipt for doc 4502 carried every absent
arm as durable evidence with its reason (`Department` on the `- - -` sentinel, blank transaction
number, no Final Pay radio selected), and the complete 17-option `Type of Termination` list travelled
into the receipt as a fact of that run. Doc 4495 proved a future-dated separation reads cleanly.

**What the live lane CAUGHT — one real defect, on the first receipt.** The separation read's person
fields were declared `direct-identifier` on every arm leaf, so `last4` ran over the arm
DISCRIMINATOR: the receipt an operator would read said `employee.name.state = "sent"` (the last four
characters of `"present"`) and `employee.name.reason = "alue"`. That is not redaction; it is a
receipt stating something false. Only the `value` leaf is the identifier. Fixed, and the general
rule is recorded as D197.

**Its honest cost, recorded rather than hidden.** An evidence-classification change moves receipt
BYTES for every already-settled run, and D82's `evidenceReceipts.insert` correctly refuses the
divergent rebuild by name. The two runs that FOUND the defect (`sd-140241-ca44`, `sd-140505-28ff`)
are therefore permanently frozen at their pre-fix derivation and now answer
`evidence receipt … already exists with different content` when re-read. They are left as they are:
the fix was re-proved on three fresh runs rather than by rewriting authority.

**What was NOT observed, stated honestly.** The operator's Action List held only RRSS Separation
Request Forms, so **S2's refusal has never been exercised against a real non-separation document** —
it is proved against the deterministic driver and against the live fact that the form type is
readable and compared by value. Likewise no live document carried an unmapped termination type, an
unparseable date, or a stale action id, so those three refusals are test-pinned rather than
live-verified.

**The re-run wall — a platform gap this chunk hit in a sharper form than chunk 1 did.** After the
raw-control-byte debt was paid (a NUL separator inside `termination-type.ts`, which sits in this
descriptor's source closure), the descriptor's `contractFingerprint` moved — so the five proof runs'
receipts, which bind it, now refuse re-derivation with
`evidence receipt … already exists with different content`. The obvious response, re-running the
three documents against the final tree, **is not available**: a run checkpoint is keyed by
`(workflow, itemId, node, attempt)` with **no run id**, and this workflow's `matchKey` is the
document number — so a second run of document 4510 is the same ITEM, replays the first run's
checkpoint, and then refuses with
`run checkpoint separations-kuali-read … document 1 already exists with different content`. All
three re-runs failed identically (`sd-143658-296a`, `sd-143703-a532`, `sd-143704-6e22`).

Chunk 1 recorded this as "a proving harness cannot simply be re-run" and worked around it by varying
the Kronos window by a day. **There is no equivalent variation here**: the input IS the document, and
the output carries a live `observedAt`, so every re-read of the same document differs by
construction. Stated generally, and it is the sharper form: **a read workflow whose identity is the
thing it reads can be run exactly once per subject, ever.**

Two platform items fall out, neither owned by this chunk:

1. **A settled run's receipt should not be stranded by an unrelated edit inside its descriptor's
   31-file closure.** D136 solved exactly this class for parked writes — resolvability binds to six
   named SEMANTIC surfaces rather than to the closure hash, precisely because "a park waits for a
   human, so expiring it on an edit to `src/domain/ids.ts` is not a recovery path". A receipt is the
   same shape of promise and has not been given the same treatment.

   **CLOSED 2026-08-12 by D199** (ref operator-trust §D199). `descriptorFingerprint` is now the run's own
   retained `envelope.contractFingerprint`, and resolvability is a named check table. Verified
   against this repository's live authority database: `sd-140917-2b9e`, `sd-140921-3385` and
   `sd-140921-c0af` re-derive **byte-identically** and `explain run` serves all three. The other
   two, `sd-140241-ca44` and `sd-140505-28ff`, stay frozen — correctly, because their content really
   did change with D197's classification fix — and the refusal now NAMES `declared-evidence` /
   `declared-redaction` with the moved paths instead of saying only that the bytes differ.
2. **A checkpoint keyed without the run id makes a read workflow single-use per subject.** The key is
   right for its purpose (replay across attempts of one item), and the refusal is right (a differing
   observation under the same identity is a real conflict). What is missing is a way for an operator
   to say "read it again" — which for a read-only workflow is a completely ordinary request.

---

### 9.5 Chunk 3 — the UCPath identity surface, observed 2026-08-12

Read-only, one session, Duo cleared hands-off by Duo Autopilot. Subjects: the two employees chunk 2's
live documents name — **10001799** (doc 4510, "Clauckia, Drose") and **10001754** (doc 4502,
"Cramia, Dreitho").

**The page, and why it is this page.** The chunk reads the **Person Organizational Summary DETAIL
page**'s *Employment Instances* grid, not legacy's `WF_JOB_SUMMARY.GBL`. Both carry the same
per-employment facts; the Person Org grid carries them as ONE grid on ONE visit with anchors this
tree already live-verified and registered (2026-08-02), while legacy's arrive across two lazily
rendered tabs (`Work Location`, `Job Information`) with a frozen left column that has to be zipped
back on by row count. D194 asks for one task per page visit returning the full useful surface, and
this is the page on which that is one visit. **The one fact the two pages do NOT share** is legacy's
effective-dated history per empl record ("what was this job on the separation date"); that belongs to
the termination-filing chunk, which is the only consumer that has ever needed it, and it is a second
page visit either way.

**The twelve columns, in the order the live grid renders them** (the same layout the 2026-08-02 port
already parses, re-verified live 2026-08-12 on both subjects):

| # | Column | Live value, EID 10001754 | Live value, EID 10001799 |
|---|---|---|---|
| 0 | Empl Record | `0` | `0` |
| 1 | Effective Date | *(read)* | `07/01/2026` |
| 2 | **HR Status** | `Active` | `Inactive` |
| 3 | Business Unit | `SDCMP` | `SDCMP` |
| 4 | Position Number | *(read)* | *(read)* |
| 5 | Dept ID | *(read)* | *(read)* |
| 6 | Department Description | `HOUSING/DINING/HOSPITALITY` | `HOUSING/DINING/HOSPITALITY` |
| 7 | Job Code | *(read)* | *(read)* |
| 8 | Job Code Description | `STDT 2` | `STDT 2` |
| 9 | Expected Job End Date | *(read)* | *(read)* |
| 10 | FTE | *(read)* | *(read)* |
| 11 | Empl Class | *(read)* | *(read)* |

Empl record, HR status and business unit are STRUCTURAL — every rendered employment row carries all
three, and a blank one means the extraction read something that is not an employment row. The other
nine are `{state:"absent", reason}` arms (S24): surfaced as data with the reason, never dropped and
never guessed. Neither live subject produced an absent cell; the arm is exercised by fixtures built
from this exact layout.

**Render context, captured because it decides what `rowCount` MEANS.** PeopleSoft auto-redirects a
single-result search straight to the detail page (`entry: "auto-detail"`, `searchResultRows: 0`) and
renders a grid otherwise; and an Employment Instances grid paginates until its `View All` control has
been driven to `View N` (`employmentInstances: "already-complete" | "expanded"`). Both live subjects
came through `auto-detail` on an `already-complete` grid.

**The name the DETAIL page displays is "First Last", and the Kuali document says "Last, First".**
Live: UCPath rendered `Drose Clauckia` and `Dreitho Cramia` against Kuali's `Clauckia, Drose` and
`Cramia, Dreitho`. The ported `classifyNameSimilarity` compares token multisets and answers `same` for
both, which is right — and is also why the gate does not lean on the tier (below).

**Every status, type and state this chunk encountered** (§3.2's MAP-EVERYTHING): HR Status `Active`
and `Inactive`; business unit `SDCMP`; empl class values as rendered; disposition folds
`single-active-job`, `no-active-job`, `concurrent-active-jobs`, `indeterminate-status`; approval
shapes `one-click`, `choose-a-candidate`, `type-the-eid`. The status vocabulary is the ported one
(`/inactive|terminated|separated/` before `/active/`, because "Inactive" contains "active"); anything
outside it is `unknown` and makes the whole grid `indeterminate-status` rather than being guessed.

---

### 9.6 Chunk 3 — the live proof: **PASSED**, and the two defects it caught

Doc 03c §Phase summary step 4 for chunk 3 is **MET**. Two runs went through the real start-plan → command →
worker → **operator gate command** → worker path against real UCPath. The second reached terminal
`done` with a `verified-done` evidence receipt; the first found a platform defect no fixture could
reach and is left failed as the record of it.

| Trace | Subject | Gate shape | Result |
|---|---|---|---|
| `si-160956-834f` | 10001799 (doc 4510) | `choose-a-candidate` | parked, **approved live**, then **failed** on the gate-provenance defect (D203) |
| `si-161551-774c` | 10001754 (doc 4502) | `one-click` | parked, **approved live**, resumed, **terminal `done`**, receipt `verified-done` |

**Measured legs** (`si-161551-774c`, cold profile, Duo cleared hands-off):

| Leg | Time |
|---|---|
| queued → `Job Summary` span start | 4.60 s |
| `Job Summary` (browser launch + UCPath login + Person Org search + detail + View-All grid) | **22.94 s** |
| `Name Search` on the ready session (the full by-name search + drill-in) | **6.24 s** |
| `Identity Comparison` (pure fold, packet + digest) | **4 ms** |
| gate open → gate resolved (operator, over the real command endpoint) | 18.80 s |
| `Approval Check` (pure fold) | **2 ms** |
| queued → terminal | **53.86 s** |

So the identity check costs about **29 s of live reading** on a cold session and two milliseconds of
judgment. The second UCPath search — the one legacy only performs when its name tier says `different`
— costs 6.2 s on an already-authenticated session, which is the honest price of ref write-safety §14.2's
two-candidate presentation existing on every run.

**What the live lane proved that no fixture could — S22, on a real person.** Doc 4510's employee
(EID `10001799`) is **already terminated in UCPath**: one employment row, `HR Status: Inactive`,
reached by `auto-detail`. That is S22's silent-risk scenario exactly — a single-employment person who
is already separated auto-redirects, so legacy's all-terminated guard (which only runs on a multi-row
grid) never executes and the run proceeds to file a **second** termination. Here the classification is
unconditional, the disposition came back `no-active-job`, the employment comparison led the packet as
a DISAGREEMENT, and the gate refused to be a one-click approve. The chunk found the scenario in the
wild on its first live subject.

**What the live lane CAUGHT — a platform defect, ratified as D203.** Run `si-160956-834f` read
UCPath, parked, took a real approval through the real `/api/v1/commands` endpoint, resumed — and the
post-gate node then failed with `declared dependency "identity-approval" has no checkpoint record to
hand to the provenance collector`. That message was TRUE about a record that cannot exist: a gate
produces a `gate_results` row, not a `run_checkpoints` row, so any task declaring a gate as a
dependency was structurally unrunnable. Every fixture missed it because no fixture in this tree had a
task node downstream of a gate. Fixed by admitting the gate row as its own kind of upstream evidence
(D203); the run is left `failed` as the durable record.

**What the guard caught before any of that.** `identity-gate-before-commit`, extended in this chunk to
audit the TERMINAL RESULT as a sink, refused the descriptor's first draft: it derived the document
number and the employment picture straight off the PRE-gate comparison node, giving the run's product
two ancestry paths to a root that never crossed the gate. The post-gate node carries those facts
forward instead, so the workflow's whole product is a post-approval fact.

**What was NOT observed, stated honestly.**

- **No live REJECTION.** The reject arm is proved against the real task implementation
  (`separations-identity-check/gate-rejected`), not against a live run; rejecting a real separation
  document's identity is an operator decision this session had no mandate to make.
- **No live `different` name tier, and no live two-candidate gate.** Both live subjects' names agreed
  token-for-token and both name searches resolved the same person the document's EID did, so the
  `type-the-eid` shape and the second candidate are test-pinned.
- **No live absent cell (S24).** Both grids were complete.
- **~~The receipt cannot yet attribute the approver.~~ CLOSED 2026-08-12 by D204 (ref operator-trust).** The
  settled receipt used to list `node.identity-approval` as **`unknown`**, because a receipt derived
  from checkpoints and a gate has none. `buildRunEvidenceReceipt` now reads `gate_results` beside
  the checkpoints: run `si-161551-774c` re-derives with `node.identity-approval` **`verified`** and a
  `gate/approved` decision reading *"an operator approved this identity at the ALWAYS-GATE: gate
  "identity-approval" was resolved `approved` by local-operator at 2026-08-12T23:16:43.985Z through
  command 4928fee1-…, bound to the identity evidence it was granted on (evidenceDigest fd112d6f…)"*,
  with the approved EID redacted to its `last4`. All five of D199's semantic checks hold on that
  re-derivation. **The two receipts this session minted were dropped from the standing authority
  database and re-derived**, because a receipt stored before D204 cannot re-derive under it and D199
  has no waiver arm — an explicit operator repair on a pre-production database, recorded in ref operator-trust's
  D204 note.
- **The run-detail wire's top-level `gate` field still read "this run declares no operator gate"**
  while the run was parked, because that field folds the `gate.opened` SPAN and the dashboard
  process's projection had not tailed the worker's stream. The `identity-gate` section, which reads
  authority per request, was correct throughout. Recorded as an observation about the span-fold
  latency, not as a chunk defect.

**The re-run wall, again, and its shape here.** `matchKey` is `separations-identity:<document>:<eid>`,
so a second run of the same document+EID is the same ITEM and replays the first run's checkpoints —
whose `observedAt` differs by construction. The first run's failure therefore could not be re-proved
on the same subject; the fix was proved on a second real document instead. This is the same platform
item §9.4 recorded (chunk 2, item 2), unchanged and still open.

---

### 9.7 Chunk 4 — the UCPath Smart HR termination surface, observed 2026-08-13

**Provenance of this section.** Three consecutive agent dispatches on chunk 4 died with **zero
commits** (two 600 s watchdog stalls and one API disconnect). Everything below was live-observed on
**production** `ucphrprdpub.universityofcalifornia.edu` on **2026-08-13** and salvaged VERBATIM from
the dead transcripts into `docs/handoffs/2026-08-13-separations-chunk4-restart.md` (handoffs
removed 2026-08-18; in git history); this section is where it becomes durable. The stall itself is a recorded finding — see *Timings* below.

#### The persistence crux — ANSWERED

**There is ZERO durable footprint anywhere in the Smart HR wizard before an explicit Save click.**
Verified live: EID `10001754`, template `UC_VOL_TERM`, effective date `06/11/2026` — filled Page A
(template + date) → `Create Transaction` → Page B (EID / empl record / effdt / reason) → `Continue` →
Page C (Job Data, Override Last Date Worked, both comment fields) → abandoned via a hard `goto`. The
**Transactions in Progress** grid (baseline **5 rows**) was **byte-identical before and after at every
stage**, including after Page C was fully staged. Persistence happens ONLY on Page C's two explicit
save buttons (`Save for Later` / `Save and Submit`), and `Transaction ID` reads the literal string
`"NEW"` until then.

**What that settles, and it is the whole shape of the chunk:** `prepare` may stage the **entire**
three-page wizard, and the **commit is the `Save and Submit` click ALONE**. That is what makes the
ref write-safety beat-⑤ fence meaningful here — everything before it is provably reversible by navigating away,
and everything after it is not.

#### Live-verified anchors (Smart HR wizard — 0 iframes on every page)

Entry: `.../c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`.

**How to read the `Bound` column.** `registry` means the anchor is a published
`ucpath` UI-registry element with a ported legacy port-map row and dual
evidence. `driver` means it is declared in
`src/stores/ucpath/driver/smart-hr-operation.ts`'s `DRIVER_ANCHOR` table with a
stated reason — legacy has no selector key for it, and
`ElementDefinitionSchema` requires a ported legacy provenance, so publishing a
registry row for it would be a fabricated one. **`captured` means nothing in
`src/` or `config/` binds it**: it was observed live and written down, and the
operations this migration performs never touch that affordance. A `captured`
row is a fact about the page, not a claim about the code — recording it that
way is what keeps this appendix and the registry from silently disagreeing. The
trigger that would move one to `driver`/`registry` is a contract that needs the
affordance: a template LOOKUP (rather than a typed template id) for the two
modal rows, and an abandon/park path that leaves the wizard cleanly for
`Cancel` / `Save for Later`.

| Page | Fact | Anchor | Bound |
|---|---|---|---|
| A | Template | `#HR_TBH_WRK_TBH_TMPL_ID` | `registry` |
| A | Template `$prompt` lookup modal | `#ptModFrame_0`, close `#ICCancel` **inside the frame** | `captured` |
| A | Transaction date | `#UC_HR_TBH_WRK_TRANSACTION_DATE` (MM/DD/YYYY) | `registry` |
| A | Create Transaction | `#HR_TBH_WRK_TBH_ADD` (~7–8 s render) | `registry` |
| B | Empl ID | `#HR_TBH_WRK_EMPLID_PROMPT2` — **blur/Tab triggers the name + record lookup, ~4–6 s** | `registry` |
| B | Empl record | `#HR_TBH_WRK_EMPL_RCD_CHAR` | `driver` |
| B | Effective date | `#HR_TBH_WRK_JOB_EFFDT` — **display-only**, read and checked | `driver` |
| B | Action reason | `#HR_TBH_WRK_ACTION_REASON` | `registry` |
| B | Continue | `#HR_TBH_WRK_TBH_NEXT` | `registry` |
| B | Cancel | `#HR_TBH_WRK_TBH_CANCEL` | `captured` |
| B | **Displayed person name** | `#PERSON_NAME_NAME_DISPLAY` — **the beat-③ subject anchor** | `driver` |
| C | **Save and Submit** | `#HR_TBH_WRK_TBH_SAVE` — the ONE control that commits | `registry` |
| C | Save for Later | `#HR_TBH_WRK_TBH_LATER` | `captured` |
| C | Override LDW checkbox / date | `#HR_TBH_SCR_WRK_TBH_CHK2$3` / `#HR_TBH_SCR_WRK_TBH_DATE$3` | `registry` |
| C | Initiator comments | `#HR_TBH_WRK_DESCRLONG_NOTES` | `registry` |
| C | Transaction comments | `#UC_SS_TRANSACT_COMMENTS` | `registry` |
| C | Transaction-id display | `#UC_SS_TRANSACT_UC_TRANSACT_ID` (`"NEW"` pre-save) | `driver` |

**Why the subject binding is on Page B, not Page C.** Page C's identity block is a set of unstyled
`<span>`s inside `#myDIV` with **no stable ids** — there is nothing there a locator can bind that is
not positional. `#PERSON_NAME_NAME_DISPLAY` on Page B is the page's own rendering of who UCPath
resolved the typed EID to, which is exactly the fact beat ③ has to compare against the expected
subject before anything is fenced.

**Page A's template list, captured whole (§3.2) — 22 templates.** The two this migration files under
are `UC_VOL_TERM` = *Voluntary Termination* and `UC_INVOL_TERM` = *Involuntary Termination*.

#### The probe surface (S44) — and the page it is NOT

The idempotency probe reads **`UC_EXTENSIONS.UC_SS_TBH.GBL`** ("SS Smart HR Transactions" search).
It is **not** the "Smart HR Transaction Status" dashboard: that dashboard carries **no T# column at
all** and returned **0 rows** for a subject with two known real transactions, so a probe built on it
would have reported "no duplicate" about a person who has one — S46's silent-risk shape, manufactured
by choosing the wrong page.

| Fact | Anchor | Bound |
|---|---|---|
| Empl ID filter | `#UC_SS_TBH_DVW_EMPLID` | `registry` |
| Filter operator | `#UC_SS_TBH_DVW_EMPLID$op` (`2` = `=`) | `driver` |
| Search | `#PTS_CFG_CL_WRK_PTS_SRCH_BTN` | `registry` |
| Result rows | keyed by `T\d{6,}`; row wait on `tr[id^=trPTS_CFG_CL_STD_RSL]` | `driver` |
| Detail page | `?Action=U&UC_TRANSACT_ID=T…` | — |
| Detail: transaction id | `#UC_SS_TRANSACT_UC_TRANSACT_ID` | `registry` |
| Detail: approval status | `#UC_SS_TRANSACT_APPR_STATUS` | `registry` |
| Detail: start date | `#UC_SS_TBH_VW_START_DT$0` | `driver` |
| Detail: action | `#UC_SS_TBH_VW_ACTION$0` | `driver` |
| Detail: name | `#NAME$0` | `driver` |

#### Reason codes captured live, both templates, whole (§3.2)

- **`UC_VOL_TERM` — 18 codes:** `CAR` · `XFR` · `TR1` · `AAJ` · `SCH` · `DWJ` · `JAB` · `LAJ` ·
  `MIL` · `MOA` · `NRG` ("No Reason Given") · `PER` · `QWN` · `SLF` · `FRL` · `TIL` · `VSP`.
- **`UC_INVOL_TERM` — 25 codes:** `AIP` · `APR` · `ATA` · `ACE` · **`DEA` ("Death")** · `ATT` ·
  `FLS` · `MIS` · `NLC` · `PRF` · `DNP` · `DNR` · `NSV` · `GCE` · `INV` · `LHC` · `RRR` · `SEV` ·
  `RDS` · `MED` · **`NSE` ("Never Started Employment")** · `GRD` · `PDR` · `TR2` · `PRO` · `VIS`.

**`NSE` exists live.** That is exactly the fact §4a's open item (a) was waiting on, and it is why the
`Never Started Employment` map line could be approved by the operator on the same day rather than
invented — see §9.3's row 7 and §4a's 2026-08-13 addendum.

#### Live facts and timings

- **EID `10001799` already carries a real *Pending* involuntary termination `T002209631`** (effdt
  `06/11/2026`, filed `2026-08-11` by requester `10002079`) plus an **Approved** `T002197996`. That is
  a ready-made real subject for exercising the `already-present` probe arm and the pending sweep's
  **read** half with **no write of any kind**.
- **Measured, per step:** fill template + date **172 ms** · `Create Transaction` **7.3 s** · fill EID
  (including the blur lookup) **4.2 s** · reason **3.1 s** · `Continue` **9.2 s** · LDW override
  **6.2 s** · comments **2.2 s** · probe search page open **4.6 s** · probe search run **7.4 s** ·
  probe detail **4.9 s** typical.
- **One probe-detail call spiked to ~972 s (≈16 minutes).** That is almost certainly what killed the
  first dispatch, and it is recorded here as a **structural** finding, not an anecdote: **every live
  step against this surface carries a hard bound**, and an honest NOT-RUN beats a stall. The same fact
  is why `probeToFenceMaxMs` (§4f3) must be measured rather than assumed generous.
- **S48 (UCPath rejects the Empl ID on Page B) is INCONCLUSIVE.** The arm was attempted and its result
  was never read back before the dispatch died. Re-observe it; nothing is claimed about it here.

#### The contract decomposition this surface forces

The ids below are the SHIPPED ones. The salvage that produced this section named
the read `ucpath/probe-termination` and the prepare `ucpath/prepare-termination`;
`EFFECT_VERBS` makes a read a `match-*` and a prepare a `stage-*`, so both were
renamed before they landed and the old names exist nowhere in `src/`.

| Contract | Kind | What it is |
|---|---|---|
| `ucpath/match-existing-termination` | read | S44 — the `UC_EXTENSIONS.UC_SS_TBH.GBL` read: EID-filtered search plus per-row detail, returning every transaction the page showed. Folded date-agnostically by its sibling `ucpath/match-pending-terminations` for the sweep |
| `ucpath/stage-pending-termination-sweep` + `ucpath/delete-pending-terminations` | **its own transaction** | ref write-safety §5's **second** probe kind — the date-agnostic pending sweep (legacy `deletePendingTransaction` deletes ALL in-progress `Terminat*` rows for the EID). It is a mutation, so it is a transaction node of its own, composed BEFORE the termination |
| `ucpath/stage-termination` | prepare arm | stages all three wizard pages; zero durable footprint by the crux above |
| `ucpath/create-termination` | commit arm | the `Save and Submit` click **alone** |
| `ucpath/verify-termination` | read-back | re-probes for the `T#`; **unreadable or unknown PARKS** (S46/S51/S52), never success |

Ref write-safety §12's worked example names these `fill-termination` / `submit-termination`; same shape, and the
repo's own naming rules win — as they did over the salvage's `probe-`/`prepare-` names above. Ref write-safety §5 requires **both** probe kinds ported — the idempotency probe
(EID + exact effdt + `"Terminatn"`) and the date-agnostic sweep — and they are genuinely different
questions, which is why they are two contracts and not one with a flag.

---

### 9.8 Chunk 4 — the live re-verification, 2026-08-14 (and the defect it found)

Read-only against production `ucphrprdpub.universityofcalifornia.edu`, one
session, Duo cleared hands-off by Duo Autopilot through
`duo-autopilot/launch-selector-browser.mjs` (`SEL_SESSION=sep4`). **Nothing was
submitted.** Two Smart HR wizards were walked to Page B and abandoned by
navigation; no `Save and Submit` and no `Delete Selected Transactions` was ever
clicked.

**The saved profile did NOT skip the ceremony.** `.auth/sep4-profile`'s session
had expired, so the run went through campus discovery → TritON → Duo from cold.
The profile is still worth keeping only if it is re-used the same day; the thing
that actually made this unattended was the extension, not the profile.

#### The defect this lane found — an action vocabulary the code could not match

`isUcpathTerminationAction` tested a `Terminat` prefix, ported from legacy's
pending-sweep matcher. **The SS Smart HR surfaces do not render that string.**
EID `10001799`'s four rows read `TER`, `TER`, `(blank)`, `HIR`, and the detail
page for `T002209631` also reads `TER`. So every idempotency probe would have
answered `absent` about a person who demonstrably has a Pending termination —
the exact duplicate-filing failure the probe exists to prevent, on the first
real subject.

There genuinely are **two vocabularies on two grids**, and legacy uses both
without ever saying so:

| Surface | Action column | Legacy's matcher |
|---|---|---|
| SS Smart HR search grid + transaction detail | the PeopleSoft code `TER` | `ss-smart-hr.ts` matches `Action === "TER"` |
| Smart HR *Transactions in Progress* grid | the descriptive `Terminatn` | `rowMatchesTerminationEid` matches `/Terminat/i` |

Fixed: the matcher accepts the exact code `TER` **or** a `Terminat` prefix, and
neither arm is fuzzy — one is equality against a closed PeopleSoft code, the
other is the prefix legacy already relies on. A `(blank)` action matches
neither, which is correct.

#### The `already-present` dedupe observation — MET, with no write of any kind

EID `10001799` filtered on the SS Smart HR search (`#UC_SS_TBH_DVW_EMPLID`,
operator `2` = `=`) returns **four** rows, read verbatim:

| Transaction ID | Name | Empl ID | Action | Approval Status | BU |
|---|---|---|---|---|---|
| `T002209631` | Drose Clauckia | 10001799 | `TER` | **Pending** | SDCMP |
| `T002197996` | Drose Clauckia | 10001799 | `TER` | Approved | SDCMP |
| `T001816218` | Drose Clauckia | 10001799 | `(blank)` | Approved | SDCMP |
| `T001781115` | Drose Clauckia | 10001799 | `HIR` | Approved | SDCMP |

The detail page for `T002209631` reads `startDate 06/11/2026`, `action TER`,
`approvalStatus Pending`, `name Drose Clauckia`. So a run for EID 10001799
effective `06/11/2026` folds to **`present`** and settles `already-present` with
zero clicks — S44 observed on a real person, for free.

**Search-grid columns (§3.2):** `Transaction ID · <sequence> · Name · Empl ID ·
Action · Approval Status · Business Unit`. The grid carries the name, the EID,
the action and the status; it does **not** carry the effective date, which is
why the effective-date-keyed probe still costs one detail visit per candidate
row and the date-agnostic sweep does not.

**Approval Status filter option list, captured whole:** `(blank)` · `Approved` ·
`Denied` · `Error` · `Manually Processed` · `Pending` · `Pushed Back` — exactly
`UcpathApprovalStatusSchema`. **Empl ID operator list:** `1=begins with` ·
`8=contains` · **`2==`** · `3=not =` · `4=<` · `6=<=` · `5=>` · `7=>=` ·
`9=between` · `10=in`.

#### S48 — RE-OBSERVED, and now conclusive

The salvage left S48 inconclusive. Filling `#HR_TBH_WRK_EMPLID_PROMPT2` with
`99999999` and blurring, then waiting 9 s:

- `#PERSON_NAME_NAME_DISPLAY` renders **ZERO nodes**
- `#HR_TBH_WRK_EMPL_RCD_CHAR` is **empty**
- the EID field keeps the typed value
- the page body carries an invalid/not-valid message; `.PSERROR` is present but
  empty, so **the banner is not the signal**

**And `#PERSON_NAME_NAME_DISPLAY` is absent on a FRESH Page B too** — it appears
only once UCPath resolves a person. That is stronger than the salvage recorded:
the anchor's *presence* is the resolution signal, so the beat-③ subject
observation and the S48 refusal are the same check. `ucpath/stage-termination`
refuses `emplid-not-recognized` here, before any fence — where legacy discovers
it ten seconds later as an opaque timeout on the next page's first field.

#### The persistence crux, independently re-confirmed

Two full Page-A → `Create Transaction` → Page-B walks were abandoned by
navigation, one of them with an EID filled. The *Transactions in Progress* grid
afterwards reads **`First 1 of 1`**, and its one row is
`JOB · 06/11/2026 · Drose Clauckia · 10001799 · Terminatn · United States` —
a pre-existing departmental transaction, not either of the abandoned wizards.
Neither walk left a row behind.

**In-progress grid columns:** `Select · Transaction Type · Effective Date ·
Name · Person ID · Action · Country`. It carries the effective date, the name,
the EID and the descriptive `Terminatn`, which is everything the sweep's
selection needs. **`Delete Selected Transactions` is `input#HR_TBH_WRK_DELETE_BTN`**
— a stable id the salvage never recorded and legacy has no key for.

#### The reason-code lists, captured with BOTH value and label

This settles the map's one heterogeneity with data. Every one of §4a's fifteen
legacy-ported reason codes is a live option LABEL, exactly:

**`UC_VOL_TERM` — 18 options (incl. the blank sentinel):** `CAR|Career to Per
Diem` · `XFR|Interlocation (BU) Transfer` · `TR1|Release fr Trial Emplmnt-Vol` ·
`AAJ|Resign - Accept Another Job` · `SCH|Resign - Attend School` ·
`DWJ|Resign - Dissatisfied w/ Job` · `JAB|Resign - Job Abandonment` ·
`LAJ|Resign - Look For Another Job` · `MIL|Resign - Military Service` ·
`MOA|Resign - Moved out of Area` · `NRG|Resign - No Reason Given` ·
`PER|Resign - Personal Reasons` · `QWN|Resign - Quit Without Notice` ·
`SLF|Resign - Self Employment` · `FRL|Resign -Failed to Ret fr Leave` ·
`TIL|Transfer - Intra Location` · `VSP|Voluntary Separation Program`.

**`UC_INVOL_TERM` — 26 options (incl. the blank sentinel):**
`AIP|Acad- Incompetent Performance` · `APR|Acad- Presumptive Resignation` ·
`ATA|Acad- Terminal Appointment` · `ACE|Appointment Expired` · `DEA|Death` ·
`ATT|Dismissal - Attendance` · `FLS|Dismissal - Falsified App` ·
`MIS|Dismissal - Misconduct` · `NLC|Dismissal - No Longer Cert/Lic` ·
`PRF|Dismissal -Lack of Performance` · `DNP|Do Not Protest (Settlement)` ·
`DNR|Do Not Rehire (Settlement)` · `NSV|Elimination of Position` ·
`GCE|Grant/Contract expired` · `INV|Involuntary Termination -Other` ·
`LHC|Layoff - Accept Health Care` · `RRR|Layoff- Rehire/Recall Rights` ·
`SEV|Layoff- Severance` · `RDS|Layoff-Reduced Sev, Reh/Recall` ·
`MED|Medical Separation` · **`NSE|Never Started Employment`** ·
`GRD|No Longer Student` · `PDR|Per Diem Release` ·
`TR2|Release fr Trial Emplmnt-Invol` · `PRO|Released During Probation` ·
`VIS|Visa/Work Permit Expired`.

**`NSE` = "Never Started Employment" is confirmed first-hand**, not only through
the salvage — so §4a's 2026-08-13 operator answer rests on an observation this
session made itself. `GRD|No Longer Student` and `ACE|Appointment Expired` also
match the map's two involuntary labels exactly.

The map therefore stays as it is — fifteen LABELS plus `NSE` as a VALUE — and
the driver's "match an option by value **or** label, exactly one, refuse
otherwise" rule is now live-verified rather than merely defensible. Normalizing
the table to codes is possible with the two lists above and is a follow-up, not
a debt.

#### Timings, warm session (and why the 972 s spike matters more, not less)

| Step | Measured |
|---|---|
| SS Smart HR transaction detail (keyed deep link → field read) | **753 ms** |
| Smart HR wizard Page A open | 2.3 s |
| fill template + transaction date | 9 ms |
| `Create Transaction` → Page B ready | **1.07 s** |
| Page A open → `UC_INVOL_TERM` reason list rendered | 3.4 s |
| Smart HR Transactions page open (with in-progress grid) | 4.7 s |
| invalid-EID blur → settled (a deliberate 9 s wait, not a measurement) | ≤9 s |

Every number is far under the salvage's cold-session figures (detail 4.9 s,
Create Transaction 7.3 s). **That widens the gap the 972 s spike has to be
explained by rather than closing it**: this surface is normally sub-second to a
few seconds, so a 16-minute call is a pathology, not a slow page, and the hard
per-step bound stays mandatory.

#### What was NOT run, stated honestly

- **The §4f3 `probeToFenceMaxMs` live-dry-run measurement.** The descriptor's
  120 s is derived from §9.7's step-by-step production timings (≈32.4 s of
  staging, ~3.7x headroom) and this session's warm numbers are strictly
  smaller — but the operator's answer asks for the interval read off a real
  run's own per-beat spans through the start-plan → command → worker path, and
  that run has not happened. **Still a blocking follow-up.**
- **The controlled real commit.** Untouched by design (§4f2, option ii): it
  waits on an operator-named canary. Nothing was submitted.
- **The UI-registry entries for these anchors.** See the chunk-4 return: they
  need `config/ports/legacy-selector-port-map.json` rows plus a fixture/live
  evidence-manifest pair, and the live half is exactly the read this session
  performed — so the work is unblocked and scoped, not blocked.

---

### 9.9 Chunk 4 — the live dry-run pass, 2026-08-14: what ran, what it found, and what is genuinely blocked

Read-only against production, Duo cleared hands-off by Duo Autopilot. **Nothing
was submitted.** `Save and Submit` was never clicked; `Delete Selected
Transactions` was never clicked. Five sequencer-driven attempts, each ending in
a refusal, and **the durable footprint was `absent` on every one** — no
`write_intents` row for either permanent key, no transaction checkpoint for
either node. That is the structural commit-freedom claim, asserted against the
authority database rather than against logs, five times over.

#### The honest status of doc 03c §Phase summary step 4 for chunk 4: **PARTLY MET**

| Asked for | Status |
|---|---|
| The prepare arm exercised end to end against live UCPath, on the real driver, through the real sequencer | **MET** — the whole three-page wizard staged for a real active employee, `Transaction ID` reading `"NEW"`, reaching the beat-③ subject observation |
| Structural commit-freedom proved from durable state | **MET** — zero intents, zero checkpoints, five for five |
| The run driven through start-plan → command endpoint → worker | **NOT MET** at the time of this pass — refused at ingress, see the two platform gaps below. _(The two BLOCKERS are closed as of 2026-08-14, D209/D210; the pipeline run itself is chunk 6's.)_ |
| `probeToFenceMaxMs` read off per-beat spans | **NOT MET as specified** — the dry-run arm neither probes nor emits spans; the bound is instead CONFIRMED by an end-to-end measurement, below |

#### Two platform gaps, both named and both provable — **BOTH CLOSED 2026-08-14 (D209 · D210)**

> **Status, 2026-08-14.** Both gaps below are FIXED by the dry-run platform
> slice. They are left standing verbatim because they are the measured report
> that motivated the two decisions, and a gap rewritten after the fact stops
> being evidence. What changed:
>
> - **Gap (1) → D209** (ref workflow-model §2, normative; ref task-contract §6.2). Dry-runnability is
>   derived from the GRAPH — every transaction node declaring
>   `dryRun: "stop-after-prepare"` — by one factory-computed projection the start
>   plan, the command kernel and the explorer wire all share. All three
>   registered write workflows are dry-startable through the pipeline with
>   `surfaces: {}` unchanged. Two rules came with it: **every** transaction node
>   must declare the arm and not merely the first a preview would reach (D205's
>   true-about-the-wrong-thing), and a graph with **no** transaction node refuses
>   BY NAME rather than trivially succeeding, since previewing it is byte-for-byte
>   an ordinary run. `surfaces.inputRun.supportsDryRun` survives as a derived,
>   un-authorable field for the client-composed run-start surface.
> - **Gap (2) → D210** (ref workflow-model §2.1, normative; ref task-contract §6.2). The interpreter's
>   preview arm: a run whose envelope says `dryRun` reaches its transaction node,
>   runs the sequencer's REAL `executeDryRun` (zero intent, zero fence, zero
>   commit), emits `transaction.previewed`, and ENDS THE RUN THERE. The paragraph
>   below is right that the terminal derive has nothing to fold, and the answer is
>   a different RECORD rather than a fabricated outcome: the lifecycle outcome is
>   `done` (§10.1's "stops successfully", discriminated by `envelope.dryRun`,
>   which is already the durable record of the request), and the terminal result
>   is a `RunDryRunPreviewResult` in the same `run_results` row bound to the
>   PREVIEW schema hash — no new table, no schema version. The receipt reports
>   `completion.terminal-result` as `unknown` plus a load-bearing
>   `DRY_RUN_PREVIEW` warning, so a previewed run settles at `partial` and
>   `verified-done` is structurally unreachable.
>
> `executeTransaction` still refuses a dry run by name; that guard is not retired
> by the arm landing, and its message was corrected — it used to say the arm did
> not exist yet. **What is NOT closed by this slice:** the queue row and the
> timeline have no arm for a preview, so `transaction.previewed` rides the span
> stream and `run-queue-projection` deliberately IGNORES it rather than folding it
> into a `span.ended` it is not; the operator-facing truth is carried today by the
> evidence receipt. Surfacing it on the queue row is a wire + UI change and is
> chunk 6's to carry, beside the composed pipeline dry run itself — which is the
> proof this slice enables and does not perform.

**(1) A dry run cannot be STARTED for this workflow.** `supportsDryRun` reads
`descriptor.surfaces.inputRun?.supportsDryRun`, so whether a run can be
previewed is bound to whether the workflow has a paste-a-line INPUT SURFACE.
Chunk 4 has none by §3's no-frontend directive (its ingress is ten correlated
values; a line parser would have to invent nine), so the start plan refuses:

> `dry-run-unsupported` — *separations-ucpath-termination declares no dry-run
> boundary; start it for real or not at all*

`kuali-timekeeper-annotation` has the same `surfaces: {}` and therefore the same
refusal, which is why its own dry-run proof was driven through a harness rather
than the pipeline. **Whether a graph can be previewed is a property of the GRAPH
— does every transaction node declare `dryRun: "stop-after-prepare"` — not of
whether an operator can paste a line into a textbox.** Moving it is a platform
decision, not chunk 4's to take.

**(2) The interpreter has no dry-run preview arm.** Even past ingress, the
executor calls `executeTransaction` with `dryRun` from the envelope, and the
sequencer refuses by name: *"the Phase-1f interpreter has no preview outcome arm
yet, and the sequencer refuses to substitute a real write — use `executeDryRun`"*.
Ref task-contract §6.2 says what the missing behaviour is — *"records an honest
`transaction.previewed` span, and ends the run at the node"* — and no producer
emits that span today. A dry run of a graph with a transaction node also cannot
reach `build()`, because a preview has no `disposition` and no commit output,
so the terminal derive has nothing to fold; ending the run at the node needs a
terminal disposition the lifecycle does not yet have.

**These two were why the pipeline half was NOT MET, and the reason was stated
rather than worked around** (both are closed as of 2026-08-14 — see the status
block above; the composed pipeline dry run that exercises them is chunk 6's). The alternative — starting the run for real — was
refused on sight: a non-dry run reaches the fence and files a real termination,
and §4f2's canary has not been named.

#### §4f3 — the bound is CONFIRMED, and the per-beat decomposition is not obtainable today

`executeDryRun` runs the **prepare arm only**: it performs no probe and emits no
spans. So "probe-complete → prepare-complete off the run's own per-beat spans"
cannot be read from a dry run at all — the measurement plan §4f3's answer
described assumed a preview that records both beats, and the implementation
records neither.

What WAS measured, on the real driver against production:

| Leg | Measured |
|---|---|
| `executeDryRun` on `file-termination`, entry → beat-③ observation | **51.5 s** (cold: browser launch + full SSO/Duo + all three wizard pages) |
| of which the SSO + Duo login alone | ≈ **14.0 s** |
| the probe's own page work, measured separately (§9.8) | search open **4.6 s** + search run **7.4 s** + **753 ms** per transaction detail |

So probe + prepare on a cold session lands near **65 s** worst observed against a
shipped bound of **120 s** — roughly **1.8x headroom**, and about **2.3x** on the
prepare leg alone. **The 120 s stands, now on a live measurement rather than on
step timings alone**, and the descriptor is unchanged. The per-beat
decomposition stays open behind gap (2).

#### Three defects the pass found, all at the subject binding

Each refused BEFORE the fence, which is why they are findings rather than
incidents.

1. **The sweep named an anchor its own staged page cannot render.** Both sweep
   contracts bound beat ③ to `#PERSON_NAME_NAME_DISPLAY` — a Page-B anchor —
   while the sweep never leaves the Smart HR setup page. It now has its own
   observation read off the in-progress grid, by an anchored relative bind (the
   cell whose text IS the Empl ID, then its predecessor). The staging also
   stopped reporting the EXPECTED name as the OBSERVED one, a fallback hiding in
   plain sight.
2. **The JOB effective date is DISPLAY-ONLY.** `#HR_TBH_WRK_JOB_EFFDT` is
   rendered `disabled` (`PSEDITBOX_DISABLED`) and pre-filled by UCPath from the
   Page-A transaction date, so filling it timed out. It is now READ and CHECKED
   — strictly stronger, because half the permanent key becomes a verified
   derivation instead of an asserted input.
3. **The wizard's beat-③ anchor was on the wrong page too.** Beat ③ observes the
   page prepare LEFT BEHIND, which is Page C. Page C's identity block carries no
   ids — but it is LABELLED: `Template: · UC_INVOL_TERM · Name: · Dreitho Cramia`,
   with the `Name:` label and its value each appearing **exactly once**. The read
   is anchored on the label and takes the next non-empty cell, refusing on
   absence or ambiguity.

All three are D203's shape: **the declaration must name the surface the staged
page actually has, and the reader moves to meet it.**

#### Two more live facts worth keeping

- **An already-terminated employee is refused by the wizard itself.** EID
  `10001799` (HR Status `Inactive`) answers *"Invalid value -- press the prompt
  button or hyperlink for a list of valid values (15,11)"* on the Page-B Empl ID
  prompt, and no name ever renders. So S48's `emplid-not-recognized` covers BOTH
  live causes — an Empl ID UCPath has never seen, and one it knows but has no
  terminable employment record for — and the absence of the name is the signal
  for both.
- **A sweep with nothing to sweep has no subject to bind.** The in-progress grid
  holds no row for a person with no pending transaction, so `stage` refuses for
  want of a subject. That state is unreachable on the real path — the sweep's
  probe settles `already-present` before any staging — and it is recorded here
  because a dry run previews the prepare arm regardless of the probe.

#### Operational note

The dashboard BFF was found holding D181's runtime process lock from a
handed-off session five and a half hours earlier, serving a registry that
predated this workflow. It was stopped and restarted. The lock is what made that
explicit rather than silent, which is what it is for.

---

### 9.10 Chunk 5a — the Kuali finalization contracts and driver, as built (2026-08-14)

**BUILD ONLY. Nothing here has touched the live system.** 5a is the contracts + driver third of
chunk 5; the descriptor, its transaction node and the scenarios that walk it are 5b, and the live
pass is 5c.

**What landed.** Four contracts on the existing `kuali` driver declaration —
`kuali/match-separation-finalization` (probe), `kuali/stage-separation-finalization` (prepare),
`kuali/save-separation-finalization` (commit) and `kuali/verify-separation-finalization` (the
read-back) — plus the driver operations, the deterministic-fake arms and the pure folds. §4e's
staged-variables model is implemented literally: ten fields, one prepare pass, one save, one reload
read-back compared field by field against the exact staged variables, with no tolerance arm.

**Where the ten values come from.** Seven are per-run variables (department option text, payroll
title code, payroll title, timekeeper name, termination effective date, transaction number, the full
comments text). Three are unconditional assertions carried as constants so a caller cannot vary
them: *Request Acknowledged* and *Submitted Termination Template* (legacy steps 10b and 16), and the
final-pay radio, which is **§4g** verbatim and is pinned by value in a unit test — the one thing S58
actually objected to.

**Scenarios chunk 5 owns, and how 5a covers them.**

| Scenario | 5a's answer |
|---|---|
| **S55** no matching Kuali department option | `department-option-not-offered`, carrying the COMPLETE observed option list (§3.2). Legacy's refusal is sound; what is new is the recorded list |
| **S56** existing timekeeper comments unreadable | **strengthened.** The prepare re-reads the control and refuses (`comments-changed-since-read`) when it no longer holds what the read this run composed from saw — legacy refuses only when the READ throws, so an edit made in between is silently overwritten |
| **S57** transaction number empty at finalization | **does not port.** The number is a required `T`+6–12-digit variable, so the "fill everything except it and save blank for manual entry" path cannot arise. That is legacy's own `verifyTxnNumberFilled` intent moved into the type system |
| **S58** the final-pay radio | §4g's ratified constant, in code with its ratification and pinned by test |
| **S59** `Save` clicked, Kuali persists nothing | the reload read-back over ALL TEN fields is the only landing proof; a partial save is `absent` and parks, naming every field that disagreed. This is the answer to the behavior review's open question under S59 |
| **S60** UCPath filed, Kuali finalization fails | a parked write with a named intent (§4c). The graph-level arm is 5b's |
| **S61** dry run writes to Kuali | the prepare saves nothing and the scenario asserts the document still reads unfinalized. 5c re-opens the document after its dry run, which is the verification legacy never did |
| **S42** timekeeper-name fill fails | folded into `stage-not-persisted`: every one of the ten controls is read back and a disagreement names the field |

**Two things 5c owes, recorded here so they are not rediscovered.**

1. **No write path is live-verified.** _(DISCHARGED 2026-08-14 — §9.12.)_ The fourteen controls were live-verified as READS on
   2026-08-12 (§9.3); none has been observed being WRITTEN by this repository, and *a selector mapped
   on a read-only record is not a verified selector for the editable page* is legacy's own lesson.
   Every write path in `src/stores/kuali/driver/interpreter.ts` carries a `// live-verify: 5c`
   marker. The registry's two new facts (the staged page state and the Transaction Number
   observation) are structural claims about that same read-only pass, and both evidence manifests
   keep `externalWriteAttempted: false`.
2. **Nine of the ten `submitDocumentV2` `formKey`s are unknown.** _(CAPTURED 2026-08-14 — and the
   capture found that filling the table was necessary and not sufficient; §9.12 item 2.)_ Only `timekeeperName`'s
   (`QGJ63YrCom`) was ever observed, live 2026-08-04 off Kuali's own `ActionPage` query. The rest are
   `null` rather than guessed — a fabricated key makes the commit's wire proof a check that cannot
   fail — so that proof covers one field today. The landing proof is unaffected because it was never
   the wire check; what is incomplete is the earlier, louder half of the defence.
   `kualiFinalizationFormKeysMissing()` is the to-do list, and filling the table is a one-line change.

**Three judgements 5a made inside §4e/§4g rather than deferring, each recoverable if the orchestrator
disagrees.**

- **`recoveryAbsence` is `stabilized`**, reusing D135's measured Kuali window (`minSinceFenceMs`
  30 000, two reads 5 s apart, same source state). The measurement transfers because the MECHANISM
  transfers — the same `submitDocumentV2` on the same form, proved by the same reload of the same
  document — and the arm is safe in the direction it can be wrong: settling a negative here re-fences
  and re-saves the identical field set, which is why this is not chunk 4's `operator-only` case,
  where the retry would be a second real termination.
- **The permanent key omits the action id and the field values.** An action id names a workflow STEP,
  not a document (D129), so keying on it would mint a second key for the same external transaction;
  and a differently composed comments string is not a second finalization.
- **Legacy's step-13 date write-backs (`Last Day Worked`, `Separation Date`) are NOT staged.** They
  appear in neither §4e's normative field list nor §5 item 1's five-mutation table. Nothing here
  invents a rule for them; if the composition needs them they are a §4e amendment, not a driver
  change.

**Orchestrator dispositions on those three, recorded 2026-08-14 so they are not re-litigated.**

1. **The `formKey` design stands.** The commit's wire proof covers only observed keys; the ten-field
   reload read-back is the landing proof and always was. 5c fills
   `kualiFinalizationFormKeysMissing()`'s list.
2. **`recoveryAbsence: "stabilized"` is ACCEPTED and is now ratified as D207** (ref write-safety §4.2), with
   5a's argument plus one obligation it did not carry: the transferred window is **provisional until
   this write's own controlled-commit proof confirms it** (doc 03c §Phase summary step 5), and the composed
   workflow may not rely on the stabilized arm in production before that.
3. **The step-13 date write-backs stay unstaged.** §4e's normative list is built as written; the open
   question is queued for the operator rather than answered by the driver.
   **_(SUPERSEDED 2026-08-14 by §4e's AMENDMENT — see §9.15._** The operator answered the queued
   question and the two fields ARE staged. 5a's judgement was right about its own scope — a driver may
   not invent a rule §4e does not carry — and the disposition held exactly until §4e carried one.)_

---

### 9.11 Chunk 5b — the descriptor, the department fold and the graph, as built (2026-08-14)

**BUILD ONLY. Nothing here has touched the live system.** 5b is the descriptor + graph third of
chunk 5. The live pass is 5c.

**The node graph.** `separations-kuali-finalization`, code `sf`, `surfaces: {}` — no input surface,
same as its siblings.

| Node | Kind | `dependsOn` | What it is |
|---|---|---|---|
| `job-summary` | step `ucpath/read-job-summary` | — | chunk 3's read, reused |
| `name-search` | step `ucpath/search-person-org` | — | chunk 3's read, reused |
| `department-option` | step `workflow:separations/match-department-option` | — | **new**: S55's upstream fold |
| `comparison` | step `workflow:separations/match-identity` | `job-summary`, `name-search` | chunk 3's fold, reused |
| `identity-approval` | **gate**, `resolvedBy: operator` | `comparison`, `department-option` | ref write-safety §14's ALWAYS-GATE |
| `approval` | step `workflow:separations/verify-identity-approval` | `comparison`, `identity-approval` | chunk 3's post-gate check, reused |
| `finalize-kuali` | **transaction** | `approval`, `department-option` | prepare `kuali/stage-separation-finalization`, commit `kuali/save-separation-finalization` |
| *(terminal result)* | — | `approval`, `department-option`, `finalize-kuali` | |

`dryRun: "stop-after-prepare"`, `probePolicy: "always"`, `probeToFenceMaxMs: 45_000` — §5 item 3's
recorded answer, the same value and the same D78 justification the timekeeper-annotation node
carries. This prepare stages TEN controls where that one stages one, so 5c's first live dry run
reports probe-complete → prepare-complete off the run's own per-beat spans and tightens or confirms
it.

**Why `department-option` hangs off the GATE.** `identity-gate-before-commit` audits both sinks
(D202), and the property it enforces is not "the gate is on every edge" but "no data reaches a sink
that the operator never saw". A department resolved off the graph root and read straight by the
transaction would be exactly that side read. Declaring it as a gate dependency also lands S55's
refusal **before a human is asked at all**, which is chunk 4's argument for `termination-type`
verbatim. **Open for chunk 6:** the resolved option is a gate DEPENDENCY and is not yet rendered
INTO ref write-safety §14.2's packet — the composition should carry it there. _(CLOSED 2026-08-14 by chunk 6a's
write-plan block, §9.13 / D211.)_

**The department fold** (`src/domain/separations/department-option.ts`). The CODE is the key: Kuali
renders every option as `<6-digit code> - <description>` (§9.3's S55 capture) and that code IS the
UCPath dept id, so an exact code match is a real identity. Legacy's other two tiers — description ⊆
option text, then option name ⊆ description with a "specific enough" heuristic and a longest-match
tiebreak (`legacy:src/systems/kuali/navigate.ts:328-400` @ `1bffbd65…`) — do **not** port, for §4a's
reason one control over. A normalized-exact DESCRIPTION tier is not the safe middle ground it looks
like and is absent too: UCPath renders `HOUSING/DINING/HOSPITALITY` where Kuali renders
`Housing/Dining/Hospitality`, so such a tier is either dead or case-insensitive, which is a quieter
fuzzy match. Both spellings ride on the resolution instead, so the operator compares them and the
code decides. The option text is returned **verbatim from the list that went in**, and a reconstruction would
produce a string the control does not carry. _(Corrected by 5c's live pass, §9.12: the double space
in `000719 -  Supply Chain Services` is what the DOM and Kuali's model carry, but the driver reads
options through `HTMLOptionElement.text`, which strips and collapses — so what "verbatim" means here
is "the normalized spelling every read in this pipeline produces", which is self-consistent and is
the spelling `selectOption({label})` can match.)_ Four refusals, four durable codes:
`department-code-unreadable` (S24 — the consumer that NEEDS the department is the one that refuses),
`department-code-not-offered` (recording every option the control did offer), `department-option-ambiguous`,
`department-option-unusable`.

**Coverage points and the scenarios that walk them.** One transaction node and one gate, so the
graph derives six points; the corpus is one file with three kinds of arm.

| Scenario | Kind | Coverage points |
|---|---|---|
| `stage-refusals` | task walk (5a) | — |
| `save-verify-read-back` | task walk (5a) | — |
| `department-option-refusals` | task walk (5b) | — |
| `dry-run-preview` | sequencer walk | `transaction:finalize-kuali/dry-run` |
| `subject-mismatch` | sequencer walk | `transaction:finalize-kuali/subject-mismatch` |
| `committed` | sequencer walk | `transaction:finalize-kuali/committed` |
| `already-present` | sequencer walk | `transaction:finalize-kuali/already-present` |
| `save-not-landed-parks` | sequencer walk | — |
| `gate-approved` | pure graph walk | `gate:identity-approval/opened`, `gate:identity-approval/resolved` |

**S60 and S61 at graph level.** **S61** is `dry-run-preview`: the run stages all ten controls and
reads every one of them back, then stops with zero write intents, zero checkpoints, zero outbox rows
and a document still reading unfinalized — against legacy, whose dry run leaves the timekeeper name
and a `similar`-tier name rewrite on a live Kuali draft. **S60** is `save-not-landed-parks`: the
click happens, Kuali keeps nothing, and the post-fence absence PARKS with the intent fenced
(`status: parked`, `parkedCode: unknown`) and no checkpoint. That is §4c's answer stated as a durable
state — by that point the UCPath termination the document was going to record is already real, so a
`failed` run would leave "UCPath done, Kuali not" in the operator's head, which is the exact thing
§4c refuses.

**What 5b owes beyond §9.10's two items.**

1. **The parity reference corpus is STALE and was deliberately not re-frozen.** Registering a
   descriptor changes the Workflow Explorer's own button list, so the twelve `explorer-graph--*` /
   `explorer-transaction--*` references now under-report by one workflow (chunk 4's registration
   re-froze them in the same commit; this one could not, because a concurrent session owns the
   dashboard tree and `npm run test:parity` was off-limits for this lane). The repair is one
   `npm run test:parity:update` and a review of the diff. **`npm run typecheck && npm run lint &&
   npm run test:coverage` are green; the parity lane is not, and that is the only known red.**
2. **The receipt PAIR is not on the ingress.** §4c requires `(transactionNumber, approvalStatus)` as
   durable authority before finalization is entered; this descriptor takes the number (it is half the
   permanent key) and nothing consumes the approval status, so adding it here would be a dead field.
   It belongs to chunk 6's composition, which holds chunk 4's terminal result and can bind both.
   _(CLOSED 2026-08-14: chunk 6a's `workflow:separations/verify-termination-receipt` node sits between
   the two writes and refuses a `Denied`/`Error`/`Pushed Back` receipt by name — §9.13 / D211.)_

---

### 9.12 Chunk 5c — the live read-only + dry-run pass, 2026-08-14: what ran, what it found, and what is genuinely blocked

Read-only against the real Kuali production space, Duo cleared hands-off by Duo Autopilot. **Nothing
was saved.** `Save`, `Send Back` and `Mark Complete` were never clicked; `submitDocumentV2` was never
issued — and could not have been, because every session in this pass ran behind a route guard that
aborts that mutation by name. The durable footprint of the whole pass is **zero**: no `write_intents`
row for the permanent key, no transaction checkpoint. The controlled real commit stays OPEN on the
operator's unnamed §4f2 canary.

#### The honest status of doc 03c §Phase summary step 4 for chunk 5: **MET for the dry-run half**

| Asked for | Status |
|---|---|
| Every `// live-verify: 5c` write path exercised against the editable page | **MET** — both markers discharged |
| The ten controls proved to be exactly one EDITABLE node on the editable page | **MET** — four documents, two workflow steps |
| §4e's section-ownership caveat settled | **MET** — one save stands; see below |
| The nine unknown `formKey`s | **MET, and it found more than a key** — see below |
| A live dry run staging all ten, abandoned, document proved unchanged (S61) | **MET** — real doc 4524, 8.06 s, zero durable rows |
| `probeToFenceMaxMs` confirmed or tightened | **CONFIRMED at 45 s**, on a measured 11.4 s worst leg |
| The probe live | **MET for `absent`; `present` is NOT-RUN and cannot be run yet** — see below |
| The run driven through start-plan → command endpoint → worker | **NOT MET** — §9.9's two platform gaps, unchanged at the time and not this chunk's. _(Both closed 2026-08-14, D209/D210.)_ |

#### The live inventory, and one document that did not exist a week ago

The Action List holds **four** RRSS separation documents, all still open, all `Task`:

| Doc | Action id | Workflow step | Finalization state (Kuali's own model) |
|---|---|---|---|
| **4524** | `6a7e45bcbac487bbc6a2ceae` | Task 1 - Kristina & TES | **NEW** (created Aug 13) — all ten fields empty |
| 4510 | `6a7a33b2ac106d428b3217e0` | Task 1 - Jan | nine of ten populated; `timekeeperComments` empty |
| 4502 | `6a766ae6f0549046f7f0dc06` | Task 1 - Jan | only `timekeeperComments` populated |
| 4495 | `6a73abda824c9a5388e0ceaa` | Task 1 - Kristina & TES | five populated, five empty |

All three chunk-2 action ids still resolve, on the same steps §9.3 recorded — so the D129 warning
("an action id names a workflow STEP") has not yet bitten this set, and `openDocument`'s heading proof
is what makes that an observation rather than a hope.

Measured: cold login (browser launch + full SSO + Duo, hands-off) **24.1 s**; the Action List
**2.8 s**; a warm-profile document open **2.34–3.08 s**; a whole warm session (login → document →
survey → close) **8.1–8.6 s**.

#### The instrument: Kuali's own `ActionPage` query, observed and never issued

Every finding below came from a **passive** response listener on the GraphQL endpoint. Kuali issues
`ActionPage` itself on every document route open; this pass read the answer and sent nothing extra.
That single response carries three things chunk 5 needed and nothing else in the tree could give:

- `data.action.details.sectionSettings` — `edit` / `hide` **per section id, per workflow step**;
- `data.action.document.form.template` — every gadget's `formKey`, DOM `id`, `type` and owning section;
- `data.action.document.data` — the document MODEL, keyed by `formKey`, which is the same map
  `submitDocumentV2` sends.

#### 1. §4e's caveat is ANSWERED: the ten fields span three sections, and all three are `edit` at both live steps

The headline question. The ten finalization fields do **not** live in one section — they live in
three — and the sections are not the visible `<h2>`/`<h3>` headings:

| Section id | Fields it owns | `Task 1 - Jan` | `Task 1 - Kristina & TES` |
|---|---|---|---|
| `m9LaWN3zL` | `terminationEffectiveDate`, `department`, `payrollTitleCode`, `payrollTitle`, `submittedTerminationTemplate`, `transactionNumber`, `finalPay` | `edit` | `edit` |
| `cF6IPyCVw` | `requestAcknowledged`, `timekeeperName` | `edit` | `edit` |
| `a_Alfq9a2` | `timekeeperComments` | `edit` | `edit` |

Both live workflow steps served the **identical** ten-entry `sectionSettings` map (the two `hide`
entries, `4WIES6A7P` and `VhuKxRTrN`, own no finalization field). **So §4e's one-save model stands:
ONE save, ONE reload read-back, one fence, one permanent key.** Nothing is restructured, and the
§4e caveat is discharged rather than carried forward.

Two cautions that come with the answer. The mapping is *field → section id*, and a section id is a
gadget id in the form template — it is not derivable from the rendered headings, so a future check
must read it from `ActionPage`, not from the DOM. And the map is a property of the STEP: a step this
pass never stood on could still report `hide`, which is exactly why the finding is stated as "at both
live steps" rather than "always".

> **ADDENDUM 2026-08-14 — the discharge covers TEN fields, and §4e's amendment added two more.**
> `Last Day Worked` and `Separation Date` now join the staged set (§4e AMENDMENT, §9.15). They are in
> the *Employee Information* block, and **no row above names their section** — this pass read the
> `sectionSettings` map whole (twelve entries, two of them `hide`) but only mapped the ten fields it
> was staging, so which of those entries owns the two date gadgets was never determined. The caveat is
> therefore discharged for ten and OPEN for two. The instrument is unchanged and costs nothing: the
> same passive `ActionPage` read on a document open.

#### 2. All ten `formKey`s captured — and filling the table turned out NOT to be a one-line change

§9.10 recorded "filling the table is a one-line change". The capture succeeded on the first attempt
and the sentence was still wrong, which is the most useful thing this pass found.

| Field | `formKey` | Gadget | Model value, live |
|---|---|---|---|
| `payrollTitleCode` | `2FlOeR5pd9` | Text | `"004921"` |
| `payrollTitle` | `sVmpq6tG9X` | Text | `"STDT 2"` |
| `timekeeperName` | `QGJ63YrCom` | Textarea | `"Julian Zaw"` |
| `transactionNumber` | `wPyuyY0wT0` | Text | `"T002209631"` |
| `timekeeperComments` | `J_upFRq074` | Textarea | `"Hold off entering this termination…"` |
| `department` | `JPYGckVxcf` | Dropdown | `{"id":"GfKti1EX5VL","label":"000412 - Housing/Dining/Hospitality"}` |
| `terminationEffectiveDate` | `DoWSfJhpRm` | Date | `1781136000000` — epoch ms at UTC midnight |
| `requestAcknowledged` | `xKRU6vmYSY` | Checkboxes | `[{"id":"5ZaHvv-OLS","label":"Request Acknowledged - In Progress"}]` |
| `submittedTerminationTemplate` | `6Ejy-1rfQJ` | Checkboxes | `[{"id":"y_VXzkty8","label":"Submitted Termination Template"}]` |
| `finalPay` | `8CXaCSIvx5` | Radios | `{"id":"s9ziHeMcl","label":"Does not need Final Pay (student employee)"}` |

**The extraction validated itself before it was trusted:** `timekeeperName` came back `QGJ63YrCom`,
byte-identical to the 2026-08-04 capture D135 then confirmed on the wire, and still not the DOM id
`BWmkKqx40`. The Date reading was confirmed on two independent documents (4510's 06/11/2026 →
`1781136000000`; 4524's 06/18/2026 → `1781740800000`).

**Why that is not enough.** `submitDocumentV2` sends the document MODEL, and the model holds ten
values of five different shapes. Writing the nine keys into the table and leaving the comparison as
`data[formKey] === "<the staged string>"` would have made the wire check **unable to pass** for six of
ten fields — turning every landed save into a post-fence PARK. A check that can only fail is the same
defect as a check that cannot, pointed the other way.

The tempting middle ground — compare the option `label` — is provably wrong too, and one live fact
settles it: the `Department*` option `000719 -  Supply Chain Services` carries a **double space** in
Kuali's model, while the driver reads options through `HTMLOptionElement.text`, which collapses
whitespace. (The same live capture shows `Student Title Code` options carrying literal TABs, so this
is a property of the form, not of one option.) Comparing the option `id` instead would need a
declared option-id table Kuali can republish at will.

So the fix ships **five** asserted fields, not ten: `KUALI_RRSS_FINALIZATION_WIRE_ASSERTED` names the
`Text`/`Textarea` five whose expected wire value is the staged string with no transformation, and
`kualiFinalizationWireUnasserted()` names the other five and says why. That is up from ONE, and the
remaining five close at the controlled commit — by **observing** the real payload, which is the only
evidence that can settle them. The landing proof is untouched and always was the reload read-back
over all ten fields.

Two smaller findings fell out of the same reading. The old table's comment claimed `commit` "refuses
to click Save while any staged field's key is unknown" — **it never did**; `stagedWireValues` simply
skipped the null keys. And the correction is moot now, but a comment asserting a fail-closed
behaviour the code does not have is worse than no comment at all.

#### 3. The write surface is live-verified EDITABLE

On all four documents and both workflow steps, each of the ten controls resolved to **exactly one**
node that was neither `disabled` nor `readOnly` (`isEditable()` for the text controls, `isEnabled()`
for the select, checkboxes and radio). §9.10's caveat — *a selector mapped on a read-only record is
not a verified selector for the editable page* — is discharged.

The registry now says so in a way `exactly-one-visible` could not: a new
`exactly-one-editable` assertion arm, carried by nine of the ten in
`evidence/ui/kuali/separation-document.live.json` at `verifiedAt: 2026-08-14`. The tenth,
`timekeeper-field`, is deliberately left on the 2026-08-04 write pair, where it already carries the
strongest evidence in this tree — D135's controlled commit. **`externalWriteAttempted` stays `false`
in every manifest**: a staged value a reload discards is not an external write.

> **ADDENDUM 2026-08-14 — two of the twelve staged controls are NOT covered by this.**
> `kuali.rrss-document.last-day-worked-field` and `kuali.rrss-document.separation-date-field` carry
> `exactly-one-visible` only, from the 2026-08-12 read-only pass, and §4e's amendment now writes both.
> The manifest is deliberately left as it stands: upgrading an assertion arm nothing verified would
> be fabricating exactly the evidence D208 exists to distinguish. Both driver write paths carry
> `// live-verify: next-live-pass`, and the `stageText` read-back is what makes shipping them safe in
> the meantime — a control that does not take the value refuses by name (`stage-not-persisted`) with
> zero fence and zero click.

#### 4. The live dry run — S61 proved on a real document

`executeDryRun` on real doc **4524** (EID `10630962`), driven through the REAL write sequencer over a
real authority database with the REAL Playwright driver:

| Leg | Measured |
|---|---|
| preview: open → stage all ten → read all ten back → beat-③ subject observation | **8.06 s** (warm session) |
| the abandon: hard reload + whole-form re-read through `readSeparationDocument` | **5.14 s** |
| whole harness, login to close | **13.20 s** |

The preview returned `kind: "transaction-dry-run-preview"`, `subject.state: "match"`, a
`stagedPageState` of `kuali.rrss-document.finalization-staged`, `previousFields` recording the
document's exact prior state (five blanks, `- - -`, two unchecked boxes, no radio) and `stagedFields`
carrying all ten staged values. Then:

- **zero `write_intents` rows for the permanent key** `kuali:4524|finalization|T009999999`;
- **zero transaction checkpoints**;
- and the hard reload re-read the document with **every one of the ten controls back to its prior
  value** — five `absent`, the department on `- - -`, both checkboxes `false`, no radio selected.

That last line is §4e/S61's whole point and is the check legacy's own dry run never did: legacy's dry
run leaves the timekeeper name and a `similar`-tier name rewrite on a live Kuali draft.

**One real defect the preview exposed.** `observedDepartmentOptions` came back with
`000719 - Supply Chain Services` — a SINGLE space — while §9.3's capture, Kuali's form model and the
DOM's `textContent` all carry a double space. The cause is `HTMLOptionElement.text`, which
strips-and-collapses. It is **not** a bug in the run: `separations-kuali-read` reads options through
the same `readSelect`, so the fold's input, the fold's output and the prepare's S55 check are all on
the normalized form and agree with each other — and 5b's fixtures already use the single-space
spelling. What is wrong is §9.11's sentence claiming the text is served "verbatim … with a double
space": the DOM serves it that way and this driver has never returned it that way. Corrected here
rather than in the code, because changing the read to `textContent` would move a value every stored
chunk-2 receipt binds — and would put the pipeline on a spelling the `selectOption({label})` staging
cannot match.

#### 5. The probe live — `absent` twice, and `present` is structurally NOT-RUN

`readSavedSeparationFinalization` + `kualiFinalizationVerdict` against two real documents:

| Case | Read-back | Verdict | Time |
|---|---|---|---|
| doc **4510**, probed with its nine real values and a comments string it does not carry | `absent` | `absent` | **3.13 s** |
| doc **4524**, probed with the dry run's ten values | `absent` | `absent` | **3.30 s** |

4510 is the useful one: it is the near-identity case, and the read-back named **exactly one**
mismatch — `timekeeperComments`, `expected: "chunk 5c probe — …"`, `observed: "<empty>"` — while
reporting the other nine fields verbatim and equal. That is the ten-field comparison working on real
data, and it is also the strongest available evidence that a `present` verdict would be reached if a
document carried the run's exact field set.

**`present` is NOT-RUN, and it cannot be run before the controlled commit.** Two independent reasons,
both structural rather than accidental: no live document carries a finalization this repository
composed (only a real save produces one), and `timekeeperComments` is a required ≥1-character
variable, so doc 4510 — which is finalized with **empty** comments — cannot be probed with its own
exact field set at all. Worth carrying into chunk 6 as a live fact about the contract: **a document
finalized with no timekeeper comment can never be probed `present`.** For runs of this workflow that
is harmless (the run always composes a non-empty comment), and it means the `already-present` arm's
live proof belongs to the first document this repository finalizes.

#### 6. `probeToFenceMaxMs` — CONFIRMED at 45 s

The bound covers probe-complete → fence, on a session already in hand, so login is out of scope.
Measured worst legs: probe **3.30 s** + prepare **8.06 s** = **11.4 s**, against a shipped bound of
**45 000 ms** — roughly **4x headroom**, on a prepare that stages ten controls where D135's measured
one staged a single field. A cold document open adds ~1 s. The value is **unchanged**; tightening it
on one warm measurement would be trading real headroom for nothing, and chunk 4 kept its own bound at
1.8x on the same argument.

Per-beat spans are still **not obtainable** — `executeDryRun` runs the prepare arm only and emits no
spans (§9.9 gap 2). The number above is therefore an end-to-end measurement of the two legs
separately, exactly as chunk 4 recorded, not a decomposition off the run's own spans.

#### What is honestly NOT RUN

1. **The controlled real commit.** Out of scope by the chunk's absolute rule and open on the
   operator's §4f2 canary. Doc **4524** is the natural candidate and is recorded as such, not chosen:
   it is a fresh separation with all ten fields empty, so a finalization on it writes nothing over an
   operator's work and its whole prior state is `previousFields`' five blanks.
2. **The wire shapes of the five unasserted fields.** Only the commit can see the real payload. The
   zero-write instrument D135 recorded — routing `submitDocumentV2` to `route.abort()` and reading the
   payload Kuali WOULD have sent — is the right tool and was deliberately NOT used here, because it
   requires clicking `Save`, and this chunk's rule is that `Save` is never clicked. **It is the
   recommended first step of the controlled commit**: one aborted save answers all five shapes before
   a single byte reaches Kuali.
3. **A `present` probe verdict** — structurally unreachable, above.
4. **The pipeline half** (start-plan → command → worker). _(Both blockers CLOSED 2026-08-14 by
   D209/D210 — see §9.9's status block. At the time of this pass §9.9's two platform gaps were
   unchanged: `supportsDryRun` read `descriptor.surfaces.inputRun?.supportsDryRun` and this
   descriptor has `surfaces: {}`, and the interpreter had no dry-run preview arm. Neither was chunk
   5's to move; running the COMPOSED workflow through the now-open pipeline is chunk 6's proof.)_
5. **`recoveryAbsence: "stabilized"`'s confirmation.** D207 made the transferred window provisional
   until this write's own controlled-commit proof; nothing here could confirm it, because a dry run
   fences nothing and therefore measures no propagation window.
6. **A step where a finalization section reports `hide`.** Both live steps report `edit` throughout;
   no document in the operator's Action List sits anywhere else.

#### What chunk 6 inherits from this pass

- The controlled commit, with doc 4524 recorded as the candidate and the `route.abort()` payload read
  as its recommended first beat.
- The five unasserted wire shapes, closed by that same beat.
- The `already-present` arm's live proof, reachable only after the first real finalization.
- D207's provisional `stabilized` window, confirmed by the same commit.
- §9.11's two carried items — **BOTH CLOSED 2026-08-14 by chunk 6a (§9.13, D211)**: the resolved
  department option is now rendered INTO ref write-safety §14.2's packet through the write-plan block, and the
  `(transactionNumber, approvalStatus)` receipt pair is bound by the composition's own
  `verify-termination-receipt` node between the two writes.

---

### 9.13 Chunk 6a — the COMPOSITION, as built (2026-08-14)

**BUILD ONLY. Nothing here has touched the live system.** 6a is the composition; the live pipeline
dry run is 6b, and the controlled real commits stay open on the operator's §4f2 canaries.

**What landed.** `separations` is registered: **eighteen nodes**, one ALWAYS-GATE and three
transaction nodes, assembled from the tasks the five sub-workflow descriptors made provable. §5 item
10's recorded answer applied exactly — **one descriptor over reused tasks, no delegation**, the
`ChildRunExecutor` seam untouched. **Zero new store tasks were minted for the browser half:** every
page this workflow visits was already mapped, live-verified and proved by a chunk. What 6a adds is
five pure folds, and each is a decision only a graph holding ALL of the reads can make.

#### The node graph

| Node | Kind | `dependsOn` | What it is |
|---|---|---|---|
| `document` | step `kuali/read-separation-document` | — | chunk 2's whole-form read, reused |
| `plan` | step `workflow:separations/read-separation-plan` | `document` | **new**: the name, the two Kuali dates, S7's refusal, the Kronos window |
| `termination-type` | step `workflow:separations/match-termination-type` | `document` | chunk 2's §4a fold, reused |
| `name-search` | step `ucpath/search-person-org` | `plan` | chunk 3's read, reused — unconditional, `keepNonHdh: true` |
| `subject` | step `workflow:separations/match-separation-subject` | `document`, `plan`, `name-search` | **new**: S18/S19's fork |
| `job-summary` | step `ucpath/read-job-summary` | `subject` | chunk 3's read, reused |
| `employment` | step `workflow:separations/match-active-employment` | `document`, `job-summary` | **new**: S23/S24, the one row filed against |
| `department-option` | step `workflow:separations/match-department-option` | `document`, `employment` | chunk 5's S55 fold, reused |
| `timecard-search` | step `new-kronos/search-employee` (`always-rerun`) | `subject` | chunk 1's read, reused |
| `timecard` | step `new-kronos/read-separation-timecard` | `subject`, `plan`, `timecard-search` | chunk 1's read, reused |
| `dates` | step `workflow:separations/read-separation-dates` | `plan`, `timecard` | **new**: the write's payload and the two comment texts |
| `comparison` | step `workflow:separations/match-identity` | `document`, `plan`, `subject`, `job-summary`, `name-search`, `termination-type`, `department-option`, `employment`, `dates` | chunk 3's packet fold — now carrying the WRITE PLAN |
| `identity-approval` | **gate**, `resolvedBy: operator` | `comparison` | ref write-safety §14's ALWAYS-GATE |
| `approval` | step `workflow:separations/verify-identity-approval` (`always-rerun`) | `comparison`, `identity-approval` | chunk 3's post-gate check, reused |
| `clear-pending` | **transaction** | `approval` | chunk 4's sweep: `stage-pending-termination-sweep` → `delete-pending-terminations` |
| `file-termination` | **transaction** | `approval`, `termination-type`, `employment`, `dates`, `clear-pending` | chunk 4's filing: `stage-termination` → `create-termination` |
| `receipt` | step `workflow:separations/verify-termination-receipt` (`always-rerun`) | `approval`, `dates`, `file-termination` | **new**: D130's receipt PAIR, checked |
| `finalize-kuali` | **transaction** | `approval`, `document`, `plan`, `employment`, `department-option`, `dates`, `receipt` | chunk 5's finalization: `stage-` → `save-separation-finalization` |
| *(terminal result)* | — | `approval`, `employment`, `department-option`, `dates`, `receipt`, `clear-pending`, `file-termination`, `finalize-kuali` | |

Each transaction keeps the probe policy and the measured `probeToFenceMaxMs` its own chunk proved:
`clear-pending` 90 s, `file-termination` 120 s, `finalize-kuali` 45 s. All three declare
`dryRun: "stop-after-prepare"`, which is what makes the graph dry-startable at all (D209).

#### Item 10, as applied

The answer is **no delegation**, and it is applied literally: no `child-run` node exists in this
graph, `composeWorkerRuntime` still supplies no `ChildRunExecutor`, and §3.1's lego recomposition is
what the table above IS — a descriptor assembled from proven store tasks. Legacy's one conditional
delegation (person-lookup on the blank/short-EID arm) is replaced by the `subject` fold, which
resolves inline and hands the candidates to the ALWAYS-GATE packet the operator sees on every run
anyway.

#### Six decisions 6a made inside the answers, each recoverable if the orchestrator disagrees

1. **The gate packet carries a WRITE PLAN, and it is part of the digest.** §9.7 and §9.11 each left
   the same open item ("the resolved value is a gate DEPENDENCY and is not yet rendered INTO §14.2's
   packet"). `SeparationWritePlanSchema` closes both: the template, the reason code, the empl record,
   the department option, the payroll title, both dates and the comment text ride INSIDE
   `IdentityEvidencePacketSchema`, so §14.5's digest binds the approval to the values the writes will
   consume. A reconciled date that moves after approval now re-opens the gate. Before this, approving
   a person and approving a date were the same click. The `not-composed` arm is REQUIRED with a
   stated reason, so the three sub-workflow harnesses each say in a sentence why they hold no plan.
2. **The timekeeper name is INGRESS, not config.** Legacy reads `TIMEKEEPER_NAME` from the
   environment; chunk 5's descriptor already takes it as a per-run variable, and this follows it. A
   value retained in the canonical input is one `explain run` can show for the run that used it,
   where an env read is a fact about a machine. `config.operator.timekeeperName` exists and is
   deliberately not used — recoverable either way, and the cost of moving is one ingress field.
3. **`match-active-employment` refuses BEFORE the gate on `no-active-job`.** Chunk 3 deliberately
   does NOT decide "already terminated", and that is right for a workflow whose product is an
   approved subject and that files nothing. The composition files, and a grid it cannot reduce to one
   row is a run that cannot compute what it is about to write — so it refuses where chunk 4's
   `termination-type` and chunk 5's `department-option` do, for their reason: a refusal the operator
   cannot act on should not cost them a decision first. The gate still shows every row, because
   `match-identity` carries the whole classification.
4. **A card that opened with NO punch REFUSES (`no-punch-in-window`).** §4b hard-fails every way the
   READ can go wrong; this is the one arm where the read succeeded and still established no worked
   day. Filing the Kuali-carried LDW there is the fallback the operator's answer removed. The
   distinction survives in the timecard output — `hasPunches` separates S38 from every failure — which
   is what a future §3.1 recomposition would select on.
5. **The Kuali finalization comment ALWAYS carries a line naming the filed transaction.** Legacy
   leaves the control untouched when no date moved, but §4e makes the comments one of the ten fields
   ONE save writes and `KualiFinalizationCommentsSchema` requires a non-empty value. §9.12 recorded
   the live consequence of the alternative: a document finalized with an EMPTY comment can never be
   probed `present`. The sentence is modelled on legacy's own `buildDuplicateTerminationComment`.
6. **The month shift CLAMPS where legacy's `setMonth` overflows.** `Mar 31 − 1 month` lands on Mar 3
   in legacy and on Feb 28 here. Wider is the safe direction for a READ window: the fold takes the
   LAST punch, so extra leading days cannot change an answer while missing trailing days could.

#### What the guards say, and what needed no change

- **`identity-gate-before-commit` needed NO change**, and that is the interesting part. It audits
  both sinks (D202) and now walks three transaction nodes plus the terminal result. It passes because
  everything the gate must have seen depends INTO `comparison`, so the gate's own ancestry IS the
  whole read half — there is no side read anywhere for a write to consume.
- The graph carries **no branch, no parallel and no `when`**, which is §3.1 and §4d stated
  structurally rather than by discipline, and `separations/kronos-hard-fails` asserts it.
- `config/pending-impl-bindings.json` stays **empty**: every contract the descriptor names is bound.
- `guard-inventory.json` is unchanged — no guard was added, retired or re-scoped.

#### The scenario corpus — seventeen scenarios, one file

Fourteen coverage points derive from the graph (the gate's two, and four per transaction node) and
all fourteen are claimed.

| Scenario | Kind | Coverage points | S-numbers |
|---|---|---|---|
| `plan-refusals` | fold walk | — | **S7** |
| `subject-resolution` | fold walk | — | **S18/S19** |
| `employment-refusals` | fold walk | — | **S21–S24** |
| `date-reconciliation` | fold walk | — | **S39**, §9.1's Observed answer |
| `receipt-refusals` | fold walk | — | **D130**, S46 |
| `kronos-hard-fails` | fold walk | — | **S34–S38**, §4b, §4d |
| `re-read-is-a-new-item` | pure | — | the re-run wall, item 2 |
| `dry-run-preview` | sequencer walk | `clear-pending`/`file-termination`/`finalize-kuali` `/dry-run` | **S61** |
| `subject-mismatch` | sequencer walk | the same three `/subject-mismatch` | **S17**'s control, at three fences |
| `pending-sweep-committed` | sequencer walk | `clear-pending/committed` | **S30/S31** |
| `pending-sweep-nothing-to-do` | sequencer walk | `clear-pending/already-present` | **S31** |
| `termination-committed` | sequencer walk | `file-termination/committed` | the happy path |
| `termination-already-present` | sequencer walk | `file-termination/already-present` | **S27/S44** |
| `finalization-committed` | sequencer walk | `finalize-kuali/committed` | §4e's one save |
| `finalization-already-present` | sequencer walk | `finalize-kuali/already-present` | idempotent re-run |
| `finalization-parks-after-termination` | sequencer walk | — | **§4c / S57 / S60** |
| `gate-approved` | pure graph walk | `gate:identity-approval/opened`, `/resolved` | **S14–S17**, §14.5 |

**§4c is asserted in ONE run**, which is why the harness holds both browsers: the UCPath termination
commits for real, the Kuali save lands nothing, and what has to be true afterwards is a settled
termination checkpoint (carrying the receipt PAIR) beside a `parked`/`unknown` finalization intent
with no checkpoint over it. Two harnesses could only assert that separately, which is the state the
operator's head was holding in the first place.

**§4c's honest as-built.** A post-fence Kuali uncertainty PARKS, exactly as §4c asks. A PRE-fence
refusal after the termination committed (S55's unmatched department option, S56's moved comments)
terminalizes `failed` — and the receipt pair is durable on `file-termination`'s own checkpoint before
`finalize-kuali` is ever entered, which is what §4c means by "durable authority rather than a
remembered fact". A retry of the same item replays that checkpoint and re-enters only the
finalization, under its own permanent key, with the gate re-crossed (§4d). There is no general
"park a run at a node" mechanism in this platform and 6a does not invent one.

#### The re-read affordance, as built

§"the re-run wall" item 2 asks for a way for an operator to say *read it again*. The ingress gains an
optional `reRead: { ordinal, reason }`, and `matchKey` becomes
`separations:<document>` or `separations:<document>#re-read-<ordinal>`. Three consequences, each
pinned by a test:

- a re-read is a **new logical item**, so it has its own checkpoints and its own gate — the
  `observedAt`-differs-by-construction collision chunks 2 and 3 both hit cannot arise;
- the same ordinal is the same item, so a re-read is a **decision** rather than a nonce;
- it changes **no permanent key**. Those derive from the EID, the effective date and the document, so
  a re-read can never file a second termination — ref write-safety's same-key mutex refuses the second fence.

The `reason` rides in the canonical input, so `explain run` answers *why was this document read
again* without archaeology. **What it does NOT do:** `reject-active` is per ITEM, so a re-read may be
enqueued while the original run is still active. The permanent-key mutex is what makes that safe, and
it is stated here rather than papered over.

#### The wire, verified rather than built

§3's rule is *"verify that; do not build it"*, and
`tests/unit/separations-composition-wire.test.ts` is that verification — no new server surface:

- the REAL start-plan service plans one item per document, refuses a bad submission retaining its
  exact raw bytes (D109), and admits a dry run at `{state:"supported", stopsAt:"clear-pending"}`;
- the REAL run-detail `identity-gate` section serves the whole packet **including the write plan**,
  with the exact `resultSchemaHash` `executeResolveGate` will demand, and a command built straight
  off the payload parses through `CommandRequestSchema` unchanged;
- the gate's `dependsOn` resolves to **exactly one** node holding an identity packet, which is what
  `buildIdentityGatePayload` requires and what the composed graph satisfies by shape.

#### The parity delta, and the verification of its class

Registering the descriptor moved **twelve** references, all `explorer-graph` / `explorer-transaction`;
the other 135 checks passed untouched. The a11y diff is exactly two things: eight
`+ button "separations"` lines (the new registration's own entry in the explorer's workflow list) and
four lines where `separations-identity-check`'s contract fingerprint moved `96b114e04610` →
`2f4a394e433a` with its closure file count 38 → 39, because `write-plan.ts` joined its import closure.
Its result hash is unchanged. PNG deltas appear only on those same two surfaces. That is the
sanctioned mechanical class in §3's own words — a registry stamp plus a fingerprint line — and it was
re-frozen with `npm run test:parity:update`.

#### What 6b owes — the live-proof list

1. **The composed dry run through the REAL pipeline** — start-plan → command endpoint → worker →
   interpreter → `executeDryRun` → `transaction.previewed` → terminal preview record (D209/D210).
   §9.12 named this as chunk 6's proof, and it is now unblocked. It must reach the gate, park, take a
   real approval through the real command endpoint, resume, and stop at `clear-pending` with **zero**
   `write_intents`, **zero** transaction checkpoints and **zero** outbox rows for all three permanent
   keys.
2. **The §14.2 packet's NEW fields visible in the gate wire on a live run** — `plan.state: "planned"`
   carrying the template, the reason code, the department option, the reconciled dates and the
   unclassified pay codes. The unit lane proves the shape; only a live run proves the values a real
   document produces.
3. **The end-to-end read chain on one real subject**: a real Kuali document → the plan → a real name
   search → the subject → a real Job Summary → the employment row → the department option → a real
   New Kronos timecard → the reconciled dates. Every one of these pages is individually live-proved;
   what has never run is the CHAIN, and the chain is where a value one chunk produces meets the
   schema another chunk expects.
4. **`probeToFenceMaxMs` off the run's own per-beat spans** for all three nodes — §4f3's follow-up,
   still open because `executeDryRun` emits no spans (§9.12 item 6); D210's interpreter arm is what
   makes it reachable.
5. **A measured cost for the gate-resume re-run of `timecard-search`** — it is `always-rerun` by
   chunk 1's rule (a node whose product is BROWSER state may not be `replay: "checkpoint"`), so a
   gated run pays one New Kronos session on resume. The number is unknown and worth having.
6. **The four items chunk 5c handed forward**, unchanged: the controlled real commits (doc 4524
   recorded as the natural Kuali candidate, with the `route.abort()` payload read as the recommended
   first beat), the five unasserted Kuali wire shapes, the `already-present` arm's live proof, and
   D207's provisional `stabilized` window.

> **ADDENDUM 2026-08-14 — §4e's amendment grows the `finalize-kuali` node's staged set to TWELVE**
> (§9.15, **D217**). The graph is otherwise unchanged: the node already `dependsOn` the `dates` node,
> so the two write-backs bind from outputs the composition already had, and no node, edge, gate,
> permanent key or `dependsOn` moved. Two consequences for this list. Item 6 grows from four items to
> **seven** — the two uncaptured `formKey`s, the two controls' editability, and the section that owns
> them all close on the same live pass. And item 2's live gate-wire capture gains a second reading:
> `dates.lastDayWorked` / `dates.separationDate` are no longer only *what the UCPath filing consumes*,
> they are also *what the Kuali document will be set to*, so the digest the approval binds to now
> covers the Kuali write-back as well. Nothing was added to the packet to achieve that — the values
> were already inside it (D211).

Also honestly NOT RUN: any real write of any kind, and any case where the document's EID is blank
(every live document observed so far carries one), so `subject`'s `name-resolved` arm and its
`type-the-eid` gate shape are test-pinned rather than live-verified.

---

### 9.14 Chunk 6b — the composed live pass, 2026-08-14: what ran, what it found, and what is genuinely blocked

Read-only and dry-run against production, Duo cleared hands-off by Duo Autopilot. **Nothing was
submitted, saved or finalized.** `Delete Selected Transactions`, `Save and Submit` and Kuali `Save`
were never clicked; every run carried `dryRun: true` and D210's `stop-after-prepare`. Six runs over
four real Kuali documents. **The durable footprint is `absent`, asserted against the authority
database rather than logs: zero `write_intents`, zero `write_attempts`, zero `durable_outbox` rows
since 2026-08-05, and ZERO checkpoints for `clear-pending`, `file-termination` or `finalize-kuali`
across every run this database has ever held.** The only two `write_intents` rows in the file are
2026-08-04's Phase-2 controlled commit, untouched.

#### The honest status of doc 03c §Phase summary step 4 for chunk 6: **PARTLY MET**

| Asked for | Status |
|---|---|
| The composed graph driven start-plan → command endpoint → worker → interpreter, live | **MET** — three runs planned through the REAL `/api/v1/start-plans` and started through the REAL `/api/v1/commands`, no harness anywhere |
| The whole read chain live on one real subject, end to end | **MET, twice, on two different subjects** — thirteen nodes from the Kuali document to the identity packet, once on doc 4502 / EID 10001754 and once on doc 4524 / EID 10630962 |
| Park at the ALWAYS-GATE, take a REAL approval through the real command endpoint, resume | **MET, twice** — `parked-gate`, packet served, `resolve-gate` applied, run re-claimed and resumed |
| The §14.2 packet's new fields visible on the live gate wire | **MET** — captured below, verbatim from the wire at the park |
| Structural commit-freedom proved from durable state | **MET** — see the absence proof above |
| Preview `clear-pending` (`transaction.previewed`) and reach an honest preview terminal | **NOT MET** — blocked twice, by two independent defects named below; **neither is a write-safety failure** |
| `probeToFenceMaxMs` off the run's own per-beat spans | **NOT MET, unchanged** — no transaction node ever emitted a span, because none ever settled a preview. §9.12 item 6 and §4f3 stay open with a new reason |
| A measured cost for the gate-resume re-run of `timecard-search` | **MET** — 30.4 s, measured twice |

#### The two things that stop the preview, and neither of them is the writes

**1. The dry run previews a path the real run would never take (§9.9's recorded state, now
consequential).** Doc 4502's subject is Cramia, Dreitho — one active employment and **no pending
transaction**. `executeDryRun` evaluates `clear-pending`'s PREPARE without its probe, so the sweep
staged against a *Transactions in Progress* grid holding no row for the subject and refused, exactly
and verbatim as §9.9 predicted: *"the Transactions in Progress grid renders no name beside Empl ID
10001754; there is no subject on this page to bind a sweep to"*, `writeState: not-attempted`. §9.9
called that state "unreachable on the real path", and that is TRUE — the probe settles
`already-present` first — which is precisely what makes it a problem here: **the composed dry run
reports a failure the real run would never produce.** A rehearsal that fails where the performance
succeeds is a false rehearsal, and the ordinary separation subject has no pending transaction, so
this is the COMMON case, not the corner. It is recorded rather than fixed because running the probe
inside `executeDryRun` changes what D210's `stop-after-prepare` means and belongs to ref write-safety's owner,
not to a live-proof slice.

**RESOLVED (D215).** The owner's answer is that it does NOT change what `stop-after-prepare` means —
it completes it. `stop-after-prepare` names where a preview STOPS, and beat ① runs before prepare on
the real path, so a preview that skipped it was stopping in the right place having started in the
wrong one. `executeDryRun` now runs the durable permanent-key lookup and the policy-controlled live
probe in the real path's order, REPORTS an `already-present` settlement instead of performing one
(zero intent, zero checkpoint, zero run transition), and refuses on exactly the verdicts the real
path refuses on. `TransactionDryRunPreview` gained a `probe` observation and an outcome union whose
`would-prepare` arm owns `prepare` and `subject`, so a preview that staged nothing cannot spell an
empty staged page. Both subject shapes are now walked by `separations/dry-run-preview` — a subject
WITH a pending row stages, the ordinary subject settles `already-present` — with zero durable rows
asserted in both.

The two subjects mapped so far are jointly unsatisfiable on exactly what the preview needs: **10001799**
(doc 4510) HAS the pending `T002209631` and is already terminated, so `match-active-employment`
refuses `no-active-job` before the gate (§9.13 decision 3); **10001754** (doc 4502) has the active job
and no pending row. A subject with BOTH has not been observed.

**2. `always-rerun` collides with its own checkpoint across a gate resume — so the composed workflow
cannot pass its own gate on the normal path.** A checkpoint's durable key is
`(workflowId, itemId, nodeId, attempt)` (`checkpointLookupKey`), and a gate resume advances **no**
attempt: the run parks and is re-claimed inside the same one. `timecard-search` is `always-rerun` by
chunk 1's rule (a node whose product is BROWSER state may not be `replay: "checkpoint"`), so on
resume it re-executes, produces a genuinely different observation, and `run_checkpoints.insert`
refuses by name — `run checkpoint separations 2ebcfbf7… timecard-search 1 already exists with
different content` — terminalizing the run `failed` one node after the approval. Doc 4524's run died
there.

Doc 4502's run got past it **by accident**: the earlier attempt's worker was killed mid-slice, D200's
startup self-sweep requeued the row, and the requeue bumped the attempt to 2 — so its resume wrote
`timecard-search` under a key nothing owned. A crash is not a recovery path, and without it the
identical collision waits.

The same absence has a second face worth naming: both executions emitted the span `…/timecard-search#1`,
so the two are indistinguishable in the timeline as well as in authority. **A gate resume advances no
execution counter, so a re-executed node is identical to its first execution in every identity this
platform has.** That is a ref workflow-model replay-contract question with at least three candidate answers (an
always-rerun node writes no checkpoint at all; the key carries an execution ordinal; the resume
advances the attempt), each with consequences for evidence and for D110/D114 terminal dependencies.
It is named here and left to its owner; inventing replay semantics inside a live-proof slice is not
this slice's job.

#### The composed read chain, live, on two real subjects

Doc **4524** is the clean single-run measurement — cold sessions on all three systems, claim to gate:

| Node | Wall | Notes |
|---|---|---|
| `document` | **6.06 s** | Kuali session + `ActionPage` open |
| `plan` | 9 ms | pure fold |
| `termination-type` | 2 ms | pure fold |
| `name-search` | **33.48 s** | includes the cold UCPath SSO + Duo session |
| `subject` | 2 ms | pure fold |
| `job-summary` | **5.20 s** | |
| `employment` | 3 ms | pure fold |
| `department-option` | 3 ms | pure fold |
| `timecard-search` | **30.18 s** | includes the cold New Kronos session (~27 s of it) |
| `timecard` | **7.24 s** | |
| `dates` | 2 ms | pure fold |
| `comparison` | 13 ms | pure fold |
| **claim → `gate.opened`** | **82.23 s** | thirteen nodes, three browsers, one real subject |

Doc **4502**'s chain ran the same nodes across two runs and agrees within the noise of a session
login: `document` 6.123 s / `plan` 5 ms / `termination-type` 1 ms; `name-search` **23.492 s**;
`job-summary` 4.014 s; `timecard-search` **29.263 s**; `timecard` 7.625 s; every fold ≤ 8 ms. Claim
to `gate.opened`, **64.4 s**. The three long nodes are the three nodes that open a browser session,
and nothing else in the chain costs more than 8 s.

**The `always-rerun` cost on gate resume — the answer to §9.13 item 5: 30.4 s.** Measured twice
independently and they agree: 30.385 s on doc 4502's resume, 30.481 s on doc 4524's. It is almost
entirely a fresh New Kronos browser session — the session span opens ~27 s into the node and the
search itself takes ~3 s — so the number is a login cost, not a search cost, and it is the price of
chunk 1's rule rather than of anything this composition does.

#### The §14.2 packet as the wire served it at the park (doc 4524, redacted)

`GET /api/v1/runs/{runId}/identity-gate`, while the run sat `parked-gate`:

```
gateId            identity-approval          parkedAt   2026-08-14T15:08:29.586Z
resumeAt          approval                   expectedVersion 46
resultSchemaHash  2165f585c743…              evidenceDigest  61c1f7a5abcd…
approvalShape     one-click                  approvableEids  [10630962]
```

The comparisons agreed on all four fields (`name` — `Ezeunala, Chimdaalu Kristine` against UCPath's
`Chimdaalu Ezeunala`, tier `same`; `eid`; `employment` — `single-active-job — 1 active of 3
employment rows`; `name-search` — the document's name resolving to the same person its EID does).
`jobs` carried all three rows verbatim with one `unreadableCells` entry
(`row 1 (empl record 2): Expected Job End Date`), which is **D201's `{state, reason}` arm live**: a
descriptive cell the extraction could not read is DATA, and only the consumer that needs it refuses.

**D211's write plan rode inside the packet, which is the thing 6a built and this is its first live
sighting** — `plan.state: "planned"`, carrying every value the three writes will consume:

| Field | Live value |
|---|---|
| `termination.terminationType` | `Graduated/No longer a Student` |
| `termination.classification` / `template` | `involuntary` / **`UC_INVOL_TERM`** |
| `termination.reasonCode` | **`No Longer Student`** |
| `termination.emplRecord` | `3` |
| `termination.effectiveDate` / `lastDateWorked` | `07/04/2026` / `06/18/2026` |
| `document.department` | **`000412 - Housing/Dining/Hospitality`** (code `000412`) |
| `document.payrollTitleCode` / `payrollTitle` | `004920` / `STDT 3` |
| `dates.kualiSeparationDate` → `dates.separationDate` | `06/18/2026` → **`07/03/2026`**, `separationDateChanged: true` |
| `dates.separationDeterminingLeave` | **`holiday`** |
| `dates.unclassifiedPayCodes` | **`["Juneteenth Observed", "Memorial Day"]`** |
| `dates.lastDayWorked` | `06/18/2026`, `lastDayWorkedChanged: false` |

That is §9.13 item 2 met in full, and it is more than a shape check: this document's separation date
genuinely MOVED — the Kuali-carried `06/18/2026` reconciled forward to `07/03/2026` on a holiday —
and the operator saw the moved date, the template and the department **inside the digest their
approval bound to**. Before D211 the approval covered the person and not the date. Two real pay codes
came back unclassified and are named rather than folded away.

#### Three defects the pass found

1. **`new-kronos/read-separation-timecard` kept a stale grid (D212, commit `d00b66c`).** The first
   composed run ever attempted died here. Fixed and gated before the second run; the period LABEL is
   not the grid, and nothing is kept until the body repaints.
2. **The UCPath Person Org settle wait could not survive a multi-result search (D213, commit
   `1d019ee`).** Doc 4524's subject matched **four** people. `#PTS_CRITTEXT_DISP` was modelled as a
   "positive no results marker" and is in fact PeopleSoft's search-CRITERIA banner, which renders on
   every list page stating the count — live `4 results   -   Last Name "Ezeunala"   Name "Chim…"`
   directly above a populated grid. So banner and grid are visible together, `noResults.or(detail)
   .or(grid).waitFor()` runs one union locator under Playwright strict mode, and two matches is a
   throw. Behind it the classification would have refused too (`states.filter(Boolean).length !== 1`
   reads the ordinary multi-result page as ambiguous). Nothing caught it because chunks 3 and 4's two
   live subjects each matched exactly ONE person, where UCPath navigates straight to the detail page:
   only one arm had ever matched. `.first()` makes the wait ask "has any outcome rendered", and a
   pure, tested `classifyPersonOrgSearchOutcome` decides which — refusing BY NAME on a count banner
   with no grid rather than reporting not-found, because reading a four-result page as "nobody
   matched" is the silent wrong value this program forbids.
3. **§9.9's dry-run-without-probe refusal and the `always-rerun` checkpoint collision**, both above.
   Both are platform decisions rather than driver bugs, and both are left to their owners with the
   mechanism written down.

#### Two operator-surface observations, both on the generic gate panel

Neither blocks anything — 6a's dedicated `identity-gate` section was correct and complete throughout,
and it is the surface an operator uses — but both are false statements on a trust surface.

- While run `00419600` sat `parked-gate` with `identity-gate` serving the whole packet, run-detail's
  generic `gate` section answered `{state: "absent", reason: "this run declares no operator gate"}`.
  The panel's `status` read `awaiting-approval` off the authority lifecycle, so the two halves of one
  response disagreed. **Explained, and not by this workflow:** `docs/findings/dashboard-projection.md`
  (diagnosed the same day, in parallel) shows the BFF's queue projection folds only spans emitted by
  its OWN process, so `gate.opened` — emitted by the WORKER — is never seen, while `gate.resolved`
  from its own command endpoint is. `openGates` therefore stays empty for every run enqueued after the
  dashboard booted. This pass's runs are that finding's decisive evidence, and the composed descriptor
  is not implicated. It is also why the timelines quoted above are trustworthy: doc 4502's spans were
  on disk before the BFF booted.
- After resolution the same section answered `gate identity-approval resolved with key resolved,
  which is not an approve/reject verdict`. That one IS explained, and it is structural: the command
  service emits `resolutionKey: "resolved"` for EVERY gate ("until gate descriptors declare display
  keys (2h Review), the one honest key is the fact of resolution itself"), and run-detail deliberately
  refuses to coerce a non-verdict key. So **the generic gate panel can never render a verdict for any
  gate in this platform**, and the deferral that made that acceptable has shipped past the milestone
  it named. The decision is available: D204's declared `gate-decisions.ts` mapping already turns the
  stored payload into `approved`, which is what the receipt reads.

#### What the receipt says, and D204 live for the second time

`buildRunEvidenceReceipt` DERIVED for doc 4502's terminal run — 215 observations, 19 verifications,
4 decisions — with the gate decision attributed in full:

> an operator approved this identity, and the write plan it consumes, before any termination was
> filed: gate `identity-approval` was resolved `approved` by `local-operator` at
> `2026-08-14T14:05:18.250Z` through command `b6631e19…`, bound to the identity evidence it was
> granted on (evidenceDigest `157a8311…`). The approver and the instant are authority's own fields on
> the gate result record, written by the resolving command, not values the resolving payload claimed.

The durable `gate_results` row carries `decision: approved`, `eid 10001754`, `resolvedBy
local-operator`, and an `evidenceDigest` byte-identical to the `comparison` checkpoint's — **§14.5's
digest binding, proved live**. `confidence` reads `unknown` and the one warning is the failure
itself, which is the honest verdict for a run that ended before its writes. The **DRY_RUN_PREVIEW**
warning is NOT-RUN: no preview ever settled, so nothing has yet asked the receipt to carry it.

#### 9.14a The attempt record — six runs, verbatim (the §9.2a precedent)

| # | Run / trace | Doc · subject | Outcome |
|---|---|---|---|
| 1 | `1fd7b3a4` · `sp-064821-1fd7` | 4502 · 10001754 | **failed** at `timecard` after nine nodes — the stale Kronos grid. **D212**, fixed in `d00b66c` |
| 2 | `1c96fabc` · `sp-070056-1c96` | 4502 (re-read 1) | **failed** at `name-search` at **60.002 s** — D125's `timeouts.sessionAcquireMs` bound, firing as designed on a UCPath session that would not come up |
| 3 | `6a6c6f44` · `sp-070306-6a6c` | 4502 · 10001754 | retry of #2. Whole chain **done**, `gate.opened` 14:04:19, **approved live** 14:05:18. The worker was then killed by the previous session's watchdog mid-resume |
| 3′ | (same run, resumed by this pass) | | D200's startup self-sweep released the orphaned claim on the first poll and it resumed at attempt 2: `timecard-search` re-ran (30.4 s), `approval` passed in 2 ms, and `clear-pending` refused in prepare — §9.9's state. **terminal `failed`**, zero writes |
| 4 | `49f5e1ee` · `sp-075614-49f5` | 4495 | **failed** at `plan` in 26 ms: `SEPARATION_DATE_IN_FUTURE` — *"carries a Last Day Worked of 09/02/2026, which is after 08/14/2026"*. **S7 refused live for the first time**, on a real document |
| 5 | `77530d5f` · `sp-075712-7753` | 4524 · 10630962 | **failed** at `name-search` — the strict-mode violation. **D213**, fixed in `1d019ee` |
| 6 | `00419600` · `sp-080639-0041` | 4524 (re-read 1) · 10630962 | whole chain **done** in 82.2 s on the fixed driver, `gate.opened` 15:08:29, packet served, **approved live** 15:09:21, resumed — and **failed** at `timecard-search` on the checkpoint collision |

Runs 2 and 5 are why the re-read affordance exists, and both used it: `separations:4502#re-read-1`
and `separations:4524#re-read-1`, each a NEW logical item with its own checkpoints and its own gate,
each changing no permanent key, each carrying its operator reason into the canonical input where
`explain run` can answer *why was this document read again* without archaeology. §9.13's re-read
affordance is live-proved by use.

#### The live document inventory, re-observed 2026-08-14

All four action ids from §9.12 still resolve on the same steps. Subjects, now that the chain has read
them: **4502** → Cramia, Dreitho (10001754), active, no pending transaction. **4510** → Clauckia,
Drose (10001799), already terminated, holds the pending `T002209631`. **4495** → last day worked
`09/02/2026`, in the future, so the chain refuses before any subject work. **4524** → Ezeunala,
Chimdaalu Kristine (10630962), one active of three employment rows, and the only subject so far whose
name search returns more than one row.

#### What is honestly NOT RUN

- **Every real write, of every kind.** No `Delete Selected Transactions`, no `Save and Submit`, no
  Kuali `Save`. All three controlled commits stay OPEN on the operator's §4f2 canary, which is still
  unnamed. Doc 4524 remains the natural Kuali candidate (§9.12) and is now also the best-mapped
  subject.
- **`transaction.previewed`, the preview terminal, and the receipt's `DRY_RUN_PREVIEW` warning** —
  blocked by the two platform items above, not by anything in the composition.
- **`probeToFenceMaxMs` off per-beat spans** — unchanged from §9.12 item 6 and §4f3. No transaction
  node emitted a span in any of the six runs, because none settled a preview.
- **The `already-present` arm live**, D207's provisional `stabilized` window, and the five unasserted
  Kuali wire shapes — all four items chunk 5c handed forward, all still forward.
- **A blank-EID document.** All four live documents carry one, so `subject`'s `name-resolved` arm and
  its `type-the-eid` gate shape remain test-pinned. Doc 4524 came closest — a four-row name search —
  but resolved through the document's own EID.
- **The parity lane** was not re-run: another session held uncommitted dashboard edits in this shared
  working tree, and the lane rebuilds the bundle from the tree, so a re-freeze would have baked in
  someone else's work. The D213 label change was checked against the reference corpus directly and
  photographs nothing in it.

---

### 9.15 §4e's date-staging amendment, as built (2026-08-14)

**BUILD ONLY. Nothing here has touched the live system.** This is the as-built for §4e's
`AMENDMENT (operator), 2026-08-14` — the operator's answer to the question chunk 5a queued and
5a's own judgement 3 deliberately left unanswered. Ratified as **D217** (ref decisions).

**The answer, verbatim:** *"so what we are doing here is to collect all data first and then fill in
the forms at the end."* Legacy's step-13 Kuali date write-backs belong in the rebuild, as staged
variables — so the staged-variables model does not change and the staged set grows from ten to
twelve.

#### The twelve-field table, with each field's honest evidence

| # | Field | Wire shape asserted? | Live-verified EDITABLE? | `formKey` captured? |
|---|---|---|---|---|
| 1 | `department` | no — `Dropdown` holds `{id,label}` | **yes** (5c, 2026-08-14) | yes `JPYGckVxcf` |
| 2 | `payrollTitleCode` | **yes** — `Text` | **yes** (5c) | yes `2FlOeR5pd9` |
| 3 | `payrollTitle` | **yes** — `Text` | **yes** (5c) | yes `sVmpq6tG9X` |
| 4 | `requestAcknowledged` | no — `Checkboxes` holds an array of `{id,label}` | **yes** (5c) | yes `xKRU6vmYSY` |
| 5 | `timekeeperName` | **yes** — `Textarea` | **yes** — D135's controlled commit, 2026-08-04 | yes `QGJ63YrCom` |
| 6 | **`lastDayWorked`** | **no — key unknown**, and a `Date` holds epoch ms anyway | **NO** — `exactly-one-visible` only (2026-08-12) | **NO** |
| 7 | **`separationDate`** | **no — key unknown**, and a `Date` holds epoch ms anyway | **NO** — `exactly-one-visible` only (2026-08-12) | **NO** |
| 8 | `terminationEffectiveDate` | no — `Date` holds epoch ms | **yes** (5c) | yes `DoWSfJhpRm` |
| 9 | `submittedTerminationTemplate` | no — `Checkboxes` | **yes** (5c) | yes `6Ejy-1rfQJ` |
| 10 | `transactionNumber` | **yes** — `Text` | **yes** (5c) | yes `wPyuyY0wT0` |
| 11 | `finalPay` | no — `Radios` holds `{id,label}` | **yes** (5c) | yes `8CXaCSIvx5` |
| 12 | `timekeeperComments` | **yes** — `Textarea` | **yes** (5c) | yes `J_upFRq074` |

Five asserted on the wire (unchanged — the amendment adds nothing assertable), ten live-verified
editable, ten `formKey`s captured. **The two new rows are the only three-`NO` rows in the table**, and
that is stated here rather than discovered later.

#### What landed

- **`KualiFinalizationVariablesSchema` grows by two** `KualiFormDateSchema` leaves, and
  `kualiFinalizationFields` passes them through. Nine variables now, plus the same three ratified
  assertions (§4g's final-pay radio unchanged).
- **The three dates sit together in `KUALI_FINALIZATION_FIELD_NAMES`** — `lastDayWorked`,
  `separationDate`, `terminationEffectiveDate` — so a mismatch report naming two of them reads as one
  fact about the reconciliation rather than as two unrelated controls. That list is what the fill, the
  read-back and the mismatch report all walk.
- **The driver stages both through the SAME `stageText` discipline** every other text control uses:
  fill, read back, one retry through key events, then wait for Kuali's document model to take it. Both
  calls carry `// live-verify: next-live-pass`. `readFinalizationFields` reads them through the read
  family's own already-live-verified recipes; this surface mints no element.
- **`KUALI_RRSS_FINALIZATION_FORM_KEYS` admits `null`** and `kualiFinalizationFormKeysMissing()` is
  back as the derived to-do list. `stagedWireValues` now throws by name if an ASSERTED field ever has
  a null key, rather than indexing `data[undefined]` — which would turn a landed save into a
  post-fence park the day somebody adds a field to the asserted list before its key is captured.
- **The composition binds both from `outputs["dates"]`** in the `finalize-kuali` prepare and commit,
  identically. No node, edge, gate, `dependsOn` or permanent key moved — the node already depended on
  `dates`.
- **The standalone `separations-kuali-finalization` descriptor** gains the two ingress leaves, like
  every other variable no read on that graph produces.
- **`evidence-classification.ts`** declares both leaves everywhere the field set appears (the
  prepare's `previousFields` and `stagedFields`, the commit's claimed `savedState.fields`, both
  terminal results, and the standalone ingress). An undeclared leaf fails loud, so this is not
  optional bookkeeping.
- **The write plan (D211) is unchanged in shape.** `dates.lastDayWorked` / `dates.separationDate`
  were already inside `IdentityEvidencePacketSchema`, so the digest an approval binds to already
  covers what the write-back will set; the schema comment now says so. They are deliberately NOT
  repeated into the packet's `document` block — the packet is a presentation of decisions, never a
  second authority over them, and one value rendered twice is a value that can disagree with itself.

#### What the tests hold

- The fold composes twelve fields from nine variables plus three assertions; `observedExistingComments`
  is still a refusal input and never a written value.
- The two new leaves refuse an ISO spelling, a blank and a single-digit month before a control is
  touched.
- **The unconditional-staging property**, as a test rather than a sentence: the moved and unmoved
  folds have the same shape, and the comparison between them names exactly the field whose value
  differs — an unconditionally staged unchanged value reports no mismatch, which is why the
  simplification is safe.
- **§9.14's doc 4524 case, pinned**: expected `07/03/2026` against a document still holding
  `06/18/2026` is one mismatch naming `separationDate`, and a blank date control renders `<empty>`
  distinguishably from a wrong one.
- The `stage-refusals` walk drops both date controls and refuses `stage-not-persisted` — the two are
  ordinary staged fields, not a best-effort write nobody notices failing.
- The composed `finalization-committed` walk now starts from a document holding the STALE dates and
  asserts the persisted document ends up with the reconciled ones.
- Both dry-run previews (standalone and composed) assert the preview stages twelve and shows the
  reconciled separation date it WOULD write back, with zero intents, zero checkpoints and zero
  outboxes.

#### What the next live pass owes — the whole list, in one place

1. **The two controls' `sectionSettings`.** Read the section id that owns `Last Day Worked` and
   `Separation Date` off `ActionPage`'s `document.form.template`, and its `edit`/`hide` at BOTH live
   workflow steps. If either reports `hide`, §4e's caveat fires for real and this node splits into one
   (save, read-back) pair per step. Passive read, costs nothing, sends nothing.
2. **The two `formKey`s**, from the same response.
3. **`exactly-one-editable` for both controls**, added to
   `evidence/ui/kuali/separation-document.live.json` at the date it is actually observed — never
   before. `externalWriteAttempted` stays `false`; a staged value a reload discards is not a write.
4. **The controlled commit still owes the wire shapes.** Even with the two keys, a `Date` gadget's
   model value is epoch milliseconds and the staged value is `MM/DD/YYYY`, so the two join the
   recorded-not-asserted set. Only observing the real payload settles them — §9.12 item 2's rule,
   unchanged.

Everything else chunk 5c and 6b handed forward is unaffected: the controlled real commits, the five
unasserted wire shapes, the `already-present` arm's live proof, and D207's provisional `stabilized`
window.

> **CLOSED 2026-08-14 — items 1, 2 and 3 all fell out of ONE document open (§9.16).** The section is
> `eTURtLdMM` and it reports `edit` at both live steps; the keys are `ER1WhBzjcm` and `oEcp1xtQkj`;
> and both controls carry `exactly-one-editable` on two OPEN documents. Item 4 is unchanged and
> correct — the keys are captured and the SHAPES are still unasserted, which is the distinction the
> item was written to preserve.

---

### 9.16 Chunk 6b (completion) — the live read-only pass, 2026-08-14: what closed, what the canary now is, and the one thing that could not run

Read-only against production, Duo cleared hands-off by Duo Autopilot, in this pass's OWN
playwright-cli session (`s6b`) on its own profile, which was deleted afterwards. **Nothing was
submitted, saved or finalized.** `Delete Selected Transactions`, `Save and Submit` and Kuali `Save`
were never clicked, `submitDocumentV2` was never issued, and the Smart HR wizard's `Continue` was
never clicked either. Every Kuali finding below came from the same PASSIVE `ActionPage` response
listener §9.12's instrument established — Kuali issues that query itself on every document route
open; this pass read the answer and sent nothing extra.

#### The honest status of doc 03c §Phase summary step 4 for chunk 6, updated

| Asked for | Status |
|---|---|
| §9.15's three passive captures — the owning section, the two `formKey`s, `exactly-one-editable` | **MET, all three** — one document open answered all of them |
| Doc 4510 re-observed read-only on all four questions | **MET** — four verbatim answers below |
| The `already-present`-arm receipt case (platform slice 2's named gap) | **MET** — `dry-run-preview-round-trip.test.ts`, commit `b73b546` |
| The composed dry run to its preview terminal through the REAL pipeline | **NOT RUN** — blocked on a stale singleton BFF this slice was not permitted to restart; the blocker is operational, not a defect, and is stated in full below |
| `probeToFenceMaxMs` off per-beat spans | **NOT MET, unchanged** — it rides on the preview terminal, which did not run |

#### 1. §9.15's three captures, closed — and the section is `eTURtLdMM`

The two date gadgets and the ten §9.12 mapped are **not** in one section: the dates live in
`eTURtLdMM` (Kuali's *Employee Information* block, which also owns `Type of Termination`,
`Location`, `Employee Type` and `Employee Last Name, First Name`), the other ten in `m9LaWN3zL` /
`cF6IPyCVw` / `a_Alfq9a2` as §9.12 recorded.

| Field | `formKey` | DOM id | Gadget | Section | `Task 1 - Jan` | `Task 1 - Kristina & TES` |
|---|---|---|---|---|---|---|
| `Last Day Worked` | **`ER1WhBzjcm`** | `ORt4nOmlp` | `Date` | `eTURtLdMM` | `edit` | `edit` |
| `Separation Date (Last day actively employed)` | **`oEcp1xtQkj`** | `bKTJvewkM` | `Date` | `eTURtLdMM` | `edit` | `edit` |

**So §4e's section caveat is discharged for all TWELVE fields, not ten. ONE save, ONE reload
read-back, one fence, one permanent key — unchanged.** Both live steps served the identical
`sectionSettings` map, exactly as §9.12 found for the other three sections.

**`exactly-one-editable`, on two OPEN documents.** Each control resolved to exactly one node that was
visible, editable and enabled, holding the document's own date: doc **4510** at `Task 1 - Jan`
(`06/10/2026` in both) and doc **4495** at `Task 1 - Kristina & TES` (`09/02/2026` in both). Both
assertions are now in `evidence/ui/kuali/separation-document.live.json` at the date they were
observed, `externalWriteAttempted` still `false`. Both `// live-verify: next-live-pass` markers are
discharged, and D208's caveat — *a selector mapped on a read-only record is not a verified selector
for the editable page* — is answered rather than carried.

**The extraction validated itself, twice.** §9.12's validation was `timekeeperName` coming back
byte-identical to the 2026-08-04 capture. This one has its own: each date gadget's DOM id in the form
TEMPLATE (`ORt4nOmlp`, `bKTJvewkM`) is the id the independent editability probe read back off the
RENDERED control. The two halves of the mapping were observed by different instruments and agree.

**Two corrections to the record.** §9.12 and §9.15 both describe the `sectionSettings` map as
*twelve entries, two of them `hide`*. The live map has **ten** entries, two of them `hide`
(`4WIES6A7P`, `VhuKxRTrN`) — the count was wrong, the substance was not. And the epoch reading is
confirmed on a third document: doc 4495's `09/02/2026` is `1788307200000`, UTC midnight, the same
rule 4510 and 4524 already showed.

#### 2. Doc 4510 re-observed — the four questions, verbatim

**(a) SS Smart HR search, EID 10001799, operator `=`.** Three transactions, and **`T002209631` is
gone**:

| Transaction | Name | EID | Action | Status | BU |
|---|---|---|---|---|---|
| `T002197996` | Drose Clauckia | 10001799 | **TER** | **Approved** | SDCMP |
| `T001816218` | Drose Clauckia | 10001799 | *(blank)* | Approved | SDCMP |
| `T001781115` | Drose Clauckia | 10001799 | HIR | Approved | SDCMP |

The operator's deletion did what it was for: the pending `T002209631` §9.14 recorded no longer
exists, the already-`Approved` `T002197996` remains, and **no row for this EID is `Pending`**. The
*Transactions in Progress* grid on the wizard's own page agrees — **zero** rows for 10001799, and
zero for 10001754 as well.

**(b) Person Org / job summary, EID 10001799.** **ONE** employment row, and it is still `Inactive`:

```
empl record 0 · eff 07/01/2026 · HR status Inactive · SDCMP · position 40767680
dept 000412 HOUSING/DINING/HOSPITALITY · job 004921 STDT 2 · expected job end 09/20/2026
FTE 0.440000 · Student: Casual/Restricted
```

**(c) Page-B stageability — UCPath WILL stage a termination for this EID.** Fresh wizard, template
`UC_INVOL_TERM`, transaction date `06/11/2026`, EID typed on Page B and blurred: the name rendered in
**836 ms** as `Drose Clauckia`, with empl record `0 (STDT 2)` and derived job effective date
`06/11/2026`. Abandoned by hard `goto` back to the wizard URL — the proven-safe pattern — with
`Continue` never clicked and nothing saved.

**This is the load-bearing answer, and it disagrees with (b) in exactly the way that matters:** the
subject being `Inactive` in Person Org does **not** stop UCPath from staging a termination for it.
The refusal that stops this run is **ours**, not UCPath's — §9.13 decision 3's `no-active-job` at
`match-active-employment`, which fires before the gate. That is still the right refusal (a grid this
composition cannot reduce to one active row is a run that cannot compute what it is about to write),
but the record should not read as though UCPath would have refused too.

**(d) Kuali doc 4510.** Still **open**, `completed: false`, at step `Task 1 - Jan`, action id
unchanged. **Eleven of the twelve staged fields hold values**; only `timekeeperComments`
(`J_upFRq074`) is absent from the document model entirely:

| Field | Live model value |
|---|---|
| `department` | `{"id":"GfKti1EX5VL","label":"000412 - Housing/Dining/Hospitality"}` |
| `payrollTitleCode` / `payrollTitle` | `"004921"` / `"STDT 2"` |
| `requestAcknowledged` | `[{"id":"5ZaHvv-OLS","label":"Request Acknowledged - In Progress"}]` |
| `timekeeperName` | `"Julian Zaw"` |
| `lastDayWorked` / `separationDate` | `1781049600000` / `1781049600000` — both `06/10/2026` |
| `terminationEffectiveDate` | `1781136000000` — `06/11/2026` |
| `submittedTerminationTemplate` | `[{"id":"y_VXzkty8","label":"Submitted Termination Template"}]` |
| `transactionNumber` | **`"T002209631"`** |
| `finalPay` | `{"id":"s9ziHeMcl","label":"Does not need Final Pay (student employee)"}` |
| `timekeeperComments` | **absent from the model** |

`Type of Termination` reads `Graduated/No longer a Student` (the same value doc 4524 carried, which
§9.14 mapped to `involuntary` / `UC_INVOL_TERM` / `No Longer Student`).

**One consequence worth naming.** Doc 4510's `transactionNumber` still holds `T002209631` — a UCPath
transaction that **no longer exists**. Nothing reads it back today (§4e's fold writes the field from
the run's own filed transaction, never from the document), so it is not a defect; it is a stale value
a finalization would overwrite, and it is exactly the shape §4e's unconditional staging was chosen to
handle.

#### 3. The live document inventory moved, and the recorded Kuali canary is gone

**Doc 4524's action was COMPLETED at `2026-08-14T15:45:02.458Z`** — after §9.14's run 6 read it at
15:08 and before this pass opened it at 17:10. `ActionPage` now answers `document: null` for it and
the form no longer renders (both date controls resolve to **zero** nodes), so:

- **doc 4524 can no longer be read by `kuali/read-separation-document`**, and therefore cannot be the
  subject of a composed run; and
- **doc 4524 is no longer the natural Kuali controlled-commit candidate** it has been named as since
  §9.12. That recommendation is withdrawn on the facts, not on a judgement.

| Doc | Action id | Step | State today |
|---|---|---|---|
| 4502 | `6a766ae6f0549046f7f0dc06` | `Task 1 - Jan` | **open** · Cramia, Dreitho · `Appointment Expired` · LDW/sep `1774915200000` = `03/31/2026` · `terminationEffectiveDate`, `transactionNumber`, `timekeeperName`, `department` all null |
| 4510 | `6a7a33b2ac106d428b3217e0` | `Task 1 - Jan` | **open** · Clauckia, Drose · eleven of twelve populated |
| 4495 | `6a73abda824c9a5388e0ceaa` | `Task 1 - Kristina & TES` | **open** · LDW/sep `09/02/2026`, still in the future, so S7 still refuses at `plan` |
| 4524 | `6a7e45bcbac487bbc6a2ceae` | `Task 1 - Kristina & TES` | **COMPLETED 2026-08-14** · form gone |

Doc **4502** is the only currently-open document whose subject the composed graph can carry to its
gate: an active job, a past last-day-worked, and no pending transaction — which under D215 is exactly
the subject whose `clear-pending` preview settles `already-present` at beat ①.

#### 4. What the controlled-commit session may legally do on doc 4510 — per the composition's own rules

- **The composed `separations` workflow cannot reach any of its three writes on 4510.**
  `match-active-employment` refuses `no-active-job` before the gate, because Person Org returns one
  employment row and it is `Inactive` (§9.13 decision 3). Nothing about the operator's deletion
  changed that, and the deletion was never going to: it cleared a UCPath transaction, not an
  employment status.
- **`clear-pending`'s COMMITTED arm now has no live subject at all.** 10001799 was the only mapped
  subject holding a pending row; deleting it removed the one case where the sweep would have anything
  to delete. Its `already-present` / nothing-to-sweep arm is now the arm every mapped subject takes.
- **The standalone `separations-kuali-finalization` descriptor is a different graph and 4510 is a
  legal target for it.** It has no `match-active-employment` node — `job-summary` and `name-search`
  feed the identity packet only, and `transactionNumber` is INGRESS — so the `no-active-job` refusal
  does not exist on that graph. Its ALWAYS-GATE still dominates the write. That is the honest reading
  of where a Kuali controlled commit can run today, and doc **4510** is the best-mapped open document
  for it: its section settings, both date `formKey`s and all twelve controls' editability were read
  on it this morning.
- **A UCPath termination controlled commit still has no named target.** §4f2's canary remains
  unnamed, and none is invented here.

#### 5. The one deliverable that could not run, and exactly why

The composed dry run to its preview terminal was **NOT RUN**. It was not blocked by anything in the
composition, by write safety, or by D214/D215 — those landed and the platform lane proves both arms.
It was blocked operationally:

- the run must be planned and started through the REAL `/api/v1/start-plans` and `/api/v1/commands`,
  which live only in the dashboard BFF;
- the BFF is a **singleton** by construction — port `3938` is pinned by `config/runtime-isolation.json`
  and D181's `server`-role process lock admits one holder;
- the BFF holding it (pid `5670`) booted at `2026-08-14T15:36:12Z`, before D216, D217 and 6a's own
  registration edits, and **serves `separations` with `contractFingerprint` `4c780f84…` while the
  working tree's is `9790eaf8…`**;
- `run-executor.ts`'s entry check refuses a run whose `envelope.contractFingerprint` is not the
  descriptor's, and the envelope is stamped from the PLAN — so every run that BFF can plan is
  structurally unclaimable by a worker built from the current tree.

**The remedy is the whole fix: restart the BFF, then re-run the pass on doc 4502.** This slice did not
stop a process it did not start, which is a standing rule of its dispatch and also the more
conservative reading of D181 — a lock exists to make a stale holder explicit, not to license a
different session to end it. The identical situation was met and recorded once before (§9.9's
operational note), and it is recorded again here rather than worked around.

#### 6. The one test gap platform slice 2 named, closed

`buildRunEvidenceReceipt`'s `DRY_RUN_PREVIEW` summary BRANCHES on the preview outcome — a
`would-prepare` preview quotes its staged page and subject verdict, an `already-present` one has
neither and must name its probe — and only the first branch had ever been executed. The
`already-present` arm now has its own case over the REAL kuali sequencer, asserting the warning names
the probe, does **not** claim a subject, leaves the verdict unchanged (`unknown` / `partial` / no
output), and writes neither the observed-present intent nor the checkpoint a real already-present
settlement would (commit `b73b546`).

#### What is honestly NOT RUN

- **The composed dry run's preview terminal, the `transaction.previewed` span, the preview-bound
  terminal record and the receipt's live `DRY_RUN_PREVIEW` warning** — §5 above. One BFF restart away.
- **`probeToFenceMaxMs` off per-beat spans** — unchanged from §9.12 item 6 and §4f3; it rides on the
  preview terminal.
- **Every real write, of every kind**, and all three controlled commits.
- **The two dates' WIRE shapes.** Their keys are captured; a `Date` gadget's model value is epoch
  milliseconds and the staged value is `MM/DD/YYYY`, so both stay in the recorded-not-asserted set
  until the controlled commit observes the real payload.
- **D207's provisional `stabilized` window**, the five other unasserted wire shapes, and the
  `already-present` arm's LIVE proof — unchanged, all reachable only from a real finalization.
- **A blank-EID document**, unchanged from §9.14.
- **The parity lane**, deliberately: another session held uncommitted dashboard edits in this shared
  working tree throughout, and the lane rebuilds the bundle from the tree.

---

### 9.17 Chunk 6c — the composed dry run reaches its preview terminal, and the real run on 4510 refuses before the gate (2026-08-14)

The pass §9.16 handed forward, run against production on the restarted BFF (lock generation 26, pid
`58211`, serving `contractFingerprint` **`9790eaf8…`** — the working tree's, which is the whole
remedy §9.16 §5 named). Two parts: **(A)** the composed DRY run on doc **4502** driven start-plan →
command → worker → gate → real approval → resume → **preview terminal**, and **(B)** the composed
**REAL** (not-dry) run on the operator's canary doc **4510**, taken exactly as far as the composition
would take it and no further.

**Nothing was written, anywhere, by either part.** Asserted against the authority database rather
than logs, after both parts finished: `write_intents` **2**, `write_attempts` **3**, `durable_outbox`
**2** — every one of them 2026-08-04's Phase-2 controlled commit on Kuali doc **4489**
(`kuali:4489|…|timekeeper-name|10001828|PROBE-DELETE-ME` parked, `…|PROBE-VERIFIED-0804` committed),
newest row `2026-08-04T17:08:48.805Z` — and **zero** `run_checkpoints` for `clear-pending`,
`file-termination` or `finalize-kuali` across every run this database has ever held. All three
separations permanent keys are absent from authority. `Delete Selected Transactions`, `Save and
Submit` and Kuali `Save` were never clicked; `submitDocumentV2` was never issued; the Smart HR
wizard's `Continue` was never clicked. **No gate this session was approved on a not-dry run** — part
B never reached its gate, and part A's approval authorized a preview.

#### The honest status of doc 03c §Phase summary step 4 for chunk 6, updated again

| Asked for | Status |
|---|---|
| The composed dry run to its **preview terminal** through the REAL pipeline | **MET** — run `7565a88d` / `sp-105939-7565`, terminal `done` at `2026-08-14T18:05:17.874Z` |
| `transaction.previewed`, the preview-bound terminal record, the receipt's live `DRY_RUN_PREVIEW` | **MET, all three** — and reaching them found a fourth defect (below) |
| D215's `already-present` preview arm, LIVE | **MET** — the ordinary subject's arm, settled off a live probe, with zero durable rows |
| The composed REAL run on 4510 | **MET as a REFUSAL** — `NO_ACTIVE_EMPLOYMENT` at `employment`, pre-gate, verbatim below. That is a result, not a blocker |
| `probeToFenceMaxMs` off per-beat spans | **NOT MET — and it does not ride on the preview terminal after all.** See item 4 |
| The D58 disposition sweep for separations | **MET with findings** — item 6 |

#### 1. Part A, the run that closed it: `7565a88d` · `sp-105939-7565` · doc 4502 · `separations:4502#re-read-4`

Five runs were needed and all five are recorded in §9.17a; this is the one that finished. Its read
chain, warm Kuali and Kronos sessions, a FRESH UCPath profile (item 5):

| Node | Wall |
|---|---|
| `document` | 6.44 s |
| `plan` · `termination-type` | 0.01 s · 0.00 s |
| `name-search` | **25.70 s** (includes the UCPath SSO + Duo session) |
| `subject` | 0.00 s |
| `job-summary` | 4.58 s |
| `employment` · `department-option` | 0.00 s · 0.00 s |
| `timecard-search` | 4.99 s (warm New Kronos session — the 30 s figure is a login, not a search) |
| `timecard` | 8.93 s |
| `dates` · `comparison` | 0.00 s · 0.01 s |
| **claim → `gate.opened`** | **50.70 s** |

The gate as the wire served it at the park (`GET /api/v1/runs/{runId}/identity-gate`):

```
gateId            identity-approval          parkedAt   2026-08-14T18:00:53.620Z
resumeAt          approval                   expectedVersion 40
resultSchemaHash  2165f585c743…              evidenceDigest  a43f789bb928…
approvalShape     one-click                  approvableEids  [10001754]
observedAt        2026-08-14T18:00:34.899Z
```

The packet is byte-for-byte the §9.14 shape on the same subject — four comparisons all `agrees`, the
`single-active-job` grid, and D211's write plan inside it (`UC_INVOL_TERM` / `Appointment Expired` /
empl record `0` / effective `04/01/2026` / LDW `03/31/2026`; department option
`000412 - Housing/Dining/Hospitality`; reconciled dates unchanged with `unclassifiedPayCodes:
["Farmworkers Day"]`). The **`evidenceDigest` moved** from §9.14's `157a8311…` to `a43f789b…`, which
is D211 landing: the digest an approval binds to now covers the write plan, so a packet with the same
identity and a different plan is a different approval.

**The approval was taken through the real `/api/v1/commands`** (`resolve-gate`, one-click, command
`6e01652a-7bb7-4681-8503-79a6e21158dc`, `2026-08-14T18:01:14.996Z`) and the run resumed —
`timecard-search` re-ran twice across two claim generations at **29.70 s** and **29.65 s**, which
agrees with §9.14's 30.4 s / 30.5 s to within a login's noise and confirms the §9.13 item 5 answer a
third and fourth time.

**D214 is live-proved.** The re-executions landed at `timecard-search#2.1` and `#3.1` — the span path
now carries the claim generation — and `run_checkpoints` accepted all three executions of the node
under one attempt. The collision that killed §9.14's run 6 one node past a real approval did not
occur.

**The preview terminal, verbatim.** `transaction.previewed` at `2026-08-14T18:05:17.871Z`, `node:
clear-pending`, `subject: not-observed`, `externalCommit: none`. The terminal `run_results` row is a
`dry-run-preview` bound to schema hash **`86cd007a59d4…`** — not the workflow's declared result — with

```
outcome  { state: "already-present", proofSource: "live-probe" }
probe    ucpath-pending-terminations-clear · emplId 10001754
         source "ss-smart-hr-detail-read" · scannedRowCount 2 · observedAt 18:05:13.593Z
dependencies  [ approval ]  (the transaction node's own dependsOn — D210, not terminalDependsOn)
              checkpoint attempt 2, claimGeneration 3
externalCommit "none"
```

**This is D215's `already-present` arm proved live for the first time**, on the ORDINARY subject —
one with no pending transaction — which is exactly the case §9.14 recorded the pre-D215 preview
failing on. The preview REPORTED the settlement and performed none: zero write intent, zero fence,
zero checkpoint, zero run transition.

**The receipt.** `result: partial`, `confidence: unknown`, `output: []`, and one load-bearing warning:

> `DRY_RUN_PREVIEW` — *"this run was a DRY RUN: transaction node "clear-pending" was previewed
> (settled already-present at its present probe, before anything was staged, observed
> 2026-08-14T18:05:17.871Z) and the run ended there. No external write was attempted — no write
> intent, no fence, no commit — so this receipt states what WOULD have been written, never what was"*

That is the `already-present` BRANCH of the summary — the branch platform slice 2 closed as a test
gap (§9.16 item 6) and which had never executed against a live settlement. It names the probe and
claims no subject, as designed. Verification: fourteen nodes `verified` including
`node.identity-approval` (**D204 live for the third time** — the gate decision carries authority's own
`resolvedBy` / `resolvedAt` / resolving command id and the bound `evidenceDigest`), the four
write-half nodes `unknown`, and `completion.terminal-result` `unknown` — D210's shape exactly.

#### 2. Part B, the canary: run `ee9824f7` · `sp-110837-ee98` · doc 4510 · **not dry** · REFUSED pre-gate

The whole read chain ran live against production on warm sessions — `document` 6.05 s, `plan` 0.01 s,
`termination-type` 0.00 s, `name-search` **7.06 s**, `subject` 0.00 s, `job-summary` 4.48 s — and then
the composition refused, 17.6 s after claim, at `2026-08-14T18:09:05.534Z`:

> **`NO_ACTIVE_EMPLOYMENT`** · node `employment` · task `workflow:separations/match-active-employment`
> · `writeState: not-attempted` · failure `876ea288-fc45-40cf-ae4d-c473e0765537`
>
> *"[workflow:separations/match-active-employment] no-active-employment: Kuali document 4510: UCPath
> shows no active employment for this person (#0 empl record 0 — Inactive). They may already be fully
> separated (S21/S22) — legacy computes this only when the search happened to render a multi-row
> grid, which is why a single-employment person who was already terminated was never checked at all.
> There is no employment for this separation to end."*

The `job-summary` checkpoint is the live evidence, read at `2026-08-14T18:09:01.050Z`: **one** row,
`emplRecord 0`, `hrStatus Inactive`, `HOUSING/DINING/HOSPITALITY` / `000412`, `STDT 2` / `004921`,
position `40767680`, effective `07/01/2026`, expected job end `09/20/2026`, FTE `0.440000`,
`Student: Casual/Restricted`, `renderContext.employmentInstances: already-complete`.

**This is the composition working, and it is the answer to the operator's premise.** The deletion of
`T002209631` cleared a UCPath *transaction*; it did not change an *employment status*. §9.16 §2(b)
predicted exactly this and §9.16 §4 stated the consequence in advance. **No gate opened, no human was
asked, and no transaction node was entered** — which is D211's rule about where a refusal belongs
("the composition files a termination, so a grid it cannot reduce to ONE row is a run that cannot
compute what it is about to write, and it refuses before the gate opens") observed on a real not-dry
run for the first time.

**What the operator must do for 4510 to proceed.** UCPath must show an **ACTIVE terminable
employment for EID 10001799**. That is operator territory and nothing in this repository can or
should manufacture it: §9.16 §2(a) recorded that `T002197996` (TER, **Approved**) still exists, and an
Approved termination is the reason the employment reads `Inactive`. Until that changes, the composed
`separations` graph cannot reach any of its three writes on this subject — and the standalone
`separations-kuali-finalization` graph remains the one place a Kuali controlled commit on doc 4510 is
legal (§9.16 §4, unchanged).

#### 3. The defect this pass found — D215's fourth subject verdict never reached the wire leaf

The FIRST preview that ever settled **killed the worker**. `transaction.previewed` carries a subject
verdict, and D215 added a fourth value, `not-observed`, for the `already-present` arm: no page was
staged, so no subject was read, and reporting `match` for a comparison nobody made would be the
fabrication the arm exists to prevent. That value landed in the kernel's union
(`src/core/span-emitter.ts`, with a D215 comment explaining it) and **not** in
`src/events/types.ts`, the leaf the JSONL writer parses — so the emit threw
`Invalid option: expected one of "match"|"mismatch"|"unscoped"` and the worker process died one emit
short of its terminal.

Three things about it are worth keeping.

**(1) The two schemas call each other parity twins in their own comments, and the test that exists to
hold them together had no case for this arm.** `tests/unit/events/span-events.test.ts` opens by
saying it "pins that restatement against the domain vocabulary byte-for-byte, so the two can never
quietly fork" — and its executor-event round-trip list covered `run.claimed`, `run.requeued`, four
`span.*` arms and `gate.opened`, with **no `transaction.previewed` event at all**. The arm nobody
could reach was the arm nobody pinned.

**(2) A fixture span emitter does not parse the wire schema, so the unit suite could not see it.**
Every green gate in this tree ran with an in-memory emitter; only the JSONL writer validates. The fix
walks all four verdicts through BOTH schemas in that same case.

**(3) The kernel was correct throughout.** The crash happened after the preview had been computed and
before anything was settled: zero intent, zero fence, zero checkpoint, the run left `claimed` and
non-terminal. On the next worker boot **D200's lease-as-evidence self-sweep released it by name** —
`"orphaned claim released before the first poll; its worker never settled"` — and the run resumed at
claim generation 3 and finished. A defect in a span emitter cost a re-execution of one `always-rerun`
node and nothing else.

Fixed in `e1ba81b` (one enum value, one test case). No decision moved: ref workflow-model §2.1 had already
ratified `not-observed`; this was an implementation that lagged its own ratification.

#### 4. `probeToFenceMaxMs` — the expectation was wrong, and the correction matters

§9.14 and §9.16 both recorded this measurement as riding on the preview terminal. **It does not.** A
settled preview emits exactly ONE event, `transaction.previewed`, and no per-beat spans — and a
preview has **no fence at all**, by construction. So reaching the preview terminal cannot produce a
probe→fence interval, and the §9.16 line "it rides on the preview terminal" is withdrawn on the
facts.

What the preview DOES give is a whole-preview interval: the probe observed at `18:05:13.593Z` and the
preview settled at `18:05:17.871Z` — **4.28 s** for the durable permanent-key lookup plus the live
probe read plus the settlement, on a warm UCPath session. That is a bound on the read half and it is
recorded as such; it is not `probeToFenceMaxMs`. §4f3's per-beat decomposition can only come from a
**real fenced transaction**, or from a new instrument somebody decides to build, and it stays open
with that reason instead of the wrong one.

#### 5. The operational finding: a worker's browser profile can wedge a system, and only a live run says so

Three consecutive runs failed at **exactly 60.01 s** on D125's `timeouts.sessionAcquireMs` bound —
one at `clear-pending`, two at `name-search` — across a worker restart and a fresh worker process.
The bound fired as designed and the message is the right one. The CAUSE was not UCPath: at
`2026-08-14T17:52Z`, between the second and third failures,
`scripts/live-browser-login-smoke.ts ucpath` completed **login + neutral reset in 17.9 s** through the
full hop chain (`ucpath.ucsd.edu → ucphrprdpub → idpproxy-ucpath → a5.ucsd.edu → api-*.duosecurity.com`)
with both authentication facts proved — on a **fresh** profile directory.

The one controlled difference was the worker's own persistent profile,
`.auth/hrauto-rebuild/separations-worker-1/ucpath-prod-9e62a0611bb3`. Its cookie jar showed the flow
reaching Duo every time and never completing: **three** `frameless-session-binding-*` cookies at
`api-ce13a1a7.duosecurity.com` expiring 18:05, 18:08 and 18:12 — one per failed attempt — with **no
`PS_TOKEN`**. Deleting that one directory and restarting the worker restored the login on the very
next run (`name-search` 25.70 s) and every UCPath read afterwards. The Kuali and New Kronos profiles
were untouched and kept working throughout; the Duo WebAuthn credential lives in `.auth/` above the
profile and was never in scope.

**Recorded, not diagnosed to root cause.** What is proved is the shape: *a per-(worker, system,
config) browser profile can reach a state where every acquisition burns the whole 60 s bound while the
same system logs in fine on a fresh profile, and nothing in the runtime notices or reports it.* The
honest remediation today is operator-level (delete the profile — it is a cache, not authority), and
the interesting question for its owner is whether a repeated acquisition timeout on ONE (worker,
system) pair should recycle the profile automatically, or at least SAY that it might be the cause.
The current failure message names Duo hand-approval and `timeouts.duoApprovalSeconds`, which is a real
cause and was not this one.

#### 6. The D58 disposition sweep for separations

Three inventory entries in `config/legacy-capabilities.json` are touched by this workflow, and all
three are correctly dispositioned at the milestone the runtime is actually in
(`phase-3-workflow-migration`), so the guard's D188 arm is satisfied and nothing here is stale:

- **`legacy-workflow-separations`** — `open`. Correct and must stay so: the legacy workflow is
  production-authoritative until the single all-at-once cutover (D89/D93), and nothing in this
  inventory authorizes deleting it.
- **`legacy-tool-debug-kronos`** — `open`. The Kronos timecard isolation run still has no rebuild
  counterpart; selector discovery and login smoke do. Unchanged by this chunk.
- **`legacy-tool-ops-sanity-check-record`** — `open`, deferred by **D192** to this migration with a
  named condition: *"its value arrives with separations/onboarding … where it renders as prose
  observations beside the ref write-safety §14 ALWAYS-GATE identity approval, never a pass/fail verdict chip
  that could be mistaken for authority."* **That condition is now materially satisfied by something
  that shipped**: the §14.2 packet's `comparisons` array is exactly that — four prose observations
  (`note` per field) beside the approval, with no verdict chip — and this pass served it live twice.
  It is flagged rather than re-dispositioned here, because closing an inventory entry is an operator
  decision and `AdvisorySurfaceIdSchema`'s D178 two-value shape has not been widened.

#### 7. Two surface observations, both recorded rather than fixed — **BOTH FIXED 2026-08-19 (D237 · D238)**

> **RESOLVED 2026-08-19.** Both records below are struck; the text stays as the record of what was
> observed and when. **(a)** is **D237** — the settled gate's verdict, approver and instant now come
> off the durable `gate_results` row through D204's own declared arm table, never off the span
> stream's `resolutionKey`, and the panel draws a DECISION RECORD in the run's own stream at
> `resolvedAt`. Ref operator-trust §"D237" owns the derivation; ref dashboard-surfaces §"D238" owns the presentation. **(b)** is
> **D238** — a terminal `done` run whose envelope asked for a dry run takes `partial` with
> `rehearsal: true`, which is the verdict its own receipt derives, and a wire refinement makes
> `verified-done` beside `rehearsal` unrepresentable. Ref dashboard-surfaces §"D238" owns it. Both are pinned by
> `tests/unit/server/run-detail-gate-outcome.test.ts`. Neither needed a new vocabulary: (a) reuses
> D204's declared arm table and (b) reuses the receipt's own `result` enum.

**(a) A settled gated run's panel cannot say its gate was approved.** `run-detail.ts` maps a resolved
gate to a wire resolution only when `resolutionKey` is literally `approved` or `rejected`, and the
command service emits `resolutionKey: "resolved"` for every gate — deliberately, with a comment
naming the deferral (*"Until gate descriptors declare display keys (2h Review), the one honest key is
the fact of resolution itself"*). So the approve/reject arm is **structurally unreachable** and every
settled separations run's panel reports `gate: { state: "absent", reason: "gate identity-approval
resolved with key resolved, which is not an approve/reject verdict" }` — a sentence that reads like a
data problem and is a vocabulary deferral. The receipt carries the truth (D204). Owner: ref operator-trust / doc
13, with ref workflow-model's gate display keys.

**(b) A preview run's outcome chip reads `verified-done`.** `run-detail` maps lifecycle `done` →
`verified-done` mechanically, while the receipt for the same run says `partial` / `unknown` with a
load-bearing `DRY_RUN_PREVIEW`. This is D210's own named carry-forward (*"the queue row and the
timeline have no arm for a preview … Surfacing it on the queue row is a wire + UI change, and it is
named here rather than left silent"*), now observed on a real settled preview rather than reasoned
about.

#### 8. The platform defect this pass found and did NOT fix: a RETRY re-collides on the same node

> **FIXED as D221 (2026-08-14), by ref workflow-model §5.7's owner.** The answer is none of the three candidates
> below and needed no new component: **the checkpoint key is ITEM-scoped, so the `attempt` in it is
> the ITEM's attempt, not the run's** — which is what §5.6 #1 has always said a retry is (*"failure
> at node k ⇒ retry = new attempt"*), what the DDL's own `run_id … (audit)` annotation implies, and
> what ref write-safety §5's write sequencer already assumes when it reads `envelope.attempt > 1` as "this item
> has been attempted before, so probe before you fence". Every enqueue now takes the item's next
> unspent attempt from authority inside its own transaction, a requeue advances the same counter, and
> `runs.enqueue` refuses an attempt the item already spent. Nothing stored moved — the key shape is
> unchanged, so there is no migration and no schema version — and cross-run replay, which is what
> made the retry cheap in the first place, is untouched. The walk is
> `tests/unit/retry-item-attempt.test.ts`, which reproduces the verbatim message below when the fix is
> reverted; the composition's half rides in `separations/re-read-is-a-new-item`.

D214 keys a checkpoint by `(workflow, itemId, nodeId, attempt, claimGeneration)` and that closed the
gate-park/resume collision. A **retry** re-opens it from the other side. `run` / `retry` mints a NEW
run for the SAME logical item, born at attempt 1 and claim generation 1 — so an `always-rerun` node
re-executes against the ORIGINAL run's attempt-1/generation-1 key. Live, verbatim, run `555ba4b4`
retrying `12a5cd3e`:

> `run checkpoint separations\0c9837287-f3c5-5697-89f4-73e727fbfe04\0timecard-search\0 1 \0 1 already
> exists with different content`

It failed in **1.89 s**, having replayed the whole read chain from the first run's checkpoints. The
consequence is operational and general: **a separations run that fails at or after `timecard-search`
cannot be retried at all** — every retry dies on the first `always-rerun` node — and the only way
forward is the re-read affordance, which mints a new logical item and re-reads everything. That is
what this pass used (`#re-read-2`, `#re-read-3`, `#re-read-4`).

It is named and handed to ref workflow-model §5.7's owner rather than fixed here, on §9.14's own reasoning:
inventing replay semantics inside a live-proof slice is not this slice's job, and the candidate
answers (a per-ITEM execution ordinal; a generation that does not reset across `retryOf`; an
always-rerun node that writes no row) each have consequences for D110/D114 terminal dependencies and
D115 provenance that belong to the doc that owns them.

#### 9.17a The attempt record — five runs for part A, one for part B, verbatim

| # | Run / trace | Item | Outcome |
|---|---|---|---|
| 1 | `12a5cd3e` · `sp-104736-12a5` | `separations:4502` (dry) | whole chain **done** in 98.0 s claim→gate; packet served, **approved live** 17:49; resumed (`timecard-search#2.1` 30.06 s); **failed** at `clear-pending` on D125's 60 s `sessionAcquireMs` bound. `writeState: not-attempted` |
| 2 | `555ba4b4` · `sp-105221-555b` | retry of #1, same item | **failed** in 1.89 s at `timecard-search` — the retry checkpoint collision, item 8 above |
| 3 | `2aa16dd0` · `sp-105328-2aa1` | `…#re-read-2` (dry) | **failed** at `name-search`, 60.01 s, same bound |
| 4 | `1d84b8b2` · `sp-105715-1d84` | `…#re-read-3` (dry) | **failed** at `name-search`, 60.01 s, same bound, on a freshly restarted worker with no other browser running. The UCPath smoke passed on a fresh profile in 17.9 s in the same window → item 5 |
| 5 | `7565a88d` · `sp-105939-7565` | `…#re-read-4` (dry) | **the run that closed it.** Chain done, claim→gate **50.70 s**, approved live 18:01:14.996Z, resumed twice across the span-writer crash, **terminal `done`** 18:05:17.874Z with the preview record and receipt of item 1 |
| B | `ee9824f7` · `sp-110837-ee98` | `separations:4510` (**not dry**) | **failed** in 17.6 s at `employment` — `NO_ACTIVE_EMPLOYMENT`, pre-gate, item 2. Zero writes, no gate opened |

#### What is honestly NOT RUN

- **Every real write, of every kind**, and all three controlled commits. The composed graph has still
  never entered a transaction node's commit arm on any subject.
- **`probeToFenceMaxMs`'s per-beat decomposition** — item 4, now open for the RIGHT reason.
- **The `would-prepare` preview arm live.** Only the `already-present` arm has ever settled live,
  because the only mapped subject with a pending transaction (10001799) is the one the composition
  refuses pre-gate. A subject with BOTH an active job and a pending row still has not been observed
  (§9.14's jointly-unsatisfiable pair, unchanged).
- **D207's provisional `stabilized` window**, the seven unasserted Kuali wire shapes (including the
  two dates' epoch-millisecond shapes), and the finalization's own `already-present` arm — all
  reachable only from a real finalization.
- **A blank-EID document**, unchanged from §9.14.
- **The parity lane**, unchanged from §9.16: no dashboard bytes moved in this pass.
- **The retry path**, item 8 — known-broken for this graph during the pass and not exercised further
  in it. **FIXED afterwards as D221** and pinned by a fixture walk over the real interpreter and the
  real retry command; it has still never been exercised LIVE on this graph, which is the honest
  remaining statement. _(Superseded 2026-08-19: **§9.20** is that live exercise — six retries through
  the real command endpoint across two logical items, no collision, and a retried run reaching the
  preview terminal.)_

### 9.18 Operator inputs, 2026-08-18 — the dry-run practice set, and four rulings

Recorded from the operator's own message and screenshots; nothing here was run live yet.

**The dry-run practice set is named: Kuali docs 4537, 4502, 4495** (from the operator's Kuali
action list: 4537 Marc Angelo Olitoquit `Task 1 - Kristina & TES` created Aug 17 · 4502 Emily
Zimmerman `Task 1 - Jan` · 4495 Alaric Bermudez `Task 1 - Kristina & TES`). The operator notes
their separation dates are in the future and offers them for dry-run practice. The standing S7
constraint applies and was stated back: a future-dated document refuses at `plan` on the composed
graph (proved live on 4495, §9.17a run 4), so **4502 is the full-chain composed dry-run subject**
(already proved to the preview terminal, §9.17), **4537 owes a read-only mapping pass** before
anything else cites it, and **4495 becomes a fresh full-chain subject when its date passes
(09/02/2026)** — until then both serve the standalone read workflows and the S7 refusal path.
**These are PRACTICE subjects, not §4f2 canaries** — the controlled-commit canary remains unnamed.

**Four rulings landed the same day, recorded where they own:** the run-detail timeline is
CATEGORICAL — the operator approved the six-category grouping (Kuali extraction · Identity check ·
Job summary · Kronos timecard · UCPath transaction · Kuali finalization) over the 18 raw nodes,
legacy's step vocabulary kept (D225, ref dashboard-surfaces) · the gate-age pill carries no age; the age lives in
the row meta and the log panel, per the demo (D12 amended, ref dashboard-surfaces) · no AI sanity check — the
§14.2 packet's deterministic comparisons ARE the check (`legacy-tool-ops-sanity-check-record`
retired, ref operator-trust §4.4) · the archived detail follows the demo — five tabs, Export (D223, ref dashboard-surfaces
§10.2). The operator also ratified the separations-completion plan's ordering
(`docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` §7 Decision 5:
Track B now, Track A on the canary).

---

### 9.19 The 4537 canary mapping pass — read-only against Kuali and UCPath, 2026-08-19

Read-only against production, Duo cleared hands-off by Duo Autopilot, in this pass's OWN
playwright-cli session (`s919`) on its own profile, which was deleted afterwards. **Nothing was
submitted, saved, approved or finalized.** Kuali `Save` / `Send Back` / `Mark Complete` were never
clicked, `submitDocumentV2` was never issued, the Smart HR wizard was never opened, and
`Delete Selected Transactions` was never clicked. No dashboard run was planned and no worker ran;
the browser was driven directly. Every Kuali finding below came from the same PASSIVE `ActionPage`
response listener §9.12's instrument established — Kuali issues that query itself on every document
route open, and this pass read the answer and sent nothing extra.

**Why it ran.** §9.18 recorded the operator naming Kuali doc **4537** and owed it *"a read-only
mapping pass before anything else cites it"*; the operator has since named it the **§4f2 canary** —
the real production target for the three controlled commits separations still owes. This pass asks
whether 4537 can carry them.

#### The honest status, in one table

| Commit | Verdict on doc 4537, 2026-08-19 | Whose refusal |
|---|---|---|
| ① `clear-pending` sweep, COMMITTED arm | **NO — nothing to clear.** UCPath holds five transactions for this EID and **every one is `Approved`**; zero `Pending`. The probe settles `already-present` at beat ① and the sweep's committed arm gets no live witness from 4537 | neither — the world simply has no pending row |
| ② UCPath termination filing | **BLOCKED TODAY, until Pacific calendar day 2026-08-28.** Everything else it needs is satisfied — one ACTIVE employment row, a resolvable template, a department option that exists — but the document's Last Day Worked is `08/28/2026`, nine days out | **OURS.** `separation-date-in-future` (S7), refused at `plan`. UCPath itself was NOT asked and no claim is made about what it would do |
| ③ Kuali finalization save | **YES, structurally — and it should not go first.** The action is open (`completed: false`), all four owning sections are `edit` at this step, and all twelve staged controls resolve to exactly one visible, editable node. But its `transactionNumber` is INGRESS, and until ② runs there is no real UCPath transaction for it to name | ours, by ordering — nothing in Kuali refuses it |

> 2026-08-28 — the registry role this section gave 4537 (one `finalization-canary` entry under the finalization workflow alone) was superseded by §9.31 (D284): 4537 is now the ONE registry subject, with an arm for each of the two workflows. The facts above stand; they were re-read read-only on 2026-08-28 and had not changed.

#### 1. Doc 4537, as the passive `ActionPage` read found it

One document open, one captured response, **9.41 s** wall including a deliberate 9 s passive dwell
(navigation itself settled in ~0.4 s). Read twice, ~2 minutes apart, byte-identical both times.

| Fact | Value |
|---|---|
| serial number / heading | `4537` / level-1 heading `"4537 "` |
| action id | `6a8336ee44b521eae41895dc` |
| document id | `6a8336b8e3a1c002a0314ca3` |
| step | **`Task 1 - Kristina & TES`** |
| `completed` / document `status` | `false` / `published` — the form is **open** |
| created | `2026-08-17T16:28:40.453Z` |
| submitted by / created by | **Marc Angelo Olitoquit** (`maolitoquit`, schoolId `10539275`) |
| `defaultFormToViewOnly` | `true` — and every control is editable anyway; `sectionSettings` wins (see item 3) |

**The subject is NOT the name §9.18 recorded.** §9.18 wrote the action list's person column through
as the subject: *"4537 Marc Angelo Olitoquit"*. That column is the **submitter**. The document's own
subject is:

```
EID*                              <secret:separationsKualiFinalizationCanaryEid>
Employee Last Name, First Name*   <secret:separationsKualiFinalizationCanaryEmployeeName>
Location*                         Graduate and Family Housing - Mesa Nueva/Nuevo West
Division                          Residential Services
Employee Type                     Student
Student Title Code                4920<TAB>- STDT 3
Type of Termination*              Graduated/No longer a Student
```

A record that names the wrong person is one nobody can act on, so the correction is stated rather
than quietly applied. (`Student Title Code`'s option label carries a literal TAB — §9.12 found that
on a different document, and this is the third confirmation that it is a property of the FORM.)

**`Type of Termination` resolves.** `Graduated/No longer a Student` is in
`src/domain/separations/termination-type.ts`'s declared map → `involuntary("No Longer Student")` →
template `UC_INVOL_TERM`, reason `No Longer Student`. The chunk-4 gate dependency would not refuse.

#### 2. The twelve staged fields, as the document holds them today

**Seven of twelve hold values; five are absent from the model entirely.**

| Field | `formKey` | Live model value on 4537 |
|---|---|---|
| `lastDayWorked` | `ER1WhBzjcm` | **`1787875200000`** — `08/28/2026` |
| `separationDate` | `oEcp1xtQkj` | **`1787875200000`** — `08/28/2026` |
| `department` | `JPYGckVxcf` | `{"id":"GfKti1EX5VL","label":"000412 - Housing/Dining/Hospitality"}` |
| `payrollTitleCode` | `2FlOeR5pd9` | `"004920"` |
| `payrollTitle` | `sVmpq6tG9X` | `"STDT 3"` |
| `requestAcknowledged` | `xKRU6vmYSY` | `[{"id":"5ZaHvv-OLS","label":"Request Acknowledged - In Progress"}]` |
| `timekeeperName` | `QGJ63YrCom` | `"<secret:separationsKualiFinalizationCanaryTimekeeperName>"` |
| `terminationEffectiveDate` | `DoWSfJhpRm` | **absent** |
| `transactionNumber` | `wPyuyY0wT0` | **absent** |
| `submittedTerminationTemplate` | `6Ejy-1rfQJ` | **absent** |
| `finalPay` | `8CXaCSIvx5` | **absent** |
| `timekeeperComments` | `J_upFRq074` | **absent** |

That is five of the fields the document's own submitter fills populated, plus the two dates —
seven in all — and
`transactionNumber` **absent**, which is the honest state for a document whose UCPath transaction has
not been filed. Contrast 4510, which still carries `T002209631` for a transaction that no longer
exists (§9.16). **4537 is the cleaner canary on this axis**: a finalization here writes a transaction
number into an empty field rather than over a stale one.

`1787875200000` is UTC midnight on `08/28/2026` — the **fourth** independent confirmation of the epoch
rule (4510, 4524, 4495, now 4537), and the rendered controls agree: both date textboxes read
`08/28/2026`.

#### 3. §4e's section discharge, re-derived independently on a third document and a second step

4537's `sectionSettings` map is **ten entries, two of them `hide`** (`4WIES6A7P`, `VhuKxRTrN`) — the
same key set §9.16 recorded, served at `Task 1 - Kristina & TES`. Walking the form template and
carrying the nearest enclosing section id reproduces §9.12/§9.16's ownership map exactly:

| Section | Fields it owns on 4537 | Setting at this step |
|---|---|---|
| `m9LaWN3zL` | `terminationEffectiveDate`, `department`, `payrollTitleCode`, `payrollTitle`, `transactionNumber`, `submittedTerminationTemplate`, `finalPay` | `edit` |
| `cF6IPyCVw` | `requestAcknowledged`, `timekeeperName` | `edit` |
| `a_Alfq9a2` | `timekeeperComments` | `edit` |
| `eTURtLdMM` | `lastDayWorked`, `separationDate` | `edit` |

**All four owning sections are `edit`, so §4e's one-save model holds on 4537: ONE save, ONE reload
read-back, one fence, one permanent key.** The extraction validated itself the same way §9.16's did —
the date gadgets' template DOM ids came back `ORt4nOmlp` and `bKTJvewkM` and `timekeeperName`'s came
back `BWmkKqx40`, all byte-identical to the recorded captures, read here by a different instrument on
a different document.

**`exactly-one-editable`, on a third open document.** Every one of the twelve staged controls plus
the four identity controls resolved to **exactly one** node that was visible, enabled and editable:

| Control | count | visible | editable | DOM id | value read back |
|---|---|---|---|---|---|
| `Last Day Worked*` | 1 | ✓ | ✓ | `ORt4nOmlp` | `08/28/2026` |
| `Separation Date (Last day actively employed)*` | 1 | ✓ | ✓ | `bKTJvewkM` | `08/28/2026` |
| `Termination Effective Date*` | 1 | ✓ | ✓ | `jfJmtLuh9` | `""` |
| `Department*` | 1 | ✓ | ✓ | `M-O_gndwl` | `GfKti1EX5VL` |
| `Payroll Title Code*` | 1 | ✓ | ✓ | `c-t30RkWp` | `004920` |
| `Payroll Title*` | 1 | ✓ | ✓ | `kQ6Tl7wtH` | `STDT 3` |
| `Transaction Number:*` | 1 | ✓ | ✓ | `gFGo7o-Wa` | `""` |
| `Timekeeper Name:*` | 1 | ✓ | ✓ | `BWmkKqx40` | `<secret:separationsKualiFinalizationCanaryTimekeeperName>` |
| `Timekeeper/Approver Comments:` | 1 | ✓ | ✓ | `uTMNjRmwc` | `""` |
| `Submitted Termination Template` | 1 | ✓ | ✓ | `y_VXzkty8lleTCMaXciLd4ujCWvVG` | unchecked |
| `Request Acknowledged - In Progress` | 1 | ✓ | ✓ | `5ZaHvv-OLSYRJhDTR1fb5Dp7bRFEUk` | checked |
| `Does not need Final Pay (student employee)` | 1 | ✓ | ✓ | `UJeOIMZve50` | unselected |
| `EID*` | 1 | ✓ | ✓ | `gxeqDUf5t` | `<secret:separationsKualiFinalizationCanaryEid>` |
| `Employee Last Name, First Name*` | 1 | ✓ | ✓ | `z2dC6cL7J` | `<secret:separationsKualiFinalizationCanaryEmployeeName>` |
| `Type of Termination*` | 1 | ✓ | ✓ | `FHJBn2YWj` | `DOsAMgFdJ` |
| `Location*` | 1 | ✓ | ✓ | `YrsJFqbhs` | `Graduate and Family Housing…` |

`Save`, `Send Back` and `Mark Complete` each resolve to **exactly one** button; there is no `Submit`.
Nothing was clicked. Worth one line because it looks contradictory: the action reports
`defaultFormToViewOnly: true` and every control is editable regardless — the per-step
`sectionSettings` map is what decides, and this step's is `edit`.

#### 4. UCPath, EID <secret:separationsKualiFinalizationCanaryEid> — the employment picture

Person Organizational Summary, `Empl ID = <secret:separationsKualiFinalizationCanaryEid>`, search settled to a **results grid** (three rows,
so no auto-navigation) **4.67 s** after the page opened. Verbatim:

| Empl ID | Empl Rcd | HR status | BU | Job code | Job title |
|---|---|---|---|---|---|
| <secret:separationsKualiFinalizationCanaryEid> | 0 | **Inactive** | SDCMP | 004921 | STDT 2 |
| <secret:separationsKualiFinalizationCanaryEid> | 1 | **Inactive** | SDCMP | CWR011 | Staff Volunteer |
| <secret:separationsKualiFinalizationCanaryEid> | 2 | **Active** | SDCMP | **004920** | **STDT 3** |

Drilled in and expanded Employment Instances (`View All`), **4.89 s**; displayed EID `<secret:separationsKualiFinalizationCanaryEid>`,
displayed name `<secret:separationsKualiFinalizationCanaryEmployeeName>`:

```
empl record 0 · eff 06/09/2025 · Inactive · SDCMP · position 40855708
dept 000412 HOUSING/DINING/HOSPITALITY · job 004921 STDT 2 · expected job end 06/30/2025
FTE 0.440000 · Student: Casual/Restricted

empl record 2 · eff 06/12/2026 · Active  · SDCMP · position 41183054
dept 000412 HOUSING/DINING/HOSPITALITY · job 004920 STDT 3 · expected job end 09/20/2026
FTE 0.490000 · Student: Casual/Restricted
```

**One active row, so `classifyJobSummary` answers `single-active-job` — the ordinary separation shape,
and `match-active-employment` does NOT refuse.** That is the first mapped subject in this migration for
which it does not: 4510's subject was `Inactive` and 4524's document is gone.

**And the document agrees with the ACTIVE row, not a stale one.** Doc 4537 carries `004920` / `STDT 3`
and `000412 - Housing/Dining/Hospitality`; empl record 2 carries job code `004920` `STDT 3` in dept
`000412 HOUSING/DINING/HOSPITALITY`. The names line up too — `<secret:separationsKualiFinalizationCanaryEmployeeName>` against UCPath's
`<secret:separationsKualiFinalizationCanaryEmployeeName>`. This is the best-agreeing subject/document pair the migration has read.

**One observation, recorded rather than fixed.** The detail page renders the two EMPLOYEE instances in
two tables, `tdgbrPER_ASGN_EMP_VW$0` and `$1` — both matched by
`UCPATH_PERSON_ORG_ASSIGNMENTS_GRID`'s `table[id^="tdgbrPER_ASGN_EMP_VW$"]`, and its `.locator("tr")`
+ `evaluateAll` collects both, so the read sees both rows (confirmed live: two `tr` under that
locator). Empl record **1** is a CONTINGENT-WORKER instance and renders in a different table,
`tdgbrPER_ASGN_CWR_VW$0`, which that selector does not match — and the CWR row carries **no HR-status
cell at all** (`1 | 06/24/2025 | SDCMP | 000254 | AQUARIUM-MUSEUM | CWR011 | Staff Volunteer |
09/19/2025 | 0.000000 | Staff: Contingent Worker | …`); the search results grid is where its
`Inactive` comes from. Here it changes nothing — the disposition is `single-active-job` either way,
and this pass is read-only so nothing was changed. It is written down because **a person holding an
ACTIVE contingent-worker instance would be invisible to the assignments-grid read**, and that is a
question for whoever next owns that selector, not a claim that today's answer is wrong.

#### 5. UCPath, EID <secret:separationsKualiFinalizationCanaryEid> — the pending-transaction picture

SS Smart HR Transactions, `Empl ID = <secret:separationsKualiFinalizationCanaryEid>` with the operator set to `=`; the results grid settled
in **2.33 s**, and every one of the five transaction detail pages was read back and proved its own id.
Whole scan: **5.01 s**.

| Transaction | Name | EID | Action | Status | Start date | BU |
|---|---|---|---|---|---|---|
| `T002125072` | <secret:separationsKualiFinalizationCanaryEmployeeName> | <secret:separationsKualiFinalizationCanaryEid> | COM | **Approved** | 06/24/2025 | SDCMP |
| `T001941738` | <secret:separationsKualiFinalizationCanaryEmployeeName> | <secret:separationsKualiFinalizationCanaryEid> | **TER** | **Approved** | 06/09/2025 | SDCMP |
| `T001927738` | <secret:separationsKualiFinalizationCanaryEmployeeName> | <secret:separationsKualiFinalizationCanaryEid> | HIR | **Approved** | 07/07/2025 | SDCMP |
| `T001884520` | <secret:separationsKualiFinalizationCanaryEmployeeName> | <secret:separationsKualiFinalizationCanaryEid> | ADD | **Approved** | 09/20/2024 | SDCMP |
| `T001175063` | <secret:separationsKualiFinalizationCanaryEmployeeName> | <secret:separationsKualiFinalizationCanaryEid> | HIR | **Approved** | 02/02/2023 | SDCMP |

**Zero `Pending` rows.** The 2025 `TER` is the termination of empl record 0 and is long since
approved; the `HIR` a month later is the rehire that produced today's active record 2. So the
`clear-pending` sweep on this subject settles **`already-present`** at beat ① with nothing staged and
nothing clicked — the same arm every mapped subject has taken since the operator deleted `T002209631`
(§9.16). **Naming 4537 the canary does not give the sweep's COMMITTED arm a witness**, and that
remains true of every subject this migration has mapped.

#### 6. What S7 says, exactly, and when it stops saying it

`planSeparation` compares both Kuali dates against `pacificCalendarDay(observedAt)` and refuses
`separation-date-in-future` when either is LATER. On Pacific calendar day **2026-08-19**:

> Kuali document 4537 carries a Last Day Worked of 08/28/2026, which is after 08/19/2026 — the Pacific
> calendar day this run read the document. The employee is not yet eligible for separation (S7).

The comparison is strictly *later*, so equality passes: **4537 becomes plannable on Pacific calendar
day 2026-08-28**, nine days from this pass, and its derived termination effective date would be
`08/29/2026` (separation date plus one). Until then a composed `separations` run on 4537 fails at
`plan` in milliseconds, before any browser — the same refusal 4495 proved live at §9.17a run 4.

**Attribution matters here and is the §9.16 lesson applied.** This is OUR rule. This pass did **not**
type <secret:separationsKualiFinalizationCanaryEid> into the Smart HR wizard's Page B, so it makes **no claim** about whether UCPath would
stage a termination for a future-dated subject; that question is unasked, not answered. What is
answered is that nothing on our side except the date blocks the filing: one active job, a template
that resolves, a department option the document already holds.

#### 7. The live document inventory moved again — 4510 is gone

The Kuali action list holds exactly **three** items today, and 4510 is not one of them. Re-opening its
recorded action id confirms it:

| Doc | Action id | Step | State, 2026-08-19 |
|---|---|---|---|
| 4537 | `6a8336ee44b521eae41895dc` | `Task 1 - Kristina & TES` | **open** · <secret:separationsKualiFinalizationCanaryEmployeeName> / EID <secret:separationsKualiFinalizationCanaryEid> · LDW+sep `08/28/2026` (future) · five of twelve staged fields populated |
| 4502 | `6a766ae6f0549046f7f0dc06` | `Task 1 - Jan` | **open** · Emily Zimmerman · in the action list, unchanged from §9.16 |
| 4495 | `6a73abda824c9a5388e0ceaa` | `Task 1 - Kristina & TES` | **open** · Alaric Bermudez · LDW/sep `09/02/2026`, still future, S7 still refuses |
| 4510 | `6a7a33b2ac106d428b3217e0` | `Task 1 - Jan` | **COMPLETED** · `completed: true`, `document: null`, form gone, both date controls resolve to **zero** nodes |
| 4524 | `6a7e45bcbac487bbc6a2ceae` | `Task 1 - Kristina & TES` | COMPLETED 2026-08-14 (§9.16), unchanged |

**§9.16 item 4's recommendation is withdrawn on the facts.** It named doc **4510** the best-mapped
open document for a standalone `separations-kuali-finalization` controlled commit. Its action has since
been completed, `ActionPage` answers `document: null`, and `kuali/read-separation-document` can no
longer read it — exactly what happened to 4524 between §9.12 and §9.16, now for the second time. The
generalization §9.16 drew stands and is worth restating: **a live inventory belongs in an as-built with
a date on it, never in a plan sentence.** Two named Kuali canaries have now evaporated between passes.

#### 8. So what should the operator do

- **③ before ② is the wrong order.** `separations-kuali-finalization` takes `transactionNumber` as
  INGRESS and has no `match-active-employment` and no S7 check, so it is runnable on 4537 **today**.
  But its whole product is a Kuali document recording a termination that UCPath filed, and UCPath has
  filed nothing for <secret:separationsKualiFinalizationCanaryEid> since 2025. Running it now would either write a fabricated transaction
  number onto a real HR document or leave the field naming nothing — the write would land, and the
  record would be false. **Wait for ②.**
- **② is a date away, not a defect away.** On or after **2026-08-28** the composed graph plans 4537,
  reaches its ALWAYS-GATE with a single active job and a resolvable template, and its UCPath
  transaction node is the §4f2 canary the operator intended. Nothing else has to change.
- **① has no target and 4537 does not become one.** The sweep's committed arm needs a subject with a
  **pending** UCPath transaction, and 4537's subject has five approved ones and no pending row. If that
  arm is to be proved live, the subject has to come from somewhere else — or from a pending row that
  exists at the moment ② runs, which is the one honest way it could still appear (filing ② and then
  re-running ① before an approver clears it).
- **The practice set is unchanged.** 4502 remains the full-chain composed dry-run subject (§9.17);
  4537 and 4495 serve the standalone read workflows and the S7 refusal path until their dates pass —
  4537 on 2026-08-28, 4495 on 2026-09-02.

#### What is honestly NOT RUN

- **Every real write, of every kind.** No Kuali save, no UCPath transaction, no sweep. All three
  controlled commits remain owed.
- **The Smart HR wizard, at all.** Page-B stageability for <secret:separationsKualiFinalizationCanaryEid> was NOT probed, so this pass makes
  no statement about what UCPath would do with a future-dated subject.
- **Any dashboard run.** The BFF was not started and no run was planned, so nothing here exercised the
  composed graph, the gate, the receipt, or S7's live refusal on 4537 — S7's verdict above is read off
  the rule and the observed dates, not off a run. A composed run on 4537 has never happened.
- **Kronos**, the timecard window, and the finalization's `already-present` arm — none reachable from a
  read-only pass.
- **The two dates' WIRE shapes** and the other five unasserted Kuali wire shapes, unchanged: they close
  only by observing a real `submitDocumentV2` payload.
- **The parity lane**, unchanged: no dashboard bytes moved in this pass.

---

### 9.20 The live retry proof — D221 exercised on the composed graph for the first time, 2026-08-19

D221 landed on 2026-08-14 with `tests/unit/retry-item-attempt.test.ts` and, in §9.17's own words,
*"has still never been exercised LIVE on this graph, which is the honest remaining statement."* This
pass is that exercise. Everything below ran against production through the REAL pipeline — start
plan → `POST /api/v1/commands` → worker claim → gate → real approval → resume — on a BFF whose
served `separations` `contractFingerprint` was verified against the working tree's build manifest
BEFORE anything was planned (§9.16 §5's standing habit).

**Every run was `dryRun: true`.** No UCPath transaction was staged or submitted, no Kuali `Save` /
`Send Back` / `Mark Complete` was clicked, `submitDocumentV2` was never issued, the Smart HR
wizard's `Continue` was never clicked, and `Delete Selected Transactions` was never clicked. The two
gate approvals were taken through this system's own command endpoint, which is our gate, not an HR
system write.

**Nothing was written, anywhere.** Asserted against the authority database after the pass, not from
logs: `write_intents` **2**, `write_attempts` **3**, `durable_outbox` **2** — byte-for-byte the same
counts §9.17 recorded, all of them 2026-08-04's Phase-2 controlled commit on Kuali doc **4489**,
newest row `2026-08-04T17:08:54.867Z`. **Zero** rows in any of the three carry a `ucpath` or
`separations` permanent key, and `run_checkpoints` holds **zero** rows for `clear-pending`,
`file-termination`, `finalize-kuali` or `receipt` across every run this database has ever held.

#### The honest status

| Asked for | Status |
|---|---|
| A retry through the REAL command endpoint mints the item's NEXT unspent attempt | **MET, six times** — two lineages, attempts 2→3 and 2→3→4→5→6 |
| The enqueue does not refuse, and no checkpoint collision occurs | **MET** — every retry claimed and executed; §9.18 item 8's refusal never appeared |
| The retried run reaches a real terminal state | **MET** — five terminal `failed`, and one terminal **`done`** at the preview terminal |
| Checkpoint REUSE across a retry | **MET** — one retried run replayed **eight** nodes written by **two different runs at two different attempts**, then re-executed the `always-rerun` node |
| The `always-rerun` node §9.18 item 8 died on, re-executed across a retry | **MET** — `timecard-search` executed at attempts 4, 5 and 6, and inserted checkpoints at four distinct `(attempt, claimGeneration)` keys |
| A same-day healthy baseline beside the retry evidence | **MET** — run `4ee84ac2` reached D215's `already-present` preview terminal |
| Zero durable write rows, proved from authority | **MET** — counts above |
| A new platform defect | **NONE.** Two OPERATIONAL findings, items 5 and 6 |

#### 1. The two lineages, verbatim from authority

Every row below is `dryRun: true`. `runNumber` is the workflow ordinal (D230); `retryOf` is the run
each retry names.

| Run | Trace | Item | Attempt | `runNumber` | `retryOf` | Outcome | Wall |
|---|---|---|---|---|---|---|---|
| `3ad69642` | `sp-061311-3ad6` | `571baa04` (doc 4510) | **2** | 1 | — | `failed` | 86.4 s |
| `14947724` | `sp-063118-1494` | `571baa04` (doc 4510) | **3** | 2 | `3ad69642` | `failed` | 35.4 s |
| `6d809932` | `sp-063316-6d80` | `c9837287` (doc 4502) | **2** | 3 | — | `failed` | 76.1 s |
| `97438b59` | `sp-063905-9743` | `c9837287` (doc 4502) | **3** | 4 | `6d809932` | `failed` | 62.1 s |
| `3fe48219` | `sp-064154-3fe4` | `c9837287` (doc 4502) | **4** | 5 | `97438b59` | `failed` | 45.5 s |
| `6f7821f7` | `sp-064320-6f78` | `c9837287` (doc 4502) | **5** | 6 | `3fe48219` | `failed` | 208.1 s |
| `4ee84ac2` | `sp-064758-4ee8` | `c9837287` (doc 4502) | **6** | 7 | `6f7821f7` | **`done`** | 136.3 s |

The 4510 item had spent attempt 1 on 2026-08-14 (§9.17 part B, `ee9824f7`, not dry). The 4502 base
item had spent attempt 1 **three times** — `1fd7b3a4`, `12a5cd3e` and `555ba4b4`, all born at 1
because that is what a pre-D221 enqueue did. Both items' next unspent attempt was therefore correct
on the first read, and every retry advanced it by exactly one.

#### 2. What D221 demonstrably did, stated as the counterfactual

D221's rule is one sentence of code in `command-kernel.ts` — a retry's envelope takes
`repositories.runs.nextItemAttempt({workflow, itemId})` instead of `1` — backed by a refusal in
`authority-database.ts` that rejects an attempt the item has already spent:

> `run <id> is enqueued for separations item <item> at attempt <n>, which that item has already`
> `spent (its next unspent attempt is <m>); an attempt is the item's, not the run's, and no two runs`
> `of one item may hold the same one`

**That refusal never fired in this pass**, because nothing ever tried to spend a spent attempt. What
makes the fix load-bearing is what would have happened without it, and the checkpoint ledger says it
exactly. Checkpoint replay is item-scoped and takes the LATEST row for `(workflow, item, node)`
regardless of attempt; the checkpoint INSERT is keyed
`(workflow, item, node, attempt, claimGeneration)`.

- **Retry `97438b59` (attempt 3).** Its first executed node was `name-search`. Pre-D221 it would have
  been born at attempt 1 / generation 1, and the item already holds `name-search` at exactly that key
  — written by `12a5cd3e` on 2026-08-14 — with different content, because this was a fresh live read.
  It would have died there, in about two seconds, one node into a run that went on to read UCPath
  successfully.
- **Retry `3fe48219` (attempt 4).** Its first executed node was **`timecard-search`** — §9.18 item
  8's node, the one whose live collision message that item records verbatim. Pre-D221 it would have
  been born at attempt 1 / generation 1, where `12a5cd3e` already holds a row. Instead it ran the
  node live for 32.19 s.

Post-D221 the ledger simply grew beside the old rows. Every checkpoint written today, in order:

| Node | Attempt | Claim gen | Run |
|---|---|---|---|
| `document` · `plan` · `termination-type` | 2 | 1 | `6d809932` |
| `name-search` · `subject` · `job-summary` · `employment` · `department-option` | 3 | 1 | `97438b59` |
| `timecard-search` · `timecard` · `dates` · `comparison` | 5 | 1 | `6f7821f7` |
| `timecard-search` · `approval` | 5 | **2** | `6f7821f7` |
| `timecard-search` | 6 | 1 | `4ee84ac2` |
| `timecard-search` · `approval` | 6 | **2** | `4ee84ac2` |

`timecard-search` — an `always-rerun` node by design, because its product is browser state — holds
**four** rows from today at four distinct keys, beside the two rows from 2026-08-14 at
`(attempt 1, generation NULL)` and `(attempt 1, generation 1)`. D214's generation half and D221's
attempt half are visible in the same column: the generation separates the two executions inside one
attempt that a gate park-and-resume produces, and the attempt separates the retries.

#### 3. Checkpoint reuse across a retry, which is the half that makes a retry cheap

Retry `3fe48219` (attempt 4) emitted **no spans at all** for `document`, `plan`, `termination-type`,
`name-search`, `subject`, `job-summary`, `employment` or `department-option` — a replayed node emits
none — and started directly at `timecard-search#1.1`. Those eight checkpoints were written by **two
different runs at two different attempts** (`6d809932` at attempt 2; `97438b59` at attempt 3), which
is cross-run, cross-attempt replay working exactly as D221 promised it would remain untouched.
Retry `4ee84ac2` (attempt 6) did the same, and additionally replayed `timecard`, `dates` and
`comparison` from attempt 5's rows after its own gate resume.

`npm run cli explain run sp-064758-4ee8 --json` reports it in its own `reuse` section, which
lists exactly the replayed nodes that carry a declared freshness bound:

```
reuse  [ { nodeId: "name-search",  kind: "checkpoint", ageMs: 612568, freshnessLimitMs: 1.44e7 },
         { nodeId: "job-summary",  kind: "checkpoint", ageMs: 608893, freshnessLimitMs: 1.44e7 } ]
writes []
```

Both were ~10.2 minutes old against a 4 h bound — a retry three runs later reusing reads the first
run paid for, with the freshness contract still checked rather than assumed.

**One consequence worth naming: a retry re-asks the gate.** The durable gate decision is keyed
`<runId>:<gateId>`, so a retried run is a new run with no decision of its own and parks again. That
is correct — a new attempt is a new decision, and D211's digest binds an approval to the packet it
was shown — and it is why this pass took **two** real approvals rather than one.

#### 4. The run that closed it: `4ee84ac2` · `sp-064758-4ee8` · attempt 6 · terminal `done`

The retried run reached the same preview terminal §9.17 reached, on the same subject, five days
later and six attempts into one logical item.

| Segment | Node | Wall |
|---|---|---|
| claim → gate | eight nodes **replayed**, then `timecard-search#1.1` | **1.83 s** (warm New Kronos session) |
| | `timecard` · `dates` · `comparison` replayed | — |
| | `gate.opened` | at `13:48:20.969Z`, **1.85 s** after claim |
| approval → terminal | `timecard-search#2.1` (always-rerun, generation 2) | 29.82 s |
| | `approval#2.1` | 0.00 s |
| | `clear-pending` preview, incl. a cold UCPath login | 23.6 s |

The gate as the wire served it, and the approval:

```
gateId            identity-approval          parkedAt   2026-08-19T13:48:21.033Z
resumeAt          approval                   expectedVersion 8
resultSchemaHash  2165f585c743…              evidenceDigest  29435d362c6c…
approvalShape     one-click                  approvableEids  [10001754]
options[0]        eid 10001754 · chosenFrom "checked" · "Dreitho Cramia"
observedAt        2026-08-19T13:40:02.416Z   (the replayed job-summary read, attempt 3)
```

Command `1e61ca28-7a6a-4441-b11c-48c1db263770` at `2026-08-19T13:48:53.801Z`, applied; the durable
decision landed at `13:48:53.810Z` attributed to `local-operator`, carrying `decision: approved`,
`eid 10001754`, `chosenFrom: checked` and the bound `evidenceDigest`. The packet was the §9.17 shape
on the same subject — four comparisons all `agrees`, `single-active-job`, and D211's write plan
(`UC_INVOL_TERM` / `Appointment Expired` / empl record `0` / effective `04/01/2026` / LDW
`03/31/2026`; department `000412 - Housing/Dining/Hospitality`; dates unchanged with
`unclassifiedPayCodes: ["Farmworkers Day"]`). The `evidenceDigest` moved from §9.17's `a43f789b…` to
`29435d36…` — the `observedAt` inside the packet is a different read, so a different packet, so a
different approval. That is the binding working, not drift.

**The terminal, verbatim.** `transaction.previewed` at `2026-08-19T13:50:14.442Z`, `node:
clear-pending`, `subject: not-observed`, `externalCommit: none`. The `run_results` row is a
`dry-run-preview` bound to schema hash **`86cd007a59d4…`** — the same preview schema §9.17 recorded,
not the workflow's declared result — carrying

```
outcome  { state: "already-present", proofSource: "live-probe" }
probe    ucpath-pending-terminations-clear · emplId 10001754
         source "ss-smart-hr-detail-read" · scannedRowCount 2 · observedAt 13:50:11.375Z
dependencies  [ approval ]  checkpoint attempt 6, claimGeneration 2
externalCommit "none"
```

The receipt is `partial` / `unknown` / `output: []` with the one load-bearing warning, and its
`descriptorFingerprint` is the run's own retained `2c9cb58e…` (D199):

> `DRY_RUN_PREVIEW` — *"this run was a DRY RUN: transaction node "clear-pending" was previewed
> (settled already-present at its present probe, before anything was staged, observed
> 2026-08-19T13:50:14.441Z) and the run ended there. No external write was attempted — no write
> intent, no fence, no commit — so this receipt states what WOULD have been written, never what was"*

Verification is D210's shape unchanged: fourteen nodes `verified` including `node.identity-approval`
(D204, live for the fourth time), the four write-half nodes and `completion.terminal-result`
`unknown`. `subjectBindings` carries all three read contracts' subject proofs.

#### 5. The 4510 lineage, and why it is the cleanest half of the proof

Doc **4510** is the subject §9.19 recorded as GONE — its Kuali action was completed on 2026-08-14 and
`ActionPage` answers `document: null`. That makes it the ideal retry subject: a run on it fails
loudly, at the first node, for a reason that has nothing to do with the platform. Both runs failed
identically, in 34.30 s and 35.14 s, on the ported bound that exists for exactly this:

> **`document-unavailable`** · node `document` · task `kuali/read-separation-document`
>
> *"Kuali action 6a7a33b2ac106d428b3217e0 did not render document 4510: Kuali action
> 6a7a33b2ac106d428b3217e0 did not render a document-number heading within 30000ms; the action id may
> be stale (a completed step redirects to the Action List) — refusing to treat this page as a
> document (observed URL https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb/actions/
> 6a7a33b2ac106d428b3217e0/view). An action id names a workflow STEP, not a document, so a completed
> or reassigned step no longer resolves to a form."*

The retry `14947724` was queued at `13:31:18.294Z`, claimed **1.07 s** later, executed `document`
live, and terminalized `failed` at `13:31:53.699Z` — a complete retry cycle in **35.4 s**, at the
item's attempt **3**, with no collision and no refusal. **A failing-again retry is a valid terminal**:
what is being proved is that retry works, and a run that fails for the same external reason twice is
the honest outcome when the world has not changed.

#### 6. Operational finding — the UCPath profile wedge, sharpened

§9.17 item 5 recorded a worker browser profile reaching a state where every UCPath acquisition burns
the whole 60 s `timeouts.sessionAcquireMs` bound while a fresh profile logs in fine, and recorded it
*"as a shape, not diagnosed to root cause."* This pass reproduced it twice and narrowed it
considerably, because it watched a profile go from cold to wedged inside six minutes.

| Time | Profile state | UCPath acquisition |
|---|---|---|
| 13:33:32 → 13:34:32 | 5 days old (last written 2026-08-14) | **60.01 s**, `login-failed` |
| 13:35 | cold-profile login smoke, `--cold` | **16.9 s**, `PS_TOKEN` proved, both negative facts proved |
| 13:39:34 → 13:39:52 | **freshly deleted, cold** | **18.25 s**, `logged-in`, read succeeded |
| 13:45:49 → 13:46:49 | the SAME profile, one login old | **60.01 s**, `login-failed` |
| 13:49:50 → 13:50:11 | **freshly deleted, cold** | **20.49 s**, `logged-in`, probe read succeeded |

The cookie jar says the same thing both times it wedged: the flow reaches Duo and never completes.
After the 13:46 failure the profile held **one** `frameless-session-binding-*` cookie at
`api-ce13a1a7.duosecurity.com` (expiring `14:00:55`, i.e. minted at that attempt), the
`auth-sid-c` / `hac|…` / `lam|…` / `trc|…` set, a `SimpleSAML` cookie at `idpproxy-ucpath` — and
**zero `PS_TOKEN` rows**, the exact positive artifact the verifier requires. The 2026-08-14 profile
§9.17 examined had three such binding cookies, one per failed attempt; this one had one, because it
had failed once.

**What is new here.** §9.17's profile had accumulated days of state, which left "stale accumulation"
as the obvious hypothesis. This one had completed exactly ONE successful Duo ceremony minutes
earlier and nothing else, and the very next acquisition on it wedged. So the shape is narrower than
recorded: *a per-(worker, system, config) profile that has completed one Duo WebAuthn ceremony can
fail every subsequent acquisition, while a cold profile succeeds in under 20 s.* The remediation is
unchanged and still operator-level — delete the directory, it is a cache and not authority — and the
runtime still says nothing about it: the failure message names Duo hand-approval and
`timeouts.duoApprovalSeconds`, which is a real cause and is not this one. **Not diagnosed to root
cause here either**, and deliberately not fixed in a live-proof slice; it is the same open item §6
already carries, now with a much tighter reproduction.

#### 7. Operational finding — a COLD New Kronos profile's first Employee Search

The New Kronos profile was also five days old and refused its login by name, which is the verifier
doing its job rather than a wedge:

> `[new-kronos/search-employee] unhandled: new-kronos login failed at verify-landing: the login could`
> `not prove the authenticated application: the observed URL is not the UKG Dimensions (WFD)`
> `application; the ForgeRock sign-on host shares the mykronos.com domain and is refused here`
> `(observed URL https://cust01-prd07-ath01.prd.mykronos.com/authn/XUI/?realm=ucsd_prd_01&…)`

Deleting it fixed the login — and the FIRST search on the now-cold profile then failed differently,
32.19 s in:

> `[new-kronos] an Employee Search result row does not carry the "Name <name> ID <eid>" identity WFD`
> `renders — observed ""; refusing to read a row whose subject is unknown`

The very next attempt, on the same profile now warm, resolved the same search in **1.83 s** and every
Kronos read afterwards worked (29.98 s, 31.13 s, 29.82 s — all logins, matching §9.17's ~30 s). So
the refusal is **first-search-on-a-cold-profile** behaviour, not a selector break: the row rendered
before its identity text did. **Recorded, not diagnosed** — the honest statement is that a cold WFD
profile's first Employee Search can present a result row whose identity cell is still empty, and the
driver correctly refuses to read a row whose subject it cannot name rather than guessing. Whether
that wants a bounded wait on the identity cell is the driver owner's call, not this pass's.

#### 8. Two operational facts about the runtime, both working as designed

**(a) A SIGTERM'd worker leaves its authority lease live for 60 s.** Stopping the worker to clear a
profile and restarting it immediately was refused:

> `worker separations-worker-1 cannot start: worker separations-worker-1 already holds a live lease`
> `in state idle; a second process may not answer to the same worker id`

That is the intended interlock. The lease heartbeat was 11 s old, well inside
`WORKER_CLAIM_STALE_AFTER_MS` (60 s), so the reclaim-before-acquire sweep correctly declined to
settle a lease it could not prove stale. Waiting past the window and restarting produced the expected

> `stale worker lease reclaimed before start; its process never settled`

and the worker came up. Worth knowing operationally: **there is a 60-second floor on restarting a
worker you killed**, and the recorded remedy is to wait, never to hand-edit a lease.

**(b) The runtime lock releases on a dead holder, as designed.** The `workers` role lock was left
unreleased by the killed process (`releasedAt: null`, pid 28837); the next boot observed liveness via
`process.kill(pid, 0)`, found the holder gone, and proceeded to generation 51 without touching the
file by hand. Same for the `server` lock this pass inherited.

#### What is honestly NOT RUN

- **Every real write, of every kind**, and all three controlled commits — unchanged from §9.17. The
  composed graph has still never entered a transaction node's commit arm on any subject.
- **The gate REJECTION arm.** Both approvals were `approved`; `identity-approval-rejected` has still
  never been taken live.
- **The `would-prepare` preview arm**, unchanged: only `already-present` has ever settled live, for
  §9.17's reason — the only mapped subject with a pending row is the one the composition refuses
  pre-gate.
- **A retry across a DESCRIPTOR change.** Every checkpoint replayed today was written under the same
  `contractFingerprint` the retry ran under. The 2026-08-14 rows correctly did NOT replay
  (`contract-fingerprint-mismatch`), which is why the first run of each lineage re-read everything —
  observed, but the migration path itself was not exercised.
- **`probeToFenceMaxMs`'s per-beat decomposition**, unchanged from §9.17 item 4: a preview has no
  fence.
- **The parity lane**, unchanged: no dashboard bytes moved in this pass.

---

### 9.21 The browser-profile wedge, ROOT-CAUSED — a shared WebAuthn counter with unsynchronised writers, 2026-08-19

§9.17 item 5 recorded it as *"a shape, not diagnosed to root cause"*. §9.20 item 6 sharpened it and
said the same thing. This pass diagnosed it, fixed it, and proved the fix live. **It was never about
the browser profile.** It is a Duo WebAuthn signature-counter regression that a per-profile counter
makes inevitable, and every remediation anyone had found — delete the profile directory — worked for
a reason nobody had identified.

Everything below ran against production through the REAL session code: the real
`PlaywrightWorkerSessionFactory`, the real `ucpathLoginRecipe`, the real `WorkerSessionManager` lease
under the real 60 s `sessionAcquireMs`. The only addition was observation, attached through the
factory's own declared `PersistentContextLauncher` seam plus direct interrogation of the extension's
MV3 service worker (`worker.evaluate`), so nothing in the login path was simulated or bypassed.

#### 1. What the tight reproduction actually showed — and what it ruled out

§9.20's narrowing (*"a profile that has completed exactly ONE Duo ceremony wedges on its next
acquisition"*) **is not the invariant, and this pass falsified it first.** A cold profile logged in
in **19.16 s**; the very next acquisition on that same one-ceremony-old profile logged in in
**19.14 s**; a third, after another profile had been cold-started in between, logged in in
**20.48 s**. Three successes where the recorded shape predicted a wedge.

What the instrumented runs DID show sat in the extension's own storage, read live off the service
worker:

| when | `internal` | `usb` |
|---|---|---|
| cold profile, before login | 1787191796 | 1787191796 |
| same profile, after login | 1787191796 | 1787191797 |
| second acquisition, before | 1787191796 | 1787191797 |
| second acquisition, after | 1787191796 | **1787191798** |

The counter is a **unix timestamp**, and it is stamped as one only on a COLD profile's auto-import
(`autoImportPackagedCredential`, whose own comment says why: *"a unix timestamp is monotonic across
fresh browser profiles"*). Afterwards the sign path advanced it by exactly **one**.

#### 2. The bisection — one variable, both directions

Duo's server-observed counter for the shared credential stood at **1787192063**. On the same warm
profile, with nothing else changed, the stored counter was forced to **1787191000** (1 063 behind)
through the extension's own options page:

> `[+10.25s] console(debug): [Duo Autopilot] answered Duo WebAuthn ceremony (usb)`
> `[+56.99s] url: https://api-ce13a1a7.duosecurity.com/prompt/DA6QL3UFNF54WTIT1EQC`
> `[+56.99s] bodyText:`
> `Couldn't use security key`
> `Your login request using your security key was canceled or timed out.`
> `Show other options · Try again · Need help?`
> `[+60.01s] RESULT: acquisition FAILED: … exceeded its 60000ms timeouts.sessionAcquireMs bound`

That is the wedge, on demand: **60.01 s, on the Duo host the entire time, zero `PS_TOKEN`** — every
number §9.17 and §9.20 recorded. The shim ANSWERED the ceremony (so this is Duo rejecting the
assertion, not Duo Autopilot failing to answer it), which is precisely the failure mode the
extension's own README has always described as *"the first assertion is rejected and the prompt just
hangs"* — a sentence written about a stale imported file, never connected to the profile wedge.

#### 3. Why a per-profile counter cannot work here

A WebAuthn server treats a counter that does not ADVANCE as a cloned-key signal. Duo's counter is per
**credential** and one credential covers every UCSD system (`duo-autopilot/README.md`). Duo
Autopilot's copy is per **browser profile** (`chrome.storage.local`), and ref execution-and-sessions §1 partitions
profiles per `(worker, system, instance, configFingerprint)`. So N writers share one server-side
counter and none of them can see another's copy.

Under `stored + 1`, a **cold** profile JUMPS the shared counter to `now` on import while a **warm**
profile creeps by one. A warm profile that was cold-stamped earlier is therefore behind by however
much wall clock elapsed between the two stamps, and it advances one per login against a gap measured
in seconds — **it can never catch up.** Every subsequent login on it is refused, forever, and
recreating the directory is the only exit, because that is what re-stamps `now`. That is the whole
observed shape: §9.17's days-old profile, §9.20's six-minute-old one (a Kronos profile was cold-
started in that same window, §9.20 item 7 — which is the ceremony that jumped the counter past it),
and the fact that deleting the directory always worked.

#### 4. The second half nobody had seen: a clone signal BURNS the profile

The pure counter model does not explain §9.17's **three consecutive** 60 s failures — the extension
bumps `+1` on every attempt, so attempts two and three presented advancing counters and still failed.
This pass reproduced that too, by accident and then deliberately. Once Duo had refused one
behind-counter assertion, **that profile kept being refused across three further acquisitions whose
presented counters were more than a thousand AHEAD** (~9 s each, same terminal screen), and only a
freshly created profile recovered — which it did immediately, **18.94 s, `PS_TOKEN` proved**, showing
the credential itself was never damaged.

**Recorded as an observation, not a mechanism**: Duo's reason is not visible to us. What is proved is
that the refusal is sticky to the profile (its `trc|` / `hac|` / `lam|` device cookies) rather than to
the credential, and that a single clone signal converts one failed login into a permanently unusable
profile. That is what makes the counter defect a *wedge* rather than a retryable error, and it is why
the fix has to prevent the first refusal rather than recover from it.

#### 5. The fix, and the live proof of it

**(a) `duo-autopilot/src/sign-count.js` (D243).** Every ceremony floors its counter at wall-clock
seconds: `max(stored + 1, nowSec)`. That is monotonic across every profile sharing the credential,
because they all read the same clock — the property the shared server-side counter actually requires,
and the property the import path already assumed while the sign path did not. `stored + 1` survives
underneath so two ceremonies inside one second still advance and a backwards clock can never lower
what we present.

**The counterfactual, run on a clean profile:**

| stored counter | presented | outcome |
|---|---|---|
| 1787191000 (pre-fix) | 1787191001 (`stored + 1`) | refused — **60.01 s** bound burned, no `PS_TOKEN` |
| 1787191000 (post-fix) | **1787193576** (wall clock) | **`logged-in` in 17.83 s**, `PS_TOKEN` proved |

The presented value was read off the service worker's own storage as it moved
(`counters: [1787191000, 1787191000]` → `[1787191000, 1787193576]`), so this is what the extension
actually sent, not an inference from the outcome.

**(b) `waitForAuthenticatedLanding` (D243, second half).** The runtime's own defect is that it could
not SAY any of this. The landing bound is `duoApprovalSeconds` (180 s) and the acquisition envelope is
`sessionAcquireMs` (60 s), so the envelope always fires first and cancels the wait —
`describeStalledLanding`, the function whose entire job is explaining a stalled Duo login, is
**unreachable at the shipped defaults**, and the operator gets D125's message naming Duo hand-approval
and `timeouts.duoApprovalSeconds`. §9.17 flagged that message as a mis-attribution and it stayed. Doc
ref execution-and-sessions §4.1's rule answers it: authentication is decided by CONTENT, and so is its refusal — Duo says so
in words about a second after the assertion. The wait now races the landing against that observation.
Live, on the burned profile:

> `[+9.52s] RESULT: acquisition FAILED: ucpath login failed at duo-clearance: Duo REFUSED the`
> `WebAuthn assertion and rendered its terminal "canceled or timed out" screen; … it is a Duo`
> `Autopilot signCount regression, where this browser profile's stored counter has fallen BEHIND the`
> `value Duo has already observed for the shared credential … Check the extension's stored signCount`
> `before touching timeouts.duoApprovalSeconds or timeouts.sessionAcquireMs`

**9.52 s instead of 60.01 s, naming the real cause.** A negative control keeps a merely-slow Duo
prompt reporting the old message, because collapsing two Duo failures into one is the same
mis-attribution pointed the other way.

**(c) The pins (D244).** `tests/unit/duo-sign-count.test.ts` imports the real production function —
the rule lives in one chrome-free ESM module with a sibling `.d.ts` precisely so this repository's own
gate can hold it, since `duo-autopilot/npm test` is not part of `npm run test:coverage` and a rule
pinned only there is a rule no per-commit gate checks. Its load-bearing case is a **two-profile
simulation**, because the defect is invisible to any single-writer example — which is exactly how
`stored + 1` survived from the extension's first day. `tests/unit/system-login-recipes.test.ts` pins
the refusal arm plus its negative control. Both were verified RED against the pre-fix code; the
counter pin's failure output is the wedge in one line:
`warm@1210 presented 1003 <= observed 1201`.

#### 6. Two side facts, recorded rather than claimed

- **The extension version was bumped `0.1.0` → `0.2.0`** with the change, which is ordinary hygiene
  for anything a browser may cache by version. This pass **cannot claim it was required**: the runs
  that appeared to ignore the fix were all on the profile burned in §4 above, and the service worker
  reported `backgroundHasFix: true` both before and after. Recorded so nobody later infers a
  cache-invalidation rule this evidence does not support.
- **`Local Extension Settings` was observed being recreated on some relaunches**, which re-runs the
  cold-import stamp and silently self-heals a stale counter. That is a real behaviour and is
  deliberately NOT relied on: a fix that works because storage sometimes disappears is not a fix, and
  it is part of why the wedge looked intermittent.

#### What is honestly NOT RUN

- **No workflow ran.** This pass performed logins and neutral resets only — no node, no read, no
  write, no durable row. It is the same lane as `scripts/live-browser-login-smoke.ts`.
- **Only UCPath, only the `usb` credential.** `pickCredential` chose the security key on every
  ceremony, so the `internal` (Touch ID) arm was never exercised and the refusal screen's Touch ID
  wording has never been observed — the marker matches the outcome SENTENCE rather than the heading
  for exactly that reason, and the Touch ID heading remains unverified.
- **CRM, Kuali, New Kronos and ServiceNow** were not re-tested. They share the credential and the
  same shared-counter argument applies to them unchanged, but no login on any of them was run here.
- **§9.20 item 7's cold-profile New Kronos observation** is untouched and still open; it is a
  different finding that happened to sit in the same window.
- **The parity lane**, unchanged: no dashboard bytes moved in this pass.

---

### 9.22 The Track C connection proof — the REAL dashboard driven against a REAL composed dry run, 2026-08-20

Wave 2's dashboard work (B1–B8, D226–D255) had been proved by unit, architecture and scenario gates
and by nothing that connected the two halves. This pass is that connection: a fresh BFF and vite
booted from the working tree at `d68f228`, a composed `separations` DRY run planned and started
through the real ingress, the identity gate approved **through the dashboard's own ceremony**, and
every surface claim paired with an independent read of authority (`sqlite3 .tracker-rebuild/state.db`)
or of the wire the BFF actually served. Nothing was fixed here; four defects and two operational
findings are RECORDED below, with their evidence, for the owners named.

**Every run was `dryRun: true`.** No UCPath transaction was staged or submitted, no Kuali `Save` /
`Send Back` / `Mark Complete` was clicked, `submitDocumentV2` was never issued, and the one approval
was taken through this system's own command endpoint, which is our gate rather than an HR write.

**Nothing was written, anywhere.** Asserted against authority after the pass, not from logs:
`write_intents` **2**, `write_attempts` **3**, `durable_outbox` **2** — byte-for-byte §9.17's and
§9.20's counts, all of them 2026-08-04's Phase-2 controlled commit on Kuali doc **4489**, newest
intent `2026-08-04T17:08:48.805Z`. `run_checkpoints` holds **zero** rows for `clear-pending`,
`file-termination`, `finalize-kuali` or `receipt` across every run this database has ever held.

#### 1. The fresh-BFF check, and the runs

`npm run dashboard` (D247's launcher — one command, BFF on 3938 plus vite on 5174) was started only
after the 06:28 pair inheriting the pre-wave-2 tree was killed, because §9.16 §5's stale-singleton
lesson is what makes this whole pass meaningful. `GET /api/v1/explorer` then served all eight
workflow `contractFingerprint`s, every one of them present in
`src/domain/workflow/generated-build-manifest.ts`, and `npm run build:manifest:check` reported the
manifest current. `separations` served **`59830cf6…`**, which is the fingerprint the start plan bound
and the fingerprint every run below carries.

| Run | Trace | Attempt | `runNumber` | Outcome | Wall |
|---|---|---|---|---|---|
| `fd7b7a71` | `sp-080612-fd7b` | **7** | 8 | `failed` — UCPath Duo refusal (item 5a) | 36 s |
| `21ed4aa0` | `sp-081003-21ed` | **8** | 9 | `failed` — New Kronos login refusal (item 5b) | 1 m 2 s |
| `e1b8ae3e` | `sp-081217-e1b8` | **9** | 10 | **`done`** at the preview terminal | 8 m 20 s (incl. 6 m parked) |

All three are item `c9837287` (`separations:4502`, Cramia, Dreitho / EID 10001754). The first was
started through the real `POST /api/v1/start-plans` → `POST /api/v1/commands` pair; **the second and
third were started from the queue row's own `Run again` control**, so D221's item-scoped attempt was
exercised twice more through the UI: 6 → 7 → 8 → 9, each the item's next unspent attempt, no
collision and no refusal. The 2026-08-19 checkpoints did NOT replay (`2c9cb58e…` ≠ `59830cf6…`), so
run 1 re-read everything live; runs 2 and 3 replayed what their predecessors had written.

#### 2. What the UI claimed, and what authority said

| Surface | UI claim | Paired authority / wire fact | Verdict |
|---|---|---|---|
| Run modal, B3/D250/D251 rows | `Examples` (One EID · An EID and a name), the parser prose *"An employee ID is eight digits beginning 10…"*, the `How this run is shaped` summary, `Active-run policy — Refuses the start while a run for the same subject is unfinished` | `person-lookup` descriptor `surfaces.inputRun`; `enqueue: "reject-active"` | **MET** |
| Run modal, Separation | listed under **7 not startable** with *"This workflow declares no typed-input surface, so this dialog has no box for it."* | `src/workflows/separations/descriptor.ts` `surfaces: {}` — deliberate, with its reason in the descriptor | **MET as declared** (item 4) |
| Run modal, D241 taxonomy | `Kuali Timekeeper Annotation` under **Test equipment**; the six separation harnesses carry *", a proving harness of Separation"* | the served taxonomy `role`/`categoryId` | **MET** |
| Queue row, D230 | `#8` / `#9` / `#10` with title *"Run #N of this workflow"* | `tasks.run_number` = 8 / 9 / 10 | **MET** |
| Queue row, D232 | `dry run` chip, *"Dry run — this rehearsal reads the systems and writes nothing."* | `envelope.dryRun = true` on all three | **MET** |
| Queue row, B4b | `attempt 9`, trace `sp-081217-e1b8`, `Kuali action 6a766ae6…`, `Review` → `Done`, `took 8m 20s` | `tasks.attempt`, `envelope.traceId`, the day wire's `subtitle`/`status`/`endedAt` | **MET** |
| Gate ceremony, B1/D226 | dialog **Approve this identity**; *What disagrees* FIRST with the honest empty state (*"Every compared field agreed. That is not the same as being the right person — it is the absence of a reason to doubt it."*), then *What agrees* (4 comparisons verbatim), *Approvable candidates*, *What this approval authorizes* (D211's block: template `UC_INVOL_TERM`, reason `Appointment Expired`, empl record 0, effective 04/01/2026, LDW 03/31/2026, dept `000412 - Housing/Dining/Hospitality`, title `STDT 3 (004920)`, timekeeper `Julian Zaw`, both dates, `Pay codes not counted: Farmworkers Day`) | `GET /api/v1/runs/:id/identity-gate` — same four comparisons, same plan block | **MET** |
| Ceremony chip line | `packet a6768671fb58… · ceremony one-click · parked 8:13 AM`, footer `rev 22` | wire `evidenceDigest a6768671fb58…`, `approvalShape "one-click"` (server-computed), `parkedAt 15:13:15.339Z`, `expectedVersion 22` | **MET** |
| The approval itself | one click on `Approve` | `checkpoint_payloads` key `e1b8ae3e…:identity-approval` — `decision approved`, `resolvedBy local-operator`, `resolvedAt 2026-08-20T15:19:19.644Z`, `eid 10001754`, `chosenFrom checked`, `evidenceDigest a6768671fb58…` **identical to the digest the dialog printed**, `expectedVersion 22` | **MET** |
| Decision record, D237 | `identity-approval · decision Approved · 8:19 AM` / *"Approved by local-operator · 8:19 AM"* | the same `gate_results` row | **MET** |
| Outcome bar, D238 | `dry run · partial · 8:20 AM`, icon `Done with warnings` | wire `outcome {state: terminal, result: "partial", rehearsal: true, completedAt 15:20:37.718Z}` — a rehearsal never wears `verified-done` | **MET** |
| Receipt tab | `receipt 8c4bf82e-414c-541a-85ce-d122a87eb397`, Input / Observations sections, redacted (`timekeeperName` → `Zaw`, EID → `4118`) | `evidence_receipts` row `8c4bf82e…` — `result partial`, `confidence unknown`, `output []`, 19 verifications, one load-bearing `DRY_RUN_PREVIEW` warning naming the probe at `15:20:37.714Z`, `descriptorFingerprint` the run's own `59830cf6…` (D199) | **MET** |
| Terminal result | — | `run_results` bound to the PREVIEW schema `86cd007a59d4ae67…` — §9.17's exact hash — `kind: dry-run-preview`, `externalCommit: none`, `clear-pending` settled `already-present` off a `live-probe` at `15:20:37.714Z` | **MET** |
| Zero writes | — | counts above | **MET** |

#### 3. Four defects this pass found, none of them fixed here — **ALL FIXED 2026-08-20**

> **RESOLVED same day.** (1) the replayed arm is D259 (a replayed node renders `replayed from
> attempt N`, derived from the checkpoint it replayed — never `pending`, never a fabricated
> duration); (2) the frozen elapsed is D256 (the page's now is DERIVED: one served-clock
> calibration plus the browser's monotonic delta, signed elapsed, every consumer on one clock);
> (3) the always-on shape hazard is fixed as a ref dashboard-surfaces as-built correction (a run compares against
> its OWN workflow's served fingerprint, three verdicts incl. `unserved`); (4) the stale panel is
> D257 (the open panel follows its run's served `rowRevision` off the day stream). The records
> below stay as found.

**(1) A REPLAYED node is indistinguishable from a node that never ran, on every surface that folds
spans.** Run `e1b8ae3e` replayed eleven checkpoints written by its two predecessors and executed four
nodes live, then resumed past the gate and executed three more. Replayed nodes emit no spans by
design, and the queue projection folds spans — so the queue row's pipeline chips and the run-shape
rail both report `document`, `plan`, `termination-type`, `name-search`, `subject`, `job-summary`,
`employment` and `department-option` as **`pending`**, on a run that has finished. Read at the
category level (D225) it is worse: `Kuali extraction — pending`, `Job summary — pending`, and
`Identity check — pending, took 0s` on the very category whose gate the operator personally approved
one minute earlier. Confirmed at the WIRE, not the client: `GET /api/v1/runs/:id` serves
`steps[0].state = "pending"` after the run is terminal. The honest word for a replayed node is not
`pending`; the projection cannot currently say it at all, because the only evidence it reads is the
one thing replay deliberately does not produce. *(D218's shape one level in: a projection is only as
complete as the channel it folds.)*

**(2) Every live elapsed on the dashboard is frozen at page load.** `useBootstrap` fetches once
(`useEffect` keyed on `client`), and `boot.serverClock.now` is the ONLY instant the queue row's
in-flight timer, the gate-age pill, the session card and the worker card compute against. Proved by
double reading: the parked run showed **`0s`** for over two minutes (the tab had loaded at 15:03:32,
BEFORE the run started at 15:12:17, so the difference is negative and clamps), and a plain reload at
15:15:15 made the same row jump to **`2m 54s`** — exactly `bootstrapInstant − startedAt`, and still
frozen from there. A terminal row is unaffected (`endedAt − startedAt` is two served instants, D124),
so this is invisible to every settled run and wrong on every run you are actually watching.

**(3) The `wf <hash>` shape-hazard chip is structurally always on.** `RunProvenanceBar` computes
`shapeMoved = surface.descriptorHash !== currentDescriptorHash`, where `surface.descriptorHash` is
the RUN's one-workflow `contractFingerprint` (`run-queue-projection.ts:1305`, `queued.contractFingerprint`)
and `currentDescriptorHash` is the bootstrap's `descriptorSetHash` — the hash of the whole eight-workflow
SET. Two different kinds of value, never equal. So a run enqueued sixty seconds ago under the current
descriptor renders the amber hazard *"Ran under Separation shape 59830cf6; runs are served by 76a28eef
now. The run's SHAPE moved, so these are not comparable — a retry would replay retired code."* — and
it did, on all three runs of this pass, whose fingerprint `59830cf6…` is byte-identical to the one the
explorer serves for `separations` and the build manifest holds. This is D179's `staleApp` defect
inverted: a warning that could never fire is bad, and a warning that can never NOT fire is worse,
because it trains the eye past the one chip that would announce a genuinely retired shape.

**(4) The open run-detail panel does not follow its run.** `useRunDetail` refetches only when `runId`
or `detailNonce` changes, and `detailNonce` is bumped ONLY by a dispatched command or an applied Data
edit — never by the SSE day stream. So after the gate approval bumped it, the panel froze on the wire
as of that instant and stayed there while the run resumed, ran three more nodes and terminalized:
with the queue row beside it reading **Done · took 8m 20s** and the BFF serving `status: "done"`, the
panel's header still read **`Queued` / "run is queued"** and its tablist still offered only `Logs`.
Because `receipt` enters `availableSections` only at terminal, **the evidence receipt is unreachable
from a panel you had open** — the surface whose whole job is to explain a run does not notice the run
finishing. A reload fixes it; per the e2e rule, a workaround is a finding.

#### 4. The connection gap the pass could not close: Separation has no start door — **CLOSED by D261 (§9.24)**

> **RESOLVED 2026-08-20.** After D260 recorded why one typed box cannot carry two varying values,
> the operator ruled *"document number should work; no need action id"* — so the workflow now
> resolves its own action id (`resolve-action`, the ported Action-List lookup) and the modal takes
> ONE box. Live-proved in §9.24: typing `4502` planned, started, resolved
> `6a766ae6f0549046f7f0dc06` and parked at the identity gate with zero write rows.

The dispatch's step 2 — *plan doc 4502 through the run modal* — cannot be performed, and the modal
says so honestly: `Separation` sits under **7 not startable** with *"This workflow declares no
typed-input surface, so this dialog has no box for it."* That is the descriptor's own ratified
decision (`surfaces: {}`, with its reason written in place: the paste-a-line parser splits ONE token
per item and this ingress is three correlated values, so a parser would have to invent the two it did
not receive). `person-lookup` is therefore the ONLY workflow with a UI start door, and every
separations run in this pass was started either through the raw start-plan/command pair or through a
finished row's `Run again`. **This is recorded as a gap in the operator story, not as a defect**: the
flagship workflow of Phase 3 cannot be started from the dashboard at all, and `Run again` only works
once some other path has produced a first run. The owner is ref frontend-backend-integration / the run-start surface, and the
question it owes an answer to is what a three-field structured ingress looks like in this dialog.

#### 5. Two operational findings — both burned profiles, both cleared by deletion

**(a) UCPath, run 1.** The very first run died in 36 s with D243's new refusal, verbatim on the queue
row: *"Duo REFUSED the WebAuthn assertion and rendered its terminal 'canceled or timed out' screen …
it is a Duo Autopilot signCount regression … Check the extension's stored signCount before touching
`timeouts.duoApprovalSeconds` or `timeouts.sessionAcquireMs`"*. That message is §9.21's fix doing
exactly its job — **9.5 s of naming the cause instead of 60 s of burning a bound** — and the state it
named is §9.21 §4's sticky burn: D243 prevents the FIRST refusal, and a profile burned before the fix
stays burned. Deleting `.auth/hrauto-rebuild/separations-worker-1/ucpath-prod-9e62a0611bb3` cleared
it, and the cold profile logged in on the next run.

**(b) New Kronos, run 2.** The next run died at the next system with §9.20 item 7's message word for
word — *"the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock sign-on host
shares the mykronos.com domain and is refused here"* — on a profile one day old. Deleting
`new-kronos-prod-9e62a0611bb3` cleared it too. So the answer to §9.21's *"CRM, Kuali, New Kronos and
ServiceNow were not re-tested"* is now partly in: **New Kronos wedges the same way, and presents as a
landing-verification refusal rather than a Duo one**, because its Duo ceremony fails upstream of the
WFD landing. Kuali was never affected in this pass and logged in on every run. Both remediations are
still operator-level directory deletions.

#### 6. The archive could not be reached — and the reason is one 2026-08-14 run — **UNBLOCKED by D258**

> **RESOLVED 2026-08-20.** The timeline event id now carries its occurrence ordinal at its seed
> (read-forward: a first occurrence appends nothing, so every stored and frozen id is
> byte-identical). Re-folded from the real 32 span lines, run `00419600` serves 14 events with 14
> distinct ids and both `Timecard Search` executions measured separately — its detail answers 200
> and the version bump can apply. The per-archived-run storage delta stays OWED and is measured at
> the first real archive.

`Archive` renders (read-only badge, both views, filters, retention) with the honest empty state *"A
run reaches the archive only when its workflow's version bumps."* `Versions & bumps` renders the
registry with D242's short codes (`pl` `kt` `sk` `sd` `si` `st` `sf` `sp`), each workflow's version,
archivable and not-terminal counts, and the standing refusal banner for `kuali-timekeeper-annotation`'s
two non-terminal runs. A **minor** bump scoped to `separations` alone was authored through the dialog
(kind, *What moved*, *Why*, commit — all required except the commit) and planned: plan `ee462c79`,
**19 would be archived · 0 would block**, stored in `version_plans`.

**`Apply the bump` was REFUSED, and the surface said so correctly** — *"Nothing was archived. Every
prior-version run is still exactly where it was"*, with the plan left `planned` (D179's own rule for a
refused apply, working). Reproduced directly against the endpoint, the server's answer is:

> `POST /api/v1/commands` → `{"state":"error","code":"SCHEMA_INVALID",`
> `"message":"✖ timeline note ids must be unique\n  → at timeline.events","retryable":false}`

**Root cause, found by scanning all 19 candidates.** Exactly ONE — run
`00419600-ef68-4e7d-8528-4705ad462bf5` / `sp-080639-0041`, enqueued 2026-08-14T15:06:55Z — carries a
duplicate `noteId` in its projected timeline, and `GET /api/v1/runs/00419600…` answers **HTTP 400**
with the same message: its detail panel cannot be opened at all. The spans on disk say why:
`.tracker-rebuild/spans/separations-2026-08-14.jsonl` holds **two** `span.started` and **two**
`span.ended` at the identical `(attempt 1, spanPath sp-080639-0041/timecard-search#1)` — a **pre-D214**
gate resume re-executing the `always-rerun` `timecard-search` node, both executions emitting the same
span path. D214 gave the CHECKPOINT key its `claimGeneration`; the SPAN path never got the same
treatment, and D123's `(runId, attempt, spanPath)` note identity therefore derives one id for two
events on every run written before D214 landed. Those rows are durable history and cannot be rewritten.

**Two consequences, and the second is the expensive one.** A pre-D214 run is permanently unreadable on
the run-detail surface. And because a bump is ONE atomic act over every prior-version run, and the
archive freezes the record through that same projection, **a single unreadable run blocks the archive
for the entire workflow, forever** — there is no per-run skip, and skipping would be wrong anyway
(D179's whole claim is that the archive holds the bytes the operator last saw). The fix owed is a
read-forward note identity, in the shape D214 already used: an absent generation appends nothing, so
every readable row keeps its id.

**What this costs the exit criteria.** §3.2's per-archived-run storage delta is **NOT MEASURED and not
measurable today**: `archived_runs` is still **0**, `version_bump_applications` **0**, and the
database is byte-identical across the attempt (3 530 752 bytes / 862 pages before and after, WAL
checkpointed both times). B5's five frozen tabs, `Export` on an archived detail, and the D242 short
code ON AN ARCHIVED ROW are unverified for the same reason — though the short code itself is verified
twice over on the surfaces that do render (the bump registry and the activity table).

#### 7. Activity, Explorer, and the D252 rail

**Activity report — verified.** Aug 1–20: **50 runs**, 12 finished (6 read back · 3 with warnings · 3
unread), 0 still open, error rate 70% (35 of 50). By-workflow grouped by category with D242 codes;
`sp Separation 22` pairs exactly with
`SELECT COUNT(*) FROM tasks WHERE workflow='separations' AND created_at>='2026-08-01'` = **22**, and
the by-day table's `2026-08-20 · 3 · 6%` is this pass's three runs. **D236's ledger block renders**
beside the totals with the honest empty state — *"No ledger entries. Nothing in this report's reach
filed anything into a real HR system"* — and `ledger_projections` / `ledger_partitions` are both **0**,
so the empty state is a fact rather than a placeholder. `Export` serves the CSV with its rules INSIDE
it (D239): the window, the terminal-only error-rate rule, the still-open exclusion, the archived-once
rule, the unread-vs-read-back rule, the Who-sampling rule, and the write-ledger's second-authority
paragraph, all before the first total.

**Explorer — verified through two independent readings.** The surface renders `Separation` with its
six proving harnesses each labelled *"a proving harness of Separation"*, and the parity corpus's own
diff (item 8) names the rest against the frozen 2j references: `Operations` → **`Test equipment`**
(D241), the field-census table's `Contract · System · Declared` → **`Field · System · Recorded`**
(D227/D229), node counts moving from `4 reads` to `30 reads` and `2 writes` to `4 writes` as the
census counts fields rather than contracts, and the `when` prose moving from *"the descriptor's own
when() predicate holds"* to **"the run's input field `includeCrmDates` is true"** (D228).

**D252's rail rows — NOT VERIFIABLE on this workflow, and that is a descriptor fact.** The context
rail's step / direction / freshness rows are drawn per data-ledger ENTRY, and entries come from
`descriptor.capabilities.editData.fields` (`run-detail.ts` `contextData`). `separations` declares no
`capabilities` block at all — deliberately, as a safety property written into the descriptor — so the
rail correctly answers `editing: locked · "this workflow declares no correctable fields"` with
`entries: []`. **`person-lookup` is the only descriptor in the tree that declares `editData`**, so
D252 is exercisable only there, and this pass did not run it. Recorded as unverified with its reason
rather than claimed.

#### 8. The parity corpus, classified — the operator's input for one deliberate re-freeze

`npm run test:parity` in ASSERT mode: **139 failed, 12 passed (4.3 m)**. Nothing was re-frozen and no
reference file was touched. The twelve passes are the dual-adapter structural specs, which read the
a11y tree without storing it.

**One thing has to be said before the counts.** `captureParityPair` asserts the a11y snapshot FIRST
and throws before `toHaveScreenshot` runs — by design, and the design is right (*"no pixel comparison
result should stand in for a semantic one"*). The consequence for THIS review is that **the pixel half
of all 139 failures is UNMEASURED**: `test-results/` holds zero `-actual.png` and zero `-diff.png`.
So the dispatch's class (a) *"pixels/a11y same"* cannot be answered from this run for any reference;
what CAN be answered is metadata-only versus semantic drift, which is the same question one layer in.

| Class | Count | What it is |
|---|---|---|
| **(a) metadata-only** — the `# descriptorHash` header line and nothing else | **6** | the five phone-capture references (`capture-empty` `capture-failed` `capture-photos` `capture-reorder` `capture-sent`, all `paper-ink phone-390x844`) and `run-parked-write--graphite-warm--1440x900--resolve-absent` |
| **(b) CONTENT drift** — the a11y tree itself moved | **129** | listed by cause below |
| **(c) NO STORED REFERENCE** — a state the corpus has never photographed | **4** | `run-open-gate…gate-choose`, `…gate-reject`, `…gate-refused`, `run-member-gate…gate-type-eid` — **D226's three identity-approval ceremonies and the refusal arm**, exactly the surface this pass drove live |

Every one of the 139 also carries the `# descriptorHash` line moving `964e299f…` → `c3c7b2c5…`, because
the whole descriptor set moved; that alone is why the six in class (a) fail.

**Class (b), by cause — one line each, with the decision that caused it:**

| Refs | Reference → actual | Decision |
|---|---|---|
| 66 | `9:20 AM pl-094040-0040 …` → `9:20 AM **#40** pl-094040-0040 …` (the run-ordinal chip enters every queue row's text) | **D230/D231** (B4a queue-row wire), rendered by **B4b** |
| 30 | `Sessions 1 running 1 waiting 1 idle 1 paused 1 failed 2 workers need attention` → `1 running 1 starting 2 idle 1 failed 1 worker need attention` | **D248** — the worker card IS the lease, so `waiting`/`paused` are gone and `starting` is real |
| 12 | Explorer `text: Operations` → `text: Test equipment` | **D241** |
| 12 | Explorer census `row/columnheader "Contract · System · Declared"` → `"Field · System · Recorded"` | **D227/D229** |
| 12 | Archive rows `EID 10873698 · Person Lookup v1` → `EID 10873698 · pl v1` | **D242** |
| 6 | Archive detail header gains `· code pl` | **D242** |
| 6 | Archive detail `tablist "Archived run detail"` → `button "Export"` ahead of it | **B5 / D223** |
| 6 | Explorer `Person Lookup v1 4 nodes · 4 reads` → `· 30 reads`; `Kuali Timekeeper Annotation … 2 writes` → `4 writes` | **D227** (the census counts FIELDS, not contracts) |
| 6 | `runs when the descriptor's own when() predicate holds` → `runs when the run's input field includeCrmDates is true` | **D228** |
| 6 | Activity: `button "Export"` enters ahead of the totals, and the *"2 counted in neither the error rate nor the outcome totals"* line is GONE | **D239 / D240** |
| 6 | Start-run modal: the bare `Entries — separated by ";"` textbox is now preceded by the descriptor's prose and `Examples · One EID · An EID and a name`, and `How this run is shaped` moves | **D250/D251** (B3) |
| 2 | queue-day loses `Storage has no restore point …` and `button "Storage health"` | **D222** — the banner became a `storage-degraded` notification |
| 1 | parked-write `alert: This build cannot record a present write` → `textbox "Empl id (required)"`, `must match ^10\d{6}$`, `Effective date (required)` | **D245/D246** |

Every row above is a decision this wave ratified, and every one is the surface doing what its decision
says. **Nothing in class (b) looks like an unintended regression** — which is the finding, not a
formality: the three defects §9.22 item 3 records (frozen elapsed, the always-on shape hazard, the
stale detail panel) do NOT appear here, because the corpus photographs fixture states rather than a
live clock, a live descriptor set, or a run that finishes while you watch. **The parity lane cannot
see any of the four defects this pass found**, and that is the honest reason a connection proof exists
beside it.

The recommended act after the operator reviews the table above is ONE deliberate
`npm run test:parity:update`, which re-freezes all 139 and MINTS the four class (c) references —
after which the gate ceremonies D226 built are photographed for the first time.

#### What is honestly NOT RUN

- **Every real write**, unchanged from §9.17/§9.20. The composed graph has still never entered a
  transaction node's commit arm.
- **The gate REJECTION arm.** `Reject — this is not the right person` was rendered and never clicked;
  `identity-approval-rejected` has still never been taken live.
- **The `would-prepare` preview arm**, unchanged: only `already-present` has ever settled live.
- **The archive**, for item 6's reason — five frozen tabs, `Export` on an archived detail, the
  archived row's short code, the archive-invariants property against a real row, and §3.2's per-run
  storage delta are all unmeasured.
- **D252's rail rows**, for item 7's reason: no separations run can produce a ledger entry.
- **The pixel half of the parity corpus**, for item 8's reason.
- **`person-lookup` end to end.** Only its start-modal surface was exercised; no live person-lookup
  run was made.


---

### 9.23 The start door, asked and answered — why the composed workflow has no typed box, 2026-08-20

§9.22 item 2 recorded the run modal listing **Separation** under *7 not startable* with the sentence
*"This workflow declares no typed-input surface, so this dialog has no box for it."* — and marked it
**MET as declared**, because the descriptor's `surfaces: {}` says exactly that with its reason. The
operator then ruled: **build it.** This pass is that build attempted, and the finding is that it
cannot be built where it was asked for. **Nothing was written, nothing was run live, and no code
changed** — the ruling is **D260** (ref workflow-model §1.1), and this section is its evidence.

#### 1. What a separations run actually ingests

`SeparationsInput` (`src/workflows/separations/descriptor.ts`) requires three fields, plus a
defaulted `searchTimeoutMs` and an optional `reRead`:

| Field | Example (doc 4502, §9.22's subject) | Varies per run |
|---|---|---|
| `actionId` | `6a766ae6f0549046f7f0dc06` | **yes** |
| `documentNumber` | `4502` | **yes** |
| `timekeeperName` | `Julian Zaw` | no, per operator |

#### 2. Why a typed box cannot carry it

`InputParserSpec` splits operator text into entries and each entry emits **one** field —
`EntryRule.emit` is a single `InputFieldName`, and `parseInputRunText` composes
`[{ field: rule.emit, value: <the entry text> }, ...constants]`. `constants[]` contributes the SAME
value to every entry of every run, so a per-run value placed there would be a constant baked into a
bundle-safe descriptor, which is the fabricated constant this program bans. **One varying value per
run is the ceiling**, and separations needs two.

Three exits were checked and each is closed for a stated reason, not for want of effort:

- **Drop `documentNumber` and let the page supply it.** Refused: the number is the run's own CLAIM,
  proved against the document's level-1 heading before anything else runs, and it is the check that
  catches a stale action id (2026-08-04 — *an `actionId` names a workflow STEP, not a document*;
  doc 4453's captured id silently landed on the Action List with no form). Dropping it removes a
  safety check to gain a text box.
- **Derive `actionId` from `documentNumber` at plan time.** Refused: Kuali's only address is
  `…/actions/<actionId>`, and the reverse lookup is the Action List, whose whole `actionList.*`
  selector family `src/stores/kuali/CLAUDE.md` records as deliberately **NOT ported**. Even if it
  were ported it would be a BROWSER act, and `services/start/plan.ts` performs exactly ONE ingress
  parse per raw submission (`planning.parseInput(rawInput)`) with no I/O, no per-workflow enrichment
  seam and no resolution step — an ingress that could resolve a value it was not given is the second,
  unaudited ingress path `src/domain/workflow/ingress.ts` refuses by name.
- **Move `timekeeperName` to config.** Not proposed, and it would not help: §9.16's decision 6a-2
  ratified it as INGRESS with `config.operator.timekeeperName` deliberately unused, and reversing it
  reaches **two** varying values rather than one. **This is not one decision away.**

#### 3. What would end the deferral — two shapes, with their costs

Named so the operator can rule rather than re-derive:

1. **A third `surfaces` arm: a typed FORM.** The multi-field vocabulary already exists and is already
   interpreted server-side — `UploadFieldSpec` (`text`/`boolean`/`select`) with `resolveUploadFields`
   — and the arm is `uploadRun` minus its mandatory `accepts[]`. Ref workflow-model §1.1 already permits exactly
   this ("a genuinely new run-surface behavior extends that union and both exhaustive interpreters").
   **The honest cost: no client renderer for `UploadFieldSpec` exists.** `uploadRun` is declared by no
   registered workflow and `src/dashboard/surfaces/run-start.tsx` renders it nowhere, so this surface
   would be that vocabulary's first live consumer, and the parity corpus gains a panel.
2. **Make `actionId` a graph output.** A head node resolving the action from the document number
   through Kuali's Action List: a live selector port of the family the Kuali store left behind, a new
   contract, a new driver capability, a graph change — and it still leaves `timekeeperName` typed, so
   it does not on its own reach one value either.

Shape 1 is the cheaper and the more honest of the two: it changes no graph, ports no selector, and
leaves every value the operator controls under the operator's hand.

#### 4. An operational finding for every worktree boot, recorded because it is not obvious

`defaultRuntimePaths()` resolves `stateRoot: resolve(".tracker-rebuild")` — `node:path`'s `resolve`
against **`process.cwd()`**. So a BFF or worker booted from a git worktree writes its authority to
`<worktree>/.tracker-rebuild`, **a fresh empty database**, not the checkout's. The same is true of
`.auth` (the browser profile root) and `duo-autopilot`. Three consequences worth knowing before a
worktree live pass:

- §9.17 / §9.20 / §9.22's `write_intents` **2** · `write_attempts` **3** · `durable_outbox` **2**
  baseline is **absent** there; the honest assertion against a worktree boot is that all three are
  **0**, and a *"no new write rows"* claim must name which authority it was made against.
- Every checkpoint replays as absent, so every run re-reads live — including the reads §9.22's runs 2
  and 3 replayed.
- The Duo profile is COLD, which since **D243/D244** is the SAFE state (a cold import stamps the
  shared WebAuthn counter to wall-clock `now`), at the cost of a full SSO ceremony per system.

#### 5. What is honestly NOT RUN

- **No live pass at all.** No BFF, no vite, no worker, no browser, no run. Ports 3938 and 5174 were
  observed free and deliberately left free — with no surface built there is nothing new to prove, and
  §9.22 exercised the modal's separations row against this same tree the same day.
- **No code changed.** In particular the descriptor is untouched on purpose: its `surfaces: {}`
  comment already carries this reason, and `contractFingerprint` hashes file CONTENT, so a
  comment-only edit would stop every stored `separations` checkpoint replaying (§9.22 measured that
  exact effect) in exchange for no behavior.

> **SUPERSEDED THE SAME DAY by §9.24 / D261.** The operator answered §9.23 item 3's question by
> choosing **shape 2** — *"document number should work. no need action id."* — and the build landed
> live. This section is kept VERBATIM because it is the analysis that produced the choice, and an
> analysis rewritten after its answer stops being evidence. Its rule (one varying value per run) is
> unchanged and still normative; what moved is the schema the rule is applied to. The two §9.22 rows
> above recording `Separation` under *7 not startable* are likewise a true record of that pass and a
> stale statement about the tree: as of 2026-08-20 that count is **6**.

---

### 9.24 The start door, BUILT — one typed document number, live end to end, 2026-08-20

§9.23 recorded the door as unbuildable where it was asked for and named two shapes with their costs.
The operator ruled, verbatim: **"document number should work. no need action id."** That is §9.23's
shape 2 — *make `actionId` a graph output* — and this section is that build, live-proved the same day.
The decision is **D261** (ref workflow-model §1.1). §9.23 and D260 are NOT withdrawn: their rule is unchanged and
this is the choice they handed the operator, exercised.

#### 1. The selectors, ported and live-verified

Three of legacy's five `actionList.*` keys move candidate→ported, from
`hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`, `src/systems/kuali/selectors.ts`
(blob `1c55c7d307891e07951ca38a89548418bdc23f49`):

| Legacy key | Line | Canonical id | Live 2026-08-20 |
|---|---|---|---|
| `actionList.searchInput()` | :67 | `kuali.action-list.search-input` | **1 node** |
| `actionList.searchGoButton()` | :79 | `kuali.action-list.search-go-button` | **1 node** |
| `actionList.docLink()` | :33 | `kuali.action-list.document-link` | **2 nodes** (see below) |

Two narrowings, both recorded on the port row rather than left silent:

- **The search box drops legacy's CSS scope.** Legacy scopes to
  `.kp-input-group:has(.kp-input-button-right)` because a second textbox named `Search` existed when
  it was written (2026-06-17). This registry has no CSS arm, and the live page renders **exactly one**
  `textbox "Search"` — today's global nav control is `Search apps`, a different accessible name. The
  port keeps role+name and lets `exactlyOne` refuse any other count. That is a deliberate
  correctness-over-availability trade: if a second box ever renders, this refuses by name instead of
  silently typing into one of two.
- **The document link is READ, not clicked.** Legacy clicks it and reads the resulting URL. The
  `href` carries the same fact one navigation cheaper and strictly read-only. The ANCHORED
  accessible-name match (`^\s*<n>\s*$`) is ported verbatim and is the safety half — legacy's own
  comment records that Kuali's Action-List search is SUBSTRING-based, so a search for `414` returns
  4140–4149.

Two keys stay CANDIDATE, with reasons: `actionList.menuItem()` is superseded by the list's own route
(a direct `goto` to `…/actions` rendered its search box in **1 100 ms**, so the menu click and its
"the menu had not painted yet" failure class are gone), and `actionList.docLinks()` enumerates every
pending document — candidate discovery no workflow here performs. It IS read, driver-internally and
unpublished, for one purpose: a miss says *"4502 is not here — 4537, 4495 are"*.

**What the live pass measured**, read-only through the production factory + Duo Autopilot on space
`5e47518b90adda9474c14adb`: direct route rendered in 1 100 ms; unfiltered list held 3 documents
publishing **6** bare-number links; filtering to `4502` left **2** links, both carrying
`/build/space/5e47518b90adda9474c14adb/actions/6a766ae6f0549046f7f0dc06` — the action id §9.18/§9.22
had recorded by hand.

**Two links for one document is the ORDINARY row.** Kuali publishes the number in both `Document #`
and `Document Title`, which legacy's own `docLink` comment records. That is why the surface's
verification scenario claims `recipe-resolves` and deliberately NOT `exactly-one-visible`: a claim of
one node would be false of every real row. The invariant this surface actually holds is one distinct
ACTION.

#### 2. The refusal arms

The driver states what the list showed and classifies nothing (D201); `classifyKualiActionResolution`
is a pure fold, and four negatives are distinct durable codes because each means something different
to whoever reads the run:

| Code | When | Why not an empty answer |
|---|---|---|
| `document-not-in-action-list` | zero matched links | A completed Kuali step LEAVES the list, so this is a real and common state. The refusal names the numbers the list did show, because "not found" alone is a sentence nobody can act on |
| `ambiguous-action-list-match` | two or more DISTINCT action ids | A run cannot choose which workflow step it is filing against, and choosing for it is how the wrong thing gets written |
| `unreadable-action-link` | a matched link with no `href`, or an href not addressing this space's `…/actions/<24 hex>` | The id is only on the page as a link target. A looser parse — "the last path segment" — would read an id out of a pagination or profile link |
| `unexpected-page-state` | the driver answered about a different document than asked | — |

There is no arm that answers with an id the page did not show. `parseKualiActionHref` requires the
whole path including the space, accepts Kuali's `…/view` redirect, and returns `undefined` rather
than throwing so the CALLER decides.

#### 3. The graph, and what did not move

`resolve-action` is a new head node; `document` now depends on it and binds the resolved id, and
`finalize-kuali` adds it to `dependsOn` and binds the resolved id in both its `prepare` and its
`commit`. **Nothing else in the graph moved** — no edge, gate, permanent key or `when` changed.

**The identity gate is unaffected and still dominates both sinks.** `comparison` depends on
`document`, which now depends on `resolve-action`, so the new node is inside the gate's own ANCESTRY;
`finalize-kuali` reading it is therefore a read of a node the operator's approval already covered,
which is exactly the rule D202's walk applies.

`replay: "checkpoint"`, for `document`'s reason one node earlier: the node's product is a VALUE, so
restoring it into a fresh browser leaves nothing broken. The id CAN go stale across a gate park — an
`actionId` names a workflow STEP — and that is precisely the case `openDocument` refuses loudly on,
by proving the document number off the page's own heading. A freshness bound would replace a precise
refusal with a timer, and §5A already ruled that out for this graph.

**The standalone chunk harnesses are untouched.** `separations-kuali-read`,
`separations-kuali-finalization` and the rest keep their explicit `actionId` inputs: each is a
scaffold that proves one piece, and adding a resolve to each would be re-proving the composition's
node five times.

#### 4. The ingress

`SeparationsInput` is now `{documentNumber, timekeeperName, searchTimeoutMs?, reRead?}` — ONE varying
value. `surfaces.inputRun` is declared with a `document-number` entry pattern (added to
`ENTRY_PATTERNS` beside its operator prose, key sets pinned equal by `ingress-parser-prose.test.ts`),
ONE rule and **no `otherwise` arm**, and `timekeeperName` as the single constant. D250 examples are
`4502` and `4502; 4510`, both real numbers this migration has read live.

**THE FINGERPRINT MOVED: `2c9cb58e…` → `c9a7c426…`.** Every stored `separations` checkpoint stops
replaying across this contract change. That is the honest cost, not a defect — the run's identity
genuinely moved, because its input schema is a different shape — and §9.22 measured the mechanics of
exactly this. Nothing durable is lost: a checkpoint miss means the next run re-reads live.

#### 5. The live proof — one typed number to a parked gate

**Against this worktree's OWN authority**, per §9.23 item 4: a BFF and worker booted from
`.hr-rebuild-worktrees/door-resolve` write to `<worktree>/.tracker-rebuild`, a **fresh empty
database**, and the browser profile is COLD (which since D243/D244 is the SAFE state). Ports 3938 and
5174 were observed free before boot and silent after teardown. The served descriptor fingerprint was
compared against the tree's before the run — `c9a7c4266fbe4fd260183d548ccc634e574cbd39ee662e28284c35e43c8362d9`,
identical — which is §9.16 §5's standing habit.

Typed into the run modal: **`4502`**, and nothing else. The modal rendered the surface as declared —
`Examples · One document · Two documents`, the field labelled *"Kuali document numbers — separated by
";" or a new line"*, the derived prose *"A Kuali document number is three to eight digits, the number
printed at the top of the separation request; an entry matching none of these refuses the whole box,
and nothing is started."*, and **`How this run is shaped` showing `timekeeperName` → `Julian Zaw`
fixed by this workflow's input surface**. **Separation had moved out of the modal's `not startable`
list**, which §9.22 item 2 recorded it in (7 → 6).

| Fact | Value |
|---|---|
| run / trace | `1e0b7cc2-173a-438b-954a-2f118175f8fa` / **`sp-105225-1e0b`** |
| plan | `537ab15e-96fc-4ab3-9833-508533a887a3`, 1 run, `dryRun: true` |
| match key / item | `separations:4502` / `c9837287-f3c5-5697-89f4-73e727fbfe04` |
| row title at plan time | `Separation 4502` · **`Filed by Julian Zaw`** (the D261 subtitle) |
| `resolve-action` | started 17:52:58.992Z, done 17:53:24.789Z — **25 797 ms**, including the cold Kuali SSO + Duo ceremony |
| resolved | `actionId` **`6a766ae6f0549046f7f0dc06`**, `actionHref` `/build/space/5e47518b90adda9474c14adb/actions/6a766ae6f0549046f7f0dc06`, `matchedLinkCount` **2** |
| gate | opened **17:54:34.316Z** — 1 m 52 s after start, status `awaiting-approval` |
| row title at the gate | **`Dreitho Cramia`** — the subject projection, from UCPath's Job Summary |
| checkpoints | **13** |
| `write_intents` / `write_attempts` / `durable_outbox` | **0 / 0 / 0** |

The run read Kuali (Action List **and** document), UCPath (Person Org and Job Summary) and New Kronos
(search and timecard) LIVE off one typed number. `GET /api/v1/runs/<id>` answered **200** with
`Kuali Action` as the timeline's first step and the gate `open`.

#### 6. What is honestly NOT RUN

- **The gate APPROVAL.** The packet derived and rendered (`approvalShape: "one-click"`, one candidate
  `10001754 / Dreitho Cramia`, `expectedVersion 51`) and was not clicked through. The ceremony is
  D226's and is unchanged by this seam — §9.20 live-proved it six times — and what D261 needed to
  prove is the resolve, which is proved to its durable checkpoint. The dry run would have stopped at
  `clear-pending` in any case, so **`finalize-kuali`'s binding of the RESOLVED action id is not
  exercised live by any dry run** and is the one thing this pass leaves for the controlled commit.
- **Every real write**, unchanged from §9.17/§9.20/§9.22.
- **The multi-entry door.** `4502; 4510` parses to two runs and is pinned by a unit arm through
  `planStart`; only the single-entry path was driven live.

#### 7. A finding this pass leaves open, recorded because nothing else will see it

**`auditKualiUiRegistry` and `auditKualiUiEvidenceBindings` have ZERO callers.** The ucpath, crm and
new-kronos registries are all wired into `tests/unit/architecture/semantic-ui-registry.test.ts`; the
Kuali pair is not, so the Kuali registry's own audits are dead code — machinery with no consumer
doing nothing, which is D222's shape at the guard layer. Both were run manually against this build
and the registry audit is **clean**; the evidence-binding audit reports **two pre-existing rows**,
`kuali.rrss-document.last-day-worked-field` and `…separation-date-field`, each carrying TWO
assertions in `separation-document.live.json` (chunk 6b added the `exactly-one-editable` write-path
verification beside the read's) against a rule demanding exactly one. That is a second seam — the
rule needs to admit a fact verified under two assertions before the audits can be wired — so it is
NAMED here rather than half-fixed. The Kuali registry is not unguarded in the meantime: the UI
catalog freshness guard covers its published content byte-for-byte, and
`legacy-selector-port-provenance` covers every ported key.

---

### 9.25 Observed logs — dashboard/composed live dry-run proof, 2026-08-25

**Status: MET for the observed-log proof only.** This is the already-collected real dashboard / composed
`separations` dry run for the Observed Logs node; it does not close the node's notes-emitter or
remaining fidelity work. The dashboard planned document **4502** as
`479f9f1e-83b3-4157-915b-2794bcf61ab0` and ran
`25d90c9d-72bf-4fa4-bcea-116665f22790` / trace **`sp-143516-25d9`** to the
`parked-gate` authority row at version **52**.

| Proof fact | Observed value |
|---|---|
| Combined Logs rows | **13 observed** rows, server sequences **0..12**; **0 notes** |
| Service-origin row | `.tracker-rebuild/spans/separations-2026-08-25.jsonl:12` for `workflow:separations/read-separation-plan` |
| Browser-origin rows | their declared systems are shown honestly as **KUALI**, **UCPATH** and **New Kronos** |
| Dry-run write evidence | `write_intents` / `write_attempts` / `durable_outbox` = **0 / 0 / 0** for this run |

The service row exposed a false invariant in the live API: it returned **500** by requiring every
exact origin to have a browser system. A service origin legitimately has none. Fix
`17468e60` removes that false requirement: the API then answered **200**, and the UI omitted the
system claim for that row rather than inventing one. That distinction is the point of the proof — a
browser system belongs only to an origin that declares it.

The screenshot at `.tracker-rebuild/artifacts/observed-logs-live-2026-08-25.png` is ignored as
evidence; the authority, JSONL and served rows above are the proof. The dashboard/worker processes
were stopped and browser sessions closed after collection.
### 9.26 The first T1b production invocation — correctly BLOCKED before start (2026-08-25)

D266 dismantled `kuali-timekeeper-annotation` into the Kuali finalization step's T1 pair rather than
keeping a second proof workflow. The production command
`npm run cli -- dry-run-scenario separations-kuali-finalization --subject finalization-canary`
exercised that pair's registry, manifest boundary and insert-only result authority from `master`.
It exited non-zero with the expected blocker because §9.19's approved canary is not available until
Pacific calendar day 2026-08-28; no browser runtime or workflow run was fabricated.

| Durable fact | Recorded value |
|---|---|
| result | `d0a75e7f-b021-4e9e-a288-a8e6266fe2b4` |
| scenario / workflow | `separations-kuali-finalization/dry-run` / `separations-kuali-finalization` |
| subject label | `finalization-canary` |
| verdict / execution | `blocked` / `not-started` |
| blocker | `subject-unavailable` |
| run / trace | `null` / `null` |
| manifest digest | `a93cf93fce5163af06f1fcabe3ed72d061e5739493afd2284bc7b1b7771d8ac7` |
| wall time | 3 ms |

This row proves the fail-loud pre-browser behavior and the durable blocked arm. It does **not** tick
the live T1b proof: that requires a second result with verdict `met` against the real canary on or
after 2026-08-28, after the runner starts, drains, takes the real gate command, drains again and
asserts authority, receipts and the zero-write dry-run fence.

### 9.27 The live parallel proof — two composed dry runs, two pool workers, one dashboard, 2026-08-26

The `{#parallel-runs}` PROOF line asked for two separations dry-run scenarios in parallel, recorded.
This pass is that proof, run END TO END through the dashboard: the pool planned and spawned from the
Session Panel (D271, the W4 controls' first live exercise), two runs started from ONE run-modal
submission (`4502; 4495` — the multi-entry door §9.24 item 6 left undriven), the identity gate
approved through the D226 ceremony, and every claim below paired with authority
(`sqlite3 .tracker-rebuild/state.db`, this worktree's own fresh database) or the served wire.
**Every run was `dryRun: true`; nothing was written anywhere**: `write_intents` / `write_attempts` /
`durable_outbox` finished **0 / 0 / 0** — an empty-from-birth database stayed empty — and
`run_checkpoints` holds **zero** rows for `clear-pending`, `file-termination`, `finalize-kuali` or
`receipt` across all five runs (17 checkpoint rows, all read-side nodes).

#### 1. The stack, the pool, and the subjects

Booted from `.hr-rebuild-worktrees/live-parallel` (HEAD `7b4c31d4`, W1–W5 merged): ports 3938/5174
observed free, zero orphan Chromiums, `build:manifest` clean, and `GET /api/v1/explorer` serving all
seven workflows with `separations` = **`14217f341c0b84ef…`**, byte-identical to the tree manifest —
§9.16 §5's standing fresh-singleton habit. The pool: `plan-worker-count` (`efc96ec6…`, desiredWorkers
**2** against pool version 0 → **pool v1**, 19:04:35Z) — dispatched over the wire with the Session
Panel's exact command shape, because the panel's pool bands fold ONLY from worker cards + pool rows
and a cold system has neither (finding 5c below) — then **both members spawned by clicking the
band's own `Spawn worker N` controls**: `separations-worker-1` (pid 43188) and `separations-worker-2`
(pid 43217), each proving birth through its own durable lease.

Subjects, per §9.18's operator-named practice set: **4502** (LDW past — the full-chain composed
subject, items `c9837287…`) and **4495** (LDW `09/02/2026`, future — the standing **S7 refusal**
subject until that date, item `829a6aac…`). These are the only two practice documents startable
today: 4537 is §9.19's T1 canary (date-gated to 2026-08-28, not used, not counted) and no other
past-dated document exists, so a "two full-chain previews concurrently" variant is not runnable
until a second past-dated subject appears — recorded honestly rather than simulated.

#### 2. The runs — one session, five attempts, verbatim

One modal submission planned both (`plan 64f21745…`, table `Separation 4502 / Separation 4495 ·
Filed by Julian Zaw`), confirmed as `Start dry run` (command `29bac199…`) → **session
`79476d81-85fe-4938-bd49-2266314f5dfd`**, which every attempt below inherits (D269 — retries mint no
session).

| Run | Trace | Doc | Attempt | Worker | Outcome |
|---|---|---|---|---|---|
| `c5d5481f` | `sp-121502-c5d5` | 4502 | 1 | worker-1 | `failed` — session acquire exceeded 60 s (findings 5a/5b) |
| `5026b1ed` | `sp-121502-5026` | 4495 | 1 | worker-2 | `failed` — **D267 waiter refusal, live**: *"another worker holds the Duo ceremony for this credential — worker separations-worker-1 (kuali), generation 1"*, refused BY NAME after its 21.4 s budget, before its envelope fired, not retried |
| `90e40c5c` | `sp-122538-90e4` | 4502 | 2 | worker-1 | `failed` — the same 60 s bound, this time with an honest wall (finding 5a root-caused between attempts) |
| `bcbff0d7` | `sp-123053-bcbf` | 4502 | 3 | worker-1 → worker-2 | **`done`** at the preview terminal, gate approved through the ceremony |
| `5dc10f1f` | `sp-123214-5dc1` | 4495 | 2 | worker-2 | `failed` at `plan` — **the genuine S7 terminal**: `SEPARATION_DATE_IN_FUTURE`, *"Kuali document 4495 carries a Last Day Worked of 09/02/2026, which is after 08/26/2026"* (failure `14acb716…`), after reading the Action List and the document LIVE |

Attempts 2/3 and 2 were started from the queue rows' own `Run again` ceremonies (D221 — 1→2→3 and
1→2, each the item's next unspent attempt).

#### 3. The OVERLAP, from authority

| Fact | Value |
|---|---|
| `bcbff0d7` claimed | **19:31:14.602Z** by `separations-worker-1` (span `run.claimed`) |
| `5dc10f1f` claimed | **19:32:18.305Z** by `separations-worker-2` |
| `5dc10f1f` terminal | **19:32:48.009Z** (`failed`, S7) |
| both simultaneously `running` | **19:32:18.305 → 19:32:48.009 — 29.7 s**, two distinct pool identities, two OS pids, one queue |
| ceremonies inside the window | worker-2's kuali ceremony (g5, 19:32:34→:40) slotted BETWEEN worker-1's ucpath (g4, 19:31:48→19:32:06) and new-kronos (g6, 19:32:42→:49) |

The §10 lease serialized EVERY ceremony across both workers — generations **g1…g8** on the one
credential row, strictly one `held` at a time, interleaved across workers with zero overlap and
**no counter burn**: the pre-fix ceremonies never signed (no key was present, finding 5a), and every
post-fix ceremony (g3–g8) cleared in **6–18 s** with zero waiter refusals. Attempt 1's pair
additionally overlapped `running` for 38 s (19:15:30→19:16:08) — recorded, but the MET window is the
one whose outcomes are genuine.

#### 4. The gate, the cross-worker resume, and the terminal

`bcbff0d7` parked at `identity-approval` at 19:33:01. The D226 dialog rendered the full ceremony
(disconfirming-first empty state, four agreements, one candidate `Dreitho Cramia / 10001754`, the D211
authorization block, `packet 51fc709dab0b… · ceremony one-click`, footer `rev 53`) and one click
wrote the durable approval: `checkpoint_payloads` key `bcbff0d7…:identity-approval` — `decision
approved`, `resolvedBy local-operator`, `resolvedAt 19:34:10.486Z`, `eid 10001754`, `evidenceDigest
51fc709dab0b…` **identical to the digest the dialog printed**, command `bad2b5c3…`, `expectedVersion
53`. The resume was then claimed at **19:34:18.025Z by `separations-worker-2`** — the OTHER pool
member, off replayed checkpoints, opening its own New Kronos and UCPath sessions (g7/g8) — which is
D214's park+resume exercised ACROSS pool members live for the first time. Terminal **`done`
19:35:11.071Z**: `run_results` bound to the preview schema **`86cd007a59d4ae67…`** (§9.17's exact
hash), receipt `b82276d6-c7ce-5e2d-ba3b-29a45c9be4a4` (`partial`, one load-bearing
`DRY_RUN_PREVIEW` warning: `clear-pending` settled `already-present` off its live probe at
19:35:11.066Z, `descriptorFingerprint` the run's own `14217f34…`).

#### 5. What this pass found, none of it fixed here

**(a) A worktree's Duo Autopilot extension loads WITHOUT its key, and the preflight cannot tell.**
`duo-autopilot/credentials/` is gitignored (machine-local), so a fresh worktree checks out the
extension source with no `credentials/duo-webauthn.json` — and `background.js` reads its signing key
from exactly that packaged path. `assertDuoAutopilotReady` proves `manifest.json` plus the CONFIG
credential (`.auth/duo-webauthn.json`, present via the shared profile root) — the wrong file — so
the login "hangs on an unanswerable prompt", the precise state that guard exists to refuse: every
cold ceremony sat unanswered until the 60 s `sessionAcquireMs` envelope fired (runs 1–3). Proved by
the fix: copying the key into the worktree extension dropped the kuali ceremony from >60 s to
**6 s** on the next attempt. The preflight should prove the PACKAGED credential the extension will
actually read. Also worth knowing: `timeouts.sessionAcquireMs` currently has NO override channel —
workers resolve settings as `{}`, no env binding exists, and `apply-settings` is a deferred family —
so 60 s is a hard bound everywhere.

**(b) macOS timer throttling starves idle spawned workers until a PEER's sweep kills them.** Worker
children spawned by the BFF get their timers coalesced when the machine idles: worker-1's 5 s
heartbeat landed ~every 32 s during an idle stretch, and its 60 s acquire timeout fired at **192 s**
of wall (run `c5d5481f`). Twice, an IDLE worker-2 (gen 1 pid 43217 at 19:10:06, gen 2 pid 43371 at
19:18:42) missed the 60 s stale bound entirely and worker-1's 30 s sweep stopped its lease
(`lease-expired`); its next tick then refused to heartbeat a settled lease and the process died loud
— correct fail-loud behavior on both sides, wrong cause. The D271 replacement control carried the
recovery each time (`Failed · lease expired — its process stopped reporting` → `Spawn worker 2`).
`caffeinate -disu` for the remainder of the pass suppressed it completely. The heartbeat/stale/sweep
triple (5 s / 60 s / 30 s) assumes honest timers; a sleepy operator laptop breaks that assumption.

**(c) Three dashboard facts.** (1) A COLD system's Session Panel offers no first `Plan workers`
control — pool bands fold only from worker cards + pool rows, so the first `plan-worker-count` on a
fresh database cannot be issued from the UI (it was sent over the wire with the panel's exact shape
here). (2) The start-result status list renders its two run rows under duplicate React key `run`
(one `console.error` per render tick while the modal stays open). (3) After `bcbff0d7` terminalized,
the open panel's Member-2 card still read `Running · sp-123053-bcbf` while authority's lease said
`idle` — the drawer's worker card does not follow the day stream (D257's shape on a sibling
surface).

#### 6. Closure

Both members stopped from the panel (leases settle `stopped/operator`; both pids observed gone), all
four worker process-lock records released, `playwright-cli close-all` → no orphan Chromium, BFF+vite
stopped, ports 3938/5174 silent. The dev-runner teardown was a process kill, so
`.tracker-rebuild/locks/server.lock.json` retains `releasedAt: null` under a dead pid — observed,
left in place per D181 (the lock layer validates PID + process birth, so a dead holder's record is
inert). `storage doctor` during the pass: authority healthy (schema v18), backup STALE — a fresh
throwaway worktree database with no real writes; no backup was taken.

#### 7. Addendum — the chain at base, proved dry on 4502 (2026-08-27)

Phase 3b's R1 opened by re-proving §9.27's chain on the ROOT checkout at `integration/03b`
**`36135120`**, so the 2026-08-28 canary starts from a measured base rather than a remembered one.
One `dryRun: true` run of the whole composition on document **4502** — start plan
`7693f19f-b5a6-486f-a2d2-631036db844e` → command `156c42ff-b411-46d8-b0f8-986d8a206adf`
(`applied`) → run **`fd415e49-54bb-4ccd-bec4-ad1cba94a4f6`**, trace **`sp-053429-fd41`**, item
`c9837287-f3c5-5697-89f4-73e727fbfe04` (§9.27's own 4502 item), one BFF on 3938 and ONE manually
launched pool member `separations-worker-1` (pid 63112, `--pool-index 1`). Queued 12:34:52.419Z,
claimed 12:35:18.731Z, parked at `identity-approval` 12:37:00.082Z, approved 12:39:19.826Z,
re-claimed by the same worker 12:39:30.285Z, **terminal `done` 12:40:18.473Z** — 299.7 s claim to
terminal, of which the gate held 139.7 s, so 160.0 s of machine work across Kuali, UCPath and New
Kronos with Duo Autopilot clearing every ceremony hands-off. The terminal is the **D215 preview
terminal**: `run_results` bound to the preview schema **`86cd007a59d4ae67…`** (§9.17's hash, the
same one §9.27 recorded), `kind: "dry-run-preview"`, `stoppedAtNodeId: "clear-pending"`,
`externalCommit: "none"`, outcome **`already-present` off a `live-probe`** — the `would-prepare` arm
was never reached because the real path settles this subject at its probe, which is exactly the
false-rehearsal D215 removed. Receipt `b7e7b603-6099-52d5-a065-27112c289a07` is `partial` with ONE
load-bearing `DRY_RUN_PREVIEW` warning and marks the four write-side obligations `unknown`, never
`verified`. The identity gate was taken through the REAL `POST /api/v1/commands` kernel path (command
`aee0b3f0-097c-445a-803a-6d52e1b80a53`, `expectedVersion` 52, one-click shape, the single candidate
`Dreitho Cramia / 10001754` with all four comparisons agreeing); the durable approval is
`checkpoint_payloads` key `fd415e49…:identity-approval` carrying `evidenceDigest
d846bb7b1697ae4c…` — the digest the served packet printed. This pass did NOT drive the dashboard
dialog; §9.27 already holds that proof, and this addendum proves the kernel half.

**The submit-free audit, node by node** (`hr-debug` §9). Spans are this run's own
`.tracker-rebuild/spans/separations-2026-08-27.jsonl`; `#N.M` is execution N of attempt 1 (D214 —
the park and resume are two executions of one attempt).

| # | node | shape · store | what it did | write intent | durable rows |
|---|---|---|---|---|---|
| 1 | `resolve-action` | task · kuali | `#1.1` `done` 30 212 ms — Action List filtered, document matched | none | 1 checkpoint |
| 2 | `document` | task · kuali | `#1.1` `done` 4 195 ms — RRSS document read | none | 1 checkpoint |
| 3 | `plan` | task · workflow (headless) | `#1.1` `done` 7 ms | none | 1 checkpoint |
| 4 | `termination-type` | task · workflow (headless) | `#1.1` `done` 2 ms | none | 1 checkpoint |
| 5 | `name-search` | task · ucpath | `#1.1` `done` 23 712 ms — Person Org search | none | 1 checkpoint |
| 6 | `subject` | task · workflow (headless) | `#1.1` `done` 2 ms | none | 1 checkpoint |
| 7 | `job-summary` | task · ucpath | `#1.1` `done` 3 044 ms — 1 active of 1 rows | none | 1 checkpoint |
| 8 | `employment` | task · workflow (headless) | `#1.1` `done` 3 ms | none | 1 checkpoint |
| 9 | `department-option` | task · workflow (headless) | `#1.1` `done` 3 ms | none | 1 checkpoint |
| 10 | `timecard-search` | task · new-kronos | `#1.1` `done` 32 204 ms; re-read live as `#2.1` on resume | none | 2 checkpoints (gen 1, gen 2) |
| 11 | `timecard` | task · new-kronos | `#1.1` `done` 7 916 ms | none | 1 checkpoint |
| 12 | `dates` | task · workflow (headless) | `#1.1` `done` 2 ms — Kronos moved nothing | none | 1 checkpoint |
| 13 | `comparison` | task · workflow (headless) | `#1.1` `done` 9 ms — packet built | none | 1 checkpoint |
| 14 | `identity-approval` | **gate** · operator | opened 12:37:00.082Z, resolved 12:39:19.826Z | none | 1 `checkpoint_payloads` row (the approval), 0 `run_checkpoints` |
| 15 | `approval` | task · workflow (headless) | `#2.1` `done` — approval verified after resume | none | 1 checkpoint |
| 16 | `clear-pending` | **transaction** · ucpath | ONE span, `clear-pending/probe`, `done` — `present`, `scannedRowCount 2`, source `ss-smart-hr-detail-read`; then `transaction.previewed` (`subject: not-observed`, `externalCommit: none`) and the run ended. **No `prepare` span, no fence, no `commit` span** | none | **0** |
| 17 | `file-termination` | **transaction** · ucpath | never entered — no span | none | **0** |
| 18 | `receipt` | task · workflow (headless) | never entered — no span | none | **0** |
| 19 | `finalize-kuali` | **transaction** · kuali | never entered — no span | none | **0** |

The run emitted **55 events and not one of them names a write**: `run.queued` 1, `run.claimed` 2,
`span.started` 16, `data.observed` 16, `span.ended` 17, `gate.opened` 1, `gate.resolved` 1,
`transaction.previewed` 1 — zero `write.*`, zero fence, zero commit, zero intent. Read from
authority after the terminal, over the WHOLE database: **`write_intents` 0 · `write_attempts` 0 ·
`durable_outbox` 0** — 0/0/0, and `artifact_outbox` 0 besides. `run_checkpoints` holds **15** rows,
every one a read-side node, and **zero** for `clear-pending`, `file-termination`, `receipt` or
`finalize-kuali`. The one non-zero outbox is `run_terminal_outbox` = 1, a `run-terminal-result`
projection row for this run's own terminal — an internal projection hand-off, not an external write.
This is the code's shape, not luck: `executeDryRun` reports the settlement the real path would reach
**without calling `settleAlreadyPresent`** — no checkpoint, no observed-present intent row, no run
transition (`src/core/write-sequencer.ts` §D215) — and the retired `dry-run-composition-submit-free`
guard's invariant lives on in `write-safety-contract` plus the row-level scenario (D188). Nothing
was written to UCPath, Kuali or Kronos, and document 4502's Kuali form was not saved.

**One pre-flight finding, recorded because R2 will hit it.** The root checkout's own
`.tracker-rebuild/state.db` **could not be opened at this tree**: it sat at `PRAGMA user_version`
16 with `authority_meta.schema_version` 16, yet already carried `dry_run_scenario_results` — a table
migration **18** creates — while `worker_pools` (migration **17**) was absent, so `#runMigrations`
replayed 17→18 and threw `table dry_run_scenario_results already exists`, unwinding
`composeDashboardRuntime`. That is a stale local database from a pre-merge branch, not a defect in
`36135120`; it was moved intact to `.tracker-rebuild/stale-schema16-2026-08-27/` (nothing deleted)
and the runtime built a fresh authority at **schema v18, generation 1, `quick_check ok`**, which is
also why the 0/0/0 above is an empty-from-birth read rather than a delta. Two consequences worth
carrying: the fresh database's `runs_view` rehydrated **50** historical rows from the on-disk span
JSONL while the write tables stayed empty, and `storage doctor` lists the 56 pre-v18 backup
manifests as `INVALID — backup-invalid: schemaVersion`, with the new generation-1 backup `ok`.
A second, unrelated occupant was cleared first: a BFF + vite pair from the deregistered worktree
`.hr-rebuild-worktrees/fidelity-standing` (no `.git`, absent from `git worktree list`) had held
3938/5174 since 2026-08-26 and was writing to that directory's own database; it served descriptor
fingerprints byte-identical to this tree, but it was not this checkout's runtime and was stopped.

**Closure.** Worker stopped, its process-lock record released cleanly
(`releasedAt 2026-08-27T12:42:44.892Z`, pid gone); BFF stopped and 3938 silent;
`playwright-cli close-all` → no orphan Chromium. As in §9.26/§9.27 the BFF's own
`.tracker-rebuild/locks/server.lock.json` retains `releasedAt: null` under a dead pid — observed,
left in place per D181. `npm run build:manifest` was clean before the run and `npm run roadmap:check`
reports `docs/roadmap/index.html is fresh`; the served `separations` fingerprint was
`14217f341c0b84ef…`, byte-identical to the tree manifest, for the whole pass.

**Addendum, 2026-08-27 — the hand-run above is now a REPLAYABLE T1b scenario, and it agreed.** The
proof this section records was driven by hand through the dashboard; it is now declared at
`tests/scenario/workflows/separations/dry-run.scenario.ts` and taken by
`npm run cli -- dry-run-scenario separations --subject separations-dry-run-subject` (the label is
`config/test-subjects.json`'s, doc **4502**). The first live take of that command, at
2026-08-27T13:46:39Z, came back **`met`** — `dry_run_scenario_results`
**`0cc71a31-4119-4588-b96b-0fd5e568abe6`**, run `91cf5356-5211-4d09-8d37-8ddf4c7bc901`, trace
`sp-064438-91cf`, 121 s — with all eight of `evaluateDryRunScenarioEvidence`'s assertions met:
the nineteen-node reach and the four excluded, the **fifteen** checkpoints at attempt 1 (both
`timecard-search` claim generations), the single `identity-approval`/`approved`/`local-operator`
gate, terminal `done` at the D215 preview terminal on `clear-pending` settling **`already-present`
off its live probe**, the twenty-row receipt vocabulary, and `write_intents` / `write_attempts` /
`durable_outbox` **0/0/0** read over the whole database. Two facts about the harness are worth
carrying rather than rediscovering. A worktree needs `duo-autopilot/credentials/` (gitignored) as
well as `.auth` and `.env`: without it a FRESH browser profile has no Duo credential to self-arm
from, the ceremony hangs, and the run dies at `resolve-action` on the 60 s
`timeouts.sessionAcquireMs` bound — which is what the first two takes here did
(`a558c3a8-…`, then `4e6e5be3-…`). And the manifest's `attempt: 1` is a **first-rehearsal** fact:
the item id derives from the document, so a second take against the same state root is attempt 2 and
`checkpoints` fails on the number alone. The take recorded above ran against a fresh
`.tracker-rebuild`.

### 9.28 §9.20 item 7 — CLOSED: the "empty identity cell" is a row read mid-render, and the driver now waits for the render to complete (2026-08-27)

**The open line.** §9.20 item 7 recorded, without diagnosing, that a cold WFD profile's FIRST
Employee Search once presented a result row whose identity cell was empty — the driver refused it by
name (`observed ""; refusing to read a row whose subject is unknown`) and the next search resolved
in 1.83 s. This pass reproduced the mechanism live, then the refusal itself, and fixed the read.

**The probe.** `scripts/u14-cold-probe.ts` (temporary, deleted with this pass): the REAL factory, the
REAL `new-kronos` login recipe and the REAL driver's `searchEmployee`, on a never-used profile
directory under `.auth/hrauto-rebuild/u14-cold-probe-a<N>/` (a random config fingerprint makes every
attempt cold; the eight directories were removed at the end, as were their released `live-smoke`
lock directories), instrumented from OUTSIDE the driver: a MutationObserver installed by init script
in every frame recording each `[role='menuitemradio']` row's creation, child insertions and
attribute / text changes with timestamps; a 50 ms node-side sampler of slat counts, labels and
counters per frame; every `*.mykronos.com` response. Subject: EID 10776990 (§9.20's own). Headless,
Duo cleared hands-off, read-only throughout.

| attempt | condition | cold first search | host → identity text | warm searches | hydrating arm |
|---|---|---|---|---|---|
| a1 | cold, idle | resolved 2.79 s | **33 ms** | 1 resolved, 12 ms | (not yet built) |
| a2 | cold, idle | resolved 3.42 s | **34 ms** | 1 resolved, 9 ms | (not yet built) |
| a3 | cold, idle, fix v1 (card presence) | resolved 2.96 s | **108 ms** | 1 resolved, 14 ms | — |
| a4 | cold, idle, fix v1 | resolved 2.93 s | 30 ms | 6 resolved, 11–18 ms | fired 0/7 |
| a5 | cold | login refused at `sso-form`: entry route landed on `chrome-error://chromewebdata/` — a navigation error refused by name, retried | — | — | — |
| a6 | cold, **8× CPU throttle** (CDP `Emulation.setCPUThrottlingRate`, post-login) | resolved 17.85 s | **214 ms** | 3 resolved, 91–104 ms | fired 0/4 |
| a7 | cold, **20× throttle**, fix v1 | navbar `Employee Search` click elapsed its 15 s bound (the throttled home paints slower than `CONTROL_TIMEOUT_MS`; refused by name) | — | 3 resolved (360–572 ms); **warm-5 REFUSED `observed ""`** — §9.20 item 7 reproduced verbatim | fired 0/4 |
| a8 | cold, 20× throttle, **final fix** | same 15 s navbar bound | — | **5/5 resolved**, 295–456 ms | **fired 2/5** (`{label:"",cardRendered:true}`) |

**Root cause — the row is rendered in STAGES, each an Angular digest apart, and the poll accepted
the first stage.** Every one of the 21 searches showed the same sequence in the panel's frame
(`angularIframeSlider`, inside `iframe[name^="portal-frame-"]`): (1) the `div.slat-container` host
lands — already `role="menuitemradio"` (WFD sets `role="button"` first and rewrites it in the same
batch), with the `Total [1]` / `Selected [0]` counters, and **no text**; (2) the inner `krn-slat`
skeleton renders (checkbox zone, data zone; the `krn-slat` gets `aria-label="Item Name <name> not
checked"` — a name, no EID); (3) the `krn-slats-tabular-data` card is transcluded into
`.slat-col__data`, its `span.card__label` / `span.card__info` text nodes still holding the RAW
bindings `{{::row.label ? row.label : row.name}}` and `{{context.data[slatIndex][row.name]}}`
(the MutationObserver's `characterData` `oldValue`); (4) a digest interpolates them into `Name` /
`Kou, Nathan` / `ID` / `10776990`. The driver's poll returned "results" the instant
`[role='menuitemradio']` counted above zero and read the row's text — `""` at stages 1–3. On an idle
machine the gap is 9–34 ms and a 200 ms poll rarely lands in it; on a loaded machine (2026-08-19's
cold profile 32 s into a Duo ceremony; 20× throttle here) it is hundreds of milliseconds and the poll
lands. **Cold is a widener, not the cause**: every cold first search had a wider gap than the warm
ones that followed it (33/34/108/30/214 ms against 9–18 ms), and the refusal reproduced on a WARM
search under load. A second finding on the way: the row-level `aria-label="Name <name> ID <eid>"`
§9.1 recorded on 2026-08-12 is a feature-toggle-gated binding
(`ng-attr-aria-label="{{isSwapA11yImprovementsEnabled && enableSlatA11y && getSlatLabel …}}"`) and
was ABSENT on every row today; the identity has been coming from the card's interpolated text (the
same `Name <name> ID <eid>` string) through the read's text arm. `role` is bound the same way
(`enableSlatA11y ? 'button' : … 'menuitemradio'`) — recorded, not acted on.

**The signal, and why the first cut was wrong.** Fix v1 waited for stage 3 — the card element's
presence — and a7-warm-5 refused `""` with that check in place: the card is inserted BEFORE its
bindings are interpolated. The completion signal is therefore the CONTENT: a row has completed its
render when its card is in AND its text is non-empty and carries no raw `{{` binding
(`slatRenderComplete`, `src/stores/new-kronos/driver/search-render.ts`). This is a bounded wait for
a named fact, not a longer timeout: the poll keeps its caller's `searchTimeoutMs`, a `hydrating`
render resets the sentinel streak (rows exist, so the sentinel is the loading state), and if the
bound elapses with incomplete rows on screen the driver throws naming the count, the card selector
and the last-observed labels — never `no-signal`, because the search answered. The refusal of a
COMPLETED row whose label carries no identity is unchanged: completion says when to read, never what
was read. Pinned RED-first by `tests/unit/new-kronos-search-render.test.ts` (12 cases — the three
mid-render stages as fixtures, the raw-binding strings verbatim, the nested `krn-slat`'s
name-only label, a complete row with a foreign label) against the extracted on-sight verdict
(`70f0bbf2`), fixed at `b87dc560`. `krn-slats-tabular-data` is driver-internal like
`p.totals-counter` — legacy has no key for it — so it is not a registry element.

**Disposition:** fix, live-verified (a8). Doc 03b's sep-1 line is closed with this section; the
store's `CLAUDE.md` carries the invariant and the lesson; `ref lessons` carries the general form.
Not done here: the throttled cold home's navbar bound (a7/a8) is an artefact of 20× throttling and
elapsed loudly by name — no bound was widened.

**Review fix (2026-08-27).** The read above swapped the poll's `count()` for `evaluateAll()`, and on
Playwright 1.61.1 those disagree about a missing frame — `count()` answers 0, `evaluateAll` throws
`Failed to find frame for selector "…"` — so the TOP-LEVEL panel context (no named frames; the
second `searchEmployee` of a session) aborted on a raw Playwright error instead of falling through
to the `page` root. The poll now counts each candidate root's slats before reading it, nothing is
caught, and `tests/unit/new-kronos-search-poll.test.ts` pins the interpreter halves the 12 verdict
cases could not reach (the two-root read, the hydrating streak reset, the by-name bound refusal, and
`no-signal` when the rows vanish again). The prose figures in `ref lessons` and the store's
`CLAUDE.md` also merged a6's 8×-throttled 214 ms into the COLD range; the table above is
authoritative — 30–108 ms cold, 214–570 ms throttled.

Live RED→GREEN on the warm `hrauto-rebuild` profile, EID 10776990, the real factory / login recipe /
driver, same sequence both runs (`readSeparationTimecard` → Go To → Timecard, then a second
`searchEmployee`): **pre-fix** the second search threw
`locator.evaluateAll: Failed to find frame for selector "iframe[name^=\"portal-frame-\"] >> …"` from
`interpreter.ts:308` via `:399`; **post-fix** `state=resolved context=top-level in 1436 ms`, one row,
matched `Kou, Nathan`. Two OUT-OF-SEAM refusals surfaced on the way and were left alone, both loud
and both after the navigation this fix covers: (1) `searchEmployee` called twice in one session on
`…/wfd/home` refuses the second with `the Employee Search panel's …query-field rendered in neither
… context` — search #1 collapses the panel to `Show Search`, and the separations descriptor chains
the `search-employee` node into `read-separation-timecard`, whose `selectEmployeeInPanel` searches
again; (2) `setRangeField` refused `could not set the timecard start date to 6/1/2026 — the field
last read "11/20/2626"`, i.e. the range field is typed into without being cleared first.

#### R2 u1 — 4537 composed rehearsal refused by S7 on Pacific 2026-08-27; submit-free (2026-08-27)

This is the R2/u1 evidence the run plan assigned to §9.28. The section number had already been
claimed by the cold-WFD repair above, so this addendum preserves that history rather than
renumbering or overwriting it.

**Preflight.** The clean root checkout was `integration/03b` at `9201d626`. Port 3938 was already
owned by the root BFF recorded in §9.29 (pid 78925; cwd this checkout); port 5174 had no listener,
so neither was restarted. Its served `separations` contract fingerprint was
`14217f341c0b84ef2eb30437cf62be519cb6b43a4b2d18dfab7997dc8ebecf7e`, and all **21** served task
implementation fingerprints matched the generated build manifest exactly. `storage doctor` found
authority schema 18 healthy, invariants valid, foreign-key violations 0, and the latest backup
current at authority generation 759. The runtime's Duo readiness assertion proved both the root
extension and credential loadable. Pacific time was **2026-08-27 20:30 PDT**; per the u1 brief this
was recorded, not used as a coordinator hold.

The registry label `separations-controlled-commit-canary` had moved to doc 4568 in R2a, so this
run used the composed surface's exact ingress for doc **4537** (`timekeeperName: <secret:separationsKualiFinalizationCanaryTimekeeperName>`),
which remains recorded under `finalization-canary`; no registry row was changed. One and only one
run was planned and started, with no `reRead`, freshness override, or retry:

| Authority | Exact value |
|---|---|
| start plan / command | `f0425c22-f800-4352-a6b0-8d7f07eeb1d2` / `a499380f-17f1-482a-bd2f-1053e3fefb2e` (`applied`) |
| run / trace | `74675563-a59a-499f-a847-03c56ae5350e` / `sp-203233-7467` |
| mode / item | `dryRun: true` / `separations:4537`, attempt 1, claim generation 1 |
| terminal | `failed` at `2026-08-28T03:33:17.916Z` (Pacific **2026-08-27 20:33 PDT**) |
| failure tuple | node `plan`; code `SEPARATION_DATE_IN_FUTURE`; fingerprint `ec7781ac641372279dd4c34001f0867ea4d5346c6d9bcbb06260a2aa5dc1312a`; `writeState: not-attempted`; `transient: false` |

**S7's exact date facts.** The live Kuali read bound the displayed document to 4537 and observed
Last Day Worked **08/28/2026**. The runtime's Pacific calendar day was **08/27/2026**, so
`workflow:separations/read-separation-plan` refused: *"Kuali document 4537 carries a Last Day Worked
of 08/28/2026, which is after 08/27/2026 — the Pacific calendar day this run read the document. The
employee is not yet eligible for separation (S7)."* Failure id
`220e77f5-fe5e-4f52-a38c-dc7556c9f7c0`; receipt
`6252fafe-0e9b-5a2d-8ed7-2c78409beb06` records `failed` / confidence `unknown`.

**Node-by-node authority.** `resolve-action` and `document` each produced this attempt's durable
checkpoint (`03:33:14.464Z`, `03:33:17.866Z`). `plan` produced the node-bound failure above and no
checkpoint. Every downstream node — `termination-type`, `name-search`, `subject`, `job-summary`,
`employment`, `department-option`, `timecard-search`, `timecard`, `dates`, `comparison`,
`identity-approval`, `approval`, `clear-pending`, `file-termination`, `receipt`, and
`finalize-kuali` — was **not reached**. No gate opened and no `transaction.previewed` event existed;
the D215 preview terminal was therefore **not** claimed.

**Exact-run submit-free audit.** The authority query selected `write_intents` whose strict
`record_json.runId` equals this run, then joined `write_attempts` and `durable_outbox` only through
those intent ids: **0 / 0 / 0**. This is per-run evidence, not a global before/after count. S7 was
the required terminal for this Pacific date, so u1 stopped without retry and authorizes no u2 work.

**Closure.** This unit's worker was `separations-worker-1`, pool index 1, process pid 1807 and lease
generation 5. `Ctrl+C` ended that process and its Kuali browser, but deliberately did not rewrite
the immutable process record: its `releasedAt` remains null. After authority proved every
`separations` task terminal and the last heartbeat older than 60 s, the supported
`npm run cli -- worker separations --pool-index 1 --drain` sweep reclaimed that stale lease, claimed
nothing (`outcomes: []`), and stopped generation 6 at `2026-08-28T03:34:59.712Z`; the drain process
record was cleanly released. No owned worker browser or `playwright-cli` session remains. The
pre-existing root BFF remains alone on 3938 exactly as found, and 5174 remains unused.

#### R2/u1 4537 follow-up — BLOCKED at registry admission before a run (2026-08-28)

This follow-up was authorized for exactly the composed label
`separations-controlled-commit-candidate`, not a free-form document number or the distinct
`separations-kuali-finalization` workflow. Its first admission check was deliberately the real
`resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, label)` path, which reaches the composed
descriptor's own ingress parser without opening a browser or planning a run:

```text
./node_modules/.bin/tsx -e '<resolver assertion: expected ready>'
{"expected":"ready","actual":"blocked","label":"separations-controlled-commit-candidate","reason":"blocked: needs separations-controlled-commit-candidate; registry says gone, last observed 2026-08-14"}
exit 42
```

The strict registry independently identifies this label as workflow `separations`, kind
`controlled-commit-candidate`, availability `gone`, with document **4524** and provenance
`§9.12, §9.16 §3`; its recorded reason is that the action completed on 2026-08-14. This is the
admission authority, so it conflicts with the preflight brief/board's asserted 4537 mapping and
stops u1 at the first authoritative door. No registry, resolver, test, descriptor, selector,
timeout, or fallback was changed here.

**What did not run.** No start plan, command, worker, browser, three-system smoke, integrated gate,
or composed rehearsal was started; thus there is no u1 run/trace/result/receipt/failure id,
checkpoint count, reached node, write-evidence query, Decision A diagnostic, or screenshot. No
substitute label, finalization canary, free-form identifier, retry, or write mode was used.

**Read-only runtime close.** `playwright-cli list` reported no browsers. The rebuild BFF and Vite
were already listening on 3938/5174 (started 11:07 PDT) and were not this unit's processes, so they
were left untouched. The authority has three old nonterminal `separations-kronos-timecard` records
from 2026-08-12 but no live worker process or live lock holder; the dead unreleased historical lock
records were also left untouched. The board intake blob remained
`0ef85a59de1ffec7f3a60c265cb9eb95f14dda20` at close.

**Disposition.** This is an honest preflight block, not a controlled-commit claim. Doc 03b exit
criterion 5 remains **OPEN — all three**. Reconciling the requested 4537 identity with the registry
is outside u1's no-code/no-config scope and requires a separately authorized decision.

---

### 9.29 The 4568 canary mapping pass — read-only against Kuali, 2026-08-27 (D280, run R2a u23)

> 2026-08-28 — the registry role this section gave 4568 (label `separations-controlled-commit-canary`, the second active canary) was superseded by §9.31 (D284): 4568 ceased to be an active registry identity on 2026-08-28. Everything recorded below stays as recorded.

**Why it ran.** D280 (`docs/decisions/2026-08-27-canary-4568.md`) named Kuali doc **4568** as a
second canary: *"make it the dry run and canary. do it dry run first and then make it canary"* — a
composed `dryRun=true` audit first, then the controlled commits ②→①→③ with the operator at the
keyboard, while 4537 keeps its 2026-08-28 role. Unit u23's job was to read 4568's facts LIVE, apply
the date/state gate, and register the subject only if the gate admits it. This section is the header
u23 opened; ②/①/③ and the composed dry run are filled in by u24–u27.

Read-only against production, Duo cleared hands-off by Duo Autopilot, in this pass's OWN
playwright-cli session (`u23`) on its own profile (`.auth/u23-profile`), closed at the end.
**Nothing was submitted, saved, approved or finalized.** `Save`, `Send Back` and `Mark Complete`
were never clicked; no dashboard run was planned and no worker claimed anything; the browser was
driven directly, exactly as §9.19 mapped 4537.

#### 1. Doc 4568 is in the Action List

Filtered the RRSS space's Action List
(`https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb/actions`) and read the row
verbatim:

| Fact | Value |
|---|---|
| present in the Action List | **YES** |
| form | `RRSS Separation Request Form` |
| document number / level-1 heading | `4568` / `4568` |
| action id | `6a9069186f37b1c04b52df28` |
| step | **`Task 1 - Jan`** |
| created on | `Aug 27, 2026` |
| action requested | `Task` |
| person column (the **submitter**, not the subject — §9.19's correction) | `Kelly Grenard` |

Every cell of the row links to the same action id, so there is exactly one action for 4568 and no
ambiguity for `readActionListForDocument`'s anchored `^\s*4568\s*$` recipe to resolve.

#### 2. The document as the live form holds it, 2026-08-27

The subject is **not** the person column. The document's own subject:

```
EID*                              10001982
Employee Last Name, First Name*   Drethaa, Glause
Division*                         Campus Dining and Retail
Location*                         Canyon Vista Marketplace
Employee Type*                    Student
Student Title Code*               4921 - STDT 2
Type of Termination*              No Reason Given
```

| Field | Live value on 4568 |
|---|---|
| `Last Day Worked*` | **`06/08/2026`** |
| `Separation Date (Last day actively employed)*` | **`06/08/2026`** |
| `Termination Effective Date*` | **empty** |
| `Department*` | **`- - -`** (nothing selected) |
| `Payroll Title Code*` | **empty** |
| `Payroll Title*` | **empty** |
| `Transaction Number:*` | **empty** |
| `Timekeeper Name:*` | **empty** |
| `Timekeeper Acknowledgement` (`Request Acknowledged - In Progress`) | **unchecked** |
| `Submitted Termination Template` | **unchecked** |
| `Final Pay Transactions*` | **nothing selected** |
| `Timekeeper/Approver Comments:` | **empty** |
| `Additional Separation Comments (Optional)` | `Resignation email sent on 8/27/26 - was due to start back in Fall on 9/14.` |

**`Type of Termination` resolves.** `No Reason Given` is in
`src/domain/separations/termination-type.ts`'s declared map →
`voluntary("Resign - No Reason Given")` → template **`UC_VOL_TERM`**, reason code
**`Resign - No Reason Given`**. §4a's gate would not refuse it. This is the first canary to exercise
the **voluntary** template; 4537 (`Graduated/No longer a Student`) is involuntary.

**4568 is emptier than 4537 was.** §9.19 found 4537 carrying seven of the twelve staged fields.
4568 carries **none** of the Timekeeper-step fields — department, both payroll title fields,
timekeeper name, the acknowledgement checkbox and the two dates' downstream fields are all unset,
and only the two Employee-Information dates are populated. That is consistent with a document
created the same morning (`Aug 27, 2026`) whose Step-1 timekeeper has not touched it yet. It is
recorded rather than acted on: what it means for ③ (a finalization that fills more fields than
4537's would have) is u27's finding, not this pass's claim.

`Department*` offered the same six options §9.3 recorded (`:2156-2159`, not §9.19 — §9.19 never
enumerated this list). The accessibility snapshot collapses whitespace, so the double space §9.12
saw (`:3212`, not §9.19) in `000719 -  Supply Chain Services` cannot be confirmed or denied from
this read — no claim is made either way.

#### 3. The date / state gate — **PASSES**

u23's brief stops the whole R2a run if the document's dates are in the future, if a transaction
number already exists, or if the document is not readable. All three checks clear on Pacific
calendar day 2026-08-27:

| Check | Live value | Verdict |
|---|---|---|
| Last Day Worked after 2026-08-27? | `06/08/2026` — **80 days in the past** | **admits** — S7 (`separation-date-in-future`) has nothing to refuse |
| Separation date after 2026-08-27? | `06/08/2026` — same day as LDW, in the past | **admits** |
| `transactionNumber` non-empty? | **empty** | **admits** — ③ would write into an empty field, never over a stale one (the axis §9.19 called 4537 "the cleaner canary" on; 4568 is equally clean) |
| document present / readable? | present in the Action List, form rendered, level-1 heading `4568` | **admits** |

**4568 is admissible today.** Unlike 4537 — whose `08/28/2026` LDW keeps S7 refusing until
2026-08-28 — there is no date gate left to wait out on this subject.

#### 4. What this pass did NOT run, and exactly why

**The standalone read workflow was NOT run.** `separations-kuali-read` refuses `dryRun=true` by
construction, from the real planner, on the real `POST /api/v1/start-plans`:

> `{"code":"dry-run-unsupported","message":"separations-kuali-read has no transaction node, so a dry`
> `run would be indistinguishable from a real run; start it for real or not at all"}`
> — plan `d24ae4ba-01c5-4852-ad3c-7191008e9513`, `planned: []`, `refused: [entry 1]`

The refusal is correct and is the descriptor's own design (`kuali-extraction/descriptor.ts`: no
`prepare` node, no `commit` node, the store operation has no write path). The alternative it names —
`dryRun=false` — was **not** taken: u23's brief forbids `dryRun=false` anywhere in R2a, and a
subagent does not widen that on its own reading of a graph. So the facts above come from a direct
read of the source system, by §9.19's method, and the run id / trace id / authority write rows this
section would otherwise carry are **honestly absent** rather than filled from a projection.

**No workflow ran at all, on any subject.** In particular nothing was run on doc 4537, in any mode
(R2a condition: its ②/①/③ checkpoint replay must not be seeded with 2026-08-27 reads).

**Coordinator ruling (2026-08-27).** `dryRun=false` on `separations-kuali-read` stays unauthorized;
this §9.19-style direct read IS the registration source, exactly as it was for 4537, and the run id
comes from u24's composed dry run instead. So the refusal above — plan
`d24ae4ba-01c5-4852-ad3c-7191008e9513`, code `dry-run-unsupported` — is the recorded reason this
section carries no run id, and every fact in items 1–3 came from a direct read of the live document.

**One operational correction.** The pool worker's start form is
`npm run cli -- worker separations --pool-index 1`: the first positional argument is a **workflow
id**, and the worker id (`separations-worker-1`) is DERIVED from it
(`src/server/worker/compose.ts` `parseWorkerArguments`). The wrong form — the derived worker id
passed as the first argument — lives in this run's handoff
(`docs/handoffs/2026-08-28-run-1-t1b-canary.md:29`), which the parser refuses by name with the
registered-workflow list. The `hr-manage` skill (`.claude/skills/hr-manage/SKILL.md:19,35`) passes
the correct `<workflow-id>` throughout and only OMITS `--pool-index`; it does not pass the wrong id.
Recorded here because the refusal reads like a missing workflow rather than a wrong argument.

#### 5. u24 — the composed dry run: **REFUSED at `timecard`, three attempts, no preview terminal**

The composed `separations` graph was started on 4568 with `dryRun: true` through the real command
surface — `POST /api/v1/start-plans` (`42b391e6-55e2-4fc5-8af7-6f33cd7c2668`, `planned: 1`,
`refused: []`, matchKey `separations:4568`) confirmed by `POST /api/v1/commands`
(`eeb707e0-d5b1-40a2-aefe-ed1cc93d683a`, `start-run`, `expectedVersion 1` → **`applied`**), session
`352708ba-ca1e-49f9-83aa-21cf0dd7029f`, item **`58dd2b5c-3a22-50c7-8121-8fdb8d0e61fe`**. One BFF on
3938 (pid 6081) and ONE pool member `separations-worker-1` (pid 93342,
`npm run cli -- worker separations --pool-index 1`). The served `separations` fingerprint was
**`14217f341c0b84ef…`**, byte-identical to `generated-build-manifest.ts:164`, for the whole pass —
the fresh-singleton habit, checked before the first start.

**It did not reach the D215 preview terminal.** All three attempts are terminal `failed`, and the
run half of the graph — `clear-pending`, `file-termination`, `receipt`, `finalize-kuali` — was never
entered. That is the honest outcome; nothing below is filled from a projection.

| Attempt | Run | Trace | Queued | Claimed | Terminal | claimed→terminal | Refused at |
|---|---|---|---|---|---|---|---|
| 1 | `a248967a-585a-4bec-8a6f-a55ba2171049` | `sp-141040-a248` | 21:10:47.451Z | 21:11:11.771Z | `failed` 21:11:53.827Z | **42.06 s** | `timecard-search` — new-kronos login |
| 2 | `e44d4d4e-94d2-4fbb-bfe2-9d6515c5594f` | `sp-141429-e44d` | 21:14:29.960Z | 21:14:53.832Z | `failed` 21:15:36.420Z | **42.59 s** | `timecard` — `setRangeField` clear |
| 3 | `bfbd2487-ed74-4911-9137-3ccc7ae8a7a3` | `sp-141702-bfbd` | 21:17:02.340Z | 21:17:06.432Z | `failed` 21:17:49.027Z | **42.60 s** | `timecard` — the same refusal, verbatim |

Attempts 2 and 3 were the queue's own `retry` command (D221 — the item's next unspent attempt), each
claimed by the same `separations-worker-1`. Every run was `dryRun: true`; `dryRun=false` was never
sent, on 4568 or on any other subject, and doc 4537 was not touched in any mode.

**The two refusals, by name.**

1. **Attempt 1, `timecard-search` / `new-kronos/search-employee`**, failure
   `38ddfecc-3634-4cdc-96fd-f71e30997cf7`, `transient: false`, `writeState: not-attempted`, after
   **1 535 ms**:
   > `new-kronos login failed at verify-landing: the login could not prove the authenticated`
   > `application: the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock`
   > `sign-on host shares the mykronos.com domain and is refused here (observed URL`
   > `https://cust01-prd07-ath01.prd.mykronos.com/authn/XUI/?realm=ucsd_prd_01&service=30847CustomerIDPChain&goto=…%2Fwfd%2Fhome…)`

   This one is **transient in fact even though the record marks it `transient: false`**: attempts 2
   and 3 logged into WFD from the same profile with no change to anything, `timecard-search` running
   `done` in 30.3 s and 30.5 s. Recorded as an observation, not fixed: the refusal is correct (a
   ForgeRock IDP page is not the application), but a first cold new-kronos login that lands on the
   sign-on host and is refused rather than retried costs a whole attempt. Kuali and UCPath logged in
   hands-off on the same attempt, so Duo Autopilot was working.

2. **Attempts 2 and 3, `timecard` / `new-kronos/read-separation-timecard`**, failures
   `3a20ad21-83c7-44fa-9bc3-c5e5b844b9dc` and `d231d18b-69b2-45d0-a1d6-1dc8f6e0b7b7`, both
   `transient: false`, `writeState: not-attempted`, both after **12.3 s / 12.1 s** in the node:
   > `[new-kronos] could not clear the timecard start date field before typing 05/08/2026 — the`
   > `field last read "08/27/2026" after 8000ms; refusing to type into a field that will not clear`

   **This is u21's clear, refusing live for the first time — and it says the clear does not work.**
   `setRangeField` now does `fill("")` and then requires TWO consecutive `""` samples
   `POLL_INTERVAL_MS` apart before it types (u21-fix, `3b9588c5`). Live, the field never read `""`
   at all: it held **`08/27/2026`** — WFD's own default period start, i.e. today — for the whole
   `RANGE_FIELD_CLEAR_TIMEOUT_MS` 8 000 ms budget. So the Angular digest reverts `fill("")` exactly
   the way it reverts `fill(VALUE)`, which is the possibility u21-fix's comment names as the reason
   the held read-back exists. The guard did its job — a wrong window was never applied and no
   appended `"11/20/2626"`-style value was typed (§9.28's pre-u21 defect) — but the composed chain
   now **cannot get past `timecard`** on this driver. Two identical refusals on two attempts make it
   deterministic, not a race, so no fourth attempt was spent. **Not fixed here** (R2a condition ii —
   the tree is frozen); this is R3's input.

#### 6. The submit-free audit, node by node

Spans are this run's own `.tracker-rebuild/spans/separations-2026-08-27.jsonl`; durations are
`span.ended − span.started`. Attempts 2 and 3 replayed the nine checkpointed read nodes and emitted
NO spans for them — a replayed node re-runs nothing, which is itself part of the no-submission
proof.

| # | node | shape · store | what it did | would write | write intent | durable rows |
|---|---|---|---|---|---|---|
| 1 | `resolve-action` | task · kuali (read) | a1 `done` 8 230 ms — Action List filtered, `matchedLinkCount 2` → action `6a9069186f37b1c04b52df28`, `pageStateId kuali.action-list.ready` | nothing | none | 1 checkpoint |
| 2 | `document` | task · kuali (read) | a1 `done` 3 471 ms — RRSS form read, `pageStateId kuali.rrss-document.separation-ready` | nothing | none | 1 checkpoint |
| 3 | `plan` | task · workflow (headless) | a1 `done` 14 ms — LDW/sep `06/08/2026`, `asOfDate 08/27/2026`, **timecard window `05/08/2026`–`07/08/2026`** | nothing | none | 1 checkpoint |
| 4 | `termination-type` | task · workflow (headless) | a1 `done` 5 ms — `No Reason Given` → **voluntary** → `UC_VOL_TERM` / `Resign - No Reason Given`, 17 options observed | nothing | none | 1 checkpoint |
| 5 | `name-search` | task · ucpath (read) | a1 `done` 23 919 ms — Person Org, `results 1`, `selection.status resolved`, HDH true | nothing | none | 1 checkpoint |
| 6 | `subject` | task · workflow (headless) | a1 `done` 3 ms — EID …6995, `emplIdSource document-eid`, `candidateCount 1` | nothing | none | 1 checkpoint |
| 7 | `job-summary` | task · ucpath (read) | a1 `done` 4 829 ms — 1 job row, `renderContext.entry auto-detail` | nothing | none | 1 checkpoint |
| 8 | `employment` | task · workflow (headless) | a1 `done` 6 ms — `emplRecord 0`, `Active`, `SDCMP`, dept `000412 HOUSING/DINING/HOSPITALITY`, title `004921 / STDT 2`, effective `06/21/2026` | nothing | none | 1 checkpoint |
| 9 | `department-option` | task · workflow (headless) | a1 `done` 3 ms — `000412 - Housing/Dining/Hospitality`, 6 options | nothing | none | 1 checkpoint |
| 10 | `timecard-search` | task · new-kronos (structurally read-only) | a1 `failed` 1 535 ms (login); a2 `done` 30 300 ms; a3 `done` 30 466 ms — `query 6995`, `totalCount 1`, `selectedCount 1`, `panelContext portal-frame` | nothing | none | 2 checkpoints (a2, a3 — `always-rerun`) |
| 11 | `timecard` | task · new-kronos (structurally read-only) | a2 `failed` 12 259 ms; a3 `failed` 12 092 ms — the `setRangeField` clear refusal above | nothing | none | **0** |
| 12 | `dates` | task · workflow (headless) | never entered — no span | — | none | **0** |
| 13 | `comparison` | task · workflow (headless) | never entered — no span | — | none | **0** |
| 14 | `identity-approval` | **gate** · operator | never opened — `gates` holds 0 rows for these runs, `checkpoint_payloads` 0 | — | none | **0** |
| 15 | `approval` | task · workflow (headless) | never entered — no span | — | none | **0** |
| 16 | `clear-pending` | **transaction** · ucpath | never entered — no probe span, no fence, no commit | — | none | **0** |
| 17 | `file-termination` | **transaction** · ucpath | never entered — no span | — | none | **0** |
| 18 | `receipt` | task · workflow (headless) | never entered — no span | — | none | **0** |
| 19 | `finalize-kuali` | **transaction** · kuali | never entered — no span | — | none | **0** |

**The three runs emitted 48 events and not one of them names a write**: `run.queued` 3,
`run.claimed` 3, `span.started` 14, `span.ended` 17, `data.observed` 11 — and **zero**
`transaction.previewed`, zero `gate.opened`, zero `gate.resolved`, zero `write.*`, zero fence, zero
commit, zero intent. Every store the chain actually reached is a read path: the two Kuali tasks are
`search`/`read`, the two UCPath tasks are `search`/`read`, and the New Kronos store is
*structurally* read-only (no `MutationCapability` in its import graph, no `external-commit` element
in its UI registry). No `Save`, `Send Back`, `Mark Complete` or `submitDocumentV2` exists on any path
taken; no UCPath save was reached because `clear-pending` and `file-termination` were never entered
at all.

Read from authority after the last terminal, over the WHOLE database:
**`write_intents` 0 · `write_attempts` 0 · `durable_outbox` 0** — **0/0/0** — with
`artifact_outbox` 0 besides. The one non-zero row in `run_terminal_outbox` (1) and the one row in
`run_results` both belong to the earlier 4502 run `fd415e49…` (12:40:18Z, §9.27 addendum item 7);
**these three runs added nothing to either.** Document 4568's Kuali form was not saved and its
`transactionNumber` is still empty.

#### 7. The range-field observations — what is measurable, and what is not

`setRangeField` records **no telemetry on success**: no span, no `data.observed` point, no log line.
Its read-backs are observable ONLY in the refusal message. So a passing call leaves nothing to
tabulate, and the table below is everything authority can carry — the u21 lesson's "unmeasured
live" note is a property of the code, not of this pass.

| call | requested | clear read-back (needs 2 consecutive `""`) | typed read-back | elapsed vs the 8 000 ms bound |
|---|---|---|---|---|
| start date, attempt 2 | `05/08/2026` | **never `""`** — last read `"08/27/2026"` | not reached | **8 000 ms — bound exhausted, refused by name** |
| start date, attempt 3 | `05/08/2026` | **never `""`** — last read `"08/27/2026"` | not reached | **8 000 ms — refused, identically** |
| end date, both attempts | `07/08/2026` | not reached | not reached | — |

The `timecard` node's 12.1–12.3 s is ~4 s of Go To / timecard open plus the 8 000 ms clear poll, so
the bound is the whole cost. `08/27/2026` is today — WFD initialises the range to a period starting
on the current day, which is the value the digest keeps restoring.

**`searchEmployee` took the good path (§9.28 refusal (1) was NOT hit).** That refusal — a second
`searchEmployee` in one page on `…/wfd/home` — is a hand-probe path: the composed chain resets the
session between leases, so `timecard-search` (`search-employee`) and `timecard`
(`read-separation-timecard` → `selectEmployeeInPanel`) each searched from a fresh panel. Both
attempts got past the search and the Go To into `setRangeField`, which is downstream of both
searches. The panel resolved in the **`portal-frame`** context, matching the two-root read u14-fix
landed. u22 stays parked.

#### 8. The checkpoints the dry run seeded — what ②/①/③ replay

`run_checkpoints`, keyed `(workflow, item_id, node_id, attempt, claim_generation)`, holds **11** rows
for item `58dd2b5c-3a22-50c7-8121-8fdb8d0e61fe`, all of them read-side:

- **attempt 1, generation 1 — nine rows**: `resolve-action`, `document`, `plan`, `termination-type`,
  `name-search`, `subject`, `job-summary`, `employment`, `department-option` (run `a248967a…`).
- **attempt 2, generation 1 — one row**: `timecard-search` (run `e44d4d4e…`).
- **attempt 3, generation 1 — one row**: `timecard-search` (run `bfbd2487…`).

Zero rows for `timecard`, `dates`, `comparison`, `approval`, `clear-pending`, `file-termination`,
`receipt` or `finalize-kuali`; zero `checkpoint_payloads` rows (no gate was opened); zero
`run_results` rows. Attempts 2 and 3 PROVED the replay works across attempts on this item: each was
claimed and started its first span on `Timecard Search` within 25–33 ms, having re-run none of the
nine.

#### 9. What ② will see

Because the item key excludes `dryRun` (`descriptor.ts:840-842`), a `dryRun=false` start on 4568
lands on this same item and replays these same checkpoints. ② would therefore begin from values
already frozen here, and these are the values it will act on: EID **10001982** (`document-eid`,
`candidateCount 1`, one active UCPath job — `emplRecord 0`, `Active`, `SDCMP`, effective
`06/21/2026`); Last Day Worked = separation date = **`06/08/2026`**, `asOfDate` **`08/27/2026`**, so
S7 admits; termination type `No Reason Given` → **voluntary** → template **`UC_VOL_TERM`**, reason
**`Resign - No Reason Given`** (the first canary to exercise the voluntary template); department
folded from UCPath as **`000412 - Housing/Dining/Hospitality`** and payroll title as
**`004921 / STDT 2`** — both of which the Kuali document itself leaves EMPTY, along with
`Termination Effective Date`, `Timekeeper Name`, `Final Pay Transactions`, the acknowledgement
checkbox and `Transaction Number`. Only the two Employee-Information dates were populated on the
form, so ③ would fill more fields on 4568 than it would have on 4537.

**But ② cannot reach `file-termination` on this driver.** `timecard` is NOT checkpointed, so a
`dryRun=false` run replays the nine read nodes, re-runs `timecard-search` live, and then hits the
identical `setRangeField` clear refusal — before `identity-approval`, before `clear-pending`, before
any write. Condition (iii)'s fallback covers ③ (`separations-kuali-finalization` has no kronos node)
but there is no such fallback for ②, whose graph needs the reconciled dates. Recorded, not resolved:
whether u25 proceeds, and how, is the supervisor's call.

#### 10. Two smaller observations, recorded not acted on

- **`000719 - Supply Chain Services` reads with ONE interior space.** §9.29 item 2 could not settle
  this from the accessibility snapshot and made no claim. The Kuali driver's own structured read
  does settle it: it `.trim()`s each option and collapses nothing interior
  (`src/stores/kuali/driver/interpreter.ts:812-817,883,945`), and the `document` node's
  `options.department` point carries `"000719 - Supply Chain Services"`, single space. That differs
  from the `observedDepartmentOptions` arrays recorded in `config/test-subjects.json` for the 4537
  and 4510 rows, which carry a DOUBLE space. Nothing on the path taken compares against those arrays,
  so nothing failed — but one of the two records is stale and they should be reconciled.
- **`resolve-action` observed `matchedLinkCount 2` for 4568.** §9.29 item 1 read every cell of the
  row as linking to the same action id; the driver counts two matched links and resolves them to one
  action (`6a9069186f37b1c04b52df28`). The two records agree; the count is noted so a future reader
  does not mistake 2 for an ambiguity.

**Closure.** The BFF (3938) and vite (5174) were reused, never restarted, and are left up; pool
member `separations-worker-1` (pid 93342) is left running per the brief. This pass opened no
`playwright-cli` session of its own — the browser work was the worker's, and `playwright-cli list`
reports no CLI-owned browsers. `npm run roadmap:check` reports `docs/roadmap/index.html is fresh`.

#### 11. Close — 2026-08-27

Run R2a's six units, from authority (items 1–10 above; no fact here is re-derived):

| Unit | Outcome | Sha |
|---|---|---|
| u23 — 4568 mapping pass, read-only against Kuali | done — date gate **PASSES** (LDW = separation date `06/08/2026`; `transactionNumber` empty; document present in the Action List) | registration `819ff38f`; doc 03b row `6a876627`; §9.29 header `c8d6fdcd`; roadmap `55032e70` |
| u24 — composed workflow, `dryRun=true` | done — **REFUSED at `timecard`**, three attempts (`a248967a` · `e44d4d4e` · `bfbd2487`); `setRangeField` clear never reads `""`, the field holds WFD's default `08/27/2026` for the 8 000 ms bound; 9 read nodes + `timecard-search` checkpointed (11 `run_checkpoints`), nodes 12–19 never entered; write rows 0/0/0; no preview terminal | `1622afcf` |
| u25 (② UCPath filing) | **NOT dispatched** | — |
| u26 (① pending sweep) | **NOT dispatched** | — |
| u27 (③ Kuali finalization) | **NOT dispatched** | — |
| u28 — this close | done | this commit |

**Supervisor ruling (verbatim).** Under D280 ("dry run clean first") and condition (ii) (tree
frozen; nothing fixed today), NO controlled commit ran on 2026-08-27. u25 (②), u26 (①), u27 (③) NOT
dispatched — ② has no kronos-free fallback (condition iii covers ③ only); a `dryRun=false` run would
replay the nine reads, re-run `timecard-search`, and hit the same clear refusal before the gate.

**Handed to R3, as a driver unit:** the WFD range-field clear — `fill("")` does not take on the
period-start field; find the control that clears it (live), keep the read-back refusal.

**Questions for the coordinator:**

(a) may ② run on a standalone `ucpath-transaction` path without the composed dry run, or does
D280's "composed dry run clean first" stand;
(b) does 4568 keep its canary role for the next attempt or does 4537 (08-28) go first;
(c) the `separations-kuali-read` `dry-run-unsupported` refusal — is a registration read allowed
`dryRun=false` on a workflow with no write path.

#### 12. u24′ after u29 — **STOP-R2B at resume validation; no node or gate opened**

This was the one authorized follow-up composed run on the existing 4568 item. It used
`dryRun: true`, no `reRead`, and no freshness override. The first BFF preflight caught a stale
served implementation for `new-kronos/read-separation-timecard`: pid 6081 served
`0ffc422e…` while the frozen u29 tree was `85d3e91c…`. Decision `6ad30aec` ratified its narrow
restart. The replacement root BFF (pid 78925, singleton generation 46) then served the exact full
tree implementation fingerprint
**`85d3e91cc6d8c52ed7a0f6305fcb2e09ecb0500512fd581692701c449c11b7f4`** before planning.
Commits `fdfc783c`, `eb6c9638`, `05f727f3`, and `6ad30aec` were all ancestors of HEAD; the
intervening UI merges did not alter `src/stores/**`, `src/base/**`, or `src/domain/**`, and the u29
interpreter plus generated manifest were unchanged.

An initial incomplete preview plan (`8131c487-d780-4554-82cc-ba68ddea2368`) refused
`input-invalid` because the required `timekeeperName` was absent; it created no command or run.
The real plan used the item's exact prior canonical ingress without a live re-read:
`3cf20dc9-d1b8-487a-b9a8-e7ff27c340dc`, `planned: 1`, `refused: []`, matchKey
`separations:4568`, contract fingerprint
`14217f341c0b84ef2eb30437cf62be519cb6b43a4b2d18dfab7997dc8ebecf7e`. Command
`0db9bff0-797e-4524-9d4c-d18891a202d7` was **`applied`** and created:

| Run | Trace | Session | Attempt | Claim / worker lease generation |
|---|---|---|---:|---|
| `fc0fc13c-f6e5-459a-b2bf-d643cab48a68` | `sp-194254-fc0f` | `00e27827-f946-4497-b236-6e998152fe48` | 4 (run number 5) | 1 / 3 |

It queued at `2026-08-28T02:42:54.979Z`, was claimed at `02:43:17.867Z`, and reached terminal
`failed` at `02:43:17.891Z`: **24 ms claim→terminal** (22.888 s queue→claim). Failure
`d82e8362-2db1-49b8-9e99-b3de9bca7e7a` is `RESUME_VALIDATION_FAILED`,
`transient: false`, `writeState: not-attempted`. Before starting `timecard-search`, resume
validation found the replayed UCPath `name-search` observation from `21:11:46.844Z` and
`job-summary` observation from `21:11:51.650Z` to be **5h31m old**, past the exact
`14,400,000ms` (4 h) freshness limit. Those values feed `clear-pending`, `file-termination`, and
`finalize-kuali`; the kernel therefore refused before any task execution. No override was requested
or granted. Evidence receipt `1f7eaf5f-1057-5c9b-8b41-b52e7d83d780` records attempt 4 as
`failed` / confidence `unknown` against that same failure.

**Node-by-node authority.** The run emitted only `run.queued`, `run.claimed`, and the terminal
run-level `span.ended`: no task `span.started`, no `data.observed`, no failure-bound transaction
node, and no `transaction.previewed`.

| # | Node | u24′ authority |
|---:|---|---|
| 1 | `resolve-action` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 2 | `document` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 3 | `plan` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 4 | `termination-type` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 5 | `name-search` | prior checkpoint failed freshness validation; no u24′ span or new checkpoint |
| 6 | `subject` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 7 | `job-summary` | prior checkpoint failed freshness validation; no u24′ span or new checkpoint |
| 8 | `employment` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 9 | `department-option` | prior checkpoint was a replay candidate; no u24′ span or new checkpoint |
| 10 | `timecard-search` | resume target, but validation refused before its span started |
| 11 | `timecard` | not reached; no span, range read-back, or checkpoint |
| 12 | `dates` | not reached; no span or checkpoint |
| 13 | `comparison` | not reached; no span or checkpoint |
| 14 | `identity-approval` | not reached; no gate row or checkpoint payload |
| 15 | `approval` | not reached; no span or checkpoint |
| 16 | `clear-pending` | not reached; no preview, fence, intent, attempt, or outbox row |
| 17 | `file-termination` | not reached; no preview, fence, intent, attempt, or outbox row |
| 18 | `receipt` | not reached; no span or checkpoint |
| 19 | `finalize-kuali` | not reached; no preview, fence, intent, attempt, or outbox row |

Authority after terminal holds **0 checkpoints for this run** and the same **11 historical item
checkpoints**; `gates` 0 and `checkpoint_payloads` 0 for this run. Because no browser/source node
started, u24′ performed no fresh UCPath, New Kronos, or Kuali read and no submission/read-back;
it did not alter 4568's prior Kuali observation.

**Submit-free audit (hr-debug §9).** The per-run query selects `write_intents` whose durable
`record_json.runId` is this exact run, then joins `write_attempts` and `durable_outbox` only through
those intent ids: **0 / 0 / 0**. Separately, whole-table counts were also **0 / 0 / 0**; the global
numbers are not attributed to this run.

**Conclusion: STOP-R2B.** u24′ did not get past `timecard` and did not reach the D215 preview
terminal. Under the supervisor ruling there is no retry, `reRead`, freshness override, gate
approval, or u25–u28′ continuation. The new R3 observation is that the post-u29 run was refused
even earlier by the deterministic resume-freshness door; it does not live-disprove u29's restored
range-field path.

**Closure evidence.** The run worker was started as
`npm run cli -- worker separations --pool-index 1` (pid 79025), acquired process record
`5bb54b29-e027-4ba2-a192-abd9d587490a` at `02:41:17.816Z`, and held worker lease generation 3.
After terminal, its PTY received `Ctrl+C`; the OS then reported pid 79025 absent, but its immutable
process record correctly remains crash evidence with `releasedAt: null` rather than a manufactured
release. Its last lease heartbeat was `02:44:57.963Z` (`idle` / `run`, version 400).

The supervisor authorized the supported startup sweep only after an authority read at `02:51:21Z`
proved that heartbeat **383.318 s old (>60 s)** and proved the separations queue unambiguously
empty: all five runs `terminal`, with **0** `queued`, `claimed`, `validating`, `running`,
`parked-gate`, or `parked-write`. The exact closure command
`npm run cli -- worker separations --pool-index 1 --drain` reclaimed generation 3 as
`lease-expired` (logging that its process never settled), started generation 4 under pid 84858,
claimed no item (`outcomes: []`), and exited 0. Authority now records generation 4 `stopped` at
`02:51:27.179Z`, reason `shutdown`, version 404. Its own process record
`249ec471-c765-4618-9297-1355357562ae` was acquired at `02:51:27.124Z` and cleanly released at
`02:51:27.180Z`; the old generation-3 process record was not rewritten. The replacement BFF
remains on 3938. Vite pid 6011 disappeared without being signalled by this unit and 5174 no longer
has a listener. This unit opened no Playwright session; `playwright-cli list` reports none. The
missing Vite listener is recorded honestly and left untouched.

---

### 9.30 The WFD range-field probe and restored keyboard path — 2026-08-27 (R2b u29)

**Boundary and prior red signal.** §9.29 attempts 2 and 3 supplied the red-capable live signal:
`fill("")` never produced an empty sample and `timecard` refused after 8 000 ms with the start field
still reading `08/27/2026`. This pass used one isolated named headless `playwright-cli` profile
(`u29`) with Duo Autopilot, searched only the redacted doc-4568 canary, and entered its timecard.
The first browser exited while the range panel was being reset; the same named profile was reopened
to finish P4/P5. Neither browser clicked Apply, planned a run, opened a gate, or touched any write
surface. The reopened session was closed; `playwright-cli list` then reported no browsers.

#### P1 — the control and its model

After `Select range`, `#startDateTimeInput` was one visible, enabled, writable top-level
`<input type="text">`, initial value `08/27/2026`, `defaultValue ""`. Its live Angular attributes
were:

```text
class="tfsDateInput krn-common-focus ng-pristine ng-untouched ng-valid ng-not-empty …"
ng-model="rangeInput.useNativeDateInput ? rangeInput.isoStartDate : rangeInput.formattedStartDate"
ng-focus="rangeInput.inFocus($event)"
ng-blur="rangeInput.handleBlur($event)"
ng-keydown="!rangeInput.useNativeDateInput && rangeInput.handleKeydown($event)"
ng-click="!rangeInput.useNativeDateInput && rangeInput.handleClick($event)"
aria-invalid="false"
```

The nearest three-input row contained only the visible `specificDateTimeInput`,
`startDateTimeInput`, and `endDateTimeInput`, each with its own Angular model. There was **no hidden
or second model input** behind the start field.

#### P2 — selection is real, but widget-state/segment-sensitive

The first exact `click` → `ControlOrMeta+a` measurement moved selection from `0..2` to **`0..10`**
over the ten-character default: a real whole-value selection exists. A fresh reopened range then
kept `0..2` after explicit `Meta+a`, `Control+a`, and `ControlOrMeta+a`; later the end field moved
`0..2` → `0..10`, while the third start re-proof stayed `0..2`. Therefore select-all is an input
gesture, **not proof** and not a stable precondition. This satisfies the ratified restore arm because
P2 did expose a real selection, but success remains exclusively the final calendar-day equality.

The ratified no-selection alternatives were also tested, not assumed: `Home` + `Delete` × 12 and
`End` + `Backspace` × 12 each left `08/27/2026` and selection `0..2` unchanged on every key. The
character-clear arm is live-disproved and is not retained as a fallback.

#### P3 — `fill("")` never exposes an empty state

| elapsed after `fill("")` | `inputValue()` |
|---:|---|
| 0 ms | `08/27/2026` |
| 100 ms | `08/27/2026` |
| 200 ms | `08/27/2026` |
| 500 ms | `08/27/2026` |
| 1 000 ms | `08/27/2026` |

This is the same fact §9.29 saw over 8 000 ms: there is no observable clear to gate on, and waiting
longer cannot turn it into an authority.

#### P4 — real keystrokes advance the masked segments

From the default `08/27/2026` with only the month segment selected (`0..2`), real
`pressSequentially("05/08/2026")` emitted the changing input values **`05/27/2026` →
`05/08/2026`** and finished exactly on `05/08/2026`. Slashes and unchanged year digits emitted no
value change; the mask advanced the month and day segments itself. The earlier §9.28
`11/20/2026` → `11/20/2626` failure remains a real different state — a mid-year caret — and is
therefore retained as the final-refusal regression rather than generalized away.

#### P5 — frame context and the third start re-proof

Employee Search began in exactly one `portal-frame-*`. After Go To → Timecard, the application URL
ended `/timekeeping#/timecard`, there were zero named portal frames, `#startDateTimeInput` counted
**1 top-level / 0 portal-frame**. Using §9.29's composed range without applying it:

| call | prior | selection after `ControlOrMeta+a` | final read-back |
|---|---|---|---|
| start | `08/27/2026` | segment `0..2` in the P4 pass | `05/08/2026` |
| end | `08/27/2026` | whole value `0..10` | `07/08/2026` |
| start re-proof (third call) | `05/08/2026` | segment `0..2` | `05/08/2026` |

**Landed mechanism.** `setRangeField` is restored to click → capture `priorValue` →
`ControlOrMeta+a` → real `pressSequentially` → bounded final read-back. The u21 clear gate and
`RANGE_FIELD_CLEAR_TIMEOUT_MS` are deleted. There is no empty-state gate, retry, longer wait,
fallback, or widened acceptance. The ONE refusal is still “final parsed calendar day does not equal
the requested day”; it now includes the prior value and last observed value, so the known
`11/20/2626` masked overtype is self-diagnosing. The §9.28 / `d45376d0` citation repair landed by
`3b9588c5` is retained.

### 9.31 The one-subject registry consolidation — 2026-08-28 (D284, R2/u1r)

**Why it ran.** R2/u1 — the composed `dryRun=true` audit on doc 4537 — blocked at admission on
2026-08-28 before any browser started. Its brief addressed the chain by the label
`separations-controlled-commit-candidate`, and the registry correctly refused: that label was the
completed doc 4524 (`gone`, last observed 2026-08-14), and 4537 existed only as
`finalization-canary` under the `separations-kuali-finalization` workflow. The rebuild may not
substitute a document number or guess across a workflow boundary, so the unit stopped and asked
(`docs/decisions/2026-08-28-r2-u1-4537-registry-reconciliation.md`). The operator answered `1 A`
with an override that became **D284**: after one fresh read-only verification, the active registry
holds exactly one subject — existing label `finalization-canary`, Kuali doc 4537 — addressable by
BOTH workflows without cross-workflow guessing; every other active label is removed and its
observations stay here as dated history. Three units carried it: u1r-a (the read-only re-read
below), u1r-b (the registry contract, `936fabc0`), u1r-c (both T1b manifests, the both-directions
guard, and the owning docs — this section's commit).

**No workflow rehearsal, gate, worker or write ran under u1r.** The two reads below were passive,
read-only, and byte-identical; nothing was saved, sent back, marked complete, planned or queued.

#### 4537 as re-read on 2026-08-28 (u1r-a, ~19:43Z, two byte-identical reads)

Evidence: `.tracker-rebuild/manual-verification/4537-2026-08-28/r2-u1r/` — **restricted**, filenames
neutral; no name or EID is reproduced here.

| Fact | Live value 2026-08-28 | vs §9.19 (2026-08-19) |
|---|---|---|
| Presence | one row in the RRSS Action List, action `6a8336ee44b521eae41895dc`, step `Task 1 - Kristina & TES`, `In Progress` | unchanged |
| Openness | open and editable — `Save` / `Send Back` / `Mark Complete` rendered, none clicked | unchanged |
| Last Day Worked | `08/28/2026` | unchanged |
| Separation Date | `08/28/2026` | unchanged |
| Termination Effective Date | **EMPTY** on the live form | unchanged; the registry's `08/29/2026` is the value the finalization STAGES (separation date + 1), not an observation |
| Department | `000412 - Housing/Dining/Hospitality` | unchanged |
| Payroll Title Code / Title | `004920` / `STDT 3` | unchanged |
| Transaction Number | **EMPTY** — the UCPath filing ② has not run | unchanged |
| Timekeeper Name | unchanged vs registry | unchanged |
| Type of Termination | `Graduated/No longer a Student` → `UC_INVOL_TERM` / `No Longer Student` | unchanged |
| Student Title Code | `4920<TAB>- STDT 3` | unchanged |

Nothing differs from §9.19 in substance nine days later. UCPath was NOT re-read in this pass; the
`clear-pending` arm the composed manifest expects (`already-present` off the live probe) stands on
§9.19 row ① — five transactions, every one `Approved`, zero `Pending` — and ② has not filed anything
since.

#### The registry contract as built (`936fabc0`, u1r-b)

`config/test-subjects.json` is `schemaVersion` **2** and holds **one entry**. An entry is a
SUBJECT: `label`, `purpose`, ONE dated `availability` claim (a fact about the document — `available`,
last observed 2026-08-28), `provenance`, D85's usage rules, and a strict `workflows` object with one
arm per workflow that can address it:

| Arm | `kind` | What it carries | Resolves today as |
|---|---|---|---|
| `separations` | `full-chain-dry-run` | the document number, `{ state: "present", documentNumber: "4537" }`; the resolver feeds it through the descriptor's own start-box parser (D261) — no EID crosses this arm | `ready` — the typed document number is the whole ingress |
| `separations-kuali-finalization` | `ordinary` | the finalization ingress minus its two EID leaves, the two EID references (resolved only through `src/domain/secrets.ts`), and `pending: { transactionNumber, timekeeperComments, terminationEffectiveDate }` with the reason each is absent (`terminationEffectiveDate` is EMPTY on the live form — the value is the one the finalization STAGES, derived by the chain's `dates` node as separation date + 1, so it is authored rather than observed) | **`blocked` BY NAME** — `blocked: needs finalization-canary for separations-kuali-finalization; transactionNumber not yet filed (UCPath filing ② pending); …, last observed 2026-08-28` — before any secret is read |

A declared-pending leaf blocks; an undeclared missing leaf is a registry defect by label and date;
a leaf cannot be both observed and pending; a resolver asked for a subject with no arm for its
workflow refuses by name. Both T1b manifests now carry exactly one case each, on this label and
this arm's kind: `separations/dry-run` case `nothing-to-sweep` (graph expectations transcribed from
§9.27 addendum 7's 4502 run, the `already-present` arm from §9.19 row ①) and
`separations-kuali-finalization/dry-run` case `ordinary` (the expectation for the day ② has filed —
a run today records a `blocked` row, not `failed`). `tests/unit/architecture/test-target-registry.test.ts`
walks every manifest and every registry arm and proves config = manifests = doc 03b's inventory
line = {4537} in both directions; the retired labels are asserted absent by
`tests/unit/test-target-registry.test.ts`.

#### The eight labels that retired — ceased to be active registry identities 2026-08-28; evidence stays where recorded

| Retired label | Workflow · kind | Document | Last registry claim | Evidence owner |
|---|---|---|---|---|
| `finalization-already-finalized` | finalization · `already-present` | 4510 | `gone`, 2026-08-19 | §9.16, §9.19 item 7 |
| `finalization-no-active-job` | finalization · `no-active-job` | 4510 | `gone`, 2026-08-19 | §9.16 item 2, §9.19 item 7 |
| `finalization-subject-mismatch` | finalization · `subject-mismatch` | none — no live subject ever existed | `unknown`, 2026-08-20 | ref guards-and-tests §10.4 (the unreachable `subject: mismatch` arm stays an open item there) |
| `separations-dry-run-subject` | chain · `full-chain-dry-run` | 4502 | `available`, 2026-08-20; last run 2026-08-27 (`met`) | §9.17, §9.27 addendum 7 |
| `separations-future-dated` | chain · `future-dated` | 4495 | `available`, 2026-08-19 | §9.17a run 4, §9.19 §7 |
| `separations-controlled-commit-candidate` | chain · `controlled-commit-candidate` | 4524 | `gone`, 2026-08-14 | §9.12, §9.16 §3 |
| `separations-pending-termination` | chain · `pending-termination` | none — the only pending witness was deleted (§9.16 §4) | `unknown`, 2026-08-19 | §9.16 §4, §9.19 §5 |
| `separations-controlled-commit-canary` | chain · `controlled-commit-candidate` | 4568 | `available`, 2026-08-27; composed audit refused at `timecard` | §9.29 |

The kinds `future-dated`, `pending-termination`, `already-present`, `no-active-job`,
`ambiguous-name`, `subject-mismatch`, `name-differs` and `concurrent-jobs` remain manifest
vocabulary in `DryRunSubjectKindSchema`; the registry offers only the kinds a real subject can be
(`ordinary`, `full-chain-dry-run`, `controlled-commit-candidate`). The negative branches those
labels stood for are owned by the structural T1a files and the unit tests on synthetic subjects.

### 9.32 R2 observed software closure and assigned-runtime admission refusal — 2026-08-30

This bounded R2 close reconciles current observations; it does not replace the live records above.
The parent merged the independently reviewed paired Archive parity cleanup at `54060ded` (follow-up
reference commit `50007d66`): full coverage passed **341 files / 3,761 tests**, and assert-mode
parity passed **239/239**. The exact commands, logs, and review are retained in
`docs/coordinator/worktree-completion/reports/{r2-gates,r2-parity-review}.md`.

The assigned worktree was then checked only through `npm run smoke:test-target-person-secrets`.
It exited 1 with the fixed bootstrap refusal that its local `.env` was unavailable; presence-only
checks also found no assigned `.env`, `.tracker-rebuild`, or `.tracker-rebuild/locks`. This occurred
before runner import and before person-field inspection. No browser, run, authority creation,
approval, write, UNKNOWN retry, or root/runtime substitution occurred. Consequently this record
asserts **no** fresh live subject or S7 observation, composed rehearsal, receipt/node coverage, or
run-specific 0/0/0 result. It is an admission refusal, not a zero-write claim.

`finalization-canary` / doc 4537 remains the sole registry identity by D284, but not a currently
re-observed canary. Before controlled work resumes, the intended runtime must be established; it
must then pass admission, obtain fresh S7/subject observation, and complete a successful composed
rehearsal with its exact-run evidence. Only then may the separately approved order execute:
② UCPath filing, immediately ① UCPath pending sweep on the row ② creates, then ③ Kuali
finalization. Source and canonical input freeze at the successful rehearsal through ③; every write
retains its own ALWAYS-GATE. Do not label ① a Kuali reread. The R3 range-field and other live-derived
obligations remain separately owned and are not complete here.

### 9.33 R1 fresh canary admission and gone-subject stop — 2026-09-01

R1 resumed in the primary checkout on clean source **`e635584e`**. The one D300 environment
reference passed `npm run smoke:test-target-document-number` with the two closed lines
`state=present` and `resolution=ready`; no document-number value was printed. The first storage
doctor reading found a healthy generation-1301 authority but a stale backup, so no live workflow
started. Starting the ordinary dashboard backup owner produced verified-compatible generation 1302
with generation gap 0; only then did R1 proceed.

The exact command
`npm run cli -- dry-run-scenario separations --subject finalization-canary` started durable scenario
result **`62ea22fd-798c-4982-b4d7-8a211c6ec954`** and run
**`325cd998-bd05-4ffd-a863-99e0cc5c0ebe`** / trace **`sp-142939-325c`**. After 40,688 ms the current
Kuali Action List search failed **`DOCUMENT_NOT_IN_ACTION_LIST`**. Failure
**`b5f34a55-75c5-423e-a7c2-d7fa8548b392`** records `writeState: not-attempted`. The run is terminal
`failed` at attempt 2; no current `plan` checkpoint exists, so present S7 was not observed and the
runner correctly refused to resolve the identity gate. Two replayable attempt-1 checkpoints from
the 2026-08-28 read remain historical evidence only; they are not a claim that the document is
still present.

Read-only exact-run queries then proved:

| Authority table | Rows for run `325cd998…` |
|---|---:|
| `write_intents` | **0** |
| `write_attempts` | **0** |
| `durable_outbox` | **0** |

No gate was requested, no operator approval was consumed, no write was prepared or submitted, and
no UNKNOWN retry exists. This is a genuine u1 blocker, not a green u2 rehearsal: the run plan says
to stop when 4537 is absent or materially changed. D284 already settled the response — retain the
one label with honest `gone` availability and choose no substitute. A future operator decision must
name a new controlled-commit canary; that subject must pass a fresh read/S7 observation and a green
0/0/0 rehearsal before the still-ordered ② → immediate ① → ③ sequence may begin.

**Post-run projection finding and D301 recovery.** The scenario start had called the command kernel below the
dashboard command service and therefore committed the run without emitting its write-once
`run.queued` root. The worker then truthfully appended `run.claimed`, task/browser spans and the
failed terminal, leaving storage doctor at `span-stream-invalid` and the dashboard correctly
refusing a degraded projection. Source now builds every queue-root event through one shared
projection and the composed dry-run start emits that event after its authority transaction closes,
before any worker drain; the production composition regression proves the root is the first and
only run event.

D301 then supplied the explicitly reviewed recovery disposition. With runtime roles observed
stopped, `storage repair-span-root --run 325cd998-bd05-4ffd-a863-99e0cc5c0ebe` derived the missing
root only from the exact run/session/consumed-start-plan chain and **appended** its strict
`authority-reconstruction` record. No existing line was inserted, replaced or truncated: the
original 2,422-byte prefix remains bound by SHA-256
`8eef5a21bd94096a69ccace6e7b013e0bd3483c16c5aa23fcc68aeef832fb2f9`. Storage doctor moved from
exit 1 to exit 0 with 8/8 stream/live runs reconciled and current generation-1335 authority/backup.
An exact second command returned `already-repaired` with identical 3,480-byte file size and SHA-256
`abe99e012c8c1074fdd8b67cc47f2218a8a77de4d0e148d6dd9daa917db9dce8`; BFF startup then served
healthy/current storage. This repaired companion evidence only: it did not rerun the failed subject,
open or resolve a gate, approve anything, or change the exact-run 0/0/0 write proof.

### 9.34 Operator-named candidate batch and safe stops — 2026-09-01

The operator supplied seven replacement candidates after 4537 was observed gone. The dashboard
started all seven with `dryRun=true`; 4589 ran first to prove the composed live read path, then three
explicit pool members drained the other six. No identity or write gate was resolved in this pass.

| Document | Run / trace / attempt | Fresh durable result |
|---|---|---|---|
| 4589 | `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf` / `sp-155454-ca6a` / 1 | parked at `identity-approval` after current document, plan, employment, timecard, dates and comparison observations |
| 4588 | `cb6aa949-a387-4d1a-9b90-29ba3e14121d` / `sp-155717-cb6a` / 1 | terminal `CONCURRENT_ACTIVE_EMPLOYMENTS`, write state not-attempted |
| 4579 | `ed18da2f-7025-4e99-a803-43c81e5b0a02` / `sp-155717-ed18` / 1 | terminal `EMPLOYEE_NOT_FOUND`, write state not-attempted |
| 4564 | `a071bce2-704f-4724-aae6-310bdd98ba02` / `sp-155717-a071` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted |
| 4544 | `d78ca17d-55d6-42cc-8e2b-fcb69b7dd89c` / `sp-155717-d78c` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted |
| 4502 | `1e513fbd-9249-421e-841a-d88c7edfbef8` / `sp-155717-1e51` / 2 | parked at `identity-approval`; the current read/comparison is fresh, while an older run's approval checkpoint remains historical only |
| 4495 | `178b9f34-647f-420f-a072-aafcfda4b4eb` / `sp-155717-178b` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted |

Exact-run SQLite queries returned `write_intents=0`, `write_attempts=0`, and `durable_outbox=0` for
every row. The three future-dated documents were therefore skipped at their own date admission and
were not retried. The other two terminal failures are subject-specific current facts, not runtime
failures, and were not retried. Of the two viable candidates, 4589 provided the clean attempt-1
lineage. The operator approved its fresh identity packet, which requeued the run; one explicit
worker drain then verified that exact approval and reached terminal `done` at `clear-pending`'s
dry-run preview. Receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7` records `DRY_RUN_PREVIEW`,
settlement `already-present`, and no external write. The exact-run counts remained 0/0/0. This is
the green u2 rehearsal; source and canonical input freeze here through the three controlled
commits. The sanitized UI manifest is
`docs/coordinator/separations-completion/evidence/ui/2026-09-01-candidate-dry-runs.md`.
