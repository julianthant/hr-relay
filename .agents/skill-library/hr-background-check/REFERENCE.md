# `background-check` workflow resource

> Internal repository playbook selected by `hr-manage` for `background-check`, Background Check,
> and batch background-check requests. It is not an independent operator command.

**Status: proposed dashboard workflow; not implemented or runnable.** The delivery owner is
[Phase 4.1](../../../docs/rebuild/plans/phase-4/4.1-background-check/README.md). This resource
describes the intended reusable behavior and labels unverified implementation details explicitly.
It contains no current applicant worklist, submission authorization or claim of automated acceptance.

**What it does.** The proposed workflow prepares a UCSD Human Resources background-check request
from a selected applicant cohort and validated request settings. It reads a roster artifact, derives
the applicant set and creates a separate request workbook for dashboard review. After approval of
the exact cohort, settings and workbook, it uses the ServiceNow Employee Center to attach the
approved artifact and submit the request through controlled write boundaries. Its intended terminal
result is a verified request receipt with applicant membership and artifact provenance, not a
background-check clearance decision. SharePoint is a possible source/review integration; it is not
required for a locally supplied roster unless the admitted workflow explicitly needs it.

## Graph (as built)

**UNKNOWN — no Background Check definition, descriptor or module exists.** The registered graph
has zero Background Check nodes, gates or transactions. There are no implemented contract IDs,
permanent keys, `when` clauses or result schemas to list.

Current authoring uses a `workflow.ts` definition compiled into descriptor/module views at
[the workflow registry](../../../src/control/workflow-registry.ts), rather than requiring separately
authored descriptor/module files. Follow the existing
[Person Lookup definition](../../../src/workflows/person-lookup/workflow.ts) and
[workflow-authoring guide](../../../docs/rebuild/guides/workflow-authoring.md) when implementation is admitted.

The [ServiceNow store](../../../src/stores/servicenow/index.ts) and
[SharePoint store](../../../src/stores/sharepoint/index.ts) both have empty task maps and unwired
drivers. Their session-provider shells exist, but that does not establish a working authenticated
driver. Neither store currently has a store-specific AGENTS.md or Background Check task binding.

### Proposed operator flow — not registered node IDs

| Timeline group | Intended work | Evidence/output |
| --- | --- | --- |
| Applicant intake | Read the source, preserve selection-relevant formatting, validate applicants and freeze membership | Source version/digest, row identities, selection reasons and validation findings |
| Request preparation | Apply a validated request profile and generate a separate template-based workbook | Exact artifact bytes/digest, settings and service selections |
| Review | Show applicants, findings, settings and workbook; obtain approval bound to those exact values | Server-computed gate packet/result; edits invalidate approval |
| HR request | Verify the Employee Center form, attach the approved artifact, inspect Summary and submit | Declared write intents, attachment identity, request identity and source read-back |
| Receipt and recovery | Confirm the request, retain evidence and reconcile retries/uncertain writes | Typed terminal receipt or an explicit unresolved/parked state |

**UNKNOWN — Task 4.1.1 must ratify the ordered entry kinds and write boundaries.** Attachment upload,
draft creation and optional cloud review-copy creation can be external writes even before Submit.
Do not hide them in a read task or assume that a non-submitting browser session is commit-free.
The permanent key must identify the approved logical request and its cohort without changing on
retry; its schema and the source-system lookup capable of reconciling it remain unverified.

## Inputs & subjects

- Run modal / `surfaces.inputRun`: **UNKNOWN — no declaration exists.** Proposed input is a roster
  artifact or an explicitly configured SharePoint source, worksheet/range, an explicit applicant
  selection rule and a validated request profile. Determine the generic intake surface needed in
  Task 4.1.1; do not assume the current dashboard already supports workbook upload for this workflow.
- Initial supported path: multiple applicants. The observed portal label is **Multiple Applicants
  (10 or more)**. Single-applicant support and smaller-cohort handling are **UNKNOWN — resolve
  scope and verify those paths before declaring them supported**.
