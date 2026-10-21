# Clock, configuration, and secrets

Relay resolves ordinary settings into immutable run configuration. SQLite owns saved settings and
snapshots. The independent credential store owns protected values and ChatGPT account credentials.
Installation admission owns the active storage roots. None of these authorities substitutes for another.

## Owners

| Contract | Enforcing module |
| --- | --- |
| Wall time, monotonic elapsed time, local dates, and fiscal years | `src/rules/time/clock.ts` |
| Closed configuration grammar and route keys | `src/models/config/schema.ts` |
| Settings membership and source classification | `src/models/config/catalog.ts` |
| Settings resolution, provenance, and fingerprint | `src/backend/app/config/resolve.ts` |
| Filesystem defaults | `src/backend/app/config/runtime-paths.ts` |
| Saved settings, command and audit authentication | `src/backend/storage/sqlite/settings-storage.ts` |
| Settings initialization and activation | `src/backend/storage/sqlite/settings-activation.ts` |
| New-run and retained-run snapshot selection | `src/backend/runs/settings/run-settings.ts` |
| Protected names, value schemas, and marked patches | `src/models/config/protected-settings.ts` |
| Credential access | `src/models/config/secrets.ts` |
| Private credential persistence | `src/backend/storage/configuration/credential-store.ts` |
| Shared credential file safety | `src/backend/storage/configuration/credential-safe-file.ts` |
| Installation identity, locator, ownership witnesses, and relocation journal | `src/backend/storage/admission/installation.ts` |
| Lifetime and path-specific storage capability | `src/backend/storage/admission/admission.ts` |
| Entrypoint admission and secure bootstrap | `src/backend/storage/admission/bootstrap-admission.ts`, `src/backend/app/bootstrap/secure-env-bootstrap.ts` |

[Execution and sessions](execution-and-sessions.md) owns browser leases, Duo ceremonies, and shutdown.
[Operator trust](operator-trust.md) owns capture, classified local evidence, and outbound data.
[Stores](stores.md) owns the table catalog. [Guards and tests](guards-and-tests.md) owns verification.

## Clock

`Clock` exposes `now(): Date`, `nowMs(): number`, `monotonicMs(): number`, `todayLocal(): string`,
`timeOfDayCode(at?: Date): string`, and `fiscalYear(at?: Date): number`.
`systemClock` is frozen. Its wall reads use `new Date()` and `Date.now()`; its elapsed read uses
`performance.now()`. Wall instants serialize as ISO timestamps. Process-monotonic readings measure
budgets and durations and are not serialized as wall instants.

`todayLocal()` returns `YYYY-MM-DD`. `timeOfDayCode()` returns local `HHMMSS`.
`localDatePart(at)` and `formatTraceTimestamp(at)` are pure formatters.
The fiscal year runs July 1 through June 30 and takes the ending calendar year's number.
`runtimeTimeZone()` validates the runtime's IANA zone or throws `runtime-time-zone-unavailable`.
`machineMonotonicMs()` uses `process.hrtime.bigint()` for backend IPC deadlines that need one
machine-wide monotonic basis across processes.

`capturedInstantClock(instant, elapsed = systemClock)` validates an ISO instant and fixes its wall
readings to that instant. Each `now()` returns a fresh `Date`; elapsed readings still use the supplied
monotonic clock. Invalid input throws `RangeError` with `captured-instant-clock: invalid ISO instant`.
The relocation activation adapter uses this clock to reproduce its durable activation checkpoint.

`manualClock(at, initialMonotonicMs = 0)` returns a `TestClock` with independent `advanceWall`,
`advanceMonotonic`, and `setWall` controls. The `clock-single-source` architecture guard confines
host-clock reads to `src/rules/time/clock.ts`; `manual-clock-test-only` prevents production use of
`manualClock`. Parsing an existing instant with `Date.parse` or constructing a `Date` from an
existing value does not read the host clock.

## Configuration resolution

`resolveConfigWithProvenance(settingsInput, hostFacts, clock = systemClock, runtimeStoragePair?)`
returns `{ config, provenance, fingerprint }`. It has no environment override parameter.
`SettingsOverrideInputSchema` parses a sparse ordinary settings object, defaulting an omitted input
to `{}`. `HostConfigFactsSchema` accepts only `{ primaryDisplay: { screenWidth, screenHeight } | null }`.
The resolver supplies runtime paths and host display defaults, merges ordinary settings, then parses
the complete result through `ConfigSchema`.

