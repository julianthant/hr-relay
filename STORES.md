# Store Catalog — Reuse Reference

> **This is a derived convenience view, not a source of truth.** The plan SSOT is
> `docs/rebuild/07-master-plan.md` (migration order, exit criteria) and the owning docs 00–13; the
> decision changelog is `docs/rebuild/04-reconciliation.md`. **Code is the source of truth for every
> fact in this file** — if this file ever disagrees with `src/stores/**`, `src/services/**`, or
> `src/infra/providers/**`, the code wins. Regenerate at every slice boundary, and whenever a store
> gains, loses, or rewires a task.
>
> **Last updated:** 2026-08-12

**Why this file exists.** Phase 3 migrates 13 more legacy workflows onto stores that already exist
in this tree. The single most expensive mistake a migration can make is re-implementing a task a
store already has, or worse, minting a second driver declaration beside one that already exists.
Before writing any new task: **read this file, find the store, and decide REUSE / CUSTOMIZE / BUILD**
— never guess.

---

## 1 · How stores work

A **store** is the per-system module that owns three things together: the semantic driver
declaration (`BROWSER_STORES` entries) or nothing at all (service stores), the login recipe (browser
stores only, in `session.ts`), and the task implementations bound to that exact driver. `src/base/
store.ts` is the factory layer — `defineBrowserStore`, `defineServiceStore`, and
`defineWorkflowStore` are the only three ways a store may come into existence, and each is validated
at call time:

- **Browser stores** (`defineBrowserStore(namespace, driver, session, tasks)`) require every task's
  contract id to start with `${namespace}/`, require every task's `driver` to be the store's **exact**
  declaration object (`task.driver !== driver` throws — a second declaration for the same system is
  structurally impossible, not just discouraged), and enforce `onbase`'s unique
  `session.exclusive: true` requirement (the only identity-exclusive session in the tree).
- **Service stores** (`defineServiceStore(namespace, tasks)`) and **workflow mini-stores**
  (`defineWorkflowStore(workflowId, tasks)`) require every task to be a sessionless `effect: "read"`
  task (`sessions: []`); a mini-store task additionally may declare no `artifacts`/`providers`.
- Every store lands in `src/stores/index.ts`'s `BROWSER_STORES` (the 9 browser systems) and
  `TASK_STORES` (browser stores plus the service/workflow mini-stores), and `defineTaskStoreRegistry`
  cross-checks every registered task against the contract corpus in both directions — a store task
  with no corpus entry, or a corpus entry with no store task, fails to boot.

**Two task shapes**, both from `src/base/task.ts`'s `defineTask`:

- **Browser task** — `defineTask(driver, contract, impl)`. `driver` must be the store's
  `DriverDeclaration<ConcreteDriver>` (e.g. `ucpathDriver`, `crmDriver`, `kualiDriver`); `impl.sessions`
  names which system(s) it needs at `read` or `transaction` access, always `session: "reuse-worker"`.
  A commit-effect task additionally receives `ctx.mutation`, which only exists inside a fenced write
  the write sequencer (`src/core/write-sequencer.ts`) has minted — nothing else can construct one.
