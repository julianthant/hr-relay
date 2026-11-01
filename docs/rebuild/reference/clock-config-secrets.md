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
The strict `native-profile-probe` entry dispatches to the credential-free browser leaf before ordinary
bootstrap import. It accepts only bounded stdin profile/deadline data and performs no credential
GET/SET/DELETE, controller admission, provider initialization or authentication.
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

### Assistant choice and private verification

The `assistant_model_preference` singleton is separate from Settings, grants and account
credentials. Its repository authenticates the current row against command/audit history. Only a
history-free absence resolves the canonical default model and effort at revision zero. Missing,
corrupt, substituted or rolled-back authority refuses; it never resets to a default.

The operator-only preference command uses request-local preparation by the selected profile and
account owners, then exact revision CAS and authenticated command/audit settlement. Selection may
read the public catalog through the real consented/scoped account before verification; this proves
availability only and issues no inference proof. Same-command replay returns its historical result
without reapplying or rewinding a newer choice. A committed result followed by lost currentness stays
unknown; it is not rolled back or reported as a zero-effect refusal.

`chatgpt-account-service.ts` owns the private verification witness. Only an explicit composer
`/verify-assistant` request performs the fixed public two-turn probe and fresh catalog read. The witness
is issued after response/resource settlement, lasts at most 15 minutes and rechecks the actual account,
selected context/profile/epoch and complete saved preference identity. A changed choice, foreign
credential revision, an aborted verification binding, revocation, expiry or uncertain resource closure
cannot preserve inference authority. Settings, grants, sign-in, OCR and catalog availability do not substitute for it.
The production composition captures this account witness; it accepts no constructor policy override.

Before an effect, an actual account/source closure failure keeps its named failure rather than being
masked by cancellation. An already-entered canonical action retains UNKNOWN priority. Account closure
uncertainty stays private and retained: later policy capture is absent/unverified, while another
verification or selection refuses the named sticky uncertainty before more I/O. No private resource
owner or credential enters the dashboard response.

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
| `paths.duoExtensionDir` | Absolute `fast-duo` source folder with `workflow-manifest.json` |

The first four paths, browser root and extension path are ordinary settings. State and artifact roots use relocation authority. `paths.duoCredential` is not a configuration field. A journal patch that still names it parses and is refused. Duo credential material stays in the credential store.

`ordinary-path-validator.ts` validates changed effective paths. Browser targets require a canonical absolute path, safe ancestry and ownership, no protected-root overlap, and an absent or empty target. The canonical default may reuse its existing safe directory. The extension requires an owned unpacked MV3 directory and manifest. `OrdinaryPathValidationError` becomes `invalid-value` before snapshot activation.

`POST /api/v1/settings/path-picker` accepts `NativePathPickerRequestSchema` and returns a selected
absolute path, cancellation, or explicit unavailable result. The native picker owns dialog bounds
and field typing. A selection does not save settings or relocate data. The route returns
`NATIVE_PATH_HINT_INVALID` for an invalid hint. Missing picker composition reports `dialog-failed`;
an occupied picker reports `busy`.

## 6. Credential access and storage

`SECRET_SPECS` has four protected-store entries: `ucpathUserId`, `ucpathPassword`, `timekeeperName`, and `sharepointOnboardingRosterUrl`. The protected store retains `activityPersonPseudonym` for historical records; its Activity consumers are absent. There is no plaintext Duo credential-file capability.

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

### Independent private credential authority

`canonical-credential-store.ts` owns three authenticated encrypted records: profile `credentials/protected.json`, profile `credentials/chatgpt-account.json`, and `machine/duo-credentials/<profileId>.json`. Thin protected, Duo and ChatGPT views validate their domain payloads and require domain revision to equal the authenticated frame revision. An absent established frame, head or native key refuses; only an authenticated initialized null frame denotes an uninitialized record.

`machine/credential-keys/<profileId>.json` is the sole external head: immutable installation/person binding, native key metadata, lifecycle and erasure generation, durable Duo counter floors, consumed request IDs and retired identities. Nested key binding must match the actual outer/path binding before native key access. The random 32-byte person key lives in the OS credential store through `credential-key-custody.ts`: service `Relay`, account `<installationId>:<profileId>`, macOS Keychain or Windows Credential Manager. Public catalog errors retain original private source causes and owners.

