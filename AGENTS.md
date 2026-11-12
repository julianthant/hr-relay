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
  worktrees, deleted when the task merges. Never commit it. Read the local operations note the
  ticket names for machine constraints.

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
- Name every branch, worktree, lane and ticket for one dashboard area and one kind of work.
  Split work across areas into separate lanes. Use screen names, workflow IDs, or a non-screen
  area such as `storage`, `workers` or `ci`; never name a branch only `ci/<slug>`.
- Name deliverables in one to three words. Use `ui` or `backend` alone only for that entire side
  of an area. Tickets identify UI, backend or workflow work. Separate backend and UI lanes for one
  area; merge the backend first.
- Put worktrees in the main checkout's ignored `.worktrees/`, with the branch prefix removed
  from the folder name.

| Kind | Branch | Base and destination |
| --- | --- | --- |
| Design | `design/<area>` | Mock with real components for rendered operator approval; never merge or open a PR. |
| Feature | `feature/<area>-<deliverable>` | Branch from `origin/staging`; one ready PR into `staging`. |
| Task | `task/<feature>/<slice>` | Branch from its feature; merge back with `--no-ff`, no PR or GitHub CI. |
| Fix | `fix/<area>-<symptom>` | Branch from `origin/staging`; one bounded PR into `staging`. |
| Check | `check/<what>` | Local live-check build; never merge, remove after use. |
| Scratch | `scratch/<lane>-<n>` | Focused CI feedback only; never merge, remove after use. |

### PR and release flow

- The `dev-auto` (orchestrator), `duo` (coder and reviewer pair) and `ship` (publish to merge)
  skills hold the lane, review-loop and PR procedure. Load the one your ticket names.
- Changes reach `staging` only through a PR. Never push directly to `main` or `staging`. Merge the
  latest base into your branch; never rebase or force-push. Never merge a PR by hand.
- Workflow behavior PRs wait for a live dry run and operator sign-off. Required check names live
  in [repository governance](docs/repository-governance.md).
- Refer repairs requiring workflow/CI configuration edits, HR write-path changes, weakened guards,
  unrelated parity updates or expanded scope to the operator with `needs-human`.
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
- Native proofs and parity run in CI only for operator-started releases. Release checks build the
  web bundle, run coverage alone, then perf; coverage already selects unit, integration and
  architecture, so do not rerun those full suites for unchanged inputs.
- PC feedback never blocks a repair push or replaces the published head's PR CI; never run
  macOS-native proofs or parity there. Keep machine slot details in the local operations note.
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

## Mock variants

`ui-mock` builds the variants; these rules decide where and how in Relay. Read
[DESIGN.md](src/dashboard/DESIGN.md), the [dashboard instructions](src/dashboard/AGENTS.md) and
[PARITY.md](src/dashboard/PARITY.md) first, and open the specimen page (`npm run web`, then
`http://localhost:5174/kit.html`) before choosing primitives.

- Work on a `design/<area>` branch. Never merge it or open a PR.
- Build every variant in the running dashboard through the parity harness from existing components,
  primitives, tokens and variants. Never write standalone HTML or rebuild a component by hand. Keep
  every real element of a component you extend (footers, IDs, timings, icons); give each control
  one home. When a mock file sits outside the CSS build's scan, use only utility classes that exist
  in the built stylesheet.
- Desktop only: 1280×720 and the 1024×720 minimum.
- Make three directions for a new piece, two when extending a screen. Each set answers one design
  question and varies layout, hierarchy or interaction, never only order or color; name each
  direction's benefit and cost. Keep every scenario coherent: queue row, status, header, timeline
  and Logs tell one story, and only actions valid in that state appear.
- Product surfaces read a variant or scenario with `mockParam(<name>)` from
  `src/dashboard/app/mock-surfaces.ts`, which returns `null` unless `tests/parity/app-entry.tsx`
  set the harness flag. A standalone control goes in
  `tests/support/helpers/dashboard/controls/<name>-preview.tsx`, exporting `ControlPreview`, opened
  at `/?fixture=<name>&state=<scenario>`. Fixture data sits beside the surface's existing fixtures.
- Fixtures are synthetic and fictional; reuse synthetic IDs passing fixtures already use.
- Missing served data is a backend or projection gap: list it in the hand-over. Never design a
  control or placeholder around it.
- Render with a scene spec in `tests/parity/` modelled on `zz-status-mock.test.ts`
  (`startFixtureServer` from `tests/support/helpers/dashboard/fixture-bff.ts` on
  `PARITY_DIST_DIR`, `relayParityTheme` per theme, PNGs to a folder from an environment variable).
  Run it alone: `npm run test:parity -- <spec> -g "<title>"`. Capture every variant and scenario
  light and dark at 1280, and at 1024 where layout changes, into the task's `.work/` folder, and
  look at every frame. Frames are evidence, not references: never run
  `npm run test:parity:update` for a mock.
- Hand over an index beside the frames: each surface, variant and scenario with benefit and cost,
  backend gaps, open behavior choices and a recommended pick. Record it on the ticket and wait for
  the operator's pick. Run typecheck, lint on changed files and `npm run privacy:check` first.
- After the pick, build only the chosen variant in a UI-only task with mock data and its parity
  references, before wiring. Remove the mock switch and scene spec once the implementation ships
  unless the operator keeps them.

## Read by task

`ref <slug>` means `docs/reference/<slug>.md`. Read relevant sections, not whole catalogs.

| Task | Read first |
| --- | --- |
| Workflow | `ref task-contract`, `ref workflow-model`, `ref stores`, [authoring guide](docs/guides/workflow-authoring.md) |
| Backend, CLI composition | [Backend instructions](src/backend/AGENTS.md) |
| Dashboard, client, CLI | [Dashboard instructions](src/dashboard/AGENTS.md) or the backend's, `ref frontend-backend-integration`, `ref dashboard-surfaces` |
| Dashboard mock variants | [Mock variants](#mock-variants), then `ui-mock` |
| Settings, config, secrets | `ref clock-config-secrets` |
| Worker, browser, external write | `ref execution-and-sessions`, `ref write-safety`, the system's `AGENTS.md` before its driver |
| Intake, OCR, Edit Data | `ref data-intake-and-edit-data` |
| Tests and guards | `ref guards-and-tests` |
| Relay failure | [`hr-debug`](.agents/skills/hr-debug/SKILL.md) |
| Live dry run | [`/verify`](.agents/skills/verify/SKILL.md) and its [feature map](.agents/skills/verify/features/README.md) |
| Environment, porting, conventions | [Operating reference](.agents/skills/hr-manage/references/operating-reference.md) |
