# DCC1 candidate review and verification ledger

Candidate source tree `2e44fa8f248eff8d7946a6251730485cb27621ac`, frozen report tree `c941ed6c42007a154b0a79d788362a2f0ca6ca68`. Supervisor verified only report/handoff differ. Review base: frozen integrated `13175b13340fec7b5326207fe54f98078d481d7d`. All axes used independent native readers and immutable Git objects; no tests by reviewers. This ledger remains open until fixes and delta re-review.

## standards

Role `sup_luna`, agent `01a0530f-ddbf-73f2-8861-da715de78c93`. Count: 1 · Worst: medium. operator-command-ingress.ts:14 z.object({}).loose() is an open initial wire schema; replace with strict command-derived parsing before trusted stamping.

## spec

Role `sup_terra`, agent `01a0530f-de3a-74c1-8992-c76949d17c84`. Count: 1 · Worst: medium. docs/rebuild/02-prove-writes-build-the-tails.md:259 (also 449,521; 03c:981-982) regresses bounded editor/preflight to open despite integrated DCC3 completion. Correct bounded active vs broader legacy deferred.

## correctness

Role `sup_terra`, agent `01a0530f-debb-74a3-9527-d3492b427661`. Count: 0 · Worst: none. Reviewed Settings authority/kernel/replay/current/runtime/composition/ingress/routes/migrations and owning docs at immutable 13175b13..2e44fa8f; no tests. c941ed6 source identical.

## silent_failures

Role `sup_terra`, agent `01a0530f-df44-7e82-ac3d-af099f13e7e7`. Count: 1 · Worst: medium. src/server/settings-runtime.ts:104: audit-only partial Settings transaction chooses rollback based only on command/current; orphan audit masks inconsistent authority. Refuse and test all partial presence combinations.

## performance

Role `sup_terra`, agent `01a05312-8152-7d40-aed9-50343d6c5d91`. Corrected Count: 1 · Worst: medium. settings-editor query read() then runtimeStatus() repeat the full locked SQLite/file snapshot; use one verified snapshot returning record+status. Reviewer retracted apply-time writer-lock cost (required atomicity, baseline also held transaction) and rejecting-predecessor wedge (tails promises never reject).

## docs

Role `sup_luna`, agent `01a05312-81cc-7ca1-a28a-8cbe1eea9504`. Count: 6 · Worst: medium. Stale migration version and bounded Settings editor/preflight completion statements in phase01/02/03c/03d/04 and operator-trust. Parent corrected each against preserved DCC1–DCC3 contracts; broader deferred capabilities remain deferred. Roadmap regeneration and final delta check pending.

## Original-target reviews

See dcc1-review-security-original.md and dcc1-review-tests-original.md. Security one medium, Tests three medium/one low. Original target was common ancestor 80da3815 through intake 0c115123; these findings are not final candidate acceptance.

## Parent verification

- M3 initial typecheck exit143 and lint PID45279 (session35843) canceled by coordinator resource intervention: NOT passed. Parent could not collect worker-owned session (unknown process id); exact PID was absent on read-only check. M3 handoff retained until final verification.
- Locked candidate typecheck: `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`, exit0.
- Locked lint initially exit1: unused CommandIdSchema import at command-kernel.ts:73. Parent removed this trivial merge residue; locked rerun exit0.
- Focused candidate command: `env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/config.test.ts tests/unit/command-kernel.test.ts tests/unit/settings-file-service.test.ts tests/unit/worker-composition.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/run-authority.test.ts`. Exit1: 8 files, 219 tests; 216 pass, 3 fail. BFF provenance literal hash stale at line689 (expected a339d4..., actual f68515...); editor request missing required Origin gives403 at957; compose readback query uses nonexistent singleton_id at51.
- Parent applied Spec finding's bounded editor/preflight status corrections in phase02 and03c; unchanged broader deferrals retained. Regenerate roadmap after all doc fixes.

## Fix queue

1. F1 strict ingress plus BFF integration/body-read proof — implementation complete native sup_sol; 48 focused tests, locked tsc/lint pass. Parent independently reran all 34 BFF tests (exit0). Standards and Security delta reviews pass at immutable `1a4eba98436b7321b9055a7da8a6cfb226ab6a50`; see dcc1-f1.md.
2. F2 prepared partial-state refusal and composed-test migration — complete native sup_sol `01a0531c-a02a-7871-9ad9-364597df663c`; 236/236 in the eight-file focused command, locked tsc/lint exit0. Parent independently reran compose-real-port: 24/24 exit0 at 07:47:13. Immutable staged tree `e1f092841a8f79c1c9d3329e79407e253e062f95`; source/tests/report verified. Correctness and Silent failures delta reviews pending. One verified readback snapshot is a separate subsequent unit.
3. F3 directory integrity plus exact-size value proof — complete sup_sol `01a05323-c3f1-70f0-a424-e0c4677c9c4a`; 53/53 focused, 12 detected/restored mutants, locked tsc/lint exit0. Parent independently reran the same two suites: 53/53 exit0 at 07:57:19. Immutable tree `ebb67fb466f85717654f1abc969ffba813539fd5`; Security and Correctness reviews pending. See dcc1-f3.md for precise POSIX threat assumptions and exact blobs.
4. Remaining semantic worker first-claim/stopped-record proof, final UI/parity and delta reviews — pending.

