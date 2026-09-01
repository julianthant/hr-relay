# sup_sol_dcc1_f5_single_verified_snapshot

STATUS: COMPLETE; sole light slot returned with every owned gate finished.
ROLE: sup_sol, sequential seam writer (no dispatch). MODEL: assigned Sol. REASONING: high.
COMMITS: none; active merge retained for parent full-gate admission.

## Scope and invariant

The Settings reader now returns `{ record, runtimeStatus }` from one existing authority transaction.
It still validates THIS process's exact active identity before touching the file, uses
`readJournaledSettings`, and strictly parses runtime status. The editor consumes that pair once.
No recovery behavior, leaf resolver, wire schema, generation, or authority was changed.

FILES (explicitly staged): `AGENTS.md`, `src/server/settings-runtime.ts`,
`src/server/dashboard/queries/settings-editor.ts`, `tests/unit/server/bff-flow.test.ts`,
`tests/unit/server/capture-surface.test.ts`, `tests/parity/helpers/seeded-bff.ts`,
`tests/unit/server/settings-runtime-reader.test.ts`, and this report.

TDD at the pre-agreed seam established the duplicate acquisition before implementation. Five real
temporary-file/SQLite tests exercise current and restart-required paired identities, freshness
after apply, stale active refusal before file access, unjournaled-file refusal, and SQLite writer
exclusion during the real `afterLockLinked` callback. Lock counts observe actual file acquisition,
not mocked helper calls. A second real connection proves the authority transaction stays held.

## Gate evidence

Every command ran in `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`, sequentially.
Focused command prefix throughout:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test --
```

| Stage (2026-08-30 local time) | Suffix / command | Exact outcome |
| --- | --- | --- |
| Initial red, 08:16:28 | `tests/unit/server/settings-runtime-reader.test.ts` | 0 passed / 1 failed; exit 1; actual lock acquisitions `2 !== 1` |
| Minimal green, 08:17:01 | same | 1 passed / 0 failed; exit 0 |
| Expanded green, 08:18:19 | same | 5 passed / 0 failed; exit 0 |
| Active-check mutation, 08:18:50 | same | 4 passed / 1 failed; exit 1; stale-process refusal missing |
| Duplicate-read mutation, 08:18:58 | same | 1 passed / 4 failed; exit 1; acquisition counts doubled |
| Journal-bypass mutation, 08:19:05 | same plus `-t 'unjournaled file'` | 0 passed / 1 failed / 4 skipped; exit 1; expected refusal missing |
| Final focused, 08:19:17 | `tests/unit/server/settings-runtime-reader.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/capture-surface.test.ts tests/unit/server/compose-real-port.test.ts` | 4 files, 97 passed / 0 failed; 15.08s; session 56617 exit 0 |
| Locked full typecheck | `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | session 85221 exit 0; no diagnostics |
| Locked full lint | `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint` | session 13010 exit 0; no diagnostics |

Neither lock command queued (75). No gate remains active. Existing 28 compose tests, including
F2/F2b recovery regressions, passed unchanged; F3/F3b production safety was untouched.
No assertions, thresholds, or timeouts were weakened. No heavy coverage/parity gate was run.

## Mutation restoration and exact trees

The three temporary production mutations were, respectively: remove only `requireActive`, add
one duplicate `readJournaledSettings`, and substitute `input.file.read()` for the journaled read.
All were removed before final acceptance. Fixed production blob before mutations, after restoration,
and after locked gates is exactly `ddf323be869cbcf61a031bfb710a32e8a82bda06`.
Initial production blob was `a6748a08a210385049574c46cc9d9424a39cdea6`.

- HEAD: `0c115123a738f62cbe01c9b45f53b7289284479c`.
- MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`.
- Immutable staged intake: `0575003c76a3f60a817abcc4e24532a525dab506`.
- Staged implementation tree (seven owned paths, before this report): `b3807f9aee92d23be6b184e637cec77170954b1d`.
- Query blob: `f922771720688dae2e94f37e8c7dc613cb72f910`.
- New regression blob: `b092e4014c46abeaa3ebddee2aba4ad81efa4361`.

The final report-inclusive `git write-tree` is returned in the task response (avoiding a
self-referential tree claim in its own content). Diff/check and unresolved-entry checks were clean.
Parent staged baseline and unstaged reports/spec remain owned and preserved; the overall merge
is intentionally not claimed clean. Parent untracked reports are retained.

SCOUTS: none. REVIEW-HINT: compare against the immutable intake tree; inspect the real lock hook,
paired identity assertions, stale-active pre-file refusal, and unchanged recovery functions.

NOTES: `/ui` guided wire/fixture preservation review using the live
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
No TSX, presentation, labels, eight-leaf payload, or wire schema changed; adapters preserve their
existing served values. No rendered/browser/parity pass is claimed; later full merge and allocated
visual/heavy gates remain parent-owned. No live authority, migrations, D75 policy, shared board,
foreign checkout, or HR workflow was touched. Native role-prefix naming is the approved workaround.
