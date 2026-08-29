# Supervisor brief — R-DCR · reporting authority close

## Launch authority

- Coordinator base: `660f6ebf24d9efa26fa0ca62e36eca3c11685719` on `integration/03b`.
- Prepared run branch: `codex/r-dcr-reporting-search` at `1a683c83`; merge it into the supervisor
  worktree with `--no-ff` before new implementation and resolve by current authority, preserving
  both the prepared decision sheet and the coordinator's D288/D289 answers.
- Workspace: `/Users/julianhein/Projects/hr-automation-rebuild`.
- Plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/2026-08-28-dashboard-completion-runs.md`.
- Board: `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-reporting-board.md`.
- Board write authority: the R-DCR supervisor may update that exact board once, during final
  close-out only.
- Decisions: D282, D283, D288 and D289 in `docs/rebuild/reference/decisions.md`; primary authority is
  `docs/rebuild/reference/dashboard-surfaces.md` and `docs/rebuild/reference/operator-trust.md`.

## Outcome

Receive the already reviewed DCR3 cross-date search, DCR4 Separations search UI, DCR5 evidenced XLSX
export and prepared DCR1 Activity work from `codex/r-dcr-reporting-search`; then close the two held
authority seams:

1. DCR1 under D288 — insert-only secret-keyed, generation-bound pseudonym evidence and reviewed
   current-Separations backfill, with honest unavailable arms for missing/ambiguous/mixed/incomplete
   evidence.
2. DCR6 under D289 — a closed Separations fact registry and strict prior/current receipt comparison
   with `added`, `removed`, `changed` and `withheld` arms.

The result must serve the current corpus without exposing full identifiers, suffixes, enumerable
unkeyed digests, sensitive HR values, or secret material. OCR and later-workflow facts stay out.

## Supervised units

1. `sup_sol_dcr_receive` — merge and verify `codex/r-dcr-reporting-search`, resolve conflicts against
   D284–D289/current root authority, and prove the received DCR3–DCR5 seams. Budget 240k/220k, high
   reasoning.
2. `sup_analyst_dcr_identity_design` — map current canonical subject bindings, receipt schemas,
   migration/storage boundaries and privacy threats; return a falsifiable implementation contract
   for D288/D289 without editing. Budget 200k/180k, high reasoning. May run in parallel with unit 1.
3. `sup_sol_dcr_pseudonym_authority` — implement the dedicated secret domain, recursively strict
   schema/migration/repository, insert-only replay semantics, generation rules and reviewed backfill
   command/report. Budget 240k/220k, high reasoning. Depends on units 1–2.
4. `sup_terra_dcr_activity_people` — wire D288 into the one Activity projection and UI, preserving
   the `Unread` axis and honest availability reasons. Use `/ui` and browser/parity proof. Budget
   240k/220k, high reasoning. Depends on unit 3.
5. `sup_sol_dcr_comparison_authority` — implement D289's closed registry, exact `retryOf` +
   workflow/item/receipt identity checks, strict wire/query, and disclosure-aware comparison.
   Budget 240k/220k, high reasoning. Depends on units 1–2.
6. `sup_terra_dcr_comparison_ui` — render the four comparison arms in run detail with keyboard,
   responsive, empty/loading/refusal and privacy proof. Use `/ui`. Budget 240k/220k, high reasoning.
   Depends on unit 5.
7. `sup_sol_dcr_close_review` — independent correctness, silent-failure, tests, security/privacy,
   performance and UI review; full integration gate; owning docs and close-only board update; final
   report. Budget 240k/220k, high reasoning. Depends on units 3–6.

Use only the repository's allowed native supervised roles; every visible task name must begin with
the exact role. One seam per unit. Commit each logical unit locally, merge isolated feature branches
with `--no-ff`, verify a clean tree, and run `/worktree-sweep` after integration. Never push.

## Acceptance and feedback loops

- D288 rows are unique per `(runId,keyGeneration)`, divergent replay refuses, rotation never
  rewrites history, and backfill accepts only one exact canonical binding per run.
- The Activity range never combines incompatible generations or silently shrinks its corpus.
- D289 registry declarations bind stable id/label/disclosure to exact collection/source/task/node/
  field paths. Missing/duplicate registry or receipt matches and foreign/mismatched `retryOf` refuse.
- Only reviewed `safe-diagnostic/allow` values cross; sensitive/direct/suffix/digest values render as
  `withheld` without implying equal or absent.
- Update nearest tests and `AGENTS.md` for every changed feature. Run red-capable focused tests, then
  `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build:manifest` with no diff,
  `npm run test:parity`, and `npm run roadmap:check`.
- Use `/ui` for every frontend change and `playwright-cli` for rendered verification. Close and
  sweep all browser sessions.
- The final report belongs at
  `/Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r-dcr-authority-close-report.md`
  and must include the receive merge, per-unit commits, migrations/backfill evidence, privacy proof,
  focused/full gates, screenshots, reviews, board close pointers and remaining residue.

## Non-goals

Do not add OCR/Group People/later-workflow producers, search artifact bytes, merge DCA work, execute
an HR transaction, mutate an immutable receipt, weaken strict boundaries, delete retained worktrees,
or push any branch.