- **Service/workflow task** — `defineTask(contract, impl)`. No driver, `sessions: []` (or the
  mini-store's forced-empty session list); reaches remote I/O only through `ctx.providers[capability]`,
  never a raw `fetch`.

**Two driver declaration shapes**, both from `src/base/task.ts`:

- `declareDriverFor<ConcreteDriverInterface>()(system, "semantic-ready")` — a real typed driver over a
  domain-owned interface (e.g. `UcpathPersonOrgDriver` in `src/domain/ui/ucpath-person-org.ts`). Raw
  Playwright access stays under `driver/`; only the task-safe declaration in `declaration.ts` (or
  `driver-declaration.ts` for ucpath) is reachable from task code.
- `declareDriver(system, "unwired")` — an empty placeholder for a store with no semantic operations
  yet. A store on this declaration has zero tasks by construction (`validateStoreTasks` refuses a
  driver-bound task registered against a store whose `driver === undefined`, and the browser-store
  path further requires `task.driver === driver`, so a real task cannot attach to an unwired
  declaration at all).

**Workflows never contain selectors.** A descriptor (`src/workflows/<id>/descriptor.ts`) references
only task **contracts** — bundle-safe, zod-schema-only. The server composition value
(`src/workflows/<id>/module.ts`) is what imports concrete stores, and `src/control/workflow-registry.ts`
audits at load time that every contract a descriptor uses resolves through one of that module's own
factory-defined stores, and that no listed store goes unused (`auditWorkflowModuleBindings`).

**The reuse rule.** Before adding a task:

1. Find the store below. If the exact operation already exists as a task, **REUSE** it — call it from
   the new workflow's descriptor, do not re-implement.
2. If the store exists and is `semantic-ready` but lacks this one operation, **CUSTOMIZE**: add a
   sibling task file under `stores/<system>/tasks/`, bound to the store's existing driver declaration
   — importing it, never re-declaring it (`declareDriverFor` is called exactly once per store, at
   `declaration.ts`/`driver-declaration.ts`).
3. If the store is `unwired` (see §4, Gaps), **BUILD**: this is a genuine new-store slice — a domain
   driver interface, a `driver/interpreter.ts`, a `session.ts` login recipe, a `system-bindings.ts`
   entry, live selector verification, and only then tasks. Check §4 for which migration order owns it
   before starting.

**The extraction-width rule (D194, 2026-08-12 — normative text in doc 01 §2.8).** Once you know
which store you are in, this decides how wide the new read task is:

- **A read task's identity is a PAGE VISIT, not a caller's field list.** One task navigates to one
  page (or proves one page state) and returns the **full useful surface** that page carries — not
  only the fields today's first consumer needs. Two genuinely different page visits stay two tasks.
- **The output schema is FIXED and strict, never a function of a runtime argument.** `read(fields…)`
  is banned: a contract has one output schema and one schema hash, and runs, checkpoints, terminal
  results and evidence receipts all bind that hash (D110/D114/D82).
- **Consumers project, they never re-scrape.** A later workflow wanting one more field from that page
  writes a `bind` (or a pure mini-store fold), not a new driver operation. That is the whole point of
  the convention: extraction code is written once per page, ever.
- **Two obligations come with the width**, both one-time and both already proven in this tree: an
  explicit `{state:"absent", reason}` arm for every field that can legitimately be blank (provenance
  is validated to cover *every* canonical output leaf on every run, so a rich field with no absent arm
  can fail a workflow that never needed it), and a declared redaction classification per leaf (doc 12
  §D140 — an undeclared leaf fails loud).
- **Scope:** all **new** tasks from 2026-08-12, and every task a migration authors from order 8
  (separations) onward. **Existing tasks are not rewritten on the strength of this decision** — a
  store merges its duplicate extractions when it is next touched for other reasons, because
  re-authoring a shipped output schema moves a hash that existing run records already bind.
- **The first known merge target is `crm`.** `crm/read-onboarding-record` and
  `crm/read-onboarding-dates` are not two pages: they share the identical search, drill-in and
  `/hr/ONB_ViewOnboarding` record page, and that shared page already reads `First Day of Service` —
  the *record* task holds it and drops it from its output, and the *dates* task re-runs the whole
  search and drill-in to read the same cell again. Under D194 they merge into one record-page task
  with `startsOn` folded downstream. The CRM **history** page (`/hr/ONB_ShowOnboardingHistory`) is a
  second visit and stays its own task either way.

---

## 2 · Per-store catalog

### `ucpath` — browser store, real

**Status:** driver `semantic-ready` (`UcpathStoreDriver`, `src/domain/ui/ucpath-driver.ts` — the ONE
declaration joining the Person Org half and the Smart HR termination half, D206) · real login recipe
(`ucpathLoginRecipe`, `src/stores/ucpath/session.ts`) · **10 tasks**, of which **2 are commits**.
Wired into `BROWSER_SYSTEM_BINDINGS` (`src/infra/browser/system-bindings.ts`), so a real session can
be opened.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `searchPersonOrgTask` | task | `ucpath/search-person-org` (read) | Searches UCPath's Person Organizational Summary by EID or name, expands `View All`, drills into every plausible record, and returns candidate results plus one resolved selection (employee status, HDH flag). | `sessions: [{system:"ucpath", access:"read"}]`, retries `{attempts:2, backoffMs:2000}` on transient. Ported from legacy `793abe1f…`, live-verified 2026-08-02. Handles the **Person Org** screen family only — `ui-registry.ts` also carries the SS Smart HR **receipt** screen family (live-verified 2026-08-04) but no task reads it yet (see §4). |

| `readJobSummaryTask` | task | `ucpath/read-job-summary` (read) | D194's rich read of the SAME page family: opens the Person Org **detail** page for a person the run already names, proves the displayed EID equals the requested one, and returns the WHOLE *Employment Instances* grid — every row's empl record, verbatim HR status, business unit, effective dates, department, job code, title, FTE, empl class — plus the page-displayed name, the row count, and the render context (`auto-detail` vs `drilled-from-grid`; grid already-complete vs expanded). | `sessions: [{system:"ucpath", access:"read"}]`, retries `{attempts:2, backoffMs:2000}`. **Classifies nothing** — "all terminated", "already separated", "two concurrent jobs" are a pure fold in `src/domain/separations/job-summary-classification.ts` (D201). Subject-bound `before-subject-read` on `ucpath.person-org.displayed-eid`, unlike `search-person-org` whose subject is `none` because the search IS the resolution. Live-verified 2026-08-12. |

| `matchExistingTerminationTask` | task | `ucpath/match-existing-termination` (read) | Doc 09 §5's idempotency probe and chunk 4's **S44** read: EID-filtered SS Smart HR search plus one detail visit per candidate row, folded to a four-state `ProbeVerdict` on EID + effective date. | Freshness 0 (`forbidden`). Subject binds the **name**, not the EID — the EID is the run's own filter echoed back. An unreadable scan is `unknown`, NEVER `absent` (D5/D6). Live-verified 2026-08-14. |
| `matchPendingTerminationsTask` | task | `ucpath/match-pending-terminations` (read) | Doc 09 §5's **second** probe kind, over the SAME rich read: does this person have ANY in-progress termination? `present` means there is nothing to sweep. | Shares `scanTerminationTransactions` with the probe above — one page read, two folds (D194/D201/D206). |
| `stageTerminationTask` | task | `ucpath/stage-termination` (prepare) | Stages the WHOLE three-page Smart HR wizard: template + transaction date, Empl ID + record + effective date + reason, Job Data + LDW override + both comment fields — and reads every one back. | Persists nothing: the wizard has ZERO durable footprint before an explicit Save (live 2026-08-13, re-confirmed 2026-08-14). Refuses `emplid-not-recognized` (S48) and `last-date-worked-not-verified` (S49) pre-fence. |
| `createTerminationTask` | task | `ucpath/create-termination` (**commit**) | Clicks `Save and Submit` — ALONE — then re-reads its own receipt PAIR. | Permanent key EID + effective date. `recoveryAbsence: operator-only` (no measured propagation window). An unreadable post-submit read THROWS, so S51/S52 park. |
| `verifyTerminationTask` | task | `ucpath/verify-termination` (read) | Beat ⑥'s independent re-read — the only thing that may settle the run `done`. | Anything other than `present` parks. `present` requires the `T…` AND its approval status: a Denied transaction carries a well-formed number. |
| `stagePendingTerminationSweepTask` | task | `ucpath/stage-pending-termination-sweep` (prepare) | Ticks the Select checkbox on every in-progress `Terminat*` row for this person, reads back what it ticked. | A settled row is never selected — only `Pending`/`Pushed Back` are in progress. |
| `deletePendingTerminationsTask` | task | `ucpath/delete-pending-terminations` (**commit**) | Clicks `Delete Selected Transactions` (`input#HR_TBH_WRK_DELETE_BTN`). | Its own transaction, composed BEFORE the filing, with its own key (the person alone). Legacy runs this same delete as the run's FIRST mutation with no fence at all (S30/S31). |
| `verifyPendingTerminationsClearedTask` | task | `ucpath/verify-pending-terminations-cleared` (read) | The post-delete re-read: the grid shows no in-progress termination rows. | "We could not check" and "the rows are gone" are never merged. |

**Driver notes.** `driver/person-org-operation.ts` owns navigation/search/grid/drill-in/assignment
selection; locator recipes live only in `driver/ui-registry.ts` and require matching fixture plus
live-read-only evidence before use. **One extraction, two parses (D201):** `extractDetail` returns the
grid's raw cells, and each consumer parses them with its own strictness — the search keeps its exact
preferred-assignment derivation (which refuses a blank department, because a CANDIDATE without one is
unusable), while the job-summary read gives that same cell an `{state:"absent", reason}` arm (S24).
Widening the search's own output instead would have moved a schema hash shipped run records bind. Login verifies `PS_TOKEN` presence plus absence of every sign-in
form (2026-08-03 finding: a URL substring alone previously matched the *public* portal).

---

### `crm` — browser store, real

**Status:** driver `semantic-ready` (`CrmOnboardingDriver`, `src/domain/ui/crm-onboarding.ts`) · real
login recipe (`crmLoginRecipe`, `src/stores/crm/session.ts`) · **2 tasks**. Wired into
`BROWSER_SYSTEM_BINDINGS`.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `readOnboardingRecordTask` | task | `crm/read-onboarding-record` (read) | Fuzzy-searches ACT CRM onboarding by EID, opens every plausible record, and accepts only an exact displayed `UCPath Employee ID`; returns `found`/`not-found` plus a subject binding. | `sessions:[{crm, read}]`, retry `{2, 2000ms}` transient. Fails `subject-mismatch` (not absence) if the binding or output EID disagrees with the input — this is the pattern every other read task in the tree copies. Ported legacy `793abe1f…` `onboarding-records.ts`, live-verified 2026-08-02. |
| `readOnboardingDatesTask` | task | `crm/read-onboarding-dates` (read) | Reads `invitedOn` (Offer Letter Sent history transition), `startsOn` (First Day of Service), `completedOn` (Completed history transition) for an EID. | Same binding discipline as above. Blank dates are only reported as absence **after** the record's displayed EID and page state are proven — a malformed nonblank date throws rather than going blank. `Date Signed` is deliberately not `completedOn`. |

**Driver notes.** Login realm defaults to Business Systems in TritON's picker — the recipe waits for
the SSO form, matches by option **value** (not label; the same `#ssousername` field wears three
different labels per realm), and refuses to submit unless Active Directory is confirmed
(2026-08-03 finding). Cold live login ~11.8s.

**Pending under D194 (§1's extraction-width rule):** these two tasks share one page visit and
duplicate the `First Day of Service` read. They merge into one record-page task the next time this
store is touched for other reasons — not before; the merge moves an output schema hash.

---

### `kuali` — browser store, real (Phase 2's transaction proof + separations' document read)

**Status:** driver `semantic-ready` (`KualiRrssDocumentDriver`, `src/domain/ui/kuali-rrss-document.ts`)
· real login recipe (`kualiLoginRecipe`, `src/stores/kuali/session.ts`) · **5 tasks**, including the
tree's **only** `effect:"commit"` contract. Wired into `BROWSER_SYSTEM_BINDINGS`.

This is the tree's first **CUSTOMIZE** of a semantic-ready store (§1 step 2), and the shape it
settled is normative (D197): separations chunk 2 added a read family as **sibling tasks on the SAME
driver declaration**, extending `KualiRrssDocumentDriver` with one operation rather than minting a
second declaration — which `defineTask(driver, …)` would refuse anyway. The read's much wider schemas
live in their own module (`src/domain/ui/kuali-separation-document.ts`); the declaration does not.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `readTimekeeperAnnotationTask` | task | `kuali/read-timekeeper-annotation` (read) | Beat ① pre-fence probe: opens the document fresh and checks whether it already carries this exact `Timekeeper Name` value (idempotency). | `sessions:[{kuali, read}]`. Re-opens the document rather than trusting page state; a wrong-EID read is `subject-mismatch`, never absence. |
| `verifyTimekeeperAnnotationTask` | task | `kuali/verify-timekeeper-annotation` (read) | Beat ⑥ **the only landing proof**: reloads the retained page and reads the field back after `save` returns. | Kuali's save is UI-silent and its HTTP `200`/`Form saved` is a **proven false positive** (measured live 2026-08-04) — never reintroduce banner-based success detection. Anything but `present` parks the run. |
| `fillTimekeeperAnnotationTask` | task | `kuali/fill-timekeeper-annotation` (**prepare**) | Beat ②: opens the document, stages the value via the driver, proves the field read it back. Zero save — closing here leaves Kuali byte-identical (the dry-run stop point). | `sessions:[{kuali, transaction}]`. The EID check here is defence-in-depth only; the load-bearing subject binding is the kernel's own beat-③ re-observation on this same page. |
| `readSeparationDocumentTask` | task | `kuali/read-separation-document` (read) | **ONE visit to the RRSS separation form, returning the WHOLE form** (D194): employee identity, both separation dates raw AND parsed, the termination type verbatim, location, division, employee type, student title code, the Timekeeper Tasks and Final Transactions sections, the Final Pay group, and every dropdown's COMPLETE option list. | `sessions:[{kuali, read}]`. Subject is the **DOCUMENT** (`artifact`/`document-id`), not the person — the run names a document and DISCOVERS the EID. Six distinct error codes; S2 is refused BY NAME off the page title before a field is read. Strictly read-only: no fill, no save, no draft (S61 is legacy's defect). |
| `saveTimekeeperAnnotationTask` | task | `kuali/save-timekeeper-annotation` (**commit**) | Beat ⑤: the tree's one external write. Clicks `Save` via `ctx.driver.commit(KUALI_RRSS_SAVE_BUTTON, ctx.mutation)`. | `sessions:[{kuali, transaction}]`. `ctx.mutation` only exists inside a fence the write sequencer minted — this task cannot fire outside it even if mis-authored. Reports only that it clicked, **never** that the save landed; beat ⑥ is the proof. |

**Driver notes.** The commit contract's own schema names its `verify`/`probe` task ids
(`kuali/verify-timekeeper-annotation`, `kuali/read-timekeeper-annotation`) so the write sequencer can
invoke them without the workflow wiring a fourth binding. `Send Back` and `Mark Complete` — the
buttons that actually advance a real separation — are **not addressable through this store at all**
(see §4, kuali separation family). Live-proven end-to-end 2026-08-04 on real doc 4489: fence → click →
reload read-back → settle in 16.45s, idempotent re-run 2ms with no browser. The read family was
live-proven 2026-08-12 on real documents 4510 / 4502 / 4495 — five runs, all terminal `done` on
attempt 1, three with verified receipts (`docs/migrations/separations.md` §9.4).

---

### `onbase` — browser store, declaration-only

**Status:** driver `unwired` (`declareDriver("onbase", "unwired")`) · session provider is a
`defineWorkerSessionProvider("onbase", {exclusive:true})` **stub** — its `login` call would dispatch
to `handle.authenticate("onbase", …)`, but `onbase` has no entry in
`src/infra/browser/system-bindings.ts`'s `BROWSER_SYSTEM_BINDINGS`, so opening a real session fails
loud today rather than opening an unusable browser · **0 tasks**.

No table — nothing is bound. **Structurally distinctive:** `onbase` is the only system where
`defineBrowserStore`/`defineSessionProvider` *require* `exclusive: true` — a live identity-exclusive
session — so whoever builds this store must design that exclusivity into the login recipe from the
start, not retrofit it. See §4 for migration order.

### `servicenow` — browser store, declaration-only

**Status:** driver `unwired` · session provider stub, no `system-bindings.ts` entry · **0 tasks**. See §4.

### `i9` — browser store, declaration-only

**Status:** driver `unwired` · session provider stub, no `system-bindings.ts` entry · **0 tasks**. See §4.

### `new-kronos` — browser store, real

**Status:** driver `semantic-ready` (`NewKronosTimecardDriver`,
`src/domain/ui/new-kronos-timecard.ts`) · real login recipe (`newKronosLoginRecipe`,
`src/stores/new-kronos/session.ts`) · `system-bindings.ts` entry · **2 tasks**. Wired into
`separations-kronos-timecard` (separations chunk 1). Selectors and login live-verified read-only
**2026-08-12**; the full observation record is `docs/migrations/separations.md` §9.1 and the store's
own `CLAUDE.md`. **The end-to-end live dry-run is NOT met** — §9.2 records all thirteen attempts,
the seven defects they found, and the one test-pinned fix still awaiting a live run.

**Structurally read-only.** No `commit` operation, no `MutationCapability` in its import graph, and
`auditNewKronosUiRegistry` refuses an `external-commit` element by name. A write slice adds the
capability deliberately; it cannot be inherited.

| Task | Effect | Page visit | Output width (D194) |
|---|---|---|---|
| `new-kronos/search-employee` | read | the Employee Search results panel | WFD's own `Total [N]`, EVERY rendered candidate as `{displayName, employeeId}`, the matched row, `Selected [N]`, and which of the two render contexts served the panel |
| `new-kronos/read-separation-timecard` | read | the Timecard | the subject the page displays (EID + name), the window it is PROVED to be showing, and the whole grid — last punch, every punch day, sick and holiday days, every raw pay-code row, the pay codes the classifier did not recognise, plus the header row and scroll/coverage counters |

**REUSE notes for the next migration that touches this store.**

- `kronos-pay-rule` (order 6) wants the **People** page, which is a THIRD page visit
  (`Go To → People`, `managePeople`) and therefore a third task — not a widening of either of these.
  The Go To menu's complete option list is already mapped (`Timecard`, `Schedule`, `People`,
  `Reports`), and `goToMenu.peopleItem()` is still a `candidate` row in the port map.
