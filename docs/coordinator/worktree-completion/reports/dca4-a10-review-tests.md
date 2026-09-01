# A10 native Tests return (verbatim)

Native task01a052ff-4062-7b32-b0ba-4c6d27bbec85; submission01a0555c-4de5-7e70-b3f1-9f2adea55c0a; native terminal return, closed. Targetd6069d06/candidate25975726. Proposed controls are unrun at receive.

Tests axis — Count: 2 · Worst: medium.

[run-captures-app.test.ts:196](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/tests/unit/dashboard/run-captures-app.test.ts:196) | medium | The load-error case never starts decoding; the reopen cases create a new hook instance. Neither catches a pending decode overriding an error on the same mounted image if error-time invalidation regresses. | Start a deferred decode, confirm invocation, dispatch error, resolve decoding, and assert refusal persists without readiness. Pin with a targeted negative control.

[run-captures-app.test.ts:325](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/tests/unit/dashboard/run-captures-app.test.ts:325) | medium | Separate substring assertions accept incorrect bundle/origin pairings: swapping labels between bundle IDs retains every checked string. This misses misattributed D292 provenance in both tile and preview. | Compare each rendered origin row’s exact `(originKind, bundleId)` pair against independent expected tuples at both sites.

Coverage: authority/schema/client regressions, actual-app lifecycle and decoder assertions, mounted native-sink accounting, cleanup controls, and real HTTP fixture tests. Recorded negatives demonstrate lifecycle, framing, origin-loss, dispatcher and byte-corruption sensitivity; inherited assertions remain intact.

Identity: HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; candidate `259757261c5a288a5f5072c9294090907739caa4ffc9be1e9f3d74ab462a9ee9`; delta-02 SHA256 `d6069d0652f973ba2c662d49cb8ea571fd7517bfeb17bd97acb842411e3074b6`. All 29 hashes matched before/after; isolated patch matched saved intake identities.

Limitations: static review and retained evidence only; no tests, mutation probes or browser runs performed. Proposed controls remain unexecuted. No browser or overall acceptance claim.
