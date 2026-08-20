# Plan — the roadmap moves into `docs/rebuild/`, and the rebuild docs are rewritten to mirror the tree

**Date:** 2026-08-20 · **Brief:** `docs/handoffs/2026-08-20-rebuild-docs-roadmap-cohesion.md` · **Orchestrator:** this session (Fable), Opus subagents ≤ 350k tokens each, one narrow unit per dispatch.

This plan is itself interactive: every step carries a checkbox the executing agent ticks, and a `log:` line naming the session and the commit. Tick only what is landed at HEAD.

## 0 · Rulings (operator, 2026-08-20 — settled, do not re-open)

| # | Question | Ruling |
|---|---|---|
| Q1 | Root `ROADMAP.md` after the move | **Deleted.** `docs/rebuild/14-roadmap.md` is the only roadmap. Appendices travel with it in step 1 and fold out in step 4. |
| Q2 | Doc ↔ tree binding | **`doc:` attribute on every node** (rendered in the drawer) + **`<!-- roadmap: <id> -->` tags** on doc sections + **a two-way guard** in `tests/unit/architecture/` registered in `guard-inventory.json`. |
| Q3 | Doc 07 vs the tree | **Doc 07 stays normative.** The guard catches disagreement; a human fixes the tree. |
| Q4 | Track D | **Ratified** under `{#dash-defaults}` after Track C. **D1–D5 `planned`**, D6–D10 stay `proposed` with the trigger "before the second migration's `Dashboard · wire` task starts". **§3.5: `WORKFLOW_DESCRIPTORS` moves OUT of the bundle to bootstrap** — filed as Track D row **D11** (amends D251 / doc 13 §4); code work, not done in this docs pass. |
| Q5 | Superseded narrative | Goes to **`docs/rebuild/reviews/`** (dated, named by source doc + section). Nothing is deleted. |
| — | Session-end interactivity | The notation gains a **`log:` block per node** (`- YYYY-MM-DD \| <session> \| what landed (commit)`, rendered newest-first in the drawer) and a **`## session:` spine marker**; **`/custom-update-plan` is extended** with a `session` class (tick `builds:` boxes → append `log:` lines → bump `asOf`/`head`/`today` → regenerate → commit). No new skill. |

## 1 · Standing constraints (from `CLAUDE.md` and the brief — the agents' contract)