Ordinary settings take precedence over defaults. `ConfigProvenanceSchema` contains only `settings`
and `default`; provenance describes values and does not control runtime decisions. The resolver
compares the populated config leaf paths with provenance keys and throws
`config provenance is not bidirectionally complete` if they differ.
`fingerprint` is SHA-256 over `canonicalJsonStringify(config)`.

`ConfigSchema` has fourteen groups: `actor`, `urls`, `timeouts`, `paths`, `annualDates`, `display`,
`performance`, `ocr`, `browserHealth`, `browser`, `concurrency`, `daemon`, `features`, and `providers`.
Every group except `paths` has contract defaults. `ConfigPathsSchema` requires nine absolute paths.
The browser-safe schema imports no Node filesystem implementation. Runtime defaults belong to
`runtime-paths.ts`, rather than a browser stub or polyfill.

`SETTINGS_CATALOG` is a parsed, recursively frozen 65-row registry. Each row names its `key`,
`schema`, `defaultKind`, `editability`, `sensitivity`, `restartScope`, `sourceClass`, and consumers.
The active source classes are `ordinary-settings`, `protected-store`, `derived-host`, and
`runtime-isolation`. The catalog validates source and sensitivity pairings, unique keys, and the
single machine-credential exception `duoWebauthnCredential`.
`ordinarySettingsObject` generates the ordinary schema membership from catalog rows and refuses a
missing schema reference. `EditableSettingsOverrideSchema` and `SettingsOverrideSchema` are the
same schema. `actor.id`, `paths.stateRoot`, and `paths.artifactRoot` are outside the ordinary editor.

The catalog's `currentSource`, `targetSource`, and `restartScope: generation` metadata do not create
file or environment authorities. Current runtime activation is implemented by `settings-service.ts`;
editor rows report `new-runs`, or `next-idle` for daemon cadence.

### Config keys and defaults

The following keys are the current grammar in `src/models/config/schema.ts`. Numeric values are
positive integers unless a row says otherwise.

| Group | Keys and contract defaults |
| --- | --- |
| `actor` | Fixed `id: LOCAL_OPERATOR_ACTOR_ID`; `label: "Local operator"` |
| `timeouts` | `navigationMs: 15000`, `longNavigationMs: 30000`, `ukgNavigationMs: 60000`, `taskMs: 180000`, `sessionAcquireMs: 60000`, `duoCeremonyLeaseGraceMs: 20000`, `transactionMs: 300000`, `duoApprovalSeconds: 180`, `duoApprovalCrmSeconds: 60`, `retryDelayMs: 5000` |
| `annualDates` | `{}`; keys match `FY` followed by four digits |
| `display` | `screenWidth: 2560`, `screenHeight: 1440`, beneath the detected host display and explicit override |
| `performance` | `navigationRetries: 10`, `separationTerminationWindowDays: 14` |
| `ocr` | `secondOpinionMax: 5`, `pageMaxWaitMs: 120000`, `tier1PatienceMs: 90000`, `pageConcurrency: 0`, `disambigConcurrency: 4`, `suggestConcurrency: 4`, `backoffBaseMs: 2000`, `backoffCapMs: 60000`, `maxValidationRetries: 1`; `pageConcurrency` and `maxValidationRetries` allow zero |
| `browserHealth` | `monitorTickMs: 30000`, `maxAutoRefresh: 10`, `maxReopen: 3`; the latter two allow zero |
| `browser` | `headless: true`, `closeProofMs: 15000` |
| `concurrency` | `defaultWorkers: 4` |
| `daemon` | `idleMs: 900000`, `idleRepollMs: 30000` |
| `features` | `debugScreenshots: false`, `duoWebAuthn: true` |
| `providers` | `geocodeCensus.timeoutMs: 15000`, `geocodeNominatim.timeoutMs: 15000` |

The remaining provider config controls invocation timeouts for `geocode.census` and
`geocode.nominatim`. There are no provider API-key pools, model chains, quota budgets, or AI-advisory
config groups. OCR settings are configuration grammar, not proof of a connected OCR provider.

### Routes and instance selection

`CONFIG_ROUTE_SCHEMAS` and `CONFIG_ROUTE_KEYS` expose the same closed route sets used by drivers.
Each configured system has a `prod` object. A route override replaces the complete object, so a
partial production route set fails schema validation.

| Config system key | Route keys |
| --- | --- |
| `kuali`, `newKronos`, `onbase`, `oldKronos`, `servicenow`, `sharepoint` | `entry` |
| `crm` | `entry`, `onboardingSearch`, `ucPathEntrySheet`, `onboardingHistory`, `idocsViewer` |
| `ucpath` | `login`, `smartHr`, `jobSummary`, `personalData`, `personProfile` |
| `i9` | `entry`, `app` |

