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

`<stateRoot>/credentials/` is the home for protected settings, the ChatGPT account, and the retained
active-engine Duo key (`duo-webauthn.json`, read through `paths.duoCredential`).
`src/backend/storage/configuration/` owns those private records.
`credential-store.ts` exposes the protected-settings store and the ChatGPT account repository.
Both use `credential-safe-file.ts` for ancestry and identity checks, owned 0700 directories,
0600 files, no-follow reads, fsync, atomic replacement, and lock-file safety.
Each record retains its own transaction and recovery contract.

The new-purpose Duo document is separate. `duo-credential-store.ts` stores one encrypted document per
profile at `<machineRoot>/machine/duo-credentials/<profileId>.json`. Installation control owns its
continuity row, physical witness, and publication. The profile credential key seals it. A count is
reserved in that document before any later signature use; failed, crashed, and UNKNOWN attempts stay
burned. Ordinary registry reads fail closed on a pending publication and do not finish it. The same
process can resume only the claim that started the publication. After that process exits,
`storage recover-duo-publication` acquires stopped maintenance admission and finishes that one
durable publication: it checks the pending intent, continuity, binding, purpose, revision, physical
file, and source, then settles the existing publication. It does not reserve another count, sign, or
retry UNKNOWN. Erase walks the machine and profile roots, including credentials, backups, artifacts,
and `machine/duo-purpose-backups`. It refuses a symlink, hard link, same-digest copy, or another
authenticated envelope for that profile and purpose. Explicit purpose backups live only under
`machine/duo-purpose-backups/<profileId>/<revision>.json`. The purpose decrypt owner freshly binds the
actual runtime profile, current continuity and canonical document's physical witness before returning
credential material. The current authenticated retired identities keep erased credentials revoked even
after a different valid enrollment; fresh and earlier genuine purposes cannot decrypt those managed
backups. A missing or corrupt current witness refuses instead of supplying an empty retired set.
Same-enrollment backups remain readable, and restore still refuses a backup that would lower a burned
counter. Decrypt refuses during pending publication; that check does not change the separate
same-issued or stopped publication settlement. Erase does not delete or import `duo-webauthn.json`.
`storage upgrade --machine-control` acquires the same stopped maintenance admission, which does not
require marker 3, and converts only continuity schema 1 plus registry marker 2 into continuity schema
2 plus marker 3. It backs up those two control files before mutation and reads them back. A failed
snapshot close keeps that restore admission. The control backup is not a profile SQLite backup or a
Duo-key backup. Marker or continuity versions outside that pair fail as an unsupported hold.

The selected ChatGPT account owner fetches its current model catalog in server order and returns only
list-visible slugs and display names. Assistant requests use that catalog, explicit trusted model
policy, and current account/profile authority; catalog presence grants no execution permission. The
requested default is `gpt-6.1-sol` with medium reasoning. Missing availability refuses without a model
fallback. Per-profile choice persistence and served selector wiring are separate; no Settings leaf or
credential field stores that choice here. OCR uses the fixed backend `CHATGPT_OCR_MODEL` (`gpt-6.1-sol`) independently of assistant preference, with no substitute model.

OCR and assistant inference share the existing bounded Responses transport, cancellation and usage
owner. Account closure fences new work, aborts requests and awaits issued inference/page operations and
accesses; sign-out also drains those operations before revocation or credential mutation. Failed native
artifact, PDF or response-reader closure retains explicit resource uncertainty and refuses sign-out
without clearing credentials. Assistant functions are strict and namespaced. One trusted per-request server binding captures
request-specific private state before catalog or inference awaits and returns its closure-bound
validators and handlers; captured state is not automatically sent to the model. The absent binding
returns an empty set without subject reads. Continuation retains every returned item and exact call
identity. A completed model response is required before any local handler; handler completion and citations are validated before return.
Function calls and trusted synthetic fixture bindings grant no production command authority.

