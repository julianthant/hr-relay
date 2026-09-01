# R1 report (rev 3 + Codex closeout) — u0 built; u1 stopped safely on a gone canary

**Date:** 2026-09-01 · **Supervisor:** Claude (this session) · **Mode:** coordinated-read-only board
(`board.md` written only at close, per the brief) · **Source handoff:**
`handoffs/2026-09-01-finish-separations-r1-rev3.md`

**Outcome note:** §§1–5 preserve Claude's original rev-3 state. Codex resumed from the rev-4
handoff; the verified closeout and superseding disposition are in §6.

## 1 · Intake verification (handoff §Verification before resuming)

| Check | Result |
|---|---|
| `git status --short` at intake | 3 files dirty from the D296 session (`.gitignore`, `src/infra/providers/local-vite-probe.ts`, `tests/unit/server/preflight-runners.test.ts`), mtime 24 min old, coherent diff, its unit test 15/15 + lint green → committed as `374e60d9 fix(preflight): each Vite identity endpoint carries its own byte ceiling` to clear the tree (operator asked for a clean tree) |
| branch / HEAD before u0 | `master` @ `374e60d9` (25+1 ahead of `origin/master` `50adf8a9`); sole worktree; `feature/03b-live-close` absent |
| `npm run cli -- phase` | `completedThrough=2j`, `active=3-workflow-migration`, roots `.tracker-rebuild`, ports 3938/5174, namespace `hrauto-rebuild` |
| `npm run cli -- storage doctor --json` | exit 0; `backup.state=current`, latest `authority-g1299-20260901181917743-…` verified-compatible, generation gap 0, age 37 min (checked 18:55:58Z) |
| role policy | `check-role-policy.py --platform claude` → valid (4 workers) |
| R1 base pin | `feature/03b-live-close` created from clean `master` `374e60d9` at 11:57 PDT |

## 2 · u0 — one-value canary admission (D300)

Branch `feature/03b-live-close` from `master` `374e60d9`. Fourteen commits; two are the concurrent
dashboard session's (`f6fbd251`, `9228ae33` — parity lane parallelism) which landed on this branch
because that session shares the checkout. Everything else is R1/u0.

| Commit | What |
|---|---|
| `2da7cdd2` | core: one closed reference `separationsKualiFinalizationCanaryDocumentNumber` / `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` (secrets.ts, secret-names.ts); registry `document: {state:"configured", reference}`, `resolveSeparationsTestTarget(registry,label,env?)`; finalization arm loses `secretInput` + `ready`; `scripts/smoke-test-target-document-number.ts` replaces the person-secrets smoke; `.env.example`; build manifest regenerated |
| `f4bc44cc` `9eeff6e7` | D300 normative text (03b §canary registry), ledger round 112, migration doc STATUS + §6 |
| `d410b659` | pointers: clock-config-secrets, guards-and-tests §10.5, src/control/CLAUDE.md (+ lesson), coordinator brief/run-plan rev-3 notes |
| `573c278a` | roadmap site re-rendered |
| `428ad745` `2c3f1e04` `8dbd8e11` `2a4a1702` `387dbe82` `1634128f` | tests reconciled (registry ×2, secrets-redaction, bootstrap, dry-run composition, T1b manifests, guard-inventory invariant text) |
| `28162c89` | fix: a blocked dry-run scenario prints the resolver's reason (found by the test worker — the label alone hid "set <key>") |
| `6a521779` | parity corpus re-frozen: every changed line is a descriptor/impl hash rendering (verified: 491 files, 0 visual changes) |

**Admission proof (D300), 2026-09-01, primary checkout, value supplied via parent env for the test only:**

| Command | Exit | Output |
|---|---|---|
| `HRAUTO_…_DOCUMENT_NUMBER=4537 npm run smoke:test-target-document-number` | 0 | `state=present` · `resolution=ready` |
| `npm run smoke:test-target-document-number` (key unset — the real `.env` state) | 1 | `state=refused` · `resolution=not-attempted` |
| `HRAUTO_…_DOCUMENT_NUMBER=abc npm run smoke:test-target-document-number` | 1 | `state=invalid` · `resolution=not-attempted` |