No coverage/parity without coordinator allocation. Every full tsc/lint uses the shared light-gate lock; every Vitest uses VITEST_MAX_WORKERS=1. One owned light command at a time. Migration collision decision remains OPEN/UNAPPROVED; no history rewrite or live authority work.

## F1 independent delta reviews

Target `2e44fa8f248eff8d7946a6251730485cb27621ac..1a4eba98436b7321b9055a7da8a6cfb226ab6a50`, four assigned ingress/test/AGENTS/report paths. Parent verified cited immutable ingress lines. No reviewer gates or writes.

- **Standards** — native sup_luna `01a0531c-df0d-7372-8c4e-1de6431c3dac`: Count 0 · Worst none. Canonical strict parsing precedes identity access (ingress:48,63,49,84); accepted bulk callbacks are typed (:121,159). No newly open schema/unchecked admission; production persistence parses the preexisting unknown insert boundary.
- **Security** — native sup_sol `01a0531d-2c58-7973-a0ba-6cf9d6607632`: Count 0 · Worst none. Routes:173 guard before body reads:443,469; strict parsing ingress:48,153,161; provenance/replay:20,52,87; ordered bulk binding:90,110,164. No concrete exploit path in this delta. D75 and directory integrity remain separately scoped.
- Dispatch correction: an initial sup_terra Security reader `01a0531c-dff7-7070-b1cb-5f8ae75a6d8b` was stopped without a result when the adapter's required sup_sol role was rechecked. Only the independent sup_sol result above counts as Security acceptance.

F1 Tests axis will be covered by the final focused test-quality review; no acceptance is inferred from test counts alone.

## F2 independent delta reviews

Target `1a4eba98436b7321b9055a7da8a6cfb226ab6a50..e1f092841a8f79c1c9d3329e79407e253e062f95`, Settings runtime, composition tests, AGENTS and F2 report. No reviewer gates or writes.

- **Correctness** — sup_terra `01a05323-f908-7101-a99b-17c15728d86b`: Count 0 · Worst none. Exact prepared command/audit/current evidence must pass full next validation before the file resolver returns; all absent validates prior. Parent checked resolver-before-settlement ordering against the immutable target.
- **Silent failures** — sup_terra `01a05323-f986-78b1-b727-6fe75124f0d1`: Count 1 · Worst medium. compose-real-port.test.ts:359 covers all-next-evidence-absent rollback only from revision1; it does not detect removal of the prior-identity check at settings-runtime.ts:113 for an applied prior. Add valid revision2→prepared3 rollback and corrupt/missing revision2 identity refusal with exact evidence retained. This is a missing regression sensitivity proof, not an observed production failure; the production prior check currently exists. F2 follow-up queued after the active filesystem unit.

F2b follow-up completed on the original resumed sup_sol F2 worker; see dcc1-f2b.md. Four new cases pass; removal of prior pre-settlement validation gives 3 failures from changed evidence bytes (valid rollback case still passes). Production exact blob restored, 28/28 composition tests and locked lint pass. Parent independently reran 28/28 at 08:01:25. Tree `1295cd01e6abc5a9e802f10d63980e7264cd6233`; focused Silent re-review pending.

F2b **Silent failures re-review** — original independent sup_terra `01a05323-f986-78b1-b727-6fe75124f0d1`, exact `ebb67fb4..1295cd01`: Count 0 · Worst none; prior finding resolved. Reviewed journaled prior setup (:242), next absence (:278), actual corruption (:283), two-attempt byte/row preservation (:307), and matching mutation evidence. Production blob unchanged in both trees. No reviewer tests or writes.

## Canonical documentation delta review

**Docs** — sup_luna `01a05324-a737-7932-861f-697731cfedb5`, target `e1f092841a8f79c1c9d3329e79407e253e062f95..27d6208fa0ab06b71c78fbd659d8435f2fecb3cd`: Count 0 · Worst none. Six canonical docs (01/02/03c/03d/04/operator-trust) checked against current immutable code/owning references. Bounded Settings/editor/preflight active claims and broader deferrals agree; v21 scoped branch-local with collision disposition. No tests or writes. This closes the earlier Docs/Spec stale-status findings; generated roadmap remains a final gate, not a waived requirement.