One `machine/credential-operations/<profileId>.json` owns active creation or erasure. Creation records planned native metadata/digest before native set, authenticates exact encrypted stages and source prefixes, and publishes the head last. Missing or mismatched prepared key custody never regenerates or adopts an unknown key. Abort can settle only its exact authenticated create prefix to finish deletion; the erased head binds the erase source plan digest before native key deletion. Counter floors and retired identities remain external to SQLite.

The common writer uses a short cross-process nonce mutex, authenticates the current head and namespace, checks exact expected revision, stages/fsyncs/replaces, and verifies readback. Same-operation stages retain exact inode/bytes custody. Unknown descendants, unsafe ancestry/permissions/links or unexplained stages refuse. An attempted native replacement with uncertain outcome reports uncertainty and never claims rollback. Actual descriptor/database closure failures are remembered by profile admission, installation parent and native lifetime; successful rereads or safe HTTP/account projections cannot clear that custody or release the listener.

ChatGPT `withLock()` uses one durable cross-process asynchronous operation lease spanning remote awaits, separate from the short writer mutex. Its transaction is revoked on settle and exact callback errors survive successful cleanup. Read-only account observation does not mutate credentials. Refresh, usage changes and sign-out retain CAS; close/sign-out abort and await owned inference/page/access operations. Actual response, artifact or PDF closure failures refuse sign-out and retain resources. Startup may clear only an exact prior nonce lock under genuine one-shot native workspace initialization, never ordinary PID-as-death cleanup. Unknown old lock/stage bytes remain held. The schema-1 ChatGPT payload is bounded to 64,000 bytes and contains registration plus current session, with no token history; tokens are encrypted inside the canonical frame.

Duo records hold pending/ready enrolled P256 material and exact browser scope. Backend validation requires canonical Base64, EC prime256v1 and matching public/private material. Same credential identity cannot change its key. Both onboarding and workflow use the single backend FastDuo signer and public request/reply broker; no private key is installed into browsers. Every signature durably reserves a strictly advancing external counter first. Failed, crashed, cancelled and UNKNOWN attempts burn it; duplicate request IDs refuse rather than replay an allocation. The browser document token remains an exact 32-character hexadecimal `sender.documentId`, while account/operation/arm identities are UUIDs. Scope, account, origin, allowCredentials and current owner are checked before signing and after relevant awaits.

Protected payload schema-4 authenticates current record, value-free history, retired identities and the latest exact request. Entries remain `{valueId,value,updatedAt}`. Only the latest apply/erase request retains plaintext inside ciphertext; history contains marked operations and receipts. Current reads never run old-format migration. Apply checks expectedRevision, schema hash and command/write identity; latest exact replay succeeds, divergent/reused identities refuse, and clear removes the entry while advancing revision. Retired history remains deny-only and cannot revive a value. Documents are bounded to 16 MiB and private requests to 64,000 bytes. Settings apply commits independently before the value-free SQLite audit; failed audit cannot roll back the private commit. Protected values never enter configuration fingerprints or snapshots. The local Settings editor deliberately serves authenticated protected values; unavailable authority is unknown, never an empty default.

Registry document 3 binds immutable installation ID and safe revision. Control 5 binds logical registry digest/revision/epoch, operation membership and completed-restore custody; marker 6 selects the current tuple. General persisted inode/device continuity and recertification are absent. Byte-identical closed replacement keeps logical ownership; a fresh open validates the current file. Exact operation sources, stages and open descriptors retain physical checks.

`storage upgrade --machine-control` uses the existing stopped three-file forward protocol. Supported settled prior tuples and bound SQL schemas 8–11 require genuine source inspection and durable verified credential-free SQL backup before canonical key/frame/control publication. One receipt records exact tuple backups, encrypted credential plans, source fingerprints and the verified SQL archive. Publication resumes only exact recorded source-or-published prefixes. Old credentials/key plaintext are not copied into the new archive. Old runtime readers are deleted. Unknown software Duo counter history or unsupported pending journals produce a named HOLD before mutation; no clock seed, inferred absence, key adoption or silent retirement is allowed. Completed historical artifacts remain exact preserved inventory.

