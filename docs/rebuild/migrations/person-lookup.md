# Person Lookup - Phase 3 Search + Match acceptance record

**Status:** admitted in Phase 3; workflow-specific intake completed 2026-09-02. Current-source
verification is pending in doc 03.2 Task 5-1; controlled acceptance closes in doc 03.3 Task 4.

**Plan owner:** `docs/rebuild/03.2-finish-workflow-authoring.md` Task 5-1 and
`docs/rebuild/03.3-accept-person-lookup-and-separations.md` Task 4

**Inherited contracts:** ref charter §1/§3/§8; ref workflow-model §1.6/§8; ref task-contract
§2.7/§2.8/§3.1; ref stores §2; ref dashboard-surfaces §9; ref guards-and-tests §10.11;
ref operator-trust §3.2

**Post-base authority amendment:** integration commit `1273c360`, ref workflow-model
§1.6.1/§5.6.1/§5.8 and D312–D316

This record covers Search and Match as two modes of the existing `person-lookup` workflow. It does not
claim current acceptance from the historically landed D311–D318 implementation; its remaining
verification obligations are pinned to doc 03.2 Task 5-1. The live-proven UCPath Person
Organizational Summary + CRM flow remains the base; Phase 3 adds the legacy HR Tasks Match question
without minting a second workflow identity. D319 keeps this work inside Phase 3 acceptance and does
not pair it with the unadmitted I-9 candidate.

## 1. Workflow-specific decisions and §b completeness

There are no unresolved `you:` lines. The owning phase and inherited platform contracts settle the
workflow identity, effect class, proof tier, and authoring boundary. The items below record only the
workflow-specific deltas.

| §b item | Person Lookup answer |
|---|---|
| 1. Real commits | None. Search and Match are pure reads. No transaction, mutation capability, prepare/commit pair, lease, idempotency key, or external write is permitted. |
| 2. Completion check per submit | Not applicable: there is no submit. Terminal results are read evidence, not a receipt/save/upload proof. |
| 3. Double-submit probe and budget | Not applicable: there is no transaction node or fence. |
| 4. T1b live proof | **RESOLVED and implemented by D318; current acceptance pending.** This zero-transaction workflow uses the explicit `live-read` arm with `dryRun=false`, graph admission proving no transaction node and exact zero deltas in all three write-authority tables. D209 still refuses transaction preview as `no-transaction-node`. |
| 5. Freshness maxAges | The write-feeding freshness question is not applicable because no output feeds a write in this workflow. Each browser read still owes the normal task provenance/read-time evidence and strict output validation from ref task-contract §2.7. |
| 6. Workflow-specific gates/data | No identity/OCR/normalization gate and no test-vs-production instance choice. Preserve the existing typed name/EID ingress and spreadsheet intake for Search. Match gets its own mode-specific typed input/parser; a file or caller cannot select a mode by smuggling data into another field. |
| 7. Reuse map | REUSE `ucpath/search-person-org` and `ucpath/read-job-summary` unchanged. CUSTOMIZE the existing semantic-ready UCPath driver with an HR Tasks Search/Match operation, then BUILD the missing reusable `ucpath/search-hr-tasks-person` read task and its strict contract. Preserve the two distinct UCPath surfaces behind one workflow id. No copied selector or legacy function name becomes a new domain concept. See §2. |
| 8. Local artifact effects | None. Neither mode downloads bytes nor updates a mutable local file. |
| 9. Scenario inventory | §3 is the required structural/live matrix. Negative and impossible-world variants stay synthetic; live cases correspond only to truthful registry arms. |
| 10. Delegation and queue | Keep the existing standalone workflow and `reject-active` enqueue policy. D315 requires every workflow operation to be an explicit stable-id `task(...)` entry; there are no `parallel`, `delegate`, `gate`, or `transaction` entries, child edges, or joins. Both modes remain rows of `person-lookup`, never child workflow identities. |
| 11. Trust contract | Inherit ref operator-trust §3.2 and ref guards-and-tests §10.11. The workflow-specific delta is that each mode preserves its typed result/evidence, and a Match lookup/page failure is `unknown/failed`, never no-match. |
| 12. Authoring boundary | Source-authored. D312's strict four-artifact cap applies to a reuse-only workflow. Person Lookup's workflow surface is `src/workflows/person-lookup/workflow.ts`, the structural scenario, the live declaration, and this migration record; Match may additionally add only the genuinely new behavior-owned reusable task/driver files named in §2. No descriptor/module/registry/dashboard glue is authored elsewhere. |