## F3 independent delta reviews

Target `27d6208fa0ab06b71c78fbd659d8435f2fecb3cd..ebb67fb466f85717654f1abc969ffba813539fd5`, Settings filesystem/config tests/AGENTS/F3 report.

- **Correctness** — sup_terra `01a0532d-1e0d-7bd0-9843-d064ce6eb280`: Count 0 · Worst none. Directory ownership/modes/bound identity admissions and settlement checked within declared POSIX assumptions.
- **Security** — sup_sol `01a0532d-1d4e-74d1-8a36-c114cdaaba00`: Count 1 · Worst medium. settings-file.ts:461 uses lexical `resolve()` on a trusted system symlink's raw target; `..` can cross an intermediate symlink, making verified and filesystem-traversed destinations differ. Conditional example: root-owned alias→pivot/../safe, pivot→foreign-controlled/sub; lexical safe differs from physical foreign-controlled/safe. No claim this topology exists on the host. Parent verified the normalization site. Minimal fix: refuse `..` in raw symlink targets before normalization and pin the topology; ordinary /tmp and /var aliases are unaffected. F3b queued after F2b; no Security acceptance yet.

F3b completed on the resumed F3 sup_sol worker; see dcc1-f3b.md. Raw whole `..` components refuse before lexical resolution. Real filesystem topology (root-ownership observation alone simulated) reproduces unsafe initialization sidecar publication with the guard absent; restored guard passes. Full focused 54/54 and locked tsc/lint exit0; parent independently reran 54/54. Exact tree `429a3483eca61b211026478d2d610b7b00884ecf`. Original Security reviewer is checking the bounded delta; no broader filesystem resolver or policy was added.

F3b **Security re-review** — original independent sup_sol `01a0532d-1d4e-74d1-8a36-c114cdaaba00`, exact `1295cd01..429a3483`: Count 0 · Worst none, original finding resolved. Verified pre-normalization guard (:463 before :466), physical-topology test (:291/:342), actual sidecar-effect mutant and exact restored blobs. Parent reconciled owning clock-config-secrets directory paragraph with the verified safeguards and explicit POSIX/ACL/UID limits. No reviewer gates/writes.

## Candidate Tests axis

Native sup_luna `01a0532c-ae89-7c53-bb8a-97a12b2624c1`, immutable frozen baseline `13175b13..e1f09284`, scoped changed Settings tests and direct fixtures; no test runs or writes. Count 7 · Worst medium, kept independently from earlier Tests severity.

| Location at reviewed tree | Finding | Verified disposition |
|---|---|---|
| config.test.ts:407 | Exact byte-limit checks only size | F3 subsequently added strict full value/public readback and detected same-size corruption mutant. |
| worker-composition.test.ts:423 | Unjournaled boot refusal lacks stopped process record proof | F4 proof transfer pending. |
| worker-composition.test.ts:516 | Stale queued refusal lacks zero UCPath/CRM opens | F4 pending. |
| worker-composition.test.ts:536 | Transaction-count injection rather than semantic claim boundary | F4 pending. |
| worker-composition.test.ts:560 | Claim-crossing refusal lacks zero browser effects | F4 pending. |
| dashboard/client-transport.test.ts:224 | Declared success/refusal statuses covered, but no bulk409/non-command409/422 mismatch proof | Parent verified existing403/415 negative cases; add the missing route/status-specific cases rather than claiming no negative HTTP coverage. F1b pending. |
| server/bff-flow.test.ts:319 | Settings zero-effect snapshot omits initialization sidecar/lock | Parent confirmed snapshot has settings/prepare/current/journal/audit/generations only. F1b will include initialization/lock evidence and prove early read detection. |

F1b is active on the resumed original sup_sol F1 worker after parent F3b verification; owns sole light slot. Scope is two existing HTTP command-boundary test files and unique dcc1-f1b.md, with temporary restored mutations only. No new product behavior is expected.

F1b returned **partial**, not accepted: test-only proofs staged at `a3e37553676c7d175566835bf7d5661379e62c2f`, 50/51 full two-file tests. Expanded initialization snapshot exposed real schema-mismatch side effect: settings-file.ts:1530 readState initializes before pure schema check. Targeted seven boundary cases and locked lint pass; source mutations restored exactly. Parent verified ordering and is reproducing full red. F1c is separately authorized minimal pure request-refusal repair before state access, plus regressions/AGENTS/report; preserve the new assertion, never preinitialize the fixture to hide it.