Offline restore replaces SQLite only. It preserves current canonical head/key/generation/floors and credentials, and retains existing source/stage/suspect/completed-restore, settings and UNKNOWN-write proofs. Same-machine native key absence refuses. Profile relocation without a genuine supported binding refuses before maintenance effects; status and historical inspection remain read-only.

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
`.tracker/data`, artifact root `.tracker/data/artifacts`, backend port `3938`, lifetime lock port `3939`, frontend port `5174`,
process-lock root `.tracker/data/locks`, browser root `.tracker/data/browsers`, and browser session
namespace `hrauto-rebuild`. The default paths are checkout-relative.
The installation locator becomes the active authority for the state and artifact pair;
process locks remain at the fixed checkout location. A root pair must be canonical and absolute,
and the artifact root cannot contain the state root.

`installation.ts` stores checkout control under `.tracker/control` with `installation.json`,
`locator.json`, journals, and relocation receipts. Root ownership uses
`.runtime-owner.json`; `.runtime-source-fence.json` is a negative witness. An established missing or
malformed locator refuses. Source markers and retained data never select a fallback installation.
`RuntimeAdmission` is the single storage-capability facade. Its private profile access capture binds a
registered profile's setup or ready state and current session generation. `admitProfile(profileId)`
issues setup or runtime access, `admitProfileSettlement(operationId)` binds the matching durable logout
operation, and `admitStoppedProfile(profileId, operation)` requires the current ready profile and binds
it to the exact live native maintenance operation. Each validates its registration before opening
profile paths or a database. `assertLive()` proves held custody; it does not authorize ordinary data access. SQLite
repository reads and writes, credential metadata reads, and artifact callbacks check current readable,
writable, or credential access. Root ordinary runtime access refuses while stopped maintenance is
active or shutdown is closing. Worker ordinary access also requires connected IPC. Explicit close,
drain, and restore paths retain their held custody after ordinary access is revoked.

The kernel-held lifetime listener owns process exclusion. Bootstrap binds the dedicated configured
loopback `lockPort` before installation admission and holds it through shutdown. A busy port refuses
with `RUNTIME_ALREADY_RUNNING`. Workers receive the listening handle over IPC before storage
admission. Each worker retains its copy through parent disconnect and its write-safe drain. Controller
close waits for each owned child process's actual `close` event before closing the listener. Standalone
and offline commands acquire the same port. Existing source-byte, closure, credential, profile-creation,
erasure, and restore witness checks remain in force.

`acquireEntrypointAdmission` adopts or initializes the genuinely empty default installation before
serving it. It verifies an existing native database read-only; initial authority creation uses a
path-bound initialization capability while adoption remains pending. An established installation
with a missing database does not become fresh merely because owner markers survive.

The controller publishes machine registry and profile-operation changes synchronously through their
atomic files and journals. Worker machine-control admission is read-only: it checks current locator,
registry continuity, operations and erasure evidence, and refuses pending publication that needs
controller repair. Browser factory, login, and driver operations recheck their required `assertCurrent`
callback around actions, awaits, and results. Session close and capture restoration can still use their
owned resources after revocation. Releasing a parent admission revokes its derived profile children.

`secure-env-bootstrap.ts` accepts only `cli` and `test-target-document-number` runners and awaits
the selected runner. Production dashboard bundle validation precedes installation admission.
Dry-run scenario manifest availability is checked before runtime admission. Normal runtime commands
check migrated environment names after admission; storage and test-data commands bypass that check.
The bootstrap retains admission through runner shutdown and releases it in `finally`.

### Current authority schema and boot states

The current schema is 11. The `assistant_model_preference` table stores one authenticated per-profile model and effort record, independently of Settings, permissions, account eligibility and capability evidence. A genuine never-written preference has no row; successful preference history with a missing or rolled-back row refuses.

The supported READY bound-profile upgrade sources are schemas 8, 9 and 10. The existing stopped READY issuer, exact source/credential binding, backup and source-closure checks govern that upgrade. Preference writes require the operator-only command, request-local trusted profile/epoch/account/catalog preparation, exact expected revision and command/audit authentication. Same-command replay returns its authenticated historical result and never rewinds a newer preference. With the trusted producer absent the command is unavailable.