`createCredentialStore` stores `<profileRoot>/credentials/protected.json` using the exact issued
profile child and its machine journal owner. The schema-4 envelope authenticates the whole current
record, value-free history and latest exact request with AES-256-GCM. Authentication finishes before
plaintext is parsed or returned. In-memory entries remain `{ valueId, value, updatedAt }`.
The stable random per-profile key lives at `machine/credential-keys/<profileId>.json`; the machine
continuity row binds its exact private file identity and bytes. Ordinary reads cannot create or
replace an established key, document or anchor.

Fresh setup and explicit forward conversion use the existing sign-up operation and profile-publication
journal. Key bytes first become durable in one private operation-named stage. Its exact inode,
bytes and prior operation enter that journal through the actual factory witness before the same
inode is renamed to the canonical key path. Passive reads validate an interrupted stage publication;
only fresh matching maintenance custody can complete it. A stage left before intent publication is
an unowned orphan and refuses adoption. Proven schema-2 replay may supply current values. Unprovable schema-3 input requires the
verified operator to supply all five set/clear choices before activation; none of its old values are
imported. The validated legacy revision is an opaque concurrency floor, with new history advancing
from that revision. Legacy identities are deny-only, never successful replay authority. Ordinary reads
accept only schema 4. Publication of a migration key anchor revokes the previous login epoch once;
resumption uses the exact pending publication and fresh canonical inventory, rather than a new attempt.

Private history contains no request digests or replaced plaintext. Only the latest exact apply or
erase request is retained inside authenticated ciphertext. The external value-free erasure journal
retains its own request identity. Complete inventory authenticates ciphertext before tombstone repair,
checks decoded JSON and native copies, and refuses incomplete captures or unknown membership.
The key does not provide general rollback resistance or a cryptographic-erasure guarantee.

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
entries. Profile sessions use the separately admitted machine journal outside the profile root, at
`machine/erasures/<profileId>.json`, with its identity anchor. Readback
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
Account authority observation is read-only: concurrent live service instances do not advance the
credential revision. Unexpired access and unchanged usage revalidate the issued authority without a
writer lock; refresh and changed usage retain lock/CAS publication. Closing the issuing service,
actual credential mutation, profile epoch change or lost physical admission revokes its captures.
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
The installation owner retains its executing process's immutable birth identity after one successful
OS observation. Own-PID lease rows still compare their stored birth token against that witness on
every use; peer process observations remain fresh. Unknown initial identity refuses. Lease files,
control witnesses, profile claims and generations continue to be checked throughout use.

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

Healthy profile reads create no mutex. An observed generic mutex may coexist with the read only
when its private directory, sole canonical owner record and freshly observed OS birth identity prove
a live holder. Unknown, dead, malformed or unsafe custody refuses. Registry publication intent retains
its recovery path; locator, registry continuity, operations and erasure evidence must remain exact
across the read. An unrelated lease mutex disappearing does not revoke an otherwise unchanged profile.

`secure-env-bootstrap.ts` accepts only `cli` and `test-target-document-number` runners and awaits
the selected runner. Production dashboard bundle validation precedes installation admission.
Dry-run scenario manifest availability is checked before runtime admission. Normal runtime commands
check migrated environment names after admission; storage and test-data commands bypass that check.
The bootstrap retains admission through runner shutdown and releases it in `finally`.

### Current authority schema and boot states

`src/backend/storage/sqlite/migrations.ts` defines `CURRENT_AUTHORITY_SCHEMA_VERSION = 8` and
`AUTHORITY_APPLICATION_ID = 1217249861`. `AuthorityDatabase` accepts only that current native layout.
An existing database must match its application ID, `user_version`, metadata, and registered shape.
`AuthoritySchemaVersionError` reports unsupported versions. Existing databases do not migrate during
ordinary startup. Ordinary writable opens and stopped upgrades use SQLite existing-only mode,
including when a source disappears during opening. Only `initializeProfile`, after its issued setup
admission check, creates the absent canonical profile database and its current baseline.
Schemas 1–7 are inspected only by the stopped upgrade path; ordinary readers use the current layout.