F1c completed at `0575003c76a3f60a817abcc4e24532a525dab506`: the two pure checks now precede lock acquisition/readState; response codes/messages and valid-request path remain unchanged. Two new pristine-authority regressions were red on the original source and green after the move. Four-file acceptance107/107 and locked tsc/lint pass; parent independently reran the same107/107 at08:14:51 (10.54s, exit0). Correctness/Silent failures delta reviews dispatched independently. F1b's historical partial report remains intact; its production blocker is fixed by this separately recorded increment.

F5 one-snapshot readback is now assigned to resumed F2 sup_sol, with sole DCC1 light-gate admission. No heavy gate allocated or started.

## F1c independent delta reviews

Target `a3e37553..0575003c`, Settings apply/config regressions/AGENTS and the full workspace-relative F1c report. Parent verified the checks at settings-file.ts:1524–1537 before lock acquisition:1538. No reviewer tests or writes.

- **Correctness** — sup_terra `01a0533c-f86f-7832-a65c-e9329ce84bee`: Count0 · Worst none. Strict input, exact typed refusal and unchanged valid-request path preserved.
- **Silent failures** — sup_terra `01a0533c-f906-7ae0-9fdc-82f8e0026541`: Count0 · Worst none. No fallback; pure mismatches cannot initialize or lock authority. The initial report-path absence note was corrected after inspection of `docs/coordinator/worktree-completion/reports/dcc1-f1c.md` in the exact immutable tree.

Standards/Security acceptance of the ingress remains at F1; final Tests axis covers F1b/F1c proof deltas. This tiny control-flow move changes no contract, permission, persistence encoding or migration, so those unchanged seams do not require another full original-axis tour.

## F5 one-snapshot verification

Native resumed F2 sup_sol returned `69ce22faaff7b911844a05849c2c20320d5115f7`. Eight exact owned paths verified; runtime record/status now come from one transaction and one journaled file read. Five real SQLite/filesystem tests; initial two-lock red, three detected/restored mutations, final97/97 and locked tsc/lint pass. Parent independently reran97/97 at08:22:27 (12.24s, exit0). No rendered pass claimed. Correctness/Silent/Performance independent readers are reviewing immutable `0575003c..69ce22fa`; Standards/Docs/Tests final deltas remain required.

F4 worker proof transfer now owns sole light slot; no full coverage/parity allocated or started.

## F5 independent delta reviews

Immutable `0575003c..69ce22fa`, eight assigned paths, no reviewer tests/writes. Parent checked the cited exact source and matching file-authority blob.

- **Silent failures** — sup_terra `01a05323-f986-78b1-b727-6fe75124f0d1`: Count0 · Worst none. Active check precedes file read; full prior/next journal verification stays intact; no stale cache/default or second authority. Tests at reader:131/158/178/193 exercise freshness, stale activation, unjournaled refusal and writer exclusion.
- **Performance** — original sup_terra `01a05312-8152-7d40-aed9-50343d6c5d91`: Count0 · Worst none; original repeated-snapshot finding closed. Query:136 consumes one snapshot; runtime:145–160 reads journaled Settings once inside the existing transaction. Structural improvement only, no elapsed-time speedup claimed.
- **Correctness** — sup_terra `01a05323-f908-7101-a99b-17c15728d86b`: Count0 · Worst none. Runtime:145 derives both outputs inside one existing transaction from the returned record, with active-process validation before the file read. Composition and fixture adapters supply the same pair; full command/audit/current and prior-recovery checks are unchanged.

## Final production Standards delta

**Standards** — sup_luna `01a0530f-ddbf-73f2-8861-da715de78c93`, immutable `1a4eba98..ab67803d`: Count0 · Worst none. Settings file/runtime/editor query, trivial kernel import cleanup, direct tests/adapters and applicable AGENTS reviewed after F1's separately accepted ingress. No open boundary, duplicate authority or interface-ownership violation found. Static only; other axes retain their own judgments.

## Final canonical Docs delta

**Docs** — sup_luna `01a05324-a737-7932-861f-697731cfedb5`, immutable `27d6208f..ab67803d`: Count0 · Worst none. New AGENTS lessons and clock-config-secrets directory paragraph match the pinned source, including bounded POSIX/UID/ACL limitations, pure request refusal ordering and one snapshot. External exact root project profile was read and confirmed nonconflicting after clarifying it is not a file inside the pinned DCC1 tree. Prior six canonical status corrections remain accepted. Generated roadmap check is still pending.

## F4 worker proof receipt

Native sup_terra `01a05344-2e15-7ca1-badd-fc39a80ae8f3` returned tree `1f63a5878101e0f80a6381e8c02a60a8fe76d62d`. Only worker-composition tests and F4 report changed. Parent independently reran33/33 at08:28:51, exit0 (4.45s); worker locked tsc/lint pass. Exact source restoration verified against pre-F4/index/working files; parent corrected two mismatched blob strings in the initial report rather than trusting the receipt.

