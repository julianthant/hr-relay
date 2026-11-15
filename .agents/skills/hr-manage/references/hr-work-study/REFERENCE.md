# `work-study` workflow resource

> Internal repository playbook selected by `hr-manage` for `work-study` and its plain-English
> names (Work Study, Work-Study, PayPath award). It is not an independent operator command.

**What it does.** For each typed Employee ID it opens UCPath HR Tasks → PayPath/Additional Pay → PayPath Actions, reads the employee header and current Position Data, plans the work-study transaction (the supplied effective date, Position Change Reason JRL, Position Pool F, matching Job Data and Initiator's comments), checks UCPath for a transaction already filed on that date, fills the form and reads every value back. With Dry run off it clicks Save and Submit once and reads the filed transaction back. It writes one UCPath transaction per person only in a live run; there is no gate.

## Graph (as built — `src/workflows/work-study/workflow.ts` and compiled descriptor)
| group / entry id | kind | compiled node ids / task contracts | system / task | typed references, conditions, notes |
| --- | --- | --- | --- | --- |
| `ucpath-auth` "Sign in to UCPath" | read | `read-paypath-position` (`UcpathReadPayPathPosition`) | UCPath | reads header and current Position Data |
| `transaction` "Submit work-study transaction" | read | `read-transaction-plan` (`WorkStudyReadTransactionPlan`) | sessionless | depends on the read; replay always-rerun |
| `transaction` | write | `save-transaction`: prepare `UcpathStagePayPathWorkStudy`, commit `UcpathSubmitPayPathWorkStudy`, probe `ucpath/match-paypath-work-study`, verify `ucpath/verify-paypath-work-study` | UCPath | `dryRun: stop-after-prepare`; key `ucpath:paypath-work-study|<emplId>|<effectiveDate>` (docs/reference/write-safety.md) |

## Explorer preview (W6 — derived from the compiled definition)
- Preview state: compiled definition preview; UNKNOWN whether the Explorer lists the typed date control — read `src/backend/runs/queries/explorer-review-spec.ts` and the Explorer in the dashboard.
- Ordered groups: Sign in to UCPath, Submit work-study transaction; systems: ucpath.
- Choices: none declared.

## Inputs & subjects
- Run modal / `surfaces.inputRun`: Employee IDs separated by commas, semicolons or new lines, plus one required Effective date control typed MM/DD/YYYY, refused with "Choose a valid effective date." The input is `{ emplId, effectiveDate }`; the start plan stores the date as ISO.
- Canary subjects: UNKNOWN — none declared in `config/test-data.json`; a missing subject is `blocked: needs work-study canary`, never `failed`.
- Subjects that must NOT be used / are burnt: UNKNOWN — read the work-study evidence folder under `.work/`.

## Run it (details in hr-manage)
- Processes: `npm run dashboard` (BFF 3938 + vite 5174); Run starts the workflow's worker. Restart the BFF after workflow-definition changes (fingerprint trap — hr-debug §4).
- Start: the signed-in dashboard Run dialog via playwright-cli with `dryRun` — **dryRun=true is the default; a real write only under the controlled-commit proof with the operator's explicit per-run authorization.**
- Gate ceremony: none.

## Dry run must show (assert over authority, not logs)
- nodes reached: `read-paypath-position`, `read-transaction-plan`, `save-transaction` up to prepare; nodes excluded: the commit
- `run_checkpoints` rows keyed `(workflow, item, node, attempt, claimGeneration?)`: the three nodes above
- `gate_results`: none
- `write_intents` / `write_attempts` deltas: **0**
- receipt shape: none in a dry run; planned result with the plan values
- the `explain run` output mentions: the effective date, JRL, pool F; no Save attempt

## Current verification and gate status
- Dashboard: `tests/dashboard/surfaces/workflows/work-study-served.test.ts` and the run-start, catalog, category and picker model tests; typecheck and lint clean on the dashboard ticket.
- Phase-exit gates: not run here; the live dry run with operator sign-off is ticket 04.
- Do not infer test execution from declared scenario ids.

## Known failure modes (from the owning reference and nearest module AGENTS.md)
- Declared category `operations` shows as the rail group "Work Study" (`src/dashboard/surfaces/workflows/workflow-category.ts`); a second operations workflow would need its own category.
- The served Run dialog's Dry run switch starts off for every workflow; Work Study is expected to start with it on — check the switch before Start.
- Debug anything new through [hr-debug reference](../../../hr-debug/references/debugging.md); selectors use its selector-repair loop; never "add a longer wait" first.

## Live record
- UNKNOWN — no live run recorded; the live dry run is ticket work-study-workflow-04.

## Record when you are done
- Record task notes in the work-study evidence folder under `.work/`; keep lasting invariants in the owning module `AGENTS.md`.
