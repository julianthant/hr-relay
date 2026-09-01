# DCC2 supported CLI fixture — Tests followup

Native role is configured Luna/high; generic returned model label is not an override.

STATUS: COMPLETE — Tests axis  
ROLE: sup_luna_dcc2_review_tests  
MODEL: GPT-5  
REASONING: Reviewed immutable `a296aa29b7308d318c6fc4a8a9ba9642acbe9082 → e4ab3837feef579e8462b59e27eb9eb3015d0f65`.  
COMMITS: none  
FILES: One test file; production unchanged.  
GATE: Static review only; no execution.  
SCOUTS: none  
NOTES:

The narrowing is justified. `src/config/define-runtime-isolation.ts:6` restricts `stateRoot` to literal `.tracker-rebuild`; `src/server/storage/compose.ts:391–393` joins it directly beneath `repoRoot` and uses that root as the trust anchor. The custom intermediate-component fixture therefore cannot represent a supported CLI configuration.

`tests/unit/storage-diagnostic-redaction.test.ts:47` excludes only CLI’s nested-root case, preserving doctor/browser coverage. Line 122 restores the real CLI isolation argument without a cast or production broadening. All 18 applicable CLI cases remain, with unchanged exit-code, redaction, diagnostic-field and refusal assertions at lines 123–140.

Prior dispositions remain intact: Vite coverage and the ordinal-message mismatch are resolved. The nested-key fixture correction remains resolved; the old-formatter result is a negative control, not evidence of mutation sensitivity or a nested-key vulnerability.

The revised matrix contains **56 cases**. The earlier 57-pass result predates this correction and is not evidence that this candidate passes.

Count 0 / Worst none.
