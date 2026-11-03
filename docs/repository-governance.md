# Repository governance

The [root Git instructions](../AGENTS.md#git) own branch and release policy.

## Branch protection

`staging` requires a pull request and passing checks on a branch that is up to date with `staging`,
with no human approving review, so green pull requests auto-merge with a merge commit. Both
branches block force pushes and branch deletion. Merge commits only; squash and rebase merging are
disabled; linear history is not required. `main` does not auto-merge: the operator merges the
release pull request.

| Branch | Required CI check names |
| --- | --- |
| `staging` | `static`, `privacy`, `unit`, `integration`, `architecture`, `parity` |
| `main` | the `staging` checks, plus `release` |

The expensive `release-batch` job runs only on PRs from `staging` into `main`, after the other checks.
The required top-level `release` summary also runs for other heads targeting `main` and fails their
head validation, so omitted expensive work cannot satisfy main protection for an invalid source.
Valid Markdown-only omissions pass after proof validation; manual releases validate routine proofs
without a PR source-head restriction.
The expensive job’s isolated macOS runner builds the web bundle, runs coverage alone, then
performance. The operator authorizes release PRs from
`staging` to `main`, and syncs `main` back into `staging` after merging.

## Merge train and automatic fixes

`.github/workflows/merge-train.yml` runs on every push to `staging`, and CI calls it as its final job.
It labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then merges
`staging` into every open, non-draft, same-repository PR by `julianthant` into `staging` that lacks it, whatever its
labels or auto-merge state, so every update starts CI on the latest `staging`; per-PR supersession cancels the older run. Auto-merge then lands whichever PR passes first. A PR it cannot update gets
`merge-conflict`. If GitHub's update reports a conflict, the train attempts a merge in a temporary
worktree. Conflicts exclusively in `scripts/build/generated-outputs.ts`'s registered outputs are
resolved by running the generators against the combined sources. Catalog conflicts must be wholly
inside the generated section of `stores.md`; conflicts in authored text refuse. Generator failure
or any authored conflict prevents a push. Before an ordinary fast-forward push, the train rechecks
the PR's eligibility and expected head; a moved head is left to its owner. Successful updates clear
`merge-conflict`. Workers merge their remote branch before pushing (never rebase or force-push). The workflow uses the `TRAIN_TOKEN`
secret (fine-grained, this repository, Contents and Pull requests read/write), because pushes made
with the default token do not start CI.

Use a blob-filtered full-history checkout for the merge train. Keep all commit ancestry and fetch
historical file contents on demand within the existing five-minute job budget.

Cursor Bugbot reviews every push and only comments. The orchestrator session is the only fixer: it
watches its open PRs and, on the PR branch, fixes failed CI, real Bugbot findings and PRs labeled
`merge-conflict` (merging `staging` in, never rebasing). A failure unrelated to the PR's diff is a
`staging` failure, fixed once in its own PR rather than in every PR. Fixes never raise deadlines,
skip or loosen tests, edit workflows, touch HR write paths, or update parity references or snapshots
for screens the PR did not intentionally change; anything that needs those gets `needs-human`. While no orchestrator
session runs, red PRs wait; nothing red merges. The operator watches only `needs-human`.

CI takes Node from `package.json` engines and caches npm. Run portable suites on Ubuntu for staging
pull requests. Run platform-native proofs and Desktop parity in CI only for a full release
started by the operator: a `staging` → `main` pull request or a manual full-release dispatch. Only the operator
may start such a run; agents must never dispatch or rerun CI workflows. Between releases, run
Windows-native tests locally on Windows and macOS-native tests locally on the Mac when load is low.
Keep native files out of Ubuntu shards. Native proofs and the padded-receipt storage upgrade run in separate single-worker invocations, preserving their
existing deadlines under duration-based assignment. Native integration jobs first verify the
full-Chromium installation through `scripts/test/chromium-preflight.ts` by opening a blank page
and observing the owned browser process exit. This one-time setup has no retries; timed proofs still use fresh profiles and their existing
deadlines. A full staging run uses two
Ubuntu unit shards, two architecture shards and fourteen integration shards, plus static and
privacy, within twenty Ubuntu runners. On operator-started full releases, use all five macOS
runners for native files when parity is omitted. When parity is selected, use three macOS runners
for parity and two for native files. The release runner starts after
the routine suites finish. Windows native files use five `windows-latest` runners, or one for
unit-only selection, with the
same serial/storage separation and native membership. Windows uses explicit Bash with native
Windows Node/npm, the runner temp directory and Windows Chromium installation. Before checkout,
it disables Git automatic line-ending conversion to preserve fixture bytes and shell scripts.

`ci.yml` runs only for staging pull requests and calls portable-only `ci-checks.yml`. Its required
top parity job is a plain passing omission, and its existing merge-train call follows the six
required summaries. `release.yml` runs only for main pull requests or operator manual releases and
alone calls `release-checks.yml`, which owns portable, macOS/Windows native, Desktop parity and
release-batch jobs. Staging never references or loads a release/native workflow call.

Both event entries use per-PR/manual-branch supersession with a workflow/PR-or-ref concurrency
group and `cancel-in-progress: true`. New pushes cancel older runs for that same key. Each entry
queues one complete reusable check call in the shared `ci-runners` job-level FIFO with `queue: max`
and `cancel-in-progress: false`. That admitted call holds all proofs, selected batch and timing
publication until its callee finishes; the callees never reacquire admission. GitHub orders waiting
calls by arrival, accepts at most 100 pending calls, and cancels extra arrivals on overflow.

CI-invoked merge train is outside the admitted call, after the six top summaries, while remaining
inside parent per-PR supersession. The standalone staging-push train remains separate. Batch
repair pushes to avoid redundant CI work.

`scripts/test/ci-plan.ts` owns typed selection/proof/timing-history policy. Both timed callees
retain explicit test budgets. Their final `unit` validates every mandatory proof, selected batch
and timing publication, excluding downstream train to avoid a cycle. The always-running outer
required `unit` additionally requires the called pipeline and its inner unit output to succeed,
so cancelled, skipped, failed or missing results cannot merge. Required names stay `static`,
`privacy`, `unit`, `integration`, `architecture` and `parity` on staging, plus `release` on main.
Release parity validates its real callee output; staging parity remains a plain successful omission.
Other cancelled summaries and the train may stop.

Run static, privacy and affected portable unit, integration and architecture suites for ready PRs
into `staging`. For PRs from `staging` into `main`, add selected native proofs, parity and release.
Path filters select affected suites. Draft pushes run static, privacy and
affected unit files; becoming ready starts full applicable validation. Only the operator may start
a manual full-release dispatch; it selects all routine suites, including native proofs and parity. Other PR heads targeting `main` omit
native proofs, parity and expensive release work; their required release summary fails. Drafts cannot merge. Protected-branch pushes do not
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
reports or failed downloads fail CI. Every later CI fix must preserve this automatic timing feedback
and refresh the committed seed when shard end times spread more than a minute. The
[test reference](rebuild/reference/guards-and-tests.md#2-vitest-selection-and-commands) owns file
membership and selection details.

Playwright browser caches use `~/Library/Caches/ms-playwright` on macOS and
`~/AppData/Local/ms-playwright` on Windows, keyed by runner OS, architecture, browser set and
`package-lock.json` digest (plus the image on macOS). An exact macOS hit skips installation;
Windows checks installation on every native integration job. A miss installs the required browsers. There are no partial-key restores. Desktop parity uses headless
Chromium and existing references; CI never updates references or uploads HR evidence.

## Privacy check

Run `npm run privacy:check` after staging the exact candidate paths. It scans Git's index, including
staged new files; unstaged edits and untracked files are outside its input. CI checks the checked-out
commit through its index. Findings contain only paths and rule names.

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
content checks. The existing `.npmrc` configuration is pinned by whole-file digest; two redaction-test
credential canaries are pinned by exact token and file. Other credentials still fail in those files.
New values fail even in test text; changing an approved binary fixture also fails. Changes to this
list require independent review of synthetic provenance; do not generate allowances from unreviewed findings.

Pattern checks cannot establish that every name, email, image or document is synthetic. Authors and
reviewers must inspect staged content and screenshots before publishing.
