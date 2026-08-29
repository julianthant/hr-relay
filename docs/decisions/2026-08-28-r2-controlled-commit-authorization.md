# Decisions — R2 controlled-commit authorization — 2026-08-28

_Recorded from the operator's “all recommended” answer to the Phase 3b status report._

## 1 · Proceed after the rehearsal

**Situation.** Phase 3b criterion 5 still requires the three real controlled commits. A composed
4537 rehearsal must first finish green with exact-run `0/0/0` write evidence.

**Options.**

- **A. Proceed ② → ① → ③.** Each write still stops at its own operator-visible ALWAYS-GATE.
- **B. Stop after rehearsal.** Leave criterion 5 open and perform no real write.

**Recommendation.** **A** — complete the planned proof under the existing write-safety ceremony.

## 2 · Use the pending-row witness window

**Situation.** ①'s committed `clear-pending` arm can be witnessed honestly only after ② creates a
pending UCPath row and before another actor clears it.

**Options.**

- **A. Rerun ① immediately after ②.** Adds one separately gated controlled deletion and records the
  live committed-arm witness.
- **B. Decline the window.** Retain sequencer and fixture proof only, with that limitation stated.

**Recommendation.** **A** — the narrow window cannot be recreated honestly later.

## Answers — 2026-08-28

The operator answered **all recommended**: **1 A, 2 A**. This authorizes the sequence only after a
green rehearsal. It does not pre-approve any ALWAYS-GATE, permit retry after an UNKNOWN submit, or
relax the frozen-tree and exact-evidence conditions.
