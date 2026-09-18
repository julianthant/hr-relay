# HR Automation — rebuild

Legacy `/Users/julianhein/Projects/hr-automation` remains the sole production authority and rollback
asset until the single all-at-once cutover (D89/D93). This rebuild is not production.

## Working rules

- Never push without explicit instruction. Commit by logical category, stage exact paths (never
  `git add -A` / `git add .`), and preserve other sessions' edits.
- Create new worktrees inside `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/` as
  `hr-worktree-<task>`, using one or two lowercase, hyphen-separated task words (for example,
  `hr-worktree-run-detail`). Bind new launches to this root; historical paths remain evidence.
  After accepted integration, sweeps must remove both the Git registration and the physical task
  folder, including verified leftovers at previous locations. Preserve evidence and unknown files
  before removal; keep the shared worktree parent directory.
- Phase/task implementation uses a dedicated branch, never `master`. Sequential work can use an
  exclusively available checkout; parallel tasks each need a branch and worktree. Shared, dirty or
  integration-only checkouts require a worktree even for sequential work. Preserve stricter phase
  isolation rules; bind branch/base/path and merge conditions before edits, then follow the assigned review/gate cadence.
- Keep existing `AGENTS.md` / `CLAUDE.md` pairs byte-identical. Write one shared text; update both.
  Change instructions when their rules change, not after every feature edit. Put requested lessons
  in the module's linked ledger. Use `/docs` for broader documentation cleanup; `/docs audit` is read-only.
- Phase 3.1 uses focused task/prerequisite checks and focused group integration. Full repository gates
  belong only to 3.1.19, which also repairs final acceptance failures in the same session.
  No independent review step: see the [approved cadence](docs/rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13).
  This overrides conflicting module/personal review and per-candidate gate instructions for 3.1.
  Elsewhere, default implementation candidates and finalizers require typecheck, lint and full coverage (D191).
  Phase 3 and future parallel workers run focused tests, scoped lint and quick checks; the named
  finalizer combines candidates, runs full gates and fixes failures before group completion.
  Documentation-only commits use D191's scoped checks and verified reuse;
  classify by affected inputs, not extension. Read `ref guards-and-tests` §3.14 D191 for gate cadence,
  concurrent groups, evidence requirements and existing-plan exceptions.
  Update relevant tests for feature changes; say when none exist. Lint failures are task failures.
  Preserve assertions, membership, isolation, coverage floors, and timeouts. Use at most four file
  workers and run coverage without this task's compiler/linter contention. Guard additions/retirements
  must update `docs/rebuild/guard-inventory.json` with the deciding evidence.
- Report results with evidence in a compact table. Use `/ui` for frontend work. Delegate only when
  explicitly authorized; complexity alone does not trigger `/supervise`. Discussion/grilling is
  explicit-only; persist inquiry only when asked. Batch operator decisions using `/decision-brief`.
  Use `/handoff` before stopping unfinished work; verify its git state and gates on resume.

## Find the owner before changing a contract

Start at [docs/README.md](docs/README.md) for folder purposes and document routing.

The [roadmap](docs/roadmap/roadmap.md), admitted phase docs under `docs/rebuild/plans/`, and contracts under
`docs/rebuild/reference/` are the one plan. Read the relevant phase/contract; never invent another plan
or infer implementation from design. Roadmap §Governance owns D1/D263. Decisions are ratified in the
owning contract plus a pointer in `reference/decisions.md` in the same commit; never reuse D131.
History is evidence, not current authority. Read phase docs / `npm run cli -- phase` for current status.
For `/phase-plan`, use [the plans index](docs/rebuild/plans/README.md): one folder per phase,
one folder per subphase; small plans live in `README.md`, large plans split into linked task files.
Persist approved task plans and evidence at the single owner named by the roadmap binding.

D342 order 0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → optional 3.4 → 3.5; optional 3.4 never blocks 3.5.
Parts contain numbered supervisor
tasks; parallel peers use `N-1`, `N-2`, etc. with recorded isolation. Phase 3.2 freezes the candidate;
3.3 consumes it unchanged. Defects/drift return to 3.2. Phase 4 requires D319 admission and operator
approval; Phase 5 owns cutover. Never retry an UNKNOWN submit.