The concrete production URL defaults live in `schema.ts`; saved `urls.<system>.prod` values can
replace them. The ordinary schema still accepts sparse `test` members, but the resolver ignores
those members and the command service refuses patches that edit them. `mergeSettingsPatch` removes
stored test-route members on a subsequent settings write. `ConfigSchema` and stored snapshots have
only `prod` routes.

`RequestedInstanceSchema` retains the exact system IDs `ucpath`, `crm`, `onbase`, `kuali`,
`servicenow`, `i9`, `new-kronos`, `old-kronos`, and `sharepoint`, with `prod` or `test` values.
`resolveInstances` and start planning refuse a requested `test` instance; undeclared system requests
also refuse. Omission selects `prod`. `resolveSystemEntryUrl` and `resolveSystemLoginUrl` refuse
non-production selection. UCPath login uses `urls.ucpath.prod.login`; its task entry uses `smartHr`.
`listSystemEntryHosts` reports test availability as `{ state: "not-provisioned" }`.
Dry run is a separate workflow behavior and does not select a sandbox route.

### Host display defaults

`src/backend/app/host/primary-display.ts` probes macOS logical display resolution with
`system_profiler`, Windows primary bounds with PowerShell, or X11 primary bounds with `xrandr`.
The observation is `detected` or `unavailable`; malformed tool output throws.
`src/models/config/host-display.ts` publishes `HRAUTO_HOST_PRIMARY_DISPLAY` as `<width>x<height>` or
`none` once per process tree. An existing publication is validated and retained without a new probe.

`hostAwareResolutionEnvironment` in `secrets.ts` is the permitted environment publication entry.
`hostConfigFacts` decodes only this publication. A null observation uses `DEFAULT_DISPLAY`;
a saved display object overrides both dimensions together. A half display object fails the ordinary
schema. The host observation remains process-scoped and is not persisted as an ordinary setting.

## Saved settings and activation

The native `settings` table has the singleton `id='current'`. Its `AppSettingsSchema` payload holds
initialization, saved settings, and active snapshot identity. `settings_snapshots` stores immutable
resolved config records. `settingsCurrent` and `runtimeConfig` are repository interfaces over this
one row, not separate tables or JSON files.

`readAppSettings` authenticates indexed row identity, initialization command and audit, saved command
and audit, and exact snapshot ID and fingerprint. Missing current settings with command or snapshot
history throws `settings-current-missing-with-history`. Missing or corrupt authority never becomes
an empty settings object. `readSettings` uses revision one only before durable settings history and
reports the current `SETTINGS_SCHEMA_HASH`. `readBootSettings` refuses missing active runtime
identity when durable settings or snapshot evidence remains.

The `settings/apply-settings` command uses `expectedRevision`, `settingsSchemaHash`,
`patchFingerprint`, and `patch`. A patch maps admitted leaf paths to `{ set: value }` or
`{ clear: true }`. Clear removes the override, so later resolution uses its default or leaves an
optional value absent. `SETTINGS_SCHEMA_HASH` derives from the editable schema;
`deriveSettingsPatchFingerprint` authenticates the canonical patch.

`src/backend/runs/commands/settings-service.ts` rejects retired test-route edits, schema mismatch,
and patch fingerprint mismatch before ordinary application. Under the kernel's SQLite transaction,
it checks the expected revision, merges the patch, resolves the complete candidate, validates
changed browser and Duo paths, and checks the 1,048,576-byte ordinary document bound. It inserts the
new snapshot and activates it. `command-kernel.ts` journals the command and audit and advances saved
settings before the same transaction commits. Failure rolls back ordinary activation and journal
changes. An ordinary success returns `restartRequired: false`.

`authenticateSavedSettings` binds the whole command and audit to the saved revision and fingerprint,
including result, affected target, version change, and commit time. A settings save is not proven by
a revision alone. Relevant refusals include `schema-mismatch`, `patch-fingerprint-mismatch`,
`not-editable`, `invalid-value`, `cross-field-invalid`, `document-too-large`, and revision conflict.
Exact command replay returns its recorded result rather than applying a new patch.

