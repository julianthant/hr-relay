# Shared test support

This catalogue lists every shared non-test module in `tests/support/`. Fixtures contain synthetic data; resource harnesses allocate only when explicitly called. Tests of support modules sit beside them. `tests/parity/` retains the desktop screenshot contract.

`config/test-data.json` owns tracked public subjects, named files and synthetic ranges through `src/backend/app/registries/test-data.ts`. Private `config/test-data.local.json` inputs are accessed through the opaque runtime input source and never shared fixtures. Preserve ranges, clocks and dataset sizes.

`tests/architecture/tooling/test-data-ownership.test.ts` owns import-purity and resource capability exceptions. Shared admission helpers bind database and credential fixtures to exact synthetic installation roots; release admission before removing roots. Credential factories stay inside deferred function bodies. `preflight/corpus` uses Chromium only for launch-refusal spies in its explicit executor. Proxy construction does not open databases. Executable process fixtures cannot be imported; their exact consumers are recorded in the ownership guard.

Parity and served dashboard BFFs retain separate corpus and build authority: `tests/parity/helpers/bundle.ts` validates `dist/parity-dashboard`; `helpers/dashboard/served-fixtures/bundle.ts` validates `dist/dashboard`. Their profile data, route closures, build roots and disposal remain separate. Common setup bodies live in `helpers/dashboard/profiles/`; each profile supplies its authored fixture inputs and allocates its own values. Seeded lifecycle functions share `helpers/dashboard/served-fixtures/seeded-lifecycle.ts`.

`../helpers/dashboard/run-start-dialog-harness.ts` supplies per-caller Run Start DOM setup and cleanup for the dialog and omitted-step unit suites; importing it performs no DOM setup.


`createBoundProfileFixture` distinguishes raw storage setup (`pending: "storage"`) from a retained private draft (`pending: "onboarding"`). `finish()` consumes that held draft; it never reopens raw setup.
## Module catalogue

Paths are relative to `tests/support/`. Modules under `fixtures/` supply parsed inputs or fixture authority; modules under `helpers/` build harnesses or support fixture consumers; `processes/` contains executable child entrypoints.

