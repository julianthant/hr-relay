# Handoff — Phase 3 completion, wave 2 (dashboard wire batch, then Track A)

**Date:** 2026-08-19
**Paused at:** wave 1 merged, verified and swept; wave 2 planned but **not dispatched**.
**For:** an orchestrator session (Opus, xhigh) dispatching Opus-high subagents.

> **This file supplements, it does not replace.**
> `docs/handoffs/2026-08-18-phase-3-completion-orchestrator.md` is still the work breakdown — §2's
> unit table, §4's dispatch mechanics, §5's definition of done, §6's traps. Read it first, in full.
> This file records what wave 1 changed, what wave 2 should be, and four traps the 08-18 brief could
> not know about because they happened after it was written.

---

## Task summary

Separations is 7 of 9 exit criteria; the dashboard is being completed **through** it, because the
surfaces a real separations run needs are the surfaces every later workflow needs. Track B finishes
the dashboard, Track A finishes the backend (three controlled commits, operator-blocked), Track C
proves the two are connected on one real run. Wave 1 took the three units whose territories were
genuinely disjoint; wave 2 is the wire-and-projector work that must go one at a time.

## Plan

- Work breakdown: `docs/handoffs/2026-08-18-phase-3-completion-orchestrator.md`
- Underlying plan: `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md`
- Wire worklist: `docs/plans/2026-08-13-detail-fidelity-audit.md` §"Wire-hookup ledger" — **17 rows
  still `to declare`**

## Current state

- Branch: `master` at **`db8f12f`**, tree **clean**
- Worktrees: **none** (all three removed, `feature/*` swept, `git worktree prune` run)
- Never pushed. Local master is ahead of origin by design.
- **Gate on the merged tree — typecheck clean, lint clean, `Test Files 215 passed (215)`,
  `Tests 2076 passed (2076)`.** Baseline before wave 1 was 2017 / 211.
- Decision high-water mark: **D229**
- Reconciliation rounds used: **66** (gate ceremonies), **67** (explorer)

## Progress

Wave 1 — dispatched in parallel worktrees, merged `--no-ff` in dispatch order:

- [x] **B1** — the three identity-approval ceremonies, **D226** (`3fdc39e`)
- [x] **B5** — archive finish per D223: frozen sections, five tabs, Export (`32378bb`)
- [x] **B6** — field census **D227**, declared `when` **D228**, descriptor prose **D229** (`07744ac`)
- [x] Merge conflicts resolved by the orchestrator; manifest regenerated (`433225a`)
- [x] `run-commands.md`'s two gate records struck — D226 built what they asked for (`db8f12f`)

Wave 2 — **planned, not dispatched. Resume here.**

