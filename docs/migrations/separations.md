# Migration plan — `separations` (order 8, the Phase-3 entry)

> **STATUS: BLOCKED — the §b questionnaire below is unanswered.**
> Doc 07 §3.1 step 1 is explicit: the operator questionnaire is asked and answered **BEFORE**
> building. Nothing in this migration gets built — not a contract, not a task, not a descriptor —
> until the twelve `ANSWER (operator):` slots below carry answers. Every item ships with a
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
doc 11 (freshness/instance), doc 12 (evidence/trust), doc 06 (intake).

---

## 1. What this workflow does

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

### The motivating incident, and the gate that answers it

Doc 07 §3.3 puts separations at order 8 because of the **wrong-person termination `T002173685`**. A
graduating student's Kuali doc carried EID `10833507` ("Hernandez, Jose Santos"); UCPath rendered the
name as "Santos Hernandez", the similarity classifier returned `different`, a name search on the
common name resolved a **career** maintenance worker (`10401814`, employed since 2016), and the
override filed a real termination against him (`legacy:src/workflows/separations/CLAUDE.md:44,204`).
A permanent-key fence would have fenced that write perfectly and filed it anyway — the key was
derived from the wrong person.

**Doc 09 §14 ALWAYS-GATE applies to this migration in full.** Manual identity approval on **every**
separation, both separation types, **no auto-approve-on-match** (operator ratification 2026-07-24,
D77). This is a deliberate **widening** of legacy, which gates only on the `different` tier and lets
`same`/`similar` proceed silently. Two values are explicitly left to this questionnaire by doc 09
§14.7: the **approval freshness limit** (item 5) and whether **I-9 separations** show a different
candidate packet than Kuali separations (item 6). Also note doc 09 §14.6 risk #1: an always-gate's
dominant failure is rubber-stamping, which is why the packet leads with **disconfirming** evidence
and why an ambiguous decision must not be dispatchable by the same click as an unambiguous one.

---

## 2. Build strategy — bottom-up chunks, composed like lego (operator directive, 2026-08-12)

Separations is the biggest workflow in the program. The operator's directive is that it is **not**
built as one slice: it is **decomposed bottom-up** into chunks that each stand alone and each get
proved before anything is composed.

**The order is store tasks → per-system sub-workflows → composition.**

1. **Store tasks first.** Every task in §4's inventory is authored against its strict contract with
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

## 3. The §b questionnaire (doc 07 §3.4 — twelve items)

### 1. Real commits — which actions mutate the external system?

*What the answer determines:* every mutating action needs a prepare contract, a commit contract, one
transaction lease scope, a stable idempotency key, an expected subject, a post-prepare semantic
observation, a normalizer/matcher, and mismatch/unknown evidence (doc 09 §2). This is the list the
whole write-safety kernel is instantiated from.

**DRAFT — operator to confirm/correct.** Legacy performs **five** distinct external mutations:

| # | Mutation | System | Draft treatment |
|---|---|---|---|
| A | **Save and Submit the termination transaction** | UCPath Smart HR | A real `commit`. Permanent key `<eid>\|termination\|<terminationEffDate>` (doc 09 §12's worked example uses exactly this shape). Expected subject = the operator-approved EID from the gate; the staged page's Empl ID field is the post-prepare observation |
| B | **Delete pending termination rows** for the EID | UCPath Smart HR | It deletes rows, so it is a mutation and doc 09 §13 item 5 explicitly asks whether it is modeled as a first-class fenced write. **Draft: yes — its own commit contract**, keyed `<eid>\|pending-sweep\|<runId>` and run as a separate transaction node before the create |
| C | **Save the Kuali finalization** (term-eff date, template checkbox, transaction number, final-pay radio, comments) | Kuali | A real `commit` with a `save-verify` completion arm — Kuali's save is UI-silent (D78), so a reload read-back is mandatory. Key `<documentNumber>\|finalization\|<transactionNumber>` |
| D | **Write org data into the Kuali doc** (department, payroll title code, payroll title) and the **timekeeper name** | Kuali | Draft: a **second Kuali transaction node**, not a free-floating write. It is benign and restorable, but it is still a save on a real document and the rebuild has no "small write" category |
| E | **Rewrite the employee NAME on the Kuali doc** on the `similar` tier | Kuali | **Draft: do NOT port.** Legacy does this even in dry-run (`legacy:.../workflow.ts:634-649`), and `KRONOS-SELECTORS.md:83-84` documents that field as read-only. Rewriting an identity field on the source document to make a match succeed is the wrong direction for a wrong-person control |

`ANSWER (operator):`

---

### 2. Completion check per submit

*What the answer determines:* which of doc 09 §2's three completion arms each commit declares —
`receipt`, `save-verify`, or `upload-verify`/argued `unverifiableByPage`. Getting this wrong is how a
"looked submitted" becomes a `done`.

**DRAFT — operator to confirm/correct.**

- **A (UCPath termination) → `receipt`, and the receipt is the PAIR `(transactionNumber, approvalStatus)`, never the number alone.** The 2026-08-04 live probe (D130, doc 09 §13 item 6) proved a **Denied** transaction carries a perfectly well-formed `T…`, and recorded that legacy's own `interpretPostSubmitTxnReadback` tests only `/^T\d{6,}$/` — a real latent defect. The number lives on **SS Smart HR Transactions** (`UC_EXTENSIONS.UC_SS_TBH.GBL`) detail, anchored on the PeopleSoft record-field ids `#UC_SS_TRANSACT_UC_TRANSACT_ID` / `#UC_SS_TRANSACT_APPR_STATUS` (there is no role+label anchor), reached by the keyed deep link `?Action=U&UC_TRANSACT_ID=T…`. An unknown id renders the ordinary search form **silently**, so the reader must assert the field resolved *and* that its text equals the requested id.
- **B (pending sweep) → its own typed outcome, not a receipt.** Draft: proof is a re-read showing zero pending `TER` rows for that EID. Legacy returns a count and refuses to collapse a thrown sweep into `0` — that refusal ports.
- **C and D (Kuali) → `save-verify`.** Kuali's save is UI-silent (no toast, no banner), so a **reload read-back** is mandatory and "clicked without error" is never proof — the same arm already built and controlled-commit-proven as `kuali/verify-timekeeper-annotation` (D135).

**Open, and legacy cannot answer it:** whether the post-submit confirmation dialog renders the `T…`
inline. Legacy says it **cannot** be read from the dialog and re-navigates
(`legacy:src/workflows/separations/CLAUDE.md:147`), and doc 09 §13 item 6 records that as ported
legacy knowledge, **not** rebuild-verified. Settling it needs one real submit.

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
rebuild measurement of that sequence exists yet. Measure it on the first live dry-run and set the
bound from the measurement; do not guess it here.

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
real writes on the Kuali draft during a legacy dry run (`legacy:.../CLAUDE.md:158-189`). A dry run in
this tree leaves no durable external footprint at all.

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
| **Identity-approval gate result** (doc 09 §14.5/§14.7) | **DRAFT: 4 hours** — "hours, not days", and `Infinity` is illegal here | never overridable | §14.7 explicitly leaves this value to this questionnaire. On resume the candidate is re-read: identical digest within limit proceeds, a changed candidate re-opens the gate regardless |

`ANSWER (operator):`

---

### 6. Workflow-specific gates and data

*What the answer determines:* which gates the graph carries, and whether any intake/roster/capture
machinery is involved.

**DRAFT — operator to confirm/correct.**

- **Identity-approval gate: YES, ALWAYS** (doc 09 §14, D77). Every separation, no auto-approve.
- **Two separation types.** The operator distinguishes **Kuali separations** and **I-9 separations**; doc 09 §14.7 asks whether the I-9 type shows a **different candidate packet**. **No draft — legacy has no I-9-separation branch to derive one from** (I-9 Check was split into its own workflow on 2026-07-17). Operator input required.
- **Intake:** none. Input is one Kuali document number, typed. No column mapping, no roster, no mobile capture, no manifest (doc 06 is not involved).
- **Instance:** doc 11 §4 per-run test/prod. **No draft** — whether a UCPath or Kuali *test* instance exists for this workflow is exactly what item 5 of the migration loop needs and it is operator knowledge.
- **Department gate (HDH).** Legacy skips the Kronos read for non-HDH departments and does so **fail-safe** — it skips only on a *positive* non-HDH determination, and an unknown department still runs Kronos (`legacy:.../workflow.ts:757-788`). Draft: port it, keeping the fail-safe direction, as a branch case rather than a gate.
- **Future-date preflight.** Legacy refuses a future-dated LDW or separation date ("not yet eligible for separation"). Draft: port as a validation refusal.
- **Reason-code default — the one drafted REFUSAL.** Legacy's `mapReasonCode` falls back to **`"Resign - No Reason Given"`** for an unmapped or blank termination type (`legacy:src/workflows/separations/schema.ts:200-223`), and a documented type (`Death`) has no map entry and would land on it. That is a plausible-but-wrong value on a live HR transaction — the exact pattern this tree bans. **Draft: fail loud naming the unmapped type**, and require the map to be extended.

`ANSWER (operator):`

---

### 7. Reuse map — which tasks are reused, which are new

*What the answer determines:* the actual §4 inventory below, and for each new task, its
reusable-base design plus the workflow-specific customization (charter §3/§8).

**DRAFT — operator to confirm/correct.** See **§4** for the full table. The shape of the answer:
`ucpath` and `kuali` stores exist with real drivers, login recipes, and UI registries and gain new
task families; **`new-kronos` is a 3-line session declaration with an `"unwired"` driver and zero
tasks** (`src/stores/new-kronos/index.ts`) and is built whole here — that is the largest single piece
of new surface this migration mints, and the main reason it was chosen as the entry. One helper is
already ported and waiting: `src/stores/common/timecard.ts` says in its own header that "the New
Kronos adapter [closes] at order 8", so its `SemanticTimecardDriver` seam is a **reuse**, not a new
design.

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
punch the grid showed.

`ANSWER (operator):`

---

### 9. Scenario inventory

*What the answer determines:* the executable scenario corpus (doc 12 §3), which `scenario-coverage`
audits against the graph. Truly impossible variants must be named as impossible, with the reason.

**DRAFT — operator to confirm/correct.** Legacy handles all of these and each becomes a scenario:

*Timecard:* not found in New Kronos (genuine no-results → fall back to the Kuali LDW) · found but the
timecard will not open (**throws** — must not read as "no punches") · timecard shows a **different**
employee (throws before any punch is read) · timecard opened but no punch rows · read rejected
(`timecardRead=false` → keep Kuali's date verbatim, write no "per Kronos" comment — three real Kuali
docs were wrongly modified before legacy fixed this) · date range spanning a year boundary (resolve
against the applied window; never guess the year).

*Prior state:* approved `TER` inside the 14-day window → reuse the number, skip the create · prior-job
`TER` outside the window → create fresh · unreadable `TER` effective date → **never** reuse · stale
pending termination with a different effective date → swept before the create.

*UCPath write:* Empl ID not recognized (fatal) · LDW override cannot be verified (fatal, never
submits) · submit succeeded but no `T…` parsed (fatal **before** the Kuali finalization) · submit
returned a `T…` with a **Denied** approval status (D130 — the arm legacy does not have) · save-and-
submit timeout with neither banner nor confirmation (refuse to report success).

*Identity:* name tiers `same` / `similar` / `different` · short (<8-digit) EID · valid-format
wrong-person EID · **operator rejects at the gate** (terminalizes `cancelled`, never falls through to
a write) · approval goes stale / the candidate changes under it → re-gate.

*Other:* non-HDH department (skip Kronos) · unknown department (still run Kronos) · future-dated LDW
or separation date · multiple jobs / transfer (pick the effective-dated row at or before the
separation date) · blank job code (fail loud) · department option that matches no Kuali dropdown entry
(fail loud rather than save a blank required field) · crash between fence and confirmation (doc 09 §4
recovery).

**Named as not-in-legacy, needing an operator answer rather than a draft:** rehire (no branch exists —
rehire lives in onboarding), deceased/retiree/LOA as distinct paths (only reason-code entries), and
multi-person-per-run (legacy is one doc = one person; multi-doc runs are **sequential batches**, not
fan-out).

`ANSWER (operator):`

---

### 10. Delegation and queue policy

*What the answer determines:* enqueue policy, standard actions, and for every child edge the stable
item id, typed result, cardinality/join, child-failure policy, cancel, child retry/parent resume, and
visibility (doc 02 §3.2). **It also decides the §2 composition question.**

**DRAFT — operator to confirm/correct.**

- **Enqueue:** `reject-active` per document number — two concurrent runs on one separation document is never intended, and doc 09's same-key mutex already refuses the second fence anyway.
- **Surface shape:** `single`. One document, one person, one row. Multi-document submissions are separate runs (legacy's sequential batch was a daemon convenience, not a graph property).
- **Delegation to person-lookup:** legacy delegates conditionally on the `different`/short-EID arms. **Draft: do NOT delegate — resolve candidates inline and hand them to the ALWAYS-GATE packet.** Under ALWAYS-GATE the operator sees the candidates on *every* run, so the child run buys presentation the gate already owes, at the price of wiring an unwired seam (§2).
- **If the operator wants real sub-workflow composition instead** (§2's "lego" as actual child runs), this item is where that is decided, and this migration then also owns wiring `ChildRunExecutor` through `composeWorkerRuntime` plus the enqueue/join transaction and the fan-out manifest. That is a real slice; it is not free.

`ANSWER (operator):`

---

### 11. Trust contract

*What the answer determines:* what makes each terminal outcome `verified|partial|unknown`, which
artifacts/proofs are required, what is redacted, which failures/notifications fire, and how
`explain run` answers "what happened?" (doc 12 §2).

**DRAFT — operator to confirm/correct.**

- **`verified`** requires: the gate's `IdentityApprovalResult` with `approvedBy`/`approvedAt`/`evidenceDigest` (doc 09 §14.4, carried onto the receipt per D82) **and** the UCPath receipt pair `(transactionNumber, approvalStatus)` read back from the keyed deep link **and** the Kuali finalization's reload read-back proof.
- **`partial`** is the honest outcome when the termination committed with a receipt but the Kuali finalization did not — the external record is correct, the document is not.
- **`unknown` parks.** Post-fence absence, an unreadable receipt, or a disagreeing read-back parks the intent and the run (`parked-write`); only proof-of-presence or an operator-confirmed absence releases it (doc 09 §4.1). A generic retry may not.
- **Redaction:** every evidence leaf needs a declared classification (doc 12 §D140) — an undeclared leaf fails loud. Names and EIDs are the sensitive surface here; screenshots stay `restricted`.
- **Notifications:** the gate opening is the one that matters daily (an open operator gate is already a base trigger), plus run failure, subject mismatch, and unknown write outcome. Triggers carry ids/codes/counts only — never free text — so no captured form contents can leak (D138).
- **`explain run`** must answer, without archaeology: which person was approved and by whom, which candidates were shown, which punch date the write used and which grid it was read from, the exact staged values, the receipt pair, and what the Kuali read-back saw.

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

## 4. Store tasks this migration will mint

**Today's reality (`src/stores/`):** `ucpath`, `crm`, and `kuali` have real drivers, login recipes,
UI registries and tasks. `new-kronos`, `old-kronos`, `onbase`, `servicenow`, `i9`, and `sharepoint`
are session declarations with `declareDriver(…, "unwired")` and **zero** tasks.

### `ucpath` — existing store, new write family

| Task | Effect | New / reuse | Note |
|---|---|---|---|
| `ucpath/search-person-org` | read | **reuse** | Exists (person-lookup). Candidate resolution for the gate packet may reuse it as-is |
| `ucpath/read-job-summary` | read | **new** | Workforce Job Summary: dept, dept id, payroll title code, payroll title, legal name. Must pick the effective-dated row at or before the separation date, on both tabs |
| `ucpath/find-existing-termination` | read | **new** | The doc 09 §12 probe by name. Match on Person ID **exactly** + effective date + `/Terminat/i`; legacy deliberately removed name matching after a real duplicate-name collision |
| `ucpath/read-termination-status` | read | **new** | The approved-reuse check on SS Smart HR, with the 14-day window and "unreadable effdt ⇒ never reuse" |
| `ucpath/clear-pending-terminations` | prepare + **commit** | **new** | The date-agnostic sweep. Deletes rows, so it is a fenced mutation (item 1B / doc 09 §13 item 5) |
| `ucpath/fill-termination` | prepare | **new** | Template → effective date → create → Empl ID → reason code → continue → comments → **Override Last Date Worked** + Last Date Worked, each positively read back |
| `ucpath/submit-termination` | **commit** | **new** | Save and Submit. Timeout with neither banner nor confirmation refuses to report success |
| `ucpath/verify-termination-receipt` | read | **new** | The keyed deep link `?Action=U&UC_TRANSACT_ID=T…`, the record-field anchors, and the **pair** `(transactionNumber, approvalStatus)` |

### `kuali` — existing store, new read + write family

| Task | Effect | New / reuse | Note |
|---|---|---|---|
| `kuali/read-timekeeper-annotation` | read | **reuse (pattern)** | The document-identity proof (level-1 heading = document number) is the reusable half |
| `kuali/save-timekeeper-annotation` · `kuali/verify-timekeeper-annotation` | commit · read | **reuse (pattern)** | The proven `save-verify` shape every Kuali write below copies |
| `kuali/read-separation-document` | read | **new** | The six fields off the RRSS separation form |
| `kuali/fill-separation-org-data` | prepare | **new** | Department (dropdown; code-match tier first, no-match ⇒ throw), payroll title code, payroll title |
| `kuali/fill-timekeeper-tasks` | prepare | **new** | `Request Acknowledged - In Progress` + timekeeper name |
| `kuali/fill-separation-finalization` | prepare | **new** | Term-eff date, `Submitted Termination Template`, `Transaction Number`, final-pay radio, appended comments — the comment fill must read the existing value first and refuse rather than blank it |
| `kuali/save-separation-document` | **commit** | **new** | The navbar Save. Legacy's 3-deep `.or()` fallback chain does **not** port (D122: the anchors resolve to exactly one node each) |
| `kuali/verify-separation-document` | read | **new** | Reload read-back — Kuali's save is UI-silent, so this is mandatory |

### `new-kronos` — the store built whole here

| Piece | New / reuse | Note |
|---|---|---|
| Driver + UI registry + page states | **new** | Replaces `declareDriver("new-kronos", "unwired")`. Search runs in either a `portal-frame-*` iframe or top-level — both contexts are probed |
| Login recipe + session verifier | **new** | Must prove **two** independent facts (a server-issued session artifact and the absence of every sign-in form) — a URL is never the conclusion (D120) |
| `new-kronos/search-employee` | **new** | Both-context polling; a found signal beats the no-results sentinel |
| `new-kronos/open-timecard` | **new** | Go To must be visible **and** enabled; failure throws (never "no punches") |
| `new-kronos/verify-timecard-subject` | **new** | Exact match on the employee-id element only — page-wide text is forbidden. This is the wrong-person control on the read side |
| `new-kronos/set-timecard-range` | **new** | Dual-mode date inputs; verify by calendar date and fail loud rather than apply a wrong window |
| `new-kronos/read-separation-timecard` | **new** | Last punch date, sick dates, holiday dates. Year resolved against the applied window, never against "now" |
| `SemanticTimecardDriver` seam | **reuse** | `src/stores/common/timecard.ts` — already ported with provenance and written for this exact milestone |

### Pure workflow mini-store (`separations`, `sessions: []`, `effect: "read"`)

Date reconciliation (LDW / separation date / effective date `+1`), voluntary-vs-involuntary
classification, reason-code mapping (**fail loud on unmapped**, per item 6), the comment builders, the
Kronos window computation, and the name-similarity classification feeding the gate packet. All pure
compute, all unit-testable with `fakeCtx`, none of it touching a browser.

---

## 5. Exit criteria for this migration (doc 07 §3.2)

Repeated here so the checklist is in one place; the master plan owns the normative text.

- [ ] **§b questionnaire answered and recorded above** ← the current blocker
- [ ] `typecheck` + `lint` + `test:coverage` green (D191); the descriptor passes `descriptor-coverage`; every commit contract passes `write-safety-contract` and transaction pairing
- [ ] Every input/output/result/command/detail/evidence parses strict; every UI id, scenario id, and subject observation resolves; no raw Page/Locator/selector outside the system driver
- [ ] **Live dry-run green** against Kuali, UCPath, and New Kronos (submit-free, zero durable write rows asserted)
- [ ] **Controlled-commit evidence** for every commit/probe/verify on an **operator-approved target** — unavailable safe evidence **blocks** rebuild-ready status; a dry-run success is never converted into a write-safety claim
- [ ] `identity-gate-before-separation-commit` green — every commit is graph-reachable only through the gate node (doc 09 §14.6 guard #2)
- [ ] D58 capability dispositions updated for every legacy capability this workflow touches; legacy source and tests preserved
- [ ] Regression scenario + knowledge record for anything the live lane finds; owning docs and the nearest `CLAUDE.md` updated

---

## 6. Open items that are NOT for this questionnaire

- **The controlled-commit target.** A UCPath termination and a Kuali finalization the operator approves. None is invented here; naming one is operator work at doc 07 §3.1 step 5.
- **Two UCPath facts that need one real submit** (doc 09 §13 item 6): whether the confirmation dialog renders the `T…` inline, and the propagation window between submit and searchability. Both are currently **ported legacy knowledge**, not rebuild-verified.
- **`recoveryAbsence` for the UCPath termination.** Until a propagation window is measured, a post-fence absence is `operator-only`; inventing a `minSinceFenceMs` is the banned unverified constant (D128's standing rule).