Assistant grants, chats and once-consumable actions use three profile-owned authority tables.
An explicit operator `apply-settings` command may carry `assistantPermission` with the expected
policy revision and mode, together with an empty ordinary patch. Settings and grant revisions
settle in the same transaction; stale revisions refuse without partial changes. Ordinary Settings
catalogue, persisted schema hash and commands without that field retain their existing grammar.
Neither displayed permission defaults nor assistant-issued commands can mint a grant. The private
profile-token composition issues chat custody and revalidates grants and canonical action bindings
before consumption and at the asynchronous effect boundary. Subject-dependent, protected and
unbound private/freeform actions remain unavailable until their actual owners are connected.

`AuthorityBootStore` reports `healthy` with mutations `available`, or `degraded-read-only` with
mutations `blocked`. Empty, corrupt, unavailable, or incompatible existing authority does not become a
replacement database. `requireWritable` throws `AuthorityMutationUnavailableError` with code
`AUTHORITY_MUTATION_UNAVAILABLE` for `enqueue`, `claim`, `commit`, or `control` in degraded mode.
Storage causes use the closed codes in `recovery-contracts.ts`, including `authority-empty`,
`authority-not-sqlite`, `authority-schema-newer`, `authority-record-invalid`,
`authority-schema-mismatch`, `authority-migration-locked`, `authority-foreign-key`,
`authority-invariant`, `authority-locked`, `authority-corrupt`, and `authority-unavailable`.

`storage upgrade --plan` requires exclusive installation admission and stopped runtime locks. For an
existing schema 1, 2, 3, 4, 5 or 6 database, the plan validates its native form without changing the
source or creating a backup.
`upgradeStorage` reports `planned`, `initialized`, `upgraded`, or `already-upgraded`, with
`credentials: "unchanged"`. It initializes absent current authority, verifies existing current authority,
or upgrades schema 1, 2, 3, 4, 5 or 6 under stopped exclusive custody. The schema 1 path first adds the
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
`upgradeReadyProfileStorage` separately handles an already READY, saved, bound schema7 profile.
It acquires the actual machine workspace's restore admission before privately issuing a stopped
purpose from that same exclusive machine and registered runtime claim. Issuance verifies native
source binding, anchored key/erasure-head evidence, fixed control and physical ancestry, and the
shared all-stopped process/resource/copy inventory. The READY-only issuer defers its two exact
storage readers and revalidates custody after each await; the setup issuer remains synchronous.
This purpose admits original-source inspection, its own verified authority backups, and the finite
7→8 migration only. It cannot initialize a profile, read credentials, open ordinary runtime storage,
grant generic writes/exclusive authority, delegate nested copies, or admit an in-memory database.
Its source fingerprint is privately bound before issuance and checked again inside the migration
transaction with the actual verified backup. Readback preserves prior business rows, Settings and
their digests; only schema metadata and the appended upgrade record change. Already-current READY
inspection never reclaims diagnostics. Unproved source closure or rollback retains restore custody
and the original failures. This service adds no public login, CLI, or automatic startup upgrade path.
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
empty inventory. Protected presence comes from the exact constructor-owned profile store through a passive fixed-name/boolean observer. It authenticates the complete current envelope, key and external erasure head across both observations and refuses missing, pending or repair-needed authority without rewriting bytes. It never creates a credential store or an empty baseline for inspection. [Execution and sessions](execution-and-sessions.md) owns workflow admission and
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
- ChatGPT OAuth and Responses OCR are wired to the selected dashboard diagnostic and worker provider registry. Actual subscription/model support and workflow cutover still require their live checks and operator sign-off; provider keys are not supported.
- The packaged desktop application's OS credential backend is pending; the current credential backend is the independent private local file.

