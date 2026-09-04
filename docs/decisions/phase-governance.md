# Phase governance decisions — operator context

This topic record preserves phase-transition answers. Normative exit and admission rules are in the
phase docs and the canonical decision ledger.

## D277–D279 — Phase 3a close

On 2026-08-27 the operator chose to merge the reviewed integration line into `master` with
`--no-ff`, retain per-file jsdom for wiring-level React tests, keep dashboard-specific Codex
instructions, give a live capture session the Intake column, and schedule the next live T1b work.
The durable decisions were:

- D277: jsdom is the per-file environment for wiring-level React tests; visual behavior remains in
  the parity lane.
- D278: a live capture session takes the Intake column. D294 later retired mobile Capture Mode and
  therefore superseded this implementation obligation.
- D279: Phase 3a closed 10/10, with structural fidelity residue carried to the later dashboard work
  by explicit disposition.

Normative owners: ref guards-and-tests, ref dashboard-surfaces, doc 03a, and the then-current
dashboard deferral track.

## D320 — Phase 3 close

On 2026-09-03 the operator chose A/A:

- Separations must produce a fresh `met` T1b result on a newly vetted closed Kuali document before
  3c-A closes; the existing blocked result remains honest evidence but is not acceptance.
- Once every 3c-A exit condition is green, 3c-B is authorized to start and close Phase 3 without a
  second start approval.

The operator subsequently selected the replacement in ignored local configuration. The first live
dry-run verified the Kuali document and UCPath reads but failed at the New Kronos employee search,
with exact-run write authority still 0/0/0. The target is available; the required fresh `met`
result remains open. No gate was waived, no external write was authorized, and no third workflow
was admitted.

Normative owner: doc 03c §3c-A exit gate and §3c-B.

## D323 — One visible phase hierarchy

On 2026-09-03 the operator replaced the just-in-time phase numbering introduced by D319 with one
stable roadmap hierarchy:

- numbered phases are the only nodes on the vertical roadmap spine;
- every phase contains lettered parts arranged horizontally, and each part's concrete tasks run
  vertically beneath it;
- Phase 3 contains 3A Shared dashboard, 3B Separations, 3C Workflow authoring and acceptance, and
  3D Codex and Claude cooperation;
- Phase 4 is the remaining workflow-migration program: the next approved workflow is 4A, followed
  by 4B, 4C and onward as each admission packet is verified and approved;
- Phase 5 owns cutover readiness and the single authority switch; Phase 6 owns the desktop app;
- working-session history remains in each node's `log:` drawer and never appears on the phase spine.

D323 supersedes only D319's phase-number allocation. D319's safety boundary remains: an individual
workflow receives no implementation scope until its current behavior and proposed definition are
verified and approved.

Normative owners: roadmap §Governance, ref workflow-model §1.6.2, and the phase docs 03c–06.
