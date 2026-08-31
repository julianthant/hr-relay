# sup_analyst_dcc1_f7a_readonly_runtime_join

2026-08-30. Read-only proposal, **not implementation authorization or a passed gate**.
Resumed original M2 native `sup_analyst` `01a052f4-49fb-7a33-9486-20da624baf3a`;
native Terra/high, 200k/180k. No new agent, source/test/doc-contract edit, gate or commit.
Parent persisted this report after checking the cited interfaces and owner passages.

Assigned workdir: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`, ordered MERGE_HEAD
`13175b13340fec7b5326207fe54f98078d481d7d`. Input index
`68c6147bc0dc88786e7a3659901968db43551df1`; parent evidence-only staging moved it to
`20084e72f254e895af901a35291e53dc29f77e85` during analysis. Product/test/config/reference
closure remained `8670eaea27bfc6eb00848eaa1ea1dbaeda11279169c8b6e2986614cca30ac7b9`.

## Verified conclusion and minimal proposal

Existing interfaces support start-time admission without creating an activation authority.
Minimal implementation seam would be `src/server/dry-run-scenario/runtime.ts`, its public
composition tests and nearest AGENTS lesson. Leave `compose.ts` blocked-target behavior,
worker, dashboard, core and CLI unchanged. No migration/history or credential changes.

1. Construct the selected `createSettingsFileAuthority` for `repoRoot/config/settings.json`.
   Follow worker boot: SQLite authority transaction → `readJournaledSettings`; resolve that
   returned Settings record with the supplied environment and clock.
2. Enter a final SQLite authority transaction → `withExactRecord` fence. Recheck
   `requireJournaledSettings` and call `runtimeConfig.requireActive` with exact Settings
   revision/fingerprint and resolved config fingerprint **before any plan/start effects**.
3. Still inside that synchronous transaction, read `runtimeConfig.get()` and explicitly
   refuse absence. It supplies the activated snapshot ID; `requireActive` already checked
   that exact retained snapshot exists and its fingerprint matches. No duplicate snapshot
   lookup or new snapshot insertion is necessary.
4. Plan and execute `start-run` synchronously within that final fence/transaction, using the
   activated snapshot ID/fingerprint for both planner and kernel. Nested transactions use
   savepoints. SQLite exclusion remains through commit; later activation/Settings changes
   retain the unchanged worker admission fencing and cannot rewrite the queued run identity.

No fallback generation, auto-activation, live-dashboard liveness requirement, or empty-Settings
substitute is proposed. A durable already-activated generation is sufficient. Environment
precedence is evaluated by the existing resolver; divergence from activation refuses.

## Source and ownership evidence

| Evidence | Exact inspected source |
|---|---|
| Existing independent empty-Settings snapshot defect | `src/server/dry-run-scenario/runtime.ts:197–259` |
| Selected boot admission and lock order | `src/server/worker/compose.ts:455–471`; `src/server/settings-runtime.ts:121–128`; `src/infra/config/settings-file.ts:1506–1520` |
| BEGIN IMMEDIATE / nested savepoints; exact retained snapshot validation | `src/infra/sqlite/authority-database.ts:2393–2435,3802–3836` |
| Dashboard alone activates runtime; retained per-run identity | `docs/rebuild/reference/clock-config-secrets.md:383–446`; `src/server/dashboard/compose.ts:606–624` |
| Real CLI dry-run contract, no explicit never-activated standalone guarantee found | `docs/rebuild/reference/guards-and-tests.md:1045–1047`, §10.4 `1762–1830`, §10.6 `1884–1902` |

The absence finding is limited to those owning passages, not an exhaustive repository-wide
claim. No conflicting product choice was identified there. Supporting a never-activated
standalone runtime would be a separate product/activation-policy decision, not this repair.

## Proposed red-capable public-runtime proof

These are proposed tests, **not executed** by F7a. Invoke public `runtime.start`, not a private
admission helper. Existing F7 red remains 2failed/6passed before Duo construction.

| Case | Required observable assertion |
|---|---|
| No activated generation | Start refuses by named generation error before plan/run creation |
| Journaled nondefault Settings newer than activation | Start refuses stale identity; preserves Settings journal and activation |
| Environment override diverges from activated fingerprint | Start refuses rather than minting/re-resolving a replacement snapshot |
| Missing or mismatched activated snapshot | Existing `requireActive` refusal propagates before start effects |
| Real nondefault Settings and matching activation | Apply through selected executor/kernel to establish exact file/command/audit/current linkage, then use existing dashboard activation contract as precondition. Public start retains that exact activated snapshot ID/fingerprint; no additional snapshot. Assert named environment precedence too |
| Refusal side effects | Compare startPlans, runs, runSessions, commands, commandAudits and configSnapshots before/after; retain Settings current/runtime evidence separately |

The positive test must fail against current production even with legitimate activation present:
current start ignores nondefault persisted Settings and inserts a different snapshot. Setup must
not merely seed a generation to conceal that defect. Negative tests must preserve all assertions
and timeouts. No-start-effects is not an untouched-filesystem claim: prior selected Settings
reconciliation may legitimately settle prepared evidence or initialize virgin-file evidence.
Keep those effects distinct from prohibited new plans/runs/start journals/snapshots.

Suggested future focused command from the assigned workdir:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

Any authorized implementation still needs actual red/green, separate locked typecheck/lint,
independent Tests/Security/Correctness/default-flow review, and renewed frozen identity before
heavy allocation. The conditional approved seven-line Duo port remains withheld; if admission
repair exposes that separate failure, obtain/confirm its bounded disposition. No heavy slot is open.
