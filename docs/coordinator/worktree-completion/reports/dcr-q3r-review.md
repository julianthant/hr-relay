# Independent review — DCR fixture-injection repair

Fixed target: `1582f95c5c114162d980b247a58cb7f2d2f22bb9..845ca5a115ee6eef3e10598e88ea0a7fdf361888`.
Inspection: `git diff` of that range for `src/server/dry-run-scenario/runtime.ts`,
`tests/unit/dry-run-scenario-composition.test.ts`, and `AGENTS.md`.
Six independent native reviewers, all high reasoning, 240k/220k; read-only, no tests or mutations.
Supervisor persists their returns and verified the cited source. All reviewers have been closed.

## Standards

*Skipped as a separate axis: this is the exact seven-line mechanical port from the explicitly
approved source, plus its required seam lesson; no new structure or conventions were introduced.
Spec and Docs independently checked scope and the applicable documented invariant.*

## Spec

Native `sup_terra`; task `sup_terra_dcr_q3r_spec_review`;
agent `01a05321-29fc-72f0-8748-0b4a5a5c7729`.
The exact four runtime and three test additions match `964c9636`; its unrelated security changes
were not imported. The AGENTS update documents only the approved seam. CLI omission/default and
the unchanged public surface satisfy the explicit coordinator disposition.

Count: 0 · Worst: none.

## Correctness

Native `sup_terra`; task `sup_terra_dcr_q3r_correctness_review`;
agent `01a05321-2773-79b2-99d3-c1e16d00a536`.
`runtime.ts:173` forwards the exact optional factory on every real drain. Absence omits the
property and retains the unchanged worker production default. The existing fixture implements
the current `DuoCeremonyGateFactory` contract; production CLI composition supplies no override.

Count: 0 · Worst: none.

## Silent failures

Native `sup_terra`; task `sup_terra_dcr_q3r_silent_failures_review`;
agent `01a05321-2955-7e31-9d1c-db7168bb83fb`.
Explicit injection, not automatic fake fallback. Production omission reaches
`src/server/worker/compose.ts:504`, then real credential identity resolution in
`src/core/duo-ceremony-gate.ts:380`/`src/domain/secrets.ts:508`; missing or unreadable credential
material still fails loud. No error swallowing or default-success path was added.

Count: 0 · Worst: none.

## Performance

*Skipped: exact dependency forwarding adds no algorithm, collection work, polling, acquisition
policy, or changed production resource lifecycle. No performance behavior is claimed.*

## Tests

Native `sup_luna`; task `sup_luna_dcr_q3r_tests_review`;
agent `01a05321-28dc-7242-88fc-9c60fb72a044`.
All eight tests, 34 assertion-bearing lines and timing behavior remain intact. Receipt, gate,
write-safety, failure and privacy assertions are preserved; both scenarios still exercise real
`runtime.drain` and the real gate command. Only Duo uses the established real lease-backed fixture.
Retained focused red (two failures/six passes) and green (eight passes) address the missing-auth
dependency without stubbing the worker/result or weakening assertions.

Count: 0 · Worst: none.

## Docs

Native `sup_luna`; task `sup_luna_dcr_q3r_docs_review`;
agent `01a052f5-af9e-7560-8d25-f44ed47d38ab` (same independent Docs reviewer, new pinned target).
`AGENTS.md:300` and `runtime.ts:47` truthfully describe the seam. The two tests supply the factory
at lines 348/423; forwarding occurs at runtime line 173. “Real lease-backed” is supported by
`tests/unit/fixtures/duo-ceremony-fixtures.ts:69`; production omission is explicit in
`src/server/dry-run-scenario/compose.ts:97`.

Count: 0 · Worst: none.

## Security

Native `sup_sol`; task `sup_sol_dcr_q3r_security_review`;
agent `01a05321-2828-7590-a889-c1a99557fd78`.
The new field is a trusted in-process dependency, not a wire/config/CLI/env input. The production
constructor explicitly supplies only isolation/repoRoot/env/clock/ids at
`src/server/dry-run-scenario/compose.ts:97`. The worker default and credential identity checks
remain unchanged. The test helper uses a temporary lease authority, not a production-auth file
or bypass. No concrete trust-boundary violation found.

Count: 0 · Worst: none.

## Simplify

*Skipped: the accepted diff is already the exact minimal approved port; no simplification asked
for or justified.*

## Totals and verification boundary

| Axis | Count | Worst |
|---|---:|---|
| Spec | 0 | none |
| Correctness | 0 | none |
| Silent failures | 0 | none |
| Tests | 0 | none |
| Docs | 0 | none |
| Security | 0 | none |

Reviewers examined existing evidence, not a new full gate. The supervisor additionally proved the
two code files byte-identical to source `964c9636`, reran the committed focused file (8/8, exit 0),
and completed a new globally locked lint (exit 0); see `evidence/dcr-q3r/parent-verification.md`.
The original red full log remains unchanged. Fresh coverage/parity still requires coordinator
allocation, and the later q4 release check remains separate. No live-authentication claim is made.