`src/backend/storage/sqlite/migrations.ts` defines `CURRENT_AUTHORITY_SCHEMA_VERSION = 11` and
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
`upgradeReadyProfileStorage` separately handles an already READY, saved profile bound to supported schema 8, 9 or 10.
It acquires the actual machine workspace's restore admission before privately issuing a stopped
purpose from that same exclusive machine and registered runtime claim. Issuance verifies native
source binding, anchored key/erasure-head evidence, fixed control and physical ancestry, and the
shared all-stopped process/resource/copy inventory. The READY-only issuer defers its two exact
storage readers and revalidates custody after each await; the setup issuer remains synchronous.
This purpose admits original-source inspection, its own verified authority backups, and the finite
upgrade from that exact source to the current schema only. It cannot initialize a profile, read credentials, open ordinary runtime storage,
grant generic writes/exclusive authority, delegate nested copies, or admit an in-memory database.
Its source fingerprint is privately bound before issuance and checked again inside the migration
transaction with the actual verified backup. Readback binds the exact source version and current destination. Unrelated business rows, Settings, terminal assistant records and audits remain unchanged; only the declared editor records, retired automatic grants and pending automatic proposals are retired, alongside schema metadata and the appended upgrade record. Already-current READY
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

`storage recover-restore` owns interrupted restore settlement under the lifetime listener.

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
- Profile encryption keys use the OS credential store; encrypted credential records remain independent private local files.

### Profile storage admission

A READY, saved profile with supported SQLite schema 8–10 can request its backed-up upgrade only through genuine password-verified sign-in. Verification, normal lockout and selection/logout checks precede a private, once-consumed maintenance authorization; no applying operation, ordinary child admission, credential read or session token is issued for it. Current schema 11 sign-in remains ordinary. Pending setup operations remain intact and cannot become READY-upgrade authority.

The authorization retains only identity evidence: exact installation/workspace/locator, registry/control/verifier/operation observation, anchored key and erasure head, canonical source and sidecar identities/digests, and strict encrypted v4 envelope metadata. It contains no password, decrypted value or ordinary authority. Its identity evidence survives intentional old shared-admission release only for comparison against a fresh genuine exclusive installation; any other drift or reuse refuses. The existing stopped service still owns actual restore, all-stopped resources, verified backup, migration and readback.


Fresh machine bootstrap owns the registry, verifier and installation-control evidence without a root database or selected profile. A supported pre-profile flat store starts clean through the verified startup migration below; unsupported unbound state remains refused. Normal boot never assigns a default profile. Canonical bound database metadata binds immutable installation and profile UUIDs before writable configuration or repository construction. A control-authenticated pending sign-up issues exact database-only setup; ready storage claims require canonical binding. Normal registry publication cannot add profiles: the credential owner captures exact canonical committed replay in an opaque value-free witness, and installation control revalidates its bounded document/journal/anchor evidence when publishing the ready row.

Admission identity has one owner in `storage/admission/admission-identity.ts`; only the token-protected `RuntimeAdmission` constructor registers identities. Profile children depend on genuine installation custody and actual captured person/session epoch. Ordinary mutation transactions admit current selection and session epoch before BEGIN and revalidate that same owner before COMMIT. Open-database liveness checks retain cleanup and inspection custody after revocation; they do not refresh stale effect authority. Setup remains bound to its exact current Signup2 operation. Publishing Finish permits only its existing exact publication-read callback, not ordinary setup credential access. Flat runtime callers remain refused.

Fresh machine initialization creates the fixed private process-lock directory before publishing its installation locator. The dashboard validates that directory before profile composition. An existing installation with a missing, symlinked, wrongly owned or non-private directory refuses without recreation or permission changes.

Worker bootstrap acquires genuine machine admission, captures selection and takes exact profile-database process custody before issuing a child or opening SQLite. Protected access, worker effects and browser actions repeat current-owner checks. Unproved closure propagates retained `RUNTIME_CUSTODY_UNCERTAIN`; actual child CLOSE, not only exit or a closed browser context, controls native release.

