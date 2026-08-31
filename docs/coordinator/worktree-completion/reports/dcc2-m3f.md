# DCC2 M3F — synthetic Duo composition forwarding

## Candidate and scope

Approved seven-line repair complete and light-gated; source/index frozen for independent review.
No owned gate remains active; the light lane is returned. Prior `e4ab3837` readiness is historical;
renewed heavy readiness and M4 remain coordinator-controlled.

| Fact | Exact value |
|---|---|
| Role / model / reasoning | sup_sol / native Sol / high |
| Workspace | /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2 |
| Branch | feature/r-dcc-dcc2-exclusive |
| HEAD | ac40292b8e3e8ff9b66242bbf8f8288554335f40 |
| MERGE_HEAD | 13175b13340fec7b5326207fe54f98078d481d7d |
| M3F git write-tree | 56ba105f1841097927a444d6454686c954b4e9db |
| M3 input tree | e4ab3837feef579e8462b59e27eb9eb3015d0f65 |
| Delta from input | 3 paths, 11 additions / 0 deletions: runtime 4, tests 3, root AGENTS 4 |
| Unmerged / unstaged tracked paths | 0 / 0 |
| Commits / pushes / child agents / heavy gates | None / none / none / none |

Read the complete approved M3F brief, global debug skill, repository wrapper and relevant lessons.
Used apply_patch only and staged the three exact paths; no whole cherry-pick, reset, stash, merge
commit or edits outside the assigned worktree. Supervisor-owned artifacts remain untouched.

## Exact port and byte proof

Reference `845ca5a115ee6eef3e10598e88ea0a7fdf361888`, original
`964c9636e291510be58175246759b724d1c257c9`. No baseline difference was needed in either approved file.

| Path | Kept / changed / why | Final blob, identical to reference |
|---|---|---|
| src/server/dry-run-scenario/runtime.ts | Add type import, documented optional duoCeremony input, and conditional forwarding beside sessionFactory. Omission still omits the property. Four added lines. | b86da070630de4b40306ca8151a16f7c20c1345e |
| tests/unit/dry-run-scenario-composition.test.ts | Import existing fixtureDuoCeremonyGates and explicitly pass it in the two synthetic browser compositions. Three added lines; every assertion and timeout unchanged. | a3a74657be060ab24255a6df441d71b605a0cc74 |
| AGENTS.md | Four-line dated fixture rule: synthetic browser composition supplies its Duo gate; production CLI keeps credential-backed default. No broad doc copy. | Documentation-only note, not copied wholesale |

`git diff --cached 845ca5a... -- <runtime> <test> src/server/worker/compose.ts` returned empty.
The runtime and test blob pairs above match exactly. Worker composition also remains identical to
both the reference and M3 input. Full M3F patch is [candidate.patch](../evidence/dcc2-m3f/candidate.patch).

## Debug evidence and production-default preservation

The supervisor's RED on e4ab was exit 1, 2 failed / 6 passed, 3.07s. I independently ran the same
command before editing: exit 1, same 2 failures / 6 passed, 2.32s. Both failures were
`SecretFileError: duoWebauthnCredential is unavailable` through runtime drain to worker composition.
This was a deterministic synthetic-composition defect, not a live login, timing or credential
provisioning task. Debug checked missing forwarding, missing fixture injection and a worker-default
regression; the exact port plus identical worker blob isolates the first two and leaves the default intact.

Primary-source preservation:

- `src/cli.ts:30` still supplies createProductionDryRunScenarioRuntime unchanged.
- `src/server/dry-run-scenario/compose.ts:97` still invokes it with only isolation, repoRoot, env,
  clock and ids. No production sessionFactory or duoCeremony override was added.
- The runtime conditionally forwards duoCeremony only when explicitly supplied. No substitute is
  created when omitted.
- `src/server/worker/compose.ts:504` remains the existing credential-backed default:
  supplied input or composeDuoCeremonyGateFactory; unresolved credential identity still refuses boot.
- The test fixture is existing credential-free equipment with a synthetic key and real lease-store
  gate semantics. It is not imported into production, and the worker lease protocol is unchanged.
- Core Duo, auth, wire, migration, credential and CLI code are unchanged relative to e4ab. No live
  execution or credential provisioning occurred; no assertion, timer or fail-loud guard was weakened.
- No temporary debug instrumentation was added. All eight existing focused tests remain intact.

## Gate commands and actual exits

All commands used the exact workspace above; one owned light process at a time. Logs are under
`docs/coordinator/worktree-completion/evidence/dcc2-m3f/`.

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/dry-run-scenario-composition.test.ts --reporter=dot
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Each invocation redirects stdout/stderr to its named log below. No exit is inferred from empty logs.

| Log / session | Actual outcome |
|---|---|
| ../dcc2-m3/supervisor-dry-run-composition-preflight.log | Supervisor exit 1; 2 failed / 6 passed, 3.07s, e4ab |
| focused-red.log / 69724 | Exit 1; 2 failed / 6 passed, 2.32s, 2026-08-30 08:01:52 PDT, before port |
| focused-green.log / 82510 | Exit 0; 8/8 passed, 2.96s, 08:02:51 PDT, tree 56ba105f |
| typecheck-locked.log / 43140 | Exit 0, tree 56ba105f; completion collected 15:03:59Z |
| lint-locked.log / 44952 | Exit 0, tree 56ba105f; started approximately 15:04:07Z after typecheck exit 0; completion collected 15:04:50Z |
| git diff --cached --check / git diff --check | Exit 0 each after staging and again at 15:04:28Z |
| Reference blob equality and zero unstaged/unmerged checks | Exit 0; exact match/empty diffs |

**Active owned sessions/commands: NONE. Light lane returned.** Both full checks passed their first
M3F locked attempt; no exit 75 or retry occurred in M3F. Earlier M3 queued/canceled checks remain
historical and are not counted as this proof. No heavy lock probe/start or product/merge commit.

## Remaining review / gate ownership

Main is running new independent Tests, Security, Correctness and Silent-failures/production-default
review on exact tree 56ba105f. Earlier M3 reviews/light proof remain historical; this delta must be
reviewed before renewed heavy readiness. No executor light gate remains pending. Main owns review
outcomes, full heavy gates and merge commit; none is claimed complete by this execution report.

Final staged tree: **56ba105f1841097927a444d6454686c954b4e9db**; HEAD remains
**ac40292b8e3e8ff9b66242bbf8f8288554335f40**, MERGE_HEAD remains
**13175b13340fec7b5326207fe54f98078d481d7d**. Source/index frozen, zero unmerged/unstaged tracked
paths, pending merge preserved, no owned process active.
