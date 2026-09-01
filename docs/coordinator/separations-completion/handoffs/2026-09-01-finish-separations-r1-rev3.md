# Handoff — Finish separations R1 revision 3

**Date:** 2026-09-01

**Paused at:** R1 dispatch gate before u1

**Cleanup owner:** the resuming separations supervisor

**Remove when:** the supervisor has verified this state, completed or durably re-handed off R1, reconciled the authorized board, and committed deletion of this consumed file

## Task summary

Finish the sole open Phase 3b exit criterion: the controlled separations close for the one Kuali document selected through ignored local configuration. The software readiness work is integrated and the phase is at 8/9 exit criteria; the remaining work is one narrow canary-admission correction, live read-only re-verification, composed dry-run rehearsal, three individually gated controlled writes, evidence preservation, authority reconciliation, local integration, and cleanup.

**Operator ruling, 2026-09-01:** the canary identity is one Kuali document number in `.env`. Do not require separate employee-name, EID, or timekeeper-name canary values. The composed `separations` workflow already starts from only the document number, reads employee name and document EID from Kuali, resolves the UCPath identity through the graph, and supplies its declared timekeeper constant. The three-person-secret adapter belongs only to the standalone `separations-kuali-finalization` proving harness and must not gate the controlled composed run.

Use the existing coordination workspace as the shared authority:

- `docs/coordinator/separations-completion/project-profile.md`
- `docs/coordinator/separations-completion/board.md`
- `docs/coordinator/separations-completion/run-plan.md`
- `docs/coordinator/separations-completion/briefs/r1.md`
- `docs/coordinator/separations-completion/reports/r1.md`
- `docs/coordinator/separations-completion/reports/r1-rev2.md`

The newest operator-supplied root `AGENTS.md` instructions govern. Do not rely on older `CLAUDE.md` references in the project profile, and never create or edit a `CLAUDE.md` file.

## Plan and shared state

R1 now has one bounded admission-repair unit followed by the existing u1–u5 sequence. It has not passed its dispatch gate:

1. **u0 — one-value canary admission:** replace the three person-value canary environment requirements with one strict document-number environment reference. Route the controlled close through the composed workflow's live reads and identity gate; never copy the document number into a name or EID field. Retire the obsolete dispatch smoke, update its tests, refresh the build manifest if its closure changes, and ratify the operator ruling in the owning Phase 3b/migration authority before live work.
2. **u1 — read-only intake:** freshly resolve and re-verify the configured document and current S7 state.
3. **u2 — composed rehearsal:** execute the exact `dryRun=true` path and prove zero deltas in `write_intents`, `write_attempts`, and `durable_outbox`.
4. **u3 — controlled sequence:** perform D287's exact order, with one fresh operator ALWAYS-GATE for each write: ② UCPath filing → immediate ① pending sweep on the new row → ③ Kuali finalization.
5. **u4 — evidence:** preserve the complete A5 obligation and authority record, including every gate and outcome.
6. **u5 — close:** run the declared gates, reconcile only owning authorities whose truth changed, merge the verified branch locally with `--no-ff`, update the authorized coordinator board, and clean the completed branch/worktree state.

Safety constraints are unchanged:

- The live sequence runs only from the primary checkout because it owns `.env`, `.tracker-rebuild`, and `.auth`.
- Use only the single document number admitted through the new closed environment reference. Until u0 reconciles the authorities, the last ratified subject remains `4537` / `finalization-canary`; documents `4570`, `4567`, and `4566` appeared in operator evidence but are not authorized by D284.
- Take a separate operator approval at each ALWAYS-GATE. A prior gate does not authorize the next write.
- Do not call `reRead` after write ②.
- If any submit result is `UNKNOWN`, stop. Never retry it.
- Do not push, perform an automatic remote merge, or take unrelated live HR action.

## Current state — verified, not remembered

Verified on 2026-09-01 in `/Users/julianhein/Projects/hr-automation-rebuild`:

- Branch: `master`
- HEAD: `4fd5292dab8f9353e82f97a609866fa82e092326`
- `origin/master`: `50adf8a9165341b1cc18080631dcd07b6a37d4e4`
- Local `master` is 25 commits ahead of `origin/master`.
- Exactly one worktree exists: the primary checkout on `master`.
- `feature/03b-live-close` does not exist.
- Runtime phase reports `completedThrough=2j` and `active=3-workflow-migration`.
- `npm run cli -- storage doctor` was green at `2026-09-01T16:26:23.244Z`: authority schema v28/generation 1293, `quick_check` green, zero pending commands/write intents/outbox/provider reservations/artifact outbox, and a current generation-matched backup.
- The existing `npm run smoke:test-target-person-secrets` is red because it implements the superseded three-person-value admission. Do not populate those keys and do not satisfy them by placing the document number in name/EID fields. u0 must replace this requirement with one strict document-number environment reference and a matching smoke/admission check.
- The checkout is not quiescent. Another active dashboard/D296 session owns 16 modified files:
  - `src/dashboard/app/dashboard-app-model.ts`
  - `src/dashboard/app/dashboard-app.tsx`
  - `src/dashboard/surfaces/run-start-model.ts`
  - `src/dashboard/surfaces/run-start-timeline.ts`
  - `src/dashboard/surfaces/run-start.tsx`
  - `src/domain/dashboard/bootstrap.ts`
  - `src/infra/providers/local-vite-probe.ts`
  - `src/server/dashboard/queries/bootstrap.ts`
  - `tests/parity/helpers/fixture-day.ts`
  - `tests/parity/toolbar-touch-target.spec.ts`
  - `tests/unit/dashboard-wire.test.ts`
  - `tests/unit/dashboard/fixtures/run-captures-app-fixture.ts`
  - `tests/unit/dashboard/run-start-dialog.test.ts`
  - `tests/unit/dashboard/takeover-frame-focus.test.ts`
  - `tests/unit/server/bootstrap-start-surface.test.ts`
  - `tests/unit/server/preflight-runners.test.ts`

