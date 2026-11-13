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

The expensive `release-batch` job runs only on PRs from `staging` into `main`, after the other checks.
The required top-level `release` summary also runs for other heads targeting `main` and fails their
head validation, so omitted expensive work cannot satisfy main protection for an invalid source.
Valid Markdown-only omissions pass after proof validation; manual releases validate routine proofs
without a PR source-head restriction.
The expensive job’s isolated macOS runner builds the web bundle, runs coverage alone, then
performance. The [release instructions](../AGENTS.md#pr-and-release-flow) own promotion and branch synchronization.

## Merge train and automatic fixes

Push roadmap-only commits (`docs/roadmap/**`) straight to `staging` to skip staging CI and the merge train.
`.github/workflows/merge-train.yml` runs on other pushes to `staging`, and CI calls it as its final job.
It labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then merges
`staging` into every open, non-draft, same-repository PR by `julianthant` into `staging` that lacks it, whatever its
labels or auto-merge state, so every update starts CI on the latest `staging`; per-PR supersession cancels the older run. Auto-merge then lands whichever PR passes first. A PR it cannot update gets
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
deadlines. A full staging run uses two
Ubuntu unit shards, two architecture shards and fourteen integration shards, plus static and
privacy, within twenty Ubuntu runners. On operator-started full releases, use all five macOS
runners for native files. The release runner starts after
the routine suites finish. Windows native files use five `windows-latest` runners, or one for
unit-only selection, with the
same serial/storage separation and native membership. Windows uses explicit Bash with native
Windows Node/npm, the runner temp directory and Windows Chromium installation. Before checkout,
it disables Git automatic line-ending conversion to preserve fixture bytes and shell scripts.

`ci.yml` runs only for staging pull requests and calls portable-only `ci-checks.yml`. Its existing
merge-train call follows the five required summaries. `release.yml` runs only for main pull requests or operator manual releases and
alone calls `release-checks.yml`, which owns portable, macOS/Windows native and
release-batch jobs. Staging never references or loads a release/native workflow call.

Both event entries use per-PR/manual-branch supersession with a workflow/PR-or-ref concurrency
group and `cancel-in-progress: true`. New pushes cancel older runs for that same key. Each entry
queues one complete reusable check call in the shared `ci-runners` job-level FIFO with `queue: max`
and `cancel-in-progress: false`. That admitted call holds all proofs, selected batch and timing
publication until its callee finishes; the callees never reacquire admission. GitHub orders waiting
calls by arrival, accepts at most 100 pending calls, and cancels extra arrivals on overflow.

CI-invoked merge train is outside the admitted call, after the five top summaries, while remaining
inside parent per-PR supersession. The standalone staging-push train remains separate. Batch
repair pushes to avoid redundant CI work.

`scripts/test/ci-plan.ts` owns typed selection/proof/timing-history policy. Both timed callees
retain explicit test budgets. Their final `unit` runs unless cancelled and validates every mandatory
proof, selected batch and timing publication, excluding downstream train to avoid a cycle.
Cancellation stops that inner checkout/install work. The always-running outer
required `unit` additionally requires the called pipeline and its inner unit output to succeed,
so cancelled, skipped, failed or missing results cannot merge. Required names stay `static`,
`privacy`, `unit`, `integration` and `architecture` on staging, plus `release` on main.
Other cancelled summaries and the train may stop.

Run static, privacy and affected portable unit, integration and architecture suites for ready PRs
into `staging`. For PRs from `staging` into `main`, add selected native proofs and release.
Path filters select affected suites. Draft pushes run static, privacy and
affected unit files; becoming ready starts full applicable validation. Only the operator may start
a manual full-release dispatch; it selects all routine suites, including native proofs. Other PR heads targeting `main` omit
native proofs and expensive release work; their required release summary fails. Drafts cannot merge. Protected-branch pushes do not
repeat CI; Markdown-only PRs run static and privacy. A deliberately omitted suite has a successful
summary, while failed change detection or any failed/cancelled selected group fails its summary.
Markdown-only release PRs omit coverage and perf.

Timing discovery enumerates registered workflow IDs for the exact `ci.yml` and `release.yml` paths,
then orders their successful histories together, newest first, excluding the current run. An
unregistered new release workflow is not queried. Unexpected API failures fail CI; a valid absence
of retained reports selects the committed seed. Every admitted run downloads the newest retained
eligible `ci-timings` artifact before selecting files. Its immutable `ci-balancing` artifact gives every shard identical duration inputs.
After mandatory proof validation succeeds, each workflow merges its portable/native file reports
into inherited timings and publishes `ci-timings` for the next run. Report names include the runner OS and selection group;
when both platforms report one file, the slower duration wins independently of artifact order.
Measurements for omitted suites remain intact.
Without a retained artifact, CI explicitly uses the committed `scripts/test/ci-durations.json` seed;
unmeasured files use the positive measured median, or one second without measurements. Invalid
reports or failed downloads fail CI. The [check rules](../AGENTS.md#checks) own timing-seed maintenance. The
[test reference](reference/guards-and-tests.md#2-vitest-selection-and-commands) owns file
membership and selection details.

Playwright browser caches use `~/Library/Caches/ms-playwright` on macOS and
`~/AppData/Local/ms-playwright` on Windows, keyed by runner OS, architecture, browser set and
`package-lock.json` digest (plus the image on macOS). An exact macOS hit skips installation;
Windows checks installation on every native integration job. A miss installs the required browsers. There are no partial-key restores. CI never uploads HR evidence.

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