`ref <slug>` below means `docs/rebuild/reference/<slug>.md`. Search/read the relevant section, not
an entire historical ledger. Before editing a module, read its nearest instruction file even when
the task started at the root. Both agents use the same module instructions and references.

| Work | Read before changing it |
| --- | --- |
| Tasks / workflows | `ref task-contract`, `ref workflow-model`, `ref stores` (derived; code wins), `docs/rebuild/guides/workflow-authoring.md` |
| Run / settings / upgrade | `ref dashboard-surfaces` D330/D332, `ref clock-config-secrets` D331/D332, `ref guards-and-tests` §5.2, active phase bindings |
| Workers / browser / writes | `ref execution-and-sessions`, `ref write-safety`, relevant store instructions |
| Dashboard / BFF / CLI | `src/dashboard/AGENTS.md`, `src/server/AGENTS.md`, `ref frontend-backend-integration`, `ref dashboard-surfaces`, `ref operator-trust` |
| Intake / OCR / Edit Data | `ref data-intake-and-edit-data` |
| Tests / guards | `ref guards-and-tests`; `tests/scenario/AGENTS.md` for scenarios |
| Known kernel / workflow / driver / dashboard / safety failures | Search `ref lessons` and the module's lesson ledger by seam/decision |
| Environment / isolation / porting / detailed conventions | Relevant section of [.agents/skill-library/repository-work/REFERENCE.md](.agents/skill-library/repository-work/REFERENCE.md) |
| Authorized orchestration | Operating reference §Authorized orchestration, then the platform's `~/.agents/skill-library/parallel-agent-work/REFERENCE.md` (Codex) or `~/.claude/skill-library/parallel-agent-work/REFERENCE.md` (Claude) |

Keep instruction entry points concise, with explicit read triggers for relocated rules. Verify
existing twin equality and complete project chains below 32,768 UTF-8 bytes; do not raise the cap
to hide growth. Ordinary code/schema/catalog facts should be looked up at their owner.

## Safety boundaries

- Fail loud: missing/corrupt data or failed checks must not become plausible defaults, alternate
  selectors, cached/latest values, or swallowed results. A fallback requires both a valid expected
  case and recorded verification (live for page state, tests for pure logic). Otherwise throw a
  named error or propagate a distinct unknown that the caller checks. Never log secret/canary values.
- Runtime and finished gates never import, invoke, proxy, or read legacy live state. Port by copying
  with legacy commit + source path and live reverification. Never delete legacy files or restore its
  execution dependency. Cross-repo inventory paths use the `legacy:` prefix.
- `config/runtime-isolation.json` owns rebuild ports 3938/5174, session `hrauto-rebuild`, and its
  repo-relative state/artifact/lock/auth roots. Preserve settings/database coupling (D321), terminal
  delete/tombstones (D308), and explicit-only verified backup (`cli storage backup`, D322).
  Never discard an authority half to hide a mismatch. Boot/upgrade follows the current floor/D332;
  read the operating reference before touching authority or resolver behavior.
- Never overwrite an existing `.env` or print credentials. Missing-file setup, secure bootstrap,
  sole credential reader, display propagation, and canary resolution are specified in the operating
  reference's Environment section; read it before configuration or live-run work. Registry defects
  throw; unavailable/declared-pending subjects block before secret access or browser launch. Do not
  silently replace a canary or treat a dated availability claim as current verification.

## Live verification and commands

Read-only selectors, login checks, collectors, and dry-runs are pre-authorized; never ask about access,
spending the session, or Duo. Transaction-bearing verification uses `dryRun=true`: no UCPath submit
or Kuali finalization. D318's transaction-free `live-read` uses `dryRun=false` only with a zero-transaction
graph and zero deltas in `run_operations`, `run_operation_attempts`, and `operation_outbox`. This does not authorize cutover.