The stopped-record observer now shares the exact acquisition identity; removing only one release survived because outer cleanup still releases, while removing both makes all nine stopped-record checks red as active. Browser guards each detect real UCPath opens under bypass. Claim crossing now uses the existing semantic hook; its nested savepoint is explicitly not an independent durable commit. Original reviewer is checking the changed proof seams at immutable `e1f09284..1f63a587`.

F6 kernel proof is active on resumed original M3 sup_sol, sole light slot. No new worker/task or source expansion; heavy gates remain unallocated.

## Final non-kernel Tests delta

**Tests** — original sup_luna `01a0532c-ae89-7c53-bb8a-97a12b2624c1`, immutable `e1f09284..1f63a587`: Count0 · Worst none. All seven prior findings closed. Verified full independent exact-size value/public readback (config:718); matching-identity stopped record (worker:439); zero browser opens before refusal checks (worker:541/592); semantic claim hook (:571); valid-body HTTP negative statuses (client-transport:271); initialization/lock snapshots (BFF:322). Recovery tests detect pre-settlement refusal versus later changed-byte failure; reader tests cover real locks and SQLite exclusion. Corrected F4 hashes and its explicit nested-savepoint limit were checked. No reviewer tests/writes. F6 is a separate final kernel delta, not inferred accepted here.

## F6 kernel proof receipt

Resumed M3 sup_sol `01a052fa-e2fc-7a32-81d0-23814d305b56` returned `07e08e5c6db19352c4c2e7c85546272fbda8e06b`; only command-kernel test/report changed. Parent verified unchanged production blob `0c1f88bac2391f417e91570920d05360f36d531f` and independently reran41/41 at08:35:23, exit0 (2.52s). Worker locked tsc/lint pass; successful reconciliation and failed-inspection guard mutations both detected/restored. Failed inspection retains exact committed/evidence state and primary-first errors until exact replay cleans once. Final Tests delta review pending; no new product bug or source change.

**F6 Tests** — sup_luna `01a0532c-ae89-7c53-bb8a-97a12b2624c1`, immutable `1f63a587..07e08e5c`: Count0 · Worst none. Real transaction precedes the reported failure (:1645); explicit primary-first uncertainty (:1660), retention/no premature settlement (:1674), exact revision2 conjunction (:1682) and cleanup-once replay (:1707) checked. Both mutants fail for relevant reasons. The failed-inspection mutant first fails on error type, not a separately demonstrated sensitivity for each retention assertion; no broader mutation claim is made. No reviewer gates/writes.

## Gate readiness

All selected code/test/doc review findings are resolved at their pinned deltas. Generated-only roadmap output is verified by the owning generator/freshness gate; no independent taste review. No simplification requested or justified; skipped. Remaining required proof is the frozen-candidate full coverage/parity and rendered inspection, not implementation/review dispatch. Coordinator confirmed pre-commit full gates on the frozen pending-merge candidate plus exact committed-content equivalence; a commit hash alone does not require duplicate coverage. Meaningful input changes invalidate affected proof.

## F7 readiness hold — synthetic composition seam

Before any heavy gate, coordinator independently compared complete dry-run runtime and composition-test files at `488fecfa` to approved `845ca5a115ee6eef3e10598e88ea0a7fdf361888`: exactly four runtime and three fixture additions are missing. Parent verified that exact two-file diff. Heavy readiness/reservation is held; prior gates remain historical.

Existing M3/F6 sup_sol is reused for F7, sole light slot: focused dry-run-scenario-composition red first; only if the missing-Duo failure matches, port the exact seven additions plus nearest AGENTS lesson. No whole-commit cherry-pick, core/CLI/default change, credentials or live workflow. Fresh focused/locked checks and independent Tests/Security/Correctness/default-flow verification must precede a replacement frozen input identity.

F7 returned **different red**, so the conditional patch was withheld. Worker session70316 exit1 (2failed/6passed,08:41:08,2.79s), independently reproduced by parent session18048 exit1 (2failed/6passed,08:43:37,2.56s), both at `runtimeConfig.requireActive`: `runtime config has no dashboard-activated generation`. Worker fresh locked lint57712 exit0. Full raw worker output and unchanged source blobs are in [F7](dcc1-f7.md). No source/test/AGENTS change, no new typecheck or heavy gate, no active unit/session at return.

