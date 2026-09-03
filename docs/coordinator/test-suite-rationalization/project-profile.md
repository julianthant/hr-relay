# Project profile — test-suite rationalization

**Repository:** `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild/docs/coordinator/test-suite-rationalization`
**Verified:** 2026-09-02 15:55 PDT at `12ae781b3e00e713cd09c65a038c0febe5a35561` on isolated branch `feature/test-suite-rationalization`

## Applicable instructions

- `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild/AGENTS.md` and byte-identical `CLAUDE.md` — repository-wide rules, authorities, gates, fail-loud policy, and orchestration.
- `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild/tests/scenario/AGENTS.md` and byte-identical `CLAUDE.md` — current scenario kinds, naming, and coverage-claim rules.
- Any nearer paired instruction files in a run's owned subtree; each supervisor must discover and obey them before editing.
- Global `coordinator`, `supervise`, `review`, `tdd`, `ui`, and `worktree-sweep` skills only when their trigger applies. This coordinator owns the board and branch integration; supervisors own implementation fan-out.

## Canonical authorities

- **Plan/status:** `docs/roadmap/roadmap.md`; current actionable Phase 3 docs `docs/rebuild/03a-finish-the-dashboard.md`, `03b-finish-separations.md`, `03c-migrate-the-remaining-workflows.md`, and `03d-co-operate-with-claude.md` only where test truth changes.
- **Primary test contract:** `docs/rebuild/reference/guards-and-tests.md`, especially §§3.14, 5–10.12.
- **Adjacent contracts:** `docs/rebuild/reference/{task-contract,workflow-model,dashboard-surfaces,execution-and-sessions,write-safety,frontend-backend-integration,operator-trust}.md`.
- **Decisions:** `docs/rebuild/reference/decisions.md` is a pointer index only; normative decisions must land in their owning document in the same commit.
- **Rules/lessons:** root instruction twins, scenario instruction twins, and `docs/rebuild/reference/lessons.md`.
- **Executable authorities:** `docs/rebuild/guard-inventory.json`, `package.json`, `vitest.config.ts`, `playwright.parity.config.ts`, `tsconfig.json`, ESLint configuration, `scripts/suite-size.ts`, generated-manifest and roadmap generators.
- **Other close targets:** `docs/roadmap/index.html`, `src/domain/workflow/generated-build-manifest.ts`, and only the authorities above whose truth actually changes.

## Acceptance doctrine

A retained test must name one unique risk or contract, prove a failure mode that a cheaper layer cannot already prove, and have red-capable negative-control or equivalent evidence. Deletion or consolidation requires a durable equivalence record: exact duplicate contract/risk, retained owner, the command that proves the retained test goes red when the behavior is broken, or proof that the removed test cannot fail under a relevant negative mutation. File names must predict behavior; `describe`/`it` titles must state behavior and the refusal/failure condition. Synthetic/offline/live evidence must never be conflated.

The objective is not fewer files or fewer cases. Preserve safety, write-authority, fail-loud, architecture, coverage, live-proof, UI parity, and path-sensitive scenario guarantees. Lowering a threshold, widening an exclusion, deleting a unique guard, regenerating parity baselines to hide a mismatch, or converting a real refusal into a mock-only assertion is an operator decision, not a supervisor convenience.

Test output is an operator surface. Every test command must identify the project/suite, file, and full behavior/refusal title as work runs; long or genuinely multi-stage harnesses must expose stable, named phases so a failure identifies the exact operation rather than only a dot, file, or generic timeout. Short unit tests do not log every assertion. Use one streaming reporter, retain file/test parallelism and isolation, and measure reporter overhead rather than trading execution speed for duplicate output. Failure output must include actionable non-secret context and one unambiguous cause. Expected diagnostics belong in captured assertions, while unexpected warnings, duplicate progress, raw unscoped stacks, leaked-process noise, and secret values are defects—not output to suppress globally.

## Gates

- **Per-run:** exact focused tests for every changed seam; `npm run typecheck`; `npm run lint`; applicable targeted Vitest/Playwright/generated checks; `git diff --check`. Test invocations must use the most explicit available progress reporter until the repository scripts themselves enforce labeled output.
- **Integrated:** `npm run typecheck`; `npm run lint`; `npm run test:coverage`; `npm run test:architecture`; `npm run test:parity`; `npm run build:manifest:check`; `npm run roadmap:check`; `git diff --check`.
- **Self-containment close gate:** all integrated commands above must run from a clean isolated worktree with no legacy checkout environment override. The legacy repository may be read only during porting/reference research, never required by the finished lint/type/test/architecture gates.
- **Hermeticity close gate:** the full Vitest/coverage gate must pass while another legitimate rebuild dashboard continues to own reserved ports 3938/5174. Tests must use isolated state and ephemeral/owned ports rather than require the operator runtime to stop.
- **Documentation/generated checks:** `npm run build:manifest:check`, `npm run roadmap:check`, byte-identical instruction twins, guard inventory ↔ architecture file correspondence, exact project/script membership, and regenerated outputs only through their owning commands.

## Git and integration policy

- **Branch/current line:** coordinator integrates on local `feature/test-suite-rationalization`, created from current `feature/03b-live-close` tip `12ae781b`; the supplied `b3d75578` snapshot is one docs-only commit behind current intake.
- **Parallel isolation:** each run uses its own Codex worktree and `feature/test-r<n>-<theme>` branch from the latest declared base. No supervisor edits the coordinator branch or another run's branch.
- **Integration:** coordinator verifies and merges accepted run branches `--no-ff` in run-plan order, then runs the boundary gate. No supervisor merges into the integration target.
- **Commit and cleanup:** logical local commits; stage explicit paths only; never `git add -A` or `git add .`; preserve unrelated work. Coordinator removes integrated run worktrees/branches only after verification and finishes with `/worktree-sweep` audit.
- **Remote writes:** forbidden unless the operator explicitly authorizes a push. This project has no such authorization.

## Operations and constraints

- **Pre-authorized:** read-only repository inspection; local tests/builds; temporary negative mutations reverted before commit; local headless parity browsers; read-only consultation of `/Users/julianhein/Projects/hr-automation` solely to copy/freeze provenance into this repository.
- **Requires operator authority:** product-truth or scope changes; weakening coverage/guard/parity guarantees; deleting a unique invariant with no equivalent replacement; history-moving git; remote push; any real HR-system write or live workflow run beyond the existing standing dry-run rules.
- **Hard prohibitions:** no runtime or final gate dependency on the legacy checkout; no silent fallback; no secret values in evidence; no parity baseline refresh merely to make a failure green; no shared-board edits outside this coordinator; no stale test kept solely to preserve count.
- **Environment:** this isolated worktree borrows installed dependencies only as local tooling. No dependency link is committed. Supervisors must make their worktrees runnable without changing repository dependency declarations unless their run proves such a declaration is wrong.

## Coordinator defaults

- **Run sizing:** 3–6 single-seam units, six maximum here; one test-family theme per run. Three-unit follow-on runs are permitted where dependency-safe splitting enables the four-worktree Wave 2.
- **Parallel supervisors:** two in Wave 1; after R1 and R6 integrate cleanly, use four isolated supervisor worktrees where scopes do not overlap. Serialize CPU-heavy full coverage and parity gates.
- **Artifact root override:** none; use `docs/coordinator/test-suite-rationalization/`.
- **Final close:** update only declared authorities whose truth changed, retain the workspace, close the board with verified commit/gate pointers, and leave no run worktree or integrated feature branch behind.