`selectNewRunIdentity` selects the active committed snapshot inside the caller's planning or creation
transaction. `selectRunSettings` authenticates a retained run's snapshot and throws
`run-settings-snapshot-mismatch` on missing or mismatched evidence. Existing runs retain their
`configSnapshotId` and `configFingerprint`. `reviewedRunSettingsCurrent` compares an unaccepted
plan's snapshot with the active snapshot; a changed selection requires new review. Accepted replay
precedes this check and keeps its original result.

`StoredConfigSchema` strips live group defaults and requires every current group and required leaf.
`ConfigSnapshotRecordSchema` verifies SHA-256 over the exact stored config.
`ConfigSnapshotWriteSchema` is the same current schema. There is no historical snapshot-generation
reader or leaf backfill. The insert-only `settings_snapshots` protections in `migrations.ts` preserve
captured evidence.

`RuntimeConfigClaimTokenSchema` contains `generation`, `settingsRevision`, `settingsFingerprint`,
and `configFingerprint`. Activation advances `generation`; credential edits do not.
`createSettingsRuntimeReader` reports `current` or `restart-required` by comparing resolved saved
identity with the authenticated active identity. The latter state reports a saved-versus-active
mismatch, not a requirement on every ordinary save.

### Paths and validation

`runtime-paths.ts` resolves defaults against the process working directory and memoizes the default
browser profile root. Entrypoint installation admission derives its workspace from the module path.
The admitted storage pair supplies `paths.stateRoot` and `paths.artifactRoot` to the resolver; it also
supplies the default browser root `<stateRoot>/browsers`. A saved browser root can override that value.

| Path | Default |
| --- | --- |
| `paths.reportsDir` | Absolute `data/reports` |
| `paths.downloadsDir` | Absolute `data/downloads` |
| `paths.onboardingDocsDir` | Absolute `data/onboarding` |
| `paths.i9CheckTrackerPath` | Absolute `data/reports/i9-check-tracker.xlsx` |
| `paths.stateRoot` | Admitted installation root, initially `.tracker/data` |
| `paths.artifactRoot` | Admitted installation root, initially `.tracker/data/artifacts` |
| `paths.browserProfileRoot` | Admitted `<stateRoot>/browsers`, or the isolation default `.tracker/data/browsers` without an admitted pair |
| `paths.duoCredential` | Absolute `<stateRoot>/credentials/duo-webauthn.json` |
| `paths.duoExtensionDir` | Absolute `duo-autopilot` |

The first four paths and the three browser/Duo paths are ordinary settings. State and artifact roots
use relocation authority. Browser, Duo credential, and extension paths are independent; changing a
browser root does not rebase the credential path.

`ordinary-path-validator.ts` validates changed effective paths, so unchanged paths do not block an
unrelated save. Browser targets require a canonical absolute path, safe ancestry and ownership, no
protected-root overlap, and an absent or empty target. The canonical default may reuse its existing
safe directory. A changed Duo credential requires an owned, one-link, 0600 regular file, no-follow
admission, a 64,000-byte bound, and recognizable `rpId` plus `credentialId` identity. This proves
identity shape, not successful authentication. The extension requires an owned unpacked MV3 directory
and manifest. `OrdinaryPathValidationError` becomes `invalid-value` before snapshot activation.

`POST /api/v1/settings/path-picker` accepts `NativePathPickerRequestSchema` and returns a selected
absolute path, cancellation, or explicit unavailable result. The native picker owns dialog bounds
and field typing. A selection does not save settings or relocate data. The route returns
`NATIVE_PATH_HINT_INVALID` for an invalid hint. Missing picker composition reports `dialog-failed`;
an occupied picker reports `busy`.

## 6. Credential access and storage

`SECRET_SPECS` has four protected-store entries: `ucpathUserId`, `ucpathPassword`, `timekeeperName`,
and `sharepointOnboardingRosterUrl`. `SECRET_FILE_SPECS` has the named file
`duoWebauthnCredential` at `paths.duoCredential`, classified `credential-file`, with a 64,000-byte
metadata bound. The protected store also retains `activityPersonPseudonym` for historical records;
its Activity consumers are absent.

The value schemas in `protected-settings.ts` are shared by persistence and access. They admit
`ucpathUserId` and `timekeeperName` strings of 1 to 256 characters, `ucpathPassword` of 1 to 4096
characters, an onboarding roster URL up to 8192 characters, and the closed pseudonym pair
`{ keyHex, keyGeneration }`. The pseudonym key is 64 lowercase hex characters; generation names
match `activity-person-[a-z0-9]+(?:-[a-z0-9]+)*`. The schemas do not trim or coerce values.