Do not stash, revert, stage, amend, or otherwise take ownership of those 16 files. Wait for their owning session to commit or dispose of them, then re-verify a clean and exclusive primary checkout.

The coordinator board was last verified at `136f87c6` and is stale only with respect to the newer master HEAD and the current D296 working changes. Its R1 scope, ordering, safety rules, and blocked-before-u1 status still agree with observed state. Do not invent a replacement plan; refresh the board only after an authorized verified R1 outcome.

## Progress

- Five earlier Phase 3b integration branches were finished and integrated.
- Database lineage choice 1A was ratified as D290.
- Bounded-memory archive downloads and multi-origin diagnostic image behavior were repaired and integrated.
- The chosen Run-modal Options and Steps design was preserved; destination controls were removed from that port.
- Phone/mobile document Capture Mode was retired under D294 and is outside this R1.
- Phase 3b software readiness is recorded as 8/9. Track A A2–A5 plus A8 remains the only open exit work.
- The composed `separations` workflow already accepts one varying value, `documentNumber`; its graph reads the employee name and document EID from Kuali, resolves the UCPath subject, and carries those verified facts into all three writes. No product graph expansion is needed for the operator's one-value ruling.
- No R1 branch was created, browser opened, run started, gate requested, write attempted, retry issued, or `UNKNOWN` outcome observed in the blocked revision-2 attempt.

## Dispatch boundary

Do not begin u1 until all of these are freshly green together:

1. `git status --porcelain` is empty and the primary checkout is exclusively available; the D296 owner has finished.
2. u0 is integrated and its replacement admission check passes for exactly one document-number environment reference. The three person-value keys and their dispatch smoke are retired; the number is never treated as a person value.
3. `npm run cli -- storage doctor` is freshly green with a current valid backup.
4. The supervisor records the then-current clean `master` HEAD as the R1 base pin and confirms an operator gate window is available for u3.

Once conditions 1, 3, and 4 are green, create `feature/03b-live-close` from that exact clean `master` HEAD in the primary checkout and implement u0 there. After u0 makes condition 2 green, resume at u1. The current `4fd5292d` value is evidence of the original handoff verification, not a future branch pin; D296 may legitimately advance `master` first.

## Open questions and deferred decisions

- Use one closed environment key for the canary document number. A suitable consistent name is `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER`; u0 must register and validate the exact name rather than accepting arbitrary environment lookup.
- Do not set the three old keys to the document number. Employee name, EID, and timekeeper name have different schemas and authority; fabricating them from `4537` would bypass the identity gate.
- The other document numbers visible in prior operator evidence remain excluded unless the one configured document-number value explicitly selects one after the D284 authority is reconciled. Never infer or rotate the canary from screenshots.
- If the active D296 session changes separations-owned contracts or the live run surface, reassess the impact after it commits. Do not merge around its uncommitted state.
- Any new ambiguity at a write boundary belongs in a numbered decision brief. Read-only verification should proceed once the four dispatch conditions are green.

## Verification before resuming

Run these from the repository root and preserve the outputs in the R1 evidence record:

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/master
git rev-list --count origin/master..HEAD
git worktree list
git show-ref --verify --quiet refs/heads/feature/03b-live-close; echo $?
npm run cli -- phase
npm run cli -- storage doctor
```

Before u1, u0 must add and prove a replacement one-value admission command (or an equally explicit existing admission path) that reads only the registered document-number environment key and validates it with `KualiDocumentNumberSchema`. Preserve its exact green command in the R1 evidence table.

After the checkout/backup/base-pin conditions are green and the branch is still absent:

```bash
git switch -c feature/03b-live-close
```

Then follow `briefs/r1.md` and `run-plan.md` for u1–u5, except that their three-person-secret precondition is superseded by the operator ruling in this handoff and must be reconciled during u0. Run every gate declared by the repository; if tests are run, lint is mandatory. Stage paths explicitly, commit by logical category, merge locally with `--no-ff`, and do not push.

## Pointers

- Owning phase: `docs/rebuild/03b-finish-separations.md`
- Migration authority: `docs/migrations/separations.md`
- Readiness evidence: `docs/coordinator/worktree-completion/status/2026-08-31-separations-readiness.md`
- Coordination board: `docs/coordinator/separations-completion/board.md`
- R1 brief: `docs/coordinator/separations-completion/briefs/r1.md`
- R1 reports: `docs/coordinator/separations-completion/reports/r1.md` and `reports/r1-rev2.md`
- Runtime operations: `.agents/skills/hr-manage/SKILL.md`

## Suggested skills

- `/supervise` — required for this multi-part R1 close; the supervisor owns sequencing, integration, verification, and consequential judgment.
- `hr-manage` — use for dashboard/runtime startup, dry-run execution, monitoring, gates, receipts, and closure.
- `/debug` — only if a concrete red-capable failure arises during R1.
- `/ui` — only if verified R1 work truly requires a user-visible dashboard change; do not absorb the active D296 work.
