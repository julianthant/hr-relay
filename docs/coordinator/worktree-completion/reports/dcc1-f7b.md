# sup_sol_dcc1_f7b_public_start_admission

## STATUS / ROLE / MODEL / REASONING / COMMITS

Assigned F7b implementation and local light gates complete; review-ready bounded candidate,
**not** overall M3 completion, heavy-gate readiness, or commit authorization.
ROLE: resumed native `sup_sol` M3/F6/F7 executor, not supervisor.
MODEL: native Sol. REASONING: high; assigned 240k/220k. COMMITS: none. SCOUTS: none.
No new task, agent, or worktree.

Every command and edit used
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Branch `feature/r-dcc-dcc1-exclusive`;
HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Intake index verified `160eeda8093a551dc2ff37d36335cf34dc19c206`, with no unstaged/untracked
files at intake. Parent subsequently edited only its two report paths; those are preserved.

Read complete applicable root AGENTS, supplied project profile, F7 and F7a reports,
global TDD skill and good-tests reference, and debug/router repository reference.
Used **TDD loop at the operator-confirmed public runtime.start seam**. Per-cycle commit
guidance is overridden by the explicit no-commit-before-parent-full-gates instruction.

## FILES and implemented join

Only these four paths are owned/staged by F7b:

1. `src/server/dry-run-scenario/runtime.ts`
2. `tests/unit/dry-run-scenario-composition.test.ts`
3. `AGENTS.md`
4. `docs/coordinator/worktree-completion/reports/dcc1-f7b.md`

The runtime constructs the selected `repoRoot/config/settings.json` authority, reads it
through SQLite → `readJournaledSettings`, and resolves the supplied environment with
those actual persisted Settings. Its final synchronous SQLite transaction takes the
exact file fence, rechecks journal ownership, and calls `runtimeConfig.requireActive`
before planning or starting. In that same transaction, `runtimeConfig.get` supplies the
retained snapshot id and identity, with explicit absence refusal. `requireActive` proves
the resolved fingerprint equals the active fingerprint and validates its retained snapshot;
planner and kernel receive that verified fingerprint and the active snapshot id.

Planner plus kernel remain synchronous under the final fence and outer transaction;
their nested transactions are savepoints. SQLite exclusion lasts through outer commit.
The old independent config-snapshot insertion is removed. No activation, default generation,
empty-Settings substitute, new private interface, or CLI policy is introduced.

Start clears its scenario/config identity before attempting admission, then publishes it
only after outer commit and database handle closure. A failed subsequent start cannot
leave a usable prior scenario identity. Existing admitted run rows remain immutable
under later Settings changes; later worker fencing is unchanged.

AGENTS adds the admission invariant and the exact approved credential-free fixture lesson.
No other owning text required correction for this unit. No descriptor import closure or
roadmap truth changed, so no manifest/roadmap generation or out-of-scope documentation edits.

## Public proof and actual red → green

All fixtures use temporary real files/SQLite, never live authority. Positive Settings setup
executes the selected file adapter through the real command kernel, proving file/command/
audit/current linkage, then invokes the existing dashboard activation repository contract.
It does not auto-activate in runtime.start or seed a row merely to hide the original defect.

| Public behavior | Evidence |
| --- | --- |
| Nondefault Settings + matching activation | Existing start test strengthened: revision 2, headless false, defaultWorkers 3; exact queued snapshot id/fingerprint retained; exact snapshot row unchanged; no extra snapshot. Original source fails even with valid activation. |
| Absent activation | Named refusal, no start effects, no runtime row. Legitimate virgin Settings initialization remains explicit. |
| Settings newer than activation | Revision 3 refuses; existing admitted run, selected file bytes, settings_current and activated runtime remain unchanged. Failed second start leaves no scenario identity. |
| Environment divergence | Supplied HRAUTO_DEFAULT_WORKERS=5 versus activated Settings=3 refuses without start effects or replacement snapshot. |
| Exact precedence | Persisted workers=3, activated/resolved workers=5 with env provenance; headless=false remains settings provenance. Start retains that exact existing snapshot. |
| Missing retained snapshot | Existing resolver fiscalYear clock edge models row loss after open validation and initial Settings read, before final admission. The named snapshot refusal has no start effects. |
| Mismatched retained snapshot | A deliberately corrupted temporary snapshot fingerprint refuses before start effects; no correction, substitution, or minting. |
| Outer commit failure | Actual SQLite trigger aborts metadata update only after a start audit exists. Full plans/runs/sessions/commands/audits/snapshots roll back; file/runtime identity survives; no premature scenario publication. Removing the trigger permits a subsequent exact-identity start. |

No-start-effects comparisons include complete rows of `start_plans`, `tasks` (the physical
run table), `run_sessions`, `commands`, `command_audits`, and `config_snapshots`.
Read-only test SQL supplements public exact-id reads because these repositories have no
general list API. Prior Settings apply/reconciliation/initialization is distinguished from
prohibited start effects. No existing assertion or timeout was weakened.

First meaningful red: **71232**, exit 1, wrong queued fingerprint
`5eb3f95401db40bfa69d8fc8813efbb0b2245ead07370adcf2e6b9d803223e72`
instead of activated nondefault
`b9e87b85db0b6585202886b47a1afd3838e510338fc639be73f7af5a67eb2dd9`.
The approved join made **98227** green. The next cycle's actual red **14544** exposed
scenario publication after failed outer commit; deferred publication made **52954** green.