`requireSecret(name, source)` and `optionalSecret(name, source)` read the supplied
`ProtectedSecretSource` on every call. `createCredentialSecretSource` adapts the independent
credential store without caching its values or checking SQLite audit history for availability.
Missing entries produce `undefined` or `SecretMissingError`. Source failures become
`SecretSourceError`. `inspectSecret` returns `present`, `missing`, or `unknown`; it maps only
`SecretSourceError` to unknown and rethrows other errors. `protectedSecretRevision` returns a
value-free revision. `validateBootSecrets` currently has an empty required-at-boot set.

`requireSecretFile` validates the registered path with `statSync`, requires a regular file with no
group or world permission bits, checks stat size, then uses `readFileSync`. That accessor does not
use the credential-store no-follow descriptor protocol. `resolveSecretFileIdentity` parses the Duo
object, array, or `{ credentials: [...] }` shape and hashes sorted `rpId` and `credentialId` pairs
under `hrauto:duo-credential-identity:v1`. Missing identity or malformed JSON throws `SecretFileError`.
The identity excludes the private key and sign counter; [execution and sessions](execution-and-sessions.md)
owns counter custody.

### Independent private credential authority

Credential-store construction admits the exact erasure journal and anchor paths. Local journal reads
retain issued-admission liveness and pinned credential ancestry, including trusted sticky ancestors;
external machine/profile journals and credential writes retain strict storage admission. Missing
established erasure authority refuses rather than becoming an empty journal.

`<stateRoot>/credentials/` is the one home for credentials: protected settings, the ChatGPT account
and the Duo key (`duo-webauthn.json`, read through `paths.duoCredential`).
`src/backend/storage/configuration/` owns the two private records there.
`credential-store.ts` exposes the protected-settings store and the ChatGPT account repository.
Both use `credential-safe-file.ts` for ancestry and identity checks, owned 0700 directories,
0600 files, no-follow reads, fsync, atomic replacement, and lock-file safety.
Each record retains its own transaction and recovery contract.

`createCredentialStore({ admission, stateRoot })` stores `<stateRoot>/credentials/protected.json`.
The schema-3 document contains the schema-1 current record and marked replay receipts.
Each current entry holds `{ valueId, value, updatedAt }`; history retains request digests, marked
operations and allocated value IDs without replaced plaintext. A missing store represents the empty
revision-one baseline. Schema-2 input is authenticated and converted in memory; `migrateHistory()`
or a subsequent write publishes schema 3.
The store requires a live, path-bound `RuntimeAdmission`.

The protected-settings reader verifies link count, size, descriptor identity, path identity,
and stable readback. The document limit is
16 MiB; admitted private requests are bounded to 64,000 bytes. Unexpected or unsettled directory
entries refuse. Schema and replayed history must agree with the current record.

The writer serializes through `.protected.lock`, with `.protected.reaper` and
`.protected.reaper-claim` for stale-owner recovery. Owner identity includes process birth evidence;
live or unknown custody is not stolen. It stages a private file, fsyncs it, compares exact prior
bytes, renames it, fsyncs the directory, and verifies exact completion. Failures after replacement
or uncertain lock release raise `CredentialStoreCommitUncertainError` rather than claim rollback.

`settings/apply-protected-settings` carries independent `expectedRevision`, `protectedSchemaHash`,
`writeId`, and `entries`. Set allocates a fresh random `valueId`; clear removes the entry. Both advance
the credential revision. Latest exact request replay returns the current applied record; a divergent
latest replay or reused command/write identity refuses `command-divergent`. A stale revision reports
conflict; unavailable exclusion reports `lock-unavailable`.

`erase()` durably records erased value identities and retired commands before rewriting protected
entries. The local journal is `<stateRoot>/credential-erasures/journal.json` with its identity anchor;
profile sessions use the separately admitted machine journal outside the profile root. Readback
repairs restored erased values under strict writable admission and refuses missing established authority.

`settings-service.ts` commits this private operation independently before the command kernel's
value-free audit transaction. `markProtectedSettingsPatch` replaces every set value with `"<set>"`;
SQLite command identity and audit contain that marked request, not protected values or their hashes.
An audit failure throws `credential-audit-uncertain` and cannot roll back the private commit.
Replay authenticates private identity
through `verifyReplay`. Credential edits advance no ordinary settings generation. Database backup
and restore exclude and leave this credential authority unchanged.

