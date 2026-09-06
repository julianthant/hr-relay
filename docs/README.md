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
│   ├── reference/        Contracts, decision pointers, lessons, and store catalog
│   ├── migrations/       Workflow migration and acceptance records
│   ├── guides/           Practical instructions grounded in the contracts and code
│   ├── findings/         Diagnoses and proposals awaiting or recording disposition
│   ├── history/          Frozen reviews, design inputs, and superseded text
│   └── guard-inventory.json  Reviewed guard manifest
├── decisions/            Supporting context for operator decisions
└── handoffs/             Temporary recovery state for interrupted work
```

## Find the right document

| Work | Start here |
| --- | --- |
| Find the assigned phase or task | [Roadmap source](roadmap/roadmap.md), then the overview or task file named by its `doc:` binding; [plans index](rebuild/plans/README.md) |
| Find a requirement's owner | [D1 ownership map](roadmap/roadmap.md#d1-ownership-map--the-quick-index-concept--owning-doc); `ref <slug>` means `rebuild/reference/<slug>.md` |
| Understand a numbered decision | [Decision pointer index](rebuild/reference/decisions.md), then its named owner; [operator context](decisions/README.md) explains choices |
| Add or change a workflow | [Workflow authoring guide](rebuild/guides/workflow-authoring.md), then its [migration record](rebuild/migrations/README.md) |
| Diagnose or record a gap | [Findings index](rebuild/findings/README.md); a finding does not authorize implementation |
| Investigate a previous failure | Search [shared lessons](rebuild/reference/lessons.md) by seam or decision; module instructions point to scoped ledgers |
| Recover an old citation | [History index](rebuild/history/README.md); frozen text retains its original names and dates |
| Run checks or operate the repository | [Repository operating reference](../.agents/skill-library/repository-work/REFERENCE.md) and [root instructions](../AGENTS.md) |

## Generated documents

| Output | Source and command |
| --- | --- |
| [Roadmap site](roadmap/index.html) | [Roadmap source](roadmap/roadmap.md), tagged phase/reference/migration sections, and [renderer](../scripts/generate-roadmap.ts); `npm run roadmap`, then `npm run roadmap:check` |
| [Store catalog, §2](rebuild/reference/stores.md) | Store declarations through [src/stores/index.ts](../src/stores/index.ts); `npm run stores:catalog`, then `npm run stores:catalog:check` |

Edit generated content at its source. The remaining sections of the store reference are authored
prose. [Roadmap notation](roadmap/notation.md) documents the plan bindings.

## Earlier paths

The former `docs/migrations/`, `docs/guides/`, and `docs/findings/` folders now live under
`docs/rebuild/`, with their filenames retained. Source-pinned citations, frozen history, and temporary handoffs may still
cite those earlier paths. Source comments participate in workflow fingerprints, so their historical
citations are resolved through this map without changing runtime identities. Former flat phase paths resolve through the [plans index](rebuild/plans/README.md#earlier-paths); current roadmap bindings name the split files. Reference paths are unchanged.
