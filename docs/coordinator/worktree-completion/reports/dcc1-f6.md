# sup_sol_dcc1_f6_ambiguous_commit_proof

## Receipt

STATUS: complete assigned test-proof seam; parent review/full gates remain. ROLE: native
`sup_sol`, resumed original M3 execution, not supervisor. MODEL: native Sol; REASONING: high.
COMMITS: none. SCOUTS: none; no new task, agent, or worktree. Date: 2026-08-30.

All commands and edits used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Branch `feature/r-dcc-dcc1-exclusive` remains at
`0c115123a738f62cbe01c9b45f53b7289284479c`, with active `MERGE_HEAD`
`13175b13340fec7b5326207fe54f98078d481d7d`. No merge commit is authorized before
the parent full per-commit coverage gate.

Read the assigned complete root AGENTS and supplied project profile. Used `/tdd`
in existing-code tests mode at the explicitly assigned public seam: `kernel.execute`
through the real Settings file authority and temporary file-backed SQLite database.
No nearest additional AGENTS applies. No frontend or production behavior changed.

## FILES and proof

Only owned paths staged by F6:

- `tests/unit/command-kernel.test.ts`: one schema import and one 113-line regression;
  existing successful ambiguous-COMMIT proof and all existing assertions retained.
- `docs/coordinator/worktree-completion/reports/dcc1-f6.md`: this evidence.

The added `preserves committed settings when post-COMMIT inspection fails until exact
replay recovers` test calls the actual transaction first. After durable COMMIT returns,
the wrapper captures evidence and throws the original error; subsequent inspection
throws a distinct error. Explicit semantic states select those boundaries, without
unrelated transaction counts. It proves:

1. No false acknowledgement: the first public execute throws a primary-first
   `AggregateError` with the exact original/inspection error objects, inspection cause,
   and command-bound rollback-refused message.
2. No compensation: exact committed journal, audit, current row, revision-2 Settings
   bytes and initialization bytes survive, as do byte-exact prepared/lock evidence;
   no rollback file or prepared-evidence removal occurs.
3. Identities remain joined: complete command envelope, patch/schema/settings and
   command fingerprints, current audit id, timestamp, revision transition and applied
   result match. Expected revision is 1; committed revision is 2.
4. Restoring inspection and exactly replaying returns `already-applied`, preserving
   all committed rows/bytes and cleaning the prepared/lock evidence. Another exact
   replay neither reapplies nor cleans again. The removal observer invokes real unlink.

This is temporary-authority proof, not live deployment evidence. No actual product bug
was found at this seam. F3/F4 proofs were not repeated or changed.

## GATES: serial commands and outputs

Each command below exited before another light gate started. No coverage, parity,
browser, live HR, or live authority read occurred. All Vitest runs used one worker.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
# exit 0; eslint src tests scripts --max-warnings 0; no diagnostics; session 27499

env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/command-kernel.test.ts
# initial green: 1 file / 41 passed; exit 0; 08:32:06; 2.81s; session 14477
# restored final green: 1 file / 41 passed; exit 0; 08:33:46; 2.75s; session 10252

env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation /usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
# exit 0; tsc --noEmit; no diagnostics; session 6653

git diff --check -- tests/unit/command-kernel.test.ts
# exit 0; no diagnostics
```

### TDD sensitivity: two independent, temporary production mutations

1. Removed only `if (committed !== undefined) return committed;` from the Settings
   post-COMMIT catch. Ran:

   ```sh
   env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/command-kernel.test.ts -t 'reconciles an ambiguous post-COMMIT exception without rolling back committed settings'
   ```

   Exit 1; 1 failed / 40 skipped; 08:32:23; 1.61s; session 27349.
   Failure: `Error: injected exception after durable COMMIT`, at test line 1586;
   the public execute did not return the required successful reconciliation result.
   Restored and hash-verified the source before mutation 2.

2. Replaced only the failed-inspection `throw new AggregateError(...)` with
   `void reconciliationError;`, permitting fallthrough toward compensation. Ran:

   ```sh
   env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/command-kernel.test.ts -t 'preserves committed settings when post-COMMIT inspection fails until exact replay recovers'
   ```

   Exit 1; 1 failed / 40 skipped; 08:32:37; 1.55s; session 18401.
   Failure: `assert.ok(error instanceof AggregateError)` at test line 1661;
   actual false, expected true. Restored the source before final green verification.

Neither mutation was staged. No assertion, timeout, threshold, or test configuration
was loosened. Lint covered the same final test/source bytes; only restored temporary
mutations intervened. The tests-mode sensitivity step established both guard proofs.

## Restoration and tree accounting

`src/core/command-kernel.ts` before, after mutation 1, after mutation 2 and final:
Git blob `0c1f88bac2391f417e91570920d05360f36d531f`; unstaged source diff empty.
Test intake blob `1f886b605d37324a5c4a84f1f8715fb939ef04d5`;
final test blob `7fc169a7298710fe25512c8c970f8468cd1b127e`.

Intake index tree: `1f63a5878101e0f80a6381e8c02a60a8fe76d62d`.
Test-only staged tree, **before adding this report**:
`07d37d72a62b0e8686d53914117a91d85cd30027`.
The diff between those two trees is exactly `tests/unit/command-kernel.test.ts`.
The final report-inclusive index tree is returned in the receipt, avoiding a
self-referential hash in this file. These are index snapshots, not commit ids or
snapshots of parent unstaged documentation.

Parent-owned unstaged `dcc1-f4.md`, `dcc1-m2.md`, `dcc1-review-candidate.md` and
`dcc1.md` were not edited or staged by F6. Parent documentation continued changing
during this unit; F6 did not restore its intake bytes. Other staged implementation,
reports, migration bytes and active merge state are preserved. No unresolved merge
entries were present at verification.

REVIEW-HINT: inspect the semantic post-COMMIT/inspection wrapper, exact error ordering,
durable identity comparisons, and one-time cleanup across two exact replays. Review
the two red outputs alongside the restored source blob; both guards are independently
mutation-sensitive, not merely covered by a passing fixture.

NOTES: all F6-owned commands have exited; sole light slot is released to parent at
return. Heavy gates remain unallocated. This closes only F6's ambiguous-COMMIT proof
obligation, not M3 integration/task completion, migration collision disposition, or
permission to commit.
