# Handoff — Phase 3a final completion after D271–D276 ratification

**Date:** 2026-08-26
**Paused at:** D271–D276 are reviewed and merged into the integration branch; worker-contract and
fidelity feature units are not yet integrated. All Codex subagents were stopped before this handoff.

## Task summary

Finish `docs/rebuild/03a-finish-the-dashboard.md` under the plan's exact exit criteria. The operator
answered **A / all recommended** for all 49 decision-sheet items. Those choices are now ratified as
D271–D276; do not ask again and do not reinterpret them. Completion still requires:

1. the real dashboard-owned worker supervisor and two concurrent separations dry-run scenarios,
2. every resulting fidelity port through the required frontend workflow,
3. rendered and independent review of each frontend unit,
4. exactly one deliberate parity re-freeze after all ports land,
5. final 03a + roadmap reconciliation, the full D191 gate, and a worktree sweep.

Do not broaden current Phase 3a scope to Review/People projections (owned by 03c) or Track D D6–D10
(still proposed outside this gate). Never invent unserved wire facts. Live verification is
pre-authorized and `dryRun=true` is the safety boundary. Never push.

## Plan

- Primary plan: `docs/rebuild/03a-finish-the-dashboard.md`
- Machine-readable plan: `docs/roadmap/roadmap.md` (`docs/roadmap/index.html` is generated)
- Approved choices: `docs/decisions/2026-08-25-03a-decision-brief-coverage.md` and its six linked
  sheets; every answer table says A.
- Owning decisions/specs: D271–D276 in `docs/rebuild/reference/decisions.md`, with normative prose in
  `execution-and-sessions`, `dashboard-surfaces`, `operator-trust`,
  `data-intake-and-edit-data`, and `frontend-backend-integration`.

## Required supervisor and skills

The receiving Claude session must re-enter the **supervisor skill**, not implement this as one large
agent:

- `/supervise` — read `/Users/julianhein/.agents/skills/supervise/SKILL.md`; use
  `sup_luna` / `sup_terra` / `sup_sol` at high reasoning, one seam per unit, under 250k tokens,
  isolated worktrees, independent reviewers, verify before merge.
- `/ui` — read `/Users/julianhein/.agents/skills/ui/SKILL.md`; mandatory for every frontend edit.
  Use Operate mode / craft-floor parity ports, render with `playwright-cli`, and run `ui-review`.
- `/tdd` — contract and behavioral changes start with a red test.
- `/review` — independent spec/correctness/silent-failure/UI axes before integrating risky units.
- `/debug` — use for the Intake Playwright timeout; establish a red-capable loop first.
- `/playwright-cli` — the only permitted browser tool; never Codex-in-Chrome or Chrome DevTools.
- `/worktree-sweep` — only after all units merge and full gates pass.
- `/decision-brief` is not needed unless genuinely new operator judgment appears; the 49 decisions are
  closed and must not be reopened.

Project `AGENTS.md` is binding: explicit staging only; local logical commits; tests imply lint; update
nearest `AGENTS.md` for feature changes; never edit `CLAUDE.md`; never push.

## Current state (verified, not remembered)

- Repo: `/Users/julianhein/Projects/hr-automation-rebuild`
- Base before this continuation: `96afae0a`
- Integration branch: `integration/03a-final`
- Integration HEAD: `a5f7b3bb Merge feature/03a-ratify: ratify D271-D276`
- Integration worktree: clean
- Commits ahead of `96afae0a`:
  - `a5f7b3bb` merge ratification
  - `cf29672b` close ratification docs review
  - `5c426941` close ratification spec review
  - `9942c979` record ratified work as implementation-open
  - `4e5a419c` ratify the 49 choices
- Ratification verification at final branch tip: roadmap binding 14/14, `roadmap:check` fresh, lint
  green, `git diff --check` green. No full `test:coverage` was rerun after this docs-only merge.
- The previous merged-master baseline at `96afae0a` recorded 263 files / 2,729 tests green; rerun the
  full suite after feature integration rather than treating that historical result as the final gate.
- No agents are running. Nothing was pushed.

### Worktrees

