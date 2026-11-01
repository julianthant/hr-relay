# Relay

Relay is the production rebuild of `hr-automation`. It is a local desktop app for one HR operator. It runs on one machine and is never hosted. Until cutover,
`/Users/julianhein/Projects/hr-automation` is production and the rollback asset.

## What to build

- Start with the assigned brief and its folder's README, then the
  [codebase map](docs/rebuild/reference/codebase-structure.md). Work only on the assigned task.
- Work assigned through a brief follows that brief and its folder's README. Receipts, notes and
  handoffs go in the brief's evidence folder inside `.work/`, never in a commit.
- The roadmap at docs/roadmap/roadmap.md lists the key implementations and their status.
  Update it only when the operator or your brief asks.
- Build the wiring base first: every dashboard component connected to the backend, with no
  workflow-specific behavior. Then activate served workflows one at a time, in the order
  defined under Git. Isolated workflow implementation may proceed in parallel.
- A workflow is wired across Run, Rerun, Queue rows, Logs, Explorer, OCR/Records where it has them,
  notifications and Analytics. It is done after a dry run and operator sign-off.
- The production codebase (`/Users/julianhein/Projects/hr-automation`) holds each workflow's complete
  behavior. Read it, and port by copying with the legacy commit and path recorded in the task's evidence folder.
- Approved workflow maps A and B, with their safety corrections, authorize workflow coding. They
  own inputs, steps, sub-steps, log-panel timelines, results and scenarios. At morning review, the
  operator reviews generated Explorer timelines and dry-run Logs. Activation remains sequential after a
  dry run and operator sign-off, in the order under Git.
- Each workflow switches from mock to served data through one static per-workflow switch. Never fall
  back from served to mock at runtime. A served failure shows its failure state.

## Codebase

One person builds and maintains this codebase. Keep it organized, clean and easy to follow.

The repository holds only the current version. No compatibility readers, old migration steps, porting or change records, lesson files, history or backups of old code. A stored-data change ships as a forward migration that deletes the reader it replaces.

- Each concept has one home. [docs/rebuild/reference/codebase-structure.md](docs/rebuild/reference/codebase-structure.md)
  is the map. Update it in the same commit as any move.
- A change deletes the code it replaces. No shims, parallel old and new paths, commented-out code or
  unused exports.
- Add a layer only when it has a second real use. Prefer one cohesive module over many tiny files.
- Tests mirror source once under tests/: drop src/; keep full paths for scripts/,
  duo-autopilot/ and root configs.
  Unit <module>.test.ts and integration <module>.integration.test.ts sit together;
  split files over about 800 lines by topic. Architecture/parity/perf/types stay in
  their own trees; fixtures and helpers live in tests/support/.
  Delete tests for behavior that no longer exists.
- Add a guard only to prevent a real, recurring mistake, and record its reason in
  `docs/rebuild/guard-inventory.json`.
- Comments: only where the code cannot say it, in a few words.
- Docs describe the system as it is now. When a rule changes, update its owning doc in the same
  commit. Keep history out of the repository.
- Instructions live only in `AGENTS.md` files. Never add `CLAUDE.md`.

## Dashboard

- Replace mock data with real data. Keep every component exactly as it is: use all of them, add none,
  remove none.
- Wiring changes producers, view-model inputs, ports, client methods, hooks, callbacks and the
  backend. A component file changes only to receive data instead of importing a mock, and it renders
  identically.
- The component set is fixed, but what a workflow shows follows the real workflow. Its Explorer
  timeline, Run and Rerun steps and Logs steps may change in count, order, text, branches and
  sources, built only from existing components. Generate the Explorer timeline from the workflow's
  registered definition, never by hand.
- If real behavior needs a changed or new component, describe it (what, where, why) and ask the
  operator. Approved components are built first in a UI-only task (components and mock data, no
  backend), then wired.
- Extend `src/dashboard/client/index.ts` and the shared models in `src/models/**`. Never add a second
  API or type layer. Keep each view model's loading, empty, failure, refusal and uncertain states.
- Read `src/dashboard/AGENTS.md` before any dashboard change.

## Backend

