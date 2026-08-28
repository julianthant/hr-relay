# Decision — R2/u1 4537 registry reconciliation — 2026-08-28

**Answered 2026-08-28:** `1 A`, with the operator's explicit override: doc 4537 becomes the one
main test subject; remove doc 4524 and every other active registry label.

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

**Recommendation at issue.** **A** — it preserved the strict workflow boundary and 4524 history
while making 4537 runnable only from newly verified facts.

**Ratified outcome for implementation.** The operator selected A's verify-first safety boundary but
rejected its preserve-the-other-labels scope. After a fresh read-only verification, the active
registry is to contain exactly one target and one label: existing label `finalization-canary`, Kuali
doc 4537. That one subject must be addressable by both the composed `separations` resolver and the
`separations-kuali-finalization` resolver without cross-workflow guessing. Remove the other eight
current labels and entries:

- `finalization-already-finalized`
- `finalization-no-active-job`
- `finalization-subject-mismatch`
- `separations-dry-run-subject`
- `separations-future-dated`
- `separations-controlled-commit-candidate`
- `separations-pending-termination`
- `separations-controlled-commit-canary`

The historical observations for docs 4495, 4502, 4510, 4524 and 4568 stay in the migration record;
they cease to be active registry identities. Live dry-run manifests retain only cases that 4537 can
truthfully exercise. Pure structural/unit coverage may continue to prove negative branches without
inventing live subjects. The implementation unit owns the registry schema/resolvers, both T1b
manifests, both-directions guards, owning phase/reference text and generated manifest as one reviewed
contract change. If the fresh read finds 4537 absent or materially changed, keep it as the sole label
with an honest `gone`/`unknown` availability and stop before any workflow rehearsal or write.
