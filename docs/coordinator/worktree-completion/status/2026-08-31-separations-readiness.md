# Status — Separations readiness — 2026-08-31 (HEAD 8084c87d)

_Plan source: `docs/rebuild/03b-finish-separations.md` and
`docs/migrations/separations.md`. Verified against: final Phase 3b gate receipts, Git history and
worktree inventory, and `npm run cli -- phase` after local secure-environment admission repair._

## 1 · Complete

| item | evidence | since |
|---|---|---|
| Phase 3b software integration is on `master` | merge `367483a6`; closeout report `reports/2026-08-31-phase-3b-master-integration-cleanup.md` | 2026-08-31 |
| Full source/architecture/scenario suite is green | 378 files and 4,742/4,742 tests; 85.38% statements and 87.34% lines | 2026-08-31 |
| Visual and accessibility parity is asserted | 301/301 assert-only parity cases | 2026-08-31 |
| Typecheck, zero-warning lint, build manifest and roadmap are green | final master gate table in the closeout report | 2026-08-31 |
| Eight of the nine Separations exit criteria are met | `docs/rebuild/03b-finish-separations.md` §Exit criteria | current HEAD |
| Secure local CLI admission now succeeds | `.env` tightened from 0644 to 0600; line 38's unquoted `=` value safely quoted; `npm run cli -- phase` returned normally | 2026-08-31 |

## 2 · Drift — where the as-built differs from the plan

| plan said | reality | kind | consequence |
|---|---|---|---|
| A merged Phase 3b candidate still needs controlled-commit evidence before rebuild-ready | Exactly that criterion remains open; no controlled Separations write has run | none — plan and reality agree | The workflow is software-complete but not approved as rebuild-ready or production-ready |
| The runtime should report the current program phase | Runtime reports `completedThrough: 2j` and `active: 3-workflow-migration` | none — plan and reality agree | Phase 3b has not advanced the runtime completion authority |
| Local runtime admission should use the secure environment bootstrap | The first check refused 0644 permissions, then refused an unquoted value containing `=`; both local configuration defects were repaired without exposing values | done-differently | The CLI is now usable, but this does not supply live rehearsal or write evidence |

## 3 · Next

1. Reverify the sole canary (`finalization-canary`, Kuali document 4537) and current S7 state read-only; stop if it is absent or materially changed.
2. Run one fresh composed `dryRun=true` rehearsal and prove that the exact run reached its preview terminal with `write_intents`, `write_attempts`, and `durable_outbox` all 0/0/0.
3. Only after that green receipt, conduct the controlled sequence ② UCPath filing → immediate ① pending sweep → ③ Kuali finalization, with a separate operator-visible ALWAYS-GATE approval for each write and no retry after an UNKNOWN submit.
4. Record the payload/window/probe obligations that only the controlled commits can prove, then close A8 and advance the runtime phase authority.

## 4 · Needs you

No decision is needed for the next safe step: read-only re-verification and the fresh dry-run rehearsal are already authorized. If that rehearsal is green, each of the three real writes will still require its own explicit ALWAYS-GATE approval; none is pre-approved by the merge or this report.
