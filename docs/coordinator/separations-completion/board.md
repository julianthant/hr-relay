# Board — separations completion

**Project profile:** docs/coordinator/separations-completion/project-profile.md
**Integration target:** master (via feature/03b-live-close, --no-ff)
**Board owner:** coordinator
**Write rule:** one writer; R1 supervisor authorized at run close only, this exact path
**Last verified:** 2026-09-01 15:00 PDT at master `374e60d9` / branch `6a521779` (rev 3 — see unit ledger u0; earlier text below is the 08:55 state) — **still NOT clean and actively
written**: the concurrent Codex session is mid-D295 (5 modified + 3 untracked; `top-bar.tsx` touched
42 s before the check). R1 rev 2 closed **BLOCKED at the dispatch gate**, before u1
(reports/r1-rev2.md); nothing of D287 consumed. Precondition status: P1 quiescence **OPEN (worse —
live writer)** · P2 backups **GREEN, re-verified** (doctor exit 0, backup current g1291, age 30m,
gap 0) · P3 secrets **OPEN** (smoke exit 1, all three `state=refused`; 0 canary keys in `.env`) ·
P4 pin NOT taken — `feature/03b-live-close` still absent, deliberately not created under a foreign
live tree. A git remote `origin` exists — never-push unchanged and respected.

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
| u0 | R1 rev3 | **built, unmerged** | `feature/03b-live-close` @ `6a521779` (14 commits, base `374e60d9`); reports/r1-rev3.md | typecheck 0 · lint 0 · coverage 4561/4578 (16 port-held by the concurrent dashboard, 1 contention timeout green standalone) · manifest current · roadmap 0 · parity 287/289 (gallery byte-size flake, foreign seam) | 6 reviewers rate-limited → BLOCKED; security axis by supervisor | D300 ratified (03b, ledger r112, migration doc); smoke replaced; `.env` key still unset (0) |
| u1 | R1 rev3 | **blocked (gate)** | none — no code commit; report + this board only | dispatch gate: quiescence RED · backups GREEN (doctor 0, g1291 gap 0) · secrets RED (smoke 1) · pin not taken | n/a — no code changed | intake stopped BEFORE u1; no live read, S7 NOT established, no branch created |
| u2 | R1 rev2 | not started | — | — | — | gated on u1 |
| u3 | R1 rev2 | not started | — | — | — | gated on u2 + 3 operator gates; no gate window opened this dispatch |
| u4 | R1 rev2 | not started | — | — | — | rides inside u3 |
| u5 | R1 rev2 | not started | — | — | — | gated on u3/u4 |

## Residue
- Out of scope, already owned elsewhere: 4568/R3 (§9.29), storage-span visibility (Phase 4,
  dashboard-surfaces §9.8), Run-modal touch targets (Phase 4).
- **Carried forward from R1's block, all four preconditions must hold before R1 re-dispatches:**
  1. the checkout is quiescent and exclusively R1's (the live sequence cannot share a source tree or
     the `.auth` profile — §9.21's wedge is unsynchronised concurrent writers). **Re-checked
     2026-09-01 08:55 PDT: still OPEN, and now a demonstrably ACTIVE writer, not just a dirty tree;**
  2. ~~storage doctor exits 0 with a valid current backup~~ — **CLEARED 2026-09-01**: doctor
     exit 0, `backup: current` g1291 (age 21m, generation gap 0); the 99 invalid manifests are
     historical, superseded by the fresh valid backup. Re-verify at dispatch;
  3. the three `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_*` secrets are restored to
     `.env` (gates ③ and the smoke; does NOT gate u2's rehearsal — `timekeeperName` resolves as a
     literal in the chain's canonical input);
  4. a fresh base pin on a branch nothing else writes — `feature/03b-live-close` remains absent and
     was deliberately NOT created on 2026-09-01: creating it would move this checkout's HEAD off
     `master` underneath the live concurrent session. Ten-second step once (1) holds.
  5. **NEW — 4570 / 4567 / 4566.** The rev-2 dispatch carried an operator image of these three Kuali
     document numbers ("and the 3 are"). They appear nowhere in the repo's markdown. R1 did not act
     on them: D284 registers 4537 as the SOLE subject and the brief scopes out any other, so adding
     or substituting a subject is a coordinator/operator ruling, and would need D284 amended in its
     owner before a run consumes it.
- **New, owned outside this workspace:** the v28 backup-manifest invalidation; the three absent
  `.env` person secrets.
- No step of the D287 sequence was consumed — nothing needs re-authorizing, and R1 re-runs unchanged
  from u1.

## Questions for the operator

Backups (P2) are RESOLVED and re-verified. Three remain; R1 can self-clear none of them.

1. **Serialize the checkout (P1).** When is the Codex D295 session done, and will you hold the tree
   quiescent for R1's window? This is the blocker that stops the entire run — two consecutive
   dispatches have died on it.
2. **Restore the three `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_*` values to
   `.env` (P3).** Not recoverable from the repo; they gate ③, the last of the three writes.
3. **What are 4570 / 4567 / 4566?** Context only (subject stays 4537), or a subject change? The
   latter is a D284 amendment, not a supervisor call.

Plus: re-confirm your ALWAYS-GATE window — the 08-31 one went unused and no window was opened on
09-01.
