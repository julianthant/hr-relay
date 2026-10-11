# Documentation

Start with the [current codebase map](rebuild/reference/codebase-structure.md).
Reference contracts own requirements; workflow migration records retain verification evidence.
A design, finding, or historical live result is not proof of current implementation.

## Folder map

```text
docs/
├── rebuild/
│   ├── reference/        Contracts, current codebase map, lessons, and store catalog
│   ├── evidence/         Sanitized selector evidence, organized by system
│   ├── guides/           Practical instructions grounded in the contracts and code
│   └── guard-inventory.json  Reviewed guard manifest
```

## Evidence location

Retained rebuild evidence is grouped by task/date under
the evidence root named in root `AGENTS.md`. New task evidence belongs there,
outside disposable worktrees. On 2026-09-17, 45 existing folders moved into that parent; its
`relocation.json` maps their original paths and verifies unchanged file hashes and symlink targets.
Current documentation uses the new locations. Raw logs, command receipts, historical scripts and
older Git revisions retain their original paths and bytes; use the map when resolving those records.
Selector fixture and live-read-only evidence now lives under `rebuild/evidence/selectors/<system>/`;
retained semantic registries name the evidence used by verification. Legacy migration/provenance
inventories live outside the repository in task evidence. Current architecture checks use only
their reader-owned behavior fixtures. Both relocations preserve payload bytes and stay separate from operator runtime
state; ignored `config/test-data.local.json` remains private local test input. Active source links use
the current `src/backend/`, `src/models/`, `src/rules/` and `src/workflow-kit/` layout;
source-pinned excerpts and frozen records keep their original paths to retain the cited revision.
These path updates do not rerun or change historical gate results.

## Find the right document

| Work | Start here |
| --- | --- |
| Find a requirement's owner | `ref <slug>` means `rebuild/reference/<slug>.md`; each reference names its owned concepts |
| Find current source/test folders and dependency boundaries | [Codebase structure](rebuild/reference/codebase-structure.md) |
| Add or change a workflow | [Workflow authoring guide](rebuild/guides/workflow-authoring.md), then its migration record in task evidence |
| Investigate a previous failure | Search [shared lessons](rebuild/reference/lessons.md) by seam or decision; module instructions point to scoped ledgers |
| Run checks or operate the repository | [Repository operating reference](../.agents/skill-library/repository-work/REFERENCE.md) and [root instructions](../AGENTS.md) |

## Generated documents

| Output | Source and command |
| --- | --- |
| [Store catalog, §2](rebuild/reference/stores.md) | Store declarations through [src/backend/app/registries/task-registry.ts](../src/backend/app/registries/task-registry.ts); `npm run stores:catalog`, then `npm run stores:catalog:check` |

Edit generated content at its source. The remaining sections of the store reference are authored
prose.

## Earlier paths

Workflow porting records live in task evidence. Guides live under `docs/rebuild/guides/`. Source-pinned citations retain their revision and original path. They describe
that revision rather than the current tree.