## 2. Mode and task delta

One descriptor must expose two run-modal options (`ref dashboard-surfaces` §9, D15):

| Mode | Question and surface | Input/subject | Task seam | Result obligation |
|---|---|---|---|---|
| `search` | Resolve a person and status through Person Organizational Summary, with the existing CRM cross-verification/date option. | Existing canonical name-or-EID union; queue subject remains the searched EID/name until verified replacement. | REUSE `ucpath/search-person-org`, CRM reads, and `workflow:person-lookup/read-active-status`; retain the historical Search graph and behavior. | Preserve the existing selected/not-found/ambiguous refusals, CRM evidence, active-state result, and optional dates arm. |
| `match` | Answer the rehire-vs-new-hire matching question on UCPath HR Tasks Search/Match. This is not Person Organizational Summary. | A strict mode-specific person record: name plus DOB and/or SSN as the live surface requires; legacy `x` means unavailable and cannot become stored identity data. The final contract must reject when both match identifiers are absent. | CUSTOMIZE the UCPath driver with one typed HR Tasks Search/Match operation and BUILD `ucpath/search-hr-tasks-person`; reuse `ucpath/read-job-summary` wherever the workflow needs the already-rich Job Summary page rather than rescraping it. Pure interpretation belongs in a sessionless `workflow:person-lookup/derive-match-result` task. | Return a typed match/no-match/ambiguous/unknown result with the observed candidate evidence; never select the first candidate or convert a page/selector failure into no-match. |

Legacy evidence is frozen data, not a runtime dependency. Ported HR Tasks facts cite legacy commit
`9d19e4141d57617e2bf895e21e34a5bd8f15047c` plus the exact source blob used; current anchors are
`src/workflows/person-lookup/match.ts` at `a1191411148add3ea4b5c0e2fc970ae74d1f99b6`
and `src/systems/ucpath/navigate.ts` at
`773b52873f3c59ccc2498a51d60ac5834b2608e1`. Every selector is re-verified live before porting
(D150); the legacy value is provenance, not proof of current page state.

### D312–D316 workflow-definition acceptance

Applied to Person Lookup, the owner text at `1273c360` means:

- every executable entry is a stable-id `task(...)`; no parallel/delegate/gate/transaction entry;
- neither mode declares an omission or replacement-value schema, and there is no write-sensitive
  assertion/verifier inside this read-only workflow (a future writing parent owns its verifier);
- Match's genuinely new reusable task/driver files are behavior additions, not workflow glue; and
- Person Lookup is D316's minimum conversion: preserve public descriptor/module/wire behavior, then
  delete the superseded declarations and duplicate generic-surface tests.

## 3. Proof and scenario matrix for Phase 3.2 Task 5-1

