# Repository governance

The [root Git instructions](../AGENTS.md#git) own branch and release policy.

## Branch protection

Protect `staging` and `main`: require pull requests, resolved conversations and passing required
checks. Do not require a human approving review. Block force pushes and branch deletion. For both
branches, enable "Require branches to be up to date before merging" so required checks validate the
current target base. Enable merge commits; disable squash and rebase merging. Do not require linear
history. Enable repository auto-merge. A pull request into `staging` auto-merges with a merge commit
when its required checks are green. The owner fixes a red check. `main` does not auto-merge: the
operator merges the release pull request.

| Branch | Required CI check names |
| --- | --- |
| `staging` | `static`, `unit (macos-15)`, `integration (macos-15)`, `architecture (macos-15)`, `parity`, `privacy`, and the Cursor Bugbot check once its name is known |
| `main` | the `staging` checks, plus `release` |

`unit (windows-latest)`, `integration (windows-latest)`, and `architecture (windows-latest)` stay in the workflow until a Windows run confirms the shared startup path check. They are not required. After that confirmation they are removed. They do not become required checks.

`release` runs only on PRs targeting `main`, after the other checks. Its isolated runner builds the
web bundle, runs coverage alone, then performance. The operator authorizes release PRs from
`staging` to `main`, and syncs `main` back into `staging` after merging. Branch protection is configured
by the repository owner; the workflow does not enable it. Confirm the check names on a pull request
before locking them. Add the Cursor Bugbot check when its name is known; do not invent it.

CI takes Node from `package.json` engines and caches npm. Routine test suites are macOS:
required unit, integration, and architecture on `macos-15`, and parity on macOS. Static and
privacy stay on Ubuntu. The tests stay portable to Windows and macOS. The Windows suite jobs
do not gate `release` or merges. Desktop parity uses headless Chromium and existing references;
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
