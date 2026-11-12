# Relay

Read [README.md](README.md) for the product, [architecture](docs/ARCHITECTURE.md) for its design,
the [codebase map](docs/reference/codebase-structure.md) for owners, and the
[terminology reference](docs/reference/terminology.md) for project vocabulary.

## What to build

- Work from your ticket in the shared Concord ledger: claim it, read its brief, load the skills on
  its `Skills:` line, and record progress, commits, check results, unrun obligations and open
  decisions on it. Work only on the ticket. Read the codebase map and the
  [roadmap](docs/roadmap/roadmap.md); update the roadmap only when asked.
- Treat the main checkout's ignored `.work/` as scratch: per-task evidence at absolute paths from
  worktrees, deleted when the task merges. Never commit it. Read `.work/operations.md` there
  for machine constraints.

## Codebase

- Keep one home per concept. Update the codebase map in the same commit as a move.
- Keep only current code and current documentation. Delete replaced code and obsolete tests.
  Stored-data changes use forward migrations that remove the readers they replace. Add no
  compatibility readers, shims, old-code backups, history comments or change ledgers.
- Add a layer only for a second real use. Prefer one cohesive module to many tiny files.
- Add a guard only for a real recurring mistake, with its reason in `docs/guard-inventory.json`.
- Mirror source once under `tests/`: drop `src/`, retain `scripts/`, `fast-duo/` and root paths.
  Put `<module>.test.ts` beside `<module>.integration.test.ts`; split files over about 800 lines
  by topic. Keep architecture, mocks, perf and types in their own trees; shared fixtures and
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

## Conventions

- Give each piece of work one name and use it everywhere. A feature is `<area>-<deliverable>`; the
  area is a screen name, a workflow ID, or a non-screen area such as `storage`, `workers` or `ci`.
  A ticket is `<feature> / <lane>`; a lane is one to three words, unique within its feature.

| Thing | Name |
| --- | --- |
| Ticket ID | `<feature>-NN` |
| Feature branch | `feature/<feature>`: from `origin/staging`, one PR into `staging` |
| Ticket branch | `task/<feature>/<lane>`: from its feature branch, merged back with `--no-ff`, no PR |
| Standalone fix | `fix/<area>-<symptom>`: one ticket, one PR into `staging` |
| Chore | `chore/<area>-<change>`: tooling, tests or docs with no product change; one PR into `staging` |
| Design | `design/<area>`: mock with real components for operator approval, never merged |
| Scratch | `scratch/<lane>-<n>`: focused CI feedback or a red probe, never merged, removed after use |
| Worktree | `.worktrees/<feature>.<lane>`; the feature's own checkout is `.worktrees/<feature>` |
| PR title | `<Area>: <what the operator gets>` |
| Spec | `.work/specs/<feature>.md` |
| Evidence | `.work/evidence/<feature>/<lane>/`, deleted when the ticket merges |

- Use no other branch prefix. Run `npm run names:check` before the first push and before opening a
  PR.
- Keep the main checkout on a clean `staging` and work only in `.worktrees/`. A ticket lives on one
  machine with its tests; work moves between machines only as pushed branches.
- Leave no stash behind at the end of a session: commit to the ticket branch.
- Merge a ticket branch into its feature branch only after the reviewer clears its SHA, then remove
  its worktree and branch in the same step.
- Separate backend and UI lanes for one area; merge the backend first.
- Read `.work/operations.md` in the main checkout for machine roles, slots and ports.

## Git

- Keep `main` as released production and `staging` as operator-preview integration.

### PR and release flow

- The `dev-auto` (orchestrator), `duo` (coder and reviewer pair) and `ship` (publish to merge)
  skills hold the lane, review-loop and PR procedure. Load the one your ticket names.
- Changes reach `staging` only through a PR. Never push directly to `main` or `staging`. Merge the
  latest base into your branch; never rebase or force-push. Never merge a PR by hand.
- Workflow behavior PRs wait for a live dry run and operator sign-off. Required check names live
  in [repository governance](docs/repository-governance.md).
- Refer repairs requiring workflow/CI configuration edits, HR write-path changes, weakened guards
  or expanded scope to the operator with `needs-human`.
- The main checkout owns runtime state, credentials and ports.
- Release only on the operator's explicit go: merge `staging` into `main` with a merge commit,
  then sync `main` back into `staging`.

## Checks

- Follow the ticket's test path: focused GitHub feedback by default, or an orchestrator-granted
  local slot, never both. CI-path lanes run typecheck and lint serially; tests wait for the named
  runner. Pause local tests during operator live runs. Run full suites only in a granted slot; PR
  CI supplies the feature's full run. Run native proofs on platform-matching machines.
