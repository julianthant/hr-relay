# Board — current-workflow dashboard completion

**Integration branch:** `integration/03b` · **Base:** `f89301df`
**Board owner:** coordinator
**Write rule:** coordinator only; parallel supervisors write only their run-specific boards
**Last verified:** 2026-08-28 at `f89301df`

## Facts every run needs
- Plan SSOT: `docs/rebuild/03a-finish-the-dashboard.md` demo-fidelity residue · `docs/rebuild/04-close-the-deferrals.md` dashboard deferrals · `docs/rebuild/03c-migrate-the-remaining-workflows.md` §Cross-cutting Phase 3 capabilities.
- Scope ruling: D282 activates dashboard completion; D283 limits this program to separations and cross-cutting authority already present. OCR Review, Group People, capture→workflow binding and later-workflow producers are out.
- Gate: `npm run typecheck` · `npm run lint` · `/usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 npm run test:coverage` · `/usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock npm run test:parity` · `npm run roadmap:check`; run `npm run build:manifest` after any descriptor-closure edit.
- Project rules: root `AGENTS.md`; `src/dashboard/AGENTS.md`; frontend implementation must invoke `/ui`; browser proof uses `playwright-cli`, never Chrome/DevTools.
- Root runtime: BFF PID 14088 listens on 3938; no Vite listener on 5174 at intake. It belongs to the root current-workflow session—parallel tasks must not stop, replace or mutate it.
- Parallel ownership: each supervisor starts from `f89301df` in its Codex-created worktree, merges its own unit branches into that task branch, and never checks out or merges `integration/03b`. The coordinator verifies and merges returned run branches serially.
- Dated trap: concurrent full coverage timed out child-spawning files on 2026-08-27; the shared `lockf` command above serializes only the expensive lanes while implementation remains parallel.

## Decisions ratified
- 2026-08-28 · operator context in `docs/decisions/dashboard.md` §D282–D283 → D282: keep Activity `Unread`; authorize strict storage reconciliation; activate dashboard-owned deferrals.
- 2026-08-28 · operator clarification → D283: complete current-workflow/cross-cutting work now; later workflow producers stay in Phase 3c.
- Standing: D272–D276 demo fidelity · D278 intake/capture column · D279 carried residue · D281 demo-uncovered elements.

## Unit ledger
| Unit | Run | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| DCF1–DCF6 | R-DCF | briefed | — | — | required | demo-fidelity residue C1–C4 |
| DCC1–DCC6 | R-DCC | briefed | — | — | required | settings, preflight/doctor, safe Explorer edit |
| DCR1 · DCR3–DCR6 | R-DCR | briefed | — | — | required | Activity, search, export, rerun diff |
| DCA1–DCA5 | R-DCA | planned | — | — | required | starts only after R-DCF integration |
| DCT1–DCT6 | R-DCT | briefed | — | — | required | retire mobile document capture; preserve diagnostic/run evidence captures |
| DDM1–DDM6 | R-DDM | dependency-held | — | — | required | real `/demo` path for current Kuali separation scenarios; starts after R-DCT integration |

## Residue
- Mobile document capture, its phone bundle, capture-session authority and its planned OCR binding are retired by operator direction in R-DCT. Generic diagnostic screenshots and run evidence remain.
- Review and People panel bodies → their first real OCR/group producers in Phase 3c; never fixture-only production arms.
- `/demo` remains dependency-held until R-DCT is merged because both runs own dashboard entry/routing and plan authority.

## Questions for the operator
- None. D282 and D283 clear current scope; supervisors must return any genuinely new product decision rather than choosing it.