### Profile storage admission

A READY, saved native7 profile can request its backed-up upgrade only through genuine password-verified sign-in. Verification, normal lockout and selection/logout checks precede a private, once-consumed maintenance authorization; no applying operation, ordinary child admission, credential read or session token is issued for it. Current8 sign-in remains ordinary. Pending setup operations remain intact and cannot become READY-upgrade authority.

The authorization retains only identity evidence: exact installation/workspace/locator, registry/control/verifier/operation observation, anchored key and erasure head, canonical source and sidecar identities/digests, and strict encrypted v4 envelope metadata. It contains no password, decrypted value or ordinary authority. Its identity evidence survives intentional old shared-admission release only for comparison against a fresh genuine exclusive installation; any other drift or reuse refuses. The existing stopped service still owns actual restore, all-stopped resources, verified backup, migration and readback.


Fresh machine bootstrap owns the registry, verifier and installation-control evidence without a root database or selected profile. Established version-one or unbound flat state is quarantined for explicit stopped conversion; normal boot never assigns a default profile. Canonical schema7 database metadata binds immutable installation and profile UUIDs before writable configuration or repository construction. A control-authenticated pending sign-up issues exact database-only setup; ready storage claims require canonical binding. Normal registry publication cannot add profiles: the credential owner captures exact canonical committed replay in an opaque value-free witness, and installation control revalidates its bounded document/journal/anchor evidence when publishing the ready row.

Admission identity has one owner in `storage/admission/admission-identity.ts`; only the token-protected `RuntimeAdmission` constructor registers identities. Profile children remain dependent on the current installation lease and authenticated durable intent or membership. New runtime opens and writes recheck readiness. Cancelling profiles retain only settlement custody; restart can reissue it from the exact pending logout and cancelling row. The settlement entry accepts the original authenticated erase command and cannot open ordinary databases or apply credentials. Generic credential reads refuse; the actual credential owner exposes an exact pending-operation observation for erasure revision and inventory without tombstone repair or writes. Replayed erasure strips restored plaintext before a repaired read. Flat runtime callers remain held with `profile-bound-authority-required`. The dashboard composition requires an existing server-owned active profile token and the exact parent-owned profile runtime; ready/saved registry state alone cannot resume login. The CLI currently supplies no such token and refuses dashboard startup until the approved onboarding/login surfaces receive their profile HTTP wiring.

An already-open authority database retains storage custody for accepted drain and UNKNOWN settlement. Its physical binding and parent liveness still revalidate. Current runtime issue authority gates fresh opens; selected-session producers must separately reject new ordinary work after revocation through retained handles. Production composition must bind that distinction before profiles are mounted; a global readiness check on all database reads and transactions would also prevent accepted terminal observations.

The selected storage composition captures the authenticated profile and session generation from machine control, opens that child's exact canonical database, and uses its actual protected store for command identity ownership. An inspection open without that store refuses command ownership checks with `CREDENTIAL_CONTEXT_REQUIRED`; it never creates a local-journal substitute. Lazy Settings reads preserve existing active identity and report saved-only changes as restart-required. Only an absent first-boot active record is initialized.

Worker bootstrap acquires machine admission, captures durable selection, and takes exact profile-database process custody before issuing a child or opening SQLite. Ordinary worker admission, claims, protected reads and browser acquisition revalidate that selection. Failed admission closes SQLite and releases child custody before its process record. Unproved closure propagates `RUNTIME_CUSTODY_UNCERTAIN`, retaining parent admission and remaining process custody. Profile runtime composition retains one ordinary/settlement resource entry, schedules actual account and canonical resource closure through session activity, and closes SQLite before child release after erasure inventory. Closing synchronously refuses new ordinary work. Dashboard shutdown and startup unwind drain their transport, timers and notification observer before account closure and strict credential inventory. Failed producer closure prevents source closure and retains custody. Dashboard startup binds its actual supervisor once at the construction boundary. With a configured supervisor, a stopped historical worker can close without in-memory child evidence only when exact lifetime authentication proves its original process is gone and its process claim is released, and native release checks pass. A released claim on a live process still refuses closure. Public profile mounting, complete supported inventory coverage and actual process/browser closure acceptance remain required.

