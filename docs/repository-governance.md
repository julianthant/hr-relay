# Repository governance

The [root Git instructions](../AGENTS.md#git) own branch and release policy.

## Branch protection

`staging` requires passing checks on a branch that is up to date with `staging`, with no review
requirement, so green PRs auto-merge with a merge commit. `main` additionally requires one
independent approving review. Both block force pushes and branch deletion. Merge commits only;
squash and rebase merging are disabled.

| Branch | Required CI check names |
| --- | --- |
| `staging` | `static`, `privacy`, `unit (macos-15)`, `integration (macos-15)`, `architecture (macos-15)`, `parity` |
| `main` | the `staging` checks plus `release` |

`release` runs only on PRs targeting `main`, after the other checks. Its isolated runner builds the
web bundle, runs coverage alone, then performance. The operator authorizes release PRs from
`staging` to `main`, and syncs `main` back into `staging` after merging.

## Merge train and automatic fixes

`.github/workflows/merge-train.yml` runs on every push to `staging` and every finished CI run. It
labels a PR `train-failed` when its CI fails and clears the label when CI passes. It then picks the
oldest open, non-draft, same-repository PR into `staging` with auto-merge enabled and no
`train-failed`, `needs-human` or `merge-conflict` label. While one such PR is up to date, the train
waits; otherwise it merges `staging` into the oldest PR that is behind, which re-runs CI on the
combination. A PR it cannot update gets `merge-conflict`. The workflow uses the `TRAIN_TOKEN`
secret (fine-grained, this repository, Contents and Pull requests read/write), because pushes made
with the default token do not start CI.

Cursor fixes PRs on GitHub: Bugbot reviews every push and commits its fixes to the PR branch, a
Cursor Automation on finished CI runs fixes failed CI, and another on the `merge-conflict` label
resolves conflicts. Their instructions forbid raising deadlines, skipping or loosening tests,
updating parity references and editing workflows; anything that needs those gets `needs-human`.
The operator watches only `needs-human`.

CI takes Node from `package.json` engines and caches npm. Test jobs use macOS because the test
runner requires `/usr/bin/lockf`. Desktop parity uses headless Chromium and existing references;
CI never updates references or uploads HR evidence.

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
