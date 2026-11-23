# Repository governance

The [Conventions](../AGENTS.md#conventions) own branch naming. The [root Git instructions](../AGENTS.md#git) own release policy.

## Branch protection

`development` requires the `development` check and accepts feature, fix, chore and Dependabot
pull requests. Feature, fix and chore branches start from `origin/development` and open one pull
request into `development`. Auto-merge uses merge commits, with no up-to-date rule.
`staging` receives one pull request from `development` per coherent batch, with the `staging`
check and no up-to-date rule. A red full check is repaired through a pull request into `development`.
`main` receives `staging` or `hotfix/*` and requires the operator's release go. Branches block
force pushes and deletion; squash and rebase merging are disabled. Drafts cannot merge.

| Branch | Required CI check names |
| --- | --- |
| `development` | `development` |
| `staging` | `staging` |
| `main` | `production` |

The [release instructions](../AGENTS.md#pr-and-release-flow) own production promotion and synchronization.
Cursor Bugbot reviews pushes and only comments. The [PR flow](../AGENTS.md#pr-and-release-flow)
owns reviewer/coder responsibility, repairs and escalation. `needs-human` identifies work requiring
the operator; red required checks prevent merging.

## Workflows and checks

`Development` (`development.yml`), `Staging` (`staging.yml`) and `Production` (`production.yml`)
share the test jobs in `checks.yml`, with kinds `fast` (Development), `full` (the scheduled
Development run), `portable` (Staging and staging-to-main releases) and `release` (hotfix and
manual releases). Development and Staging run on pull requests to their named branches. Production runs on pull
requests into `main`, operator manual starts with a required title, and pushes to `main` for
CodeQL only. Pull request runs are titled with their pull request title.

A Development run for a `task/**` push or a non-task pull request runs plan, lint, static
(typecheck and build), privacy, three unit shards, two architecture shards, the integration
shards `scripts/test/affected-tests.ts` selects (at most eight five-minute shards), `proof` and the `development` gate. It starts no perf, smoke
or macOS job. Drafts keep plan, static, privacy and selected unit shards only. Path filters may
omit unit and architecture suites, including all suites for Markdown-only changes. `proof` folds
the shard results into one result; it requires successful selected shards, exactly skipped
omitted work and all mandatory checks. A `task/**` pull request runs only the `development` gate:
names, the workflow allowlist, then the `proof` of the push run at the pull request head SHA. It
waits up to twenty minutes for a running proof and fails after a minute when no run exists. An
edited pull request reruns only that gate and reuses the last proof at its head SHA.

Every 20 minutes Development's `decide` job reads GitHub through `scripts/ci/full-run.ts` and
starts the full run only when the development head has no green full run and either no other run
is queued or in progress or no full run started in the last six hours. A running full run keeps CI
busy, so full runs never overlap; a failed head retries on the next idle tick. Otherwise nothing
else runs. The full run, titled `Full run <sha>`, runs the
`full` plan (every unit, architecture and integration shard, lint, static, privacy, perf, smoke
and five macOS native shards), CodeQL and `npm audit --omit=dev --audit-level=high`. Its `full`
job folds those results and writes the SHA and verdict to the run summary. A green full run is
that job's success in a scheduled `development.yml` run at exactly that commit.

Staging and staging-to-main releases run the full portable check: three unit shards, two architecture shards, thirty
integration shards, lint, static, privacy, perf and smoke. Ready Staging and Production pull
requests include perf and smoke even for Markdown-only changes. Both jobs install Chromium,
build the dashboard and use tmpfs; smoke runs `npm run test:smoke`, perf runs `npm run test:perf`.
Draft Staging and Production pull requests run lint, static, privacy and affected unit shards.
Manual releases omit perf and smoke and select all routine and native suites.
No workflow runs coverage; `npm run test:coverage` stays local with unchanged floors.

Staging pull requests from `development` pass `full-proof` only when their head commit has a green
full run. Task pull requests merge straight into `development`; unfinished work merges unwired (no
nav entry or route until the feature's last task) and no flag framework exists. When the full run
on `development` is red, nothing else merges into it until the failing task is reverted or fixed
forward. A staging-to-main release passes `full-proof` only when the staging head, or one of its
parents, has a green full run and carries exactly the staging head's tree. The main-to-staging
sync passes without a full run because main moves only through the production gate.

Production retains its five macOS native shards on hotfix and manual releases, selected native unit and
integration proofs, and isolated single-worker serial and storage groups. Native integration
first verifies full Chromium through `scripts/test/chromium-preflight.ts`; setup has no retries.
CI takes Node from `.node-version`, caches npm and preserves test timeouts, RAM and time-scale
budgets. The [check rules](../AGENTS.md#checks) own placement and release authorization.
CodeQL runs in the full run, on hotfix pull requests and on pushes to main; `npm audit
--omit=dev --audit-level=high` runs in the full run and on main pull requests. CodeQL default
setup must be off.

The `staging` gate needs `names`, `checks` and `full-proof`; `production` needs `checks`,
`codeql`, `dependencies` and `full-proof`, requires `full-proof` for `staging` heads and `codeql`
for `hotfix/*` heads, and refuses any other head.
Gates fail for any failed or cancelled dependency. Shared proof verification rejects missing
outcomes and requires exactly skipped results for legitimate omissions. The Development caller
runs its own `development` gate with the shared plan and job results;
the fast kind skips the shared `unit` job and suite summaries. Other kinds retain both.

Each pull request has its own workflow/PR concurrency key; a newer push cancels its older run.
Development has no shared runner lane, so four ten-job runs fit the forty runner slots side by
side. Staging admits its complete reusable call through the `ci-runners` FIFO; Production uses
`release-runners`. Each queues with `queue: max` and `cancel-in-progress: false`, holding proofs,
perf, smoke and timing publication until the call finishes. Callees never reacquire admission.
GitHub admits at most 100 pending calls and cancels extra arrivals on overflow.

`scripts/test/ci-plan.ts` owns selection, proof, publication and timing-history policy. Timing
discovery enumerates registered IDs for `staging.yml` and `production.yml`,
orders successful histories newest first and excludes the current run. Unregistered workflows
are not queried. A valid absence of retained reports selects the committed seed; unexpected API
failures and failed downloads fail CI. All shards use the same immutable `ci-balancing` input.
Portable and release plans publish timings; fast plans reuse those timings without a publication job.
After proofs pass, the shared final job merges portable/native duration reports into inherited
timings and publishes `ci-timings`. Failed or cancelled proofs and empty plans never publish.
Report names include OS and selection group; the slower measurement wins for a file seen on
both platforms. Omitted suites retain their prior measurements. Unmeasured files use the positive
measured median, or one second without measurements. The [test reference](reference/guards-and-tests.md#2-vitest-selection-and-commands)
owns membership, timing seeds and selection details.

Playwright caches are keyed by runner OS, architecture, browser set and lockfile digest, plus the
image on macOS. Exact macOS hits skip installation; misses install browsers without partial-key
restores. CI never uploads HR evidence.

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