Logout retains all three canonical records and native key. Its current operation records original session epoch and source identity captured by the already-opened native database owner before cancellation or selection revocation. Actual durable cancellation requests precede logout intent. The exact metadata prefixes normalize selection clear and cancelling state; stale epochs, another person or substituted source refuse. After child/account/native-database closure, the controller owns one stopped settlement operation. Its prepared→commit-intent→done evidence captures requests/time/IDs once and brackets one native SQL transaction with exact before/after images. Recovery reuses existing canonical receipts and preserves UNKNOWN fences; any third image holds. Native writer close precedes ready-row publication and operation removal. Stopped inspection copies come only from the fixed-source snapshot factory; generic copy delegation is refused. No credentials are erased or restored by logout.

Cold continuation requires an immutable pending-operation/source observation captured during genuine one-shot native startup. A second composition on the same live controller cannot manufacture that fact. After new-controller closure proofs, readonly source snapshots and the same stopped settlement protocol handle exact metadata/SQL prefixes. Old ordinary handles remain revoked; stopped access grants no general epoch bypass or credential effects.

Settled worker reservation IDs retain allocation provenance. Closure authenticates the exact origin,
revision and canonical retirement command. Remove-worker retirement requires
`retiredAt == auditedAt == completedAt` and `admittedAt <= proof.checkedAt <= completedAt`;
plan-excess retirement requires `retiredAt == proof.checkedAt`. Pending or UNKNOWN commands and
verification or recovery holds continue to block closure.

Offline profile restore requires the exact workspace-bound `OfflineMaintenanceOperation` issued by the genuine root lifetime. Recovery can issue that operation before admission and passes the same object into the exclusive installation lease. Each explicit command consumes it once and retains it through validation, source IO, and owned closure. Copies, foreign roots, expired operations, and replay refuse before effects. Runtime lock artifacts from an older build produce `RUNTIME_OLD_BUILD_ARTIFACTS` without interpretation or deletion. Restore binds canonical profile SQLite, verified backup physical origin, current control, and the authenticated canonical credential head. Replacement invalidates selected sessions idempotently through the existing restore journal. Its saved prior registry document must match captured logical control, and its saved successor must be exactly one revision and session epoch forward with selection cleared before any replay writes. Recovery acknowledges the exact observed outcome without repeating replacement. Current credentials and machine evidence remain outside the SQLite payload. Whole-machine rollback without an independent retained witness and profile restore after unsupported whole-machine relocation refuse before staging.

Source snapshot removal, isolated binding/login-copy database close, authenticated source/control descriptors, stopped backup descriptors and actual restore/process-custody close paths are owned closure boundaries. Failed closure raises `AuthoritySourceClosureUnprovedError` from the pure `storage/source-closure.ts` and retains the exact failed resource privately for the failure lifetime. Validation failures remain ordinary when actual database and snapshot cleanup succeeds; an uncertain close never authorizes exclusive-admission release or automatic retry.

### Private onboarding custody

Show setup browser opens one draft-owned full Chromium window on the Relay FastDuo extension's
existing setup page. Open duo.ucsd.edu opens a separate tab in that same context, acquires the
original protected Details only after verifying the exact UCSD SSO document and form controls,
then submits that pinned POST form once. Reopening focuses the owned tab; failed initialization
remains refused and never resubmits. Login does not prove either enrollment method or MFA completion.
An active attempt's lost stop acknowledgement retains uncertain custody until that exact attempt's
startup, reporting, UNKNOWN retention and callbacks settle within its closure deadline. Only the
same owned browser's complete context, page, process and callback closure plus profile deletion
can then supersede that stop failure. Other failures refuse replacement; reopening never retries
or confirms an enrollment.
The extension UI receives public draft status and exact attempt commands, never login credentials.
Before enrollment capture is armed, verified native Duo documents may query capability support or
pass a sign-in request to the captured browser implementation. This path exposes no software key,
enrollment, persisted credential, counter reservation or readiness proof.

`profile-onboarding.ts` issues exact operation/generation/method attempts. Software FastDuo readiness
requires native pending-key acknowledgement and ceremony plus either exact scoped operator CONFIRM
or an observed exact-credential request; an unobserved portal acceptance remains false. Native Mac
Touch ID separately requires a platform ceremony with software interception disabled, actual Duo
portal acceptance and operator confirmation. Public method states display these receipts; they do not
authorize publication. Each SIGN uses a distinct durable reservation nonce.