Fixture-building errors are not counted as product reds: **61142** used the incorrect
physical table name runs (corrected to tasks); **75151** attempted an invalid runtime
generation UPDATE; **44437** truthfully reached open-time foreign-key refusal too early.
The missing-row fixture was moved to the existing clock edge, leaving all production
validation unchanged. The resulting **38031** is green at the intended admission boundary.

## Conditional Duo delta, separately observed and attributed

F7's earlier generation-error red remains in `dcc1-f7.md`; it was not relabeled as Duo.
After admission repair and explicit activation preconditions in the two existing worker
fixtures, **29375** failed 2 / passed 13 with the distinct
`SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path`.
Only then was the authorized 4-runtime + 3-test line port applied from
`845ca5a115ee6eef3e10598e88ea0a7fdf361888`. **70085** passed all 15.

Full-file Git identities at that isolated port boundary:

| File | Immediately before Duo port | Immediately after Duo port |
| --- | --- | --- |
| runtime.ts | `8fa2d368a90c6e433b92bac78ec7bf758290a2e3` | `ec2933b2587eee5359abd0c7d7b44952ff9d38de` |
| composition test | `c9683936711f7bcc149eff7261601aa1c463c047` | `bc8a79a7b937e31396d30e87a375ad0806d4c691` |

Reconstructing the complete pre-port files by stripping exactly those lines reproduces
both pre-port hashes; Git blob diffs are exactly 4/0 and 3/0. These objects are retained
in Git. Later lint-only test corrections are separately reflected in the final test blob below.
No wholesale file replacement or cherry-pick occurred.

Approved commit's full blobs remain runtime `b86da070630de4b40306ca8151a16f7c20c1345e`
and test `a3a74657be060ab24255a6df441d71b605a0cc74`. Final full files intentionally
**do not equal** those blobs: they also contain the newly authorized admission join/proofs.
The original full-file comparison before F7b differed only by the seven Duo lines.

## Sensitivity, exact restoration, and limitations

| Bounded temporary runtime mutation | Actual result |
| --- | --- |
| Remove only requireActive | **8692**: 3 failed / 2 passed / 10 skipped. Environment divergence falsely succeeds; absent/stale cases lose their required admission diagnostics. Missing/mismatched snapshots still refuse through the downstream planner guard. This is not evidence that requireActive is the only protection. |
| Remove outer start transaction, leaving real planner/kernel transactions | **39811**: 1 failed / 14 skipped; start_plans retains a committed row after the later commit refusal. |
| Ignore supplied env in the selected-Settings resolver call | **85115**: 1 failed / 14 skipped; exact precedence positive now wrongly refuses active identity. |
| Catch an admission error and return a fabricated started result | **73269**: 2 failed / 13 skipped; both snapshot-refusal tests report Missing expected rejection. This pins fail-loud public behavior despite the two normal internal guards. |

Every temporary production mutation was restored and hash-verified to
`ec2933b2587eee5359abd0c7d7b44952ff9d38de` before the next mutation/final gates.
No mutation was staged, no internal collaborator was mocked, no instrumentation remains.

Limits: missing-snapshot loss is deliberate temporary corruption on a separate connection
with foreign keys off, *after* the runtime connection validated its database. This is not a
normal supported write or permission to weaken open-time checks. The outer-commit trigger
proves SQLite rollback, not OS/process-loss durability or an ambiguous post-COMMIT result
(F6 owns that proof). The defensive get-absence branch is not artificially forced after
requireActive succeeds in the same transaction. No live browser/HR, multi-process filesystem
race, or independent security/default-flow review is claimed.

## Final GATES

All commands were serial, with VITEST_MAX_WORKERS=1 for every focused run and PARITY_UPDATE
unset. Final retained sequence:

- **28124**: focused composition suite, exit 0, **15/15 passed**, 09:03:44, 3.61s.
- **15288**: separately locked typecheck, exit 0, no diagnostics.
- **95655**: separately locked lint, exit 0, no diagnostics.
- Owned-path git diff --check: exit 0.

Earlier lint **2115** exited 1 for unsafe JSON member access and an unbound TestClock method
in the new tests. Both were corrected without relaxing assertions: narrow parsed JSON from
unknown, bind the saved method. The full required sequence above was rerun afterward.
No exit-75 queue retry, heavy gate, browser, parity, or coverage was run.

## Full tracked/index snapshot and preservation

The complete **pre-report candidate index tree** (all 1,946 tracked entries, not a path-only
snapshot) is `07a215114e92f31a7bbd59b41d83641d3bffc694`.
Its exact `git ls-files -s -z` byte stream SHA-256 is
`6d8d2d4972062a44a81559a7007c6b7fbc0846802231f7fd147fda7ba94ef84d`.
The full path/mode/blob inventory is recoverable with
`git ls-tree -r 07a215114e92f31a7bbd59b41d83641d3bffc694`.
Compared to intake, it changes exactly the three code/test/AGENTS paths above.