## 3 · Integrated gate at `6a521779`

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:coverage` | exit 1 — **364/368 files, 4561/4578 tests**. 16 failures in `tests/unit/server/compose-real-port`, `worker-pool-composition`, `worker-pool-parallel-proof`: `dashboard preflight refused startup: ports.available: reserved port ownership is invalid for frontend 5174 (owner-proof-unconfigured)` — the concurrent session's dashboard (PIDs 98303/98305) holds 3938/5174. 1 timeout in `guard-manifest.test.ts` under contention; **passes standalone 6/6** |
| `npm run build:manifest:check` | current |
| `npm run roadmap:check` | exit 0 |
| `git diff --check` | clean |
| `npm run test:parity` (after re-freeze) | **287/289**; the 2 failures are `diagnostic-bundle-dialog.spec.ts:495/521` — the a11y reference embeds the capture's byte size (136.9 KB vs 136.7 KB) and varies run to run under the new 5-worker lane (`f6fbd251`, foreign seam). Not re-frozen to hide it |

## 4 · Review

Six read-only reviewers (Standards/Spec/Correctness/Silent failures/Tests/Docs) were dispatched
and **all six died on the session rate limit before returning findings** — those axes are
**BLOCKED, not passed**; re-run `/review` on `374e60d9...6a521779` (excluding `f6fbd251`, `9228ae33`,
`6a521779`) when the limit resets. Security axis (supervisor-owned) done by direct inspection:
the value is read once (`secrets.ts:444–452`), every message names reference/key only, both smoke
lines print state only, every `catch` in the changed files re-throws or maps to an explicit
non-success state (`invalid`/`defect`/exit 1), the runner prints `resolution.reason` which names the
key, never the value. Docs axis: the test worker flagged that `tests/unit/canary-person-values-
redacted.test.ts` still pins the three retired `<secret:…>` placeholder names in `docs/migrations/
separations.md` §9.19 — a dated historical record, left as history.

## 5 · Dispatch gate for u1 — RED, two operator conditions

| # | Condition | State |
|---|---|---|
| 1 | quiescent, exclusive checkout | **RED** — the dashboard/parity session is live (commits at 12:32 PDT on this branch; dashboard up on 3938/5174) |
| 2 | u0 integrated + admission green for the one key | u0 BUILT on the branch, **not merged** (gate not fully green, see §3); `.env` has **0** occurrences of the new key → smoke exit 1 |
| 3 | storage doctor green + current backup | GREEN (18:55Z: backup current, g1299, gap 0) |
| 4 | base pin + operator gate window | pin `374e60d9` taken; no gate window confirmed |

u1–u5 not started: no browser, run, gate, write, retry or UNKNOWN. Board write-back: unit ledger
updated for u0 only (this report is the evidence). Handoff rev 3 replaced by rev 4.

## 6 · Codex closeout after rev-4 — u1 executed and hit the required safety stop

Codex resumed on `feature/03b-live-close`, mirrored every existing instruction pair, repaired the
u0 review findings, made the parity fixture deterministic, and completed the branch gates. The
operator supplied the ignored D300 key locally; its smoke returned `state=present` /
`resolution=ready` without printing the value. The first storage reading had a healthy authority
but stale backup, so the normal dashboard lifecycle created a verified current backup before the
live attempt.

### Live u1 evidence

| Evidence | Result |
|---|---|
| command | `npm run cli -- dry-run-scenario separations --subject finalization-canary` |
| scenario result | `62ea22fd-798c-4982-b4d7-8a211c6ec954` · `failed` / `started` |
| run / trace / attempt | `325cd998-bd05-4ffd-a863-99e0cc5c0ebe` / `sp-142939-325c` / 2 |
| failure | `b5f34a55-75c5-423e-a7c2-d7fa8548b392` · `DOCUMENT_NOT_IN_ACTION_LIST` · `writeState: not-attempted` |
| exact-run write authority | `write_intents=0` · `write_attempts=0` · `durable_outbox=0` |
| gate/write effects | no gate requested; 0 approvals; no write prepared or submitted; no UNKNOWN |

The fresh Kuali Action List search found the sole D284 canary absent before current `plan`/S7
evidence. The run plan requires an immediate stop when the document is absent or materially changed,
so u2–u5 did not execute and none of the three D287 approvals was consumed. The registry now retains
`finalization-canary` as `gone`, last observed 2026-09-01; no replacement was inferred.

### Source, tests and documentation reconciled

| Area | Closeout |
|---|---|
| instruction authority | all eight repository `AGENTS.md` / `CLAUDE.md` pairs are byte-identical; the root pair records the operator's mirror rule and the D300/gone-subject lessons |
| u0 review repairs | unexpected smoke failures propagate; retired smoke guards and standalone env-access traps added; D300 phase/migration wording aligned |
| parity | the five-worker gallery race now reads a deterministic synthetic fixture; two references deliberately re-frozen with 0 visual design changes |
| live disposition | `config/test-subjects.json` marks the canary `gone`; both resolvers and the smoke block before environment access; synthetic available registries retain ready/unset/malformed D300 coverage |
| dry-run projection | the live attempt exposed that the direct scenario start omitted `run.queued`; dashboard, intake, retry and scenario starts now share one queue-root event builder and scenario start emits after authority commit, before drain |
| recovered companion state | D301 preserved the historical 2,422-byte stream prefix by digest and appended one exact authority-derived queue root under stopped-runtime admission. Doctor is exit 0 with 8/8 stream/live runs reconciled and current generation-1335 authority/backup; an exact repeat was byte-idempotent, and the BFF served healthy/current storage |

### Review and final gates

Standards, Spec, Correctness, Silent-failure, Tests, Docs and Security axes were completed. The
actionable findings were repaired; the final Docs/Correctness returns had no findings. Performance
was not a D300 hot-path claim. The queue-root repair was additionally proved through the composed
dry-run and BFF command suites.

| Gate | Final result on branch |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:coverage` | 368/368 files · 4583/4583 tests · exit 0 |
| `npm run build:manifest:check` | current · exit 0 |
| `npm run roadmap:check` | fresh · exit 0 |
| `npm run test:parity` | 289/289 · exit 0 |
| instruction pair check | 8/8 byte-identical |
| `git diff --check` | clean |

