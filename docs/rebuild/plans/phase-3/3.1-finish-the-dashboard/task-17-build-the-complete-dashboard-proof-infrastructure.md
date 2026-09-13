# Task 17 · Build the complete dashboard proof infrastructure
<!-- roadmap: dash-proof-infrastructure -->

**Current assignment: 3.1.18.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Complete T2 feature, T3 production-browser, T4 live dry-run, accessibility, performance, and
  deliberate parity lanes over every generic surface and state arm.
- [ ] D340: extend the existing desktop-only browser/parity infrastructure to Task 8's desktop
  resize/zoom matrix. The immediate mobile-proof retirement is already assigned before 1.6.6;
  new proof covers desktop journeys. No automatic screenshot re-freeze.

Consume the current source-bound ensureParityBundle, fixture and seeded server helpers and their explicit coverage gaps. Preserve the accepted 274-case corpus as evidence, not a claim that future journeys pass. Build every missing A01–A42 and D01–D05 proof; true browser zoom differs from CSS zoom/device scale. No refreeze is automatic.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