Read-only contract context sent to coordinator: scenario runtime.start resolves env+empty Settings and inserts a separate snapshot; worker requires the dashboard's activated generation before Duo construction. The owning clock-config-secrets contract assigns activation to dashboard boot. Fixture seeding, worker bypass and runtime auto-activation have **not** been authorized or performed. Pending disposition concerns that earlier composition join, not an assertion that the seven Duo additions fix it. Evidence-only index68c6147bc0dc88786e7a3659901968db43551df1 retains executable closure8670eaea27bfc6eb00848eaa1ea1dbaeda11279169c8b6e2986614cca30ac7b9.

Coordinator authorized one read-only follow-up, not implementation. Resumed original M2 sup_analyst `01a052f4-49fb-7a33-9486-20da624baf3a` returned [F7a](dcc1-f7a-analysis.md); parent verified selected locking, transaction and snapshot interfaces plus owning contract passages. Existing authority supports the bounded join, with no explicit never-activated standalone guarantee found in the inspected owners. Public-runtime negatives and nondefault positive sensitivity are proposed, not run. Agent closed; no product/test/contract change or gate. Implementation remains pending coordinator disposition, and conditional Duo7 remains withheld.

## F7b authorized implementation and review plan

Coordinator subsequently approved the F7a join in runtime.ts, public composition tests and nearest AGENTS lesson, with only directly inaccurate owner text correction if needed. Public `runtime.start` is the explicitly confirmed `/tdd` seam, using real selected Settings/journal/runtime APIs and temporary fixtures. Missing/stale/divergent/snapshot refusal, nondefault exact retained identity/env precedence/no extra snapshot, no start effects and supported rollback/identity evidence are required. Only an observed separate missing-Duo red authorizes the exact seven-line approved delta; no whole-file replacement over the join. Product commits await allocated full gates. All excluded interfaces/policies remain frozen.

Reused native M3/F6/F7 `sup_sol` is sole DCC1 light-gate owner during implementation. Parent will verify fixed-tree evidence and focused gates, then use eight separate existing independent reviewers: Standards/Luna, Spec/Terra, Correctness/Terra, Silent failures/Terra (including default flow), Performance/Terra (DB/lock/resource lifetime), Tests/Luna, Docs/Luna, Security/Sol (not the writer). Reviews receive the same immutable delta and separate axes, not peers' conclusions. Simplify is not requested; reassess only if proven unnecessary complexity warrants it. No heavy allocation; queue remains coordinator-owned.

### F7b parent receive

Writer returned complete index `c9fb464e21479be70e24bf2897c9430b66bde71a`; parent confirmed HEAD/MERGE_HEAD unchanged, no unresolved entries, and only runtime/test/AGENTS plus [F7b report](dcc1-f7b.md) changed from `160eeda8093a551dc2ff37d36335cf34dc19c206`. Parent source inspection confirmed the synchronous final SQLite/exact-file fence, selected authority admission before start effects, retained ID, removed snapshot mint, and publication only after commit plus handle closure. Worker/core/CLI/dashboard/blocked-target composition/SQLite are unchanged. The two retained full-blob diffs prove the conditional Duo port was exactly four runtime and three fixture lines, not a replacement of the admission join.

Parent independently ran the focused suite, session59203 exit0:

```text
Test Files  1 passed (1)
     Tests  15 passed (15)
  Start at  09:07:56
  Duration  3.77s (transform 1.16s, setup 0ms, import 1.91s, tests 1.78s, environment 0ms)
```

Command: `env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts`. Fresh parent locked typecheck58014 exited0. Parent locked lint and eight independent fixed-delta axes remain pending at this receipt. Writer raw generation/nondefault/rollback/Duo reds, fixture errors, restored mutations and final locked lights remain separate in F7/F7b; no error is relabeled as another.

Full executable closure (same explicit report/evidence/handoff exclusion only) is `6e48c11225f5614eb83a7764c40e8a01ac755d33a4522d634173d695e7dee886`. This is a review-candidate identity, **not heavy readiness**. No full gate or commit has run.

Parent final lint47509 exited0. The exact separate parent commands, both from assigned DCC1 workdir, and returned output were:

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
```

Session58014, exit0:

```text
> hr-automation-rebuild@0.1.0 typecheck
> tsc --noEmit
```

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Session47509, exit0:

```text
> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0
```

Parent59203 focused output above followed these exact startup lines, and its final process exit was0:

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts

RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1
···············
```

These are legible transcriptions of returned tool output, with presentation whitespace normalized—not byte-identical log files. F7b's larger ledger likewise explicitly removes trailing formatter whitespace; raw exit values remain unchanged and distinct from output-byte identity.

Reproduce the complete tracked execution-closure digest from the immutable candidate, excluding only run-scoped report/evidence/handoff outputs (all product/tests/config/reference/canonical docs/AGENTS/root tooling included):

