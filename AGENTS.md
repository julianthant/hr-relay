# Relay

Read [README.md](README.md) for the product, [architecture](docs/ARCHITECTURE.md) for its design,
the [codebase map](docs/reference/codebase-structure.md) for owners, and the
[terminology reference](docs/reference/terminology.md) for project vocabulary.

## What to build

- Start with the assigned brief, its folder's README when present, the codebase map and the
  [roadmap](docs/roadmap/roadmap.md). Work only on the assignment; update the roadmap only when asked.
- Keep briefs, receipts, review notes and handoffs in the assigned evidence folder under the main
  checkout's ignored `.work/`, using absolute paths from worktrees. Never commit them.
  Read the assigned local operations note for machine constraints.
- Complete shared dashboard wiring before sequential workflow activation. Approved workflow maps
  A and B, including their safety corrections, authorize workflow coding and own its inputs,
  steps, Logs timelines, results and scenarios. Present generated Explorer timelines and dry-run
  Logs for operator review.
- Wire each workflow across Run, Rerun, Queue delegated rows, Logs, Explorer, OCR/Records where
  present, notifications and Analytics. Activation requires a live dry run and operator sign-off.
- Activate in order: Person Lookup, Separations, OCR/Emergency Contact, OnBase, then Onboarding.
  Isolated workflow implementation may run in parallel.

## Codebase

- Keep one home per concept. Update the codebase map in the same commit as a move.
- Keep only current code and current documentation. Delete replaced code and obsolete tests.
  Stored-data changes use forward migrations that remove the readers they replace. Add no
  compatibility readers, shims, old-code backups, history comments or change ledgers.
- Add a layer only for a second real use. Prefer one cohesive module to many tiny files.
- Add a guard only for a real recurring mistake, with its reason in `docs/guard-inventory.json`.
- Mirror source once under `tests/`: drop `src/`, retain `scripts/`, `fast-duo/` and root paths.
  Put `<module>.test.ts` beside `<module>.integration.test.ts`; split files over about 800 lines
  by topic. Keep architecture, parity, perf and types in their own trees; shared fixtures and
  helpers belong in `tests/support/`.
- Use kebab-case filenames, named exports, `.js` relative imports and `.tsx` only in the dashboard.
  Use recursively strict Zod schemas at durable, wire and config boundaries; no unchecked casts
  or `any`. Read time through `src/rules/time/clock.ts`; keep `manualClock` test-only.
- Keep workflow definitions browser-safe: value imports only from Zod, `src/models/**`,
  `src/rules/**` and audited `src/workflow-kit/**`. Read the authoring guide for source layout.
- Freeze registry exports recursively at module load. Use structured errors rather than
  `console.*` in `src/`. Add failure codes and display text together in
  `src/models/failures/error-catalog.ts`.
- Keep instructions in `AGENTS.md` only. Do not create `CLAUDE.md`.

## Git

- Keep `main` as released production and `staging` as operator-preview integration.
- Name every branch, worktree, lane and report for one dashboard area and one kind of work.
  Split work across areas into separate lanes. Use screen names, workflow IDs, or a non-screen
  area such as `storage`, `workers` or `ci`; never name a branch only `ci/<slug>`.
- Name deliverables in one to three words. Use `ui` or `backend` alone only for that entire side
  of an area. Briefs identify UI, backend or workflow work. Separate backend and UI lanes for one
  area; merge the backend first.
- Put worktrees in the main checkout's ignored `.worktrees/`, with the branch prefix removed
  from the folder name. Title terminals `<lane> · coder` or `<lane> · reviewer`.

| Kind | Branch | Base and destination |
| --- | --- | --- |
| Design | `design/<area>` | Mock with real components for rendered operator approval; never merge or open a PR. |
| Feature | `feature/<area>-<deliverable>` | Branch from `origin/staging`; one ready PR into `staging`. |
| Task | `task/<feature>/<slice>` | Branch from its feature; merge back with `--no-ff`, no PR or GitHub CI. |
| Fix | `fix/<area>-<symptom>` | Branch from `origin/staging`; one bounded PR into `staging`. |
| Check | `check/<what>` | Local live-check build; never merge, remove after use. |
| Scratch | `scratch/<lane>-<n>` | Focused CI feedback only; never merge, remove after use. |

### Feature and task flow

- Launch independent features only after the orchestrator compares expected changed files.
  Features never depend on each other; overlapping work becomes a task of one feature or waits.
- A feature agent coordinates, reviews and merges tasks; it writes no task code. Record expected
  files and proposed task order for the orchestrator. Run tasks with shared files or dependencies
  sequentially. Keep `<feature>-review-notes.md` beside the brief.