| Path | Intake Git blob | Final Git blob |
| --- | --- | --- |
| AGENTS.md | `aaff4bc2c74d6380f1a491164c7acf659ae62877` | `3e5940007eba8341f1b0ea69e8c50a56b2ebb5ee` |
| runtime.ts | `bece5d887c0cd92620ff716bc99f3d9710a6466d` | `ec2933b2587eee5359abd0c7d7b44952ff9d38de` |
| composition test | `c418b42c35a300ac6faa7b12e4889c3cfd8ed87e` | `4346f2f4b7de075eeb190d2f46bf643a57c265ce` |

Final content SHA-256: runtime
`fad7323d013fee2405f4baddfab698a731badf3bbe01abd62b8c62546c1c8f44`;
test `a5727a5a25a690a004ac7687cd9ecc00adc9c42447c49a152ad087ec21c5383d`;
AGENTS `a62a8ddc29164dcb729a5ae97029ad9d5765e326449638ba33518eaa880a356a`.

The final **report-inclusive** index tree/hash is returned in the external receipt to avoid
self-reference. It adds only this report to the pre-report tree. Parent unstaged
`dcc1.md` and `dcc1-review-candidate.md` were neither edited nor staged by F7b.
No unresolved merge entries; original HEAD/MERGE_HEAD preserved.

Worker blob remains `fe1c083c93bce1053219d496dd7376fded1500fa`;
CLI remains `7fe107620b2a3c91c6f1ab4936c5138d15ffe9e0`.
Read-only inspection confirms CLI omits Duo injection and worker omission still selects the
strict real credential factory. Excluded core/worker/CLI/dashboard/blocked-target composition,
SQLite/migrations and history are byte-identical to intake. No manual .env/.auth access or
credential provisioning occurred; the required Duo red exposed the default factory's missing-file
stat, then the approved synthetic gate seam removed that fixture dependency.

Cross-run migration collisions and D75 final-join residue are unchanged; no global compatibility
claim. Parent independent Spec/Correctness/Silent/Tests/Security/Standards/Docs/Performance
review, a new frozen closure, and coordinator heavy allocation remain required. All F7b-owned
commands exited; sole light slot is released to parent at return.

## Raw gate command/output ledger

The following records retain actual exits, including fixture errors and expected mutation reds.
Output is the returned tool text (first fixture error retains the completion chunk), with
trailing formatter whitespace removed for git diff --check; no failures are converted to passes.

### 1. fixture error: incorrect physical table name

