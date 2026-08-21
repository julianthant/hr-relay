# Handoff — the docs/roadmap cohesion pass is CLOSED; the operator's phase-by-phase review is next

**Date:** 2026-08-21 · **Plan:** `docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` (steps 1–6 ticked; §0 rulings Q1–Q5 + R6–R15; §3 the shelf, the mapping, the status block, the per-doc contract) · **Branch:** `master` (local; never push) · **Worktrees:** none · **Gate:** full `typecheck + lint + test:coverage` green at `135656d4`; docs-only commits since; `roadmap:check` fresh; the binding guard green at HEAD.

## What exists now (read these first in the new session)

- **`docs/roadmap/roadmap.md`** — the tree source AND the summary of the whole rebuild (governance prose after `roadmap:end`). Rendered `docs/roadmap/index.html`; hosted at `https://claude.ai/code/artifact/8e678086-ab5f-44c0-8fdb-f04986fb95ff` (republished at close).
- **`docs/rebuild/`** — ONLY actionable phase docs, number = phase, name = what gets done: `00-design-the-foundation` · `01-build-the-spine` · `02-prove-writes-build-the-tails` · `03a-finish-the-dashboard` · `03b-finish-separations` · `03c-migrate-the-remaining-workflows` · `03d-co-operate-with-claude` · `04-close-the-deferrals` · `05-cut-over` · `06-ship-the-desktop-app`. Each: Phase summary → one section per tree node (tag + filled status block) → Decisions this phase ratified → Exit criteria (MET/open). These ARE the operator's review targets.
- **`docs/rebuild/reference/`** — the specs, rewritten as-built against the code, with status blocks: charter (§1–§27 numbered) · decisions (the D-ledger, `_phase:_` markers) · task-contract · workflow-model · execution-and-sessions (§10 Duo lease, §11 sessions/pool) · write-safety · clock-config-secrets · guards-and-tests (§10 = the R10 testing spec) · dashboard-surfaces (§9 per wire square) · frontend-backend-integration (§5.1.x per square) · operator-trust · data-intake-and-edit-data · foundation-gap-audit (frozen) · stores (derived).
- **`docs/rebuild/history/`** — `doc-reviews/` · `design-inputs/` · `superseded/` (incl. the dissolved master plan), dated, indexed by README.
- **The notation** (`.claude/skills/custom-update-plan/SKILL.md`): `doc:` refs (`NN §x` / `ref:<slug> §x`), `log:` blocks, `## session:` markers, doc-side status blocks rendered in the drawer; the `session` class is how a session ends. Guard: `tests/unit/architecture/roadmap-doc-binding.test.ts`.

## What the operator does next (in the new session)

1. **Review each phase doc** for completeness — open `03a` first. Its `## Demo fidelity — every detail, region by region` section + `{#track-f}` (`status: you`) carry **~150 OPEN questions** from the three ledgers (`docs/plans/2026-08-21-03a-fidelity-{1,2,3}-*.md`): each becomes ported, or a recorded divergence with its argument. Nothing was dismissed.
2. Decide the order of the code units now on the tree: Track D D1–D5 + D11 (`{#track-d}`), `{#duo-lease}` (R12 — the hazard exists today), `{#parallel-runs}` (R11), `{#observed-logs}`, `{#test-tiers}` 5.2b–5.2d (the tests reorganization, the subject registry, the durable dry-run results), `{#claude-operator}` (R15 — MCP server, two-actor rule), `{#desktop-app}` (R14), and the `[!]` lines the rewrites surfaced (e.g. the ledger writer is composed by nothing; `mergeSettings` drops `override.browser`; a real EID is hardcoded in seven tracked files — scrub before any first push).
3. Separations: the three controlled commits wait for the 08-28 canary (`03b` exit 8/9).

## Rules that held this pass (keep them)

- Orchestrator + narrow Opus units (≤ 350k tokens); Fable 5 high for units needing more attention; worktrees for parallel units; the orchestrator never commits on `master` while a unit works there (shared index); docs units run the light gate (`roadmap:check` + the binding guard + typecheck + lint), the orchestrator runs the full suite at merge; units commit per section (the laptop sleeps and kills agents — resume via SendMessage, safety-commit their worktree if needed).
- `[x]` only for what is landed at HEAD with its commit/D cited; the tree never invents scope; a decision lands in its owning reference doc in the same commit; `reference/decisions.md` is append-only.

## Verification before resuming

```bash
git status && git worktree list && git log --oneline -5
npm run roadmap:check                                             # fresh
npx vitest run tests/unit/architecture/roadmap-doc-binding.test.ts
npm run typecheck && npm run lint && npm run test:coverage       # the per-commit gate (D191)
```
