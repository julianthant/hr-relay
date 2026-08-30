# sup_sol_dcc1_f7_synthetic_duo_seam

## STATUS / role / scope

BLOCKED: the required first red gate failed with a different error, so conditional
authorization to apply the approved Duo additions was **not satisfied**. No runtime,
test, AGENTS, worker, CLI, core, default, credential, or security-policy edits were made.
Only this report is staged by F7. ROLE: resumed native `sup_sol` M3/F6 execution,
not supervisor. MODEL: native Sol; REASONING: high. COMMITS: none. SCOUTS: none.

Assigned workdir for every command/edit:
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Branch `feature/r-dcc-dcc1-exclusive`;
HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Intake index tree verified exactly:
`488fecfabb40df072c4294800b07c3771ba1a20e`.

Read complete assigned AGENTS, supplied project profile, the full global `/debug`
skill and repository `.agents/skill-library/hr-debug/REFERENCE.md`.
No additional nearer AGENTS exists for these files. The debug gate-first rule was
followed: no source theory or edits preceded the mandated synthetic test. The explicit
different-failure stop condition prevents instrumentation, further probes or a guessed fix.

## Exact red gate and raw output

Command, executed once in the assigned workdir:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
```

Raw exit **1**; session **70316**. The observed reporter time is retained verbatim,
not normalized to coordinator message timestamps:

```text

> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts


 RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

··xx····

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > composes both worker drains and the real gate command through terminal receipt evidence
 FAIL  |unit| tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > derives transaction reach and EID-safe failure evidence from every durable worker sink
Error: runtime config has no dashboard-activated generation
 ❯ Object.requireActive src/infra/sqlite/authority-database.ts:3810:19
    3808|           );
    3809|           if (current === undefined) {
    3810|             throw new Error("runtime config has no dashboard-activated…
       |                   ^
    3811|           }
    3812|           if (current.settingsRevision !== request.settingsRevision
 ❯ src/server/worker/compose.ts:466:43
 ❯ src/infra/config/settings-file.ts:1519:16
 ❯ releaseAfter src/infra/config/settings-file.ts:498:14
 ❯ Object.withExactRecord src/infra/config/settings-file.ts:1509:14
 ❯ src/server/worker/compose.ts:464:25
 ❯ src/infra/sqlite/authority-database.ts:1823:53
 ❯ AuthorityDatabase.#withTransaction src/infra/sqlite/authority-database.ts:2422:22
 ❯ AuthorityDatabase.withAuthorityTransaction src/infra/sqlite/authority-database.ts:1823:17
 ❯ composeWorkerRuntime src/server/worker/compose.ts:463:30

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
   Start at  08:41:08
   Duration  2.79s (transform 1.46s, setup 0ms, import 2.39s, tests 280ms, environment 0ms)
```

Both named tests failed at
`runtimeConfig.requireActive` (`src/infra/sqlite/authority-database.ts:3810)),
called from `src/server/worker/compose.ts:466`.
The error is **runtime config has no dashboard-activated generation**, not the
approved missing-Duo-credential error. Although the count is the same 2 failed /
6 passed, the failure identity differs and must not be treated as the same red.

Read-only source inspection places this check before Duo factory construction at
worker compose line 510. This establishes execution order only; it is not a diagnosis
or authorization to change runtime-generation ownership, seed authority, or bypass admission.

## Complete-file comparison with approved source

Compared both entire current files against
`845ca5a115ee6eef3e10598e88ea0a7fdf361888`; no path slicing or hunk-only identity claim:

| File | Current full Git blob | Approved full Git blob |
| --- | --- | --- |
| `src/server/dry-run-scenario/runtime.ts` | `bece5d887c0cd92620ff716bc99f3d9710a6466d` | `b86da070630de4b40306ca8151a16f7c20c1345e` |
| `tests/unit/dry-run-scenario-composition.test.ts` | `c418b42c35a300ac6faa7b12e4889c3cfd8ed87e` | `a3a74657be060ab24255a6df441d71b605a0cc74` |

`git diff 845ca5a115ee6eef3e10598e88ea0a7fdf361888 -- src/server/dry-run-scenario/runtime.ts tests/unit/dry-run-scenario-composition.test.ts`
shows **only 4 runtime / 3 fixture lines absent**:

- Runtime: type-only Duo factory import, optional property and its comment,
  conditional forwarding into the existing worker composition.
- Fixture: fixture factory import plus the two explicit fixture injections.

No difference beyond those seven lines exists in these complete files. Neither file
equals its approved blob yet; the authorized patch was deliberately withheld on the
different red. No wholesale replacement/cherry-pick occurred.

## Default/CLI preservation and remaining seam

Read-only inspection: `src/cli.ts:21–31` still registers the real production dry-run
composer with `createProductionDryRunScenarioRuntime`; runtime's worker drain still
omits Duo injection. `src/server/worker/compose.ts:510` still uses the existing
`input.duoCeremony ?? composeDuoCeremonyGateFactory(...)` with configured identity,
leases, clock and scheduler. No default-flow policy was changed or live-tested.

Current unchanged blobs, also verified equal to the intake tree:

- `AGENTS.md`: `aaff4bc2c74d6380f1a491164c7acf659ae62877`.
- `src/server/worker/compose.ts`: `fe1c083c93bce1053219d496dd7376fded1500fa`.
- `src/cli.ts`: `7fe107620b2a3c91c6f1ab4936c5138d15ffe9e0`.
- Both complete runtime/test blobs above likewise equal the intake tree.

Remaining seam: parent/coordinator must disposition the synthetic test's earlier
dashboard-activated runtime-generation refusal before authorizing any fix or resuming
the conditional Duo change. This report makes no claim that adding Duo injection would
address the actual current failure. No new policy or broader source change is proposed.

## Other gates, preservation and return

Fresh separately locked lint was run to meet the repository's no-test-without-lint
rule, without overlapping any other owned light command:

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Raw exit **0**; session **57712**:

```text

> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0
```

No green rerun or typecheck was started after the mismatched red; no code changed.
No heavy coverage/parity/probe, browser, live HR, authority read, credential provisioning,
`.auth`/`.env` inspection, threshold/timeout/assertion changes, migrations, D75 change,
board write, push, reset, clean, new task/agent/worktree, or commit occurred.
No temporary instrumentation was introduced.

Parent untracked
`docs/coordinator/worktree-completion/evidence/dcc1-gate-freeze.md`
remains untracked and unchanged, blob
`3e94be76036a0bbba20ec0d9e879e43efbdff394`.
Parent continued unstaged edits to `dcc1-review-candidate.md` and `dcc1.md`;
F7 did not edit, stage, or restore them. All pre-existing staged history is retained.
No unresolved merge entries were present.

Only owned staged delta from the intake tree:
`docs/coordinator/worktree-completion/reports/dcc1-f7.md`.
The final report-inclusive `git write-tree` is returned outside this file to avoid
a self-referential hash. All F7-owned commands exited; sole light slot released to parent
at return. Heavy readiness/reservation remains held. Independent Tests/Security/
Correctness/default-flow review and a new frozen closure remain parent requirements;
this report is neither those reviews nor a heavy-gate-ready candidate.
