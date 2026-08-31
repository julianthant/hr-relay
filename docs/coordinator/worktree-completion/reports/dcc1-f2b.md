# sup_sol_dcc1_f2b_prior_recovery

2026-08-30. STATUS: complete, staged only. ROLE: sup_sol execution. MODEL: gpt-5.6-sol
(assigned). REASONING: high. COMMITS: none. SCOUTS: none.

## Scope / state

All commands/edits used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Only this report and `tests/unit/server/compose-real-port.test.ts` are staged by F2b.
No production behavior change, F3 edit, migration, D75 policy change, live authority operation,
shared-board edit, or heavy gate. The parent explicitly released the sole light slot before
the first test invocation. Test-only follow-up; nearest AGENTS invariant already covers it.

| Identity | Exact value |
| --- | --- |
| HEAD unchanged | `0c115123a738f62cbe01c9b45f53b7289284479c` |
| MERGE_HEAD unchanged | `13175b13340fec7b5326207fe54f98078d481d7d` |
| Intake staged tree, including F3 and parent fixes | `ebb67fb466f85717654f1abc969ffba813539fd5` |
| Staged tree after tests, before this report | `27a86d7189d8bab35a2562c5fdcfa316abf4904c` |
| Test blob | `31c93984f51fb261123f691584b2fda3f418abd5` |
| Production blob, original and restored | `a6748a08a210385049574c46cc9d9424a39cdea6` |

Final tree additionally contains this report; its hash is in the return message to avoid
self-reference. The test delta is 129 added lines, no removed assertions. Parent unstaged
`dcc1-m2.md`, `dcc1-review-candidate.md`, and `dcc1.md` remain untouched; F3 and all other staged
content remain preserved. Production restoration was verified by blob hash and empty
`git diff --exit-code -- src/server/settings-runtime.ts`.

## Invariant and four cases

The real public `readJournaledSettings` first proves a fully journaled revision 2. The test then
SIGKILLs its own file writer after revision 3's live rename. Public authority reads prove no
revision-3 command/audit exists and `settings_current` still names revision 2.

| Prior authority | Required and observed behavior |
| --- | --- |
| Exact journaled revision 2 | Restore byte-exact prior settings/initialization, remove prepare, return exact revision-2 record; repeat is stable |
| Missing prior command | Refuse with the named missing journal before file settlement |
| Mismatched prior audit result fingerprint | Refuse with mismatched durable audit before file settlement |
| Mismatched audit/current completion timestamp | Refuse with non-exact canonical current identity before file settlement |

Each refusal runs twice and retains byte-exact live revision-3, prepare, and initialization
files, identical prior/next command/audit/current rows and authority metadata, and no rollback
artifact. Fault injection uses only an already-open temporary SQLite DB; disabling foreign-key
enforcement on that test-only handle allows the recovery seam itself to observe the corruption.
No trigger or migration is changed.

## Green / mutation red / restored green

Initial and inverse-mutation command:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/compose-real-port.test.ts -t 'prepared revision 3 over journaled revision 2'
```

| Run | Exact result |
| --- | --- |
| Original production | Exit 0: **4 passed / 24 skipped**, 4.08 s |
| Remove only `requireJournaledSettings(prepared.prior, repositories);` | Exit 1: **3 failed / 1 passed / 24 skipped**, 4.01 s |

All three failures were `AssertionError: refusal must retain exact live revision-3 bytes` at
the file-byte assertion. The later validation still threw, but rollback had already replaced
revision 3 with revision 2. This proves the tests distinguish pre-settlement refusal from a
too-late refusal. The exact removed line was restored; no temporary instrumentation remains.

Final acceptance after verified restoration:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/compose-real-port.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

| Gate | Result |
| --- | --- |
| Full composition file | Exit 0: **28 passed (28)**, 8.01 s; four new cases plus all 24 retained cases, including F2's mixed-presence matrix |
| Locked lint | Exit 0: `eslint src tests scripts --max-warnings 0`; no diagnostics |
| Staged and unstaged `git diff --check` | Exit 0 |
| Unmerged entries | None |

Optional full typecheck not run; the parent owns final full gates. All gate sessions exited,
crash children were synchronously reaped, temporary resources cleaned, and the light slot is
released on return. No process remains active from this unit.

REVIEW-HINT: the completion-mismatch case changes only the audit's completion time, leaving
its result valid; it specifically reaches prior `settings_current` binding validation.
NOTES: no new production behavior was needed. The tests pin the existing prior-generation
proof at the public recovery seam and demonstrate its sensitivity through the exact inverse mutation.