- Applicant fields: explicit legal first/last name and email, plus the job/category mapping needed
  by the request. Preserve original source names; ambiguous splitting requires correction. Do not
  copy unrelated roster columns such as SSNs or temporary passwords into the request or logs.
- Selection: when the operator chooses yellow cells in **Date Background Entered**, preserve and
  evaluate the actual cell fill. CSV has no fill information and cannot establish that membership.
  Blank dates, accepted terms or current table visibility are not substitutes for the selection rule.
  Preserve source row provenance and report duplicates and incomplete data explicitly.
- Request profile: job number mapping, job title, department, project/task funding, supervisor name
  and email, result recipients and requested services. These are validated settings/run inputs;
  do not hardcode one cohort's contacts or funding. The demonstrated service is the Universal
  Background Check for positions posted on/after 12/1/24 with SB791 compliance. Other services must
  not become selected merely because their columns exist in the template.
- Template: create a separate copy of the current approved multi-user workbook. Preserve column
  widths, row heights, header/body formatting and browser-visible service markers. Preserve both
  the source roster and shared original. Template identity and field-map compatibility must be checked.
- Canary subjects: **UNKNOWN — no Background Check label exists in the public
  [subject registry](../../../config/test-data.json).** Provision an operator-approved test target
  and its safe disposition through [the typed test-data reader](../../../src/control/test-data.ts)
  before live write proof. Existing Person Lookup/Separations labels are not substitutes.
- Subjects that must not be used: an ordinary applicant cohort is not an implied controlled-write
  target. Burnt/submitted Background Check subjects are **UNKNOWN — there is no migration live
  record yet; inspect the source system and approved target record before any write**.

## Run it (details in hr-manage)

**Blocked: workflow not registered.** Do not start a worker or submit a start plan for this proposed
id. After implementation and acceptance, use [hr-manage](../../skills/hr-manage/SKILL.md) for the
dashboard/worker lifecycle, fingerprint checks, start-plan commands and authority inspection.
Dry run is the default; a real write requires explicit authorization for the exact controlled target.

Observed manual navigation: UCSD support services → Human Resources → search **background check
request** → **Talent Management / Talent Support Services – Request Forms** → **Background Check
Request** → **Multiple Applicants**. The request then exposes a workbook attachment and result
recipients before Summary. Reverify the actual catalog item and configured route; the existing
ServiceNow system entry setting is not evidence that it points to this form.

Gate ceremony: **UNKNOWN — no implemented gate exists.** The proposed review shows the selected
applicants, unresolved findings, profile, service choices and exact artifact. Approval must be
server-computed and bound to that snapshot. A changed workbook or profile requires a new review;
opening/editing an online workbook does not update a separately uploaded attachment.

## Dry run must show (assert over authority, not logs)

- Nodes reached/excluded: **UNKNOWN — fill from the compiled definition and scenario manifest.**
  Required behavior is genuine read/validation/workbook preview and authenticated form inspection,
  with no external attachment upload, cloud-copy creation, draft persistence or request submission.
  If the portal cannot expose a later state without a write, report that preview boundary explicitly.
- `run_checkpoints`: **UNKNOWN — derive expected read/derive/gate rows and transaction exclusions
  from the admitted graph.** Do not fabricate node names or treat a transaction-preview checkpoint
  as proof of a commit. Resume must enforce the producing contract/fingerprint requirements in
  [workflow-model §5.4](../../../docs/rebuild/reference/workflow-model.md).
- `gate_results`: **UNKNOWN — declare the review-gate behavior and expected row in the scenario.**
- `write_intents` / `write_attempts` / `durable_outbox` deltas: **0**, attributed to the tested
  run's intent set. A count across unrelated concurrent runs is not a valid delta.
- Receipt shape / preview terminal: **UNKNOWN — define a typed preview that says no request was
  submitted, and a distinct verified receipt for a real request.** Never manufacture a request ID.
- `explain run` must expose source/artifact provenance, membership, validation, review state and
  preview/write disposition after those contracts exist. Run/trace IDs and durable evidence are not
  available for the manual demonstration.