| Worktree | Branch / HEAD | State | Ownership / next action |
|---|---|---|---|
| repo root | `integration/03a-final` / `a5f7b3bb` | clean | integration branch |
| `.hr-rebuild-worktrees/ratify` | `feature/03a-ratify` / `cf29672b` | clean, merged | remove only during final sweep |
| `.hr-rebuild-worktrees/worker-pool-contract` | `feature/worker-pool-contract` / `078cc47a` | clean, not merged | resume Unit W1 review fixes |
| `.hr-rebuild-worktrees/fidelity-intake` | `feature/fidelity-intake` / `ed3b076a` | **dirty, owned** | resume Unit F1B exactly; do not discard |
| `.hr-rebuild-worktrees/fidelity-queue` | `feature/fidelity-queue` / `686c64a9` | clean, not merged | finish review/fixes |
| `.hr-rebuild-worktrees/fidelity-refusals` | `feature/fidelity-refusals` / `96afae0a` | clean, no unit commits | unit not started; first bring in integration D273 |

### Dirty Intake ownership

These uncommitted files belong entirely to the paused Intake accessibility follow-up and must be
preserved:

- `src/dashboard/surfaces/intake-model.ts`
- `src/dashboard/surfaces/intake.tsx`
- `tests/unit/dashboard/intake-model.test.ts`
- `tests/parity/intake-accessibility.spec.ts` (new)

The focus/name Playwright case passed. The 1440 hit-target case timed out after two minutes; narrow
did not run. Focused Vitest was 50/50, typecheck passed, lint passed. Diagnose the timeout, finish
1440×900 and 1024×768 `playwright-cli` verification, add the required dated Intake note to
`src/dashboard/AGENTS.md`, then explicitly stage and commit. Do not re-freeze parity yet.

## Progress and resume order

- [x] **R1 — ratify all 49 recommendations as D271–D276**
  (`4e5a419c`, `9942c979`, review fixes `5c426941`, `cf29672b`, merge `a5f7b3bb`).
  Spec and docs reviews found and closed missing pool consequences, stale blanket bump rules,
  mid-sheet answer tables, stale Track F ownership, stale charter/roadmap wording, and pointer errors.

- [ ] **W1 — worker pool contract review fixes** ← resume immediately in
  `feature/worker-pool-contract`.
  Existing commits `65c4de82` through `078cc47a` pass 34/34, typecheck and lint, but are **not
  mergeable**. Add adversarial tests and fix all six reviewed holes:
  1. snapshot/freeze requests and compare acknowledgements to original scalars (supervisor mutation
     currently passes),
  2. scale-down names exact authoritative excess indices and requires exact stop coverage,
  3. every mutating control requires durable supervisor ownership; external members refuse,
  4. escalation policy is separate from timestamped observed stages; initial request cannot claim
     future TERM/KILL,
  5. process/browser effects are awaitable or two-phase, never synchronously acknowledged early,
  6. add mutation, omitted-excess, external ownership, transition, graceful-short-circuit and async
     negative controls.
  Use `sup_sol` + `/tdd`, then independent `sup_sol` correctness/concurrency and `sup_terra` spec
  reviews.

- [ ] **W2 — real dashboard child-process supervisor** — start only after W1 is reviewed/merged.
  New deep module under `src/server/dashboard/worker-supervisor.ts` plus focused tests. Launch the
  exact CLI with argv arrays (no shell), prove child PID/birth/ownership, record exit/error/stage
  evidence, graceful stop then TERM/KILL, no auto-restart after crash, and no adoption/control of
  externally started workers. Use `sup_sol`, `/tdd`, and security/concurrency review.

- [ ] **W3 — composition and shutdown integration** — wire W2 into
  `src/server/dashboard/compose.ts`, command-kernel runtime, dashboard shutdown ordering, process
  locks, and tests. No success acknowledgement before process evidence. Keep authority/CAS facts
  distinct from desired capacity.

- [ ] **W4 — Session Panel process controls** — `/ui` unit. Add the approved plan/spawn/explicit
  index scale-down/stop controls against served pool CAS version; show crash reason and external
  ownership; keep absent reasons and honest browser state. Render desktop/narrow/both themes.

