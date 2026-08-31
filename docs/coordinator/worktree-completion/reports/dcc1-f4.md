# DCC1 F4 — worker proof transfer

Status: complete test-proof seam; no production change and no commit.  Worktree:
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`, active merge
`0c115123a738f62cbe01c9b45f53b7289284479c` +
`13175b13340fec7b5326207fe54f98078d481d7d`.

## Contract pinned

The agreed public seam is `composeWorkerRuntime`, with a real temp-file
`AuthorityDatabase`, actual runtime process-lock records and repositories, and
the allowed external `sessionFactoryHarness` browser boundary.

`worker-composition.test.ts` adds 81 lines / removes 41 lines.  It now proves:

1. An unjournaled settings generation and each corrupt journal identity refusal
   leave a queued run queued and settle the worker process-lock snapshot at
   `{ state: "stopped", generation: 2 }`. The corrupt-identity cases additionally
   retain and compare the exact settings-file bytes.
   The snapshot observer is the same fixture identity observer used at
   acquisition (`synthetic-<pid>`, or the real-process observer), so an
   unreleased record is observed as `active`, never mistaken for PID reuse.
2. A queued run with a fingerprint older than worker boot opens neither UCPath
   nor CRM (`0` each), using the real harness counters.
3. The existing `afterClaimAdmissionCheck` hook replaces the brittle
   `bootTransactionsRemaining=2` database monkeypatch.  It runs inside the
   already-held claim transaction.  Its nested journal is a savepoint, not an
   independent durable dashboard commit: the stale-epoch refusal rolls the
   DB journal/current row back (both absent), keeps the run queued, and retains
   the already-written settings-file bytes.  It also opens neither browser.

No existing hook can model an independently durable external settings commit
between boot and the first claim; this test truthfully covers the atomic
admission crossing rather than pretending otherwise.  The prior post-boot
stale-epoch rejection is retained.

## TDD sensitivity and restoration

All temporary production mutations were restored byte-for-byte before gates:

| Mutation | Focused result | Restored blob |
| --- | --- | --- |
| Remove only the boot-catch `processLock.release()` | 9 passed / 24 skipped: outer cleanup still releases, so this is not sufficient evidence | `src/server/worker/compose.ts` `fe1c083c93bce1053219d496dd7376fded1500fa` |
| Remove both boot-catch and final `processLock.release()` calls | 9 failed / 24 skipped; each snapshot was `{state:"active", generation:2, pid:4242}` | same |
| Bypass queued fingerprint rejection | 1 failed / 32 skipped: UCPath opens `1 !== 0` | `src/infra/sqlite/authority-database.ts` `eda7c99cc569f5141b31a3fa0417bb891309a571` |
| Bypass stale-settings epoch rejection | 1 failed / 32 skipped: UCPath opens `1 !== 0` | same |

The first process-lock mutation is retained as evidence that both normal
cleanup paths participate; the second is the sensitivity proof for the new
stopped-record assertion.  There are no working-tree diffs for either source
file versus the staged implementation.

Parent receipt verified both Git blobs against the pre-F4 immutable tree,
returned index and working files; the report's initially mismatched hash values
were corrected above. No source delta remains. Parent independently reran
33/33 at08:28:51, exit0 (4.45s).

## Gate evidence

All commands used the assigned worktree and the sole transferred light slot.

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/worker-composition.test.ts
# 1 file, 33 passed / 0 failed, exit 0 (08:26:54 local)

/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
# exit 0 (08:27 local), eslint src tests scripts --max-warnings 0

/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
# exit 0 (08:27 local), tsc --noEmit

git diff --check -- tests/unit/worker-composition.test.ts
# exit 0
```

No full coverage/parity gate, live HR/auth, migration, D75 activity, browser
process, or foreign worktree was used.  The final process check found no
task-owned Vitest, ESLint, or TypeScript process.  Parent-owned staged and
unstaged paths (including clock-config-secrets) remain untouched.  Explicitly
stage only this test and this report; do not commit before the parent full
coverage gate.

Review hint: inspect the identity-matched lock observer, the exact file/DB
rollback distinction at admission, and counter assertions before the refusal
message checks, so a bypass reaches the browser-effect assertion.
