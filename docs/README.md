# Documentation

Start with the [roadmap](roadmap/roadmap.md) for scheduled work and its
[Governance section](roadmap/roadmap.md#governance-the-plans-own-rules) for document authority.
The phase documents own execution scope and evidence; reference contracts own requirements.
A design, finding, or historical live result is not proof of current implementation.

## Folder map

```text
docs/
├── roadmap/              Plan source, notation, and generated tracking site
├── rebuild/
│   ├── plans/            Phase/subphase folders, README overviews and optional task files
│   ├── reference/        Contracts, current codebase map, decision pointers, lessons, and store catalog
│   ├── migrations/       Workflow migration records, acceptance records, and preserved legacy inventories
│   │   └── legacy/       Byte-preserved checked-in provenance and verification inputs
│   ├── evidence/         Sanitized selector evidence, organized by system
│   ├── guides/           Practical instructions grounded in the contracts and code
│   ├── findings/         Diagnoses and proposals awaiting or recording disposition
│   ├── history/          Frozen reviews, design inputs, and superseded text
│   └── guard-inventory.json  Reviewed guard manifest
├── decisions/            Supporting context for operator decisions
└── handoffs/             Temporary recovery state for interrupted work
```

## Evidence location

Retained rebuild evidence is grouped by task/date under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/`. New task evidence belongs there,
outside disposable worktrees. On 2026-09-17, 45 existing folders moved into that parent; its
`relocation.json` maps their original paths and verifies unchanged file hashes and symlink targets.
Current documentation uses the new locations. Raw logs, command receipts, historical scripts and
older Git revisions retain their original paths and bytes; use the map when resolving those records.
Selector fixture and live-read-only evidence now lives under `rebuild/evidence/selectors/<system>/`;
retained semantic registries name the evidence used by verification. Legacy migration/provenance
inventories live under `rebuild/migrations/legacy/` and remain checked-in inputs to migration and
architecture tests. Both relocations preserve payload bytes and stay separate from operator runtime
state; ignored `config/test-data.local.json` remains private local test input. Active source links use
the current `src/backend/`, `src/models/`, `src/rules/` and `src/workflow-kit/` layout;
source-pinned excerpts and frozen records keep their original paths to retain the cited revision.
These path updates do not rerun or change historical gate results.

## Find the right document

| Work | Start here |
| --- | --- |
| Find the assigned phase or task | [Roadmap source](roadmap/roadmap.md), then the overview or task file named by its `doc:` binding; [plans index](rebuild/plans/README.md) |
| Find a requirement's owner | [D1 ownership map](roadmap/roadmap.md#d1-ownership-map--the-quick-index-concept--owning-doc); `ref <slug>` means `rebuild/reference/<slug>.md` |
| Find current source/test folders and dependency boundaries | [Codebase structure](rebuild/reference/codebase-structure.md) |
| Understand a numbered decision | [Decision pointer index](rebuild/reference/decisions.md), then its named owner; [operator context](decisions/README.md) explains choices |
| Add or change a workflow | [Workflow authoring guide](rebuild/guides/workflow-authoring.md), then its [migration record](rebuild/migrations/README.md) |
| Diagnose or record a gap | [Findings index](rebuild/findings/README.md); a finding does not authorize implementation |
| Investigate a previous failure | Search [shared lessons](rebuild/reference/lessons.md) by seam or decision; module instructions point to scoped ledgers |
| Recover an old citation | [History index](rebuild/history/README.md); frozen text retains its original names and dates |
| Run checks or operate the repository | [Repository operating reference](../.agents/skill-library/repository-work/REFERENCE.md) and [root instructions](../AGENTS.md) |

## Generated documents

| Output | Source and command |
| --- | --- |
| [Roadmap site](roadmap/index.html) | [Roadmap source](roadmap/roadmap.md), tagged phase/reference/migration sections, and [renderer](../scripts/docs/generate-roadmap.ts); `npm run roadmap`, then `npm run roadmap:check` |
| [Store catalog, §2](rebuild/reference/stores.md) | Store declarations through [src/backend/app/registries/task-registry.ts](../src/backend/app/registries/task-registry.ts); `npm run stores:catalog`, then `npm run stores:catalog:check` |

Edit generated content at its source. The remaining sections of the store reference are authored
prose. [Roadmap notation](roadmap/notation.md) documents the plan bindings.

## Earlier paths

The former `docs/migrations/`, `docs/guides/`, and `docs/findings/` folders now live under
`docs/rebuild/`, with their filenames retained. Source-pinned citations, frozen history, and temporary handoffs may still
cite those earlier paths. Source comments participate in workflow fingerprints, so their historical
citations are resolved through this map without changing runtime identities. Former flat phase paths resolve through the [plans index](rebuild/plans/README.md#earlier-paths); current roadmap bindings name the split files. Reference paths are unchanged.

The former `docs/sidetracks/` database plans are consolidated in
[Phase 2.6 database modernization](rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md).
Its `history/` folder retains completed timeline T1 and worker/operation/command rename evidence;
current task cards and launch prompts use the combined owner. No old sidetrack entry point is active.
