# The legacy separations behavior review — scenarios for the walkthrough

**Derived from legacy at commit `1bffbd658db34ce84a08e69484db3a40b3658d6e`** (`1bffbd65`, 2026-08-06,
*"feat(scripts): parallel worker pool for the shred-audit collector"*), read **read-only** per D93/D94.
Nothing in `/Users/julianhein/Projects/hr-automation` was executed or modified to produce this document;
every claim is traced to source, and every citation is a `legacy:<path>:<line>` at that commit.

**What this doc is.** A scenario-by-scenario account of what the **old** separations workflow actually
does — the traced control flow, not the intended one — written to be walked through with the operator
and mined for the rebuild's scenario inventory (`docs/rebuild/migrations/separations.md` §b question 9). It is
deliberately **unflattering where legacy deserves it**: the silent fallbacks, swallowed errors and
ambiguous states below are the exact cases the rebuild must convert into fail-closed behavior. It is a
**sibling** of `separations.md` (the migration plan) and duplicates none of its planning; where the two
overlap on a legacy fact they agree by construction, both citing `1bffbd65`.

**Reading the verdict tags.**

| Tag | Meaning |
|---|---|
| `sound` | Legacy already fails closed / does the right thing. Port the *intent*, keep the guard. |
| `fragile` | Correct in principle, but held up by a timing window, a selector, or an unverified assumption. |
| `silent-risk` | Legacy continues on a wrong or unknown value, and the operator is not told. **These are the rebuild's counterexamples.** |
| `unknown` | Source does not determine the behavior. Marked, never guessed. |

---

## 1. The happy path, end to end

The clean case: one Kuali RRSS separation doc, live (not dry-run), an HDH employee, a clean
name↔EID match, no pre-existing UCPath termination. Steps as declared in
`legacy:src/workflows/separations/workflow.ts:113-125`.