- [ ] **B4a** — the queue-row wire + projector batch, kept WHOLE ← **resume here**
- [ ] **B4b** — the queue-row UI consumption + the rename control
- [ ] **B4c** — the bulk command strip + result-vector band (operator confirmed cancel/retry/hide)
- [ ] **B2** — the two honesty gaps (settled gate's approver; a preview run reading `verified-done`)
- [ ] **B7** — worker-card / session-footer + context-rail wire batch, kept WHOLE
- [ ] **B3** — the run-start modal batch
- [ ] **B8** — findings sweep to zero-or-decided + **retire `span.patched`** (operator ruling)
- [ ] **A6** ⚡ / **A7** ⚡ — live retry on the composed graph; the browser-profile wedge
- [ ] **A1–A5** — blocked on the canary (below)
- [ ] **Track C** — the one connection proof, then the single parity re-freeze

### Why wave 2 is sequential

B4, B7 and B3 each edit the same wire schema and the same projector, and §4.1 is explicit that a
"ONE batched wire change" must not be split across subagents — splitting causes projector churn and
repeated re-freezes. **Split the UI consumption, keep the wire change whole.** B2's outcome chip
overlaps B4's queue rows, so it follows B4 rather than running beside it.

## Open questions / deferred decisions

**Q: the §4f2 canary — still unnamed, and it blocks A2–A5.** Put §3.1 of the 08-18 brief to the
operator verbatim; it lays out all four options with their consequences. Current thinking, unchanged
from that brief: **(c) the standalone Kuali commit on doc 4510 now, (a)/(b) when convenient.** Facts
that constrain it: doc 4524 is gone (its Kuali action completed 2026-08-14); 4510 is legal
standalone but the composed graph refuses its subject before the gate (`Inactive` employment,
live-proved run `ee9824f7`); the UCPath termination commit has no candidate at all; the practice set
(4537 / 4502 / 4495) is future-dated and refuses at `plan` per rule S7.

**Q: the parity re-freeze is owed, and it is bigger than the surfaces we touched.** The corpus is
~135 failed / 12 passed of 147 in ASSERT mode, and **nearly all of it is `descriptorHash` drift**,
not content — D228 changed `when` in all 8 descriptors, so every reference stamping a fingerprint
moved. Real content drift is confined to `explorer-graph` / `explorer-transaction`, `archive-run` /
`archive-ledger`, `run-open-gate`, plus B1's four new gate references. Current thinking: **separate
hash-only drift from content drift and show the operator the second before running the single
wave-end `npm run test:parity:update`.** Do not re-freeze 135 references on trust — a corpus that
rewrites itself documents behaviour instead of holding it (D132).

**Q: a per-archived-run storage delta is owed** (§3.2 accepted the growth). No production database
has archived a run, and B5 refused to quote a number derived from a fixture. Measure it when Track C
archives its run.

**Deferred, not forgotten:** the identity gate's evidence renders in the **ceremony dialog**, one
click from the stream card, not inline on the card. §14.6's rubber-stamp shape is closed either way.
If the operator wants disagreements on the card itself, that is a NEW findings record.

**Pre-existing, untouched:** `04-reconciliation.md` has **two rounds numbered 63** from an earlier
session's collision. Left alone rather than renumbering history that may be cited elsewhere.

## Verification before resuming

```bash
git status                      # expect clean
git log --oneline -3            # expect db8f12f at the top
npm run typecheck && npm run lint && npm run test:coverage   # expect 215 files / 2076 tests
```

Two live-work preconditions, both now definitely true:

```bash
# every descriptor fingerprint moved (D228). The running BFF is stale — restart it before any
# live run, or every run it plans is structurally unclaimable by a worker built from this tree.
curl -s localhost:3938/api/v1/explorer | head -c 400   # compare served fingerprints against the tree
```

## Traps this wave hit (the 08-18 brief could not know these)

1. **A D-number collision happened INSIDE one parallel batch.** B1 and B6 both minted D226. Both
   agents read `04-reconciliation.md` at HEAD correctly — a number sitting on an unmerged sibling
   branch is invisible to that read. **Re-reading HEAD is necessary and not sufficient: the
   orchestrator must assign a D-number block per unit before dispatch.** The repair (renumber on the
   branch, before the merge, where the other unit's number does not exist yet) is much safer than
   renumbering after both are in the tree.
2. **`\b` does not fire after an underscore.** A `_D226–D228 are reserved_` line survived a
   word-boundary renumber pass and had to be fixed by hand. Check `_D22x` / `D22x_` after any
   scripted renumber.
3. **The guard lane cannot find the legacy repo from a worktree.** It resolves `../hr-automation`
   relative to cwd; from `.hr-rebuild-worktrees/<task>/` that path does not exist and ~45 files fail.
   Dispatch prompts must set `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`. The
   authoritative gate run is on master after merge anyway, where the path resolves.
4. **A unit that is really four units will silently absorb all four.** B5 ran to ~420k tokens against
   a 300–350k budget because the schema seam, the freeze seam, the UI and the tests went out as one
   row. Every wave-2 prompt must carry: *work the assigned seam; if this turns out to be more than
   one seam, stop and report the boundary rather than continuing.*
5. **A UI unit can land a platform change.** B6's `when`-in-words requirement was satisfied by making
   `when` a declared condition — correct (the recorded alternative, an authored `whenLabel`, is two
   descriptions of one rule), and also a change to `src/base/**`, `src/core/run-executor.ts` and all
   8 descriptors from a unit scoped to the explorer. Accepted, ratified in doc 02 §3.3, guarded. The
   lesson for dispatch: when a prompt says "derive it, do not author it twice", expect the derivation
   to reach the model, and say so in the prompt.

## Pointers

- `CLAUDE.md` (project root) — fail-loud is the founding rule; read the lessons list before writing
- `~/.claude/CLAUDE.md` — worktree discipline, commit strategy, live-verification pre-authorization
- `docs/rebuild/` — owning docs. 02 = workflow model, 03 = dashboard, 09 = write safety,
  12 = operator trust, 13 = the wire
- `docs/migrations/separations.md` — §6 exit checklist (7 of 9), §9.x dated as-built
- `docs/findings/` — 5 files with open records, counts per `README.md`'s table: queue-rows (8),
  run-commands (5), activity (5), workflow-taxonomy (1), dashboard-projection (1 — it IS the
  `span.patched` record B8 retires). archive and explorer are at zero.
- Memory: `subagent-dispatch-policy.md`, `decision-number-collisions.md`,
  `findings-ledger-policy.md`, `subagent-sleep-resume.md`
