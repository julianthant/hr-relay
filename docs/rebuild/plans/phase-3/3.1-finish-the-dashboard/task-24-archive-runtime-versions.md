# Task 3.1.24 · Archive and runtime version redesign
<!-- roadmap: dash-archive-runtime-versions -->

Status: **approved by the operator on 2026-09-24; isolated backend implementation authorized now.**
Source baseline: `4b22f03a04ba5c70329f172d3266474135964431` on branch `codex/archive-version-redesign` in `/Users/julianhein/.codex/worktrees/4de5/hr-automation-rebuild` (clean at inspection). The existing Archive task 3.1.9.7 is closed. The 3.1.23 UI refinement assignment is presentation only and forbids new archive authority behavior. This proposal therefore creates one dedicated Phase 3.1 task, stable ID `dash-archive-runtime-versions`, ordered after UI refinement finalization and before 3.1.16–3.1.19. Its candidate remains on this dedicated branch; the operator chooses integration.

## Accepted product behavior

- Keep two independent runtime counters. A workflow bump changes only the selected workflow(s), for example 1.1 → 1.2; the dashboard remains at its current version. An all-workflow dashboard bump changes dashboard and every workflow together, for example 1.2 → 2.0.
- A single workflow change may include one or several selected workflows. Each selected workflow advances its own minor number once; unselected workflows do not change. The all-workflow action is the major bump. The review names every affected workflow and its before/after version.
- A workflow bump archives the selected workflows' completed old-version runs. An all-workflow bump archives completed old-version runs across all workflows. Queued, running, parked, or otherwise nonterminal affected runs block the bump and remain visible in review. No partial version publication.
- New runs after publication carry the actual dashboard and workflow runtime versions. Existing build semver, descriptor integer version, and contract fingerprint remain separate code/runtime compatibility identities.
- Archive browsing groups **Dashboard version → Workflow folder → saved runs and files**. The selected Archive 1 presentation shows workflow version as a run column/filter and removes outcome browse badges/filters. Search and filters retain dashboard version, workflow, workflow version, and dates. A run opens its complete public immutable report, searchable fields and verified attachments; JSON/typed CSV exports include all selected public record fields and all matching runs rather than just visible columns or one page. The list does not recreate reports from current descriptors.
- The current Archive navigation has no Back button. Do not restore the Back button shown in the earlier synthetic prototypes.
- Initialize the new dashboard and registered workflow counters at **1.0** during the controlled upgrade. Historical reports without trustworthy runtime-version provenance display **Version not recorded**. Do not rewrite old report bytes. At initial activation, record an explicit 1.0 baseline assignment for currently live runs without altering their historical run envelope; show it as an adopted baseline rather than a version they were originally stamped with.

## Proposed execution outcomes