| # | What happens | System | Reads | Writes |
|---|---|---|---|---|
| 0 | Operator types doc id(s) into the dashboard input panel → `/api/enqueue` → SQLite task + a `pending` row → a separations daemon claims it (`legacy:src/workflows/separations/CLAUDE.md:5`, `legacy:src/workflows/separations/cli.ts:75-80`) | — | — | tracker row |
| 1 | Three browsers launch tiled; `parallel-staggered` auth pre-fills all three SSO forms, then submits at t=0 / t+5s / t+10s so three Duo prompts overlap (`legacy:src/workflows/separations/workflow.ts:283-317`) | Kuali · New Kronos · UCPath | — | — |
| 2 | **`kuali-extraction`** — Action List → type the doc number into the list's own search box → GO → click the **exactly**-matching bare-number link → read six fields (name, EID, LDW, separation date, termination type, location), normalize the ALL-CAPS name (`legacy:src/workflows/separations/steps/kuali-extract.ts:36-80`; `legacy:src/systems/kuali/navigate.ts:44-224`) | Kuali | 6 form fields | tracker row only |
| 3 | Preflight — both Kuali dates must parse as `MM/DD/YYYY` and must **not** be in the future (`legacy:src/workflows/separations/workflow.ts:494-495`; `legacy:src/workflows/separations/schema.ts:342-358`) | — | — | — |
| 4 | Derived up front — Vol/Invol → template; Kuali type → UCPath reason code; Kronos window = `[min(LDW,sep) − 1 month, max(LDW,sep) + 1 month]` (`legacy:src/workflows/separations/workflow.ts:497-521`) | — | — | — |
| 5 | Inline **Job Summary** read (the identity gate's evidence) — navigate → search by EID → detail page → header name + Work Location (`deptId`, department description) + Job Information (`jobCode`, job description), each resolved to the row in effect **as of the separation date** (`legacy:src/workflows/separations/workflow.ts:583-599`; `legacy:src/systems/ucpath/job-summary.ts:802-868`) | UCPath | dept, payroll title, legal name | — |
| 6 | **`identity-check`** — name tier `same` → the step is **skipped**, the Kuali EID is trusted (`legacy:src/workflows/separations/workflow.ts:623-628`) | — | — | — |
| 7 | **`transaction-check`** — SS Smart HR search by EID for a `TER` row → none → then the **date-agnostic pending sweep**: delete every in-progress "Terminat" row for this EID (`legacy:src/workflows/separations/steps/transaction-check.ts:66-186`; `legacy:src/systems/ucpath/transaction.ts:1184-1231`) | UCPath | TER row / in-progress grid | **⚠ first irreversible external mutation** — deletes UCPath rows |
| 8 | **Department gate** — HDH (description contains `housing`/`dining`/`hospitality`) → run Kronos (`legacy:src/workflows/separations/workflow.ts:772-788`; `legacy:src/domain/hdh/departments.ts:1-7`) | — | — | — |
| 9 | **`ucpath-job-summary`** — fill department, dept id, payroll title code, payroll title into the Kuali form (`legacy:src/workflows/separations/steps/ucpath-job-summary.ts:10-31`; `legacy:src/systems/kuali/navigate.ts:402-476`) | Kuali | — | **uncommitted draft** |
| 10 | **`kronos-search`** (2-way `ctx.parallel`) — **(a)** New Kronos: search EID → select → Go To → Timecard → verify the timecard header EID → 3 s settle → set + verify the date range → parse the grid for last punch / sick days / holiday days; **(b)** Kuali: check *Request Acknowledged*, fill *Timekeeper Name* (`legacy:src/workflows/separations/steps/kronos-search.ts:38-137`; `legacy:src/systems/new-kronos/navigate.ts:852-894`) | New Kronos · Kuali | punches, sick, holiday | **uncommitted draft** |
| 11 | **Date reconciliation** — `LDW = lastPunch ?? kualiLDW`; `separationDate = max(LDW, last sick, last holiday)` **only if a timecard was actually read**; `termEffDate = separationDate + 1 day` (`legacy:src/workflows/separations/workflow.ts:921-952`; `legacy:src/workflows/separations/schema.ts:45-81`) | — | — | — |
| 12 | The UCPath comment string is built (single leave clause), and a best-effort Kronos screenshot is centered on the chosen LDW (`legacy:src/workflows/separations/workflow.ts:985-1014`) | — | — | — |
| — | *(dry-run runs terminate here — see S43)* (`legacy:src/workflows/separations/workflow.ts:1042-1074`) | | | |
| 13 | Kuali date write-backs — `updateLastDayWorked` if the punch moved it; `updateSeparationDate` if leave moved it (`legacy:src/workflows/separations/workflow.ts:1082-1095`) | Kuali | — | **uncommitted draft** |
| 14 | **`ucpath-transaction`** — pre-submit existence probe (EID + exact effdt + "Terminat") → Smart HR → select template `UC_VOL_TERM`/`UC_INVOL_TERM` → effective date → **Create Transaction** → fill Empl ID → reason code → Continue → comments ×2 → check *Override Last Date Worked*, fill *Last Date Worked*, **positively read both back** → **`Save and Submit`** (`legacy:src/workflows/separations/steps/ucpath-transaction.ts:89-202`; `legacy:src/systems/ucpath/transaction.ts:821-915`) | UCPath | — | **🚨 POINT OF NO RETURN — the real HR termination is filed here** |
| 15 | Transaction number readback — OK on the confirmation dialog → re-navigate to Smart HR Transactions → find the row by **Person ID** (never by name) → Continue → read `Transaction ID: T…` (`legacy:src/systems/ucpath/transaction.ts:936-1005`) | UCPath | `T#` | tracker row (stamped immediately) |
| 16 | **`kuali-finalization`** — fill Termination Effective Date → check *Submitted Termination Template* → fill *Transaction Number* (fill-with-verify) → select the *Does not need Final Pay (student employee)* radio → append date-change / duplicate comments → re-verify the txn # → screenshot the filled form → **`Save`** (`legacy:src/workflows/separations/steps/kuali-finalize.ts:50-99`) | Kuali | — | **the Kuali document is committed here** |
| 17 | Final snapshot to the tracker row; if the transaction number is empty the run **throws** so it lands `failed`, not `Done` (`legacy:src/workflows/separations/workflow.ts:1203-1242`) | — | — | tracker row |

**Three commit points, not one — this matters for the rebuild's fencing design.**

1. **Step 7, the pending sweep** is the *first* irreversible external mutation. A deleted UCPath
   in-progress transaction cannot be undeleted. It happens **before** any identity re-confirmation of
   the write and **before** the operator has seen anything.
2. **Step 14, `Save and Submit`** is the point of no return for the termination itself.
3. **Step 16, `Save`** commits the Kuali document. It is **not verified** (S38).

Everything Kuali writes between steps 9 and 13 is on an *unsubmitted draft*; legacy assumes those
edits vanish if the run dies before step 16 (`legacy:src/workflows/separations/workflow.ts:1038-1041`).
That assumption is **stated, never verified** — see S44.

---

## 2. Scenario table

| id | Situation | What legacy does | Verdict | Rebuild implication |
|---|---|---|---|---|
| **Entry / input** ||||
| S1 | Doc id not in the operator's Action List (wrong step, already completed, unknown) | Throws `Document #N not found in Action List` | `sound` | Keep as a hard entry gate; the Action List *is* the step-ownership proof |
| S2 | Doc id is a non-separation Kuali document | Opens it, then the per-field extraction times out at 5 s on the first missing field | `fragile` | Assert the document *type* explicitly before reading fields |
| S3 | Doc id is a substring of another (`414` vs `4140`) | Search is substring-based, but the link match is anchored → cannot open the wrong doc | `sound` | Port the anchored match verbatim |
| S4 | Same doc id enqueued twice while a run is in flight | Enqueue-supersede cancels the prior non-terminal run | `sound` | Permanent-key fencing subsumes this |
| S5 | Same doc id re-run after a *completed* run | Nothing blocks it; safety rests entirely on the two live UCPath probes | `silent-risk` | This is exactly what the permanent key must fence durably |
| S6 | `docId` shape | `z.string().min(1)` — any non-empty string | `fragile` | Type the intake as a Kuali document number |
| **Kuali document content** ||||
| S7 | Last Day Worked or Separation Date in the future | Throws before any Kronos/UCPath work | `sound` | Keep; make it a declared precondition |
| S8 | Unparseable date | Throws with the field name | `sound` | Keep |
| S9 | Termination type outside the 3-entry involuntary list | Silently classified **voluntary** → `UC_VOL_TERM` | `silent-risk` | Vol/Invol must be a closed, exhaustive mapping that refuses unknowns |
| S10 | Termination type not in the 15-entry reason map | Fuzzy substring match, then a hard default of `Resign - No Reason Given` | `silent-risk` | The single worst pattern in the workflow — see D1 |
| S11 | Two divergent `INVOLUNTARY_TYPES` constants exist (2 entries vs 3) | The exported one is stale/unused; the used one has 3 | `fragile` | One source of truth, guard-enforced |
| S12 | Termination-type `<select>` has no option text | Throws inside the `evaluate` — refuses to guess | `sound` | Keep the refusal |
| S13 | Location field absent | Caught, set to `""`; never read downstream | `sound` | Genuinely optional; declare it so |
| **Identity** ||||
| S14 | Job Summary found, name tier `same` | `identity-check` skipped, Kuali EID trusted | `sound` | Keep |
| S15 | Job Summary found, name tier `similar` (≤2 edits/token) | Trusts the EID and **rewrites the employee name in the live Kuali doc** with no review | `silent-risk` | Two real people within 2 edits/token pass this; needs an operator decision |
| S16 | Job Summary found, name tier `different`, person-lookup returns the **same** EID | `verified` → proceeds | `sound` | Keep |
| S17 | Job Summary found, name `different`, person-lookup returns a **different** EID | **PAUSES** into the operator EID-approval review — the `T002173685` fix | `sound` | This is the control the rebuild's §14 identity gate must inherit |
| S18 | Job Summary **not found**, EID < 8 digits | Delegates to person-lookup by name | `sound` | Keep |
| S19 | Job Summary **not found**, EID is a complete 8 digits | **FAILS LOUD** — no name lookup | `sound` | Keep; the deliberate non-fallback |
| S20 | person-lookup resolves no valid UCPath EID | **FAILS LOUD** | `sound` | Keep |
| S21 | Employee **already fully terminated** in UCPath (multi-row grid, all rows Terminated) | Throws with an explicit "may already be fully separated" message | `sound` | Keep, and surface it as its own outcome class, not a generic failure |
| S22 | Employee already terminated but UCPath returns **one** row (single-result auto-redirect) | The all-terminated guard **never runs**; the run proceeds and files a second termination | `silent-risk` | The already-terminated check must be an explicit read, not a side effect of grid drill-in |
| S23 | 2+ concurrent non-terminated jobs for one EID | Throws rather than picking one | `sound` | Keep the refusal |
| S24 | Job Summary found but department or job code unreadable | Throws | `sound` | Keep |
| S25 | Operator approves an EID from the review | Forces the chosen EID, **skips the identity gate entirely** (no re-verification) | `fragile` | Approval must be bound to the exact evidence it was granted on |
| S26 | "Transactions only" preset, or edit-and-resume with LDW/txn prefilled | The **entire identity gate is skipped** — no Job Summary fetch, no name check | `silent-risk` | A preset must never be able to disable the wrong-person control |
| **Existing-termination check** ||||
| S27 | An **approved** TER within 14 days of the Kuali separation date | Reuses its `T#`, skips the UCPath create, files a duplicate-termination comment | `sound` | Keep; it is the real idempotency answer |
| S28 | An approved TER **outside** the 14-day window (prior job) | Ignored → a fresh transaction is created | `fragile` | 14 days is an unexplained constant; confirm with the operator |
| S29 | The TER's effective date cannot be read | Treated as a prior termination → creates a **fresh** transaction | `fragile` | Deliberate fail-toward-create; the rebuild must decide fail-open vs fail-closed here |
| S30 | Stale **pending** termination rows in the in-progress grid | Deleted, date-agnostically, on every create-bound path | `sound` (but it is a mutation) | Port, but fence it — it is the first irreversible act |
| S31 | The grid scan or the sweep throws | Propagates — refuses to report "0 pending" | `sound` | Keep verbatim |
| **New Kronos timecard** ||||
| S32 | Non-HDH department | Kronos skipped; **Kuali dates kept verbatim** (no derive, no write-back, no comment) | `sound` | Keep the asymmetry — it was a real defect fix |
| S33 | Department unknown or empty | Kronos **still runs** (fail-safe) | `sound` | Keep |
| S34 | Employee genuinely not in New Kronos | `found:false`, empty timecard, LDW falls back to Kuali's, separation date still **derived** | `fragile` | "Read the card and it was empty" vs "no card" are conflated |
| S35 | Search results never surface within 15 s | Logged as a warning and treated as **NOT FOUND** | `silent-risk` | A timeout is not an answer |
| S36 | Found, but Go To → Timecard fails | Throws **inside a settled parallel block** → logged, **non-fatal**; the run completes `Done` on Kuali dates | `silent-risk` | A failed ground-truth read must not produce a `Done` run |
| S37 | Found, but the open timecard shows a different employee | Same: throws, logged, non-fatal, run completes on Kuali dates | `silent-risk` | Same |
| S38 | Timecard read succeeds but has no punches | `lastPunchDate = null` → LDW = Kuali's, separation date **is** derived (it did read the card) | `sound` | Keep the distinction; make it explicit in the data model |
| S39 | Sick and/or holiday days present | Separation date extends to the latest; the comment reports **one** clause (the later of the two) | `sound` | Keep; confirm the single-clause rule with the operator |
| S40 | The date range does not actually apply to the grid | Throws — refuses to read a grid on the wrong window | `sound` | Keep |
| S41 | A parsed `M/D` cannot resolve to a year inside the window, or is ambiguous | Throws — refuses to stamp a guessed year | `sound` | Keep |
| S42 | Kuali *Timekeeper Name* fill fails (either path) | **FATAL** — the run aborts rather than finalizing a form with the field blank | `sound` | Keep; note it is the same field that blocked the rebuild's D128 commit |
| S43 | Batch/daemon reuse leaves New Kronos parked on the previous doc's timecard | Fixed 2026-07-31 by resetting every system between items; 20 of 21 docs had silently fallen back before that | `fragile` | Cross-doc page state, not selectors, is the failure mode to design against |
| **UCPath termination filing** ||||
| S44 | A matching transaction already exists (EID + exact effdt + "Terminat") | Reuses its number, skips the submit | `sound` | Keep |
| S45 | The existence probe throws | Propagates — refuses to read "lookup failed" as "no duplicate" | `sound` | Keep verbatim |
| S46 | The probe matched a row but no `T#` could be read from the detail page | Treated as **no match** → proceeds to create | `silent-risk` | An unreadable receipt is not an absent transaction |
| S47 | `Create Transaction` reports failure | Logged, swallowed; returns empty `T#`; **Kuali finalization still runs and saves the form blank**, then the run throws | `silent-risk` | The Kuali doc is mutated for a transaction that does not exist |
| S48 | UCPath rejects the Empl ID on the details page | **FATAL** typed error, screenshot, escapes the swallow; no Kuali finalization | `sound` | Keep the typed error |
| S49 | Last Date Worked cannot be read back with the override checked | **FATAL** typed error; no submit | `sound` | Keep — this is the model for read-back gating |
| S50 | Submit produces an error banner | Logged; empty `T#`; Kuali finalization still runs and saves blank; then the run throws | `silent-risk` | Same as S47 |
| S51 | Submit times out with **no** error banner and **no** confirmation dialog | Throws — "PeopleSoft's outcome is unknown, refusing to report success" | `sound` | The best fail-closed line in the legacy code; port the shape |
| S52 | Submit confirmed, but the `T#` cannot be read back within 15 s | Extra screenshot, then **throws before** Kuali finalization | `sound` | Keep — the Kuali doc is deliberately left untouched |
| S53 | Any other exception inside the step | Caught, screenshotted, **swallowed**; Kuali finalization runs and saves blank; the run throws at the end | `silent-risk` | The blanket catch is the rebuild's main counterexample |
| S54 | Reason code select fails / is intercepted | Falls back to calling PeopleSoft's `submitAction_win0` by hand | `fragile` | A JS escape hatch that bypasses the UI contract |
| **Kuali finalization** ||||
| S55 | No matching Kuali department option for the UCPath description | Throws — refuses to save with the required field blank | `sound` | Keep |
| S56 | Existing timekeeper comments cannot be read | Throws rather than risk blanking prior comments | `sound` | Keep |
| S57 | Transaction number is empty at finalization | Deliberately fills everything **except** the number, saves "blank for manual entry", then the run fails | `fragile` | Intentional, but it writes a half-finished doc — confirm the operator wants it |
| S58 | The *Does not need Final Pay (student employee)* radio | Selected **unconditionally**, for every employee | `silent-risk` | Hardcoded business assertion with no data behind it |
| S59 | `Save` clicked but Kuali persists nothing | Reported as success — **there is no read-back at all** | `silent-risk` | The direct analogue of the rebuild's D128 finding |
| S60 | UCPath submitted, then finalization fails | Partial completion: real termination filed, Kuali doc not finalized; the `T#` **is** on the row and edit-and-resume can re-run finalization only | `fragile` | The partial state is recoverable but not *named* anywhere |
| **Cross-cutting** ||||
| S61 | Dry run | Halts before both commits — but still writes the Kuali draft (timekeeper name, and the `similar` name correction) | `fragile` | "Dry run" that writes anything needs a stricter contract |
| S62 | A UCPath dialog appears during Kuali extraction | Auto-accepted, unconditionally, errors swallowed | `silent-risk` | Blind dialog acceptance on the system that files terminations |
| S63 | A failing run's recovery | No durable checkpointing; retry re-runs the whole handler and reconverges through live UCPath probes | `fragile` | The rebuild replaces this wholesale |

---

## 3. Per-scenario detail

### Entry and input

#### S1 — doc id not in the Action List `sound`

`clickDocument` fills the Action List's own search box, clicks **GO**, waits for the filtered row, and
throws `Document #<n> not found in Action List` when the anchored link count is zero
(`legacy:src/systems/kuali/navigate.ts:126-148`).

This is more load-bearing than it looks. **The Action List is also the workflow-step proof.** A Kuali
RRSS doc only appears in the timekeeper's Action List when it is at the timekeeper step — the step that
owns `Timekeeper Name:*`, `Termination Effective Date*`, `Transaction Number:*` and the Final
Transactions section. That is precisely the fact whose absence blocked the rebuild's D128 controlled
commit (operator-named docs 4489/4490 were at a step that does **not** own `Timekeeper Name:*`).
Legacy never states this — it is an emergent property of using the Action List as the entry point.

> **Question for the operator:** is "the doc is in my Action List" the correct and complete definition
> of "this doc is ready for the automation"? Or are there docs in your Action List that the workflow
> must still refuse (wrong form type, already-processed, someone else's queue)?

#### S2 — a non-separation Kuali document `fragile`

`clickDocument` waits for the employee-name field but the wait is **best-effort**
(`legacy:src/systems/kuali/navigate.ts:156`), explicitly deferring to extraction's own per-field
timeouts. Extraction then reads six fields at 5 s each
(`legacy:src/systems/kuali/navigate.ts:187-211`). A non-separation document therefore fails as a
5-second locator timeout on `Employee Last Name, First Name*` — not as "wrong form type".

> **Question for the operator:** does your Action List ever contain non-separation forms? If so the
> rebuild should assert the form type explicitly and refuse by name.

#### S5 — the same doc run twice after a completed run `silent-risk`

Enqueue-supersede only cancels **non-terminal** prior runs for the same `(workflow, itemId)`
(`legacy:src/control/ops/supersede.ts:2-14, 55-63`). A doc that already completed can be enqueued
again with no objection, and the workflow will re-walk the whole path.

What actually stops a second termination is two **live probes**, not durable state:
`findTerminationTransactionStatus` finding an approved TER within 14 days (S27), and
`findExistingTerminationTransaction` matching EID + exact effective date + "Terminat"
(`legacy:src/systems/ucpath/transaction.ts:1055-1139`). Both are page reads. When either is degraded —
S29, S46 — the second run creates a *second real transaction*. Legacy's own lesson concedes the design:
*"No tracker-side step cache/idempotency for UCPath submits… Retrying converges through the live Smart
HR transaction list"* (`legacy:src/workflows/separations/CLAUDE.md:220`).

> **Question for the operator:** what should the rebuild do when a doc that already produced a
> termination is submitted again — refuse outright by permanent key, or re-open the prior run's
> receipt?

### The Kuali document

#### S9 / S10 / S11 — termination type → template and reason code `silent-risk`

Two independent decisions, both defaulting.

**Vol/Invol** is a three-string deny-list:

```ts
// legacy:src/systems/kuali/navigate.ts:230-241
const INVOLUNTARY_TYPES = [
  "Never Started Employment",
  "Graduated/No longer a Student",
  "Appointment Expired",
];
export function isVoluntaryTermination(terminationType: string): boolean {
  return !INVOLUNTARY_TYPES.includes(terminationType);
}
```

Any Kuali dropdown option not in that list — including a new one, a renamed one, or one this code has
simply never seen — is **voluntary**, and picks the `UC_VOL_TERM` template
(`legacy:src/workflows/separations/workflow.ts:497-504`).

**The reason code** then falls through three tiers (`legacy:src/workflows/separations/schema.ts:200-223`):
exact map hit → substring fuzzy match in either direction → the constant `"Resign - No Reason Given"`.

The fuzzy tier is genuinely dangerous because it matches *either* direction:

```ts
// legacy:src/workflows/separations/schema.ts:215-219
if (lowerType.includes(kualiType.toLowerCase()) || kualiType.toLowerCase().includes(lowerType)) {
  return ucpathReason;
}
```

A Kuali type of `"Other"` matches `"Accepted Another Job"` — because `"accepted an**other** job"
contains `"other"` — and would file a resignation-for-another-job reason. A type like `"Death"` matches
nothing, is not in the involuntary list, and would be filed as a **voluntary** `Resign - No Reason
Given`. Neither case logs a warning; both look like a normal run.

`legacy:src/workflows/separations/config.ts:25-28` also exports a **second, divergent**
`INVOLUNTARY_TYPES` with only two entries (missing `"Appointment Expired"`). It is exported through the
barrel (`legacy:src/workflows/separations/index.ts:21`) but nothing uses it for a decision — a stale
duplicate waiting to be picked up by mistake.

> **Question for the operator:** what is the **complete** list of options in the Kuali *Type of
> Termination* dropdown, and the correct UCPath template + reason code for each? The source does not
> record it — `unknown — needs live observation`. The rebuild should refuse an unmapped type outright
> rather than default. Is refusing acceptable, or do you need a "file it as X and flag it" path?

### Identity

#### S15 — the `similar` arm rewrites the employee's name `silent-risk`

When the Job Summary name is within **2 Levenshtein edits per token** of the Kuali name
(`legacy:src/services/matching/match.ts:132-155`, `TOKEN_VARIANT_MAX = 2` at line 78), legacy concludes
"same person, misspelled name", trusts the Kuali EID, and **writes the UCPath spelling into the live
Kuali separation document** (`legacy:src/workflows/separations/workflow.ts:629-649`;
`legacy:src/systems/kuali/navigate.ts:569-578`). There is no operator review, and it happens in dry-run
too (`legacy:src/workflows/separations/CLAUDE.md:38`).

This exists to fix a real bug (Kuali "Balmaceda, Jaden" vs UCPath "Jayden Balmaceda" used to fail loud).
But the threshold cuts both ways: `Chan`/`Chen`, `Nguyen`/`Nguyan`, `Marc`/`Mark` are all distance ≤ 2.
If the Kuali EID is wrong and happens to land on a person with a near-name, `similar` **suppresses**
the wrong-person control that `different` triggers — and then edits the document to make the two names
agree.

> **Question for the operator:** should a name correction ever be written without review? A safer shape
> is: trust the EID, record the discrepancy, and let the operator approve the name edit.

#### S17 — the `T002173685` wrong-person termination `sound`

The incident, verbatim from the legacy record
(`legacy:src/workflows/separations/CLAUDE.md:44`, repeated as the dated lesson at line 204):

> A graduating student's Kuali doc carried EID `10833507` ("Hernandez, Jose Santos" — a student, job
> *STDT 3*, consistent with "Graduated/No longer a Student"), but the UCPath detail name rendered
> "Santos Hernandez" → `different` → a name search on the common name "Hernandez, Jose" resolved a
> *career* maintenance worker (`10401814`, *BLDG MAINT WORKER SR*, employed since 2016), and the
> override filed a real termination (`T002173685`) against him.

The root cause is stated precisely and is worth carrying into the rebuild: **when the Kuali EID is
FOUND in UCPath as a real person, a token-level name difference is not proof the EID is wrong.** The
*name* can be the imperfect field (a dropped middle name), and a common-name re-search can resolve
someone else entirely.

The fix, still in place: `resolveSeparationEid` returns `verified | needs-approval` and performs **no**
`ctx.updateData` — the decision to accept a different EID belongs to the operator
(`legacy:src/workflows/separations/workflow.ts:211-269`). On `needs-approval` the handler skips every
remaining step, stamps both candidate identities, and returns **`done`** so the three browsers release
and the queue continues (`legacy:src/workflows/separations/workflow.ts:667-696`). Legacy is explicit
that a separations run *cannot park* — it holds three live browsers — so the pause is
terminate-and-re-enqueue, not a suspended run
(`legacy:src/workflows/separations/CLAUDE.md:48`).

Two live facts the operator should confirm are still true:

- `T002173685` (Jose Hernandez `10401814`) is described as **a real transaction still needing manual
  reversal in UCPath**, and student `10833507` as **still needing separating**
  (`legacy:src/workflows/separations/CLAUDE.md:204`). Is that still outstanding?
- The pause is rendered as an amber **"Awaiting Approval"** row with an `EidApprovalBanner` showing both
  identities side by side (`legacy:src/workflows/separations/CLAUDE.md:49`).

> **Question for the operator:** in the rebuild a run *can* park durably. Should the identity gate park
> the run (holding its place) instead of ending `done` and re-enqueueing on approval?

#### S21 / S22 — already terminated in UCPath `sound` / `silent-risk`

The all-terminated refusal is real but **conditional on UCPath returning a multi-row grid**:

```
// legacy:src/systems/ucpath/job-summary.ts:278-282
if (nonTerminated.length === 0) {
  throw new Error(`[Job Summary] Multi-row grid for EID ${emplId}: all ${scopedTotal} rows were
    Terminated — no actionable row to drill into. Verify the EID in Kuali Build, or the employee
    may already be fully separated.`);
}
```

That block only executes when the search did **not** auto-redirect to a detail page
(`legacy:src/systems/ucpath/job-summary.ts:249-298`). A single-employment-record person who is already
terminated auto-redirects straight to the detail page — the grid scan never runs, no HR-status check
happens anywhere else in the workflow, and the run proceeds to file a **second** termination. It would
then be caught only by the SS Smart HR TER probe (S27) *if* that termination is within 14 days and
readable.

> **Question for the operator:** how often do you separate someone who is already terminated in UCPath
> (duplicate Kuali docs, re-submitted requests)? The rebuild should read HR status explicitly and treat
> "already terminated" as a first-class, named outcome.

#### S26 — the "Transactions only" preset disables the wrong-person control `silent-risk`

The chain is short and easy to miss:

```ts
// legacy:src/workflows/separations/workflow.ts:556-557, 578
const presetSkippedKronos = ctx.shouldSkipStep("kronos-search");
const kronosSkippedByInput = lastDayWorkedPrefilled || presetSkippedKronos;
const identitySkipped = txnNumberPrefilled || kronosSkippedByInput;
```

The declared preset skips `kronos-search` and `ucpath-job-summary`
(`legacy:src/workflows/separations/workflow.ts:331-339`). Because `identitySkipped` is derived from
`kronosSkippedByInput`, choosing "Transactions only" also means: **no Job Summary fetch at all**, no
name comparison, no `identity-check`, no department gate — and then a real termination is filed against
whatever EID the Kuali form carried
(`legacy:src/workflows/separations/workflow.ts:583, 605-611`). The same holds for an edit-and-resume
run where the operator prefilled `lastDayWorked`.

Legacy's justification is that the operator "asserted the data"
(`legacy:src/workflows/separations/workflow.ts:543-551`). But the operator asserted the *dates*, not the
*identity* — and the identity gate is the control that exists because of `T002173685`.

> **Question for the operator:** should any run mode be able to skip the identity check? The rebuild's
> §14 identity gate should probably be unconditional, with the preset only skipping the timecard read.

### Existing-termination check

#### S27 / S28 / S29 — approved-TER reuse and the 14-day window `sound` / `fragile`

`SEPARATION_TERMINATION_WINDOW_DAYS = 14` (`legacy:src/systems/ucpath/ss-smart-hr.ts:101`), documented
as *"a week or two"* (`legacy:src/workflows/separations/CLAUDE.md:66`). The newest TER row is drilled
into, its `Effdt:` read, and compared against the **Kuali** separation date; only a TER inside the
window is reused (`legacy:src/systems/ucpath/ss-smart-hr.ts:370-446`).

This gate exists because of a second real incident: the original drill-in selector was authored from a
screenshot, timed out, and **silently reused an approved prior-job TER** — Micah Roye / EID `10797079`,
TER `T001928408` with effdt **2025-07-01**, reused for an **06/17/2026** separation
(`legacy:src/workflows/separations/CLAUDE.md:66`). So the fail-toward-create behavior on an unreadable
effdt (line 416-432) is a deliberate correction, not sloppiness:

```
// legacy:src/systems/ucpath/ss-smart-hr.ts:426-431
log.warn(`[SS Smart HR] Could not read TER ${ter.transactionId}'s effective date — cannot verify
  it is THIS separation; creating a fresh transaction (ucpath-transaction's EID+effdt check
  backstops a true duplicate)`);
return { found: false, …, priorTerminationSkipped: true };
```

Note the direction: **uncertainty resolves toward creating a real termination.** That is the opposite of
the rebuild's default posture.

> **Questions for the operator:** (a) is 14 days the right window, and where does it come from? (b) when
> the effective date of an existing termination cannot be read, should the rebuild create a fresh one
> (legacy) or park for a human?

#### S30 / S31 — the pending sweep `sound`, but it is the first mutation

`deletePendingTransaction` deletes **every** in-progress row whose Person ID cell equals the EID and
whose row text matches `/Terminat/i`, regardless of effective date
(`legacy:src/systems/ucpath/transaction.ts:1184-1231, 1249-1276`). It was added after real visible
duplicates — Erick Guzman `10779506` with 06/14 **and** 06/20; Zaira Argumedo `10629763` with 06/13 and
06/20 (`legacy:src/workflows/separations/CLAUDE.md:207`) — and the checkbox/`#ICOK` mechanics are
live-verified.

Both the scan and the sweep refuse to degrade: a throw propagates rather than returning `0`
(lines 1222-1230, 1243-1248). That is right. What is worth naming for the rebuild is **when** it runs:
step 7 of 17, before any read-back of the write target and before the operator sees anything. A
mis-targeted sweep silently deletes someone else's pending transaction.

> **Question for the operator:** should the sweep be a distinct, operator-visible action ("I deleted 2
> stale pending terminations for this EID") rather than an invisible side effect of a check step?

### New Kronos

#### S34 / S38 — "no timecard" vs "empty timecard" `fragile` / `sound`

Three genuinely different states are collapsed into two:

| Reality | `newKronosFound` | `timecardRead` | LDW used | Separation date |
|---|---|---|---|---|
| Not in New Kronos at all | `false` | **`true`** | Kuali LDW | **derived** from Kuali LDW |
| In Kronos, timecard opened, no punches | `true` | `true` | Kuali LDW | **derived** from Kuali LDW |
| In Kronos, timecard could **not** be opened | — | **`false`** | Kuali LDW | **Kuali's, verbatim** |

The third row is the important one and is only two weeks old in legacy terms — see S36.

#### S35 — a search timeout becomes "not found" `silent-risk`

```ts
// legacy:src/systems/new-kronos/navigate.ts:174-178
log.warn(
  `[New Kronos] No search results surfaced for ${employeeId} within the timeout — ` +
  `treating as NOT FOUND (best-effort; Kuali Last Day Worked will be used).`,
);
return false;
```

15 seconds of no signal is reported as a factual negative. Downstream, `found: false` is
indistinguishable from a genuine "this person is not timekept here", and `timecardRead` is set to
`true` — so the separation date is **derived** as if a card had been read.

#### S36 / S37 — found-but-unreadable timecard is non-fatal `silent-risk`

Both the Go To failure and the wrong-person timecard now **throw**
(`legacy:src/workflows/separations/steps/kronos-search.ts:48-65, 73-81`) — a 2026-06-24 improvement over
silently returning an empty timecard. But they throw *inside a settled `ctx.parallel` block*, so the
handler only logs them:

```ts
// legacy:src/workflows/separations/workflow.ts:870-880
if (phase1.newK.status === "fulfilled") { … timecardRead = true; … }
else { logSettledRejection("New Kronos", phase1.newK); }
```

`logSettledRejection` writes two log lines and returns a boolean the New Kronos branch **does not check**
(`legacy:src/workflows/separations/settled.ts:4-13`). The run continues, files a real termination on the
Kuali LDW, and terminates **`Done`**. The operator's only signal is a red line in the log panel.

The cost of this is measured. On 2026-07-31 a daemon page-state leak (S43) caused **20 of 21** found
employees to hit the Go To failure; every one of those runs completed
(`legacy:src/workflows/separations/CLAUDE.md:199`). And before the `timecardRead` gate existed, three
real Kuali docs — **4445, 4461, 4471** — had a changed Separation Date written back with the audit
comment *"Updated Separation Date from … per Kronos timesheet"* citing a timesheet that was never opened
(`legacy:src/workflows/separations/CLAUDE.md:200`).

> **Question for the operator:** should a failed timecard read fail the run, or proceed on Kuali dates
> with an explicit "Kronos not read" marker on the row and in the UCPath comment? Legacy currently does
> neither cleanly — it proceeds *and* claims nothing.

#### S39 — the leave clause `sound`

Separation date = `max(LDW, last sick, last holiday)`
(`legacy:src/workflows/separations/schema.ts:66-81`). The comment reports exactly **one** clause: when
both sick and holiday exist, only the later is emitted (holiday wins strictly-later, sick wins ties)
(`legacy:src/workflows/separations/schema.ts:126-139`). Sick reports only the latest date, never a range;
holiday reports `on <d>` for one day or `from <first> to <last>` for two or more (lines 117-124).

Note `<ldw>` in the comment is the **physical** last day worked, never the separation date — leave pushes
out the separation date and hence the effective date, never the LDW
(`legacy:src/workflows/separations/schema.ts:88-93`).

> **Question for the operator:** is one clause still right? And is holiday-wins-strictly-later /
> sick-wins-ties the rule you want, or should both be reported?

#### S42 — the Timekeeper Name fill is fatal on both paths `sound`

```ts
// legacy:src/workflows/separations/workflow.ts:886-893
if (logSettledRejection("Kuali Timekeeper", phase1.kualiTimekeeper)) {
  throw new Error(
    `[Kuali] Timekeeper name fill FAILED for EID … — the separation form's required Timekeeper
     Name field was not filled. Not finalizing a form with a missing timekeeper name: …`);
}
```

The kronos-skip path has the identical guard (`legacy:src/workflows/separations/workflow.ts:856-865`).
This is the correct shape, and it is worth pointing out that the field involved —
`Timekeeper Name:*` (`legacy:src/systems/kuali/selectors.ts:135-136`) — is **exactly** the field the
rebuild's D128 controlled commit could not persist. Legacy never hits that wall because the Action List
entry point guarantees the doc is at the step that owns the field (S1).

### UCPath filing

#### S46 — an unreadable receipt is treated as no transaction `silent-risk`

```ts
// legacy:src/systems/ucpath/transaction.ts:1128-1129
log.warn(`[Txn Lookup] Matched row but couldn't extract Transaction ID from detail page —
  treating as no match`);
return { txnNumber: null, alreadyAtSmartHR: false };
```

The surrounding function is otherwise exemplary — its outer catch explicitly refuses to report "no
existing transaction found" because that *"would clear the way for a duplicate termination"*
(lines 1130-1138). But this one branch does exactly that, without throwing: a row **was** matched by EID
+ effective date + "Terminat", and the outcome is "no match" → proceed to create a second one.

#### S47 / S50 / S53 — the soft-failure path that still writes Kuali `silent-risk`

Three distinct failures land in the same place:

```ts
// legacy:src/workflows/separations/steps/ucpath-transaction.ts:121-125
if (!createResult.success) {
  log.error(`[UCPath Txn] Create failed: ${createResult.error}`);
  return { transactionNumber, submittedWithoutTxnNumber };   // ← empty T#, no throw
}
```

```ts
// legacy:src/workflows/separations/steps/ucpath-transaction.ts:203-216
} catch (e) {
  if (e instanceof EmplIdNotRecognizedError || e instanceof LastDateWorkedVerificationError) throw e;
  log.error(`[UCPath Txn] Failed: ${errorMessage(e)}`);
  await ctx.screenshot({ kind: "error", label: "ucpath-transaction-failed", … });
}   // ← swallowed
```

In every one of these cases the handler proceeds to `kuali-finalization`, which **fills and saves** the
Kuali form — Termination Effective Date, the *Submitted Termination Template* checkbox, the final-pay
radio, comments — with the Transaction Number left blank
(`legacy:src/workflows/separations/steps/kuali-finalize.ts:54-57`). Only then does the run throw
(`legacy:src/workflows/separations/workflow.ts:1236-1242`).

This is documented as intentional — "the form was saved blank for manual entry" — and the throw
(added 2026-06-18) was itself a fix for a run that previously reported **Done**
(`legacy:src/workflows/separations/CLAUDE.md:212`). But the durable outcome is: *a Kuali separation
document asserting a termination template was submitted, saved, when no UCPath transaction exists.*

> **Question for the operator:** is "save the Kuali form blank for manual entry" what you want when
> UCPath fails? Or should the Kuali doc be left completely untouched so the retry is clean?

#### S51 — the one place legacy refuses to guess `sound`

```ts
// legacy:src/systems/ucpath/transaction.ts:869-878
if (outcome === "timeout") {
  const confirmed = await okMarker.first().isVisible().catch(() => false);
  if (!confirmed) {
    throw new Error(
      `Save and Submit timed out with no error banner and no confirmation OK dialog … —
       PeopleSoft's outcome is unknown, refusing to report success.`);
  }
}
```

A timeout is not a confirmation. `clickCreateTransaction` carries the identical guard
(`legacy:src/systems/ucpath/transaction.ts:229-241`). This is the shape the rebuild's write kernel
already formalizes — worth calling out as the one legacy control that generalizes cleanly.

#### S49 — the Last Date Worked read-back `sound`

`fillTerminationLastDateWorked` (`legacy:src/systems/ucpath/transaction.ts:587-629`) checks the override,
waits for **that control's own PeopleSoft fragment refresh** (the checkbox round-trips; the date input
does not), re-resolves both controls after the refresh, and asserts checked + exact value before the
submit can proceed (`legacy:src/systems/ucpath/transaction.ts:520-538`).

Legacy's own note is the useful part: this write *"was broken from the day it shipped — both its
selector and its refresh rule were mapped on a read-only record — and every separation failed at the
readback until it was fixed live"* (`legacy:src/workflows/separations/CLAUDE.md:152`). **A selector
mapped on a read-only page is not a verified selector for the editable page.**

### Kuali finalization

#### S58 — the final-pay radio is hardcoded `silent-risk`

```ts
// legacy:src/systems/kuali/navigate.ts:510-512
log.step("  Selecting Final Pay: Does not need Final Pay (student employee)...");
await transactionResults.doesNotNeedFinalPayRadio(page).check({ timeout: 5_000 });
```

Selected for **every** separation, with no reference to whether the employee is a student, what their
job code is, or anything the run read. There is no comment justifying it and no test asserting the
choice is correct — only that the fill happens.

> **Question for the operator:** is "does not need final pay (student employee)" always correct for RRSS
> separations, or is it a same-in-practice shortcut that would be wrong for a career employee?

#### S59 — `clickSave` is not verified `silent-risk`

```ts
// legacy:src/systems/kuali/navigate.ts:634-651
export async function clickSave(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await safeClick(save.navbarSaveButton(page).first(), { timeout: 10_000, … });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  log.success("Kuali form saved");
}
```

A click, a swallowed network wait, a fixed 2 s sleep, and a success log. **Nothing is read back.** The
`networkidle` failure is caught and discarded, so even a hung save prints "Kuali form saved".

The rebuild has already proved this exact hazard on this exact system: D128 — a Kuali save that answered
`200`, rendered `Form saved`, and persisted nothing. Legacy would have reported that as a completed
separation. The one partial mitigation is `verifyTxnNumberFilled`, which re-reads the transaction number
**before** the click and refuses to save with a blank one
(`legacy:src/systems/kuali/navigate.ts:602-624`) — a pre-save check, not a post-save proof. The
`kuali-finalization-saved` screenshot is likewise taken **before** the click, deliberately, because a
successful save navigates away (`legacy:src/workflows/separations/steps/kuali-finalize.ts:86-97`).

> **Question for the operator:** after a Kuali finalization save, what is the cheapest way to *prove* it
> landed — re-open the doc and re-read the Transaction Number, or check for a workflow-step transition?
> This is the single most important read-back the rebuild has to design.

#### S60 — the partial-completion state `fragile`

UCPath submitted → real termination filed → `kuali-finalization` throws (department mismatch, comments
read failure, save click failure). The run lands `failed`.

What the operator has: the transaction number **is** on the row — `ctx.updateData({ transactionNumber })`
is called inline at both UCPath success points, precisely so a later finalization failure cannot drop it
(`legacy:src/systems/ucpath/transaction.ts` via `legacy:src/workflows/separations/steps/ucpath-transaction.ts:101, 189`;
rationale at `legacy:src/workflows/separations/CLAUDE.md:221`). Recovery is edit-and-resume: re-run with
`transactionNumber` prefilled, which skips `identity-check`, `transaction-check` **and**
`ucpath-transaction`, and re-runs only the Kuali finalization
(`legacy:src/workflows/separations/workflow.ts:1127-1136`).

What the operator does **not** have: any named state saying "UCPath done, Kuali not". The row says
`failed` with an error string; the distinction lives in the operator's head.

> **Question for the operator:** should "UCPath filed, Kuali not finalized" be a first-class outcome the
> rebuild surfaces by name, with a one-click resume?

### Cross-cutting

#### S61 — dry-run writes to Kuali `fragile`

The dry-run terminal sits after date reconciliation and before both commits
(`legacy:src/workflows/separations/workflow.ts:1042-1074`), skipping `ucpath-transaction` and
`kuali-finalization`, and `transaction-check` guards its delete
(`legacy:src/workflows/separations/steps/transaction-check.ts:146-164`). Two writes **do** still happen
on the unsubmitted Kuali draft: the timekeeper-name fill bundled into `kronos-search`, and the `similar`
name correction (`legacy:src/workflows/separations/workflow.ts:1038-1041`).

The safety argument is that a draft commits nothing because the doc is never saved. That argument is
**stated, never verified** — nothing in the code confirms Kuali Build does not autosave, and no test
asserts the draft is discarded.

> **Question for the operator:** does an abandoned Kuali Build draft really discard its edits? If you
> open one of the dry-run docs, is the timekeeper name blank?

#### S62 — blind dialog acceptance `silent-risk`

```ts
// legacy:src/workflows/separations/steps/kuali-extract.ts:36-39
const ucpathPage = await ctx.page("ucpath");
const dialogHandler = (d: Dialog) => d.accept().catch(() => {});
ucpathPage.on("dialog", dialogHandler);
```

Registered for the duration of `kuali-extraction` and removed in `finally` (line 82), so the blast radius
is bounded. But within it, **any** UCPath dialog is accepted, sight unseen, on the system that files
terminations, and a failure to accept is discarded. The stated purpose is clearing a confirmation modal
left over from a previous doc in batch mode (lines 24-26).

#### S63 — recovery model `fragile`

There is no durable step state. A retry re-runs the whole handler from step 0 and reconverges through
the live UCPath probes (`legacy:src/workflows/separations/CLAUDE.md:220`). Retry is operator-initiated —
the runtime policy exposes retry/cancel/delete/bump as row actions
(`legacy:src/domain/workflow-runtime/default-policy.ts`, `DEFAULT_ROW_ACTIONS`), and the separations
workflow takes the default (`legacy:src/workflows/separations/workflow.ts:127-128`).

### What the operator actually sees, per failure class

| Failure class | Run status | Signal to the operator |
|---|---|---|
| Entry / preflight throw (S1, S7, S8) | `failed` | Step name + error string on the row; error screenshot |
| Identity fail-loud (S19, S20, S21, S23, S24) | `failed` | Same; messages are explicit and actionable |
| Identity mismatch (S17) | **`done`** | Amber "Awaiting Approval" row + `EidApprovalBanner` with both identities |
| Kronos rejection (S35, S36, S37) | **`done`** | **A red log line only.** Row reads as a normal success |
| UCPath soft failure (S47, S50, S53) | `failed` | Error string + screenshot — *after* the Kuali form was saved blank |
| UCPath fatal (S48, S49, S51, S52) | `failed` | Typed, self-explanatory message + screenshot; Kuali untouched |
| Kuali save that silently did nothing (S59) | **`done`** | **Nothing.** Reported as a completed separation |

Step failures are emitted with the step name and an error screenshot by the kernel stepper
(`legacy:src/core/kernel/stepper.ts:11, 20-21, 195-198`). The three **`done`** rows in that table are the
rebuild's targets: two of them are runs that produced wrong or unverified real-world effects while
reporting success.

---

## 4. The dangerous patterns found

Ordered by how much damage the pattern can do, with the minimum quotation needed to identify it.

### D1 — a default reason code for an unmapped termination type

```ts
// legacy:src/workflows/separations/schema.ts:213-222
const lowerType = terminationType.toLowerCase();
for (const [kualiType, ucpathReason] of Object.entries(REASON_CODE_MAP)) {
  if (lowerType.includes(kualiType.toLowerCase()) || kualiType.toLowerCase().includes(lowerType)) {
    return ucpathReason;
  }
}
return "Resign - No Reason Given";
```

A substring match in **either** direction, then a hard-coded default, feeding a **real UCPath
termination reason**. `"Other"` → `Resign - Accept Another Job` (via "an*other*"). Anything unmatched →
a voluntary resignation. No warning is logged on either path.

### D2 — a failed timecard read produces a `Done` run

```ts
// legacy:src/workflows/separations/workflow.ts:878-880
} else {
  logSettledRejection("New Kronos", phase1.newK);
}
```

```ts
// legacy:src/workflows/separations/settled.ts:8-12
const classified = classifyPlaywrightError(result.reason);
log.error(`[${label}] ${classified.kind}: ${classified.summary}`);
log.debug(`[${label}] full error: ${errorMessage(result.reason)}`);
return true;
```

The returned boolean is checked for the Kuali timekeeper branch (which throws) and **ignored** for New
Kronos. The known cost: 20 of 21 docs in one live batch, and three Kuali documents (4445, 4461, 4471)
edited with an audit comment citing a timesheet that was never opened
(`legacy:src/workflows/separations/CLAUDE.md:199-200`).

### D3 — an unverified Kuali save reported as success

```ts
// legacy:src/systems/kuali/navigate.ts:648-651
await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(2_000);
log.success("Kuali form saved");
```

Swallowed wait, fixed sleep, unconditional success log, zero read-back. The rebuild has already
demonstrated (D128) that Kuali can answer `200`, render `Form saved`, and persist nothing.

### D4 — the blanket catch that lets Kuali be written for a transaction that does not exist

```ts
// legacy:src/workflows/separations/steps/ucpath-transaction.ts:207-215
if (e instanceof EmplIdNotRecognizedError || e instanceof LastDateWorkedVerificationError) throw e;
log.error(`[UCPath Txn] Failed: ${errorMessage(e)}`);
await ctx.screenshot({ kind: "error", label: "ucpath-transaction-failed", … });
```

Two typed errors escape; **everything else** is swallowed, and `kuali-finalization` proceeds to save the
document. The run does eventually fail — but only after the write.

### D5 — "no results surfaced within the timeout" reported as a factual negative

```ts
// legacy:src/systems/new-kronos/navigate.ts:174-178
log.warn(`[New Kronos] No search results surfaced for ${employeeId} within the timeout —
  treating as NOT FOUND (best-effort; Kuali Last Day Worked will be used).`);
