# Run plan — Phase 0.3 · Redesign single-source runtime authority — 2026-09-04

**Coordination UUID:** `31da5310-fb55-4982-ad02-05f4c9356d8b`
**Coordinator owner/channel:** `e79f35c0-69ba-4518-b9bc-f90299de24ab` (local)
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Worktree budget:** 4 auxiliary; each run allowance 2 (run worktree + one worker slot); one run active at a time.

| Run | Canonical supervisor title | Roadmap task | Theme | Units | Worker roles | Base | Worktree allowance | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Supervisor · phase-0-3-authority-design · C31da5310 · R01 · run-authority-design | 0.3 Task 1 `phase0-run-authority-design` | canonical run-record authority contract | U01 | sup-scout, sup-analyst, sup-opus | `26c70b9b` | 2 | 1 | no (operator: sequential) | — | design gate green in worktree; report verified; merged `--no-ff`; integrated gate green; worktree/branch/session closed |
| R02 | Supervisor · phase-0-3-authority-design · C31da5310 · R02 · settings-authority-design | 0.3 Task 2 `phase0-settings-authority-design` | settings catalog + protected root contract | U02 | sup-scout, sup-analyst, sup-opus | `da870d2d` | 2 | 2 | no | R01 closed | same |
| R03 | Supervisor · phase-0-3-authority-design · C31da5310 · R03 · migration-recovery-design | 0.3 Task 3 `phase0-authority-migration-design` | migration, compatibility, recovery | U03 | sup-scout, sup-analyst, sup-opus | R02 merge | 2 | 3 | no | R01 · R02 closed (roadmap `needs:`) | same |
| R04 | Supervisor · phase-0-3-authority-design · C31da5310 · R04 · authority-design-close | 0.3 Task 4 `phase0-authority-design-close` | adversarial close + implementation briefs | U04 | sup-analyst, sup-opus | R03 merge | 2 | 4 | no | R03 closed | same + every §0.3 checkbox evidenced |

## Units

### U01 — canonical run-record authority (roadmap Task 1, four `builds:` leaves)
- Scope: normative text in `docs/rebuild/reference/dashboard-surfaces.md` §D327 run authority (may
  add subsections; may cross-reference execution-and-sessions §3 / operator-trust §1 with pointers,
  not duplicated contracts); `decisions.md` pointers for any new decision; `00` §0.3 Task 1
  checkboxes; roadmap node `phase0-run-authority-design` (`builds:` ticks, `status:`, `log:`) and
  the parent `phase0-authority-reset` first `builds:` leaf; a dated lesson only if one was learned.
- Acceptance: the four Task 1 `builds:` leaves have normative text; design gate green; an adversarial
  review (concurrent claim, retry/relaunch identity, archive/purge/tombstone, evidence linkage)
  recorded in the report with each finding resolved in the spec or carried as named residue.
- Out of scope: settings (U02), migration/adapters (U03), 1.6 briefs (U04), any file under `src/`,
  `tests/`, `scripts/`, `config/`.

### U02 — settings catalog and protected root (Task 2) — briefed: `briefs/r02.md`.
### U03 — migration, compatibility, recovery (Task 3) — briefed after R02 closes.
### U04 — design close and implementation briefs (Task 4) — briefed after R03 closes.

## Launch ledger

| Run | Session id | Name (`-n`) | Launched | Worktree | Branch | Report | State |
|---|---|---|---|---|---|---|---|
| R01 | `d02757ca-9aad-4126-b564-bfed36cf2b4d` (short `d02757ca`) | Supervisor · phase-0-3-authority-design · C31da5310 · R01 · run-authority-design | 2026-09-04 via `claude --bg --permission-mode auto` from the run worktree (local: needs repo tooling; cloud cannot see the checkout) | `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-0-3-authority-design-c31da5310-r01-run-authority-design` | `feature/phase-0-3-authority-design-c31da5310-r01-run-authority-design` | `docs/coordinator/phase-0-3-authority-design-c31da5310/reports/r01.md` | closed — merged `1a04d565`, gate green, worktree removed + pruned, branch deleted (ref gone), session stopped 2026-09-04 |
| R02 | `3700aeea-2d56-47f2-9beb-4e2138cc0c7a` (short `3700aeea`) | Supervisor · phase-0-3-authority-design · C31da5310 · R02 · settings-authority-design | 2026-09-04 via `claude --bg --permission-mode auto` from the run worktree; base `da870d2d` | `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-0-3-authority-design-c31da5310-r02-settings-authority-design` | `feature/phase-0-3-authority-design-c31da5310-r02-settings-authority-design` | `docs/coordinator/phase-0-3-authority-design-c31da5310/reports/r02.md` | active |

## Integration and close

- Each report is verified against the roadmap, doc 00 §0.3, the owning spec, D308/D321/D322/D324/D327
  and its declared gate before merge. Merge `--no-ff` from a clean master checkout (temporary
  worktree if the root is dirty), run the integrated gate, then close the row.
- Phase 0.3 closes after R04; the coordinator then reconciles roadmap/00/decisions and issues 1.6.