- `docs/rebuild/` is the plan SSOT; every existing file stays at its exact path. 07 owns phases/exit criteria; 04 is a pointer index (D1–D261 at HEAD; **D131 retired — never reuse**; re-read 04's tail at HEAD before minting, sibling sessions collide on numbers).
- A decision is ratified only when its normative text lands in the owning doc **in the same commit** that records it; 04 gets one line.
- `guard-inventory.json` ↔ `tests/unit/architecture/` must match both directions; a new guard lands with its inventory entry in one commit.
- Tree rules: every `builds:` line carries a layer tag (FE · BE · BOTH · WIRE · DOCS · PROOF); `[x]` only for what is landed at HEAD with the commit/decision cited; `you:` → `you(met):` only on the operator's explicit answer; ids are stable anchors, never renamed; the tree never invents scope — unplanned features go to `docs/findings/`.
- D252 rule for the rewrite: **"done" is verified against the code, never against the earlier prose.**
- Gate before every commit: `npm run typecheck && npm run lint && npm run test:coverage` (D191); plus `npm run roadmap:check`. Never push. Never `git add -A`. Stage your hunks only.
- A sibling session's worktree (`.hr-rebuild-worktrees/gate-notify`, branch `feature/task-gate-notify`) is live and will land a commit that flips `{#sep-dash}`'s `[ ] WIRE notifications` line — do not touch it; rebase the plan on it when it lands.
- Execution modes follow the global CLAUDE.md: sequential units on master; parallel units in worktrees (`feature/docs-NN`), orchestrator merges `--no-ff` in dispatch order and removes every worktree after merge.

## 2 · Steps

### Step 1 — relocate the source (sequential, master) `[x]`
_log: `0990ebc5` · step-1 agent 2026-08-20 — whole file moved (region + appendices); generator, `CLAUDE.md`, the skill and the site repointed; root `ROADMAP.md` deleted per Q1._
- `git mv ROADMAP.md docs/rebuild/14-roadmap.md` (whole file, region + appendices — the appendices fold out in step 4).
- `scripts/generate-roadmap.ts`: `SOURCE` → `docs/rebuild/14-roadmap.md`; every `ROADMAP.md` mention in its doc comment and error strings becomes the new path.
- `14-roadmap.md` header: `eyebrow:`/`footer:`/`source:` lines name the new path; the first comment line names the skill.
- `CLAUDE.md`: "What lives where" row (`ROADMAP.md` → `docs/rebuild/14-roadmap.md`), the Commands block comment, the "Before you start" list gains 14. `src/dashboard/CLAUDE.md` only if it mentions `ROADMAP.md`.
- `.claude/skills/custom-update-plan/SKILL.md`: every `ROADMAP.md` mention → the new path.
- Memory `~/.claude/projects/-Users-julianhein-Projects-hr-automation-rebuild/memory/roadmap-site.md`: paths updated (the orchestrator does this one).
- `npm run roadmap && npm run roadmap:check` fresh; full gate green. One commit: `docs(roadmap): the plan moves into docs/rebuild/14-roadmap.md`.

### Step 2 — extend the notation + the skill (sequential, master) `[ ]`
- `parsePlan` extracted from `scripts/generate-roadmap.ts` into an importable module (e.g. `scripts/roadmap/parse-plan.ts`) with no top-level side effects so a guard can import it; the generator imports it back.
- New attributes: `doc:` (repeatable or `·`-joined refs of the form `NN §x.y`; rendered in the drawer header), `log:` block (lines `- YYYY-MM-DD | session | text`; rendered newest-first in the drawer as "Session log"), `## session:` spine marker (a dated session milestone, rendered like `## flag:`). Zod schema + renderer + `--json` output extended; fail-loud per line preserved.
- `/custom-update-plan` SKILL.md: notation reference gains the three shapes; a **`session` change class** with the end-of-session procedure (tick boxes → `log:` lines on the nodes touched → `## session:` marker → bump `asOf`/`head`/`today` → regenerate → check → commit → republish); the per-doc binding rule (`doc:` on every node, `<!-- roadmap: id -->` on every section that describes a node).
- Decision **D263** (number = next free at HEAD — D262 was taken by the sibling gate-notify merge; owner doc 07 §0.1 "one-plan rule"): "`docs/rebuild/14-roadmap.md`, in the roadmap notation, is the plan's machine-readable form and the operator tracking view; doc 07 wins on any disagreement; every node cites its owning doc sections (`doc:`) and every doc section describing a node carries `<!-- roadmap: id -->`; session work is recorded in `log:` blocks." 04 gets one pointer line. Number to be confirmed against 04's tail at HEAD.
- Commits: `feat(roadmap): doc: · log: · session: — the notation grows its binding and its session log`, then `docs(07): D263 — the roadmap is the plan's machine-readable form` (+ skill in either).

### Step 3 — the two-way binding guard (sequential, master, after step 2) `[ ]`
- `tests/unit/architecture/roadmap-doc-binding.test.ts` + `guard-inventory.json` entry in one commit. Arms: (a) every `doc:` ref on every node resolves to an existing `docs/rebuild/NN-*.md` heading whose section number matches; (b) every `<!-- roadmap: <id> -->` tag in `docs/rebuild/*.md` names a node id that exists in `14-roadmap.md`; (c) every node that is not a phase carries at least one `doc:` ref (phases may cite 07 §2 only); (d) every `builds:` line carries a layer tag (belt-and-braces with the parser). Executed against a violating fixture per `guard-manifest.test.ts`'s convention, so a walker resolving nothing cannot report the tree clean.
- Until step 5 finishes, arm (c) may be staged as a ratchet (allowlist of not-yet-bound node ids that shrinks per doc rewrite and is deleted at step 6) — the allowlist lives IN the test file, never in a manifest.

### Step 4 — Track D ratified; 07/04/08/CLAUDE.md absorb the appendices (sequential, master) `[ ]`
- **D264** (next free at HEAD; owner doc 13 §4 + §7.4; amends D251): Track D placed under `{#dash-defaults}`; D1–D5 `planned`, D6–D10 `proposed` with the named trigger; D11 = `WORKFLOW_DESCRIPTORS` leaves the bundle for bootstrap. Plan node `{#track-d}` moves `proposed → planned` with `builds:` lines per row and layers; 04 pointer.
- Appendix A (prose decision log) dropped — 04 is the authority; Appendix B (legacy vs rebuild) → `08-foundation-gap-audit.md` (or 07 §4) as a dated section; Appendix C (verify commands) → `CLAUDE.md` Commands / 07 §6. `14-roadmap.md` keeps nothing after `roadmap:end` except a one-line pointer to where each appendix went.
- Doc 07: §0.1 cites D263; §2 phase table and §3.3 order read as the source the tree derives from; a `<!-- roadmap: phase-N -->` tag per phase section.

### Step 5 — audit-then-rewrite, doc by doc, dashboard first (parallel worktrees, batches of ≤3) `[ ]`
Order: **13, 03** → **12, 06** → 02, 09, 01 → 00, 05, 08, 10, 11. Each doc is one unit (doc 03 and 02 are two units each: audit → rewrite). Per doc the agent: (a) lists every section; (b) classifies each claim **done-as-built / needs-attention / to-build** with code evidence (file:line); (c) verifies "done" against the code (D252); (d) restructures the doc so its sections mirror the tree's nodes for that area — one heading per node, the `builds:` items' layers named in prose — moving superseded narrative to `docs/rebuild/reviews/<NN>-<section>-superseded-<date>.md`; (e) tags sections `<!-- roadmap: <id> -->`; (f) adjusts `14-roadmap.md` only for ITS nodes: `doc:` refs, new `builds:` lines with layers for to-build items, `needs:` for prerequisites, and — where a node is genuinely missing — a new node with a stable id; (g) appends its own `log:` line on each node it touched; (h) runs the guard + gate; commits per doc on its worktree branch. Out of scope per unit: other docs, `src/`, the generator.
- Node map (step 5.0, sequential, master, before the batches): one agent produces the **doc ↔ node map** — for every node in `14-roadmap.md` the owning doc sections, and for every doc the nodes it describes — written into this plan's §3 and pre-applied as `doc:` lines on every node. Rewrite agents then follow the map; new nodes need the orchestrator's ok (report, do not invent).
- Batches: {13-audit+rewrite, 03-audit} → {03-rewrite, 12, 06} → {02-audit, 09, 01} → {02-rewrite, 00, 05} → {08, 10, 11}. Orchestrator verifies each worktree (branch, clean, commits), merges `--no-ff` in dispatch order, resolves `14-roadmap.md` conflicts itself, removes the worktree, re-runs the guard + `roadmap:check` on master after each merge.

### Step 6 — review + close (sequential) `[ ]`
- `doc-reviewer` per rewritten doc against the code (read-only; parallel is fine). Findings fixed inline by the orchestrator or a narrow re-dispatch.
- Ratchet allowlist in the binding guard deleted; guard green clean.
- `14-roadmap.md`: `## session:` marker for this effort; tiles/`today:` updated; regenerate; republish the artifact to `https://claude.ai/code/artifact/8e678086-ab5f-44c0-8fdb-f04986fb95ff` (WebFetch first — a sibling republished after the brief).
- Memory updated (`roadmap-site.md`); this plan's checkboxes ticked with commits; handoff written if anything is left open.

## 3 · Doc ↔ node map (filled by step 5.0)

_(pending)_

## 4 · Session log

- 2026-08-20 | docs-cohesion orchestrator | plan written from the brief; Q1–Q5 + session-log mechanism ruled by the operator; step 1 dispatched.
- 2026-08-20 | step-1 agent | `git mv ROADMAP.md docs/rebuild/14-roadmap.md`; `SOURCE`/doc-comment/parse-error paths, header `eyebrow:`+`footer:`, `CLAUDE.md` (row, commands, doc list, stray pre-heading fragments deleted) and `/custom-update-plan` repointed; site regenerated, `roadmap:check` fresh, gate green (`0990ebc5`). Title kept as `# HR Rebuild Roadmap` — `parsePlan` has one title slot. Historical records (handoffs, the 08-18 plan, the dashboard-audit plan) left naming the old path.
