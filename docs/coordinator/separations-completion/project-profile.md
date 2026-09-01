# Project profile — separations completion (03b criterion 5 close)

**Repository:** /Users/julianhein/Projects/hr-automation-rebuild
**Coordination workspace:** /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion
**Verified:** 2026-08-31 at master `50adf8a9`, clean, sole worktree, `.env` present in this checkout.

Bounded scope: discharge doc 03b exit criterion 5 (Track A items A2–A5 and A8) so separations is
9/9 and **rebuild-ready**. Nothing else. Predecessor workspace
`docs/coordinator/worktree-completion/` is CLOSED (Phase 3b integrated to master `367483a6`);
its live-admission residue is exactly this scope.

## Applicable instructions
- /Users/julianhein/.claude/CLAUDE.md and the repo root CLAUDE.md (fail-loud, live pre-authorization,
  gates, conventions). Supervisor invokes `/supervise`; hr-manage / hr-debug skills as needed.

## Canonical authorities
- Plan/status: docs/rebuild/03b-finish-separations.md (Track A, §Exit criteria);
  docs/migrations/separations.md (STATUS header, §6 checklist, §9.x record — new observations land
  as §9.33+).
- Specs/contracts: ref write-safety (ALWAYS-GATE, intents), ref workflow-model, ref
  clock-config-secrets, ref operator-trust; decisions.md is a pointer index only.
- Governing decisions: D284 (4537 sole subject), D287 (rehearsal-then-controlled-sequence),
  D207/D215/D217 (obligations only the commits discharge), D293 (Run modal as-built).
- Rules/lessons: docs/rebuild/reference/lessons.md; §9.32 (assigned-runtime admission refusal).

## Gates
- Unit/integrated: `npm run typecheck && npm run lint && npm run test:coverage` (D191),
  `npm run build:manifest` clean, `npm run test:parity`, `npm run roadmap:check`, `git diff --check`.
- Single checkout: no cross-supervisor gate locks needed this run.

## Git and integration policy
- Work IN the primary checkout (it alone owns `.env`, `.tracker-rebuild`, `.auth`, Duo Autopilot).
- Commit on branch `feature/03b-live-close` by logical category; merge `--no-ff` into `master`
  after the integrated gate table is green. Local commits only. **Never push.**
- Never `git add -A`; stage explicit paths. Other sessions share this tree.

## Operations and constraints
- Pre-authorized (root CLAUDE.md): live access, Duo Autopilot, selector snapshots, login smoke,
  composed `dryRun=true` rehearsal. Never ask whether live is up.
- Requires operator authority, per write: each of ②/①/③ has its own ALWAYS-GATE approval taken by
  the operator (dashboard gate). The supervisor requests, waits, never self-approves.
- Hard prohibitions: no write without its gate; no `reRead` after ②; UNKNOWN stops WITHOUT retry
  and an UNKNOWN submit is never re-run; 4537 is the only subject; never fake the date — S7 and
  subject facts come from the real clock and a fresh live read; no reference-corpus regeneration to
  hide drift; close/sweep all browsers at stop.
- If the fresh read finds 4537 absent or materially changed: STOP, report — operator decision.

## Coordinator defaults
- Run sizing: one run, 5 units (live-proof-heavy → small run).
- Final close: update only 03b, migrations/separations.md, roadmap (regenerate), decisions pointer
  if a decision is minted, nearest CLAUDE.md if a lesson lands.