- Anything that wants MORE from the timecard page — hours, the Amount column, the Absence column,
  the schedule — is already there: `payCodeDays` carries the raw cells and `columnHeaders` records
  what the grid offered. **Project it downstream; do not add a driver operation.**
- `common/timecard.ts`'s `SemanticTimecardDriver` is **not** bound by this store. That helper is
  built around the pay-period SWITCH (current → previous) and its `readLastDate` returns one date;
  the separations read applies an explicit window and needs the full grid, so binding it would have
  meant two ways to read one page. It stays available for `old-kronos` (order 2) and for any
  pay-period-relative read.
- The whole legacy moment-picker calendar path is deliberately unported: real keystrokes stick where
  `fill()` does not, so a future range-setting need should reuse `setRangeField`'s shape rather than
  re-porting the calendar.

### `old-kronos` — browser store, declaration-only

**Status:** driver `unwired` · session provider stub, no `system-bindings.ts` entry · **0 tasks**. Same
`common/timecard.ts` helper applies. See §4.

### `sharepoint` — browser store, declaration-only

**Status:** driver `unwired` · session provider stub, no `system-bindings.ts` entry · **0 tasks**. See §4.

---

### `common` — shared modules (not a registered store)

Not a `TASK_STORES` entry; these are plain modules imported by real task implementations so a parser
or a semantic helper has exactly one copy.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `spreadsheet-grid.ts` (`parseSpreadsheetGrid`, `readArtifactBytes`) | shared module | n/a | The one "artifact bytes → canonical string grid" edge: xlsx via `read-excel-file`, csv via `csv-parse`, refusals returned as `{state:"refused"}` data. Date cells are canonicalized to UTC ISO here, once. | Consumed verbatim by `extraction/extract-spreadsheet` and `roster/match-spreadsheet` — **any future spreadsheet-consuming task must reuse this**, not fork a parser; the date-cell UTC rule is exactly what the 2026-07-13 corruption class was about. |
| `timecard.ts` (`TimecardDriver` type, `runTimecardCheck`-equivalent operations) | shared module | n/a | Page-free semantic timecard-check operations (period navigation/switch comparison) ported from legacy `793abe1f…` `src/services/timecard/index.ts` (blob `91c5b930…`), with four fail-loud corrections over the legacy port (no raw `Page`, no `waitForTimeout`, navigation failure throws instead of returning `false`, switch success is an asserted before/after comparison). | **Not yet consumed** — both Kronos stores are still `unwired` (0 tasks), so this module has no caller today. It exists precisely so migration order 2 (old-kronos-reports) and order 6 (kronos-pay-rule) bind their concrete drivers' page operations to THIS helper's period logic rather than re-deriving it. |

