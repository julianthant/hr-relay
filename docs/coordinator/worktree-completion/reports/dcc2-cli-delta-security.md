# DCC2 supported CLI fixture — Security followup

STATUS: Security followup complete; narrowing justified. Prior resolved findings remain resolved.
ROLE: sup_sol_dcc2_review_security
MODEL: native sup_sol
REASONING: high
COMMITS: None.
FILES: `tests/unit/storage-diagnostic-redaction.test.ts`; a296aa29 → e4ab3837feef579e8462b59e27eb9eb3015d0f65.

Evidence:

- `src/config/define-runtime-isolation.ts:6` fixes `RuntimeIsolation.stateRoot` to `.tracker-rebuild`. `src/server/storage/compose.ts:391` joins it directly beneath `repoRoot`, which line 393 also supplies as the trust anchor. The CLI cannot represent the custom intermediate-component fixture through its supported input contract.
- `tests/unit/storage-diagnostic-redaction.test.ts:47` excludes only CLI’s `nested-root` case; doctor/browser retain it. Line 122 restores the real isolation argument without casts.
- All other CLI cases remain. Marker suppression, field identification and failure assertions at lines 123 and 131–140 are unchanged. No production source changed.

Count: 0 · Worst: none

GATE: Not run. Static enumeration gives 56 expected cases; the earlier 57-case result does not establish this candidate’s execution status.
SCOUTS: None.
INVARIANT: Applicable CLI redaction coverage remains intact without broadening production inputs.
REVIEW-HINT: Obtain fresh worker-owned gate evidence for e4ab3837.
NOTES: No new Security findings, assertion weakening, or changes to earlier dispositions.
