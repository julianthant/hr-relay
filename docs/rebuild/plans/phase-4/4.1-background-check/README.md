# Phase 4.1 · Background Check

Read the [phase overview](../README.md) for sequencing. This subphase creates a reusable dashboard
workflow; its tasks are implementation outcomes, not steps or results from an individual hiring batch.

## Admission
<!-- roadmap: workflow-admission -->

**Target workflow id:** `background-check`. **Current state:** not implemented or registered.
The internal [workflow resource](../../../../../.agents/skill-library/hr-background-check/REFERENCE.md)
owns the reusable operational description, evidence limits and run/test guidance for `hr-manage`.
This phase owns delivery scope and tasks. Requirements remain in
[workflow-model §1.6.2](../../../reference/workflow-model.md).

**Outcome.** An operator starts Background Check from the dashboard, supplies an applicant roster
and request settings, reviews the selected applicants and generated request workbook, then approves
a request for submission to UCSD Human Resources. The workflow retains the exact reviewed artifact,
submission receipt and recovery evidence. A submitted request does not mean an applicant's background
check has cleared.

**Initial scope.** Implement the multiple-applicant path demonstrated in the walkthrough. Source
selection must preserve spreadsheet formatting when highlight color determines membership. The
single-applicant path, handling cohorts below the portal's batch minimum, source-roster writeback
and background-result monitoring require explicit scope decisions in Task 4.1.1. They are not inferred
from the portal offering those features. Applicant counts, names, workbook filenames, dates, job
numbers, funding and contact values are run data or validated request-profile settings, not constants
in the workflow graph or roadmap.

**Feasibility established so far.** The generic start surface is declaration-driven. ServiceNow and
SharePoint store shells exist but expose no tasks and declare unwired drivers. There is no Background
Check definition, registry entry, scenario or approved test subject. The manual walkthrough proves
navigation and workbook preparation observations only; it is not automated workflow acceptance.
Phase 3 prerequisites and D319 approval gate implementation. The tasks below are planned scope,
not launchable supervisor briefs until Task 4.1.1 resolves the admission packet and bindings.

## 4.1.1 · Define the workflow contract and admission packet
<!-- roadmap: background-check-discovery -->

**Planned.** Define the request unit, supported cohort sizes, applicant input schema, highlight-based
selection rule, configurable request profile, optional steps and terminal result. Map the proposed
ordered timeline groups and entries to task, gate and transaction contracts. Classify every external
mutation, including attachments, draft creation and optional cloud review copies. Establish task/store
reuse versus new work, permanent request identity, receipt/read-back contracts and controlled test
targets. Resolve the nine D319 packet fields and obtain operator approval before implementation.

**Acceptance:** one complete approved boundary and tuple model, no guessed defaults or hidden scope
choices, with bounded implementation assignments, dependencies, isolation and proof targets.

## 4.1.2 · Build roster intake and request workbook generation
<!-- roadmap: background-check-workbook -->

**Planned; requires 4.1.1.** Read a versioned source artifact, preserve selection-relevant cell fills,
validate explicit applicant fields and freeze the selected cohort. Reject missing formatting when
selection depends on color, ambiguous names, invalid addresses and duplicate applicants with clear
row-level findings. Generate a separate workbook from the approved template, with configured job,
funding, supervisor, recipient and service values. Preserve the template's layout and browser-visible
selection markers; never overwrite the source or shared template. Retain source provenance, selected
row identities, artifact digest and validation results for review and safe resume.

**Acceptance:** deterministic membership and workbook content on synthetic fixtures, exact template
formatting and selected-service verification, no source mutation and no unnecessary sensitive columns.

## 4.1.3 · Build dashboard preview and approval
<!-- roadmap: background-check-review -->

**Planned; requires 4.1.2.** Declare the workflow's start inputs through the generic dashboard surface.
Show selected/excluded applicants and reasons, validation issues, request settings and a downloadable
workbook preview. Provide an explicit review gate bound to the cohort, settings, source version and
exact artifact digest. An edit regenerates the preview and invalidates prior approval. Resolve how
external spreadsheet edits are reconciled; an online edit must not silently leave an older attachment
approved. Wire timeline, parked/review states, cancellation and evidence through existing projections.

**Acceptance:** dashboard scenarios prove input validation, artifact inspection, approval, edit-after-
approval invalidation and cancellation. The frontend does not fabricate membership or approval state.

## 4.1.4 · Implement ServiceNow submission and recovery
<!-- roadmap: background-check-receipt -->

**Planned; requires 4.1.3.** Implement the ServiceNow store's verified authentication, HR catalog
navigation, multiple-applicant form, request settings and recipient read-back. Attach only the reviewed
artifact and bind Summary to that approved request. Put all externally persistent writes behind the
admitted transaction boundaries. Verify the resulting request identifier and source-system receipt;
checkpoint resumable reads without replaying uploads or submits blindly. Probe and reconcile prior
requests using the approved permanent identity. UNKNOWN results park for resolution, never retry.

**Acceptance:** read-only live selector verification and fixture-backed proof of commit-free preview,
subject/artifact mismatch refusal, receipt validation, already-present replay and crash recovery.
Controlled submission is proved in Task 4.1.5 after the complete workflow is registered. A harmless,
reconcilable test target is required; an ordinary applicant batch is not an implied canary.

## 4.1.5 · Register, prove and enable the dashboard workflow
<!-- roadmap: background-check-admission -->

**Planned; requires 4.1.4 and Phase 3 completion.** Author the workflow with the current definition
compiler and store bindings; register it through the composition root. Complete T1 structural and
dry-run scenarios, T2 dashboard review/submission scenarios, pure-fold tests and controlled-write
proof. Verify workflow discovery, start, timeline, receipt, Archive and resume from the real dashboard.
Refresh the generated manifest and the internal workflow resource from the implemented definition.

**Acceptance:** required code and live gates pass against the reviewed candidate; tests prove zero
write-intent/attempt/outbox deltas during dry run, no external upload/submit in preview and no duplicate
request after a retry or uncertain outcome. Record reusable acceptance evidence in the workflow's
migration record. Do not mark a delivery task complete because a manual request was prepared.

## Shared capabilities awaiting an admitted consumer
<!-- roadmap: cross-cutting -->

The roadmap's existing capability inventory remains unassigned until a verified workflow admission
packet names it as necessary. It is not Background Check implementation scope by proximity.
