# HR Automation rebuild

This rebuild is not production. `/Users/julianhein/Projects/hr-automation` remains the sole
production authority and rollback asset until the approved all-at-once cutover (D89/D93).

## Scope and authority

- Start at [docs/README.md](docs/README.md). The roadmap, admitted phase plan and owning reference
  contract define the work. History and design are not proof of current implementation.
- Use the exact assigned task and its existing plan/evidence owner. Do not create a competing plan.
  Ratify contract decisions at their owner and in the decision index in the same commit; never reuse D131.
- Before changing a module, read its nearest instructions and the relevant owner below. Search the
  needed section; do not load whole historical ledgers or unrelated session transcripts.
- Phase 3.2 freezes the candidate; 3.3 consumes it unchanged. Defects return to 3.2. Phase 4 needs
  D319 admission and operator approval; Phase 5 owns cutover. Follow the roadmap's D342 order.

## Isolation and completion

- Never push without explicit instruction. Stage exact paths and commit by logical category.
  Preserve other sessions' edits; never switch, reset or repurpose their checkouts.
- Implement on a dedicated branch. The primary checkout is integration-only for Phase 3.1;
  concurrent, shared or unrelated dirty work requires an owned branch/worktree. Verify base,
  path, ownership and merge conditions before edits.
- New worktrees belong under `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/`, named
  `hr-worktree-<one-or-two-task-words>`. The four-worktree ceiling includes unrelated lanes;
  additional capacity needs operator approval.
