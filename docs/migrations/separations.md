# Migration plan — `separations` (order 8, the Phase-3 entry)

> **STATUS: READY TO BUILD — the §5 questionnaire is fully answered.** §5 item 5's freshness VALUES
> (5A the four `maxAge`s, 5B the override column on the date fields) were the one remaining residual
> and were answered by the operator on **2026-08-12**, alongside everything else the questionnaire
> asks: §2.6 (ratified as **D194**), §4a, §4b, §4c, §4d, §4e, §4f1–§4f4, §4g, and the §3
> build-strategy directive. Every §5 item now carries a **verdict line** of ANSWERED — none remain in
> the STILL NEEDS OPERATOR class.
>
> Doc 07 §3.1 step 1 is explicit: the operator questionnaire is asked and answered **BEFORE**
> building. With 5A/5B answered, a read contract's `freshness` (doc 01 §2.1.1 / D8) is now a
> satisfiable field, so `new-kronos/read-separation-timecard` can be authored. **Chunk 1 — the
> `new-kronos` store plus the `separations-kronos-timecard` timecard-read sub-workflow, authored rich
> under D194 — starts now.**

**What this doc is.** The first Phase-3 migration doc, and therefore the convention every later one
follows (doc 07 §0.1: migration docs are **children** of the master plan — they answer §3.4 and
record what a workflow reuses/adds; they never re-order the program). Chosen as the Phase-3 entry by
the operator on 2026-08-12 (**D193**) because a big multi-system workflow forces the store task
libraries into existence — see doc 07 §3.1's entry block for the reasoning.

**Sources.** Legacy is read **read-only** as a frozen reference (D93/D94). Every legacy fact below is
cited to `legacy:<path>:<line>` at commit **`1bffbd65`** (2026-08-06), and anything ported into code
later must carry that provenance in the code itself. Rebuild contracts come from the owning docs:
doc 09 (write safety, §14 identity gate), doc 02 (graph/gates/delegation), doc 01 (task contracts),
doc 11 (freshness/instance), doc 12 (evidence/trust), doc 06 (intake). The scenario-by-scenario
account of what legacy actually does — **S1–S63** and the dangerous-pattern list — lives in the
sibling doc `separations-legacy-behavior.md`; this doc cites its S-numbers rather than restating it.

**How this doc is organised.**

| § | Contents |
|---|---|
| **1** | Overview — what the workflow does, the `T002173685` incident, the ALWAYS-GATE |
| **2** | Stores — what exists today, what this migration mints, and the proposed rich-extraction convention |
| **3** | Build strategy — the bottom-up "lego" decomposition and what composition can actually use |
| **4** | **Open decisions** — one entry per genuinely open item, each as options + pros/cons + a recommendation, each now carrying the operator's 2026-08-12 answer |
| **5** | The §b questionnaire (doc 07 §3.4) — twelve items, each with a **verdict line**, its draft, and the recorded answer |
| **6** | Exit criteria (doc 07 §3.2) |
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

Doc 07 §3.3 puts separations at order 8 because of the **wrong-person termination `T002173685`**. A
graduating student's Kuali doc carried EID `10833507` ("Hernandez, Jose Santos"); UCPath rendered the
name as "Santos Hernandez", the similarity classifier returned `different`, a name search on the
common name resolved a **career** maintenance worker (`10401814`, employed since 2016), and the
override filed a real termination against him (`legacy:src/workflows/separations/CLAUDE.md:44,204`;
scenario **S17**). A permanent-key fence would have fenced that write perfectly and filed it anyway —
the key was derived from the wrong person.

**Doc 09 §14 ALWAYS-GATE applies to this migration in full.** Manual identity approval on **every**
separation, both separation types, **no auto-approve-on-match** (operator ratification 2026-07-24,
D77). This is a deliberate **widening** of legacy, which gates only on the `different` tier and lets
`same`/`similar` proceed silently (**S14/S15/S16/S17**). Two values are explicitly left to this
questionnaire by doc 09 §14.7: the **approval freshness limit** (item 5, residual **5A** —
**answered 2026-08-12: kept at the drafted 4 hours, because D8/doc 09 §14.7 make `Infinity` illegal
for identity facts — see §5 residual 5A**) and whether **I-9 separations** show a different candidate
packet than Kuali separations
(**answered 2026-08-12: separations does not involve the I-9 packet at all, so the question resolves
out of scope for this workflow** — §4f1). §4d then settles the other half in this workflow's favour:
the gate holds in **every** run mode, with no preset, prefill or resume path able to disable it. Also note doc
09 §14.6 risk #1: an always-gate's dominant failure is rubber-stamping, which is why the packet leads
with **disconfirming** evidence and why an ambiguous decision must not be dispatchable by the same
click as an unambiguous one. The behavior review's **S25/S26** show the other half of the risk —
legacy's gate is switchable off by a run mode, which is §4d.