| Module | Concept |
| --- | --- |
| `fixtures/child-execution-build-manifest.ts` | build manifest for the owned child execution process fixture |
| `fixtures/child-execution-workflows.ts` | canonical child workflow definitions for lifecycle and crash tests |
| `fixtures/child-execution-write-workflow.ts` | child write workflow with durable attempting and UNKNOWN controls |
| `helpers/assistant-function-fixtures.ts` | synthetic assistant function descriptors and recording call owners |
| `fixtures/person-lookup-presentation.ts` | fictional served Person Lookup presentation evidence |
| `fixtures/advisory-prompt-fixtures.ts` | advisory prompt fixtures |
| `fixtures/cross-date-search-corpus.ts` | cross date search corpus |
| `fixtures/dashboard/diagnostic-jpeg-fixture.ts` | diagnostic jpeg fixture |
| `fixtures/dashboard/fixture-activity.ts` | fixture activity |
| `fixtures/dashboard/fixture-bootstrap.ts` | fixture bootstrap |
| `fixtures/dashboard/fixture-day.ts` | fixture day |
| `fixtures/dashboard/fixture-detail.ts` | fixture detail |
| `fixtures/dashboard/fixture-diagnostic.ts` | fixture diagnostic |
| `fixtures/dashboard/fixture-explorer.ts` | fixture explorer |
| `fixtures/dashboard/fixture-gate.ts` | fixture gate |
| `fixtures/dashboard/fixture-identity.ts` | fixture identity |
| `fixtures/dashboard/fixture-intake-authority.ts` | fixture intake authority |
| `fixtures/dashboard/fixture-intake.ts` | fixture intake |
| `fixtures/dashboard/fixture-notifications.ts` | fixture notifications |
| `fixtures/dashboard/fixture-operation-authority.ts` | fixture operation authority |
| `fixtures/dashboard/fixture-profile.ts` | fixture profile |
| `fixtures/dashboard/fixture-queue.ts` | fixture queue |
| `fixtures/dashboard/fixture-run-captures.ts` | fixture run captures |
| `fixtures/dashboard/fixture-settings.ts` | fixture settings |
| `fixtures/dashboard/fixture-start.ts` | fixture start |
| `fixtures/dashboard/fixture-storage.ts` | fixture storage |
| `fixtures/dashboard/fixture-wire-error.ts` | fixture wire error |
| `fixtures/dashboard/run-detail/context-data.ts` | context data |
| `fixtures/dashboard/run-detail/gates-park.ts` | gates park |
| `fixtures/dashboard/run-detail/logs-captures.ts` | logs captures |
| `fixtures/dashboard/run-detail/receipts-failures.ts` | receipts failures |
| `fixtures/dashboard/run-detail/section-wire.ts` | section wire |
| `fixtures/dashboard/run-detail/timeline.ts` | timeline |
| `fixtures/dashboard-stream-seams.ts` | dashboard stream seams |
| `fixtures/descriptor-fixtures.ts` | descriptor fixtures |
| `fixtures/diagnostic-image-fixtures.ts` | diagnostic image fixtures |
| `fixtures/dry-run/person-lookup-manifest.ts` | person lookup manifest |
| `fixtures/dry-run/separations-manifest.ts` | separations manifest |
| `fixtures/explorer-authority.ts` | explorer authority |
| `fixtures/explorer-seams.ts` | explorer seams |
| `fixtures/image-geometry.ts` | image geometry |
| `fixtures/intake-kernel-seams.ts` | intake kernel seams |
| `fixtures/intake-workflow-fixture.ts` | intake workflow fixture |
| `fixtures/integration/activity-person-pseudonym-fixtures.ts` | activity person pseudonym fixtures |
| `fixtures/integration/settings-runtime-corruption-fixtures.ts` | settings runtime corruption fixtures |
| `fixtures/integration/source-bound-fixtures.ts` | source bound fixtures |
| `fixtures/ledger-projection-fixtures.ts` | ledger projection fixtures |
| `fixtures/operator-command-fixtures.ts` | operator command fixtures |
| `fixtures/phase1c-contract-fixtures.ts` | phase1c contract fixtures |
| `fixtures/phase1f-run-fixtures.ts` | phase1f run fixtures |
| `fixtures/plan1-browser-operation.ts` | plan1 browser operation |
| `fixtures/plan1-operation-workflows.ts` | plan1 operation workflows |
| `fixtures/plan1-separation-operation.ts` | plan1 separation operation |
| `fixtures/preflight/corpus.ts` | corpus |
| `fixtures/preflight/runtime-fixture.ts` | runtime fixture |
| `fixtures/preflight/served-runtime.ts` | served runtime |
| `fixtures/preflight-seams.ts` | preflight seams |
| `fixtures/receipt-run-fixtures.ts` | receipt run fixtures |
| `fixtures/rerun-values-fixtures.ts` | rerun values fixtures |
| `fixtures/run-launch-fixtures.ts` | run launch fixtures |
| `fixtures/run-lifecycle-fixtures.ts` | run lifecycle fixtures |
| `fixtures/run-operations.ts` | run operations |
| `fixtures/settings-operation-fixtures.ts` | settings operation fixtures |
| `fixtures/source-bound-read-fixtures.ts` | source bound read fixtures |
| `fixtures/start-step-omission-fixtures.ts` | start step omission fixtures |
| `fixtures/workflow/step-omission-terminal-fixtures.ts` | step omission terminal fixtures |
| `fixtures/workflow-definition-fixtures.ts` | workflow definition fixtures |
| `fixtures/write-sequencer-fixtures.ts` | write sequencer fixtures |
| `helpers/admission-fixture.ts` | admission fixture |
| `helpers/credential-keychain-fake.ts` | process-local fake keychain and child custody snapshots |
| `helpers/credential-keychain-process-preload.ts` | resolves keyring imports to the fake before child fixture evaluation |
| `helpers/caching-compiler-host.ts` | content-checked shared parsed compiler sources and fresh Programs |
| `helpers/backend/cross-date-search-harness.ts` | cross date search harness |
| `helpers/backend/dashboard-harness.ts` | dashboard harness |
| `helpers/backend/failure-resolution-peer.ts` | failure resolution peer |
| `helpers/backend/http-route-harness.ts` | http route harness |
| `helpers/backend/served-database-surfaces-fixtures.ts` | served database surfaces fixtures |
| `helpers/backend/settings-activation-fixture.ts` | settings activation fixture |
| `helpers/backend/trust-authority-fixture.ts` | trust authority fixture |
| `helpers/browser/fake-login-page.ts` | fake login page |
| `helpers/canonical-run-reader.ts` | canonical run reader |
| `helpers/assistant-coupled-server.ts` | served synthetic assistant browser proof and owned cleanup |
| `helpers/assistant-coupled-world.ts` | coupled assistant account transport, canonical authority and pure planner fixtures |
| `helpers/chatgpt-account-fixtures.ts` | synthetic ChatGPT account fixtures |
| `helpers/dashboard-model-fixtures.ts` | dashboard run detail, queue, pagination and artifact data |
| `helpers/dashboard/fixture-bff.ts` | fixture bff |
| `helpers/dashboard/profiles/bundle-setup.ts` | bundle profile setup |
| `helpers/dashboard/profiles/date-navigation-server-setup.ts` | date navigation server profile setup |
| `helpers/dashboard/profiles/diagnostic-jpeg-fixture-setup.ts` | diagnostic jpeg fixture profile setup |
| `helpers/dashboard/profiles/fixture-activity-routes-setup.ts` | fixture activity routes profile setup |
| `helpers/dashboard/profiles/fixture-bff-setup.ts` | fixture bff profile setup |
| `helpers/dashboard/profiles/fixture-bootstrap-setup.ts` | fixture bootstrap profile setup |
| `helpers/dashboard/profiles/fixture-day-setup.ts` | fixture day profile setup |
| `helpers/dashboard/profiles/fixture-detail-routes-setup.ts` | fixture detail routes profile setup |
| `helpers/dashboard/profiles/fixture-detail-setup.ts` | fixture detail profile setup |
| `helpers/dashboard/profiles/fixture-diagnostic-setup.ts` | fixture diagnostic profile setup |
| `helpers/dashboard/profiles/fixture-explorer-routes-setup.ts` | fixture explorer routes profile setup |
| `helpers/dashboard/profiles/fixture-explorer-setup.ts` | fixture explorer profile setup |
| `helpers/dashboard/profiles/fixture-gate-setup.ts` | fixture gate profile setup |
| `helpers/dashboard/profiles/fixture-identity-setup.ts` | fixture identity profile setup |
| `helpers/dashboard/profiles/fixture-intake-routes-setup.ts` | fixture intake routes profile setup |
| `helpers/dashboard/profiles/fixture-notifications-setup.ts` | fixture notifications profile setup |
| `helpers/dashboard/profiles/fixture-profile-setup.ts` | fixture profile profile setup |
| `helpers/dashboard/profiles/fixture-queue-routes-setup.ts` | fixture queue routes profile setup |
| `helpers/dashboard/profiles/fixture-queue-setup.ts` | fixture queue profile setup |
| `helpers/dashboard/profiles/fixture-run-captures-setup.ts` | fixture run captures profile setup |
| `helpers/dashboard/profiles/fixture-settings-routes-setup.ts` | fixture settings routes profile setup |
| `helpers/dashboard/profiles/fixture-settings-setup.ts` | fixture settings profile setup |
| `helpers/dashboard/profiles/fixture-shell-routes-setup.ts` | fixture shell routes profile setup |
| `helpers/dashboard/profiles/fixture-start-routes-setup.ts` | fixture start routes profile setup |
| `helpers/dashboard/profiles/fixture-start-setup.ts` | fixture start profile setup |
| `helpers/dashboard/profiles/fixture-storage-routes-setup.ts` | fixture storage routes profile setup |
| `helpers/dashboard/profiles/fixture-storage-setup.ts` | fixture storage profile setup |
| `helpers/dashboard/profiles/run-detail/context-data-setup.ts` | context data profile setup |
| `helpers/dashboard/profiles/run-detail/gates-park-setup.ts` | gates park profile setup |
| `helpers/dashboard/profiles/run-detail/logs-captures-setup.ts` | logs captures profile setup |
| `helpers/dashboard/profiles/run-detail/receipts-failures-setup.ts` | receipts failures profile setup |
| `helpers/dashboard/profiles/run-detail/timeline-setup.ts` | timeline profile setup |
| `helpers/dashboard/profiles/seeded-bff-setup.ts` | seeded bff profile setup |
| `helpers/dashboard/profiles/seeded-services-setup.ts` | seeded services profile setup |
| `helpers/dashboard/run-start-dialog-harness.ts` | run start dialog harness |
| `helpers/dashboard/served-fixtures/bundle.ts` | bundle |
| `helpers/dashboard/served-fixtures/date-navigation-server.ts` | date navigation server |
| `helpers/dashboard/served-fixtures/diagnostic-gallery-origin.ts` | diagnostic gallery origin |
| `helpers/dashboard/served-fixtures/fixture-activity-routes.ts` | fixture activity routes |
| `helpers/dashboard/served-fixtures/fixture-bff.ts` | fixture bff |
| `helpers/dashboard/served-fixtures/fixture-detail-routes.ts` | fixture detail routes |
| `helpers/dashboard/served-fixtures/fixture-explorer-routes.ts` | fixture explorer routes |
| `helpers/dashboard/served-fixtures/fixture-intake-routes.ts` | fixture intake routes |
| `helpers/dashboard/served-fixtures/fixture-queue-routes.ts` | fixture queue routes |
| `helpers/dashboard/served-fixtures/fixture-settings-routes.ts` | fixture settings routes |
| `helpers/dashboard/served-fixtures/fixture-shell-routes.ts` | fixture shell routes |
| `helpers/dashboard/served-fixtures/fixture-start-routes.ts` | fixture start routes |
| `helpers/dashboard/served-fixtures/fixture-storage-routes.ts` | fixture storage routes |
| `helpers/dashboard/served-fixtures/seeded-bff.ts` | seeded bff |
| `helpers/dashboard/served-fixtures/seeded-identity.ts` | seeded identity |
| `helpers/dashboard/served-fixtures/seeded-lifecycle.ts` | seeded lifecycle |
| `helpers/dashboard/served-fixtures/seeded-services.ts` | seeded services |
| `helpers/dashboard/settings-harness.tsx` | settings harness |
| `helpers/database-foundation/fixtures.ts` | fixtures |
| `helpers/duo-ceremony-fixtures.ts` | duo ceremony fixtures |
| `helpers/failure-resolution/fixtures.ts` | fixtures |
| `helpers/geocode/nominatim-client.ts` | nominatim client |
| `processes/onboarding-native-orphan-owner.ts` | owned canonical Chromium orphan after Node owner SIGKILL |
| `helpers/geocode/nominatim-parent.ts` | parent-owned geocode queue and IPC disconnect |
| `helpers/integration/journaled-protected-settings.ts` | journaled protected settings |
| `helpers/integration/storage-recovery-fixture.ts` | storage recovery fixture |
| `helpers/kuali-finalization-fixtures.ts` | kuali finalization fixtures |
| `helpers/operation-display-fixtures.ts` | operation display schemas, bindings and fixture builders |
| `helpers/phase1f-executor-harness.ts` | phase1f executor harness |
| `helpers/protected-secret-source.ts` | protected secret source |
| `helpers/registered-workflows.ts` | registered workflows |
| `helpers/retained-dashboard-mock-fixtures.ts` | retained dashboard mock sites and literals |
| `helpers/run-integration-world.ts` | per-caller run database, clock and lifecycle setup |
| `helpers/search-workflow-definition-fixtures.ts` | search input and workflow definition builders |
| `helpers/seeded-dashboard-world.ts` | run records, queued events and dashboard seed builders |
| `helpers/separation-identity-packet-fixture.ts` | synthetic separation identity approval packet |
| `helpers/separation-task-fixtures.ts` | separation task inputs, context and refusal fixtures |
| `helpers/separations-composition-fixtures.ts` | separations composition fixtures |
| `helpers/settings-storage-doctor-fixtures.ts` | settings storage reports and resize observer fixture |
| `helpers/storage/native-authority/retained-database-fixture.ts` | retained database fixture |
| `helpers/storage/storage-relocation-fixture.ts` | storage relocation fixture |
| `helpers/storage/synchronous-mutex-deadline.ts` | scoped 5,000 ms manual-clock mutex polling |
| `helpers/storage/transaction-history-fixture.ts` | transaction history fixture |
| `helpers/synthetic-database-admission.ts` | synthetic database admission |
| `helpers/synthetic-storage-admission.ts` | synthetic storage admission |
| `helpers/t1b-manifests.ts` | t1b manifests |
| `helpers/test-data/test-data-source.ts` | test data source |
| `helpers/timeline-write-fixture.ts` | timeline write fixture |
| `helpers/write-fence-fixture.ts` | claimed write-fence setup and caller-supplied corrupt SQLite seeding |
| `helpers/trust/trust-wire-fixtures.ts` | trust wire fixtures |
| `processes/run-record-race-worker.ts` | run record race worker |
| `processes/runtime-lock-contender.ts` | runtime lock contender |
| `processes/worker-browser-control-cli.ts` | worker browser control cli |
| `processes/worker-composition-child.ts` | real worker composition concurrency fixture |
| `processes/verification-reservation-owner.ts` | standalone verification reservation crash fixture |
| `processes/worker-stub-cli.ts` | worker stub cli |
| `helpers/browser/session-factory-fixtures.ts` | fresh browser factory and worker session runtime |
| `helpers/workflow/flow-task-fixtures.ts` | flow, graph and scenario task contracts |
| `helpers/intake/work-study-fixtures.ts` | WorkStudy projection and manifest input |
| `helpers/dashboard/activity-report-fixtures.ts` | empty and populated Activity report input |