Session 61142; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'activated nondefault Settings snapshot'
```

```text
-x------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > starts through the real start-plan service with the activated nondefault Settings snapshot
Error: no such table: runs
 ❯ tests/unit/dry-run-scenario-composition.test.ts:108:43
    106|     // rows on a read-only test connection, in addition to public exac…
    107|     return ["start_plans", "runs", "run_sessions", "commands", "comman…
    108|       .map((table) => ({ table, rows: raw.prepare(`SELECT * FROM ${tab…
       |                                           ^
    109|   } finally {
    110|     raw.close();
 ❯ startEffects tests/unit/dry-run-scenario-composition.test.ts:108:8
 ❯ tests/unit/dry-run-scenario-composition.test.ts:354:29

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 7 skipped (8)
   Start at  08:54:50
   Duration  2.06s (transform 1.12s, setup 0ms, import 1.86s, tests 125ms, environment 0ms)
```

### 2. nondefault-red

Session 71232; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'activated nondefault Settings snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t activated nondefault Settings snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-x------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > starts through the real start-plan service with the activated nondefault Settings snapshot
AssertionError: Expected values to be strictly equal:
+ actual - expected

+ '5eb3f95401db40bfa69d8fc8813efbb0b2245ead07370adcf2e6b9d803223e72'
- 'b9e87b85db0b6585202886b47a1afd3838e510338fc639be73f7af5a67eb2dd9'


Expected: "b9e87b85db0b6585202886b47a1afd3838e510338fc639be73f7af5a67eb2dd9"
Received: "5eb3f95401db40bfa69d8fc8813efbb0b2245ead07370adcf2e6b9d803223e72"

 ❯ tests/unit/dry-run-scenario-composition.test.ts:398:14
    396|     try {
    397|       const run = database.authority.runs.get(started.runId);
    398|       assert.equal(run?.envelope.configFingerprint, active.configFinge…
       |              ^
    399|       assert.equal(run?.envelope.configSnapshotId, active.configSnapsh…
    400|       assert.equal(record.revision, 2);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 7 skipped (8)
   Start at  08:55:18
   Duration  2.06s (transform 1.10s, setup 0ms, import 1.83s, tests 156ms, environment 0ms)
```

### 3. nondefault-green

Session 98227; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'activated nondefault Settings snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t activated nondefault Settings snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-·------

 Test Files  1 passed (1)
      Tests  1 passed | 7 skipped (8)
   Start at  08:55:44
   Duration  1.93s (transform 1.05s, setup 0ms, import 1.69s, tests 165ms, environment 0ms)
```

### 4. rollback-identity-red

Session 14544; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'rolls back outer start commit'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t rolls back outer start commit


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--x------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > rolls back outer start commit failure without publishing a scenario identity
AssertionError: The input did not match the regular expression /dry-run evidence collection ran before start/. Input:

'Error: dry-run 11111111-1111-4111-8111-111111111111 does not exist at evidence collection'


- Expected:
/dry-run evidence collection ran before start/

+ Received:
Error {
  "message": "dry-run 11111111-1111-4111-8111-111111111111 does not exist at evidence collection",
}

 ❯ tests/unit/dry-run-scenario-composition.test.ts:459:7
    457|       assert.deepEqual(fixture.database.authority.runtimeConfig.get(),…
    458|       assert.deepEqual(readFileSync(join(fixture.root, "config", "sett…
    459|       await assert.rejects(fixture.runtime.collectEvidence("11111111-1…
       |       ^
    460|         /dry-run evidence collection ran before start/);
    461|       raw.exec("DROP TRIGGER refuse_start_commit");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
   Start at  08:56:26
   Duration  1.95s (transform 1.05s, setup 0ms, import 1.70s, tests 172ms, environment 0ms)
```

### 5. rollback-identity-green

Session 52954; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'rolls back outer start commit'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t rolls back outer start commit


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--·------

 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
   Start at  08:56:55
   Duration  2.38s (transform 1.23s, setup 0ms, import 2.06s, tests 240ms, environment 0ms)
```

### 6. absent-green-before-mutation

Session 13041; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses absent activation'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses absent activation


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--·-------

 Test Files  1 passed (1)
      Tests  1 passed | 9 skipped (10)
   Start at  08:57:25
   Duration  2.18s (transform 1.18s, setup 0ms, import 2.01s, tests 89ms, environment 0ms)
```

### 7. stale-green-before-mutation

Session 21473; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses journaled Settings newer'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses journaled Settings newer


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

---·-------

 Test Files  1 passed (1)
      Tests  1 passed | 10 skipped (11)
   Start at  08:57:41
   Duration  2.13s (transform 1.07s, setup 0ms, import 1.78s, tests 263ms, environment 0ms)
```

### 8. env-divergence-green-before-mutation

Session 4077; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses an environment divergent'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses an environment divergent


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----·-------

 Test Files  1 passed (1)
      Tests  1 passed | 11 skipped (12)
   Start at  08:57:53
   Duration  2.15s (transform 1.19s, setup 0ms, import 1.93s, tests 157ms, environment 0ms)
```

### 9. env-precedence-green-before-mutation

Session 10172; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'retains exact environment precedence'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t retains exact environment precedence


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-----·-------

 Test Files  1 passed (1)
      Tests  1 passed | 12 skipped (13)
   Start at  08:58:08
   Duration  2.11s (transform 1.08s, setup 0ms, import 1.85s, tests 181ms, environment 0ms)
```

### 10. fixture error: illegal generation update

Session 75151; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses a missing activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses a missing activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x-------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses a missing activated snapshot before any start effects
Error: runtime_config generation must advance exactly once
 ❯ tests/unit/dry-run-scenario-composition.test.ts:513:10
    511|       const missingId = "11111111-1111-4111-8111-111111111111";
    512|       raw.prepare("UPDATE runtime_config SET config_snapshot_id = ?, r…
    513|         .run(missingId, missingId);
       |          ^
    514|     } finally {
    515|       raw.close();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 13 skipped (14)
   Start at  08:58:22
   Duration  1.97s (transform 1.07s, setup 0ms, import 1.76s, tests 130ms, environment 0ms)
```

### 11. mismatched-snapshot-green-before-mutation

Session 6610; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses a mismatched activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses a mismatched activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-------·-------

 Test Files  1 passed (1)
      Tests  1 passed | 14 skipped (15)
   Start at  08:58:34
   Duration  2.02s (transform 1.08s, setup 0ms, import 1.77s, tests 170ms, environment 0ms)
```

### 12. fixture refinement: open-time FK refusal

Session 44437; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses a missing activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses a missing activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x--------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses a missing activated snapshot before any start effects
AssertionError: The input did not match the regular expression /active runtime config generation 1 does not bind exact snapshot/. Input:

'Error: failed to open authority database /var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-dry-run-admission-jxaFYC/.tracker-rebuild/state.db: authority database foreign-key validation failed for 1 row(s)'


- Expected:
/active runtime config generation 1 does not bind exact snapshot/

+ Received:
Error {
  "message": "failed to open authority database /var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-dry-run-admission-jxaFYC/.tracker-rebuild/state.db: authority database foreign-key validation failed for 1 row(s)",
  "cause": Error {
    "message": "authority database foreign-key validation failed for 1 row(s)",
  },
}

 ❯ tests/unit/dry-run-scenario-composition.test.ts:519:5
    517|     }
    518|     const before = startEffects(fixture.path);
    519|     await assert.rejects(fixture.runtime.start(fixture.request), /acti…
       |     ^
    520|     assert.deepEqual(startEffects(fixture.path), before);
    521|     assert.deepEqual(fixture.database.authority.runtimeConfig.get(), a…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 14 skipped (15)
   Start at  08:58:54
   Duration  2.26s (transform 1.21s, setup 0ms, import 2.06s, tests 121ms, environment 0ms)
```

### 13. missing-snapshot-green-after-open

Session 38031; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses a missing activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses a missing activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------·--------

 Test Files  1 passed (1)
      Tests  1 passed | 14 skipped (15)
   Start at  08:59:31
   Duration  2.16s (transform 1.18s, setup 0ms, import 1.93s, tests 150ms, environment 0ms)
```

### 14. admission-green-duo-distinct-red

Session 29375; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

·········xx····

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > composes both worker drains and the real gate command through terminal receipt evidence
SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path
 ❯ requireSecretFile src/domain/secrets.ts:402:11
    400|     assertReadableSecretFile(name, spec.classification, config.paths.d…
    401|   } catch (error) {
    402|     throw new SecretFileError(`${name} is unavailable at the registere…
       |           ^
    403|   }
    404|   try {
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:609:19

Caused by: SecretSourceError: duoWebauthnCredential source credential-file is unavailable at its registered path
 ❯ assertReadableSecretFile src/domain/secrets.ts:205:11
 ❯ requireSecretFile src/domain/secrets.ts:400:5
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:609:19

Caused by: Error: ENOENT: no such file or directory, stat '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/.auth/duo-webauthn.json'
 ❯ assertReadableSecretFile src/domain/secrets.ts:203:23
 ❯ requireSecretFile src/domain/secrets.ts:400:5
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:609:19

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'stat', path: '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/.auth/duo-webauthn.json' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > derives transaction reach and EID-safe failure evidence from every durable worker sink
SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path
 ❯ requireSecretFile src/domain/secrets.ts:402:11
    400|     assertReadableSecretFile(name, spec.classification, config.paths.d…
    401|   } catch (error) {
    402|     throw new SecretFileError(`${name} is unavailable at the registere…
       |           ^
    403|   }
    404|   try {
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:684:19

Caused by: SecretSourceError: duoWebauthnCredential source credential-file is unavailable at its registered path
 ❯ assertReadableSecretFile src/domain/secrets.ts:205:11
 ❯ requireSecretFile src/domain/secrets.ts:400:5
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:684:19

Caused by: Error: ENOENT: no such file or directory, stat '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/.auth/duo-webauthn.json'
 ❯ assertReadableSecretFile src/domain/secrets.ts:203:23
 ❯ requireSecretFile src/domain/secrets.ts:400:5
 ❯ resolveSecretFileIdentity src/domain/secrets.ts:458:17
 ❯ duoCeremonyCredentialKey src/core/duo-ceremony-gate.ts:364:43
 ❯ composeDuoCeremonyGateFactory src/core/duo-ceremony-gate.ts:380:20
 ❯ composeWorkerRuntime src/server/worker/compose.ts:510:44
 ❯ Object.drain src/server/dry-run-scenario/runtime.ts:165:11
 ❯ tests/unit/dry-run-scenario-composition.test.ts:684:19

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'stat', path: '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/.auth/duo-webauthn.json' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 13 passed (15)
   Start at  08:59:44
   Duration  3.79s (transform 1.24s, setup 0ms, import 2.04s, tests 1.67s, environment 0ms)
```

### 15. duo-green

Session 70085; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

···············

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  09:00:09
   Duration  4.02s (transform 1.31s, setup 0ms, import 2.11s, tests 1.82s, environment 0ms)
```

### 16. mutation-remove-requireActive

Session 8692; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses absent activation|refuses journaled Settings newer|refuses an environment divergent|refuses a missing activated snapshot|refuses a mismatched activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses absent activation|refuses journaled Settings newer|refuses an environment divergent|refuses a missing activated snapshot|refuses a mismatched activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--xxx-··-------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses absent activation before any start effects while allowing virgin Settings initialization
AssertionError: The input did not match the regular expression /runtime config has no dashboard-activated generation/. Input:

'Error: dry-run start lost its dashboard-activated config snapshot'


- Expected:
/runtime config has no dashboard-activated generation/

+ Received:
Error {
  "message": "dry-run start lost its dashboard-activated config snapshot",
}

 ❯ tests/unit/dry-run-scenario-composition.test.ts:446:5
    444|     const fixture = admissionFixture();
    445|     const before = startEffects(fixture.path);
    446|     await assert.rejects(fixture.runtime.start(fixture.request), /runt…
       |     ^
    447|     assert.deepEqual(startEffects(fixture.path), before);
    448|     assert.equal(fixture.database.authority.runtimeConfig.get(), undef…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses journaled Settings newer than activation without rewriting an admitted run
AssertionError: The input did not match the regular expression /settings revision 3 .*not dashboard-active; restart activation is required/. Input:

'Error: dashboard runtime settings are stale; restart activation is required'


- Expected:
/settings revision 3 .*not dashboard-active; restart activation is required/

+ Received:
Error {
  "message": "dashboard runtime settings are stale; restart activation is required",
}

 ❯ tests/unit/dry-run-scenario-composition.test.ts:466:5
    464|     const bytes = readFileSync(join(fixture.root, "config", "settings.…
    465|     const current = fixture.database.authority.settingsCurrent.get();
    466|     await assert.rejects(fixture.runtime.start(fixture.request), /sett…
       |     ^
    467|     assert.deepEqual(startEffects(fixture.path), before);
    468|     assert.deepEqual(fixture.database.authority.runs.get(admitted.runI…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses an environment divergent from activation before any start effects
AssertionError: Missing expected rejection.

simple

 ❯ tests/unit/dry-run-scenario-composition.test.ts:483:5
    481|     const before = startEffects(fixture.path);
    482|     const bytes = readFileSync(join(fixture.root, "config", "settings.…
    483|     await assert.rejects(fixture.runtime.start(fixture.request), /not …
       |     ^
    484|     assert.deepEqual(startEffects(fixture.path), before);
    485|     assert.deepEqual(fixture.database.authority.runtimeConfig.get(), a…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 2 passed | 10 skipped (15)
   Start at  09:00:34
   Duration  2.54s (transform 1.07s, setup 0ms, import 1.72s, tests 749ms, environment 0ms)
```

### 17. mutation-remove-outer-transaction

Session 39811; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'rolls back outer start commit'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t rolls back outer start commit


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--------x------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > rolls back outer start commit failure without publishing a scenario identity
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected

  [
    {
+     rows: [
+       [Object: null prototype] {
+         consumed_by: null,
+         created_at: '2026-08-25T18:00:00.000Z',
+         expires_at: '2026-08-25T18:10:00.000Z',
+         record_json: '{"canonicalInputSchemaHash":"ba413bac41ff8f34ae7a6ff01391d9eb43eb86884406525465c4ccdbdfb65281","configFingerprint":"dec4cab15271861a836ad3c12b4d9d890882e6c65bda3176317f88ae91991207","configSnapshotId":"bbbbbbbb-0003-4000-8000-000300000000","createdAt":"2026-08-25T18:00:00.000Z","descriptorFingerprint":"ee86b002308fc3f981f4fb1787aa5eb8ee8998b4732c02b6534d16fec8e7d0a2","descriptorVersion":1,"dryRun":true,"expiresAt":"2026-08-25T18:10:00.000Z","ingressSchemaHash":"50140d55cb2685ce8b1d3ac5f61bf15b428fef0019e654e34b8d50701f0f871e","inputFingerprint":"d50ce41f2e8a2c71889b1b0c8fd4943874b914ddf6df1456626d17533641d959","planned":[{"canonicalInputDigest":"8fc802a2f5f6f272d9e86bd8ae0218d717ce842dafc8909c6ac887d8fc296dbf","input":{"schemaHash":"ba413bac41ff8f34ae7a6ff01391d9eb43eb86884406525465c4ccdbdfb65281","value":{"actionId":"0123456789abcdef01234567","documentEid":{"state":"present","value":"10800000"},"documentNumber":"4444","emplId":"10800000","emplIdSource":"document-eid","employeeName":"Person, Deterministic","lastDayWorked":"06/09/2026","observedDepartmentOptions":["- - -","000141 - Early Childhood Education Center","000412 - Housing/Dining/Hospitality","000414 - Bookstore","000422 - Triton Print & Digital Media","000719 - Supply Chain Services"],"observedExistingComments":"","payrollTitle":"STDT 2","payrollTitleCode":"004921","separationDate":"06/10/2026","terminationEffectiveDate":"06/11/2026","timekeeperComments":"Termination effective date set from the reconciled separation date.","timekeeperName":"Deterministic Timekeeper","transactionNumber":"T009000001","ucpathDepartment":{"state":"present","value":"HOUSING/DINING/HOSPITALITY"},"ucpathDeptId":{"state":"present","value":"000412"}}},"itemId":"6af84b24-fd02-53bf-bc57-2c0b66747c9f","matchKey":"separations-kuali-finalization:4444:T009000001","rawInput":{"actionId":"0123456789abcdef01234567","documentEid":{"state":"present","value":"10800000"},"documentNumber":"4444","emplId":"10800000","emplIdSource":"document-eid","employeeName":"Person, Deterministic","lastDayWorked":"06/09/2026","observedDepartmentOptions":["- - -","000141 - Early Childhood Education Center","000412 - Housing/Dining/Hospitality","000414 - Bookstore","000422 - Triton Print & Digital Media","000719 - Supply Chain Services"],"observedExistingComments":"","payrollTitle":"STDT 2","payrollTitleCode":"004921","separationDate":"06/10/2026","terminationEffectiveDate":"06/11/2026","timekeeperComments":"Termination effective date set from the reconciled separation date.","timekeeperName":"Deterministic Timekeeper","transactionNumber":"T009000001","ucpathDepartment":{"state":"present","value":"HOUSING/DINING/HOSPITALITY"},"ucpathDeptId":{"state":"present","value":"000412"}},"runId":"dddddddd-0001-4000-8000-000100000000","subtitle":"Person, Deterministic — T009000001","title":"Kuali 4444 finalization","traceId":"sf-110000-dddd"}],"plannedAt":"2026-08-25T18:00:00.000Z","plannedBy":"local-operator","priority":"interactive","refused":[],"resolvedInstance":{"kuali":"prod","ucpath":"prod"},"shape":"single","startPlanId":"dddddddd-0002-4000-8000-000200000000","updatedAt":"2026-08-25T18:00:00.000Z","version":1,"workflowId":"separations-kuali-finalization"}',
+         record_key: 'dddddddd-0002-4000-8000-000200000000',
+         version: 1,
+         workflow: 'separations-kuali-finalization'
+       }
+     ],
-     rows: [],
      table: 'start_plans'
    },
    {
      rows: [],
      table: 'tasks'


- Expected
+ Received

@@ -1,8 +1,18 @@
  [
    {
-     "rows": [],
+     "rows": [
+       {
+         "consumed_by": null,
+         "created_at": "2026-08-25T18:00:00.000Z",
+         "expires_at": "2026-08-25T18:10:00.000Z",
+         "record_json": "{\"canonicalInputSchemaHash\":\"ba413bac41ff8f34ae7a6ff01391d9eb43eb86884406525465c4ccdbdfb65281\",\"configFingerprint\":\"dec4cab15271861a836ad3c12b4d9d890882e6c65bda3176317f88ae91991207\",\"configSnapshotId\":\"bbbbbbbb-0003-4000-8000-000300000000\",\"createdAt\":\"2026-08-25T18:00:00.000Z\",\"descriptorFingerprint\":\"ee86b002308fc3f981f4fb1787aa5eb8ee8998b4732c02b6534d16fec8e7d0a2\",\"descriptorVersion\":1,\"dryRun\":true,\"expiresAt\":\"2026-08-25T18:10:00.000Z\",\"ingressSchemaHash\":\"50140d55cb2685ce8b1d3ac5f61bf15b428fef0019e654e34b8d50701f0f871e\",\"inputFingerprint\":\"d50ce41f2e8a2c71889b1b0c8fd4943874b914ddf6df1456626d17533641d959\",\"planned\":[{\"canonicalInputDigest\":\"8fc802a2f5f6f272d9e86bd8ae0218d717ce842dafc8909c6ac887d8fc296dbf\",\"input\":{\"schemaHash\":\"ba413bac41ff8f34ae7a6ff01391d9eb43eb86884406525465c4ccdbdfb65281\",\"value\":{\"actionId\":\"0123456789abcdef01234567\",\"documentEid\":{\"state\":\"present\",\"value\":\"10800000\"},\"documentNumber\":\"4444\",\"emplId\":\"10800000\",\"emplIdSource\":\"document-eid\",\"employeeName\":\"Person, Deterministic\",\"lastDayWorked\":\"06/09/2026\",\"observedDepartmentOptions\":[\"- - -\",\"000141 - Early Childhood Education Center\",\"000412 - Housing/Dining/Hospitality\",\"000414 - Bookstore\",\"000422 - Triton Print & Digital Media\",\"000719 - Supply Chain Services\"],\"observedExistingComments\":\"\",\"payrollTitle\":\"STDT 2\",\"payrollTitleCode\":\"004921\",\"separationDate\":\"06/10/2026\",\"terminationEffectiveDate\":\"06/11/2026\",\"timekeeperComments\":\"Termination effective date set from the reconciled separation date.\",\"timekeeperName\":\"Deterministic Timekeeper\",\"transactionNumber\":\"T009000001\",\"ucpathDepartment\":{\"state\":\"present\",\"value\":\"HOUSING/DINING/HOSPITALITY\"},\"ucpathDeptId\":{\"state\":\"present\",\"value\":\"000412\"}}},\"itemId\":\"6af84b24-fd02-53bf-bc57-2c0b66747c9f\",\"matchKey\":\"separations-kuali-finalization:4444:T009000001\",\"rawInput\":{\"actionId\":\"0123456789abcdef01234567\",\"documentEid\":{\"state\":\"present\",\"value\":\"10800000\"},\"documentNumber\":\"4444\",\"emplId\":\"10800000\",\"emplIdSource\":\"document-eid\",\"employeeName\":\"Person, Deterministic\",\"lastDayWorked\":\"06/09/2026\",\"observedDepartmentOptions\":[\"- - -\",\"000141 - Early Childhood Education Center\",\"000412 - Housing/Dining/Hospitality\",\"000414 - Bookstore\",\"000422 - Triton Print & Digital Media\",\"000719 - Supply Chain Services\"],\"observedExistingComments\":\"\",\"payrollTitle\":\"STDT 2\",\"payrollTitleCode\":\"004921\",\"separationDate\":\"06/10/2026\",\"terminationEffectiveDate\":\"06/11/2026\",\"timekeeperComments\":\"Termination effective date set from the reconciled separation date.\",\"timekeeperName\":\"Deterministic Timekeeper\",\"transactionNumber\":\"T009000001\",\"ucpathDepartment\":{\"state\":\"present\",\"value\":\"HOUSING/DINING/HOSPITALITY\"},\"ucpathDeptId\":{\"state\":\"present\",\"value\":\"000412\"}},\"runId\":\"dddddddd-0001-4000-8000-000100000000\",\"subtitle\":\"Person, Deterministic — T009000001\",\"title\":\"Kuali 4444 finalization\",\"traceId\":\"sf-110000-dddd\"}],\"plannedAt\":\"2026-08-25T18:00:00.000Z\",\"plannedBy\":\"local-operator\",\"priority\":\"interactive\",\"refused\":[],\"resolvedInstance\":{\"kuali\":\"prod\",\"ucpath\":\"prod\"},\"shape\":\"single\",\"startPlanId\":\"dddddddd-0002-4000-8000-000200000000\",\"updatedAt\":\"2026-08-25T18:00:00.000Z\",\"version\":1,\"workflowId\":\"separations-kuali-finalization\"}",
+         "record_key": "dddddddd-0002-4000-8000-000200000000",
+         "version": 1,
+         "workflow": "separations-kuali-finalization",
+       },
+     ],
      "table": "start_plans",
    },
    {
      "rows": [],
      "table": "tasks",

 ❯ tests/unit/dry-run-scenario-composition.test.ts:565:14
    563|         BEGIN SELECT RAISE(ABORT, 'synthetic outer start commit refusa…
    564|       await assert.rejects(fixture.runtime.start(fixture.request), /sy…
    565|       assert.deepEqual(startEffects(fixture.path), before);
       |              ^
    566|       assert.deepEqual(fixture.database.authority.runtimeConfig.get(),…
    567|       assert.deepEqual(readFileSync(join(fixture.root, "config", "sett…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 14 skipped (15)
   Start at  09:01:22
   Duration  2.11s (transform 1.12s, setup 0ms, import 1.87s, tests 159ms, environment 0ms)
```

### 18. mutation-ignore-supplied-env

Session 85115; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'retains exact environment precedence'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t retains exact environment precedence


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-----x---------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > retains exact environment precedence in the existing activated snapshot
Error: settings revision 2 at a2c52d4c42cc4924d9b63c97243fb7df5c2e47c8fac9104790fec369d13ca1eb and config b9e87b85db0b6585202886b47a1afd3838e510338fc639be73f7af5a67eb2dd9 are not dashboard-active; restart activation is required
 ❯ Object.requireActive src/infra/sqlite/authority-database.ts:3815:19
    3813|             || current.settingsFingerprint !== request.settingsFingerp…
    3814|             || current.configFingerprint !== request.configFingerprint…
    3815|             throw new Error(
       |                   ^
    3816|               `settings revision ${String(request.settingsRevision)} a…
    3817|               + `and config ${request.configFingerprint} are not dashb…
 ❯ src/server/dry-run-scenario/runtime.ts:222:38
 ❯ src/infra/config/settings-file.ts:1519:16
 ❯ releaseAfter src/infra/config/settings-file.ts:498:14
 ❯ Object.withExactRecord src/infra/config/settings-file.ts:1509:14
 ❯ src/server/dry-run-scenario/runtime.ts:217:90
 ❯ src/infra/sqlite/authority-database.ts:1823:53
 ❯ AuthorityDatabase.#withTransaction src/infra/sqlite/authority-database.ts:2422:22
 ❯ AuthorityDatabase.withAuthorityTransaction src/infra/sqlite/authority-database.ts:1823:17
 ❯ Object.start src/server/dry-run-scenario/runtime.ts:217:29

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 14 skipped (15)
   Start at  09:01:36
   Duration  2.10s (transform 1.13s, setup 0ms, import 1.85s, tests 178ms, environment 0ms)
```

### 19. mutation-false-acknowledgement

Session 73269; raw exit 1.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts -t 'refuses a missing activated snapshot|refuses a mismatched activated snapshot'
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts -t refuses a missing activated snapshot|refuses a mismatched activated snapshot


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------xx-------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses a missing activated snapshot before any start effects
AssertionError: Missing expected rejection.

simple

 ❯ tests/unit/dry-run-scenario-composition.test.ts:524:7
    522|         return fiscalYear(at);
    523|       };
    524|       await assert.rejects(fixture.runtime.start(fixture.request), /ac…
       |       ^
    525|       assert.ok(before !== undefined, "the real resolver reached the r…
    526|       assert.deepEqual(startEffects(fixture.path), before);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > refuses a mismatched activated snapshot before any start effects
AssertionError: Missing expected rejection.

simple

 ❯ tests/unit/dry-run-scenario-composition.test.ts:546:5
    544|     }
    545|     const before = startEffects(fixture.path);
    546|     await assert.rejects(fixture.runtime.start(fixture.request), /acti…
       |     ^
    547|     assert.deepEqual(startEffects(fixture.path), before);
    548|     assert.deepEqual(fixture.database.authority.runtimeConfig.get(), a…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 13 skipped (15)
   Start at  09:01:47
   Duration  2.09s (transform 1.07s, setup 0ms, import 1.73s, tests 289ms, environment 0ms)
```

### 20. final-focused

Session 52997; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

···············

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  09:02:12
   Duration  3.60s (transform 1.10s, setup 0ms, import 1.79s, tests 1.73s, environment 0ms)
```

### 21. typecheck

Session 72592; raw exit 0.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
```

```text
> hr-automation-rebuild@0.1.0 typecheck
> tsc --noEmit
```

### 22. lint

Session 2115; raw exit 1.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

```text
> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0


/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/tests/unit/dry-run-scenario-composition.test.ts
  450:113  error  Unsafe member access .state on an `any` value                                                                                                                                                                                                                                                                                               @typescript-eslint/no-unsafe-member-access
  512:24   error  A method that is not declared with `this: void` may cause unintentional scoping of `this` when separated from its object.
Consider using an arrow function or explicitly `.bind()`ing the method to avoid calling the method with an unintended `this` value.
If a function does not access `this`, it can be annotated with `this: void`  @typescript-eslint/unbound-method

✖ 2 problems (2 errors, 0 warnings)
```

### 23. final-focused-after-lint

Session 28124; raw exit 0.

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

···············

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  09:03:44
   Duration  3.61s (transform 1.11s, setup 0ms, import 1.81s, tests 1.72s, environment 0ms)
```

### 24. typecheck-after-lint-fix

Session 15288; raw exit 0.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
```

```text
> hr-automation-rebuild@0.1.0 typecheck
> tsc --noEmit
```

### 25. lint-after-fix

Session 95655; raw exit 0.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

```text
> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0
```
