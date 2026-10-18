# Documentation

Start with the [codebase map](rebuild/reference/codebase-structure.md) to find source, test, and documentation owners. For workflow changes, use the [workflow authoring guide](rebuild/guides/workflow-authoring.md).

Read the [root instructions](../AGENTS.md) for task rules. Use the [repository operating reference](../.agents/skill-library/repository-work/REFERENCE.md) for environment, porting, and conventions.

## Folder map

| Path | Contents |
| --- | --- |
| `rebuild/reference/` | Current contracts, codebase map, and store catalog. |
| `rebuild/guides/` | Workflow authoring guide. |
| `rebuild/guard-inventory.json` | Registered guards and their owners. |
| `roadmap/roadmap.md` | Roadmap source. |
| `roadmap/index.html` | Generated roadmap site. |
| `images/` | Images used by the repository README. |

## Reference index

| Topic | References |
| --- | --- |
| Source and tests | [Codebase map](rebuild/reference/codebase-structure.md), [guards and tests](rebuild/reference/guards-and-tests.md) |
| Workflows and tasks | [Workflow model](rebuild/reference/workflow-model.md), [task contract](rebuild/reference/task-contract.md) |
| Writes, sessions, and evidence | [Write safety](rebuild/reference/write-safety.md), [execution and sessions](rebuild/reference/execution-and-sessions.md), [operator trust](rebuild/reference/operator-trust.md) |
| Configuration and intake | [Clock, configuration, and secrets](rebuild/reference/clock-config-secrets.md), [data intake and Edit Data](rebuild/reference/data-intake-and-edit-data.md) |
| Store bindings and catalog | [Stores](rebuild/reference/stores.md) |
| Dashboard | [Frontend and backend integration](rebuild/reference/frontend-backend-integration.md), [dashboard surfaces](rebuild/reference/dashboard-surfaces.md) |
| Planned UCPath receipt acceptance | [Charter](rebuild/reference/charter.md) |

## Generated documents

The catalog section in [Stores](rebuild/reference/stores.md) is generated from [the task registry](../src/backend/app/registries/task-registry.ts). Run `npm run stores:catalog`, then `npm run stores:catalog:check`.

The [roadmap site](roadmap/index.html) is generated from [the roadmap source](roadmap/roadmap.md). Run `npm run roadmap`, then `npm run roadmap:check`.

## Repository policy

[Repository governance](repository-governance.md) lists branch protection checks and privacy-check scope.

## Evidence

Briefs, receipts, and task evidence live in the main checkout's gitignored `.work/` folder. Git worktrees live in its gitignored `.worktrees/<branch>/` folder. Selector manifests used by semantic registry tests live under [`tests/support/fixtures/ui/`](../tests/support/fixtures/ui/).
