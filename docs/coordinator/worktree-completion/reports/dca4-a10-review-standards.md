# A10 native Standards return (verbatim)

Native task01a05310-bd69-7630-93b1-88c6c475c29e; submission01a0555c-4d74-7550-bdb7-4b8eca1961e5; native terminal return, reviewer closed. Parent verified cited fixture lines49–53 and owning DiagnosticBundleSchema.runId; repair pending all axes.

Standards · native role: sup_luna · reasoning: high

tests/parity/helpers/fixture-run-captures.ts:49 | low | The fixture reuses bundle `…b101` for both failedRun and doneRun. A diagnostic bundle belongs to exactly one run, so this simultaneous fixture violates D292’s same-run provenance rule despite passing individual wire schemas. | Give doneRun a distinct operator-request bundle ID; retain shared membership only among artifacts belonging to that run.

Count: 1 · Worst: low.

Identity checks: all 29 current hashes matched before and after. Every patch hunk matched current bytes; reconstructed dirty-intake before-hashes also matched.

- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Candidate: `259757261c5a288a5f5072c9294090907739caa4ffc9be1e9f3d74ab462a9ee9`
- Complete patch: `d6069d0652f973ba2c662d49cb8ea571fd7517bfeb17bd97acb842411e3074b6`

Required review/UI guidance, applicable instructions, profile and owner text inspected. No writes, tests, lint, builds, browser, gates or delegation. This finding concerns fixture ownership, not a demonstrated production failure. Rendered acceptance and integration proof remain unexecuted; unchanged D291 materializer concerns were excluded.