Use `playwright-cli` and its platform playbook, never Codex-in-chrome/chrome-devtools MCPs. Default
headless; snapshot before selecting locators. Duo Autopilot requires full Chromium; see
`duo-autopilot/README.md`. Close owned sessions/sweep orphans, preserving other active sessions.
Skip a down system and continue with the rest. Use rebuild drivers; consult legacy only for porting.

- Dev: `npm run dashboard` starts BFF + Vite; Ctrl+C stops both. BFF alone: `npm run cli -- dashboard`.
  Production: `npm run web:build` then `npm run dashboard:prod`.
- Live case: `npm run cli -- dry-run-scenario <workflow> --subject <label>`.
- Visual/a11y: `npm run test:parity`; D340 uses desktop-only cases from 1.6.6 onward. Do not
  restore mobile/coarse-pointer variants; preserve desktop resizing, zoom and accessibility. Follow dashboard cadence. Refreeze only deliberately with attribution and required validation/review under the phase cadence.
- Descriptor import-closure edits: `npm run build:manifest` / `npm run build:manifest:check`.
  Store catalog: `npm run stores:catalog` / `npm run stores:catalog:check`.
  Roadmap: `npm run roadmap` / `npm run roadmap:check`. Never hand-edit generated output.

For coding conventions, driver bindings, workflow layout, omission, gates, provenance, and recovery,
read the operating reference and owning contract before changing that seam. Those rules apply even
when their full explanation is not repeated in this entry point.

## Roadmap task sessions

The operator opens `/phase-plan` → `/supervise`: Astra high for Codex planning; Astra low or medium
for Codex supervision as classified by `/phase-plan`; Opus 5 → Fable 5.1 high on Claude. Reviews use
Astra ultra on Codex and Opus high on Claude. Every Codex subagent uses `gpt-6-astra` / `ultra`;
role names retain responsibilities and restrictions, not model tiers. Outside the Phase 3.1 exception,
`/supervise` dispatches a fresh read-only `/review` subagent (Codex
`sup_review`; Claude `sup-review`), then fixes and finalizes in the same
session. Phase 3.1 omits this independent-review step, including at finalization, and uses its
linked focused-group/final-3.1.19 cadence. Separate review sessions elsewhere remain an explicit operator option. Read roadmap §Governance's
**Plan, implement, review** amendment for stage boundaries, plan approval, commit-bound review and
finalization. Where review is required, record the candidate as awaiting independent review. Mark the
phase/roadmap task complete only after its assigned checks, integration and cleanup, plus accepted
review where the phase requires it. Never claim deferred broad gates as passed.
Use the exact assigned task including parallel suffixes; no required agent coordinator or next-task dispatch.
D344 (roadmap Governance) requires prerequisite → independent workers → finalizer for Phase 3 and
future parallel groups, with independent worktrees. Agents may coordinate to resolve blockers, overlap or
duplicate work within approved boundaries; plan changes return to the operator. No automatic dispatch
or merge. The operator chooses integration; completion follows the phase’s review/gate cadence and cleanup. Phase 3
uses `3.P.N` for standalone prerequisites/tasks and `3.P.N.1`, `3.P.N.2`, etc. for independent parallel
children unlocked by the completed parent; downstream consumers wait for the named finalizer.
New parallel plans make the task node the prerequisite, independent numbered children the workers,
and the last numbered child **Finalization**, requiring every worker. Sequential downstream tasks
require that child's release; do not create a detached finalizer or an empty container. See D344's
“Parallel group shape for future plans” amendment; preserve already admitted/in-flight identities.
Use current identity maps and the owning plan's D191 gate cadence, including explicit scoped exceptions.
For planning and supervision, send Done / Now / Remaining once at session start or genuine resume.
Later updates report only newly verified completions with concise evidence; do not repeat the plan,
previous completions or remaining list. Track review, integration and cleanup internally and surface
new blockers or decisions promptly. Automatic compaction does not restart this cadence. This rule
supersedes repeated-summary wording in older task briefs; completion and evidence requirements remain.
Routine stage transfers use the existing phase record; interrupted unique state uses `/handoff`.
