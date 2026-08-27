# Handoff — Phase 3b run R1: the 2026-08-28 controlled commits on canary 4537

**Date:** 2026-08-27 (written by the coordinator for a session on 2026-08-28)
**Paused at:** before execution — resume at u1

## Task summary
Phase 3b's exit table is 8 of 9; row 5 — controlled-commit evidence on the operator-approved target — is the only open row, and it was blocked on a DATE, not a defect: S7 admits Kuali doc **4537** on Pacific calendar day 2026-08-28. This run performs the three controlled commits in order ② UCPath filing → ① sweep → ③ Kuali finalization, records each from authority in `docs/migrations/separations.md` **§9.28**, and runs the T1b manifest live to record `met`. It confirms facts; it does not fix what it finds — differences from the recorded shapes are R2's input (u6–u8).

**These are REAL HR transactions.** `dryRun=false` only on 4537, only after the operator approves the ALWAYS-GATE in the ceremony, one commit at a time. An UNKNOWN submit stops the run: record it, never re-run. Everything else (login smoke, dry runs, selector snapshots, Duo) is pre-authorized — never ask.

## Plan
- Run plan: `docs/plans/2026-08-27-03b-runs.md` §R1 (units u1–u5, specs verbatim there)
- Board: `docs/plans/03b-board.md` — read FIRST; write your ledger rows back at close

## Current state (from git)
- Repo: `/Users/julianhein/Projects/hr-automation-rebuild`   Branch: `integration/03b`   Base: `8e322e8a`
- master: `8e322e8a` (03a closed, merged `--no-ff`) — do not move it
- Worktrees: none · feature/*: none · tree clean
- Gate at base: typecheck · lint · 310 files / 3,392 tests · parity 218 · roadmap fresh

## Progress
- [ ] u1 pre-flight (gate, live login smoke, `dryRun=true` on 4537 — S7 must ADMIT, `hr-debug` submit-free audit) ← **resume here**
- [ ] u2 commit ② UCPath filing — operator at the gate
- [ ] u3 commit ① sweep + `clear-pending` COMMITTED-arm witness — ask the operator at the keyboard whether to re-run ① immediately after ②
- [ ] u4 commit ③ Kuali finalization — capture the real payload against the seven D217 shapes; table only, no fixes
- [ ] u5 T1b live `met` + doc 03b row 5 / line ~680 / status line + §9.28 close + board rows + roadmap

## Open questions / deferred decisions
- u3's re-run of ① immediately after ② is the operator's live call (doc 03b line ~736). Ask at the keyboard; do not defer it to a handoff.
- Anything that surprises you in ②/③ (a shape that differs, a window longer than D207) is RECORDED here and handed to R2 — not fixed in this run.

## Verification before resuming
```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch && git worktree list && git branch --list 'feature/*'
git log --oneline -1 && git merge-base --is-ancestor master HEAD && echo "master is an ancestor: ok"
npm run typecheck && npm run lint
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage 2>&1 | tail -8
npm run roadmap:check
date "+%Y-%m-%d %Z"   # must read 2026-08-28 Pacific before u2
```

## Pointers
- Read first: root `CLAUDE.md` (§Live verification, §Fail loud), `docs/plans/03b-board.md`, `docs/rebuild/03b-finish-separations.md` (lines ~19–30 the 7-step loop; ~254 the 4537 registry row; ~380–416 sep-4/sep-5 open lines; ~540–560 Track A; ~680 T1b; ~736 the operator call; ~798–815 exit table + the three confirmation obligations), `docs/migrations/separations.md` §9.19 (the canary mapping) and §9.27 (the last live section — §9.28 follows its shape)
- Skills: `hr-manage` (bring BFF + worker up, start runs, gate approvals, UNKNOWN-submit rule), `hr-debug` (dry-run audit node by node, selector repair), `playwright-cli`
- Related handoffs: `docs/handoffs/2026-08-27-phase-3a-final-closed.md` (how 03a closed), `docs/handoffs/2026-08-26-phase-3a-final-supervisor.md`

## Suggested skills for the next session
- `/catchup` first, then `/supervise` with the u1–u5 list — the operator's prompt names it
- `/hr-manage` for every live run; `/hr-debug` for the submit-free audit in u1