The source branch is safe to merge locally with `--no-ff`; nothing is pushed. Phase 3b is not
falsely closed: the three controlled commits remain blocked until the operator names a new canary,
that canary passes fresh S7/read evidence and a green 0/0/0 rehearsal, and the three approvals are
then taken separately in the fixed ② → immediate ① → ③ order. The coordinator board remains for
the coordinator to reconcile; this supervised run does not rewrite it.

## 7 · Operator-named replacement candidates — current live batch

The operator subsequently named seven document numbers. The dashboard admitted each as a
`dryRun=true` Separations run. One worker proved 4589 first; three explicit pool members then drained
the remaining six. The sanitized durable table and UI recipe are in
`evidence/ui/2026-09-01-candidate-dry-runs.md`; restricted screenshots remain local and untracked.

Three documents stopped with `SEPARATION_DATE_IN_FUTURE` and were skipped without retry. Two stopped
on current subject facts (`CONCURRENT_ACTIVE_EMPLOYMENTS`, `EMPLOYEE_NOT_FOUND`). Runs for 4589 and
4502 reached the human `identity-approval` gate. Every exact-run query returned 0 write intents,
0 write attempts and 0 durable-outbox rows. No gate was resolved and none of D287's three write
approvals was consumed.

The run for 4589 is the clean attempt-1 continuation candidate: current Kuali, UCPath and New Kronos
facts reached comparison, and the Logs panel rendered those recorded observations. The adjacent Run
data rail remained empty and used copy claiming no fields had been extracted; that rail is backed by
the checkpoint/edit ledger rather than the observed-log projection, so the sentence is misleading
for this run. u2 remains open until the operator resolves 4589's identity gate and its resumed dry
run reaches the preview terminal. Source/canonical input are not frozen yet, and u3–u5 have not
started.