- Before task review, merge the latest feature branch into the task, then complete typecheck,
  lint, affected tests and `npm run test:architecture` through the assigned test path.
  The feature agent inspects the real diff and check output, then merges one task per merge commit.
  Task agents never merge themselves.
- A later task resolves conflicts against the latest feature and reruns affected checks. Review
  the resolution as part of its diff. The feature agent decides behavior disagreements or refers
  them to the orchestrator.
- Send schema, data-format and live-write changes to the feature's staging reviewer immediately
  after task integration, before another task builds on them.
- When directed, merge `origin/staging` into the feature without changing running task branches.
  Resolve and report conflicts immediately because they reveal overlapping feature scope.
- When branch publication is authorized, publish task commits and feature task merges for backup.
  Open the feature PR only when ready. Its reviewer reads the whole feature by task merge commit.

### Review before push

- Easy lanes assigned to a Cursor coder have no reviewer unless the brief requires one. The coder
  completes focused checks, typecheck and lint, publishes the PR, enables auto-merge and owns CI fixes.
- Other lanes use one coder and one loop reviewer, taking turns. The orchestrator launches the
  reviewer at the first local SHA. Both may run together only while earlier fixes overlap the
  end of that same review; never put three agents on one lane.
- Reviewers use `/review` every round alongside their checklist. After typecheck and lint pass,
  commit locally and send the reviewer the SHA and report path. Fix findings and repeat.
- Reviewed lanes push only the exact SHA cleared by `VERDICT: PUSH <sha>`. A merge or fix needs
  renewed clearance. Auto-merge remains enabled, so every reviewed lane's published head needs it.
- The reviewer owns CI judgment and sends fixes to the coder; reviewed coders do not independently
  watch or repair CI. The orchestrator replaces unavailable reviewers. Do not merge PRs by hand.

### PR and release flow

- Before publishing, fetch origin and pull an existing remote task/feature branch with
  `git pull --no-rebase origin <branch>`. Merge its required latest base, never rebase or force-push.
  A staging-bound branch must show zero behind in
  `git rev-list --left-right --count origin/staging...HEAD`. Review the resulting SHA before push.
- At the first ready feature/fix push, open a PR into `staging`. Keep its title and description
  current on every push or merge. Enable `gh pr merge <N> --auto --merge --match-head-commit <sha>` after clearance.
  Workflow behavior PRs wait for a live dry run and operator sign-off; the orchestrator enables
  their auto-merge. Required check names live in [repository governance](docs/repository-governance.md).
- Batch fixes on the PR branch. While its CI runs, push again only after that run fails.
  Fix root causes and include bounded cleanup of affected fixtures or slow setup; avoid large rewrites.
  Repair red releases through a PR into `staging`.
  A base failure needs evidence and one separate repair PR, not copies in every feature.
- Let the merge train update open PRs with `staging`; resolve returned conflicts on the PR branch.
  Refer repairs requiring workflow/CI configuration edits, HR write-path changes, weakened guards,
  unrelated parity updates or expanded scope to the operator with `needs-human`.
- Preview `staging` in the main checkout, which owns runtime state, credentials and ports: stop the
  dashboard, switch to `staging`, then start it. A rejected feature is reverted on `staging`.
  Verify the automatic pre-upgrade backup before previewing a person-store migration.
- Release only on the operator's explicit go: merge `staging` into `main` with a merge commit,
  then sync `main` back into `staging`. Never push directly to either protected branch.
- After merge, save evidence and unknown files, remove the owned worktree registration and folder,
  and delete its local branch. Verify remote branch deletion and report residue. Remove evidence
  only when nothing needs it; clean up any remaining feature worktree once the feature reaches `main`.

## Checks

- Follow the brief's assigned test path: focused GitHub feedback by default, or an orchestrator-granted
  local slot. Use one path, not both. CI-path lanes run typecheck and lint serially; tests wait for
  the named runner. Pause local tests during operator live runs. Run full suites only in a granted
  slot; PR CI supplies the feature's full run. Use platform-matching machines for native proofs.
- Before review/push, complete typecheck, lint/static checks and source generators whose inputs
  changed; report unrun tests for the reviewer and CI. Never commit a failure caused by the change.
  A demonstrated base failure may proceed with its evidence recorded.
- For docs-only changes, check links, whitespace, affected generated output and any tests that parse
  the edited documents. No runtime suite is required for prose alone.
- Run portable Ubuntu unit, integration and architecture suites plus static and privacy for staging
  PRs. Keep `NATIVE_FILES`, `SERIAL_FILES` and `SERIAL_STORAGE_FILES` out of Ubuntu shards, retaining
  release coverage. Add new native proofs to `scripts/test/ci-files.ts`.