| Order | Implementation and repair | Deciding proof |
| --- | --- | --- |
| 1. Contract and durable authority | Amend `docs/rebuild/reference/dashboard-surfaces.md` and `docs/rebuild/reference/decisions.md` in one commit. Define strict `major.minor` runtime versions, initial baseline assignment, multi-workflow minor behavior, all-workflow major behavior, and read-forward v1/v2 history. Add the new authority schema step and repository for dashboard/workflow versions plus an applying fence. Existing build/descriptor identities remain unchanged. Do not auto-upgrade an operator database at ordinary boot; use the existing D332 controlled upgrade path. | Fresh and upgraded disposable authorities; exact baseline attribution; old records read forward; malformed/missing state fails loud; no unexpected change to source run envelopes. |
| 2. Version review, apply, and run stamping | Replace the old “minor archives nothing” effect for new version plans. Review terminal candidates and nonterminal blockers for the selected old-version runs; recheck membership and version basis at apply. Claim/fence before transfer, freeze reports and files, resume exact partial transfers, publish version counters only when the transfer has fully settled. Stamp every new enqueue path (start, intake, retry/restart and recovery paths that mint runs) from the same durable authority. A stale plan, divergent replay, active blocker, changed descriptor/build, or unresolved claim refuses without publishing a version. | Tests for one, several, and all workflows; unchanged unselected workflows; concurrent enqueue versus claim; active and UNKNOWN-submit blockers; interruption at each transfer/publication boundary; exact replay and restart convergence; new-run stamps after publication. |
| 3. Archive read model and filters | Freeze both runtime versions into new immutable saved reports and add indexed archive metadata/query support. Preserve digest, file custody, deletion, export, bounded pagination and historical report compatibility. Return explicit unknown/adopted version states rather than guessing. | Query pagination/filter combinations and ties; corrupt/missing archive data; old/new report schemas; report/file digest and deletion custody; title/file search bounds. |
| 4. Dashboard UI | Implement the approved grouped Archive screen and Plan a bump screen in `archive-report.tsx` / its model and Archive-specific client/server wires. Show current dashboard and workflow versions, reviewed membership/blockers, progress/refusal/recovery, clear filter chips, empty states, and exact report/file navigation. Keep the existing design system, desktop floor, keyboard access and route selection behavior. | Mounted state and command tests; production-service browser flow on disposable synthetic data; Archive parity/a11y at 1024×720, 1440×900 and required zoom; inspected after captures against the approved mockups. |

The approved visual direction is retained as `archive-dashboard-workflow-groups.{html,png}` and `archive-dashboard-workflow-bump.{html,png}` under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/archive-version-redesign-2026-09-24/`. Both are prototypes with synthetic records. The current app screenshot is the before state.

## Boundaries and gates

- Scope is Archive/version contracts, authority, run creation, Archive read models, Archive UI, and exact affected tests/fixtures. No production HR write, external system transaction, cutover, legacy runtime import, new archive execution door, automatic backup, or push.
- Preserve the separate `archive.sqlite` and canonical run disposition. Archive transfer, deletion and attachment identity remain exact. A crash leaves an explicit applying claim to resume; it does not expose a new version prematurely.
- Keep this task off the UI-B workflow interaction files currently owned by another task. Do not merge while UI refinement finalization or this task's focused gates are open.
- Phase 3.1 cadence: focused behavior tests, affected architecture/static/generated checks, lint whenever tests run, and affected Archive parity. Full repository gates and broad acceptance remain 3.1.19; no independent review step. Regenerate/check roadmap and catalog/manifest only when their inputs change. Retain evidence under the project evidence root.
- Baseline inspection found current authority schema 54, package version `0.1.0`, `VersionChangeSchema` generation 2, and Archive report schema 1. Baseline test attempt could not run because this checkout has no `node_modules` (`sh: tsx: command not found`). Install dependencies after approval, then rerun focused baseline and lint before production edits.

## Approval and release

The operator approved this plan with “do it” on 2026-09-24 after reviewing the concrete proposal, including the 1.0 starting version. The operator then explicitly authorized isolated backend work before 3.1.23.3 finishes. Archive UI changes and integration wait for accepted 3.1.23.3; task release precedes 3.1.16–3.1.19. The operator chooses integration after focused proof; these approvals grant no push.

## Workflow-record presentation implementation — 2026-09-26

The operator selected and approved the revised Archive 1 artboard for implementation with a Sol
worker. Its contract is [D348's workflow-record amendment](../../../reference/dashboard-surfaces.md#workflow-record-presentation-amendment--2026-09-26).
The current candidate base is the committed Settings-derived `897158ece84471dd86b67ca8d49e73477b1280e8`;
branch `codex/archive-records` uses the attached managed worktree
`/Users/julianhein/.codex/worktrees/archive-records/hr-automation-rebuild`. The local coordinator
owns shared contract updates and acceptance; the operator retains product integration choice.
Evidence and the exact parallel ownership record live in
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/archive-explorer-activity-2026-09-26/`.
The accepted visual direction authorizes attributable reference changes. Focused Phase 3.1 checks
apply; no independent review or automatic merge. Runtime bump/transfer authority is unchanged.
