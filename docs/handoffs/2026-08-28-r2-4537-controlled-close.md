# Supervisor brief — R2 · 4537 controlled close

## Launch authority

- Coordinator base: `660f6ebf24d9efa26fa0ca62e36eca3c11685719` on `integration/03b`.
- Workspace: `/Users/julianhein/Projects/hr-automation-rebuild`.
- Plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/2026-08-27-03b-runs.md`.
- Board: `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/03b-board.md`.
- Board write authority: the R2 supervisor may update that exact board only during final close-out.
- Decisions: D284, D286 and D287 in `docs/rebuild/reference/decisions.md`; normative authority is
  `docs/rebuild/03b-finish-separations.md`.
- Prior evidence: `docs/handoffs/2026-08-28-r2-u1r-4537-single-subject-report.md` and
  `docs/handoffs/2026-08-28-r2-u1p-parity-refreeze-report.md`.

## Outcome

Close Phase 3b Track A on the sole subject `finalization-canary` / Kuali doc 4537. First provision
and smoke the strict name/EID secret references without printing their values. Then prove one fresh
composed `separations` rehearsal with `dryRun=true`, every expected node/receipt obligation, and
exact-run write evidence `write_intents=0`, `write_attempts=0`, `durable_outbox=0`. Only after that
proof, execute the D287 sequence ② UCPath termination → ① immediate Kuali reread → ③ Kuali
finalization.

Each real write retains its own operator-visible ALWAYS-GATE. The supervisor must stop and surface
that task's gate for the operator; this brief does not pre-approve a gate. An `UNKNOWN` submit is a
hard stop and is never retried. No substitute subject is permitted.

## Supervised units

1. `sup_sol_r2_secret_authority` — implement D286's strict secret references, config validation,
   tests and nearest `AGENTS.md`/authority documentation. Budget 240k/220k, high reasoning.
2. `sup_terra_r2_secret_smoke` — provision and smoke the local 4537 EID/name references and perform
   the read-only three-system admission checks. Never print, persist or interpolate a secret value.
   Budget 240k/220k, high reasoning. Depends on unit 1.
3. `sup_terra_r2_rehearsal` — run the fresh composed dry-run, drain the exact worker, explain the
   exact run, verify all expected nodes/receipt obligations and exact-run 0/0/0 write evidence.
   Budget 240k/220k, high reasoning. Depends on unit 2.
4. `sup_sol_r2_ucpath_commit` — execute ② through its own ALWAYS-GATE and durable write-safety
   evidence. Budget 240k/220k, high reasoning. Depends on unit 3 and operator gate approval.
5. `sup_terra_r2_immediate_reread` — execute ① immediately after ②, without changing the tree or
   substituting a cached/latest value. Budget 240k/220k, high reasoning. Depends on unit 4.
6. `sup_sol_r2_kuali_finalize` — execute ③ through its own ALWAYS-GATE, using only the verified
   receipt pair. Budget 240k/220k, high reasoning. Depends on unit 5 and operator gate approval.
7. `sup_sol_r2_close_review` — independently reconcile exact durable evidence, run the full D191
   gate, update owning docs/board, and write the final report. Budget 240k/220k, high reasoning.

Use only the repository's allowed native supervised roles; every visible task name must begin with
the exact role. One seam per unit, with correctness, silent-failure, test and security/privacy review
where relevant. Commit each logical unit locally, merge isolated feature branches with `--no-ff`,
verify a clean tree, and run `/worktree-sweep` after integration. Never push.

## Guardrails and feedback loops

- Live verification is pre-authorized; Duo Autopilot is unattended. Use `playwright-cli`, never a
  Chrome MCP, and close/sweep every browser session.
- The tree and resolved input remain frozen from ② through ③. Run ① immediately after ②. No
  `reRead`, fallback selector/value, alternative subject, free-form EID, or cached/latest lookup.
- Respect 4-hour replay freshness before spending the rehearsal. A freshness refusal requires a new
  reviewed run plan, not an override.
- If 4537 is absent or materially changed, mark it unavailable and stop. Do not replace it.
- Before every commit: `npm run typecheck`, `npm run lint`, `npm run test:coverage`,
  `npm run build:manifest` with no diff, and `npm run roadmap:check`; run `npm run test:parity` for
  any dashboard-visible change.
- The final report belongs at
  `/Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-4537-controlled-close-report.md`
  and must include per-unit commits, exact run/trace ids, gate decisions, receipt/write evidence,
  gate outputs, reviews, browser cleanup and unresolved residue without secret values.

## Non-goals

Do not implement dashboard reporting, migrate another workflow, rewrite immutable evidence, weaken
a refusal, alter the production legacy repository, delete retained worktrees, or push any branch.
