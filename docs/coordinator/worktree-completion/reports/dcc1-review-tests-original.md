# DCC1 preliminary Tests review

Native sup_luna, immutable target 80da38158dea35f781eb69d5e682a779935f9c96..0c115123a738f62cbe01c9b45f53b7289284479c. Read-only; no tests run. Count 4, worst medium. Supervisor checked cited original code.

| Location | Severity | Finding / disposition |
|---|---|---|
| tests/unit/server/bff-flow.test.ts:586 | medium | Body-before-refusal tests use string bodies. They distinguish refusal from JSON parsing but do not prove zero body consumption. Add instrumented body-read observation and zero authority effects. |
| tests/unit/worker-composition.test.ts:519 | medium | Pre-first-claim injection depends on bootTransactionsRemaining=2, not a semantic claim boundary. Preserve true queued-state assertion; replace brittle count with observable claim boundary. |
| tests/unit/server/compose-real-port.test.ts:272 | medium | Prepared recovery has all-present/all-absent coverage but not a complete partial command/audit/current presence matrix. Existing corruption fixtures cover identity mismatches, not every missing combination. Add partial-state refusal/preserved-evidence tests. |
| tests/unit/config.test.ts:355 | low | Exact byte-limit accepted case asserts only byteLength. Add strict parsed record/actor-label round trip at the boundary. |

Inspection note: server/settings-runtime.ts resolvePreparedSettings selects committed based on command presence or matching settings_current command, otherwise checks prior and rolls back. An audit-only leftover needs explicit matrix proof; do not silently assume it is absent. Any discovered runtime defect requires its own smallest fix + regression evidence.

All findings remain open until reconciled candidate is tested and independently reviewed. No claim that prior green focused 52 tests covers these gaps.
