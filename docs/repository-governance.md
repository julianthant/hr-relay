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

`release` runs only on PRs targeting `main`, after the other checks. Its isolated runner builds the
web bundle, runs coverage alone, then performance. The operator authorizes release PRs from
`staging` to `main`, and syncs `main` back into `staging` after merging.

## Merge train and automatic fixes

`.github/workflows/merge-train.yml` runs on every push to `staging`, and CI calls it as its final job.
It labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then merges
`staging` into every open, non-draft, same-repository PR into `staging` that lacks it, whatever its
labels or auto-merge state, so every PR re-runs CI on the latest `staging`; CI cancels each PR's
older in-progress run. Auto-merge then lands whichever PR passes first. A PR it cannot update gets
`merge-conflict`. Workers merge their remote branch before pushing (never rebase or force-push). The workflow uses the `TRAIN_TOKEN`
secret (fine-grained, this repository, Contents and Pull requests read/write), because pushes made
with the default token do not start CI.

Cursor Bugbot reviews every push and only comments. The orchestrator session is the only fixer: it
watches its open PRs and, on the PR branch, fixes failed CI, real Bugbot findings and PRs labeled
`merge-conflict` (merging `staging` in, never rebasing). A failure unrelated to the PR's diff is a
`staging` failure, fixed once in its own PR rather than in every PR. Fixes never raise deadlines,
skip or loosen tests, edit workflows, touch HR write paths, or update parity references or snapshots
for screens the PR did not intentionally change; anything that needs those gets `needs-human`. While no orchestrator
session runs, red PRs wait; nothing red merges. The operator watches only `needs-human`.

CI takes Node from `package.json` engines and caches npm. Tests run on Ubuntu except the
macOS-only storage and native browser proofs and Desktop parity. A full staging run uses two
Ubuntu unit shards, two architecture shards and fourteen integration shards, plus static and
privacy, within twenty Ubuntu runners. Native files use all five macOS runners; when parity is
selected, three macOS runners run parity and two run native files. The release runner starts after
the routine suites finish. Windows jobs are not enabled.

`ci.yml` retains per-PR or per-dispatch-branch cancellation, and queues its reusable `ci-checks.yml`
job in the shared `ci-runners` concurrency group with `queue: max`. GitHub admits one pipeline at
a time without a waiting runner. Completion, failure or cancellation releases admission; no polling
job can occupy a runner needed by an older run. GitHub orders this queue by when pipelines start
waiting, rather than guaranteeing workflow creation-time order, and accepts at most 100 pending
pipelines. Queue overflow cancels additional arrivals. The merge train remains outside admission.
The seven required check names remain top-level summaries of the corresponding pipeline results;
unit also requires a successful pipeline, including timing publication.

Ready PRs into `staging` run static, privacy, unit, integration and architecture; PRs into `main`
add parity and release. Path filters select affected suites. Draft pushes run static, privacy and
affected unit files; becoming ready starts full applicable validation. Explicit dispatches always
select all routine suites, including parity. Drafts cannot merge. Protected-branch pushes do not
repeat CI; Markdown-only PRs run static and privacy. A deliberately omitted suite has a successful
summary, while failed change detection or any failed/cancelled selected group fails its summary.
Markdown-only release PRs omit coverage and perf.

Every admitted run downloads the latest successful run's retained `ci-timings` artifact before
selecting files. Its immutable `ci-balancing` artifact gives every shard identical duration inputs.
After successful runner groups, CI merges their per-file reports into those inherited timings and
publishes `ci-timings` for the next run, retaining measurements for suites not selected this time.
Without a retained artifact, CI explicitly uses the committed `scripts/test/ci-durations.json` seed;
unmeasured files use the positive measured median, or one second without measurements. Invalid
reports or failed downloads fail CI. Every later CI fix must preserve this automatic timing feedback
and refresh the committed seed when shard end times spread more than a minute. The
[test reference](rebuild/reference/guards-and-tests.md#2-vitest-selection-and-commands) owns file
membership and selection details.

Playwright browser caches use `~/Library/Caches/ms-playwright`, keyed by runner OS, architecture,
macOS image, browser set and `package-lock.json` digest. An exact hit skips installation; a miss
installs the required browsers. There are no partial-key restores. Desktop parity uses headless
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
