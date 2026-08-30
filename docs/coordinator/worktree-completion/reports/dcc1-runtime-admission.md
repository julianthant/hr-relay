# DCC1 F7 — runtime-generation admission hold

Coordinator receive, 2026-08-30. Assigned source:
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
This records a diagnosis boundary, not implementation approval or heavy-gate readiness.

| Claim | Classification | Evidence checked | Disposition |
|---|---|---|---|
| Conditional Duo-port red did not match | Proved from retained command/output receipt | Assigned `reports/dcc1-f7.md`: single-worker `npm run test -- tests/unit/dry-run-scenario-composition.test.ts`, session70316 exit1, 2 failed/6 passed,2.79s; both fail `runtime config has no dashboard-activated generation` | Duo port withheld; equal failure counts are not equal failure causes |
| Parent reproduced same red | Supervisor-reported, not a coordinator rerun | Parent callback: exit1,2 failed/6 passed,2.56s | Consistent corroboration; not relabeled independent coordinator execution |
| No executable change from ready candidate | Proved by Git | HEAD0c115123a738f62cbe01c9b45f53b7289284479c, MERGE_HEAD13175b13340fec7b5326207fe54f98078d481d7d; index68c6147bc0dc88786e7a3659901968db43551df1 differs from488fecfabb40df072c4294800b07c3771ba1a20e only by166-line F7 report | Prior executable closure remains; readiness still withdrawn |
| Failure precedes Duo construction | Proved by source plus stack | `worker/compose.ts:463–471` requires exact active Settings/config; Duo factory is later at510; `authority-database.ts:3810` rejects absence | Do not weaken worker admission or provision credentials |
| Starter and worker use different config authority paths | Proved by source | `dry-run-scenario/runtime.ts:208–223` resolves env+empty Settings and inserts a new snapshot; dashboard `compose.ts:604–623` inserts its snapshot and activates runtime generation | Production composition join needs resolution; a test-only seed would not fix it |
| Activation belongs to dashboard boot | Proved by owner text | Assigned `clock-config-secrets.md:401–430`, with dry-run execution contract in `guards-and-tests.md` §10.4 | Preserve owner; no new standalone activation policy inferred |

## Scoped next step

Existing DCC1 supervisor received a read-only, single-seam analysis assignment using an existing
native unit. Return the minimal proposal for admitting the scenario starter against the selected
Settings/current/runtime identity and its activated snapshot **before start-plan/run effects**.
Trace the owning dry-run contract for any explicit incompatible standalone guarantee. The proposal
must preserve environment precedence, immutable run identity and dashboard-only activation.

Identify red-capable tests through the public production runtime for absent/stale/divergent
admission, activated nondefault Settings success, and no start effects on refusal. This is not
permission to write tests or implementation yet. No fake authority seed, auto-activation, default
generation, worker/CLI/auth/history edits or live provisioning. A genuine product-choice conflict
returns to the coordinator/operator rather than being decided in code. The seven-line Duo port
remains conditional on its actual later failure, not the presently observed one.

Fresh locked lint exit0 is recorded by the F7 receipt; no coordinator product tests were run.
Two unstaged files and the one untracked freeze ledger are coordination evidence only. No merge
commit or full coverage/parity has run. DCC4 retains the allocated9ede08fa heavy slot; DCC1 has no
reservation. Migration and D75 shared-integration boundaries remain unchanged.