Draft Duo publication resumes only its authenticated prior/next intent, including stopped recovery.
The native onboarding Finish intent owns verifier and registry publication together; verifier preparation does not publish an account. Fresh database, key, protected credential, verifier-pepper file identity/digest and method witnesses precede that intent. Exact prior/next prefixes recover together, while a changed source remains HOLD.
Finish recovery retains the exact Finish identity and immutable method receipts; it does not repeat
enrollment or create a replacement generation. Whole-draft cancellation drains provider custody,
retains its authenticated original encrypted apply as an explicitly owned transaction source, and
uses canonical credential erasure. An exact draft-erasure intent retains journal/anchor custody until the final abort intent takes over; first-anchor recovery requires the authenticated absent prior anchor and exact expected next journal. The durable abort intent owns full membership proof before source,
key and operation removal, in that order, then deletes the remaining profile directory and erased local Duo document. Dead-writer recovery authenticates the exact retained abort source before separating it from a writer's staged document; the source is never discarded as a stale temporary file. Unknown copies, effects or closure retain HOLD.

Stopped incomplete-profile reclassification requires the exact original apply, key and never-Duo
witnesses plus fresh canonical SQLite counts including deleted runs, write attempts, receipts and
artifacts. It withdraws registry/verifier publication into a private draft while preserving the same
database and key during withdrawal. The resulting unfinished draft is removed by startup recovery. Eligibility requires genuinely empty storage or
exact authenticated unsaved revision-one initialization, with every snapshot bound to the initial
or current-active endpoint. Unbound or intermediate snapshots, saved or advanced settings, business,
deleted, UNKNOWN, write, control, diagnostic or artifact history refuses, as does missing, corrupt or
unsupported authority. This is not a generic legacy owner claim or an automatic startup conversion.

A pre-profile native6 flat store at the pinned installation root is migrated at dashboard startup,
before profile runtime composition. It does not become a profile and none of its runs or credentials
are carried into sign-up. Runtime admission retains flat detection only for this migration and the
stopped backup command.

Startup first erases the flat `credentials/` directory, including protected, ChatGPT and Duo files,
so the new backup contains none of those credentials. It then uses the existing stopped SQLite
backup and coupled private-copy writer. The verified backup, source record and copies live outside
the removed state under `.tracker/control/storage-backups/<installationId>/`. Backup or verification
failure stops startup with `PROFILE_FLAT_STORE_MIGRATION_FAILED`; all non-credential source data
remains in place. Unsupported paths, active or UNKNOWN resource custody, corrupt or changed data
remain refusals. An existing backup containing credentials cannot authorize the migration.

Only after verification does a durable `flat-start-clean.json` intent authorize removal. Every
remaining source file must match the backup or source record's captured identity and digest.
Restart verifies the same backup and resumes that deletion prefix, then initializes an empty
profile registry. Installation markers, artifact-root identity and fixed process locks stay in
place. The backup remains verified and retained after removal; sign-up creates a fresh private
profile using the ordinary onboarding path.

`npm run cli -- storage backup [--json]` still backs up a selected READY profile through its
registered child, or a stopped native6 flat source through its finite backup admission. The command
neither signs in nor creates a profile. Its owner holds the same root-issued offline operation through
an explicit native browser closure step, then captures source bytes and runs the backup. The real
probe can update browser state; the backup copies that post-probe state and never launches a browser.
A private in-memory closure observation binds the exact operation, admitted source, browser census
and directory identities. Backup revalidates that observation and read-only OS closure at its IO
boundaries; copied, foreign, expired or changed observations refuse. Unproved closure retains owners.
Coupled copies complement the verified SQLite backup. Every existing source file keeps its bytes,
inode and mode throughout backup IO, including browser Preferences; the probe finishes before that
interval. The flat backup is a one-time pre-migration source snapshot. A fresh command probes again;
changed post-probe source refuses with STORAGE_BACKUP_SOURCE_CHANGED and preserves the first
verified backup and source.json. It never overwrites that receipt or creates a versioned substitute.
An exact interrupted copy prefix may resume; missing, extra or corrupt completed copies refuse.
A genuinely abandoned admission mutex requires current closed process custody and exact backup,
source-record, allocation and recovery-history evidence. Unproved source closure retains custody.
