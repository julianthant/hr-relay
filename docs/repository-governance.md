# Repository governance

The [Conventions](../AGENTS.md#conventions) own branch naming. The [root Git instructions](../AGENTS.md#git) own release policy.

## Branch protection

`staging` requires a pull request and passing checks on a branch that is up to date with `staging`,
with no human approving review, so green pull requests auto-merge with a merge commit. Both
branches block force pushes and branch deletion. Merge commits only; squash and rebase merging are
disabled; linear history is not required. `main` does not auto-merge: the operator merges the
release pull request.

| Branch | Required CI check names |
| --- | --- |
| `staging` | `static`, `privacy`, `unit`, `integration`, `architecture` |
| `main` | the `staging` checks, plus `release` |

Ready pull requests into `staging` or `main` run `perf` and `smoke` as separate Ubuntu jobs,
including Markdown-only pull requests. The `unit` proof fence requires both results before the
outer gate can pass. Each job installs Chromium, builds the dashboard and uses tmpfs for test temp,
like an Ubuntu integration shard. `perf` runs `npm run test:perf`; `smoke` runs
`npm run test:smoke` against the built dashboard. Drafts and manual releases run neither job.
No workflow runs coverage. `npm run test:coverage` remains a local command with unchanged floors.
The [release instructions](../AGENTS.md#pr-and-release-flow) own promotion and branch synchronization.

## Merge train and automatic fixes

Push roadmap-only commits (`docs/roadmap/**`) straight to `staging` to skip staging CI and the merge train.
`staging.yml` starts `.github/workflows/merge-train.yml` (a `workflow_call` workflow) after the
`staging` gate on a PR, on other pushes to `staging`, and when auto-merge is enabled
on a PR targeting `staging`.
It labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then merges
`staging` into open, non-draft, same-repository PRs by `julianthant` targeting `staging` that have
auto-merge enabled and lack the latest `staging`. Enabling auto-merge starts a train run without
waiting for another merge. Each update starts CI on the latest `staging`; per-PR supersession
cancels the older run. Auto-merge then lands whichever PR passes first. A PR it cannot update gets
`merge-conflict`. If GitHub's update reports a conflict, the train attempts a merge in a temporary
worktree. Conflicts exclusively in `scripts/build/generated-outputs.ts`'s registered outputs are
resolved by running the generators against the combined sources. Catalog conflicts must be wholly
inside the generated section of `stores.md`; conflicts in authored text refuse. Generator failure
or any authored conflict prevents a push. Before an ordinary fast-forward push, the train rechecks
the PR's eligibility and expected head; a moved head is left to its owner. Successful updates clear
`merge-conflict`. The workflow uses the `TRAIN_TOKEN`
secret (fine-grained, this repository, Contents and Pull requests read/write), because pushes made
with the default token do not start CI.

The merge train uses a blob-filtered full-history checkout, retaining ancestry and fetching
historical file contents on demand within its five-minute job budget.

Cursor Bugbot reviews every push and only comments. The
[PR flow](../AGENTS.md#pr-and-release-flow) routes reviewer/coder responsibility and owns repairs
and escalation. A `needs-human` label
identifies work requiring the operator. Red required checks prevent a merge.

CI takes Node from `package.json` engines and caches npm. The [check rules](../AGENTS.md#checks)
own runner placement and release authorization. Native proofs and the padded-receipt storage
upgrade run in separate single-worker invocations, preserving their
existing deadlines under duration-based assignment. Native integration jobs first verify the
full-Chromium installation through `scripts/test/chromium-preflight.ts` by opening a blank page
and observing the owned browser process exit. This one-time setup has no retries; timed proofs still use fresh profiles and their existing
deadlines. A full staging run uses three
Ubuntu unit shards, two architecture shards and thirty integration shards, plus lint, static and
privacy and the separate perf and smoke jobs. On operator-started full releases, use all five macOS
runners for native files.

`.github/workflows` holds `staging.yml`, `production.yml`, `checks.yml` and `merge-train.yml`.
`Staging` (`staging.yml`) runs for pull requests into `staging` and pushes to `staging`; it runs `names`, then
`checks.yml` with kind `portable`. `Production` (`production.yml`) runs for pull requests into `main` and for a
manual start; it calls the same `checks.yml` with kind `release`; the plan adds selected macOS native jobs.
A run's title is its pull request title; a manual Production run takes its title from its required `title` input. `checks.yml` is the only file that defines test jobs.

Security jobs run only in `Production`; Staging runs none. `codeql` (CodeQL analysis of JavaScript and TypeScript)
runs for pull requests into `main` and for pushes to `main`, so the default branch always has an analysis; a push to
`main` runs only `codeql`. `dependencies` (`npm audit --omit=dev --audit-level=high`) runs for pull requests into
`main`. Results appear under the repository's code scanning alerts, which needs CodeQL default setup off.

Each pull request run ends in one gate job: `staging` needs `names` and `checks`; `production` needs `checks`, `codeql` and `dependencies`.
The gate fails when any job it needs failed or was cancelled, and no other job repeats a result. The `production` gate
also fails for a pull request whose head is neither `staging` nor `hotfix/*`; both heads run the full plan, and a manual
start passes. The merge train starts from `staging.yml` after the `staging` gate, on a push to `staging` and when
auto-merge is enabled.

Both workflows use per-PR/manual-branch supersession with a workflow/PR-or-ref concurrency
group and `cancel-in-progress: true`. New pushes cancel older runs for that same key. Each entry
queues one complete reusable check call with `queue: max` and `cancel-in-progress: false`.
Staging uses the `ci-runners` job-level FIFO; Production uses its own `release-runners` FIFO,
so Production neither waits behind nor blocks staging PR runs. Each admitted call holds all proofs,
perf, smoke and timing publication until its callee finishes; the callees never reacquire admission. GitHub orders waiting
calls by arrival, accepts at most 100 pending calls, and cancels extra arrivals on overflow.

The merge train is outside the admitted call, after the `staging` gate, while remaining
inside parent per-PR supersession. Enabling auto-merge starts a full `Staging` run for that PR (the same per-PR group, so it replaces a run still
in progress for the same head), and its own gate decides the `staging` check; a push to `staging` never cancels. Batch repair pushes to avoid redundant CI work.

`scripts/test/ci-plan.ts` owns typed selection, proof, publication and timing-history policy. Both timed callees
retain explicit test budgets. `checks.yml` jobs are `changes`, `lint`, `static`, `privacy`, `ubuntu`, `macos`,
`unit-proofs`, `integration`, `architecture`, `perf`, `smoke` and `unit`; the plan leaves
`macos` empty outside a full release, and `unit-proofs` runs only for the release kind.
It has no `timings` job. The `unit` job is one checkout
and one install: it checks proofs, merges durations, uploads `ci-timings` only when every proof passed,
then runs final verification. It runs unless cancelled, excludes downstream train to avoid a cycle,
and rejects failed, cancelled or missing outcomes.
Cancellation stops that inner checkout/install work. The always-running gate fails on a failed or
cancelled needed job, so those results cannot merge. The required names are `staging` on staging and
`production` on main. The train may stop when cancelled.

Run lint, static, privacy and affected portable unit, integration and architecture suites for ready PRs
into `staging`. For PRs from `staging` into `main`, add selected native proofs.
Path filters select affected suites. Draft pushes run lint, static, privacy and
affected unit files; becoming ready starts full applicable validation. Only the operator may start
a manual full-release dispatch; it selects all routine suites, including native proofs. Other PR heads targeting `main`, except `staging` and `hotfix/*`, omit
native proofs; their `production` gate fails. Drafts cannot merge. Protected-branch pushes do not
repeat CI; Markdown-only ready PRs run lint, static, privacy, perf and smoke. A deliberately omitted suite has a successful
summary, while failed change detection or any failed/cancelled selected group fails its summary.

Timing discovery enumerates registered workflow IDs for the exact `staging.yml` and `production.yml` paths,
then orders their successful histories together, newest first, excluding the current run. An
unregistered new release workflow is not queried. Unexpected API failures fail CI; a valid absence
of retained reports selects the committed seed. Every admitted run downloads the newest retained
eligible `ci-timings` artifact before selecting files. Its immutable `ci-balancing` artifact gives every shard identical duration inputs.
After mandatory proof validation succeeds, the `unit` job merges its portable/native file reports
into inherited timings and publishes `ci-timings` for the next run. A failed or cancelled proof,
or a plan with no test jobs, does not upload that artifact. Report names include the runner OS and selection group;
when both platforms report one file, the slower duration wins independently of artifact order.
Measurements for omitted suites remain intact.
Without a retained artifact, CI explicitly uses the committed `scripts/test/ci-durations.json` seed;
unmeasured files use the positive measured median, or one second without measurements. Invalid
reports or failed downloads fail CI. The [check rules](../AGENTS.md#checks) own timing-seed maintenance. The
[test reference](reference/guards-and-tests.md#2-vitest-selection-and-commands) owns file
membership and selection details.

Playwright browser caches use `~/Library/Caches/ms-playwright` on macOS, keyed by runner OS, architecture, browser set and
`package-lock.json` digest (plus the image on macOS). An exact macOS hit skips installation. A miss installs the required browsers. There are no partial-key restores. CI never uploads HR evidence.

## Privacy check

`npm run privacy:check` scans Git's index, including staged new files; unstaged edits and untracked
files are outside its input. The [check rules](../AGENTS.md#checks) own pre-publication validation.
CI checks the checked-out commit through its index. Findings contain only paths and rule names.

Private documents belong in ignored `.local-private/`. The scanner rejects roster formats, PDFs,
environment files, credential paths and recognizable credential/employee ID/SSN patterns. Text checks cover
UTF-8 (including NUL bytes) and UTF-16 in either byte order; unsupported text fails closed. PNG and
WebP assets are recognized by extension and format signature; their bytes are still checked for
recognizable embedded text. The check does not inspect image pixels. Document exceptions remain
digest-pinned.

`scripts/verify/privacy-synthetic.json` pins the paths and content digests of the two existing
synthetic document fixtures, and names source paths containing schema examples, mock scenes or
placeholder guidance. Its token digests identify existing synthetic IDs and redaction canaries from
those examples and tests. Both a known
token and a test or named source location are required; fixture directories are never exempt from
content checks. Two redaction-test credential canaries are pinned by exact token and file. Other credentials still fail in those files.
New values fail even in test text; changing an approved binary fixture also fails. Changes to this
list require independent review of synthetic provenance; do not generate allowances from unreviewed findings.

Pattern checks cannot establish that every name, email, image or document is synthetic. The root
check rules therefore include content inspection.
