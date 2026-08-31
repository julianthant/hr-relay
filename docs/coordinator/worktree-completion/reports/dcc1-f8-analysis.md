# DCC1 F8 — read-only single-audit-observation proposal

2026-08-30. **PROPOSAL ONLY — no repair authorization, source change or green claim.**
Same reused native `sup_sol_DCC1_F8_readonly_guard_diagnosis`, agent
`01a052fa-e2fc-7a32-81d0-23814d305b56`, Sol/high, profile 240k/220k. Parent persists
the read-only return after independently reading the failing guard, both calls, F2 evidence,
owning contracts and file settlement order. No new unit/task/worktree was created.

## Observed red and exact frozen identity

Full execution receipts and disk-first raw artifacts: [full gates](dcc1-full-gates.md).

| Run | Session | Gate/logger exits | Observed outcome |
| --- | --- | --- | --- |
| Full coverage | 87688 | 1/0 | 334 passed/1 failed files; 3786 passed/1 failed tests; 310.16s |
| Minimized exact guard | 50617 | 1/0 | Same failure; 1 failed/8 skipped; 929ms |
| Fresh individually locked lint | 55868 | 0/0 | No diagnostics |

The exact minimized command, run with explicit assigned workdir, was:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/control-command-single-path.test.ts -t 'keeps the command journal, audit, and start-plan consumption on exactly one executing path'
```

Failure: `src/server/settings-runtime.ts may only authenticate settings through one
commandAudits.findByCommand read`, assertion at `control-command-single-path.test.ts:278`.
Parent independently read both raw red summaries and lint output and rehashed them: coverage
`6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8`, focused
`c8b908fdff86477f85ad1ead04f61670c06ff124802e7f4cc1f4cc692f0b32f5`, lint
`cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385`.

HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`, ordered MERGE_HEAD
`13175b13340fec7b5326207fe54f98078d481d7d`, frozen index
`0b5ae741d88e83b816705dd3ecf504dd5ebeaf59`, execution closure
`36ec6220ce59f8fc9c63eae3057df32771bbd28b0ea055de243f83efaeb5a29e` remain unchanged.
No tracked working delta existed before this parent evidence/report update. All lanes released;
no parity, coverage-floor/suite-size pass, repair, mutation run or commit is claimed.

## Cause, hypotheses and ownership

The guard is text-based, not AST-based: lines267–268 count
`/\bcommandAudits\.[A-Za-z]+/gu` and require exactly one `findByCommand` match.
The source has two actual calls: authentication at settings-runtime.ts:62 and prepared-recovery
presence observation at105. This is a genuine lexical-count violation.

| Ranked hypothesis | Falsifiable test and disposition |
| --- | --- |
| Recovery introduced a second real read site | One executable match would falsify it; two are present. Confirmed. |
| Recovery introduced another authority executor/mutator | A journal/audit insertion or plan consumption would establish it. Both calls reach SELECT-only audit lookup; no second mutation path found here. |
| Comment/alias false positive | Non-executable matches would support it; both are genuine property calls. Ruled out for this red. |

Intake introduced the one-read Settings exception. F2 `1a4eba98..4989b602` added audit-only
presence detection and explicitly deferred duplicate-read optimization; [F2](dcc1-f2.md)
records its actual missing-exception red. F5 `0575003c..b3807f9a` unified editor readback
without changing recovery. The guard was not reconciled with the added observation.

`ref guards-and-tests` §3.9 forbids another command mutation/execution path.
`ref clock-config-secrets` §3, lines397–408, requires exact command/audit/current commitment,
proved absence before compensation and otherwise fail-loud retention. These obligations do
not require conflicting product policies. In settings-file.ts:1432, the prepared resolver runs
under the file exclusion before settlement modifies bytes or removes prepare evidence.

The second read cannot simply be deleted. F2 proves that audit-only evidence with no command
must refuse and retain exact prepared/live/initialization bytes. All six mixed-presence vectors,
exact committed next, proved-absent rollback and journaled-prior authentication remain required.

## Recommended bounded mechanism — not implemented

Inside `src/server/settings-runtime.ts`, introduce one private read-and-authenticate classifier,
retaining the public signatures and the sole explicit audit repository access:

1. Baseline revision authenticates only when canonical current is absent.
2. For a nonbaseline record, observe the exact bound command, audit and current; keep full
   command fingerprint, audit result/version changes and current identity validation together.
3. An explicit `absent-for-this-command` arm is possible only when command and audit are absent
   and current does not name that command. Any partial/divergent evidence throws before settlement.
4. `requireJournaledSettings` requires authentication; an absent nonbaseline record retains the
   named missing-journal refusal. Prepared recovery accepts authenticated next, or authenticates
   exact prior before returning rollback on proved next-command absence.
5. Keep final post-reconciliation verification, synchronous existing transactions/lock order,
   F5 single file acquisition and no cached observation across calls. No new public adapter,
   activation, identity substitution, guard-count change or hidden repository token.

An evidence collector separated from validation would make mismatched record/observation pairing
easier; a verifier object introduces unnecessary lifecycle/cache concerns. Prefer the private
classifier, subject to proof and independent review.

**Review caveat:** eager audit observation can change the error that wins when multiple rows
are malformed. Preserve existing named refusal precedence where observable; explicitly pin the
simultaneous-malformation case rather than asserting behavior equivalence without proof. This
proposal does not authorize new diagnostic policy or broad error-interface changes.

## Proposed proof/review plan — no implementation or mutation executed

Scope source to settings-runtime.ts, directly affected existing test families and nearest
AGENTS lesson. Keep guard bytes/count/allowlist unchanged. After explicit seam/repair approval:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/control-command-single-path.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/server/settings-runtime-reader.test.ts tests/unit/dry-run-scenario-composition.test.ts
```

Retain the actual red above. Prove full F2/F2b presence matrix and evidence bytes, exact
authenticated next/prior behavior, F5 exclusion/single acquisition, and F7 public start admission.
Required guard-specific mutation sensitivities: ignore audit-only presence; skip authentication
before settlement; skip prior authentication; break audit/current identity; move observation
outside exclusion or duplicate file acquisition. Restore/hash exact source after each challenge.
Pin query bounds and diagnostic precedence at existing public seams; no fixture seeding to mask
production behavior. Parent must receive exact deltas and raw gates; Tests/Standards plus independent
Correctness/Silent failures/Security and bounded Performance review apply. Fresh serial locked
typecheck/lint, new frozen closure and explicit heavy reallocation precede coverage/parity/commit.

Migration v19–21/history and D75 final-join residue remain unchanged and coordinator-owned.