```sh
set -o pipefail
git ls-tree -r --full-tree c9fb464e21479be70e24bf2897c9430b66bde71a | rg -v $'\tdocs/coordinator/worktree-completion/(reports|evidence|handoffs)/' | shasum -a 256
```

Expected output: `6e48c11225f5614eb83a7764c40e8a01ac755d33a4522d634173d695e7dee886  -`.

**F7b Silent failures** — independent sup_terra `01a0533c-f906-7ae0-9fdc-82f8e0026541`, immutable `160eeda8..c9fb464e`: Count0 · Worst none. Admission errors propagate before effects; runtime:190–295 clears prior identity and publishes only after commit/closure; runtime:179 preserves production Duo omission/factory and credential failure. No reviewer gates/writes. Other axes remain pending, not inferred from this result.

**F7b Correctness** — sup_terra `01a05323-f908-7101-a99b-17c15728d86b`, same immutable delta: Count0 · Worst none. Runtime:214 reads selected Settings; :217 encloses exact-file fence, journal/activation/snapshot check, planner and kernel in outer SQLite transaction. Nested savepoints preserve all-or-nothing start effects; :190–191 invalidates prior identity and :289–295 publishes after commit/closure. Existing retained snapshot and worker/default boundaries preserved. No reviewer gates/writes.

**F7b Security** — independent sup_sol `01a0532d-1d4e-74d1-8a36-c114cdaaba00`, same delta: Count0 · Worst none. Runtime:214–229 consumes only exact selected journaled activation; :242–288 authors no replacement snapshot/activation; :190/:293 clear/publish at failure/success boundaries; :179 and unchanged worker:510 retain real credential factory on omission. Retained blob port verified. No reviewer gates/writes.

**F7b Spec** — sup_terra `01a0530f-de3a-74c1-8992-c76949d17c84`, same delta: Count0 · Worst none. Owning Settings/dry-run contract passages and selected admission, transaction, activation and worker seams support the approved join, retained identity, rollback/publication boundaries and exact conditional Duo additions. Static only, no execution claim.

**F7b Standards** — sup_luna `01a0530f-ddbf-73f2-8861-da715de78c93`, same delta: Count0 · Worst none. Existing authority/resolver/activation/retained snapshot/planner/kernel are reused; no second writer or open boundary, typed Duo forwarding preserves omission. Static only.

**F7b Performance** — sup_terra `01a05312-8152-7d40-aed9-50343d6c5d91`, same delta: Count0 · Worst none. Runtime:214 resolves between admission transactions; final required fencing covers one synchronous submission, with no new await/poll/snapshot. Runtime:289 closes the database; nested transactions reuse savepoints. No supported resource leak or avoidable I/O amplification; no measured latency claim.

**F7b Docs** — sup_luna `01a05324-a737-7932-861f-697731cfedb5`, same delta: Count0 · Worst none. New AGENTS lessons match admission, retained-snapshot, publication and Duo-default behavior; named owning sections contain no directly contradicted text requiring correction. Exact external profile checked. Static only.

Parent freshness4840 exit0: `npm run build:manifest && npm run roadmap:check && git diff --check && git diff --cached --check`. Returned output says `Wrote src/domain/workflow/generated-build-manifest.ts.` and `docs/roadmap/index.html is fresh.` Subsequent diff confirms generated manifest and all execution inputs unchanged; only parent reports remain unstaged. Fresh installed graph/lock/browser manifest/browser binary and guard-only legacy metadata hashes match the earlier input ledger. Tests review remains pending at this checkpoint; no heavy allocation/reservation.

**F7b Tests** — sup_luna `01a0532c-ae89-7c53-bb8a-97a12b2624c1`, immutable `160eeda8..c9fb464e`: Count2 · Worst medium. (1) composition.test:521 mid-start fault changes SQLite only; final file fence lacks a changed/locked-file crossing challenge. Removing `withExactRecord` could evade these cases. (2) :474 failed-start identity checks observe only scenarioCase via collectEvidence; removing configIdentity clearing could leave prior identity usable by resolveGate. Both are static sensitivity findings, not executed mutations. Parent confirmed the unobserved paths in the source/test diff. Existing admission/environment/rollback/Duo evidence remains valid, but readiness is held for bounded test-only repair and affected re-review.

### F7c parent receive — test-only proof follow-up

Returned index `52dba2928091d06d49928bfc7c7f0a13d20dc06a`; parent verified HEAD/MERGE_HEAD unchanged, only composition test (+112 lines) and [F7c report](dcc1-f7c.md) differ from c9fb. Runtime remains exact `ec2933b2587eee5359abd0c7d7b44952ff9d38de`; test is `e373f7677f9afdc56bbea12cf75487760ed85cf5`. All other product/AGENTS/canonical inputs unchanged.

