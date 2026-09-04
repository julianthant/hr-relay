# Agent instruction loading audit — 2026-09-04

Historical verification record; the current [root instructions](../../../../AGENTS.md),
module instruction pairs, and owning contracts supersede it. No runtime behavior or plan scope changed.

## Scope and provenance

The operator approved instruction cleanup and validation (passes 1–2 of the local doctor findings).
Plugin configuration, credentials, installed versions, hooks, and task-history maintenance were excluded.
Claude's existing uncommitted root/server/lesson migration was retained and incorporated. The source
HEAD before this pass was `d7adfaf1a27b787ad3655e601b4ea45427924718`; the working root had already shrunk from its committed
111,537 bytes to 46,683 bytes. A separately active coordinator ledger was not part of this change.

The saved input of task `01a06e91-9b12-7533-b022-221ade48be0b` contained exactly the first 32,768
UTF-8 bytes of that working root, ending at `produces` map `rebu`. Its 13,915-byte tail, including
After changes, was absent. Global instructions were prepended separately. The official loading
reference is [AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
The post-edit checks below reconstruct that observed byte-limited project chain locally; they do
not claim a new model session was launched or that this already-running task reloaded its prompt.

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

VALIDATION_PENDING
