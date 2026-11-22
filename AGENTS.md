# AGENTS.md

## Project overview

Relay runs HR workflows for internal staff from one local dashboard. Read [README.md](README.md)
for the product, [architecture](docs/ARCHITECTURE.md) for its design, the
[codebase map](docs/reference/codebase-structure.md) for owners, and the
[terminology reference](docs/reference/terminology.md) for project vocabulary.

- Planned work is a GitHub issue in the "HR Relay Roadmap" Project. Work only on the issue your
  spec names; report progress, commits, check results, unrun obligations and open decisions to the
  coordinator, which records them on the issue's item.
- Treat the main checkout's ignored `.work/` as scratch: per-task evidence at absolute paths from
  worktrees, deleted when the task merges. Never commit it. Read `.work/operations.md` there for
  machine roles, slots and ports.
- Keep instructions in `AGENTS.md` only. Do not create `CLAUDE.md`.

## Setup commands

- Install: `npm ci`
- Dashboard (backend and web): `npm run dashboard`; backend only `npm run backend`; web only `npm run web`
- CLI: `npm run cli`
- Names: `npm run names:check` before the first push and before opening a PR
- Privacy: `npm run privacy:check` before publication

## Code style

- Keep one home per concept. Update the codebase map in the same commit as a move.
- Keep only current code and current documentation. Delete replaced code and obsolete tests.
  Stored-data changes use forward migrations that remove the readers they replace. Add no
  compatibility readers, shims, old-code backups, history comments or change ledgers.
- Add a layer only for a second real use. Prefer one cohesive module to many tiny files.
- Add a guard only for a real recurring mistake, with its reason in `docs/guard-inventory.json`.
- Use kebab-case filenames, named exports, `.js` relative imports and `.tsx` only in the dashboard.
  Use recursively strict Zod schemas at durable, wire and config boundaries; no unchecked casts
  or `any`. Read time through `src/rules/time/clock.ts`; keep `manualClock` test-only.
- Keep workflow definitions browser-safe: value imports only from Zod, `src/models/**`,
  `src/rules/**` and audited `src/workflow-kit/**`. Read the authoring guide for source layout.
- Freeze registry exports recursively at module load. Use structured errors rather than
  `console.*` in `src/`. Add failure codes and display text together in
  `src/models/failures/error-catalog.ts`.
- Generate derived files through their source, never by hand.

## Testing instructions

- Tests, typecheck and lint run in GitHub Actions. Locally, run only the integration test files
  your issue names or you add or change, by name, one at a time. `npm run privacy:check` is light
  and may run.
- Pushing a `task/**` branch runs the Development fast plan on that commit. Wait on it with
  `gh run watch <run-id> --exit-status`; the green run at your SHA is the reviewer's evidence.
- Never commit a failure caused by the change; a demonstrated base failure may proceed with its
  evidence recorded. Report unrun tests for the reviewer and CI.
- Mirror source once under `tests/`: drop `src/`, retain `scripts/`, `fast-duo/` and root paths.
  Put `<module>.test.ts` beside `<module>.integration.test.ts`; split files over about 800 lines
  by topic. Keep architecture, mocks, perf and types in their own trees; shared fixtures and
  helpers belong in `tests/support/`.
- CI plans:
  - Task pushes and other development PRs run the fast Ubuntu plan: plan, lint, static, privacy,
    three unit shards, two architecture shards, the affected integration shards (at most eight;
    every affected shard on `feature/*` PRs), `proof` and the `development` gate. Drafts run
    static, privacy and selected unit shards. A `task/**` PR runs only the `development` gate:
    names, the workflow allowlist and the push run's `proof` at the PR head SHA. Edited PRs rerun
    the gate only.
  - Every 20 minutes Development decides in seconds whether to start the full run on the
    development head: all suites, 30 integration shards, perf, smoke, native macOS, CodeQL and
    npm audit. It starts only when that head has no green full run, did not start one in the last
    six hours, and CI is idle or no full run started in six hours.
  - Staging PRs from `cut/*` and staging-to-main releases run the portable Ubuntu suites plus
    static, privacy, perf and smoke, and pass only on the green full run of the cut's exact
    content. The main-to-staging sync needs no full run.
  - Hotfix and manual release checks run the selected suites, including native proofs and
    CodeQL on hotfixes; ready pull requests also build the web bundle for perf and smoke, while
    manual releases skip those jobs. Only the operator starts full-release CI; agents never dispatch or
    rerun CI workflows.
