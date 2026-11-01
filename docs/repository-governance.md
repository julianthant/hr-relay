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
It labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then picks the
oldest open, non-draft, same-repository PR into `staging` with auto-merge enabled and no
`train-failed`, `needs-human` or `merge-conflict` label. While one such PR is up to date, the train
waits; otherwise it merges `staging` into the oldest PR that is behind, which re-runs CI on the
combination. A PR it cannot update gets `merge-conflict`. The workflow uses the `TRAIN_TOKEN`
secret (fine-grained, this repository, Contents and Pull requests read/write), because pushes made
with the default token do not start CI.

Cursor Bugbot reviews every push and only comments. The orchestrator session is the only fixer: it
watches its open PRs and, on the PR branch, fixes failed CI, real Bugbot findings and PRs labeled
`merge-conflict` (merging `staging` in, never rebasing). A failure unrelated to the PR's diff is a
`staging` failure, fixed once in its own PR rather than in every PR. Fixes never raise deadlines,
skip or loosen tests, edit workflows, touch HR write paths, or update parity references or snapshots
for screens the PR did not intentionally change; anything that needs those gets `needs-human`. While no orchestrator
session runs, red PRs wait; nothing red merges. The operator watches only `needs-human`.

CI takes Node from `package.json` engines and caches npm. Routine test suites are macOS:
required unit, integration, architecture and parity on `macos-15` Apple Silicon runners.
Static, privacy and the four required suite summaries stay on Ubuntu. CI runs no Windows jobs.
Test suites run on Ubuntu runners, except files that need macOS: the native browser process proofs,
the storage closure, backup and restore proofs, and Desktop parity. A pull request into `staging`
uses at most twenty Ubuntu jobs and all five macOS jobs; a release pull request gives three of the
macOS jobs to parity. The release runner starts after these jobs finish.

PRs into `staging` run static, privacy, unit, integration and architecture; PRs into `main` add
parity and release. PR path filters select affected suites. Pushes to `staging` and `main` do not run CI: they only
change through pull requests whose up-to-date result already passed. A manual run selects all routine
suites. Markdown-only PRs run static and privacy without test runners. The required suite names
stay unchanged: each summary succeeds for a deliberately omitted suite, or requires every
scheduled group to succeed. Failed change detection, failed groups and cancelled selected groups
fail the summaries. The [test reference](rebuild/reference/guards-and-tests.md#2-vitest-selection-and-commands)
owns the selection rules and membership proof. Markdown-only release PRs also omit coverage and perf.

Playwright browser caches use `~/Library/Caches/ms-playwright`, keyed by runner OS, architecture,
macOS image, browser set and `package-lock.json` digest. An exact hit skips installation; a miss
installs the required browsers. There are no partial-key restores. Desktop parity uses headless
Chromium and existing references; CI never updates references or uploads HR evidence.

## Privacy check

Run `npm run privacy:check` after staging the exact candidate paths. It scans Git's index, including
staged new files; unstaged edits and untracked files are outside its input. CI checks the checked-out
commit through its index. Findings contain only paths and rule names.

Private documents belong in ignored `.local-private/`. The scanner rejects roster formats, PDFs,
environment files, credential paths and recognizable credential/employee ID/SSN patterns. The root
`.env.example` may contain placeholders; credential-value checks still apply to it. Text checks cover
UTF-8 (including NUL bytes) and UTF-16 in either byte order; unsupported text fails closed. PNG and
WebP assets are recognized by extension and format signature; their bytes are still checked for
recognizable embedded text. The check does not inspect image pixels. Document exceptions remain
digest-pinned.

`scripts/verify/privacy-synthetic.json` pins the paths and content digests of the three existing
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