---

### `extraction` — service store, real

**Status:** headless (`defineServiceStore`), sessionless, **2 tasks**.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `extractSpreadsheetTask` | task | `extraction/extract-spreadsheet` (read) | Parses an artifact via `common/spreadsheet-grid.ts`, ranks header-row candidates, detects columns + types, returns the full row grid. | Sessionless, deterministic; `headerRowIndex` explicit selection is honoured exactly or refused, never clamped. The one place in the tree that knows which spreadsheet format a file is — nothing downstream branches on an extension. |
| `extractPdfPagesTask` | task | `extraction/extract-pdf-pages` (read) | Rasterizes PDF pages to PNG artifacts via `pdf-to-img` (pdfjs, MIT) at 2× scale, with the JBIG2 wasm decoder wired for bilevel scanner output. | Sessionless. Every call gets a fresh `Uint8Array` copy because pdfjs **detaches** the input buffer — a retry over the same buffer would throw `DataCloneError`. Page range past the document end is refused, never clamped. |

### `normalization` — service store, real

**Status:** headless, sessionless, **1 task**.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `readContactAdviceTask` | task | `normalization/read-contact-advice` (read) | Deterministic contact/address normalization rules (phone digits, US state/ZIP, country alias, relationship canonicalization), plus opt-in geocode advice (Census → Nominatim fallback) and opt-in AI advisory (D178) for fields the rules leave `ambiguous`. | Sessionless; reaches remote I/O only through `ctx.providers["geocode.census"|"geocode.nominatim"|"ai.advisory"]`. `geocode`/`ai` are caller-declared flags — nothing here applies anything, it is advice for a review gate. `relationship` is classified `sensitive-hr` and is **never** sent to the AI provider even when ambiguous (the one field legacy's LLM fallback existed for is the one this arm withholds). |

### `ocr` — service store, real

**Status:** headless, sessionless, **1 task**.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `extractFormPageTask` | task | `ocr/extract-form-page` (read) | Builds the same extraction instruction a human/CLI operator would get, sends it to the admitted `ocr.extract` provider, and runs the answer through the SAME `admitOcrExtraction` gate every route uses. | Sessionless; a peer of the `rebuild:cli ocr` routes, not a privileged path. A model answering a different field set than the form declares fails admission (`incomplete-extraction`) with the gate's own problem list — nothing here repairs a partial answer. |

### `roster` — service store, real

**Status:** headless, sessionless, **1 task**.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `matchSpreadsheetTask` | task | `roster/match-spreadsheet` (read) | Parses a roster via `common/spreadsheet-grid.ts`, proves the operator's column mapping still fits the file (header fingerprint match), coerces bound cells through the canonical field registry, and matches subjects by EID/name. | Sessionless, pure. A moved/missing layout fails loud `mapping-mismatch` naming what changed; a cell that fails canonical coercion nulls **that fact on that row only** — never the whole row, never a fabricated EID. |

### `person-lookup` — workflow mini-store, real

**Status:** `defineWorkflowStore("person-lookup", …)`, sessionless, **1 task**. Namespace is
`workflow:person-lookup` — this pattern (a pure, sessionless, artifact/provider-free fold over prior
node outputs) is what a future workflow-specific derivation step should copy rather than reaching for
a service store.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `readActiveStatusTask` | task | `workflow:person-lookup/read-active-status` (read) | Pure fold: combines the UCPath selection, the CRM cross-verify record, and the `keepNonHdh` flag into `active`/`inactive`/`undetermined` with a stated reason. | `replay:"always-rerun"` at the descriptor — re-running a pure fold on resume is strictly safer than replaying a checkpoint whose deriving code may have changed. Throws `inconsistent-inputs` if the UCPath and CRM EIDs disagree. |

---

### `separations` — workflow mini-store, real

**Status:** `defineWorkflowStore("separations", …)`, sessionless, **1 task**. Namespace is
`workflow:separations`. Same shape as `person-lookup`: a pure, artifact/provider-free fold over prior
node outputs, with no browser anywhere in its import graph.

| Item | Kind | Contract id | What it does | Reuse notes |
|---|---|---|---|---|
| `matchTerminationTypeTask` | task | `workflow:separations/match-termination-type` (read) | §4a's refusal, executed: exact-match the Kuali termination type against the live-captured map, returning `{classification, template, reasonCode}` or failing with one of four distinct codes. | `replay:"checkpoint"`. It checks the OPTION LIST first — a republished control makes every answer suspect, including the ones that still match. There is no substring tier and no default arm; the map lives in `src/domain/separations/termination-type.ts`. |

The migration doc's §2.5 sketches this mini-store as also owning date reconciliation, the comment
builders, the Kronos window computation and the name-similarity classification. Those land with the
chunks that need them; the termination-type resolution came first because §4a's refusal has to exist
before anything can consume a separation document.

---

### `src/infra/providers` — provider adapters (not a `TASK_STORES` entry)

Provider adapters are not registered in `src/stores/index.ts`; they are composed directly into
`RunProviderWiring` at `src/server/worker/compose.ts` and reached by tasks only through
`ctx.providers[capability]`.

| Item | Kind | Capability id | What it does | Reuse notes |
|---|---|---|---|---|
| `createGeminiOcrExtractAdapter` (`gemini-ocr-extract.ts`) | provider adapter | `ocr.extract` | Production Gemini adapter: resolves page bytes from the content-addressed store by full `ArtifactRef`, sends inline base64, stamps only facts it truly knows (`formType`/`source`/`readAt`/`sourceSha256`/`sourcePage`), passes `pageKind`/`record` through verbatim. | **Wired** in `compose.ts` via `createProviderPool("ocr.extract", ocrChildren)`, one child per (key, model) tier from `GEMINI_API_KEY`(s). Cost pinned `$0`; any nonzero measured cost is treated as a breach. No key present ⇒ the slot is not composed and a declaring run is denied `adapter-unavailable` — never silently degraded. |
| `createGeminiAdvisoryAdapter` (`gemini-advisory.ts`) | provider adapter | `ai.advisory` | Production Gemini adapter for the D178 contact-advisory arm; transport + provenance only, the model's answer passes through verbatim for the consumer to parse against a closed schema. | **Wired in the DASHBOARD composition root** (`src/server/dashboard/compose.ts` — the advisory pool behind the operator-facing POST route, D178). Deliberately absent from the WORKER's run-facing adapter registry: an advisory value must never become a run input (D178 zero-authority-edge, `ai-advisory-no-authority` guard), so a workflow run declaring `ai.advisory` is denied `adapter-unavailable` **by design**, not by omission. |
| `createCensusGeocodeAdapter` / `createNominatimGeocodeAdapter` (`geocode-adapters.ts`) | provider adapters | `geocode.census` / `geocode.nominatim` | Production keyless US Census and OpenStreetMap Nominatim geocoders; Census builds the street name from `preDirection`/`streetName`/`suffixType` only (never TIGER block-range fields — the 2026-07-13 corruption vector). | **Wired unconditionally** in `compose.ts` (no API key required). Which one is tried first, and whether the other is a fallback at all, is `normalization/read-contact-advice`'s policy (Census first for US-shaped addresses), not the adapters'. Nominatim's rate limit is the kernel's own fixed-window budget — no in-adapter sleep. |
| `gemini-transport.ts` (`geminiAnswerText`, `parseGeminiModelJson`, `geminiRetryAt`, `GEMINI_ENDPOINT`) | shared module | n/a | The one Gemini HTTP/JSON transport both Gemini adapters share: endpoint, loose response schema, fenced-JSON tolerance, `429`→`rate-exhausted` mapping with `Retry-After`. | A third Gemini-backed capability should reuse this transport rather than re-deriving the 429 mapping — two private copies would drift on exactly the fact that matters to the admission kernel. |
| `createProviderPool` (`provider-pool.ts`) | shared factory | n/a | Wraps N `(key, model)` children behind one `ProviderAdapter`; advances the rotation cursor only on the retryable-exhaustion code family, leaves it in place on success/non-retryable failure. | The composition-layer wrapper for **any** capability wanting key/model fan-out — it is not itself a capability and holds no budget/throttle/retry logic (that is the admission kernel's job, strictly above it). |
| `createDeterministicProviderHarness` (`deterministic-provider.ts`) | test harness | n/a | Scriptable fake `ProviderAdapter` (`return`/`throw`/`wait-for-abort` scripts) for tests. | **Test-only.** Never wire into production composition. |

---

## 3 · Worked examples — how the live workflows consume stores

### `person-lookup` (`src/workflows/person-lookup/`)

Module binds exactly `[ucpathStore, crmStore, personLookupStore]`.

| Node | Contract | Store task | System |
|---|---|---|---|
| `searching` | `ucpath/search-person-org` (read) | `ucpathStore.searchPersonOrg` | ucpath |
| `cross-verify` | `crm/read-onboarding-record` (read) | `crmStore.readOnboardingRecord` | crm |
| `active-status` (`always-rerun`) | `workflow:person-lookup/read-active-status` (read) | `personLookupStore.readActiveStatus` | none — pure fold over `searching` + `cross-verify` outputs |
| `crm-dates` (conditional on `input.includeCrmDates`) | `crm/read-onboarding-dates` (read) | `crmStore.readOnboardingDates` | crm |

### `kuali-timekeeper-annotation` (`src/workflows/kuali-timekeeper-annotation/`)

Module binds exactly `[kualiStore]`. ONE transaction node, `annotate-timekeeper`, whose beats (doc 09
§13) each call a `kualiStore` task:

| Beat | Contract | Store task | Role |
|---|---|---|---|
| ① pre-fence probe (`probePolicy:"always"`) | `kuali/read-timekeeper-annotation` (read) | `kualiStore.readTimekeeperAnnotation` | already-present idempotency check |
| ② prepare (`dryRun:"stop-after-prepare"` stops here) | `kuali/fill-timekeeper-annotation` (prepare) | `kualiStore.fillTimekeeperAnnotation` | stage the value, prove read-back, zero save |
| ③ subject binding | kernel-owned, not a store task | write sequencer's `read(observationId)` off the driver | re-observes the subject on the exact page the fence binds to |
| ⑤ commit | `kuali/save-timekeeper-annotation` (commit) | `kualiStore.saveTimekeeperAnnotation` | the one external write, under a minted `MutationCapability` |
| ⑥ verify | `kuali/verify-timekeeper-annotation` (read) | `kualiStore.verifyTimekeeperAnnotation` | reload read-back — the only landing proof |

---

## 4 · Gaps at a glance

Five of the nine browser stores are declaration-only (`unwired` driver, stub session provider, 0
tasks, no `system-bindings.ts` entry). Building one is genuinely BUILD work, not CUSTOMIZE — see §1
step 3. Migration order is doc 07 §3.3's table:

| Store | Migration order that mints it | Workflow(s) | Notes |
|---|---|---|---|
| `i9` | **1** | `i9-lookup` (signer lookup) | Pure UCPath-shaped read, same risk class as `person-lookup`. |
| `sharepoint` | **2** | `sharepoint-download` | Single-system download; low risk. |
| `old-kronos` | **2** | `old-kronos-reports` | `common/timecard.ts` is the shared helper already waiting for this driver. |
| ~~`new-kronos`~~ | ~~6~~ | — | **CLOSED 2026-08-12** by separations chunk 1: the store is `semantic-ready` with 2 read tasks. `kronos-pay-rule` (order 6) still adds the **People** page as a third page visit and the first commit-effect task in this store. |
| `onbase` | **7** | `onbase` (with ServiceNow) | Uniquely requires `session.exclusive:true` — design the exclusive lease into the login recipe from the start. |
| `servicenow` | **7** | `oath-upload` | Proves a `receipt`-style completion. |

Two more gaps are **inside** currently-real stores, not new stores — flagged here because they are
easy to miss:

- **The ucpath TERMINATION write family LANDED 2026-08-14** (chunk 4, D206): two transactions — the
  date-agnostic pending sweep and the filing — with doc 09 §5's two probe kinds and a verifier each.
  What is still missing from this store is the **UCPath hire** family (order 9, onboarding), and the
  chunk-4 anchors are not yet published as registry ELEMENTS: they need
  `config/ports/legacy-selector-port-map.json` rows plus a fixture/live evidence-manifest pair, and
  the live half is the read performed on 2026-08-14 (`separations.md` §9.8).
- **The kuali separation READ landed 2026-08-12** (chunk 2, D197): `kuali/read-separation-document`
  reads the whole RRSS form, and fourteen more legacy selector keys moved candidate→ported. What is
  still missing is the **finalization WRITE family** (`Send Back`, `Mark Complete` — the controls that
  actually advance or finalize a real separation), which stays explicitly **not addressable** through
  `kualiStore`; only the benign `Timekeeper Name` annotation can be written today. Minted at
  **order 8** (separations), under doc 09 §14's ALWAYS-GATE identity-approval — the operator ratified manual
  approval on every separation with no auto-approve-on-match.

Not a gap, for the record: `ai.advisory` (`createGeminiAdvisoryAdapter`) is wired in the DASHBOARD
composition root (D178's operator-facing POST route) and deliberately absent from the worker's
run-facing adapter registry — an advisory value must never become a run input (D178
zero-authority-edge), so a run declaring it is denied `adapter-unavailable` by design.