- Only the operator starts full-release CI. Agents never dispatch or rerun CI workflows.
  The focused-test script is the assigned scratch-feedback path, not a release or merge proof.
  [Guards and tests](docs/reference/guards-and-tests.md#focused-tests-in-github-actions) describes it.
- Run platform-native proofs and parity in CI only for operator-started releases. Release checks
  build the web bundle, run coverage alone, then perf. Coverage already selects unit, integration
  and architecture; do not run those full suites again for unchanged inputs.
- PC feedback never blocks a repair push or substitutes for the published head's PR CI. Do not
  run macOS-native proofs or parity there. Keep machine slot details in the local operations note.
- Preserve the timing feedback loop. Refresh `scripts/test/ci-durations.json` when job end times
  spread more than a minute. Generate derived files through their source, never by hand.
- Before local coverage, verify free memory, no swap pressure and no listener on the runtime backend
  port. A resource refusal leaves the gate unrun.
- Before publication, stage the exact candidate and run `npm run privacy:check`; inspect its prose
  and images too. Keep public instructions free of local paths, machine/account identities,
  terminal handles, secrets and employee identifiers.

## Runtime safety

- Fail loud on missing or corrupt data and failed checks. Throw a named error or propagate a
  distinct unknown that the caller checks. A fallback needs a valid expected case and recorded
  verification: live evidence for selectors or page state, tests for pure logic. Never turn a
  failed check into a default, cached result, alternate selector or swallowed success.
  Retry the same transient operation only where its write policy permits it. Swallow an optional
  failure only when no caller depends on its success.
- Preserve dry runs, write intents, parked writes, receipts, evidence and UNKNOWN/no-retry behavior.
  Transaction verification uses `dryRun=true`: no UCPath submit or Kuali finalization.
- Port workflow behavior by copying production reference code and recording its commit and path
  in task evidence, then verify live. Prefix cross-repo paths `legacy:`. Never import, invoke,
  proxy or read production state, delete production files, or make committed gates depend on legacy.
- Before changing authority or path resolution, read the operating reference and
  `config/runtime-isolation.json`. Preserve database/settings coupling, terminal tombstones,
  verified backups and boot/upgrade authority. Never discard one authority half to hide a mismatch.
- Before configuration or live work, read the operating reference's Environment section.
  Preserve existing `.env` files. Reject unavailable subjects before secret reads or browser launch;
  never substitute canaries or use settings/credentials as test-input fallbacks. Never log secrets.
- Read-only selectors, login checks, collectors and live dry runs are pre-authorized. Use headless
  sessions by default and snapshot before choosing locators. Fast Duo requires full Chromium;
  read `fast-duo/README.md`.
  Close only owned sessions; skip unavailable systems and continue with the rest.

## Backend

Read [backend instructions](src/backend/AGENTS.md) before backend or CLI composition changes,
and the relevant system's `AGENTS.md` before touching its driver.

## Dashboard

Read [dashboard instructions](src/dashboard/AGENTS.md) before changing dashboard components,
client code or wiring.

## Context, reports and delegation

- Each Codex brief selects its route. Claude and Cursor use their launch settings, without routes.
  Codex lane workers launch no separate worker sessions; in-session subagents follow their brief.
  Opus 5.5 xhigh coders delegate through `/delegate` and report counts per tier in READY.
- At each finished concern, record its commits in the assigned `<lane>-report.md`. Include changes,
  check results, CI obligations and open decisions. Prefix terminal reports `REPORT: <lane>` and
  send them to the orchestrator, then stop at the brief's boundary.
- Before context exhaustion, finish the current step and write `<lane>-resume.md` beside the brief:
  brief path, branch, HEAD, dirty paths, open review verdicts and next step. Claude workers do this
  above 300k context tokens. Send `CONTEXT HANDOFF <note path>` to the orchestrator and stop.

## Read by task

`ref <slug>` means `docs/reference/<slug>.md`. Read relevant sections, not whole catalogs.

| Task | Read first |
| --- | --- |
| Workflow | `ref task-contract`, `ref workflow-model`, `ref stores`, [authoring guide](docs/guides/workflow-authoring.md) |
| Dashboard, client, CLI | Module instructions, `ref frontend-backend-integration`, `ref dashboard-surfaces` |
| Settings, config, secrets | `ref clock-config-secrets` |
| Worker, browser, external write | `ref execution-and-sessions`, `ref write-safety`, the system's `AGENTS.md` |
| Intake, OCR, Edit Data | `ref data-intake-and-edit-data` |
| Tests and guards | `ref guards-and-tests` |
| Live dry run | [`/verify`](.agents/skills/verify/SKILL.md) and its [feature map](.agents/skills/verify/features/README.md) |
| Environment, porting, conventions | [Operating reference](.agents/skill-library/repository-work/REFERENCE.md) |
