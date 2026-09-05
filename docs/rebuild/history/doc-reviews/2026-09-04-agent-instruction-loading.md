# Agent instruction loading audit — 2026-09-04

Historical verification record; the current [root instructions](../../../../AGENTS.md),
module instruction pairs, and owning contracts supersede it. No runtime behavior or plan scope changed.

## Scope and provenance

The operator approved instruction cleanup and validation (passes 1–2 of the local doctor findings).
Plugin configuration, credentials, installed versions, hooks, and task-history maintenance were excluded.
Claude's existing uncommitted root/server/lesson migration was retained and incorporated. The source
HEAD before this pass was `d7adfaf1a27b787ad3655e601b4ea45427924718`; the working root had already shrunk from its committed
111,537 bytes to 46,683 bytes. A separately active coordinator ledger was not edited or staged by this cleanup.

The saved input of task `01a06e91-9b12-7533-b022-221ade48be0b` contained exactly the first 32,768
UTF-8 bytes of that working root, ending at `produces` map `rebu`. Its 13,915-byte tail, including
After changes, was absent. Global instructions were prepended separately. The official loading
reference is [AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
The post-edit checks below reconstruct that observed byte-limited project chain locally; they do
not claim a new model session was launched or that this already-running task reloaded its prompt.

While coverage was running, another active session committed the instruction moves and the
then-in-progress report in `f1c1ae8f`. The completed instruction files were compared against that
commit with no differences. That history was retained; this report's final gate evidence was
committed separately. Unrelated coordinator changes were left untouched.

## Results

| Instruction source | Bytes at start of this pass | Bytes after cleanup |
| --- | ---: | ---: |
| `~/.codex/AGENTS.md` | 6,345 | 2,304 |
| Root `AGENTS.md` | 46,683 | 10,544 |
| `src/dashboard/AGENTS.md` | 151,760 | 11,800 |
| `src/stores/kuali/AGENTS.md` | 27,541 | 19,571 |

The global policy moved into `~/.agents/skill-library/parallel-agent-work/REFERENCE.md` §6,
which the short global instructions explicitly require for authorized supervision/coordination.
Those personal files are outside Git. Reversible originals are retained under that reference's
`history/` as `2026-09-04-global-instructions-before-cleanup.md` and
`2026-09-04-parallel-reference-before-cleanup.md`.

The root's detailed commands, operating boundaries, and conventions are preserved in
[the operating reference](../../../../.agents/skill-library/repository-work/REFERENCE.md), with
conditional read triggers at the root. Remaining dated root entries moved into `ref lessons`;
module entry points link their sibling `LESSONS.md` for both reading and later lesson recording.
No skill was disabled or rewritten. No instruction-size configuration override was added.

### Content-preservation checks

- Nine existing instruction pairs are byte-identical.
- Four original sections (Commands, Cross-repo rules, Operational isolation, Fail loud) remain
  verbatim in the operating reference.
- Thirty convention blocks remain verbatim; two were reconciled: authorized coordinator close-out
  no longer asks again for the same permission, and D311/D317 replace D106's retired workflow
  `module.ts` attachment instruction. Current coordinator skill §Close and `ref workflow-model`
  §1.6 establish those resolutions.
- The existing Claude lesson migration remains intact; newly moved dated convention blocks had
  no exact duplicates in that existing ledger. Environment history and the capture lesson survive.
- Dashboard's lesson body is byte-identical: 139,997 bytes, SHA-256
  `1ea43f1c9270cc68b079feda9d2aed836dca8f1ff3d8d127540fa6fd55024631`.
- Kuali's lesson body is byte-identical: 8,349 bytes, SHA-256
  `20bdf2491218329a6fb33a9be52cd25e9e052d6f50c3909539637c670e016d27`.
- Twenty-two root routing targets and three relocated-ledger links resolve. Read triggers cover
  module work started from the repository root, where nested instructions are not automatically loaded.
- The mandatory typecheck/lint/coverage gate is in the first 3,000 bytes.
- Delegation is explicitly opt-in. Feature edits update instruction files only when their rules,
  structure, or commands change; historical detail follows the lesson pointer.
- The stale “until this repo grows its own driver layer” rule now points at rebuild drivers.
  Server history identifies the v18 rule as superseded by the current v30/D332 boot floor, and
  no longer implies that graceful shutdown creates a backup (D322 remains explicit-only).

### Complete project instruction chains

Bytes include the two-newline join for root + nested file. Global guidance is separately loaded.
Every registered instruction directory was checked; no override files were present.

| Instruction file | File bytes | Project chain bytes |
| --- | ---: | ---: |
| `AGENTS.md` | 10,544 | 10,544 |
| `src/control/AGENTS.md` | 11,075 | 21,621 |
| `src/dashboard/AGENTS.md` | 11,800 | 22,346 |
| `src/server/AGENTS.md` | 6,618 | 17,164 |
| `src/stores/crm/AGENTS.md` | 5,369 | 15,915 |
| `src/stores/kuali/AGENTS.md` | 19,571 | 30,117 |
| `src/stores/new-kronos/AGENTS.md` | 19,405 | 29,951 |
| `src/stores/ucpath/AGENTS.md` | 21,619 | 32,165 |
| `tests/scenario/AGENTS.md` | 5,074 | 15,620 |

All nine project chains are below the observed 32,768-byte limit. The largest is UCPath;
keep the stated size boundary when editing instructions again. This is a documentation check,
not a new runtime/architecture guard or a model-behavior guarantee.

## Repository validation

No runtime code or tests changed. No new test was added for this documentation-only move.
The existing required per-commit gates were run sequentially, keeping the full coverage lane
free of this task's compiler/linter contention.

- `npm run typecheck`: passed.
- `npm run lint`: passed, zero warnings.
- Initial `npm run test:coverage`: 410 files passed; the setup hook in
  `tests/unit/server/dashboard-perf-fixture-shape.test.ts:41` exceeded the unchanged 30,000 ms
  limit. Vitest reported 5,024 passing tests and eight skipped because that setup failed;
  the full gate was red (233.84 s).
- `npm run test -- --project unit tests/unit/server/dashboard-perf-fixture-shape.test.ts`:
  all eight tests passed, one file, 12.82 s, with no source changes.
- The full retry uses the same configured suite and coverage settings, with a transient
  two-worker override to reduce contention, then the same suite-size check:
  `npm exec -- vitest run --coverage --maxWorkers=2 && npm exec -- tsx scripts/suite-size.ts`.
  Test membership, per-file isolation, in-test concurrency, thresholds, and 30-second limits
  are unchanged. No compiler or linter from this task ran concurrently with coverage.

### Final gate evidence

The full two-worker retry exited 0: **411 files / 5,032 tests passed**, no skipped tests,
167.10 s. The same previously failing fixture passed all eight assertions inside that run.
This is consistent with contention at the higher worker count; no code defect or fix is claimed.

| Coverage metric | Result |
| --- | ---: |
| Statements | 85.61% |
| Branches | 76.52% |
| Functions | 89.45% |
| Lines | 87.55% |

The coverage command enforced all configured floors. The subsequent suite-size command passed:
321 unit files, 73 architecture files, 17 scenario files. `git diff --check` passed, all nine
instruction pairs match, all nine project chains fit, and touched entry-point/report Markdown
links resolve. No temporary instrumentation, runtime changes, or test changes were introduced.

Gate output SHA-256 (retained locally with the task's temporary backup):

| Output | SHA-256 |
| --- | --- |
| `typecheck.log` | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| `lint.log` | `7ddb1ed4692d7f46ded772bee29d287ee65a7f38e09708bb0ca19a4c7f9c695f` |
| `coverage.log` | `925975738875c16ba9c7810d45b8f359d037fd97bc56162bf92663e7d0848714` |
| `fixture-recheck.log` | `cec83be980972543b1b5d10deac8d87ac72219ad33429640079340223082876f` |
| `coverage-two-workers.log` | `484da0266af9f64336bab19ae1f77e1e0c6fa7cb40b69a9f38b9f6a905e96fa7` |

## Later correction — worker-count interpretation (2026-09-04)

The successful command and gate result above remain valid, but its actual worker count was not
verified. The later `/docs` pass found that inherited per-project `maxWorkers` takes precedence
over the root CLI override in this installed Vitest version. Therefore the earlier result does not
prove that two workers caused the improvement. The later pass enforces the limit on each project
through a temporary runner configuration, preserving suite membership, isolation, and thresholds.