| `helpers/credential-persistence-fixtures.ts` | fresh protected credential request and crash fixtures |
| `helpers/credential-doctor-fixtures.ts` | native credential doctor fixture and inventory |
| `helpers/test-target-registry-fixtures.ts` | registry subjects and recording public inputs |
| `helpers/backend/note-scope-fixtures.ts` | note and terminal event fixture inputs |
| `helpers/backend/owned-vite-probe-fixtures.ts` | owned local Vite probe server |
| `helpers/dry-run-scenario-fixtures.ts` | fresh rehearsal manifest, evidence assertions and verification-only orchestration |

| `helpers/dashboard/search-page-fixtures.ts` | fresh authored zero-match search page |

| `helpers/kuali-finalization-input-fixtures.ts` | pure raw Kuali finalization inputs |

| `helpers/backend/notification-inbox-world.ts` | notification inbox world |
| `helpers/workflow/omission-definition-fixtures.ts` | omission definition fixtures |
| `helpers/dashboard/identity-ceremony-fixtures.ts` | identity ceremony fixtures |
| `helpers/dashboard/static-assets.ts` | static asset fixture serving for both BFF profiles |
| `helpers/backend/run-claim-fixtures.ts` | run claim fixtures |
| `helpers/backend/worker-lease-fixtures.ts` | worker lease fixtures |
| `helpers/backend/separation-start-fixtures.ts` | separation start fixtures |