- Keep `NATIVE_FILES`, `SERIAL_FILES` and `SERIAL_STORAGE_FILES` out of Ubuntu shards, retaining
  release coverage. Local integration runs skip those files unless `RELAY_TEST_NATIVE=1`. Add new
  native proofs to `scripts/test/ci-files.ts`. Never run macOS-native proofs on the PC.
- Refresh `scripts/test/ci-durations.json` when job end times spread more than a minute.
- Docs-only changes need link, whitespace and affected generated-output checks and any tests that
  parse the edited documents; prose alone needs no runtime suite.

## PR instructions

- Give each piece of work one name and use it everywhere. A feature is `<area>-<deliverable>`; the
  area is a screen name, a workflow ID, or a non-screen area such as `storage`, `workers` or `ci`.
  A ticket is `<feature> / <lane>`; a lane is one to three words, unique within its feature.

| Thing | Name |
| --- | --- |
| Feature branch | `feature/<feature>`: from `origin/development`, one PR into `development` |
| Ticket branch | `task/<feature>/<lane>`: from its feature branch, merged back with `--no-ff`, no PR |
| Standalone fix | `fix/<area>-<symptom>`: from `origin/development`, one issue, one PR into `development` |
| Chore | `chore/<area>-<change>`: tooling, tests or docs with no product change; from `origin/development`, one PR into `development` |
| Hotfix | `hotfix/<area>-<symptom>`: from `main`, one PR into `main` titled `Hotfix: <what it fixes>`; the same commits reach `development` through a `fix/*` PR |
| Design | `design/<area>`: mock with real components for operator approval, never merged |
| Worktree | `.worktrees/<feature>.<lane>`; the feature's own checkout is `.worktrees/<feature>` |
| PR title | `<Area>: <what the operator gets>` |
| Spec | `.work/specs/<feature>.md` |
| Evidence | `.work/evidence/<feature>/<lane>/`, deleted when the ticket merges |

- Use no other branch prefix. Keep the main checkout on a clean `development` and work only in
  worktrees. A ticket lives on one machine with its tests; work moves between machines only as
  pushed branches. Leave no stash behind: commit to the ticket branch.
- Push your `task/**` branch without asking. Merge it into its feature branch only after the
  reviewer clears its SHA, then remove its worktree and branch in the same step.
- Separate backend and UI lanes for one area; merge the backend first.
- `main` is released production, `staging` operator-preview integration, `development` the
  feature integration base. Feature, fix and chore branches reach `development` through a PR whose
  body says `Closes #<issue>`, with auto-merge on the required checks. `staging` receives PRs from
  `development` only, one coherent batch at a time. Never push directly to `main` or `staging`.
  Merge the latest base into your branch; never rebase or force-push. Never merge a PR by hand.
- Workflow behavior PRs wait for a live dry run and operator sign-off. Required check names live
  in [repository governance](docs/repository-governance.md).
- Refer repairs requiring workflow/CI configuration edits, HR write-path changes, weakened guards
  or expanded scope to the operator.
- Release only on the operator's explicit go: merge `staging` into `main` with a merge commit,
  then sync `main` back into `staging`.

## Security considerations

- Before publication, stage the exact candidate and run `npm run privacy:check`; inspect its prose
  and images too. This repository is public: keep instructions, issues and PRs free of local
  paths, machine/account identities, terminal handles, secrets and employee identifiers.
- The main checkout owns runtime state, credentials and ports.
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