| Proof | Required cases |
|---|---|
| T1 structural — Search | EID and name ingress; unique selection; no result; multiple/ambiguous result; CRM found/missing; CRM transient retry and permanent failure; UCPath drill subject mismatch; optional CRM dates included/not requested; crash after a checkpoint followed by checkpoint resume that replays valid ancestors but executes the `always-rerun` active-status ancestor again; restart from start as the same logical item/new attempt, rerunning every read/compute from pristine input; every declared conditional/refusal/result arm. Reuse and relocate current useful scenarios rather than freezing legacy implementation trivia. |
| T1 structural — Match | DOB+SSN, DOB-only, and SSN-only accepted forms that the final strict schema admits; both identifiers absent rejected at ingress; unique match; no-match; multiple/ambiguous candidates; malformed result grid; subject mismatch; transient retry; permanent auth/page/schema failure; result/probe unknown; crash after the read checkpoint followed by checkpoint resume; restart from start as the same logical item/new attempt with the Match reads and terminal compute executed again. |
| T1b live — Search | Required by doc 03.2 Task 5-1/ref guards-and-tests; §4 records the D209 resolution and existing evidence. Current acceptance must reverify it against the candidate being frozen, using current registered Search subjects only for truthful input arms and recording reached/excluded nodes, checkpoints, verdict and zero write-authority deltas. |
| T1b live — Match | Required under D318's `live-read` arm. Use a dated current HR Tasks record whose secret-backed name/DOB/identifier inputs exercise one eligible Match result without exposing values in committed evidence. |
| T2 — mode chooser | The run modal serves Search and Match as two options of the one `person-lookup` workflow, with mode-specific labels, input instructions/parsers, and no duplicate registry/archive/Explorer identity. |
| T3 — live mode condition | Required for the new mode interaction. Start each mode through the real ceremony and prove the selected mode controls the expected title/input contract and timeline/result while the durable workflow id remains `person-lookup`. Ordinary generic surfaces need no duplicate feature proof. |

No transaction/probe/commit crash window exists because neither mode has a transaction node. Gate,
delegation/join and commit-proof branches are also impossible by declared graph shape; they are not
manufactured as scenarios. D314 still requires two distinct recovery proofs: checkpoint resume
replays valid checkpoint ancestors, executes every `always-rerun` ancestor again (including Search's
active-status read), and retries from the failed task; restart from start mints the same logical
item's next attempt, ignores the old read/compute checkpoints, and executes all reads and
computations again. Both preserve the admitted mode/input; neither may become different-input rerun.

Task 5-1 may add public labels to `config/test-subjects.json` only after same-day availability checks.
All person values that feed live identity/search remain in ignored configuration through
`src/domain/secrets.ts`; the committed registry contains references, availability, purpose, and
cleanup/read-only obligations only. A missing, gone, unknown, or incomplete subject is `blocked`
before browser start, never converted into a fixture or a failed run.

### Outcome confidence

| Mode/outcome | Confidence | Required evidence |
|---|---|---|
| Search `active` / `inactive` | `verified` | Resolved UCPath candidate, CRM observation and the typed active-status fold agree on identity and produce the stated result. |
| Search `undetermined` | `partial` | The successful reads and the reason for the missing/conflicting conclusion are retained, but the workflow cannot verify active status. |
| Search `not-found` | `verified` search outcome; run refuses | UCPath search completed with zero candidates. Downstream bindings do not fabricate a selected person. |
| Search `ambiguous` | `partial`; run refuses | UCPath returns two or more candidate EIDs and no selected person; evidence proves ambiguity, not identity. |
| Match `match` / `no-match` | `verified` | The live HR Tasks result grid or definitive no-matching-person dialog settled, and the task retained the observed subject/candidate evidence. |
| Match `ambiguous` | `partial`; run refuses | More than one plausible candidate is retained with no automatic first-row selection. |
| Either mode `unknown` / failure | `unknown` | Auth, page, selector, schema, subject, or outcome-race evidence did not support a trustworthy business result. The run fails with that evidence. |

## 4. D318 — read-only T1b contract resolved

The operator selected option A on 2026-09-02. Person Lookup's T1b declaration uses the explicit
`live-read` arm. Admission requires its compiled graph to contain zero transaction nodes, starts the
ordinary read execution with `dryRun=false`, records the ordinary terminal result/receipt and proves
exact before/after zero deltas in `write_intents`, `write_attempts` and `durable_outbox`. D209 remains
unchanged: requesting transaction preview still refuses `no-transaction-node`. Adding a no-op
transaction, using the preview-result schema or waiving live proof are forbidden.