---

## 2. Stores

### 2.1 What exists today

**`src/stores/`:** `ucpath`, `crm`, and `kuali` have real drivers, login recipes, UI registries and
tasks. `new-kronos`, `old-kronos`, `onbase`, `servicenow`, `i9`, and `sharepoint` are session
declarations with `declareDriver(…, "unwired")` and **zero** tasks. `STORES.md` is the derived
catalog of that reality; §4 of it already records the two gaps this migration closes (the ucpath
write family, and the kuali separation read/finalization family).

### 2.2 `ucpath` — existing store, new write family

| Task | Effect | New / reuse | Note |
|---|---|---|---|
| `ucpath/search-person-org` | read | **reuse** | Exists (person-lookup). Candidate resolution for the gate packet may reuse it as-is |
| `ucpath/read-job-summary` | read | **new** | Workforce Job Summary: dept, dept id, payroll title code, payroll title, legal name. Must pick the effective-dated row at or before the separation date, on both tabs |
| `ucpath/find-existing-termination` | read | **new** | The doc 09 §12 probe by name. Match on Person ID **exactly** + effective date + `/Terminat/i`; legacy deliberately removed name matching after a real duplicate-name collision |
| `ucpath/read-termination-status` | read | **new** | The approved-reuse check on SS Smart HR, with the 14-day window and "unreadable effdt ⇒ never reuse" (**S27/S28/S29**) |
| `ucpath/clear-pending-terminations` | prepare + **commit** | **new** | The date-agnostic sweep. Deletes rows, so it is a fenced mutation (item 1B / doc 09 §13 item 5; **S30/S31**) |
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
`workflow:person-lookup/read-active-status` (`STORES.md` §2) — a sessionless, artifact-free,
provider-free fold over prior node outputs.

### 2.6 The rich-extraction store convention — RATIFIED as D194