A stopped cancelling profile uses a privately issued pending-logout inventory child, bound to its exact current operation, registry generation, parent lease and physical source. Its canonical database binding is parsed once from a descriptor-isolated snapshot retained only for that child. Every liveness check revalidates the exact unchanged main, WAL, SHM and journal identities and absences, plus current parent and operation custody; any change permanently revokes that child. Native resource inventories still take fresh strict snapshots. Disposal precedes child and parent release, and a failed snapshot cleanup retains custody. It admits descriptor-isolated inspection of canonical copies before an erasure CAS exists; it cannot grant ordinary credential reads, database writes, artifacts, workers or selection. The constructor-owned credential inventory authenticates key, external head and all recognized ciphertext copies before assessment, with complete profile and process-root membership revalidation. Cold closure requires terminal runs and closed leases, browsers, controls and write custody. A matching late erasure observes only its original request and pending publication head; incomplete capture remains a refusal when surviving copies cannot be certified.

Logout inventory certifies independent backup and credential-stage copies only when both canonical UCPath identity and password were available for capture before that erase. When a prior erase leaves capture incomplete, even a clean-shaped existing copy remains uncertain; repeated resumes and restart cannot publish wiped until those copies are absent. No captured plaintext is persisted. Credential copy scans use the exact authenticated source-schema table registry for verified stopped backups, including supported pre-assistant copies. Their native schema, metadata, digest and physical custody must validate before scanning; ordinary runtime admission remains current-schema-only. Ordinary logout may retain a bound schema7 backup only when its authenticated profile/installation binding and exact source bytes match one immutable settled 7→current upgrade receipt, including canonical plan digest, under current stopped-resource and copy custody. Unbound schema1–6 backups retain a named binding refusal; path identity alone does not assign them to a profile.

Settled worker reservation IDs retain allocation provenance. Closure authenticates the exact origin,
revision and canonical retirement command. Remove-worker retirement requires
`retiredAt == auditedAt == completedAt` and `admittedAt <= proof.checkedAt <= completedAt`;
plan-excess retirement requires `retiredAt == proof.checkedAt`. Pending or UNKNOWN commands and
verification or recovery holds continue to block closure.

Profile erasure publishes its canonical journal transition through the existing installation control publication intent. Control retains a typed head and verified registration origin for every registered profile; missing, substituted or rolled-back journal/anchor evidence blocks protected availability. Only the actual credential owner can issue the value-free capture and exact erase-intent witness. Interrupted erasure retains its original command/write/receipt and permits only authenticated settlement; ordinary reads and writes cannot treat the pending transition as available.

Offline profile restore delegates to the same exclusive parent installation lease, stopped proof and process restore admission. It binds canonical profile SQLite, verified backup physical origin, current control and external erasure head. Replacement invalidates selected sessions idempotently through the existing restore journal; recovery acknowledges the exact observed outcome without repeating replacement. Current credentials and machine evidence are outside the SQLite payload. Whole-machine rollback without an independent retained witness and profile restore after unsupported whole-machine relocation refuse before staging.

Source snapshot removal, isolated binding/login-copy database close, authenticated source/control descriptors, stopped backup descriptors and actual restore/process-custody close paths are owned closure boundaries. Failed closure raises `AuthoritySourceClosureUnprovedError` from the pure `storage/source-closure.ts` and retains the exact failed resource privately for the failure lifetime. Validation failures remain ordinary when actual database and snapshot cleanup succeeds; an uncertain close never authorizes exclusive-admission release or automatic retry.