- Retain evidence under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/<task-date>/`.
  Resolve moved historical receipts through that parent's `relocation.json`. Preserve evidence
  and unknown files before cleanup; accepted cleanup removes both worktree registration and folder.
- Keep existing AGENTS.md / CLAUDE.md twins byte-identical. Change instructions for changed rules;
  do not add historical lessons or retrospective comments. Comments explain necessary current behavior
  or constraints only. Keep complete project instruction chains below 32,768 bytes.
- `/astra-orchestrator` owns execution. Combine it with `/plan` or `/phase-plan` when planning is needed;
  planning-only, roadmap recording and execution remain separate choices. An explicit plan-and-execute
  request can continue in the same root after required approval and verified prerequisites.
- The operator launches tasks and chooses integration. No automatic sibling/next-task dispatch or
  merge. Phase 3.2 onward uses tangible feature tasks and subtasks; only explicitly labelled Parallel
  nodes run concurrently. Follow the roadmap’s 2026-09-19 amendment; preserve admitted ownership
  and dependencies. Earlier assignments retain their owning cadence.
- Complete only after assigned checks, authorized integration and cleanup, plus review where required.
  Report compact evidence and any remaining obligations. Use the existing record for routine transfers;
  use `/handoff` for interrupted unique state. Personal rules own style and worker/reviewer models.

## Verification cadence

**Phase 3.1:** use assigned focused task/prerequisite checks and focused group integration.
No independent review, including finalization. Full repository gates belong only to 3.1.19,
which repairs final acceptance failures in the same session. The
[approved cadence](docs/rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13)
overrides conflicting module/personal review and per-candidate gate rules. Never claim deferred gates passed.

**Phase 3.2 onward:** focused tests, lint and affected static/generated checks throughout each phase,
including prerequisites and intermediate integration. Full typecheck, lint, coverage and applicable
acceptance gates run at phase exit, with required repairs; see `ref guards-and-tests` §3.14
[phase-exit cadence](docs/rebuild/reference/guards-and-tests.md#phase-exit-gates-from-3-2).
Freeze audits and controlled-write/cutover admission retain their existing boundaries.

**Other work:** follow `ref guards-and-tests` §3.14 D191 and the owning assignment.
Documentation-only changes use affected checks and verified unchanged-input reuse. Classify by
affected inputs, not extension.

Update relevant tests for behavior changes; say when none exist. Lint failures are task failures.
Preserve assertions, test membership, isolation, floors and timeouts. Use at most four test-file workers;
run coverage without this task's compiler/linter contention. Guard additions/retirements update
`docs/rebuild/guard-inventory.json` with deciding evidence. Generate derived files at their source.

## Read by task

`ref <slug>` means `docs/rebuild/reference/<slug>.md`. Read only the relevant sections.

| Task | Required owners |
| --- | --- |
| Roadmap planning/supervision | [Plans index](docs/rebuild/plans/README.md), exact task plan, roadmap Governance / Plan-implement-review and D344 |
| Workflow/task | `ref task-contract`, `ref workflow-model`, `ref stores` (derived; code wins), [authoring guide](docs/rebuild/guides/workflow-authoring.md) |
| Run, settings, upgrade | `ref dashboard-surfaces` D330/D332, `ref clock-config-secrets` D331/D332, `ref guards-and-tests` §5.2, active phase bindings |
| Worker, browser, external write | `ref execution-and-sessions`, `ref write-safety`, relevant store instructions |
| Dashboard, BFF, CLI | `src/dashboard/AGENTS.md`, `src/server/AGENTS.md`, `ref frontend-backend-integration`, `ref dashboard-surfaces`, `ref operator-trust`; use `/ui` for frontend work |
| Intake, OCR, Edit Data | `ref data-intake-and-edit-data` |
| Tests/guards | `ref guards-and-tests`; `tests/scenario/AGENTS.md` for scenarios |
| Known failure/lesson | Search `ref lessons` and the module's linked ledger by seam/decision |
| Environment, isolation, porting, conventions | Relevant section of the [operating reference](.agents/skill-library/repository-work/REFERENCE.md) |
| Authorized delegation | Operating reference §Authorized orchestration, then the platform's personal `parallel-agent-work` reference |

## Runtime boundaries

- Fail loud. Missing/corrupt data and failed checks must not become plausible defaults, cached/latest
  values, alternate selectors or swallowed results. A fallback needs a valid expected case and
  recorded verification: live for page state, tests for pure logic. Otherwise throw a named error or
  propagate a distinct unknown the caller checks. Never log secret/canary values.
- Runtime and finished gates never import, invoke, proxy or read legacy live state. Port by copying
  with legacy commit/path provenance and live reverification. Never delete legacy files or restore
  its execution dependency. Prefix cross-repo inventory paths with `legacy:`.
- `config/runtime-isolation.json` owns rebuild ports, browser session and state/artifact/lock/auth roots.
  Preserve settings/database coupling (D321), terminal tombstones (D308), explicit verified backup
  (D322) and current boot/upgrade authority (D332). Never discard an authority half to hide a mismatch.
  Read the operating reference before changing authority/resolution behavior.
- Never overwrite an existing `.env` or print credentials. Before configuration/live work, read the
  operating reference's Environment section for bootstrap, credential access and canary resolution.
  Registry defects throw; unavailable/pending subjects block before secret access or browser launch.
  Do not silently substitute canaries or treat dated availability as current verification.
- Read-only selectors, login checks, collectors and dry-runs are pre-authorized. Transaction-bearing
  verification uses `dryRun=true`: no UCPath submit or Kuali finalization. Transaction-free `live-read`
  follows D318's zero-transaction graph and durable-effect checks. Never retry an UNKNOWN submit.
- Browser work uses playwright-cli and its personal playbook. Default headless; snapshot before
  choosing locators. Duo Autopilot needs full Chromium: see `duo-autopilot/README.md`. Close only owned
  sessions/orphans, preserve peers, and skip a down system while continuing with the rest.

## Commands

| Purpose | Command |
| --- | --- |
| Dev BFF + Vite | `npm run dashboard` (Ctrl+C stops both); BFF only: `npm run cli -- dashboard` |
| Production bundle/server | `npm run web:build`, then `npm run dashboard:prod` |
| Live dry-run case | `npm run cli -- dry-run-scenario <workflow> --subject <label>` |
| Desktop visual/a11y | `npm run test:parity`; D340 excludes mobile/coarse-pointer cases but preserves resize, zoom and accessibility. Refreeze deliberately with attribution and phase-required validation. |
| Descriptor import closure | `npm run build:manifest`, then `npm run build:manifest:check` |
| Store catalog | `npm run stores:catalog`, then `npm run stores:catalog:check` |
| Roadmap | `npm run roadmap`, then `npm run roadmap:check` |