- Only the operator, through the dashboard, uses the backend. The dashboard assistant may use
  allowlisted reads and make proposals through the dashboard-owned typed client. Only explicit
  operator confirmation dispatches a validated proposal through that client. The assistant has no
  arbitrary backend, shell, HTTP or credential access. It cannot approve gates or bypass safety.
  No other agent or external API access is allowed.
- Build for one operator on one machine. Add nothing for several users, remote clients or hosting.
- Keep every HR write protection: dry runs, write intents and parked writes, receipts and evidence,
  and never retrying an UNKNOWN submit.
- AI is limited to OCR and the dashboard assistant through the operator's ChatGPT subscription,
  connected in Settings with OpenAI's open-source "Sign in with ChatGPT" flow (OAuth with PKCE,
  loopback redirect, Responses API). Store its tokens only in the local credential store.
  Add no other AI provider.
- Every failure has a defined error code, and the dashboard shows the text mapped to that code. The
  browser-safe home for codes and text is `src/models/failures/error-catalog.ts`; add them together.
- Use TypeScript, Hono, SQLite, HTTP and SSE. Keep HTTP parsing and app composition thin.
  Repositories own durable storage.
- Read `src/backend/AGENTS.md`, and the system's `src/backend/systems/<system>/AGENTS.md` before
  touching a system driver.

## Git

- `main` is production: the released code, pushed to `origin/main`. `staging` is the
  integration branch the operator previews. Each task works on `feature/<slug>` branched from
  `staging`, in the main checkout's gitignored `.worktrees/<slug>/` folder.
- The operator launches every task. Non-overlapping feature implementation may run in parallel.
  Workflow activation stays sequential: Person Lookup → Separations → OCR/Emergency Contact →
  OnBase → Onboarding, after each workflow's dry run and operator sign-off.
- Finish a feature on its branch. Run `npm run test:local`, `npm run typecheck` and `npm run lint`,
  then push and open a ready (non-draft) pull request into `staging` with auto-merge on. It merges
  with a merge commit once its required checks pass on a branch up to date with `staging`; the merge
  train keeps it current and Cursor Bugbot reviews every push. The orchestrator session watches its
  open pull requests and fixes red checks, real Bugbot findings and `merge-conflict` labels on the
  pull request branch; it is the only agent that pushes to an open pull request. The operator handles
  only pull requests labeled `needs-human`.
- Pull requests into `staging` run static, privacy, unit, integration and architecture checks;
  parity runs on the release pull request into `main`, and a red release is fixed by a pull request
  into `staging`. Run the tests related to your change locally before pushing, and parity when the
  change touches a dashboard screen.
- A test file that needs macOS goes in `MACOS_FILES` in `scripts/test/ci-files.ts`. When CI jobs'
  end times spread more than a minute, refresh `scripts/test/ci-durations.json` (see
  `docs/rebuild/reference/guards-and-tests.md`).
- A pull request bundles a good amount of related work, so CI runs once per batch rather than after
  every small fix. Keep commits logical inside it; never mix unrelated features. Title and describe
  what changed and why. Pull a branch before continuing work on it.
- Push fixes to an open pull request as one batch. While its CI runs, push only once that run has
  already failed: each push cancels the running check.
- A pull request that intentionally changes a dashboard screen updates that screen's parity, visual
  and accessibility references in the same pull request; the operator reviews them in the `staging`
  preview.
- After the merge, GitHub deletes the remote branch; delete the local branch and remove its worktree
  (save anything in `.work/` first), then report done.
  The operator previews `staging` in the main checkout, which owns the store, credentials and
  ports: stop the dashboard, switch to `staging`, start it. A rejected feature is reverted on `staging`.
- A release pull request merges `staging` into `main` with a merge commit, only on the operator's
  explicit go. Sync `main` back into `staging` afterward. Push feature branches only through this
  pull-request flow; push nothing else without explicit instruction.
  Required check names are in [repository governance](docs/repository-governance.md).
- A `staging` with a store migration is previewed only after a verified `storage backup`.
- Verify base, path and ownership before editing. Stage exact paths and commit by logical category.
  Never switch, reset or repurpose another checkout.
- Briefs, receipts and evidence live in the main checkout's gitignored `.work/` folder; worktrees
  write there by absolute path. Remove a task's evidence folder once nothing needs it.
