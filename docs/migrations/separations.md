# Migration plan — `separations` (order 8, the Phase-3 entry)

> **STATUS: BLOCKED — the §b questionnaire below is unanswered.**
> Doc 07 §3.1 step 1 is explicit: the operator questionnaire is asked and answered **BEFORE**
> building. Nothing in this migration gets built — not a contract, not a task, not a descriptor —
> until §4's open decisions and the twelve §5 `ANSWER (operator):` slots below carry answers. Every
> open decision is presented as options with pros and cons plus a recommendation, and every item ships with a
> `DRAFT — operator to confirm/correct` line derived from the legacy source and the rebuild's owning
> docs, so the work is confirmation rather than composition; where legacy gives **no** basis for a
> draft this doc says so instead of inventing one.

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
| **4** | **Open decisions** — one entry per genuinely open item, each as options + pros/cons + a recommendation |
| **5** | The §b questionnaire (doc 07 §3.4) — twelve items, drafts, and the `ANSWER (operator):` slots |
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
questionnaire by doc 09 §14.7: the **approval freshness limit** (item 5) and whether **I-9
separations** show a different candidate packet than Kuali separations (item 6, §4f1). Also note doc
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

`ANSWER (operator):`

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

`ANSWER (operator):`

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

`ANSWER (operator):`

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

`ANSWER (operator):`

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

`ANSWER (operator):`

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

`ANSWER (operator) — 4f1 / 4f2 / 4f3 / 4f4:`

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

`ANSWER (operator):`

---

## 5. The §b questionnaire (doc 07 §3.4 — twelve items)

Each item keeps its `DRAFT — operator to confirm/correct` line. Where an item is genuinely open, the
options and pros/cons live in **§4** and the item points there rather than repeating them.

### 1. Real commits — which actions mutate the external system?

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

`ANSWER (operator):`

---

### 2. Completion check per submit

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

`ANSWER (operator):`

---

### 3. Double-submit probe policy and age budget per transaction

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

`ANSWER (operator):`

---

### 4. Dry-run preview

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

`ANSWER (operator):`

---

### 5. Freshness maxAges — justify the *value*, not just its presence

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

`ANSWER (operator):`

---

### 6. Workflow-specific gates and data

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

`ANSWER (operator):`

---

### 7. Reuse map — which tasks are reused, which are new

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

`ANSWER (operator):`

---

### 8. Local artifact effects

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

`ANSWER (operator):`

---

### 9. Scenario inventory

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

`ANSWER (operator):`

---

### 10. Delegation and queue policy

*What the answer determines:* enqueue policy, standard actions, and for every child edge the stable
item id, typed result, cardinality/join, child-failure policy, cancel, child retry/parent resume, and
visibility (doc 02 §3.2). **It also decides the §3 composition question.**

**DRAFT — operator to confirm/correct.**

- **Enqueue:** `reject-active` per document number — two concurrent runs on one separation document is never intended, and doc 09's same-key mutex already refuses the second fence anyway. Note **S5**: legacy's enqueue-supersede only cancels *non-terminal* prior runs, so a completed doc can be re-run with nothing but two live page probes standing between it and a second termination — the permanent key is what makes that durable here.
- **Surface shape:** `single`. One document, one person, one row. Multi-document submissions are separate runs (legacy's sequential batch was a daemon convenience, not a graph property — and **S43** shows what its shared page state cost).
- **Delegation to person-lookup:** legacy delegates conditionally on the `different`/short-EID arms (**S17/S18**). **Draft: do NOT delegate — resolve candidates inline and hand them to the ALWAYS-GATE packet.** Under ALWAYS-GATE the operator sees the candidates on *every* run, so the child run buys presentation the gate already owes, at the price of wiring an unwired seam (§3).
- **If the operator wants real sub-workflow composition instead** (§3's "lego" as actual child runs), this item is where that is decided, and this migration then also owns wiring `ChildRunExecutor` through `composeWorkerRuntime` plus the enqueue/join transaction and the fan-out manifest. That is a real slice; it is not free.
- **Resume/retry actions** must respect **§4c** (a partial completion resumes into finalization only) and **§4d** (no resume path may skip the identity gate).

`ANSWER (operator):`

---

### 11. Trust contract

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

`ANSWER (operator):`

---

### 12. Authoring boundary

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

`ANSWER (operator):`

---

## 6. Exit criteria for this migration (doc 07 §3.2)

Repeated here so the checklist is in one place; the master plan owns the normative text.

- [ ] **§5 questionnaire answered and recorded above, and every §4 decision answered** ← the current blocker
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
- **The behavior review's own `unknown — needs live observation` list** (`separations-legacy-behavior.md` §5) — seven items the legacy source cannot answer. Three of them are already routed into decisions above (the Kuali dropdown option list → §4a; whether an abandoned Kuali draft discards its edits → moot under item 4's draft; whether a "successful" save persisted → settled by §4e). The remaining four are live-observation work at build time, not questionnaire answers: whether UCPath auto-redirects for an already-terminated single-record employee (**S22** — the case where the all-terminated guard never runs), the SS Smart HR *search* results-grid scan (live-verified only for the in-progress grid), whether filling the Kuali department first survives the later timekeeper and date writes, and whether `T002173685` has been reversed and student `10833507` ever separated.

---

## 8. Cross-references

| Document | What it owns, relative to this doc |
|---|---|
| `docs/migrations/separations-legacy-behavior.md` | The traced legacy account: the happy path end to end, the **S1–S63 scenario table** (§2), per-scenario detail with source quotations (§3), the eleven dangerous patterns (§4), and the `unknown — needs live observation` list (§5). Every S-number cited above resolves there. |
| `STORES.md` | The derived catalog of what every store has today — §1 "How stores work" (the REUSE/CUSTOMIZE/BUILD rule that §2.6's convention would amend), §2 per-store tables, §3 the two shipped workflows' consumption, §4 the gaps this migration closes. Code wins over that file wherever they disagree. |
| `docs/rebuild/07-master-plan.md` | §3.1 the Phase-3 entry block, §3.2 exit criteria (§6 above), §3.3 the migration order, **§3.4 the questionnaire template §5 above instantiates**. |
| `docs/rebuild/09-write-safety.md` | §2 completion arms, §4/§4.1 recovery and operator resolutions, §5 probe policy, §12 the worked two-transaction separations example, §13 the beat structure, **§14 the ALWAYS-GATE** (and §14.7's two values left to this questionnaire). |
| `docs/rebuild/04-reconciliation.md` | The decision index — **D193** (separations as the Phase-3 entry) and, if §2.6 is confirmed, **D194**. A pointer index only; never implement from it. |