Protected values are not `Config` leaves, so they cannot enter configuration fingerprints or
`settings_snapshots`. The local Settings query deliberately serves authenticated protected entries
and values in addition to presence readback. `buildSettingsEditor` reports an unavailable credential
store as `protectedSettings: { state: "unknown", reason: "credential-store-unavailable" }`, rather
than an empty store. This local display does not widen command journals, logs, or provider egress.

`chatgpt-credential-repository.ts` stores `<stateRoot>/credentials/chatgpt-account.json` as a
schema-1 record with registration metadata and the current session, without token history.
`createChatGptCredentialRepository` exposes `read()` and asynchronous `withLock()` transactions
through `credential-store.ts`. Replacement checks the expected revision and advances it by one.
The record has a 64,000-byte limit and uses `.chatgpt-account.lock`; stale-lock cleanup requires
exclusive `RuntimeAdmission`. With the dashboard stopped, `npm run cli -- storage recover-chatgpt-lock`
clears a lock whose recorded owner process is gone and refuses one whose owner still runs. Unconfirmed completion after replacement reports
`CHATGPT_CREDENTIAL_UNCERTAIN`. The account service in `accounts/` imports this credential-store API. Dashboard composition creates it with the admitted state root and clock, closes it before releasing admission, and exposes only the token-free account and sign-in lifecycle schemas from `models/dashboard/chatgpt-account.ts`. The HTTP account boundary retains the latest independent attempt ID and reads its original completion once; the OAuth loopback callback remains inside the service.
Storage relocation carries all three files under `credentials/`, and `paths.duoCredential`
follows the admitted state root.

### Environment and private test inputs

The secure bootstrap does not load `.env` or `.env.providers`. Provider families and their file
writer are absent. `assertNoMigratedEnvironmentKeys` checks parent key membership and refuses
migrated names without reading their values. It reports retired canary names with the remedy
`config/test-data.local.json`. Other migrated names receive the Settings remedy.