- [ ] **W5 — parallel automated proof** — two-child supervisor test, overlap/teardown soak, exact
  pool identities, released locks, zero false success, and the required §7.1 concurrency row.

- [ ] **W6 — live parallel separations proof and docs** — run two real composed separations
  `dryRun=true` scenarios concurrently through the dashboard, record run/trace/session/pool/lease
  evidence and 0/0/0 run-scoped write counts in `docs/migrations/separations.md` and the owning
  execution spec. The mapped T1 canary is date-gated until 2026-08-28; do not wait blindly or claim
  it. Inspect the scenario registry for two available separations subjects/scenarios, or run two
  ordinary dashboard-started separations dry runs that satisfy 03a's proof wording. If the exact
  evidence genuinely depends on the dated canary, report that as a named external gate rather than
  weakening the criterion. Close all Playwright/process sessions afterward.

- [ ] **F1B — finish Intake accessibility follow-up** ← dirty worktree described above.
  Original commits: `e3d5b632`, `23c8196b`, `c063c361`, `ed3b076a`. Original flow already adds the
  exact rejection-set acknowledgement, disabled Start, table/editors/Wells/conflict warning and
  approved copy. Finish focus transfer, labelled editor region, >=44px Fix/Exclude and checkbox
  targets, stable names and `autocomplete=off`; debug the parity test timeout; commit and re-review.

- [ ] **F2 — Queue review fixes** — branch is clean with `7cca0fce`, `686c64a9`; verified targeted
  12/12, typecheck and lint. Complete the paused review before merge. Preliminary findings to prove
  or fix:
  1. `dashboard-app.tsx:636-655` may silently drop selected IDs absent from current `surfaces`, so
     omission is neither skipped nor disclosed,
  2. `queue.tsx:834-842` check control appears 24px, below 44px,
  3. shared `Chip` exposes truncation only by `title`, not keyboard/touch-reachable detail.
  Also finish settlement/result-feed review. Re-render queue in both themes and narrow/desktop.

- [ ] **F3 — shared refusal/park footer** — existing worktree is clean and untouched. Before work,
  merge/rebase the current integration branch so D273 is present. Through `/ui`: remove duplicate
  parked footer identity/revision/generation, extract one shared component-only refusal notice plus
  pure model, parameterize truthful identity-vs-park copy, preserve server code/message/version and
  open drafts/gates, add focused tests and parked/gate-refused renders.

- [ ] **F4 — shell + full-page Settings + help** — D272/D274: full-page takeover/history/back,
  shell geometry/provider nesting/toast floor, stable worker/version copy, reachable Help → Keyboard,
  and documented retained Escape-clear/Import deviations. Separate any bootstrap projection work
  from UI; use `/ui` and render both themes/viewports.

- [ ] **F5 — queue/start follow-ons** — after F2, port run-start plan cards, formatted provenance,
  input/shape continuity, stale-result clearing, conflict reload, visible reasons, conditional
  groups/numbering/labels. Do not invent still-unserved richer start-plan or capability facts.

- [ ] **F6 — run identity/timeline/log cues** — restore approved identity vocabulary, focusable
  timeline button/orphan wait/status/axis, truthful empty/paging states with demo search geometry,
  liveness dot and paired decision age/clock. Keep observed-log grouping/ordering contracts intact.

- [ ] **F7 — Context rail + Edit Data** — one expansion owner, demo labels/chrome/Well/dividers,
  coded refusal and preserved-edits feedback, remove duplicate blocked reason, retain async Saving as
  the approved accessibility exception.

- [ ] **F8 — receipt + failure evidence** — show every true served demo cue, omit the unrepresentable
  receipt invariant arm, restore failure disclosure/framing/tones/remediation/first-seen only where
  served. Never fabricate unserved failure fields. Independent trust/silent-failure review required.

- [ ] **F9 — archive authority semantics** — `sup_sol` / `/tdd`: major archives and may block;
  minor archives nothing and cannot block. Preserve archive generations/read-forward/digests. This is
  authority behavior, not a UI unit, and requires correctness/concurrency review.