return false;
```

The identical text appears in the older race-based path at
`legacy:src/systems/new-kronos/navigate.ts:195-200`. Absence of evidence is returned as evidence of
absence, and the caller then marks the timecard as *read*.

### D6 — an unreadable transaction receipt treated as "no transaction"

```ts
// legacy:src/systems/ucpath/transaction.ts:1128-1129
log.warn(`[Txn Lookup] Matched row but couldn't extract Transaction ID from detail page —
  treating as no match`);
return { txnNumber: null, alreadyAtSmartHR: false };
```

In a function whose own doc comment says reading a failed lookup as "no existing transaction" *"would
clear the way for a second real duplicate termination"* (lines 1048-1053).

### D7 — the identity gate is switchable off by a run mode

```ts
// legacy:src/workflows/separations/workflow.ts:578
const identitySkipped = txnNumberPrefilled || kronosSkippedByInput;
```

Derived from a *date*-related skip. "Transactions only" and any LDW prefill silently disable the control
that exists because of `T002173685`.

### D8 — a name rewrite with no review

```ts
// legacy:src/workflows/separations/workflow.ts:635, 645-648
const correctedName = correctNameSpelling(kualiData.employeeName, jobSummaryName);
const kp = await ctx.page("kuali");
await updateEmployeeName(kp, correctedName);
kualiData = { ...kualiData, employeeName: correctedName };
```

Triggered at ≤2 Levenshtein edits per token (`legacy:src/services/matching/match.ts:78, 143-154`), it
edits the live document and, in doing so, makes the two records agree — removing the evidence that they
ever disagreed.

### D9 — an unconditional business assertion on the form

```ts
// legacy:src/systems/kuali/navigate.ts:512
await transactionResults.doesNotNeedFinalPayRadio(page).check({ timeout: 5_000 });
```

### D10 — blind dialog acceptance on the termination system

```ts
// legacy:src/workflows/separations/steps/kuali-extract.ts:37
const dialogHandler = (d: Dialog) => d.accept().catch(() => {});
```

### D11 — swallowed best-effort blocks (lower severity, listed for completeness)

- `legacy:src/workflows/separations/workflow.ts:1002-1014` — the Kronos scroll + audit screenshot,
  wrapped in `try { … } catch { /* best-effort */ }`. Losing the *evidence capture* for the chosen Last
  Day Worked is silent.
- `legacy:src/workflows/separations/steps/transaction-check.ts:86-88` — the SS Smart HR audit screenshot,
  same shape.
- `legacy:src/workflows/separations/steps/ucpath-transaction.ts:223-228` — the batch-mode re-navigation,
  `catch { /* Non-fatal — the between-items reset will retry */ }`.
- `legacy:src/systems/ucpath/job-summary.ts:777-787` — `extractEmployeeName` returns `""` on a missing
  header. Benign only because `""` classifies as `different`, which routes to the approval gate rather
  than past it — worth preserving that property deliberately rather than by luck.
- `legacy:src/workflows/separations/cli.ts:29, 60` — session-dir cleanup, `catch { /* non-fatal */ }`.

---

## 5. Open items — `unknown — needs live observation`

1. **The complete Kuali *Type of Termination* option list.** Not recorded anywhere in the legacy repo.
   Required before the Vol/Invol and reason-code mappings can be made exhaustive (S9/S10/D1).
2. **Whether an abandoned Kuali Build draft discards its edits.** The dry-run safety argument depends on
   it and nothing verifies it (S61).
3. **Whether a save that "succeeded" actually persisted.** No read-back exists, so there is no legacy
   evidence either way (S59/D3).
4. **The already-terminated single-row case.** Whether UCPath auto-redirects for a terminated
   single-record employee, and therefore whether the all-terminated guard is reachable at all (S22).
5. **Whether `T002173685` has been reversed** and whether student `10833507` was ever separated
   (`legacy:src/workflows/separations/CLAUDE.md:204`).
6. **The SS Smart HR *search* results-grid scan.** Legacy flags it as still needing live verification —
   the in-progress grid was live-verified 2026-06-24, the search grid was not
   (`legacy:src/workflows/separations/CLAUDE.md:80`).
7. **Whether filling the Kuali department first still leaves the dropdown set** after the timekeeper and
   date writes (`legacy:src/workflows/separations/CLAUDE.md:104`).