**Built and proved live (R3, 2026-09-02).** The manifest is
`tests/scenario/workflows/person-lookup/dry-run.scenario.ts` (`arm: "live-read"`, one case
`search-by-eid` on the registered label `person-lookup-canary`, whose EID is the closed reference
`personLookupCanaryEid` / `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID` in ignored `.env`). The
runtime refuses a `live-read` manifest whose compiled graph carries a transaction node and a
`dry-run-preview` manifest whose graph carries none, before any browser; both refusals and the
whole arm are pinned deterministically by `tests/unit/dry-run-scenario-live-read.test.ts`.

The exact command `npm run cli -- dry-run-scenario person-lookup --subject person-lookup-canary`,
run from the R3 worktree's own isolated authority (`.tracker-rebuild/state.db`, activated once by a
dashboard boot), produced durable result **`ece2c933-d4d5-48cd-b76a-8270646a30f0`** — verdict
**`met`**, arm `live-read` — for run **`c1f4ad74-4108-4aae-a5a1-9f84e2758ced`** / trace
**`pl-195040-c1f4`**, attempt 1, `dryRun: false`, terminal `done` after 41,418 ms. All seven
assertions met: `nodes-reached` (`searching`, `cross-verify`, `active-status`), `nodes-excluded`
(`crm-dates` skipped on its declared condition), `checkpoints` (three attempt-1 rows keyed with
`claimGeneration`), `gate-results` (none), `write-safety-deltas` (exact 0 / 0 / 0 over
`write_intents`, `write_attempts`, `durable_outbox` for this run's intent set; the whole authority
database also held 0 / 0 / 0 rows), `receipt` (`verified-done` / `verified`, receipt
`d03df065-1aaf-5d6f-a31e-22fff735af48`, the seven pinned obligations), and `terminal` (the
workflow's OWN result, bound to its declared result schema, `activeStatus.state = active`,
`crmDates.state = not-requested`). Two earlier same-day attempts of the same item are recorded in
the superseded state root only: the first completed `done` but its result row was refused by the
pre-fix binding that required `dryRun: true`; the second was attempt 2 and correctly replayed its
reads, which a first-attempt manifest cannot match. The availability claim in
`config/test-subjects.json` cites this run.

## 5. Capability and close evidence

`legacy-workflow-person-lookup` stays `open` during acceptance. It may close only after Task 5-1 verifies both
modes, T1/T2/T3 and live evidence, updates the derived capability entry with those commits/results,
proves public descriptor/module/wire equivalence, and deletes the superseded authoring path and
duplicate generic-surface tests as D316 requires. Production routing remains on legacy until the
all-at-once cutover (D89/D93).

## 6. Evidence log

- 2026-09-02 — intake reconciled against the former doc 03c Order 1/§b, the current mode-less
  `src/workflows/person-lookup/descriptor.ts`, ref stores and the frozen legacy sources above.
  At that date, implementation and live mode proof remained open for R3.
- 2026-09-02 — amended against ratified D312–D316 owner text at integration commit `1273c360`:
  exact workflow artifacts, task-only recipe entries, no omissions, both recovery choices, and
  equivalence-then-deletion acceptance are now explicit. At that date, D209/T1b remained
  unresolved.
- 2026-09-02 — R3 built D318's `live-read` arm and ran it live: result
  `ece2c933-d4d5-48cd-b76a-8270646a30f0` `met` for run `c1f4ad74-4108-4aae-a5a1-9f84e2758ced` /
  trace `pl-195040-c1f4` (§4). The canonical T1 pair now lives under
  `tests/scenario/workflows/person-lookup/`. Match mode, T2/T3 and the capability close remained for the next acceptance run.
- 2026-09-05 — D329 routing refresh: the 2026-09-02 run remains historical evidence; doc 03.2
  Task 5-1 owns current Search/Match acceptance and doc 03.3 Task 4 owns final capability closure.