- Before review/push, complete typecheck, lint/static checks and source generators whose inputs
  changed; report unrun tests for the reviewer and CI. Never commit a failure caused by the change;
  a demonstrated base failure may proceed with its evidence recorded.
- Docs-only changes need link, whitespace and affected generated-output checks and any tests that
  parse the edited documents; prose alone needs no runtime suite.
- Staging PRs run portable Ubuntu unit, integration and architecture suites plus static and
  privacy. Keep `NATIVE_FILES`, `SERIAL_FILES` and `SERIAL_STORAGE_FILES` out of Ubuntu shards,
  retaining release coverage. Add new native proofs to `scripts/test/ci-files.ts`.
- Only the operator starts full-release CI; agents never dispatch or rerun CI workflows. The
  [focused-test script](docs/reference/guards-and-tests.md#focused-tests-in-github-actions) is
  scratch feedback, not a release or merge proof.
- Native proofs run in CI only for operator-started releases. Release checks build the
  web bundle, run coverage alone, then perf; coverage already selects unit, integration and
  architecture, so do not rerun those full suites for unchanged inputs.
- PC feedback never blocks a repair push or replaces the published head's PR CI; never run
  macOS-native proofs there. Keep machine slot details in `.work/operations.md`.
- Refresh `scripts/test/ci-durations.json` when job end times spread more than a minute. Generate
  derived files through their source, never by hand.
- Before local coverage, verify free memory, no swap pressure and no listener on the runtime
  backend port; a resource refusal leaves the gate unrun.
- Before publication, stage the exact candidate and run `npm run privacy:check`; inspect its prose
  and images too. Keep public instructions free of local paths, machine/account identities,
  terminal handles, secrets and employee identifiers.

## Runtime safety

- Fail loud on missing or corrupt data and failed checks: throw a named error naming the offending
  field or value, or propagate a distinct unknown that the caller checks. A fallback needs a valid
  expected case and recorded verification (live evidence for selectors or page state, tests for
  pure logic); unless both are clearly met, throw. Never turn a failed check into a default,
  cached result, alternate selector or swallowed success. Retry the same transient operation only
  where its write policy permits it. Swallow an optional failure only when no caller depends on it.
- Preserve dry runs, write intents, parked writes, receipts, evidence and UNKNOWN/no-retry behavior.
  Transaction verification uses `dryRun=true`: no UCPath submit or Kuali finalization.
  A transaction-free live read creates no transactions and no durable effects.
- Port workflow behavior by copying production reference code and recording its commit and path
  in task evidence, then verify live. Prefix cross-repo paths `legacy:`. Never import, invoke,
  proxy or read production state, delete production files, or make committed gates depend on legacy.
- Before changing authority or path resolution, read the operating reference and
  `config/runtime-isolation.json`. Preserve database/settings coupling, terminal tombstones,
  verified backups and boot/upgrade authority. Never discard one authority half to hide a mismatch.
- Before configuration or live work, read the operating reference's Environment section.
  Preserve existing `.env` files. Never print credentials or log secret or canary values. Reject
  unavailable subjects before secret reads or browser launch; never substitute canaries or use
  settings/credentials as test-input fallbacks.
- Read-only selectors, login checks, collectors and live dry runs are pre-authorized. Use headless
  sessions by default and snapshot before choosing locators. Fast Duo requires full Chromium;
  read `fast-duo/README.md`. Close only owned sessions; skip unavailable systems and continue
  with the rest.

## Read by task

`ref <slug>` means `docs/reference/<slug>.md`. Read relevant sections, not whole catalogs.

| Task | Read first |
| --- | --- |
| Workflow | `ref task-contract`, `ref workflow-model`, `ref stores`, [authoring guide](docs/guides/workflow-authoring.md) |
| Backend, CLI composition | [Backend instructions](src/backend/AGENTS.md) |
| Dashboard, client, CLI | [Dashboard instructions](src/dashboard/AGENTS.md) or the backend's, `ref frontend-backend-integration`, `ref dashboard-surfaces` |
| Dashboard mock variants | [`ui-mock`](.agents/skills/ui-mock/SKILL.md) |
| Settings, config, secrets | `ref clock-config-secrets` |
| Worker, browser, external write | `ref execution-and-sessions`, `ref write-safety`, the system's `AGENTS.md` before its driver |
| Intake, OCR, Edit Data | `ref data-intake-and-edit-data` |
| Tests and guards | `ref guards-and-tests` |
| Relay failure | [`hr-debug`](.agents/skills/hr-debug/SKILL.md) |
| Live dry run | [`/verify`](.agents/skills/verify/SKILL.md) and its [feature map](.agents/skills/verify/features/README.md) |
| Environment, porting, conventions | [Operating reference](.agents/skills/hr-manage/references/operating-reference.md) |
