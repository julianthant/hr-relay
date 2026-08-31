# A10 performance findings — ownership disposition

2026-08-30. Coordination under approved D291/D292; not implementation or gate acceptance.

## Evidence received

| Claim | Classification | Evidence checked | Disposition |
|---|---|---|---|
| Shared artifact bytes are verified once per supporting bundle before projection deduplication | Source-proved structural cost, not measured latency | Full DCA4 `reports/dca4-a10-review-performance.md` SHA da1ed8f70cc1b2fe97d63d2f5414a2719f50a8b35391bd1711a3275bb68360d0; full diagnostic-bundle.ts and run-detail.ts:869–916 read in coordinator12c4ae | OPEN; assign to DCA2 shared D291 verification work |
| Each appended origin copies all prior origins | Source-proved quadratic copying, not measured latency | run-detail.ts:908 `[...existing.origins, origin]` | DCA4 local A10 repair, with focused proof and affected review |
| Shared readback files differ between branches | Proved | Coordinator6f2c24/ea796f hashes and full diff ee73fb: DCA4 df054bf65cbe234e7b5b58c0502b0042678ae4555879402872b2dcb11bee1680; DCA2 b00786c846fa96796be59bd9b33c4f6c1f33bbec8b56315d2c04ddf500eaf5e9 | Intent reconciliation, never whole-file replacement |

Source paths are relative to the assigned DCA trees under
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/{dca2,dca4}`. DCA2 already has
typed missing-byte handling and exact-bundle attachment readback with a second verification.
The current DCA4 readback checks each durable bundle, digest and attachment index, then calls
verifyArtifactBytes for every attachment. It has no existing request verification capability.

## Single-owner assignment

1. DCA4 continues the already-approved fixture/test/docs repairs and fixes the local origin
   accumulator in its A10 run-detail query. Preserve complete memberships, exact metadata
   conflict refusal and strict final projection. No cap, dropped origins or cross-request state.
   Use the existing public query seam, focused regression/sensitivity proof, fresh locked lights
   and affected Performance/Tests review. No new supervisor or broad analysis campaign.
2. Do NOT add a competing diagnostic-bundle verification interface in DCA4 now. The shared
   extension belongs to DCA2's forthcoming D291 reader/verification implementation after the
   stopped-owner A10 common-delta receive. It is part of that existing assignment's bounded
   diagnostic verification scope, not a new user policy choice. DCA2 remains queued now; this
   disposition does not open implementation, tests or gates there before dependency receive.
3. Carry the N×S medium verbatim into that receive as OPEN shared residue. It does not block
   transferring an otherwise reviewed/light-green common delta to its designated repair owner.
   It DOES prevent claiming the performance finding fixed or joined/full acceptance. No local
   product-commit/full-gate rule is waived; other A10 findings must still close or receive their
   own explicit disposition.

## Required shared repair boundary

DCA2's eventual implementation brief must include the actual shared diagnostic readback and
run-capture integration in addition to its lower reader, while preserving branch-specific error
contracts. Reuse verified byte work only for the same complete exact artifact reference within
one owned verification pass/request. Every supporting bundle still undergoes its own exact
durable-row, requested/run identity, content digest, canonical manifest and attachment-index
checks. Conflicting metadata or provenance must refuse rather than sharing by bare artifact ID.

No fabricated empty/cached streams, public skip-verification flag, cross-request freshness cache,
or eager public-open fallback. Failed or cancelled verification is not success and pending work
retains D291 cleanup ownership. The required fresh selected-artifact preparation/verification is
a separate pass: an earlier verification result may not satisfy it. Keep existing attachment
fan-out, whole-bundle verification, exact errors and native response/HEAD/Range guarantees.

Proof must exercise real shared readback across multiple same-run bundles sharing one artifact,
show one successful byte verification for each distinct exact ref in that pass, preserve all
origin tuples and every bundle/index refusal, and show a new request re-verifies. Pin conflicting
refs and failed verification; selected-pass tests must still detect changed bytes between passes.
Retain red-capable public-path proof and independent affected Performance/Tests/Correctness/
Silent/Security review. Existing D291 real-reader/all-three-consumer and lifetime tests remain
required; mock call counts alone are not sufficient shared acceptance.

No production code changed by this coordination disposition. No browser/heavy allocation,
reference update, shared merge, live authority action or cleanup. DCA4 finishes local repairs and
returns a frozen candidate with this named residue; coordinator then controls DCA2 receive and
implementation, followed by DCA4 adaptation and joined proof. No circular all-findings-zero
prerequisite is imposed before transferring this explicitly owned dependency.
