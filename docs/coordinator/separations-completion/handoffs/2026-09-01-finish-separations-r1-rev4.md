# Handoff — Finish separations R1 revision 4

**Date:** 2026-09-01 (15:00 PDT) · **Paused at:** u0 built on `feature/03b-live-close`, NOT merged;
u1 dispatch gate red · **Cleanup owner:** the resuming separations supervisor · **Remove when:** the
branch is merged, the board reconciled, and this file's deletion committed.

## What is done (verified, on branch `feature/03b-live-close`, base `master` `374e60d9`)

u0 — the one-value canary admission (D300) — is BUILT, tested, documented: one closed reference
`separationsKualiFinalizationCanaryDocumentNumber` / env
`HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER`; the three person-value
secrets and `smoke:test-target-person-secrets` are deleted; `npm run smoke:test-target-document-number`
is the admission (exit 0 only for `state=present` + `resolution=ready`; the value is never printed).
Full ledger of the commits, the gate table and the review status:
`docs/coordinator/separations-completion/reports/r1-rev3.md`.

Two commits on the branch are a concurrent dashboard session's (`f6fbd251`, `9228ae33`, parity lane
parallelism) — they landed here because that session shares the checkout. Merge them along.

## What is NOT done, and why

1. **Merge to master.** `test:coverage` is 4561/4578: 16 failures need ports 3938/5174, which the
   concurrent session's dashboard (PIDs 98303/98305 at the time) holds; 1 contention timeout passes
   standalone. `test:parity` is 287/289: `diagnostic-bundle-dialog.spec.ts:495/521` embed a
   capture's byte size and flap under the 5-worker lane (foreign seam `f6fbd251`). Merge only after
   `tests/unit/server/{compose-real-port,worker-pool-composition,worker-pool-parallel-proof}.test.ts`
   pass with the dashboard down.
2. **Review.** Six read-only reviewers all died on the session rate limit. Re-run `/review` on
   `374e60d9...<branch HEAD>` excluding `f6fbd251`, `9228ae33` and the corpus re-freeze `6a521779`.
   The Security axis was done by the supervisor (report §4).
3. **u1–u5** — not started. Nothing of D287 consumed.

## Resume steps (in order)

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short                      # must be empty; if the dashboard session is mid-edit, wait
git branch --show-current               # feature/03b-live-close (or master — then: git switch feature/03b-live-close)
lsof -nP -iTCP:3938 -iTCP:5174 -sTCP:LISTEN   # must be EMPTY before the port tests and before any live run
npx vitest run tests/unit/server/compose-real-port.test.ts tests/unit/server/worker-pool-composition.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts
npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check && npm run roadmap:check && git diff --check
git switch master && git merge --no-ff feature/03b-live-close && git branch -d feature/03b-live-close
npm run cli -- storage doctor           # exit 0, backup current
grep -c '^HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER=' .env   # 1 — set by the OPERATOR
npm run smoke:test-target-document-number   # exit 0: state=present, resolution=ready
```

Then u1 (read-only fresh 4537/S7 observation → migration doc §9.33), u2 (`npm run cli -- dry-run-scenario
separations --subject finalization-canary`, prove 0 write_intents / 0 write_attempts / 0 durable_outbox),
u3 (② UCPath filing → immediate ① pending sweep → ③ Kuali finalization, each behind its own operator
ALWAYS-GATE), u4 evidence, u5 close — per `briefs/r1.md` and `run-plan.md`, whose precondition 3 is
superseded by D300 (notes already in both). Safety rules unchanged: primary checkout only; no `reRead`
after ②; UNKNOWN stops without retry; never push.

## Operator asks (only these unblock u1)

1. Add `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER=<number>` to `.env`
   (D284 registers 4537; the supervisor does not choose the number).
2. Stop the concurrent dashboard/parity session for the live window (ports 3938/5174 free, tree
   quiescent) and confirm the ALWAYS-GATE window for three approvals.
3. Decide whether `diagnostic-bundle-dialog.spec.ts` embedding a capture's byte size in the a11y
   reference is a defect for the dashboard session (recommended: yes — nondeterministic under parallel capture).

## Instruction conflict noted

The rev-3 handoff said the root `AGENTS.md` governs and CLAUDE.md must never be edited. The user's
global rules say the opposite (never edit AGENTS.md; docs go in CLAUDE.md). The global rule was
followed: `src/control/CLAUDE.md` was updated, `AGENTS.md` untouched.
