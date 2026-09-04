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

The answer selected no replacement document, waived no gate, authorized no external write, and did
not admit a third workflow.

Normative owner: doc 03c §3c-A exit gate and §3c-B.