- Once a feature reaches `main`, remove its worktree registration, folder and branch, after its
  evidence and unknown files are saved.

## Checks

- During a task: focused tests for the changed behavior, `npm run lint`, and the affected static and
  generated checks. Run `npm run test:local` for tests that need this machine or its accounts.
  Update tests when behavior changes, and say when none exist.
- Before push: `npm run test:local`, `npm run typecheck` and `npm run lint`. Cloud runs unit,
  integration and architecture on macOS and Windows, plus static, privacy and parity. A release
  pull request then runs `npm run web:build`, `npm run test:coverage` alone, and `npm run test:perf`.
  Coverage selects the unit, integration and architecture suites without perf, so don't run those
  three separately.
- A lint failure is a task failure. Keep assertions, test membership, isolation, coverage floors and
  timeouts. Never report an unrun check as passed.
- Generate derived files at their source. Never hand-edit them.

## Runtime safety

- Fail loud. Missing or corrupt data and failed checks never become defaults, cached values,
  alternate selectors or swallowed results. Throw a named error, or return a distinct unknown that
  the caller checks. Allow a fallback only for a valid expected case with recorded verification.
- Never log secret or canary values.
- Never import, invoke, proxy or read production (`hr-automation`) state. Port by copying, record the
  source commit and path in the task's evidence folder, then verify live. Never delete production files. Prefix cross-repo paths
  with `legacy:`.
- `config/runtime-isolation.json` owns the rebuild's ports, browser session and state, artifact,
  lock and auth roots. Read the operating reference before changing authority or path resolution.
  Preserve settings/database coupling, terminal tombstones, explicit verified backups and the current
  boot/upgrade authority. Never discard one authority half to hide a mismatch.
- Never overwrite an existing `.env` or print credentials. Before configuration or live work, read
  the operating reference's Environment section. An unavailable subject blocks before secret access
  or browser launch. Never substitute canaries.
- Read-only selectors, login checks, collectors and dry runs are pre-authorized. Transaction
  verification uses `dryRun=true`: no UCPath submit, no Kuali finalization. A transaction-free
  live read creates no transactions and no durable effects. Never retry an UNKNOWN submit.
- Browser work uses playwright-cli, headless by default. Snapshot before choosing locators. Duo
  Autopilot needs full Chromium (`duo-autopilot/README.md`). Close only your own sessions, and skip a
  system that is down while continuing with the rest.

## Read by task

`ref <slug>` means `docs/rebuild/reference/<slug>.md`. Read only the relevant sections.

| Task | Read first |
| --- | --- |
| Any task | The assigned brief, its folder's README, the [codebase map](docs/rebuild/reference/codebase-structure.md) and the [roadmap](docs/roadmap/roadmap.md) |
| Workflow | `ref task-contract`, `ref workflow-model`, `ref stores`, [authoring guide](docs/rebuild/guides/workflow-authoring.md) |
| Dashboard, client, CLI | `src/dashboard/AGENTS.md`, `ref frontend-backend-integration`, `ref dashboard-surfaces`; use `/ui` for frontend work |
| Settings, config, secrets | `ref clock-config-secrets` |
| Worker, browser, external write | `ref execution-and-sessions`, `ref write-safety`, the system's `AGENTS.md` |
| Intake, OCR, Edit Data | `ref data-intake-and-edit-data` |
| Tests and guards | `ref guards-and-tests` |
| Environment, porting, conventions | The [operating reference](.agents/skill-library/repository-work/REFERENCE.md) |

## Commands

| Purpose | Command |
| --- | --- |
| Dev backend + Vite | `npm run dashboard` (Ctrl+C stops both) |
| Production bundle and server | `npm run web:build`, then `npm run dashboard:prod` |
| Workflow dry run | Sign in to the dashboard, use Run, and select Dry Run for a workflow that supports previews |
| Visual contract | `npm run test:parity` (desktop only) |
| Workflow manifest | `npm run build:manifest`, then `npm run build:manifest:check` |
| Store catalog | `npm run stores:catalog`, then `npm run stores:catalog:check` |
| Roadmap | `npm run roadmap`, then `npm run roadmap:check` |
