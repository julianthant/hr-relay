# Decisions — R2/u1 4537 registry reconciliation — 2026-08-28
_Answer positionally: `1 A`, `1 B`, or `1 C + "note"`. Unanswered items stay open._

## 1 · How should composed workflow 4537 receive an exact registry identity?

**Situation.** The authorized u1 brief requested the composed `separations` label
`separations-controlled-commit-candidate`, but the strict registry correctly preserves that label
as completed doc 4524 (`gone`, last observed 2026-08-14). Doc 4537 is registered only as
`finalization-canary` under the different `separations-kuali-finalization` workflow. The phase plan
still names 4537 as the 2026-08-28 composed subject, but the rebuild may not substitute a document
number or cross a workflow boundary without a new exact registry entry.

**Options.**

- **A. Add a new composed-chain label for 4537 after a fresh read-only live verification.** Run one
  reconciliation unit that first confirms 4537 is still present, its dates still match, and its
  transaction number is still empty. Only if all facts hold, add
  `separations-controlled-commit-canary-4537` under workflow `separations`, pin its resolver and
  registry guards, update the owning inventory/provenance, and independently review the change.
  Doc 4524 and its `gone` label remain byte-for-byte historical evidence. Cost: one config/test/docs
  unit and then a separately authorized fresh u1 rehearsal.
- **B. Repoint `separations-controlled-commit-candidate` from 4524 to 4537.** This gives the old brief
  its requested label, but overwrites the retired subject's stable history and contradicts doc 03b's
  explicit rule that the 4524 row stays. Cost: simpler naming at the price of losing provenance.
- **C. Keep the registry unchanged and park the 4537 composed run.** No live verification or config
  change occurs. Cost: R2/u1 and Phase 3b exit row 5 remain blocked until a different composed
  canary is selected and separately authorized.

**Recommendation.** **A** — it preserves the strict workflow boundary and 4524 history while making
4537 runnable only from newly verified facts.

**Notes.** _(your notes here)_