> **Status: ANSWERED 2026-08-12 — Option A adopted, ratified as D194.** The normative text lives in
> **doc 01 §2.8** (task contracts owns "how wide a read task's output is", the same way §2.7 owns
> "how much a task owes"); the derived view is `STORES.md` §1 "How stores work"; the pointer row is
> doc 04 round 48. Doc 06 is **not** an owner — it owns intake (column mapping, roster, capture), and
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
  value. Second cost: redaction classification is per leaf and an undeclared leaf fails loud (doc 12
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
- Each such task declares its per-leaf redaction classification at authoring time (doc 12 §D140).
- The convention is then ratified as **D194** in doc 01 §2.8 + `STORES.md` §1, and later migrations
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

Where it landed: **doc 01 §2.8** (normative), `STORES.md` §1 (derived), doc 04 round 48 (pointer).

---

## 3. Build strategy — bottom-up chunks, composed like lego (operator directive, 2026-08-12)

Separations is the biggest workflow in the program. The operator's directive is that it is **not**
built as one slice: it is **decomposed bottom-up** into chunks that each stand alone and each get
proved before anything is composed.

**The order is store tasks → per-system sub-workflows → composition.**

1. **Store tasks first.** Every task in §2's inventory is authored against its strict contract with
   its scenarios and pure-logic unit tests, in the store that owns it (doc 01). A task is finished
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
   (doc 07 §3.1 step 5) — and that is a real gate, not a formality: it is what lets the composed
   workflow inherit two proven writes instead of proving both at once, at the end, on the largest
   graph in the program.
3. **Then compose.** The full `separations` descriptor is assembled from the proven pieces with the
   ALWAYS-GATE identity node sitting **before** the transaction nodes (doc 09 §14.3 — a gate is a long
   wait and D26 forbids any park between `prepare` and `commit`).

**What composition can actually use today — the honest note.** Two mechanisms exist and they are not
equivalent:

| Mechanism | Status in this tree | What it costs at composition |
|---|---|---|
| **One descriptor, many nodes** (reads → gate → transaction → transaction) | **Built and proven.** Both shipped workflows use it; doc 09 §12's worked example is literally two transaction nodes in one separations graph | Nothing. The sub-workflows' *tasks* compose directly; the sub-workflow descriptors stay as proving harnesses |
| **Real child runs** (`child-run` node / delegation, doc 02 §3.2) | **A typed seam that is NOT wired.** `ChildRunExecutor` is an optional dependency of the run executor, `composeWorkerRuntime` never supplies it, and a `child-run` node therefore fails loud with `capability-unavailable` — "refusing to skip a delegation" (`src/core/run-executor.ts:1350-1356`, `src/server/worker/compose.ts:502-537`) | Wiring the executor seam **plus** the enqueue/join transaction, the fan-out manifest, and a worker able to claim the child workflow — a slice of its own, not a step of this one |

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

- **Chunk 3 (the UCPath termination write)** — doc 09 §14's ALWAYS-GATE identity approval becomes a
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
what every guard, scenario and controlled-commit proof has to cover, and doc 02 §5.5's freshness walk
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
  key already fenced and settled (doc 09's same-key mutex refuses a second fence).
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
  doc 09's same-key mutex refuses a second fence.
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

**Option A — ALWAYS-GATE in every mode; no preset, prefill, or resume path can disable it. ★ recommended (and this is what doc 09 §14 / D77 already ratified)**
- *Pros:* it is the ratified contract, not a new position. It deletes pattern D7 structurally rather
  than by discipline: the guard `identity-gate-before-separation-commit` (doc 09 §14.6 guard #2,
  already in §6's exit criteria) proves every commit is graph-reachable only through the gate node, so
  a future edit cannot reintroduce the skip. It also makes **S25** well-formed, because the approval
  binds to an evidence digest and is re-checked on resume — item 5's draft: an identical digest inside
  the freshness limit proceeds, a changed candidate re-opens the gate regardless.
- *Cons:* every "transactions only"-style run pays one Job Summary read and one operator decision.
  That is the price the `T002173685` incident already paid for once.

**Option B — the gate is skippable with a per-run explicit operator override recorded in authority.**
- *Pros:* a genuinely repetitive resume (§4c's finalization-only path) would not re-ask.
- *Cons:* an override that exists gets used routinely, and doc 09 §14.6 risk #1 is rubber-stamping — a
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
  auto-approve-on-match. This ratifies doc 09 §14 / D77 for this migration with no exception carved
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
(D135; `STORES.md` §2, `kuali`). Item 2's draft already declares `save-verify` for both Kuali writes.

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

**One consequence to carry into item 5.** Reading everything first and writing at the end deliberately
**widens the gap** between each read and the write it feeds — and the identity gate sits inside that
gap as a human wait. The per-read `maxAge` values are what bound that gap, which is exactly why item
5's values are the one residual left open.

---

### 4f. The pure-operator items — no legacy basis, options where options exist

These four have no derivable draft. Each is presented with the shapes its answer could take, so the
operator picks a shape rather than composing from scratch.

#### 4f1. The I-9 separation candidate packet (item 6; doc 09 §14.7)

**Context.** The operator distinguishes **Kuali separations** and **I-9 separations**, and doc 09
§14.7 asks whether the I-9 type shows a **different** candidate packet at the gate. There is no
legacy basis: I-9 Check was split into its own workflow on 2026-07-17 and no I-9-separation branch
exists anywhere in the legacy separations code to derive one from.

- **Option (i) — one packet for both types, with the separation type recorded as a field. ★ recommended default.** *Pros:* one packet composition to build, one gate surface to guard, no divergence risk between two wrong-person controls. *Cons:* if an I-9 separation genuinely turns on evidence a Kuali separation does not carry, the operator sees a packet missing the decisive field.
- **Option (ii) — a declared packet variant per separation type.** *Pros:* each type shows the evidence its decision actually needs. *Cons:* two compositions to keep in step and two redaction classifications; and the wrong-person control must be provably identical in both, or the weaker packet becomes the attack surface.
- **Option (iii) — blocked until the operator describes what an I-9 separation is.** *Pros:* invents nothing. *Cons:* blocks item 6 and therefore the whole questionnaire.

**Recommendation:** (i) as the default, escalating to (ii) **only** if the operator can name at least
one field that must differ. No named field ⇒ no variant.

#### 4f2. Test versus production instance (item 6; doc 11 §4)

**Context.** Doc 11 §4 wants a per-run test/prod instance decision; whether a UCPath or Kuali *test*
instance exists for this workflow is operator knowledge that neither repo records.

- **Option (i) — a real UCPath/Kuali test instance, if one exists.** *Pros:* the full write path including `Save and Submit` gets exercised with no real termination filed. *Cons:* only useful if its selectors and workflow steps match production, which is itself a live-verification job; and a green test-instance run is explicitly **not** the controlled-commit evidence doc 07 §3.1 step 5 requires.
- **Option (ii) — an operator-approved production canary: one named separation the operator accepts will be filed for real, with the approval recorded. ★ recommended for the commit proof.** *Pros:* it **is** the required evidence; it is exactly how D128 and D135 were done. *Cons:* irreversible, and it needs a real pending separation with the operator present.
- **Option (iii) — blocked until the operator names a target.** *Pros:* honest if neither exists. *Cons:* blocks §6's controlled-commit criterion.

**Recommendation:** (ii) for the commit proof — it is the only option that satisfies the exit
criterion — with (i) used for fill/prepare rehearsal *if* a test instance exists. Either way, naming
the target is doc 07 §3.1 step-5 operator work, which §7 already records.

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
this one. Doc 09 §14.7's deferred question resolves as **out of scope for this migration**. In
practice the gate therefore shows **one** packet composition — option (i)'s outcome — but for a
stronger reason than (i) offered: it is not that both types share a packet, it is that this workflow
has only one type. Nothing here is a claim about what an I-9 separation needs; if one is ever
automated it is its own migration with its own questionnaire (and, per §3.1, its own composition).

**4f2 — option (ii): an operator-approved PRODUCTION canary.** No test instance is used for the
commit proof. One named separation the operator accepts will be filed for real, with the approval
recorded — exactly how D128 and D135 were done, and the only thing that satisfies doc 07 §3.1 step 5.
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
  evidence; doc 09 §14.6 risk #1 (rubber-stamping) argues against bolting unrelated decisions onto it.

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

## 5. The §b questionnaire (doc 07 §3.4 — twelve items)

**Read this first — the operator asked for exactly one thing from this section.** *"Rephrase those
questions like §4 and ask me in the same format if I still have to answer them — I'm not sure if they
are the same questions you asked in §4."* They largely **are** the same questions: §4 is where the
genuinely open decisions were pulled out and given options, and §5's items are the doc 07 §3.4
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
> DRAFT STANDS: A/B/E are derived from legacy plus doc 09 §13, and E's refusal follows from §4d.

*What the answer determines:* every mutating action needs a prepare contract, a commit contract, one
transaction lease scope, a stable idempotency key, an expected subject, a post-prepare semantic
observation, a normalizer/matcher, and mismatch/unknown evidence (doc 09 §2). This is the list the
whole write-safety kernel is instantiated from.

**DRAFT — operator to confirm/correct.** Legacy performs **five** distinct external mutations:

| # | Mutation | System | Draft treatment |
|---|---|---|---|
| A | **Save and Submit the termination transaction** | UCPath Smart HR | A real `commit`. Permanent key `<eid>\|termination\|<terminationEffDate>` (doc 09 §12's worked example uses exactly this shape). Expected subject = the operator-approved EID from the gate; the staged page's Empl ID field is the post-prepare observation |
| B | **Delete pending termination rows** for the EID | UCPath Smart HR | It deletes rows, so it is a mutation and doc 09 §13 item 5 explicitly asks whether it is modeled as a first-class fenced write. **Draft: yes — its own commit contract**, keyed `<eid>\|pending-sweep\|<runId>` and run as a separate transaction node before the create (**S30/S31**) |
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
fenced node before the create, per doc 09 §13 item 5). **E** stands refused — the `similar`-tier name
rewrite does not port, which §4d independently requires: an identity field on the source document is
not something a wrong-person control may edit to make itself pass. **D**'s final-pay value is §4g
(hardcoded, operator-ratified).

---

### 2. Completion check per submit

> **VERDICT: ANSWERED via §4e (how many read-backs, and against what) and §4c (partial completion) —
> no further operator input.** The per-mutation arms (`receipt` / typed sweep outcome / `save-verify`)
> are DRAFT STANDS: they are doc 09 §2's own vocabulary applied to the D130 finding.

*What the answer determines:* which of doc 09 §2's three completion arms each commit declares —
`receipt`, `save-verify`, or `upload-verify`/argued `unverifiableByPage`. Getting this wrong is how a
"looked submitted" becomes a `done`.

**DRAFT — operator to confirm/correct.**

- **A (UCPath termination) → `receipt`, and the receipt is the PAIR `(transactionNumber, approvalStatus)`, never the number alone.** The 2026-08-04 live probe (D130, doc 09 §13 item 6) proved a **Denied** transaction carries a perfectly well-formed `T…`, and recorded that legacy's own `interpretPostSubmitTxnReadback` tests only `/^T\d{6,}$/` — a real latent defect. The number lives on **SS Smart HR Transactions** (`UC_EXTENSIONS.UC_SS_TBH.GBL`) detail, anchored on the PeopleSoft record-field ids `#UC_SS_TRANSACT_UC_TRANSACT_ID` / `#UC_SS_TRANSACT_APPR_STATUS` (there is no role+label anchor), reached by the keyed deep link `?Action=U&UC_TRANSACT_ID=T…`. An unknown id renders the ordinary search form **silently**, so the reader must assert the field resolved *and* that its text equals the requested id.
- **B (pending sweep) → its own typed outcome, not a receipt.** Draft: proof is a re-read showing zero pending `TER` rows for that EID. Legacy returns a count and refuses to collapse a thrown sweep into `0` (**S31**) — that refusal ports.
- **C and D (Kuali) → `save-verify`.** Kuali's save is UI-silent (no toast, no banner), so a **reload read-back** is mandatory and "clicked without error" is never proof — the same arm already built and controlled-commit-proven as `kuali/verify-timekeeper-annotation` (D135). **How many read-backs, and why one-per-node: §4e.**
- **Partial completion** — UCPath receipt obtained, Kuali finalization fails — is **§4c**.

**Open, and legacy cannot answer it:** whether the post-submit confirmation dialog renders the `T…`
inline. Legacy says it **cannot** be read from the dialog and re-navigates
(`legacy:src/workflows/separations/CLAUDE.md:147`), and doc 09 §13 item 6 records that as ported
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
no default (doc 09 §5 / D17) — plus a justified `probeToFenceMaxMs` bounding preparation after the
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
> identity-approval gate result keeps its drafted 4-hour bound because D8/doc 09 §14.7 forbid
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
| Existing-termination probe | **`probeToFenceMaxMs`, not a maxAge** | — | Doc 09 §5 already bounds probe→fence; a second window here would be two answers to one question |
| **Identity-approval gate result** (doc 09 §14.5/§14.7) | **DRAFT: 4 hours** — "hours, not days", and `Infinity` is illegal here | never overridable | §14.7 explicitly leaves this value to this questionnaire. On resume the candidate is re-read: identical digest within limit proceeds, a changed candidate re-opens the gate regardless — which is also what makes **§4d** work on a resumed run |

---

#### RESIDUAL 5A — the four `maxAge` values

**Context.** Legacy has **no** freshness model at all, so there is nothing to port and nothing to
confirm against: these are rebuild-new numbers. What makes them real rather than decorative is doc 02
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
  one Job Summary read); a stale write is neither. The 4-hour gate is exactly doc 09 §14.7's "hours,
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
  Re-asking a question the operator already answered is what produces **rubber-stamping**, which doc 09
  §14.6 names as risk #1 — the dominant failure mode of an always-gate.

**Recommendation: A** — the drafted values, unchanged. They are the only set where the two things that
matter are both true: nothing stale can reach the write, and the gate is not asked twice for one
decision.

`ANSWER (operator), 2026-08-12 — 5A:` **None of the three drafted options. NO automatic freshness
refresh in separations — the Kuali document, UCPath Job Summary, and New Kronos timecard reads all
take the argued-unbounded arm (`maxAgeMs: Infinity`, justified per doc 01/02/07's "`Infinity` must be
argued in a comment" provision); the identity-approval gate result keeps a real bound because D8/
doc 09 §14.5/§14.7 forbid `Infinity` for identity facts categorically.**

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
  doc 09 §14.5/§14.7 and D8 already make `Infinity` illegal for the gate result — it bounds a human
  judgement's shelf life, not a document's staleness, and none of 5A's own three options ever proposed
  `Infinity` for it either. It keeps the drafted **4 hours** ("hours, not days," per §14.7) — the one
  number this re-scoping does not touch.
- **Scope, stated so it is not over-read.** This answer is **separations-only**. A submit-immediately
  workflow — one with no save step between an operator edit and this workflow's read — has no "saved,
  stable artifact" to point to, and sets its own real, bounded windows in its own §b questionnaire.

---

#### RESIDUAL 5B — the override column on the DATE fields

**Context.** Doc 02 §5.5 lets a field be marked `override:"audited"`, which means a stale value can be
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
  confirmation in the freshness dialog (doc 02 §5.5), and it is always durably recorded — the value
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

- **Identity-approval gate: YES, ALWAYS** (doc 09 §14, D77). Every separation, no auto-approve. **Whether any run mode may skip it: §4d (recommendation: never).**
- **Two separation types.** The operator distinguishes **Kuali separations** and **I-9 separations**; doc 09 §14.7 asks whether the I-9 type shows a **different candidate packet**. **No draft — legacy has no I-9-separation branch to derive one from** (I-9 Check was split into its own workflow on 2026-07-17). **Options: §4f1.**
- **Intake:** none. Input is one Kuali document number, typed. No column mapping, no roster, no mobile capture, no manifest (doc 06 is not involved).
- **Instance:** doc 11 §4 per-run test/prod. **No draft** — whether a UCPath or Kuali *test* instance exists for this workflow is operator knowledge. **Options: §4f2.**
- **Department gate (HDH).** Legacy skips the Kronos read for non-HDH departments and does so **fail-safe** — it skips only on a *positive* non-HDH determination, and an unknown department still runs Kronos (**S32/S33**, `legacy:.../workflow.ts:757-788`). Draft: port it, keeping the fail-safe direction, as a branch case rather than a gate. **It is also the one closed proceed-without-timecard arm in §4b.**
- **Future-date preflight.** Legacy refuses a future-dated LDW or separation date ("not yet eligible for separation") (**S7**). Draft: port as a validation refusal.
- **Reason-code default — the one drafted REFUSAL.** Legacy's `mapReasonCode` falls back to **`"Resign - No Reason Given"`** for an unmapped or blank termination type (`legacy:src/workflows/separations/schema.ts:200-223`), and a documented type (`Death`) has no map entry and would land on it. That is a plausible-but-wrong value on a live HR transaction — the exact pattern this tree bans. **Draft: fail loud naming the unmapped type**, and require the map to be extended. **Options, and the dropdown capture that makes the map exhaustive: §4a.**
- **The final-pay radio.** Legacy asserts *Does not need Final Pay (student employee)* unconditionally (**S58**). **No draft — options: §4g.**

**RECORDED ANSWER (2026-08-12), bullet by bullet.**

- **Identity-approval gate:** YES, ALWAYS, in **every** run mode — no preset, prefill or resume path
  can disable it (**§4d**).
- **Two separation types:** does not apply here. **Separations as built does not involve the I-9
  packet** — "i9 and kuali separations is very different" — so there is no I-9 branch and no packet
  variant; doc 09 §14.7's question resolves **out of scope for this migration** (**§4f1**).
- **Intake:** none, as drafted. One typed Kuali document number; doc 06 is not involved.
- **Instance:** an **operator-approved production canary** for the commit proof, target named by the
  operator at doc 07 §3.1 step 5 (**§4f2**).
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
> The §2.2–§2.5 inventory itself is DRAFT STANDS: it is derived from the code, and `STORES.md` §1's
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

*What the answer determines:* the executable scenario corpus (doc 12 §3), which `scenario-coverage`
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
and confirmation (doc 09 §4 recovery) · UCPath filed but Kuali not finalized (**S57/S60** — **§4c**).

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
visibility (doc 02 §3.2). **It also decides the §3 composition question.**

**DRAFT — operator to confirm/correct.**

- **Enqueue:** `reject-active` per document number — two concurrent runs on one separation document is never intended, and doc 09's same-key mutex already refuses the second fence anyway. Note **S5**: legacy's enqueue-supersede only cancels *non-terminal* prior runs, so a completed doc can be re-run with nothing but two live page probes standing between it and a second termination — the permanent key is what makes that durable here.
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
`explain run` answers "what happened?" (doc 12 §2).

**DRAFT — operator to confirm/correct.**

- **`verified`** requires: the gate's `IdentityApprovalResult` with `approvedBy`/`approvedAt`/`evidenceDigest` (doc 09 §14.4, carried onto the receipt per D82) **and** the UCPath receipt pair `(transactionNumber, approvalStatus)` read back from the keyed deep link **and** the Kuali finalization's reload read-back proof.
- **`partial`** is the honest outcome when the termination committed with a receipt but the Kuali finalization did not — the external record is correct, the document is not (**S60**; the resume policy is **§4c**).
- **`unknown` parks.** Post-fence absence, an unreadable receipt, or a disagreeing read-back parks the intent and the run (`parked-write`); only proof-of-presence or an operator-confirmed absence releases it (doc 09 §4.1). A generic retry may not.
- **Redaction:** every evidence leaf needs a declared classification (doc 12 §D140) — an undeclared leaf fails loud. Names and EIDs are the sensitive surface here; screenshots stay `restricted`. **If §2.6 Option A is adopted, the classification tables are wider per task and are authored with the task.**
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
probe policy, and the graph itself. Doc 12 §4.4's **record-sanity-check advisory** (deferred here by
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

## 6. Exit criteria for this migration (doc 07 §3.2)

Repeated here so the checklist is in one place; the master plan owns the normative text.

- [x] **§5 questionnaire answered and recorded above, and every §4 decision answered** — §4a–§4g and all twelve §5 items landed 2026-08-12, including item 5's residuals 5A/5B (the freshness values and the date fields' override column) — `new-kronos/read-separation-timecard` can now be authored against a real `freshness` field
- [ ] `typecheck` + `lint` + `test:coverage` green (D191); the descriptor passes `descriptor-coverage`; every commit contract passes `write-safety-contract` and transaction pairing
- [ ] Every input/output/result/command/detail/evidence parses strict; every UI id, scenario id, and subject observation resolves; no raw Page/Locator/selector outside the system driver
- [ ] **Live dry-run green** against Kuali, UCPath, and New Kronos (submit-free, zero durable write rows asserted) — and, per §4f3, the UCPath preparation interval measured on that run
- [ ] **Controlled-commit evidence** for every commit/probe/verify on an **operator-approved target** — unavailable safe evidence **blocks** rebuild-ready status; a dry-run success is never converted into a write-safety claim
- [ ] `identity-gate-before-separation-commit` green — every commit is graph-reachable only through the gate node (doc 09 §14.6 guard #2; the structural half of §4d)
- [ ] D58 capability dispositions updated for every legacy capability this workflow touches; legacy source and tests preserved
- [ ] Regression scenario + knowledge record for anything the live lane finds; owning docs and the nearest `CLAUDE.md` updated
- [x] **§2.6 confirmed and ratified: D194 recorded in doc 01 §2.8, pointer in doc 04 round 48, `STORES.md` §1 updated** (2026-08-12) — every new read task this migration authors is authored under it

---

## 7. Open items that are NOT for this questionnaire

- **The controlled-commit target.** A UCPath termination and a Kuali finalization the operator approves. None is invented here; naming one is operator work at doc 07 §3.1 step 5 (the *shape* of that choice is §4f2).
- **Two UCPath facts that need one real submit** (doc 09 §13 item 6): whether the confirmation dialog renders the `T…` inline, and the propagation window between submit and searchability. Both are currently **ported legacy knowledge**, not rebuild-verified.
- **`recoveryAbsence` for the UCPath termination.** Until a propagation window is measured, a post-fence absence is `operator-only`; inventing a `minSinceFenceMs` is the banned unverified constant (D128's standing rule).
- **The behavior review's own `unknown — needs live observation` list** (`separations-legacy-behavior.md` §5) — seven items the legacy source cannot answer. Three of them are already routed into decisions above (the Kuali dropdown option list → §4a, whose answer **schedules that capture into the `separations-kuali-read` chunk** as the first instance of §3.2's MAP-EVERYTHING directive; whether an abandoned Kuali draft discards its edits → moot under item 4's draft; whether a "successful" save persisted → settled by §4e). **§4e adds one to the list:** whether the finalization fields all belong to ONE workflow step's section — if not, one save cannot carry them and the node splits, which is a first-live-dry-run finding. The remaining four are live-observation work at build time, not questionnaire answers: whether UCPath auto-redirects for an already-terminated single-record employee (**S22** — the case where the all-terminated guard never runs), the SS Smart HR *search* results-grid scan (live-verified only for the in-progress grid), whether filling the Kuali department first survives the later timekeeper and date writes, and whether `T002173685` has been reversed and student `10833507` ever separated.

---

## 8. Cross-references
| Document | What it owns, relative to this doc |
|---|---|
| `docs/migrations/separations-legacy-behavior.md` | The traced legacy account: the happy path end to end, the **S1–S63 scenario table** (§2), per-scenario detail with source quotations (§3), the eleven dangerous patterns (§4), and the `unknown — needs live observation` list (§5). Every S-number cited above resolves there. |
| `STORES.md` | The derived catalog of what every store has today — §1 "How stores work" (the REUSE/CUSTOMIZE/BUILD rule that §2.6's convention would amend), §2 per-store tables, §3 the two shipped workflows' consumption, §4 the gaps this migration closes. Code wins over that file wherever they disagree. |
| `docs/rebuild/07-master-plan.md` | §3.1 the Phase-3 entry block, §3.2 exit criteria (§6 above), §3.3 the migration order, **§3.4 the questionnaire template §5 above instantiates**. |
| `docs/rebuild/09-write-safety.md` | §2 completion arms, §4/§4.1 recovery and operator resolutions, §5 probe policy, §12 the worked two-transaction separations example, §13 the beat structure, **§14 the ALWAYS-GATE** (and §14.7's two values left to this questionnaire). |
| `docs/rebuild/04-reconciliation.md` | The decision index — **D193** (separations as the Phase-3 entry) and, if §2.6 is confirmed, **D194**. A pointer index only; never implement from it. |

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

---

### 9.2 Chunk 1 — the live proof: **NOT RUN to completion** (14 attempts, 2026-08-12)

**Honest status.** Doc 07 §3.1 step 4 (the live dry-run for this chunk) is **NOT MET**. The
`separations-kronos-timecard` workflow was started against the real system thirteen times through
the real start-plan → command → worker path. **The search half is proved live** — `search` reached
`observed-this-attempt` with a durable checkpoint on runs `sk-123940-ab25`, `sk-125031-54c5`,
`sk-125229-f0c8`, `sk-125512-8fa6` (attempt 1) and `sk-131627-4ca5`. **The timecard half has never
produced a terminal `done`.** No run reached a terminal result, so this chunk has **no evidence
receipt over real data** and the exit criterion stays open.

**What the lane was worth anyway.** Every attempt failed for a DIFFERENT, real reason, and each one
was green on `typecheck`, `lint`, `test:coverage`, `test:architecture` and every scenario. Seven
defects were found and fixed that no fixture could reach; they are recorded in commit
`fix(kronos): six defects the live lane found, and the rules they settle` and, as rules, in doc 01
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
`53336e1c` records `seen 6×`, so this is a recurring class rather than a one-off. Doc 07 §3.1 step 4
for chunk 1 stays **OPEN**, and the next attempt owes the scroll loop rather than another window.

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
| 7 | `Never Started Employment` | *(legacy: involuntary)* | — | **REFUSES** — `unmapped-termination-type`, see below |
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

Doc 07 §3.1 step 4 (the live dry-run for this chunk) is **MET**. Five runs were started through the
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

   **CLOSED 2026-08-12 by D199** (doc 12 §D199). `descriptorFingerprint` is now the run's own
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

Doc 07 §3.1 step 4 for chunk 3 is **MET**. Two runs went through the real start-plan → command →
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
— costs 6.2 s on an already-authenticated session, which is the honest price of doc 09 §14.2's
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
- **~~The receipt cannot yet attribute the approver.~~ CLOSED 2026-08-12 by D204 (doc 12).** The
  settled receipt used to list `node.identity-approval` as **`unknown`**, because a receipt derived
  from checkpoints and a gate has none. `buildRunEvidenceReceipt` now reads `gate_results` beside
  the checkpoints: run `si-161551-774c` re-derives with `node.identity-approval` **`verified`** and a
  `gate/approved` decision reading *"an operator approved this identity at the ALWAYS-GATE: gate
  "identity-approval" was resolved `approved` by local-operator at 2026-08-12T23:16:43.985Z through
  command 4928fee1-…, bound to the identity evidence it was granted on (evidenceDigest fd112d6f…)"*,
  with the approved EID redacted to its `last4`. All five of D199's semantic checks hold on that
  re-derivation. **The two receipts this session minted were dropped from the standing authority
  database and re-derived**, because a receipt stored before D204 cannot re-derive under it and D199
  has no waiver arm — an explicit operator repair on a pre-production database, recorded in doc 12's
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
