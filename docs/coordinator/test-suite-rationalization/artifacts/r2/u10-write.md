# R2 u10 — write authority, gates, receipts, and fail-loud units

## Owned ledger

The family owns 18 files / 230 expanded cases: `diagnostic-safety-projection` 7,
`evidence-action-write-proof` 17, `evidence-receipt-d82` 4, `evidence-receipt-step-omission` 16,
`evidence-receipt-write-proof` 20, `idempotency-key-privacy` 2, `kuali-finalization-fields` 10,
`parked-write-round-trip` 14, `receipt-comparison` 19, `receipt-derivation-binding` 13,
`run-terminal-authority` 17, `separations-kuali-finalization-terminal-proof` 5,
`separations-supplied-eid` 7, `terminal-authorization` 5, `write-recovery` 16,
`write-resolution-binding` 8, `write-safety-contracts` 4, and `write-sequencer` 46. All paths are
under `tests/unit/` and end in `.test.ts`.

## Unique protection

| Seam | Fail-loud risk retained |
| --- | --- |
| sequencer and recovery executor | pre-fence mutation, aged probe, ambiguous/unknown probe, stale CAS, malformed proof, moved permanent key |
| command/run parked-write round trip | a direct recovery result fails to reach the durable lifecycle or becomes cancel/retry authority |
| receipt derivation and projection | wrong intent join, raw key/person leakage, old-composition reinterpretation, asserted omission presented as observed fact |
| identity and terminal authorization | wrong person, mismatched claim/fingerprint, terminal row/outbox partial commit |
| Kuali and finalization proof | missing/foreign finalization evidence becomes success |
| schema-level recovery policy | early or inconsistent absence unlocks retry |

No assertion-free, tautological, cannot-fail, or mock-theater cases were found. The direct recovery
executor and parked-write round trip reach similar outcomes through different ingress and lifecycle
seams, so neither is removable. The write-safety suite label now says what it exercises:
`write-safety schema and negative-settlement rules`.

## Residue and proof

The three Explain-rendering cases at the end of `evidence-receipt-step-omission.test.ts` belong in a
later R3 taxonomy move; R2 retains them in place. `claim-sweep-recovery` is R3b; dry-run scenario
authority is R5; storage repositories are u11.

The final explicit 82-file R2 run measured and passed this family's 18/18 files and 230/230 expanded
cases. A broader 30-file write/storage baseline passed 415/415 tests in 8.76 seconds.