- [ ] **F10 — Archive UI family** — `/ui`: virtualized 800-row index, approved copy/shapes,
  non-byte “What it was”/purged viewer, affected-run bump list, full bump-dialog fidelity and truthful
  async/refusal/no-force behavior. Split virtualization, viewer, and bump dialog if any unit exceeds
  one seam.

- [ ] **F11 — Settings projection and read-only sections** — serve/render System hosts and Workflow
  capabilities without adding settings writes. Keep async loading/refusal states.

- [ ] **F12/F13 — phone capture producer then operator UI** — first add authority-backed session
  phase/expiry/page/unreadable/contact-sheet projection with strict absent/error arms; then `/ui`
  desktop operator surface. Do not conflate with deferred production byte serving.

- [ ] **F14 — Explorer/catalog/Activity/DS standing fidelity** — split into one seam each:
  served-only catalog vocabulary + two real toolbar entries; Explorer demo reading model/edit-row
  affordance and unreachable-arm removal; Activity/Settings-storage copy/geometry; DS primitive
  rollback and seven-section specimen page. Add the missing Settings, version-bump, and DS specimen
  parity scenes.

- [ ] **P1 — final deliberate parity re-freeze** — only after all reviewed UI units merge. Run
  `npm run test:parity:update` exactly once, inspect every changed a11y/png reference, then run
  assert-mode `npm run test:parity`. Do not accept unrelated descriptor/content drift silently.

- [ ] **CLOSE — reconcile 03a/roadmap, full review/gate/sweep** — update status only from landed
  evidence; `npm run build:manifest`, `npm run roadmap`, typecheck, lint, `test:coverage`, parity,
  roadmap binding/check; independent final review; merge `--no-ff` into integration then master only
  after green; invoke `/worktree-sweep`. Never push without explicit instruction.

## Open questions / deferred decisions

No operator decision is currently open for these 49 items. Potential blockers are implementation or
external-state facts, not permission questions:

- The named T1 separations canary is unavailable until 2026-08-28. Determine whether two other
  current separations dry-run scenarios satisfy 03a's parallel proof. Do not weaken or falsely tick
  the proof.
- Many audit rows remain explicitly unserved producer work. D272–D276 authorize only the producers
  named in their recommendations (not arbitrary invented fields).
- Review/People projections and Track D D6–D10 remain out of current 03a completion scope.

## Verification before resuming

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch
git log --oneline 96afae0a..HEAD
git worktree list

for p in \
  /Users/julianhein/Projects/hr-automation-rebuild \
  /Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/fidelity-intake \
  /Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/fidelity-queue \
  /Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/fidelity-refusals \
  /Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/ratify \
  /Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/worker-pool-contract
do
  git -C "$p" status --short --branch
done

HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation \
  npx vitest run tests/unit/architecture/roadmap-doc-binding.test.ts
npm run roadmap:check

# Run after integration, not as a substitute for unit gates:
npm run build:manifest
npm run typecheck
npm run lint
npm run test:coverage
npm run test:parity
```

## Pointers and artifacts

- Read first: repository `AGENTS.md`, `src/dashboard/AGENTS.md`,
  `docs/rebuild/reference/lessons.md`, 03a, roadmap governance, D271–D276.
- Fidelity row ledgers:
  - `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md`
  - `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md`
  - `docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md`
- Existing Intake screenshots:
  - `/tmp/hr-rebuild-intake-review-1440x900.png`
  - `/tmp/hr-rebuild-intake-correction-editor-1440x900.png`
  - `/tmp/hr-rebuild-intake-review-clean-1024x768.png`
  - `/tmp/hr-rebuild-intake-reviewed-1280x720.png`
- Existing Queue screenshots: `/tmp/fidelity-queue/` (both themes, desktop and narrow).
- Ratification branch is already merged into integration; do not cherry-pick it again.
- Feature branches are based on `96afae0a`; resolve their docs/AGENTS conflicts carefully when
  merging into `integration/03a-final` and regenerate the roadmap only after roadmap-affecting merges.

