# R1 report (rev 3) — u0 one-value canary admission BUILT; u1 stopped at the dispatch gate

**Date:** 2026-09-01 · **Supervisor:** Claude (this session) · **Mode:** coordinated-read-only board
(`board.md` written only at close, per the brief) · **Source handoff:**
`handoffs/2026-09-01-finish-separations-r1-rev3.md`

**Outcome:** u0 is implemented, tested, documented and integrated (D300). The live units u1–u5 did
NOT start: the dispatch gate is red on two conditions only the operator can clear (below). No
branch was left dangling, no browser opened, no run started, no gate requested, no write attempted.

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
