# Board — separations completion

**Project profile:** docs/coordinator/separations-completion/project-profile.md
**Integration target:** master (via feature/03b-live-close, --no-ff)
**Board owner:** coordinator
**Write rule:** one writer; R1 supervisor authorized at run close only, this exact path
**Last verified:** 2026-09-01 (later pass) at master f18b1fa6 — still NOT clean: the concurrent
Codex session moved on to D295 catalog work (2 modified files). R1 closed BLOCKED at admission
(reports/r1.md); brief reworked to rev 2. Precondition status: P1 quiescence OPEN · P2 backups
CLEARED (doctor exit 0, backup current g1291, gap 0) · P3 secrets OPEN (0 canary keys in .env) ·
P4 pin mechanical (feature/03b-live-close deleted; recreate at dispatch). A git remote `origin`
now exists — never-push unchanged.

## Facts every run needs
- Separations stands 8/9 (doc 03b §Exit criteria); only criterion 5 is open — A2–A5 + A8.
- 4537 / `finalization-canary` is the SOLE registered subject (D284). 2026-08-28 S7 equality is
  historical; current S7/subject facts are unobserved.
- §9.32: the 2026-08-30 refusal was the assigned WORKTREE lacking `.env`. The primary checkout has
  `.env`; run there. Not a code defect.
- Order: ② UCPath filing → immediate ① pending sweep on ②'s new row → ③ Kuali finalization.
  One ALWAYS-GATE per write. No reRead after ②. UNKNOWN stops, never re-run.
- Gates: typecheck · lint · test:coverage · build:manifest clean · test:parity · roadmap:check ·
  git diff --check.

## Decisions ratified
- (none this workspace; D284/D287/D290–D293 pre-exist in their owners)

## Unit ledger
| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u1 | R1 | **blocked** | none — no commit made | admission RED: `storage doctor` 1, `smoke:test-target-person-secrets` 1; resolver 0, manifest 0 | n/a — no code or docs changed | no live read taken; S7 NOT established |
| u2 | R1 | not started | — | — | — | gated on u1 |
| u3 | R1 | not started | — | — | — | gated on u2 + 3 operator gates; operator WAS available |
| u4 | R1 | not started | — | — | — | rides inside u3 |
| u5 | R1 | not started | — | — | — | gated on u3/u4 |

## Residue
- Out of scope, already owned elsewhere: 4568/R3 (§9.29), storage-span visibility (Phase 4,
  dashboard-surfaces §9.8), Run-modal touch targets (Phase 4).
- **Carried forward from R1's block, all four preconditions must hold before R1 re-dispatches:**
  1. the checkout is quiescent and exclusively R1's (the live sequence cannot share a source tree or
     the `.auth` profile — §9.21's wedge is unsynchronised concurrent writers);
  2. ~~storage doctor exits 0 with a valid current backup~~ — **CLEARED 2026-09-01**: doctor
     exit 0, `backup: current` g1291 (age 21m, generation gap 0); the 99 invalid manifests are
     historical, superseded by the fresh valid backup. Re-verify at dispatch;
  3. the three `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_*` secrets are restored to
     `.env` (gates ③ and the smoke; does NOT gate u2's rehearsal — `timekeeperName` resolves as a
     literal in the chain's canonical input);
  4. a fresh base pin on a branch nothing else writes — `feature/03b-live-close` was taken over by
     the concurrent session and holds no R1 work (`git log master..feature/03b-live-close` empty).
- **New, owned outside this workspace:** the v28 backup-manifest invalidation; the three absent
  `.env` person secrets.
- No step of the D287 sequence was consumed — nothing needs re-authorizing, and R1 re-runs unchanged
  from u1.

## Questions for the operator
- ~~Confirm a gate window~~ — ANSWERED 2026-08-31: available now. The blocker was the checkout, not
  the operator; the window went unused and must be re-confirmed for the next attempt.
- Backups question is RESOLVED (P2 cleared). Two remain, both operator-owned, R1 cannot self-clear:
  1. Serialize the checkout — when is the Codex session done, and will you hold it quiescent for
     R1's window? (P1)
  2. Restore the three `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_*` values to
     `.env` — they are not recoverable from the repo. (P3)
  Plus: re-confirm your ALWAYS-GATE window; the 08-31 one went unused.
