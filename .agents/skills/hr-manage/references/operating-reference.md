# Repository operating reference

[Root instructions](../../../../AGENTS.md) own agent rules, review, tests and reporting.
Read this reference for runtime commands and environment behavior. The
[codebase map](../../../../docs/reference/codebase-structure.md) names source owners;
[reference contracts](../../../../docs/README.md#reference-index) describe each subsystem.

## Commands

| Purpose | Command |
| --- | --- |
| TypeScript | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit, integration, architecture and perf | `npm run test` |
| One Vitest project | `npm run test:unit`, `test:integration`, `test:architecture`, `test:local`, `test:perf` |
| Coverage of unit, integration and architecture | `npm run test:coverage` |
| Watch | `npm run test:watch` |
| Runtime CLI | `npm run cli` |
| Backend and Vite together | `npm run dashboard` |
| Backend alone | `npm run backend` |
| Vite alone, with an existing backend | `npm run web` |
| Production dashboard | `npm run web:build`, then `npm run dashboard:prod` |
| Windows observer preparation | `npm run build:observer-policy` |
| Roadmap generation and freshness | `npm run roadmap`, then `npm run roadmap:check` |

The CLI exposes help, phase, dashboard, worker, explain, storage, OCR and test-data commands.
Workflow execution starts from the signed-in dashboard Run surface. Ctrl+C on the combined dev
command stops both servers. Separate Vite sessions need a restart after the backend restarts to
renew ownership proof. Contract fingerprints are computed in memory without preparation. A running
dashboard freezes its build id at start, so worker code changes need a runtime restart.
[Guards and tests](../../../../docs/reference/guards-and-tests.md) describes script selection and build identity.

## Operational isolation

`config/runtime-isolation.json` declares checkout-relative default roots, ports and the browser
session namespace. `rebuildRuntimeIsolation` supplies them to the runtime.

| Resource | Default |
| --- | --- |
| State root | `.tracker/data` |
| Artifact root | `.tracker/data/artifacts` |
| Backend and frontend ports | `3938` and `5174` |
| Process-lock root | `.tracker/data/locks` |
| Browser profile root | `.tracker/data/browsers` |
| Browser session namespace | `hrauto-rebuild` |

The installation locator selects active state and artifact roots; process locks stay at the
fixed checkout location. An established installation with a missing or malformed locator refuses
instead of selecting another root. `installation.ts` stores checkout control under `.tracker/control`.

SQLite holds ordinary settings and immutable snapshots with database authority; the independent
credential store holds protected values. Clean shutdown and upgrades create verified SQLite
backups. Flat archive admission does not claim, register or adopt historical rows. The start-clean
reader verifies the archive before removal. Run deletion retains terminal records and
`deleted_runs` tombstones. [Clock, configuration and secrets](../../../../docs/reference/clock-config-secrets.md)
describes source and recovery restrictions.

## Environment

Startup does not load environment files. `src/backend/app/bootstrap/secure-env-bootstrap.ts`
accepts only `cli` and `test-target-document-number`. Normal runtime commands check migrated parent
environment names after admission; `storage` and `test-data` commands skip that check.

`hostAwareResolutionEnvironment` publishes the probed display as `HRAUTO_HOST_PRIMARY_DISPLAY`.
Workers receive that value and allowlisted OS process keys. Operational credentials come from the
local credential store, rather than `.env`.

The typed subject registry checks availability before private input reads or browser composition.
Unknown, unavailable, consumed or pending subjects block execution; available subjects with bad
input fail. The [root safety rules](../../../../AGENTS.md#runtime-safety) govern secret handling and
live verification. [Guards and tests](../../../../docs/reference/guards-and-tests.md#10-rehearsal-and-test-data-provenance)
describes subject provenance.

## Browser and porting references

[Fast Duo](../../../../fast-duo/README.md) describes extension staging and full Chromium requirements.
The workflow session factory uses `paths.duoExtensionDir` and `workflow-manifest.json`, provisioning
retained credentials into trusted session storage before login. New credential enrollment needs
the operator.

[Live verification](../../verify/SKILL.md) and its feature map describe dashboard dry runs.
The global `playwright-cli` skill owns browser tool usage. The root instructions own
[production isolation and copy provenance](../../../../AGENTS.md#runtime-safety); source and selector
fixture owners are in the codebase map.