## Tests it owes

No Background Check scenarios exist in [the scenario tree](../../../tests/scenario).
Follow [guards-and-tests §10](../../../docs/rebuild/reference/guards-and-tests.md).

- T1a structural: **OWED** — compiled definition, declared task-store bindings, gates and transactions.
- T1b dry-run manifest: **OWED** — reached/excluded nodes, authority checkpoints, zero write deltas,
  and no external persistence; include failure and resume paths.
- T2 dashboard: **OWED** — start, invalid input, workbook preview, corrections, approval invalidation,
  cancellation, receipt, Archive and UNKNOWN resolution through generic surfaces.
- Pure/unit tests: **OWED** — color selection and CSV refusal, explicit name validation, duplicates,
  request-profile mapping, deterministic workbook bytes/content, visible service selection, stable
  request identity and stale-artifact refusal. Use synthetic applicant fixtures.
- Controlled write: **OWED** — mismatch refusal before fencing, one source-verified request, permanent
  already-present replay, failure around upload/submit, reconciliation and approved target disposition,
  under [write-safety §3.2](../../../docs/rebuild/reference/write-safety.md).
- Implementation gates: `npm run typecheck`, `npm run lint`, `npm run test:coverage`; refresh/check
  the build manifest when the descriptor import closure changes. Platform run/session behavior remains
  owned by [execution-and-sessions](../../../docs/rebuild/reference/execution-and-sessions.md).

## Known failure modes

- 2026-09-08 discovery: CSV loses highlight-based selection; use the original formatted artifact
  or require an explicit equivalent selection. Do not quietly choose all blank dates.
- 2026-09-08 discovery: legacy workbook controls may disappear during export or in Excel for the
  web. Verify the saved selection state and browser-visible representation against the approved template.
- 2026-09-08 discovery: an online workbook edit can diverge from the already-uploaded attachment.
  Reconcile and bind approval/submission to the exact artifact version.
- 2026-09-08 discovery: an open Excel web review can hold a shared-use lock during replacement.
  Resolve the owned review session and verify upload completion; never overwrite a shared original.
- Transferable [lesson ledger](../../../docs/rebuild/reference/lessons.md) findings, not claims of
  ServiceNow implementations: D310 (2026-09-02) binds selection to stable record identity rather than
  positional checkbox IDs; 2026-08-14 separates a located field from its typed expected value;
  D174 (2026-08-09) requires derived replay identities and honest artifact-manifest shapes.
- The same ledger's 2026-08-25 write-count lesson requires run-scoped intent attribution for dry-run
  evidence. No Background Check, ServiceNow or SharePoint-specific ledger entry was found.
- Debug new failures through [hr-debug](../hr-debug/REFERENCE.md); use its selector-repair loop and
  content-level authentication checks. Do not add a longer wait as the first fix.

## Live record

- 2026-09-08 — Manual discovery established batch-form navigation, copy-only workbook preparation,
  browser formatting/selection review and attachment handling. This is reusable discovery evidence,
  not a registered dashboard run or controlled-commit proof. No workflow run/trace ID, durable count
  assertion or verified request receipt is claimed here. Individual-run details remain outside this resource.
- Automated acceptance: **UNKNOWN — no Background Check migration record or approved live scenario
  exists.** Populate this section from verified migration evidence after implementation.

## Record when you are done

Create the workflow's migration record under [migrations](../../../docs/rebuild/migrations) when its
admitted implementation begins. Record dated, attributable dry-run/controlled-write evidence there;
refresh this resource from the actual definition, registry, stores and tests. Update the owning
[4.1 tasks](../../../docs/rebuild/plans/phase-4/4.1-background-check/README.md) and
[roadmap](../../../docs/roadmap/roadmap.md), then run `npm run roadmap` and `npm run roadmap:check`.
Individual request progress belongs in dashboard run authority/evidence, not roadmap task statuses.
Only update store/dashboard instruction files for new invariants; offer lesson-worthy findings to
the operator for their explicit lesson workflow.