`workerBootstrapEnvironment` copies only `HRAUTO_HOST_PRIMARY_DISPLAY` and
`WORKER_PROCESS_MECHANIC_KEYS`: `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `WINDIR`,
`COMSPEC`, `PATHEXT`, `LANG`, `LC_ALL`, and `TZ`. `NODE_OPTIONS` and arbitrary parent bindings are
excluded. Workers read operational credentials from the store themselves.
The `secrets-single-source` architecture guard owns registered credential and environment access.

`config/test-data.json` owns public subject declarations and safe fixtures.
Ignored `config/test-data.local.json` owns private canary values and private document paths.
`src/models/config/test-data.ts`, `src/backend/app/registries/test-data.ts`, and
`src/backend/storage/configuration/test-data-local.ts` own those schemas and readers.
Unknown, unavailable, or pending subjects block before private input reads or browser composition.
Application settings, credentials, and environment files are not test-input fallbacks.
[Guards and tests](guards-and-tests.md) owns test command and fixture details.

## Installation roots, boot, and maintenance

`config/runtime-isolation.json` and `rebuildRuntimeIsolation` pin the default state root
`.tracker/data`, artifact root `.tracker/data/artifacts`, backend port `3938`, frontend port `5174`,
process-lock root `.tracker/data/locks`, browser root `.tracker/data/browsers`, and browser session
namespace `hrauto-rebuild`. The default paths are checkout-relative.
The installation locator becomes the active authority for the state and artifact pair;
process locks remain at the fixed checkout location. A root pair must be canonical and absolute,
and the artifact root cannot contain the state root.

`installation.ts` stores checkout control under `.tracker/control` with `installation.json`,
`locator.json`, lifetime leases, journals, and relocation receipts. Root ownership uses
`.runtime-owner.json`; `.runtime-source-fence.json` is a negative witness. An established missing or
malformed locator refuses. Source markers and retained data never select a fallback installation.
`RuntimeAdmission` rechecks held custody and exact permitted storage paths throughout use.
Shared admission supports runtime openers; exclusive admission excludes them for offline operations.

`acquireEntrypointAdmission` adopts or initializes the genuinely empty default installation before
serving it. It verifies an existing native database read-only; initial authority creation uses a
path-bound initialization capability while adoption remains pending. An established installation
with a missing database does not become fresh merely because owner markers survive.

The admission mutex publishes a complete `owner.json` in a private temporary directory and renames
the directory to `admission-mutex`. Release renames it away before deletion. It waits at most five
monotonic seconds for occupied complete custody. An empty mutex raises `AdmissionMutexEmptyError`,
a subtype of `AdmissionMutexBusyError`, with the explicit `storage recover-admission --empty` remedy.
Startup may recover and retry once only when exact process birth identity proves the owner gone or
reused. Recovery rechecks a settled locator, ownership witnesses, leases, process locks, and absent
pending journal under fixed restore admission. Live, unknown, unsafe, or divergent custody refuses.
Recovery writes a durable receipt under `.tracker/control/admission-mutex-recovery/`.

`secure-env-bootstrap.ts` accepts only `cli` and `test-target-document-number` runners and awaits
the selected runner. Production dashboard bundle validation precedes installation admission.
Dry-run scenario manifest availability is checked before runtime admission. Normal runtime commands
check migrated environment names after admission; storage and test-data commands bypass that check.
The bootstrap retains admission through runner shutdown and releases it in `finally`.

### Current authority schema and boot states

`src/backend/storage/sqlite/migrations.ts` defines `CURRENT_AUTHORITY_SCHEMA_VERSION = 6` and
`AUTHORITY_APPLICATION_ID = 1217249861`. `AuthorityDatabase` accepts only that current native layout.
An existing database must match its application ID, `user_version`, metadata, and registered shape.
`AuthoritySchemaVersionError` reports unsupported versions. Existing databases do not migrate during
ordinary startup; only an absent database receives the current baseline in an exclusive transaction.
Schemas 1–5 are inspected only by the stopped upgrade path; ordinary readers use the current layout.

`AuthorityBootStore` reports `healthy` with mutations `available`, or `degraded-read-only` with
mutations `blocked`. Empty, corrupt, unavailable, or incompatible existing authority does not become a
replacement database. `requireWritable` throws `AuthorityMutationUnavailableError` with code
`AUTHORITY_MUTATION_UNAVAILABLE` for `enqueue`, `claim`, `commit`, or `control` in degraded mode.
Storage causes use the closed codes in `recovery-contracts.ts`, including `authority-empty`,
`authority-not-sqlite`, `authority-schema-newer`, `authority-record-invalid`,
`authority-schema-mismatch`, `authority-migration-locked`, `authority-foreign-key`,
`authority-invariant`, `authority-locked`, `authority-corrupt`, and `authority-unavailable`.

`storage upgrade --plan` requires exclusive installation admission and stopped runtime locks. For an
existing schema 1, 2, 3, 4 or 5 database, the plan validates its native form without changing the
source or creating a backup.
`upgradeStorage` reports `planned`, `initialized`, `upgraded`, or `already-upgraded`, with
`credentials: "unchanged"`. It initializes absent current authority, verifies existing current authority,
or upgrades schema 1, 2, 3, 4 or 5 under stopped exclusive custody. The schema 1 path first adds the
stream-head index. Schemas 1 and 2 then rebuild `worker_pools` with `desired_workers >= 0`.
Migration 4 adds the workbook library and immutable version history, and protects imported artifacts’ workbook provenance.
Migration 6 removes `workers` from retained start plans. Current readers reject that field; stopped
upgrade validates the schema 5 choice before removing it.
Under restore admission, the service rechecks the source fingerprint, creates a stopped-authority
backup, and verifies its manifest. The migration rechecks the source and backup inside one exclusive
SQLite transaction, then applies the required migrations. The settled record carries the verified backup
and canonical plan digest.
The record's `backup_digest` matches the backup SHA-256. A failed migration rolls back its database
changes. For pending diagnostic stages it reclaims through `diagnostic-maintenance` and verifies
unchanged authority generation and content fingerprint. Only the explicit stopped upgrade converts a
prior schema.
A changed source fails with `source-changed: re-plan upgrade`. Recovery, backups, and restores remain
explicit operations in their storage owners; ordinary shutdown does not create a backup.

### Storage relocation

`storage-relocation/plan-storage-relocation` and `storage-relocation/cancel-storage-relocation`
record immutable desired intent in `commands` and `command_audits`.
`storage-relocation-plans.ts` authenticates revisions, write IDs, request and destination digests,
installation UUID, complete source pair, and locator generation. A plan does not switch roots.
Missing query composition reports `STORAGE_RELOCATION_UNAVAILABLE`.

`storage relocate --plan <command-id>`, `storage relocate --resume <operation-id>`, and
`storage relocate --status [--json]` are the offline engine's closed command forms.
`src/backend/app/composition/storage/relocate.ts` and `installation.ts` implement preparation,
staging, source fences, retained source entries, locator switch, activation, settlement, and recovery.
Incomplete work reports `StorageRelocationIncompleteError` and the exact resume command.
A pending journal blocks normal installation admission.

The engine binds one plan, operation, exact verified backup, authority identity, generation, and
inventory. Its activation checkpoint captures the intended native snapshots, ordinary settings
revision and fingerprint, and exact destination configuration snapshot. Recovery reuses that intent
and its captured instant; it does not select a newer backup or probe a new host config.
Credential bytes compare privately without secret-derived journal fingerprints.
The durable completion receipt precedes clearing the transient journal.

Managed source data remains in operation-bound retained locations. Directory-path tombstones or a
`state.db` tombstone prevent reuse. A fixed process-lock subtree can require a witness shell at the
former root; that shell is not an active state root. Exact prior witnesses and receipts remain
bound across later relocations. Unknown entries, unsafe links, unsupported nested witness layouts,
and divergent evidence refuse. Restore candidate validation in `relocation-restore-candidate.ts`
checks current receipt-compatible relocation history and destination snapshot identities before
replacement. Copied older-location backup evidence is not a current recovery candidate.

The explicit commands `storage recover-admission --pid <owner-pid>` and
`storage recover-admission --empty` hold fixed restore admission and preserve installation identity.
They quarantine proven abandoned mutex custody rather than repairing a relocation journal.
`storage recover-restore` owns interrupted restore settlement.

## Settings and readiness readback

`GET /api/v1/settings/facts` serves compatibility facts and workflow capabilities.
`GET /api/v1/settings/editable` serves catalog rows, saved, effective, active, and default ordinary
values, provenance, host facts, deployment paths, and independent protected-store readback.
`GET /api/v1/settings/storage-relocation` serves authenticated relocation intent.
The browser consumes these projections and does not read SQLite or reconstruct settings authority.
The current-year annual date editor serves only `annualDates.FY<year>.jobEndDate`, selected through
the injected clock, without an invented default or clear action.

`createPreflightAuthority` in `src/models/preflight/preflight.ts` selects registry checks and requires
exact runner membership. It enforces deadlines through the injected monotonic scheduler, aborts
expired detectors, and awaits actual settlement. Non-cooperative work stays owned until it settles;
late results do not become passes. Reports bind config and descriptor fingerprints.
`dashboard-runners.ts`, `runtime-runners.ts`, `workflow-runners.ts`, and `worker-admission.ts` compose
the registered dashboard, workflow, and worker checks. Missing operational credentials and stale
fiscal values are evaluated for the selected capability rather than fabricated as healthy.

`GET /api/v1/preflight` reads current readiness. `POST /api/v1/preflight/rerun` applies loopback
request admission, a 4096-byte JSON bound, one active request until settlement, and six starts per
monotonic minute. `report-service.ts` binds selections and expected fingerprints, keeps exact
command replay, refuses divergent replay, and caps the command namespace at 256 identities without
eviction. Its last-completed report cache separately retains at most 256 selections with oldest
entry eviction. Dashboard report evidence expires after 60 seconds or a config change.
`storage doctor` is a read-only storage inspection; it does not repair authority or substitute an
empty inventory. [Execution and sessions](execution-and-sessions.md) owns workflow admission and
worker readiness details.
`backup-service.ts` removes only its owned read-only inspection companions and refuses nonempty WAL; live database companions are never cleanup targets.
`storage-doctor.ts` reconciles exact run/root, attempt, path, and terminal identities in one inspection; malformed authority withholds absence classifications and never selects a substitute database or row.

## Fiscal dates

`AnnualDateEntrySchema` requires `jobEndDate`; `kronosDefaultEndDate` and
`kronosDefaultStartDate` are optional. `UsDateSchema` checks `M/D/YYYY` or `MM/DD/YYYY` text shape.
`requireAnnualDates(config, clock)` selects the current `FY<year>` and throws
`FiscalDateNotConfiguredError` if absent. `assertNotPast` also validates real calendar days and leap
years and refuses `jobEndDate` before `clock.todayLocal()`. Today is valid. Kronos reporting dates
may be in the past and receive no staleness comparison.

The map defaults to `{}`, so a consumer requiring a date refuses until the current year is configured.
A schema-shaped date is not proof of a real calendar date; fiscal consumers use `requireAnnualDates`
instead of reading the map directly.

## Not built yet

- The Settings dashboard connection to these saved settings, credentials, relocation, and readiness authorities is pending in the wiring base.
- ChatGPT OAuth, account, and Responses OCR services exist; their runtime and dashboard wiring is pending. Provider keys and an executable OCR connection are not current support.
- The packaged desktop application's OS credential backend is pending; the current credential backend is the independent private local file.