| `helpers/dashboard/client-day-fixtures.ts` | client day fixtures |
| `helpers/dashboard/awaiting-queue-fixtures.ts` | awaiting queue fixtures |
| `helpers/backend/stream-backpressure-fixtures.ts` | stream backpressure fixtures |
| `helpers/storage/backup-fixtures.ts` | backup fixtures |
| `helpers/ucpath-pending-row-fixtures.ts` | Keiichiro pending rows and deterministic driver transaction rows |
| `helpers/storage/admission-child-fixtures.ts` | admission child fixtures |
| `helpers/backend/preflight-port-fixtures.ts` | preflight port fixtures |
| `helpers/dashboard/settings-editor-fixtures.ts` | settings editor fixtures |
| `helpers/backend/worker-supervision-world.ts` | worker supervision world |
| `helpers/backend/command-kernel-harness.ts` | command kernel harness |

## File fixtures

- `fixtures/documents/synthetic-sample.pdf`
- `fixtures/integration/run-completion/schema40-success.json`
- `fixtures/preflight/environment-doctor.json`
- `fixtures/spreadsheet/color-filtered-roster.xlsx`
- `fixtures/storage/native-authority/migrated-database-renames.json`
- `fixtures/storage/native-authority/migrated-operations.json`
- `fixtures/storage/native-authority/migrated-provider.json`
- `fixtures/storage/native-authority/migrated-settlement.json`
- `fixtures/storage/native-authority/migrated-timeline.json`
- `fixtures/storage/native-authority/migrated-tombstones.json`
- `fixtures/storage/native-authority/schema40-failure.json`
- `helpers/dashboard/color-filtered-roster.xlsx`
| `helpers/backend/kernel-stub-command-fixtures.ts` | createKernelStubCommandFixtures shared fixtures |
| `helpers/backend/kernel-reject-member-run.ts` | kernelRejectMemberRecord shared fixtures |
| `helpers/backend/person-lookup-start-fixtures.ts` | createPersonLookupStartFixtures shared fixtures |
| `helpers/backend/person-lookup-provenance-checkpoint.ts` | createPersonLookupProvenanceCheckpoint shared fixtures |
| `helpers/storage/confirmed-retention-fixtures.ts` | openConfirmedRetentionDatabase shared fixtures |
| `helpers/storage/first-install-custody-fixtures.ts` | createFirstInstallCustodyFixture shared fixtures |
| `helpers/backend/person-lookup-receipt-database.ts` | openPersonLookupReceiptDatabase shared fixtures |