Parent inspected both additions: valid previously journaled revision2 bytes replace revision3 only after initial read, leaving SQLite identity unchanged; separately, a genuinely parked run keeps a valid old activation after environment-only second-start refusal, so public resolveGate isolates stale config identity without another guard masking it. Writer records distinct mutation reds21374 and60455 plus exact source restoration; no product defect or interface expansion. Mutation hash labels were initially not stored Git objects; exact reconstruction verification is being collected rather than assuming retained object evidence.

Parent focused session34507 exit0, same exact `env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts` command:

```text
> hr-automation-rebuild@0.1.0 test
> vitest run --reporter=dot tests/unit/dry-run-scenario-composition.test.ts

RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1
·················
Test Files  1 passed (1)
     Tests  17 passed (17)
  Start at  09:18:51
  Duration  3.95s (transform 995ms, setup 0ms, import 1.67s, tests 2.21s, environment 0ms)
```

Parent `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`, session91624 exit0:

```text
> hr-automation-rebuild@0.1.0 typecheck
> tsc --noEmit
```

Output above is presentation-normalized returned tool text, not a byte-identical log file. Parent lint59056 and independent original Tests/Standards rereviews remain pending at this receipt. The other seven F7b axis verdicts stand on unchanged product/AGENTS inputs, with Standards explicitly rechecking the additional test delta. No heavy allocation or commit.

F7c final parent lint59056 exited0, exact command:

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Returned output (presentation-normalized):

```text
> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0
```

Mutation receipt clarified: writer reconstructed both mutation byte strings in memory, matched the previously reported hashes, and stored the Git blobs **at receive time**, not originally. Parent then independently diffed `ec2933b2..b88e506d` (only final withExactRecord wrapper/expectation removed, outer transaction retained) and `ec2933b2..c9ec32eb` (only configIdentity clearing removed). No working files/index/gates changed during reconstruction; both source and index52d remained exact. This is reconstructed hash-matched mutation evidence, not a claim of original object retention.

**F7c Standards** — original sup_luna `01a0530f-ddbf-73f2-8861-da715de78c93`, immutable `c9fb464e..52dba292`: Count0 · Worst none. The112 test-only additions use existing public runtime/authority APIs, confine changes to temp fixtures, restore the clock edge, and add no product interface, duplicate authority, open boundary or ownership violation. Runtime blob verified unchanged; static only.

**F7c Tests** — original sup_luna `01a0532c-ae89-7c53-bb8a-97a12b2624c1`, same immutable delta: Count0 · Worst none, both prior medium findings closed. Test:603 changes only valid previously journaled file bytes after initial read while SQLite remains revision3, isolating final fence refusal. Test:542 preserves genuine parked-run/old activation/comparison facts, so the missing config identity is decisive at public resolveGate; gate/run/command/audit effects stay unchanged. Prior assertions preserved. Reviewer independently reconstructed both reported mutation hashes and verified the named missing-rejection failures. Deterministic temporary crossings/fake external systems only, no multi-process/live claim. No reviewer gates/writes.

All selected F7b/F7c axes are now clear at their fixed deltas. Earlier F1–F6 reviewed source remains unchanged. No simplification requested or justified; skipped. Required remaining proof is frozen-candidate full coverage/parity and rendered inspection under explicit coordinator allocation, then committed-content equivalence. A source/test/config/reference change invalidates affected evidence; separately identified run reports/evidence do not change execution closure.

## F8 coverage red and approved F8b receive

Frozen0b5 coverage87688 failed one single-command-path guard; parity was withheld and heavy slot
released. Exact raw child bytes and separately quoted wrapper metadata are in dcc1-full-gates.md.
Minimized50617 reproduced the same lexical-count red; fresh lockedlint55868 passed. F8 read-only
proposal was coordinator-approved at existing public Settings/F7 seams, with precedence pinned
before source refactor and original guard/count/allowlist preserved.

F8b parent receive and fixed-delta independent axes are in [dcc1-f8b-reviews.md](dcc1-f8b-reviews.md).
Target0b5→99d464d2 changes only Settings runtime, composition tests and nearest lesson as execution
inputs; all other additions are named run evidence. Parent independently passed78focused plus
lockedtsc/lint and freshness, verified32 raw/meta pairs and ten meaningful retained mutations.
Execution closure is now d681c0c5; no full pass or old readiness transfers across this source change.
All eight independent selected reviews now returned Count0 and are persisted separately in the
F8b review ledger. No heavy allocation, full-candidate pass or product commit is claimed; renewed
identity verification/allocation follows. Existing earlier reviews remain historical at their
fixed deltas, and no old full-gate result transfers across F8b.
