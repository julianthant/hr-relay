# Documentation

Start with the [codebase map](reference/codebase-structure.md) to find source, test, and documentation owners. For workflow changes, use the [workflow authoring guide](guides/workflow-authoring.md).

Read the [root instructions](../AGENTS.md) for task rules. Use the [repository operating reference](../.agents/skills/hr-manage/references/operating-reference.md) for environment, porting, and conventions.

## Folder map

| Path | Contents |
| --- | --- |
| `reference/` | Current contracts, codebase map, and store catalog. |
| `guides/` | Workflow authoring guide. |
| `guard-inventory.json` | Registered guards and their owners. |
| `roadmap/roadmap.md` | Roadmap source. |
| `roadmap/index.html` | Generated roadmap site. |
| `images/` | Images used by the repository README. |

## Reference index

| Topic | References |
| --- | --- |
| Project vocabulary | [Terminology](reference/terminology.md) |
| Source and tests | [Codebase map](reference/codebase-structure.md), [guards and tests](reference/guards-and-tests.md) |
| Workflows and tasks | [Workflow model](reference/workflow-model.md), [task contract](reference/task-contract.md) |
| Writes, sessions, and evidence | [Write safety](reference/write-safety.md), [execution and sessions](reference/execution-and-sessions.md), [operator trust](reference/operator-trust.md) |
| Configuration and intake | [Clock, configuration, and secrets](reference/clock-config-secrets.md), [data intake and Edit Data](reference/data-intake-and-edit-data.md) |
| Store bindings and catalog | [Stores](reference/stores.md) |
| Dashboard | [Frontend and backend integration](reference/frontend-backend-integration.md), [dashboard surfaces](reference/dashboard-surfaces.md) |
| Planned UCPath receipt acceptance | [Charter](reference/charter.md) |

## Generated documents

The [roadmap site](roadmap/index.html) is generated from [the roadmap source](roadmap/roadmap.md). Run `npm run roadmap`, then `npm run roadmap:check`.

## Repository policy

[Repository governance](repository-governance.md) lists branch protection checks and privacy-check scope.

## Evidence

The [task instructions](../AGENTS.md#what-to-build) own evidence placement, and the [Git instructions](../AGENTS.md#git) own worktree naming. Selector manifests used by semantic registry tests live under [`tests/support/fixtures/ui/`](../tests/support/fixtures/ui/).
