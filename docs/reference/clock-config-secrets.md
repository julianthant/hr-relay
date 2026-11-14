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
| Installation identity, current locator, ownership witnesses, and forward layout journal | `src/backend/storage/admission/installation.ts` |
| Lifetime and path-specific storage capability | `src/backend/storage/admission/admission.ts` |
| Entrypoint admission and secure bootstrap | `src/backend/storage/admission/bootstrap-admission.ts`, `src/backend/app/bootstrap/secure-env-bootstrap.ts` |

[Execution and sessions](execution-and-sessions.md) owns browser leases, Duo ceremonies, and shutdown.
Browser probes run through `runtime/browser/native-browser.ts` under the registry authority in
`storage/browser-roots.ts` and the existing admission and native root lifetime. The stopped control converter records its browser plan before native probing and performs
credential assessment after actual browser closure. Ordinary bootstrap has no probe child selector.
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
The fixed-layout activation transaction uses its recorded instant when completing or replaying publication.

`manualClock(at, initialMonotonicMs = 0)` returns a `TestClock` with independent `advanceWall`,
`advanceMonotonic`, and `setWall` controls. The `clock-single-source` architecture guard confines
host-clock reads to `src/rules/time/clock.ts`; `manual-clock-test-only` prevents production use of
`manualClock`. Parsing an existing instant with `Date.parse` or constructing a `Date` from an
existing value does not read the host clock.

## Configuration resolution

`resolveConfigWithProvenance(settingsInput, hostFacts, clock = systemClock, runtimeStoragePair?)`
returns `{ config, provenance, fingerprint, preferences, preferencesFingerprint }`. It has no environment override parameter.
`SettingsOverrideInputSchema` parses a sparse ordinary settings object, defaulting an omitted input
to `{}`. `HostConfigFactsSchema` accepts only `{ primaryDisplay: { screenWidth, screenHeight } | null }`.
The resolver supplies runtime paths and host display defaults, merges ordinary settings, then parses
the complete result through `ConfigSchema`.

Ordinary settings take precedence over defaults. `ConfigProvenanceSchema` contains only `settings`
and `default`; provenance describes values and does not control runtime decisions. The resolver
compares the populated config leaf paths with provenance keys and throws
`config provenance is not bidirectionally complete` if they differ.
`fingerprint` is SHA-256 over `canonicalJsonStringify(config)`. Person appearance and shell settings live in the
strict `preferences` sibling of each canonical snapshot, authenticated by `preferencesFingerprint`.
Execution configuration, accepted snapshot IDs and run fingerprints do not change when preferences
change. `person-preferences.ts` owns theme, animations, workflow panel mode/selection and keyboard
bindings. Sparse `preferences.*` overrides are ordinary person settings with the same command,
revision and backup coupling as other saved values. The stopped schema-16 conversion adds neutral
preferences to accepted snapshots and updates initialization schema identities and their exact
command/audit digests; ordinary snapshot readers require the current fields. No browser preference
is imported.

`ConfigSchema` has fourteen groups: `actor`, `urls`, `timeouts`, `paths`, `annualDates`, `display`,
`performance`, `ocr`, `browserHealth`, `browser`, `concurrency`, `daemon`, `features`, and `providers`.
Every group except `paths` has contract defaults. `ConfigPathsSchema` requires nine absolute paths.
The browser-safe schema imports no Node filesystem implementation. Runtime defaults belong to
`runtime-paths.ts`, rather than a browser stub or polyfill.

`SETTINGS_CATALOG` is a parsed, recursively frozen 74-row registry. Each row names its `key`,
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

### Assistant model choice

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

Each assistant turn uses the selected person's saved model and effort as read at its start, rechecks
that saved choice and the account authority before every provider request, and refuses with
`ASSISTANT_MODEL_CHANGED` once either changes. There is no capability probe or verification witness; a
turn that gets no reply is the failure signal.

Before an effect, an actual account/source closure failure keeps its named failure rather than being
masked by cancellation. An already-entered canonical action retains UNKNOWN priority. Account closure
uncertainty stays private and retained: later policy capture is absent/unverified, while another
verification or selection refuses the named sticky uncertainty before more I/O. No private resource
owner or credential enters the dashboard response.

The shared Responses transport records failures through the existing local debug-event writer,
bound by dashboard or worker composition. `chatGptInference` retains only closed operation, failure
path, media-type classification and allowlisted provider-code values; unknown codes become `unknown`.
The HTTP status is retained when received. Headers, prompts, response text, tokens and account
identifiers are excluded. Development stderr mirrors the same metadata. HTTP `error.code` and
`detail.code`, and streamed error codes, distinguish usage limits, unavailable models and rejected
Relay requests. A diagnostic write failure is visible and never clears resource-closure uncertainty.
The transport observation captures status, media-type classification and body presence before
response wrapping, plus native/injected source, redirect state and expected/other/missing target
classification. The delivered response separately retains body presence and media type. No URL is retained.
Stream diagnostics retain the first 256 allowlisted event names in order and mark truncation.
Completed-event shape records at most 128 paths and value types, to depth eight; array indices become
`[]` and unknown keys become `*`. Up to 16 validation issue paths and closed issue codes identify
terminal-schema failures. Shape fields never retain values or string lengths, and unknown event names
become `unknown`. The existing writer persists and mirrors this metadata.
Authentication failures before inference record closed refresh, discovery, key, signature and claim
stages. Assistant model discovery records its own request/body/schema stage and a closed JSON failure
reason (missing body, read, size, UTF-8 or JSON). Catalog failures use `CHATGPT_MODELS_UNAVAILABLE`;
they do not claim that sign-in verification failed. Model catalogs include provider instruction
metadata and have a separate 2 MiB decoded-body budget. The reader counts actual streamed bytes,
independent of Content-Length; the 256-model schema, field limits, visibility and order remain
validated. Auth, token, discovery and JWKS JSON retain their 64,000-byte budget.
Successful inference accepts `text/event-stream` or an absent Content-Type only after bounded SSE
decoding, a valid `response.completed`, and operation-specific output validation. Explicit other
media types, malformed bytes, incomplete streams and inconsistent output remain refused.
The completed event supplies terminal success when its optional response status is absent; an explicit
status must be `completed`. IDs, model, output and error/incomplete consistency remain validated.
Output comes from finalized `response.output_item.done` events, ordered by their declared indices.
Each item must match its added identity and kind, and all added items and content parts must finish.
Text and function-argument done events must agree with their finalized items and streamed deltas.
Collection remains within 32 output items, eight content parts per message and the operation's byte
limit. `response.completed` supplies the terminal marker and status; its output may be empty, but
nonempty output must agree with the finalized items. Missing done items, duplicates, orphan indices,
identity changes and inconsistent content remain refused before output acceptance or usage settlement.

### Paths and validation

`runtime-paths.ts` resolves defaults against the process working directory and memoizes the default
browser profile root. Entrypoint installation admission derives its workspace from the module path.
The admitted storage pair supplies `paths.stateRoot` and `paths.artifactRoot` to the resolver; it also
supplies the default browser root `<stateRoot>/browsers`. A saved browser root can override that value.

| Path | Default |
| --- | --- |
| `paths.reportsDir` | `<stateRoot>/files/reports` |
| `paths.downloadsDir` | `<stateRoot>/files/downloads` |
| `paths.onboardingDocsDir` | `<stateRoot>/files/onboarding` |
| `paths.i9CheckTrackerPath` | `<stateRoot>/files/reports/i9-check-tracker.xlsx` |
| `paths.stateRoot` | Admitted installation root, initially `.tracker/data` |
| `paths.artifactRoot` | Admitted installation root, initially `.tracker/data/artifacts` |
| `paths.browserProfileRoot` | Admitted `<stateRoot>/browsers`, or the isolation default `.tracker/data/browsers` without an admitted pair |
| `paths.duoCredential` | Retained deployment fact in accepted configuration snapshots; no credential reader or picker |
| `paths.duoExtensionDir` | Absolute `fast-duo` source folder with `workflow-manifest.json` |

The first four paths and extension path are ordinary settings. State, evidence, and browser roots are fixed. `paths.browserProfileRoot` remains in serialized settings and accepted command history; new edits refuse, and the resolver requires the admitted person root. `paths.duoCredential` remains in the strict serialized configuration and catalog because accepted snapshots and their fingerprints retain that deployment fact. New edits refuse as a retired input; it grants no file access, picker or authentication authority. Removing the persisted field requires the complete snapshot forward conversion.

`ordinary-path-validator.ts` validates the owned unpacked MV3 extension directory and manifest. The native picker accepts ordinary folders, tracker files, and the extension directory; state, evidence, and browser roots are absent from its request schema. `OrdinaryPathValidationError` becomes `invalid-value` before snapshot activation.

`POST /api/v1/settings/path-picker` accepts `NativePathPickerRequestSchema` and returns a selected
absolute path, cancellation, or explicit unavailable result. The native picker owns dialog bounds
and field typing. A selection does not save settings or move app data. The route returns
`NATIVE_PATH_HINT_INVALID` for an invalid hint. Missing picker composition reports `dialog-failed`;
an occupied picker reports `busy`. macOS uses `/usr/bin/osascript`; Windows uses the absolute
`SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe` with one STA WinForms dialog.
Windows dialog kind and canonical initial directory travel as UTF-8 JSON on stdin to fixed
script code. Both helpers have bounded output and a 120-second limit; abort and timeout close
the helper before releasing the dialog gate. Other platforms report `unsupported-platform`.

## 6. Credential access and storage

`SECRET_SPECS` has three protected-store entries: `ucpathUserId`, `ucpathPassword`, and
`sharepointOnboardingRosterUrl`. Their shared schemas admit an ID of 1–256 characters, a password
of 1–4096 characters, and a roster URL up to 8192 characters, without trimming or coercion.
There is no stored timekeeper setting, Activity pseudonym secret or plaintext Duo credential-file capability.

The runtime input source adds the admitted profile identity to its private snapshot. Its full name
comes from the registered first and last name; initials use the first letter of every word.
Enqueue and Rerun capture the profile ID and session epoch with that name, reject caller overrides,
and keep the private name out of public input and fingerprint projections. Kuali receives the full
name and derives comment initials from it. The bootstrap actor label serves the same full name to Settings.

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

Canonical head and record reads check current profile access at entry and before returning authenticated values. Read-only namespace traversal retains liveness and private-path checks inside that synchronous operation; it does not repeat the profile registry and pending-operation census for each file. Publication and external-effect boundaries retain fresh current-profile checks.

The common writer uses a short cross-process nonce mutex, authenticates the current head and namespace, checks exact expected revision, stages/fsyncs/replaces, and verifies readback. Same-operation stages retain exact inode/bytes custody. Unknown descendants, unsafe ancestry/permissions/links or unexplained stages refuse. An attempted native replacement with uncertain outcome reports uncertainty and never claims rollback. Actual descriptor/database closure failures are remembered by profile admission, installation parent and native lifetime; successful rereads or safe HTTP/account projections cannot clear that custody or release the listener.

ChatGPT `withLock()` uses one durable cross-process asynchronous operation lease spanning remote awaits, separate from the short writer mutex. Its transaction is revoked on settle and exact callback errors survive successful cleanup. Raw `readAccount()` observation does not mutate credentials. Successful sign-in completion reads call `refreshAccount()`, which coalesces concurrent reads and renews eligible access tokens within 60 seconds of expiry through that same lease and rotation validation. Served account GET reads call `readStatus()`: an on-demand bounded models-catalog check shares concurrent readers and retains explicit results for five minutes under exact revision, attempt generation and availability. Each reader cancels independently; the final departing reader aborts the shared check. Renewal keeps its existing lease and rotation validation. Profile closure and sign-out still cancel and drain owned operations. Renewal preserves quota state until completed inference proves availability. Temporary renewal failure is unavailable; a terminal refresh denial requires reconnection. Refresh, usage changes and sign-out retain CAS; close/sign-out abort and await owned inference/page/access operations. Actual response, artifact or PDF closure failures refuse sign-out and retain resources. Startup may clear only an exact prior nonce lock under genuine one-shot native workspace initialization, never ordinary PID-as-death cleanup. Unknown old lock/stage bytes remain held. The schema-1 ChatGPT payload is bounded to 64,000 bytes and contains registration plus current session, with no token history; tokens are encrypted inside the canonical frame.

Duo records hold pending/ready enrolled P256 material and exact browser scope. Backend validation requires canonical Base64, EC prime256v1 and matching public/private material. Same credential identity cannot change its key. Both onboarding and workflow use the single backend Fast Duo signer and public request/reply broker. Ready internal keys and their proved counter floors enter only the owned private CDP authenticator; they never enter the extension, HTTP or public state. Native replica signatures remain disabled, so the canonical signer retains assertion authority. Fresh platform enrollment initializes its pending key's canonical counter from the observed CDP count; an existing internal key without proved history refuses instead of adopting a floor. Every signature durably reserves a strictly advancing external counter first. Failed, crashed, cancelled and UNKNOWN attempts burn it; duplicate request IDs refuse rather than replay an allocation. The browser document token remains an exact 32-character hexadecimal `sender.documentId`, while account/operation/arm identities are UUIDs. Scope, account, origin, allowCredentials and current owner are checked before signing and after relevant awaits.

Protected payload schema-5 authenticates the schema-2 current record, value-free history, retired identities and the latest exact request. Entries remain `{valueId,value,updatedAt}`. Only the latest apply/erase request retains plaintext inside ciphertext; history contains marked operations and receipts. Current reads never run old-format migration. Apply checks expectedRevision, schema hash and command/write identity; latest exact replay succeeds, divergent/reused identities refuse, and clear removes the entry while advancing revision. Retired history remains deny-only and cannot revive a value. Documents are bounded to 16 MiB and private requests to 64,000 bytes. Settings apply commits independently before the value-free SQLite audit; failed audit cannot roll back the private commit. Protected values never enter configuration fingerprints or snapshots. The local Settings editor deliberately serves authenticated protected values; unavailable authority is unknown, never an empty default.

`storage/maintenance/protected-settings-upgrade.ts` converts schema-4 protected payloads under
stopped exclusive profile custody after a verified authority backup and browser/process closure.
The conversion removes timekeeper and pseudonym plaintext, preserves marked receipt history and
retired command/write/value identities, retires every removed value ID, and appends one migration
receipt. The scoped writer computes the authenticated conversion before publishing it. Its canonical
replacement uses the existing authenticated revision CAS, exact stage custody
and readback. Current schema-5 records are authenticated without another backup or mutation.
Startup settles pending onboarding before converting ready profiles. A stopped exclusive capture
binds an explicit Finish to its exact operation, authenticated credential files, native identities and
runtime lifetime. Finish publication rechecks that opaque proof, its original registration receipt,
Duo evidence and verifier custody; it consumes the operation before conversion adds a receipt.
Early storage initialization settles only explicit Finish operations. Other pending drafts and their
owned browser roots remain for ordinary onboarding recovery, which retains its missing-root and
owned-cleanup refusals. Stopped repair of a READY peer may coexist with another profile's pending
sign-up; it retains registration, session-generation and maintenance-operation checks, and grants
no ordinary runtime access. Startup defers profile activation until conversion completes. Ordinary
publication and credential reads remain current-format only.

Pending logout retains its captured credential source through crash reconciliation and native
settlement. Its stopped command-identity lookup authenticates document 4 or 5 without granting
ordinary reads or conversion authority; marked history and retired command IDs remain collision
owners. Even a ready registry prefix is excluded from startup conversion while its logout operation
is pending. Only after native settlement, ready publication and disposal of the stopped logout owner
does the controller acquire a new backed settings-conversion admission. UNKNOWN writes keep the
operation pending and the original credentials unchanged.
Startup attempts boot-observed logout settlement before that conversion, using the same native
process, browser, source and SQL proofs. Busy settlement remains pending. Live shared dashboard
continuation performs no credential conversion; a current-format profile can sign in immediately
after settlement. A schema-4 credential reader instead requests a restart for stopped conversion.
An ordinary conversion failure refuses only its profile for the current runtime lifetime and retains
its cause for local diagnostics. Successful stopped conversion clears that refusal; uncertain source
closure still stops startup and retains its owners.
Ordinary readers accept only the current schema. Stopped conversion and flat-source inspection own
the previous grammar; retained value-free receipts keep the catalog used by their original write.

Registry document 3 binds immutable installation ID and safe revision. Control 7 binds logical registry digest/revision/epoch and operation membership; marker 8 selects the current tuple and external browser-root registry. General persisted inode/device continuity and recertification are absent. Byte-identical closed replacement keeps logical ownership; a fresh open validates the current file. Exact operation sources, stages and open descriptors retain physical checks.

Browser-root registry schema 2 stores short numeric handles with complete owner bindings. Stopped startup
runs `maintenance/browser-root-upgrade.ts` before ordinary admission. Its schema-1 forward conversion
verifies a private byte-for-byte registry backup and records intent before native browser acquisition.
Verified closure precedes journaled exclusive directory moves and exact source/stage publication.
Recovery accepts only the recorded probe phase or move prefix;
collisions, substitutions and unknown siblings refuse. Ordinary readers accept schema 2 only. The
existing Windows layout-migration custody refusal still applies; fresh installations write schema 2. Captured predecessor account-deletion and machine-control upgrade journals
finish under stopped custody with their original browser documents, paths and file/stage witnesses;
standalone conversion waits for that owner to finish. A captured automatic restore also finishes first:
its exact stopped operation retains the original registry format, paths and browser membership proof
through native closure and authority settlement. Its finite browser port expires with that journal;
conversion follows settlement. New captures and ordinary readers stay current-only.
Unknown registry publication stages hold before conversion effects. Account deletion refuses retained
browser-root archives containing that person, preserving shared verified bytes and other people.

SQLite precommit proofs cover registry/verifier/control evidence, registry operations. Fixed-layout claims separately bind their exact external journal. Independent credential head and record publications retain their own authenticated writer checks and do not invalidate those registry proofs.

`storage upgrade --machine-control` uses the existing stopped three-file forward protocol. Supported settled prior tuples and bound SQL schemas 8 through 18 require genuine source inspection and durable verified credential-free SQL backup before canonical key/frame/control publication. One receipt records exact tuple backups, encrypted credential plans, source fingerprints and the verified SQL archive. Publication resumes only exact recorded source-or-published prefixes. Old credentials/key plaintext are not copied into the new archive. Old runtime readers are deleted. Unknown software Duo counter history or unsupported pending journals produce a named HOLD before mutation; no clock seed, inferred absence, key adoption or silent retirement is allowed. Completed historical artifacts remain exact preserved inventory.

Offline restore replaces SQLite only. It preserves current canonical head/key/generation/floors and credentials, and retains existing source/stage/suspect, settings and UNKNOWN-write proofs. Same-machine native key absence refuses. Same-person restore candidate checks bind immutable IDs, current paths, and verified manifest facts before replacement.

### Private paths on Windows

`storage/private-path.ts` is the shared privacy and flush boundary. POSIX systems use owner IDs
and mode bits. Windows loads pinned Koffi only when a native operation is needed and observes NTFS
owner SIDs, DACLs, file identity and reparse metadata through native handles. Null, malformed or
unsupported ACLs, uncertain identities and all reparse points refuse. Security observations are fresh.

Application paths require the current token's owner SID. Private access is limited to that SID,
SYSTEM and Administrators; private directories also require safe inheritable ACEs. The `group-write`
and `owner-write-only` rules permit other principals to read managed data while refusing mutation.
Ancestors may be
owned by those principals or the exact TrustedInstaller service SID. Other principals may read and
traverse ancestors and create sibling directories, but cannot replace descendants or change security.
Inherit-only ACEs do not grant access to the ancestor itself. Unsupported ACE types refuse rather
than approximating their effective access.

New private directories receive a protected inheritable DACL during native creation. Existing unsafe
directories are refused. Private stages verify safe parent inheritance and the created descriptor
before writing bytes. Windows ancestry and private-file readers, lock publication and exact cleanup
retain actual bigint filesystem identities. Readers return raw `Stats` on POSIX and `BigIntStats`
on Windows; Windows metadata stability compares nanosecond timestamps. Ephemeral canonical
observations encode bigint identities as decimal strings without changing POSIX fingerprints.
Native volume serial and 64-bit
file IDs must agree with exact Node observations; unsafe numeric witnesses and unsupported 128-bit
file-ID mappings refuse. Existing persisted numeric witness formats accept only exact safe-integer
representations; capturing a higher identity refuses with `WINDOWS_PRIVATE_PATH_REFUSED` before
persistence. Credential publication, pepper, control-upgrade and maintenance witnesses retain this
limitation. Mixed numeric/bigint comparisons require exactly equal safe numeric witnesses.

Both isolated SQLite observers import this same policy. Their source descriptors stay in the child;
parent observations do not claim exclusive Windows source custody.

`storage/maintenance/custody-availability.ts` refuses Windows backup/export, restore, backup
retirement, schema/control upgrade, layout migration and ready-account deletion before their
source capture or effects. Private-path admission does not establish custody of streams, namespace
membership or external handles. This is the reason these maintenance boundaries share one refusal.
Current-schema boot, ordinary reads, login/logout and unpublished signup cleanup remain available.
No pending retirement, no upgrade/continuation and genuinely new layout creation are no-work cases.

After the transport, selected runtime, onboarding, profile and machine all close successfully,
automatic shutdown backup reports `STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE` on Windows and the
bootstrap releases its lifetime listener. The command fails explicitly; no backup success is
reported. Any closure failure, mixed aggregate or unproved source custody retains the existing
uncertain-runtime handling and lifetime. Authenticated account deletion refuses before logout,
leaving the current session and credentials intact.

Windows path flushing opens the exact object for writing with reparse-point handling, verifies its
identity, calls `FlushFileBuffers` and checks handle closure. Failed native handles or security
allocations remain retained through the existing source-closure error. A successful native flush
does not establish rename, journal-recovery or power-loss durability for Windows maintenance.

### Environment and private test inputs

The secure bootstrap does not load `.env` or `.env.providers`. Provider families and their file
writer are absent. `assertNoMigratedEnvironmentKeys` checks parent key membership and refuses
migrated names without reading their values. It reports retired canary names with the remedy
`config/test-data.local.json`. `TIMEKEEPER_NAME`, `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY`
and `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION` receive the exact retired protected-setting
refusal with removal as the remedy. Other migrated names receive the Settings remedy.

`workerBootstrapEnvironment` copies only `HRAUTO_HOST_PRIMARY_DISPLAY` and
`WORKER_PROCESS_MECHANIC_KEYS`: `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `WINDIR`,
`COMSPEC`, `PATHEXT`, `LANG`, `LC_ALL`, and `TZ`. `NODE_OPTIONS` and arbitrary parent bindings are
excluded. Development worker launches add `RELAY_DEV_DEBUG_MIRROR=1` explicitly after filtering;
production worker launches omit it even when the parent has it. Workers read operational credentials from the store themselves.
The `secrets-single-source` architecture guard owns registered credential and environment access.
`windowsLocalApplicationData()` in `secrets.ts` alone reads `LOCALAPPDATA`, registered as a
direct-identifier `host-storage` authority. It is read only by Windows host selection and is excluded
from worker bootstrap keys; workers receive the admitted workspace over genuine IPC. Config paths
supplied with an admitted state/artifact pair are derived from that pair without resolving host
workspace authority again; source asset paths remain repository-owned.

`src/models/runtime/runtime-environment.ts` pins the exact `SystemRoot` read to `windowsSystemRoot` in
`src/models/config/secrets.ts` under the non-secret `process-mechanics` channel. That channel accepts
only this key and canonical owner; exact reader ownership names the same path. The native path
picker consumes the accessor and validates the returned root before launching PowerShell. The worker's
closed mechanics pass-through remains separately audited.

`windowsProgramFilesRoots()` alone reads `ProgramFiles` and `ProgramFiles(x86)` for the Windows
launcher. The `host-programs` channel permits only those non-secret keys and their canonical owner
in `secrets.ts`. The launcher validates provided roots before locating Edge; neither key is copied
into worker bootstrap inheritance.

`config/test-data.json` owns public subject declarations and safe fixtures.
Ignored `config/test-data.local.json` owns private canary values and private document paths.
`src/models/config/test-data.ts`, `src/backend/app/registries/test-data.ts`, and
`src/backend/storage/configuration/test-data-local.ts` own those schemas and readers.
Unknown, unavailable, or pending subjects block before private input reads or browser composition.
Application settings, credentials, and environment files are not test-input fallbacks.
[Guards and tests](guards-and-tests.md) owns test command and fixture details.

## Installation roots, boot, and maintenance

`applicationDataWorkspace()` selects `%LOCALAPPDATA%\Relay` on Windows and the OS user's
`~/Library/Application Support/Relay` on macOS and other POSIX hosts, independently of cwd and `HOME`.
Its discriminated host facts admit only the authority for that platform. Windows requires a canonical
drive-letter path: missing values, relative/UNC/device paths and Win32 normalization aliases refuse with
`APPLICATION_DATA_WORKSPACE_REFUSED` before application state I/O. There is no home fallback, old-state
migration, copy or deletion. Native SID/DACL, NTFS identity and reparse checks still govern actual
Windows storage admission. Source and bundled entrypoints
use that workspace; repository paths select code and assets. Explicit private test workspaces remain
separate from operator data. `rebuildRuntimeIsolation` defines the inner `.tracker/data` state root,
its `artifacts`, `browsers`, and `locks` directories, backend port `3938`, lifetime lock port `3939`,
frontend port `5174`, and browser session namespace `hrauto-rebuild`.

`installation.ts` stores control under `.tracker/control`. Current `locator.json` schema 3 contains
installation ID and generation zero; paths are derived from the admitted workspace. Ownership uses
`.runtime-owner.json`, and `.runtime-source-fence.json` prevents reusing a departed source.
Established missing, foreign, or malformed authority refuses without an empty replacement.
`RuntimeAdmission` is the single storage-capability facade. Its private profile access capture binds a
registered profile's setup or ready state and current session generation. `admitProfile(profileId)`
issues setup or runtime access, `admitProfileSettlement(operationId)` binds the matching durable logout
operation, and `admitStoppedProfile(profileId, operation)` requires the current ready profile and binds
it to the exact live native maintenance operation. `admitStoppedProfileBackup(profileId, operation)` binds a READY saved current-format person to that operation independently of the active sign-in; it grants stopped read-only backup custody. Each validates its registration before opening
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

The current schema is 30. Workbook catalogue names and the version in use are separate from immutable workbook snapshots and action receipts. Its forward upgrade refuses an older captured workbook-reference schema rather than rewriting retained input or its proof. Identity-exclusive OnBase sessions retain a durable lease across process loss and uncertain browser closure; only the owning session generation can release it after proven closure. There is no expiry or automatic takeover. The `assistant_model_preference` table stores one authenticated per-profile model and effort record, independently of Settings, permissions, account eligibility and capability evidence. A genuine never-written preference has no row; successful preference history with a missing or rolled-back row refuses.


Fresh workbook storage contains one General type seed. Incomplete-profile inventory reports that row and treats only its exact initial payload as pristine, alongside either bare authority or authenticated Settings initialization. Extra or edited types and workbook masters, creations, operations or named versions remain activity that blocks withdrawal.

The supported READY bound-profile upgrade sources are schemas 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28 and 29. The existing stopped READY issuer, exact source/credential binding, backup and source-closure checks govern that upgrade. Preference writes require the operator-only command, request-local trusted profile/epoch/account/catalog preparation, exact expected revision and command/audit authentication. Same-command replay returns its authenticated historical result and never rewinds a newer preference. With the trusted producer absent the command is unavailable.


`src/backend/storage/sqlite/migrations.ts` defines `CURRENT_AUTHORITY_SCHEMA_VERSION = 30` and
`AUTHORITY_APPLICATION_ID = 1217249861`. `AuthorityDatabase` accepts only that current native layout.
An existing database must match its application ID, `user_version`, metadata, and registered shape.
`AuthoritySchemaVersionError` reports unsupported versions. Existing databases do not migrate during
ordinary startup. Ordinary writable opens and stopped upgrades use SQLite existing-only mode,
including when a source disappears during opening. Only `initializeProfile`, after its issued setup
admission check, creates the absent canonical profile database and its current baseline.
Schemas 1 through 29 are inspected only under stopped upgrade or maintenance authority; ordinary readers
use the current layout. Stopped inspection projects the absent pre-v15 pause column as null only
after validating the predecessor's registered schema, including run/search/timeline/result owners.
The native layout includes the pause scalar and its JSON-equality triggers, plus immutable OCR source uploads, review revisions and approved snapshots. The forward v18 migration adds library catalogue state, immutable named snapshots and action receipts under the same verified-backup upgrade boundary. The v19 guard checks every captured workbook reference in runs and retained start plans, including terminal runs and consumed plans, against the current derived output-schema hash. A mismatch refuses with `workbook_reference_schema_upgrade_unproved` before migration effects and preserves retained references, proofs and the source schema; it never rehashes or rebinds evidence. The v27 migration moves the assistant effort preference to light|medium|high|xhigh|max: a stored `low` becomes `light` in the preference, its commands (request digest recomputed) and their audits, with the audit and preference triggers dropped and recreated around the conversion. The v29 migration drops the empty `assistant_grants` table; a store that still holds a grant, an assistant action, or a command or audit carrying `assistantPermission` refuses the upgrade with `assistant-grant-history-unsupported` and keeps its version. The v30 migration marks every library state and recorded library action result unpinned with no manual tags, with the action-journal update trigger dropped and recreated around the conversion; stopped inspection of an earlier store reads its states as unpinned and untagged.

The v25 migration adds `workflow_workbook_selections`, one ordered last-used source selection per workflow in the owning person database. An absent row means no selection has been recorded; no default or historical run seeds it. Sources retain library and worksheet identities without foreign keys, so removed sources stay stale and history clearing preserves selections. Its repository records the accepted command, used time and revision; confirmed Start integration is separate. Before adding the table, the migration refuses unreceipted operator workbook operations whose identity begins with the exact `library:` prefix, using `workflow_workbook_selection_pending_library_operation`. It preserves pending ordinary run operations, completed library actions, workbook mappings and all write evidence without replaying them. A registered schema 25 marker binds the captured `run-reference` workbook-write source grammar into its plan digest. That source retains immutable version, worksheet, key, required fields and explicit writable fields; only selected-row patches with exact version CAS are admitted. Its storage apply and replay use the captured key and writable fields, while predecessor operations retain historical type semantics. Producing this source from accepted runs is separate work. The existing stopped exclusive transaction, verified pre-upgrade backup and strict current readback own this upgrade.

The v21 migration updates only the completion-immutability trigger: an authenticated aggregate refresh may replace a done or failed current completion while retaining its exact prior result and receipt rows. Failed predecessors require matching retained failure evidence; unrelated completion changes remain refused.

The v22 migration deletes every run approved before envelopes carried a build id, through the native run deletion.

The v23 migration adds `timeline_worker_claim_idx` for indexed worker claim reads.

A store from an unpublished assistant numbering holds `assistant_conversations` at schema 23 to 25, or is at 26 to 29 without `workflow_workbook_selections`. It is refused with `STORAGE_PROFILE_FORMAT_UNSUPPORTED` (`assistant-unpublished-schema-numbering`) before opening, upgrade backup or automatic restore. Their version numbers are never reinterpreted as the published migration sequence, and the source remains unchanged.

The v26 migration adds the assistant history tables `assistant_conversations` and `assistant_messages` (`assistant-history.ts`): at most 20 chats per profile, 200 messages per chat, at most 2,000,000 UTF-16 units of titles, drafts and message display text across a profile's unexpired chats, and a fixed 30-day expiry. An accepted turn keeps one slot for its reply; a write that would exceed a bound is refused and rolled back. Expiry fences an accepted send and its settlement whether or not cleanup has run. Settlement may change only a `sending` turn's delivery, code and update time; every other message field is written once. A stream or transport loss after the Responses POST settles as `delivery-unknown`; provider refusals and complete but invalid responses settle as `refused`. Startup settles every unfinished send as `delivery-unknown` before the history routes serve and reclaims expired chats, then hourly; a failed hourly reclamation emits `ASSISTANT_HISTORY_CLEANUP_FAILED`.

Assistant chats and once-consumable actions use two profile-owned authority tables. The operator's
Confirm on each card is the only assistant authorization; no grant or Settings permission exists.
The private profile-token composition issues chat custody and revalidates the person, session epoch,
manifest and canonical action binding before consumption and at the asynchronous effect boundary.
Subject-dependent, protected and unbound private/freeform actions remain unavailable until their
actual owners are connected.

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
Migration 4 adds the workbook library and immutable version history, and protects imported artifacts’ workbook provenance. Migration 12 preserves existing OCR extraction content and artifact IDs in explicit `unbound-source` envelopes. New source-bound reading versions append under their canonical extraction IDs; ordinary readers accept only the current stored envelope.
Migration 13 keeps one mutable workbook master, preserves immutable creation evidence, and converts retained revisions to explicitly named migration versions. New versions are manual and named; run writes and Sync use durable operation receipts, never automatic versions.
Migration 6 removes `workers` from retained start plans. Current readers reject that field; stopped
upgrade validates the schema 5 choice before removing it.
Under restore admission, the service rechecks the source fingerprint, creates a stopped-authority
backup, and verifies its manifest. The migration rechecks the source and backup inside one exclusive
SQLite transaction, then applies the required migrations. The settled record carries the verified backup
and canonical plan digest.
The record's `backup_digest` matches the backup SHA-256. A failed migration rolls back its database
changes. For pending diagnostic stages it reclaims through `diagnostic-maintenance` and verifies
unchanged authority generation and content fingerprint. Supported registered person schemas also
upgrade automatically before dashboard runtime admission.
`upgradeReadyProfileStorage` separately handles an already READY, saved profile bound to supported schema 8, 9, 10, 11 or 12.
It acquires the actual machine workspace's restore admission before privately issuing a stopped
purpose from that same exclusive machine and registered runtime claim. Issuance verifies native
source binding, anchored key/erasure-head evidence, fixed control and physical ancestry, and the
shared all-stopped process/resource/copy inventory. The READY-only issuer defers its two exact
storage readers and revalidates custody after each await; the setup issuer remains synchronous.
This purpose admits original-source inspection, its own verified authority backups, and the finite
upgrade from that exact source to the current schema only. It cannot initialize a profile, read credentials, open ordinary runtime storage,
grant generic writes/exclusive authority, delegate nested copies, or admit an in-memory database.
Its source fingerprint is privately bound before issuance and checked again inside the migration
transaction with the actual verified backup. Readback binds the exact source version and current destination. Unrelated business rows, Settings, terminal assistant records and audits remain unchanged; the declared editor records, retired automatic grants and pending automatic proposals are retired, existing OCR evidence receives its explicit source-binding envelope, and schema metadata plus the appended upgrade record advance. Already-current READY
inspection never reclaims diagnostics. Unproved source closure or rollback retains restore custody
and the original failures. `upgradeProfileAtStartup` uses this same engine before HTTP, account or
ordinary profile composition. Launch order is self-repair, schema upgrade, then recovery on the current format.
The startup issuer captures registered ready/cancelling people and pending sign-up databases with
exact operation, credential and file evidence; ordinary runtime issuance remains strict. Stored
unfinished worker/browser/control/auth leases, interrupted runs, pending sign-up/logout, queued
runs, unresolved write fences, checkpoints and pending artifacts carry forward unchanged. Actual
native browser closure, exclusive lifetime/process custody, source binding and a verified backup
remain mandatory before mutation. Migration grants no runtime access and never resumes or submits
work; parked UNKNOWN writes stay parked. The stricter manual and credential-copy paths continue
to require retired durable work. Future Pause/Resume behavior must retain the last completed step;
crash recovery fails interrupted work with rerun from that step and preserves mid-submit uncertainty.
A changed source fails with `source-changed: re-plan upgrade`. Startup completes automatic repair and upgrade through their stopped storage owners before ordinary admission.

Startup repair restores a person's database from the newest verified backup only when SQLite itself
reports damage: the file is not a database, `PRAGMA integrity_check` is not `ok`, or reads fail with
`SQLITE_CORRUPT`. An exactly missing `run_search` projection is recreated from the current DDL and
rebuilt in one stopped transaction that must leave every other row and the authority generation
unchanged; a failed rebuild is `STORAGE_PROFILE_PROJECTION_REPAIR_FAILED`. A record that fails its strict
parse, or a layout, invariant or foreign-key mismatch over intact SQLite, is version skew
(`STORAGE_PROFILE_FORMAT_UNSUPPORTED`, or `STORAGE_PROFILE_NEWER_VERSION` for a newer schema) and
never restores. A refused inspection, repair, upgrade or crash recovery holds only that person:
their sign-in is refused with the hold's code and startup continues for everyone else. Unproved
closure and unavailable maintenance or browser custody still stop startup.

### Fixed application-data startup

Bootstrap holds the lifetime listener before the supported forward conversion. The finite source
reader admits only the known default pair at generation zero. Existing stopped machine-control and
flat-store conversion run through their current owners. Supported registered schemas 8–14 then receive
the automatic backed-up W11a upgrade before current-only layout qualification. Registered ready/cancelling people and initialized pending sign-ups need a verified current SQL backup and genuine native closure before paths change.
Current-only layout source admissions preserve unfinished durable work and ordinary output files and
cannot authorize schema migration; manual upgrade and credential-copy admissions retain their strict
retirement and copy refusals. Unsupported source layouts, unknown members, unsafe links, unresolved
atomic publication prefixes and conflicting installations refuse.

`maintenance/fixed-layout.ts` owns strict journal schemas, tree membership, exact binding-prefix
classification, and bounded person activation claims. The external `.tracker/fixed-layout.json`
records source/target/install identities, file and directory identities, four binding rewrites, and
verified per-person backup/configuration plans. Installation atomically moves the data directory,
publishes the permanent source fence, moves control, then replaces only the recorded bindings.
The lifetime owner consumes an issued installation publication proof and transfers the same held
listener after source admissions and operations close. It never releases and reacquires the port.

Configuring startup issues only exact-person layout admissions. One SQLite transaction publishes the
planned active configuration, rewrites retained browser-session paths and binds them to equivalent
new configuration snapshots, and records any saved
browser-root/default-output changes through ordinary command, audit, and settings repositories.
Command identity checks authenticate protected history through the exact stopped layout admission.
Retained run snapshots remain immutable. Named output publication binds their former person root to
the completed same-person layout plan before resolving the moved physical destination; external
output folders retain their recorded locations.
Planning establishes the same published host display used by dashboard composition before capturing configuration.
External output choices stay unchanged, while output paths inside the moved tree rebind to the same relative folders. Effective defaults become explicit settings; other history,
credentials, keys, counters, unresolved writes, and original snapshots remain preserved. A never-initialized
pending sign-up receives only the ordinary empty-overrides settings initialization, with journaled
command/audit identities. Publication is checked
against the verified pre-move backup. A failed or interrupted publication resumes from its exact
recorded state on the next startup; normal admission waits for completion. Completed layout evidence
does not compare later mutable person data with the migration snapshot.

There are no relocation commands, HTTP routes, client methods, assistant actions, or Settings plans.

Stopped machine-control conversion verifies retained backup and receipt bytes on capture, checks their
nanosecond metadata, membership and physical ancestry during the held operation, and fully verifies
the bytes again before publication. Changed content, identity, permissions or ancestry refuses.
`same-person-restore-candidate.ts` retains restore identity and manifest checks.

Startup owns automatic same-person repair before ordinary admission, providers or HTTP. It selects the newest verified supported backup that preserves current write fences, attempts, evidence, deletion tombstones and generated-file publication records. It refuses when current critical evidence or immutable identity cannot be inspected, or when a backup would weaken it; it never unions databases. Current runtime roots must match the admitted person.

The one external control `journal.json` restore record (schema 3) binds source/stage/quarantine/manifest bytes, current canonical credential head, retained files and browser membership. Replacement advances the session epoch once, revokes old runtime authority and preserves the authenticated profile selection. Startup resumes only its exact interrupted prefix, verifies the original manifest and preserved evidence again, and retains an on-disk repair record with the backup time. Unknown prefixes remain held. No restore command or picker exists. Settled schema-6 control converts once under stopped exclusive custody to logical control 7 and marker 8; old physical completed-restore entries are checked during that conversion and removed from current control.

## Settings and readiness readback

`GET /api/v1/settings/facts` serves compatibility facts and workflow capabilities.
`GET /api/v1/settings/editable` serves catalog rows, saved, effective, active, and default ordinary
values, provenance, host facts, deployment paths, and independent protected-store readback.
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
empty inventory. Run from the CLI, it inspects each ready person's store in turn and `--json` prints
`{ profiles: [{ profileId, report }] }`; the Settings storage section reads the selected person's report directly. Protected presence comes from the exact constructor-owned profile store through a passive fixed-name/boolean observer. It authenticates the complete current envelope, key and external erasure head across both observations and refuses missing, pending or repair-needed authority without rewriting bytes. It never creates a credential store or an empty baseline for inspection. [Execution and sessions](execution-and-sessions.md) owns workflow admission and
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

- The Settings dashboard connection to these saved settings, credentials, fixed paths, and readiness authorities is pending in the wiring base.
- ChatGPT OAuth and Responses OCR are wired to the selected dashboard diagnostic and worker provider registry. Actual subscription/model support and workflow cutover still require their live checks and operator sign-off; provider keys are not supported.
- Profile encryption keys use the OS credential store; encrypted credential records remain independent private local files.

### Profile storage admission

Dashboard startup inspects registered ready/cancelling people and initialized pending sign-ups under genuine exclusive installation and
maintenance ownership before ordinary admission, HTTP or credential consumers. Supported SQLite
schemas 8–14 receive a verified same-person backup and the stopped forward migration, followed by
current-schema health readback. Current stores are inspected without another backup. Missing,
corrupt, foreign and future databases refuse with `STORAGE_PROFILE_UPGRADE_REFUSED`; they never
initialize empty storage. Only a genuinely not-yet-created sign-up with its planned credential
operation and no key/database is left for ordinary setup creation. Pending setup and logout remain
owned by their existing continuation protocols after upgrade and layout conversion. A pending logout
settlement is matched to the verified pre-upgrade image, with its continuation recorded atomically
in the upgrade journal. Before-image commit intent becomes prepared on the new image; an already
committed result keeps its result and request identities. Publication resumes from the current
verified image if startup stops between the SQL commit and operation publication. Layout continuation
uses its exact completed activation plan and verified backup in the same way. Sign-in only authenticates a current person and never schedules an app restart or upgrade.

The migration purpose binds immutable person/installation IDs, exact source and sidecar evidence,
canonical credential-head metadata and source fingerprints. It cannot read credentials or grant
ordinary writes. Failed native or descriptor closure retains the actual owners and lifetime listener;
no successor admission or automatic retry is permitted while closure remains uncertain.

Fresh machine bootstrap owns the registry, verifier and installation-control evidence without a root database or selected profile. A supported pre-profile flat store starts clean through the verified startup migration below; unsupported unbound state remains refused. Normal boot never assigns a default profile. Canonical bound database metadata binds immutable installation and profile UUIDs before writable configuration or repository construction. A control-authenticated pending sign-up issues exact database-only setup; ready storage claims require canonical binding. Normal registry publication cannot add profiles: the credential owner captures exact canonical committed replay in an opaque value-free witness, and installation control revalidates its bounded document/journal/anchor evidence when publishing the ready row.

Admission identity has one owner in `storage/admission/admission-identity.ts`; only the token-protected `RuntimeAdmission` constructor registers identities. Profile children depend on genuine installation custody and actual captured person/session epoch. Ordinary mutation transactions admit current selection and session epoch before BEGIN and revalidate that same owner before COMMIT. Open-database liveness checks retain cleanup and inspection custody after revocation; they do not refresh stale effect authority. Setup remains bound to its exact current Signup2 operation. Publishing Finish permits only its existing exact publication-read callback, not ordinary setup credential access. Flat runtime callers remain refused.

Fresh machine initialization creates the fixed private process-lock directory before publishing its installation locator. The dashboard validates that directory before profile composition. An existing installation with a missing, symlinked, wrongly owned or non-private directory refuses without recreation or permission changes.

Worker bootstrap acquires genuine machine admission, captures selection and takes exact profile-database process custody before issuing a child or opening SQLite. Protected access, worker effects and browser actions repeat current-owner checks. Unproved closure propagates retained `RUNTIME_CUSTODY_UNCERTAIN`; actual child CLOSE, not only exit or a closed browser context, controls native release.

Only explicit Log out or Delete account ends a completed profile session, with one boot exception: when startup holds the selected person, boot clears the selection so that person never blocks another person's sign-in, and their next sign-in shows the hold. Failed sign-in or resume preserves the prior selection while refusing access with its failure code. Restart, crash, tab closure and cookie loss retain that selection. A new local browser resumes through the existing loopback, origin and mutation guards; an already mounted runtime is revalidated and reused. Logout revokes access for every browser.

Registry publication spools each selection change through the existing local timeline log with a closed reason code, fixed caller path and old/new generations. It records the attempt before the registry write and settlement after it, without profile IDs or credential values. An unavailable log refuses the transition; a failed publication retains its existing recovery evidence.

Logout retains all three canonical records and native key. The controller first blocks operator access and holds new-run admission for the active runtime generation, then cancels and awaits command and worker drainage, actual owned-child CLOSE and account closure under the current profile capability. UNKNOWN writes remain held and prevent logout. A process-local drain proof binds the original profile epoch and exact native custody snapshot; synchronous logout refuses a missing, pending or changed proof. Only then does the native database owner capture the logout source and the session publish its revoking operation and advance the epoch. A failed drain retains custody and leaves the epoch unchanged. The exact metadata prefixes normalize selection clear and cancelling state; stale epochs, another person or substituted source refuse. The controller then owns one stopped settlement operation. Its prepared→commit-intent→done evidence captures requests/time/IDs once and brackets one native SQL transaction with exact before/after images. Recovery reuses existing canonical receipts and preserves UNKNOWN fences; any third image holds. Native writer close precedes ready-row publication and operation removal. Stopped inspection copies come only from the fixed-source snapshot factory; generic copy delegation is refused. A subsequent dashboard activation issues a new runtime generation, so the previous generation's admission hold does not become an orphaned hold on fresh sign-in. No credentials are erased or restored by logout.

Dashboard HTTP and SSE producers, timers and notification observation drain before logout revokes
the profile epoch. Final subscription diagnostics finish under that original authority. Reconnecting
subscriptions receive `PROFILE_SESSION_STALE` during the transition and after logout.

Cold continuation requires an immutable pending-operation/source observation captured during genuine one-shot native startup. The observation is retained by the root lifetime across maintenance leases and its verified fixed-layout transfer.
A second composition on the same live controller cannot manufacture that fact. After new-controller closure proofs, readonly source snapshots and the same stopped settlement protocol handle exact metadata/SQL prefixes. Old ordinary handles remain revoked; stopped access grants no general epoch bypass or credential effects.

Settled worker reservation IDs retain allocation provenance. Closure authenticates the exact origin,
revision and canonical retirement command. Remove-worker retirement requires
`retiredAt == auditedAt == completedAt` and `admittedAt <= proof.checkedAt <= completedAt`;
plan-excess retirement requires `retiredAt == proof.checkedAt`. Pending or UNKNOWN commands and
verification or recovery holds continue to block closure.
A fresh additive Run allocation may retire without a lease only when its original controller retains
positive proof that the refused Spawn unwound before entering the spawner. The private capability
binds the exact allocation, admission, supervisor and audited refusal; a missing process or record
cannot issue it. Explicit drainage settles only that unchanged final member through an atomic
ordinary Plan retirement, retaining the refused Spawn and audit. Capability consumption follows the
outermost COMMIT. A crash before retirement loses that authority; completed retirement remains
read-only history. Spawn attempts and unknown outcomes retain uncertainty.

Automatic profile restore requires the exact workspace-bound `OfflineMaintenanceOperation` issued by the genuine root lifetime. Startup recovery issues that operation before admission and passes the same object into the exclusive installation lease. The automatic path consumes it once and retains it through validation, source IO and owned closure. Copies, foreign roots and expired operations refuse before effects. Older runtime lock artifacts produce `RUNTIME_OLD_BUILD_ARTIFACTS` without interpretation or deletion. Current credentials, native keys, counter floors and machine evidence stay outside the SQLite payload. Whole-machine rollback without an independent retained witness refuses before staging. Replay accepts only the captured prior or exact one-epoch successor registry/control pair and reuses that successor without advancing twice.

Source snapshot removal, isolated binding/login-copy database close, authenticated source/control descriptors, stopped backup descriptors and actual restore/process-custody close paths are owned closure boundaries. Failed closure raises `AuthoritySourceClosureUnprovedError` from the pure `storage/source-closure.ts` and retains the exact failed resource privately for the failure lifetime. Validation failures remain ordinary when actual database and snapshot cleanup succeeds; an uncertain close never authorizes exclusive-admission release or automatic retry.

### Account deletion

The signed-out profile state reports `signUpRequired` for an empty installation. Sign-up creates a
private draft and publishes the person only after both Duo methods and Finish are proved.
It also reports `logoutIncomplete` while a registered profile is cancelling or a logout operation is
unfinished. Log in continues that logout; sign-up names this next step. An existing installation opens
Log in from a sign-up URL unless the operator chooses Sign up from the login page.

The confirmed `POST /api/v1/profile/delete-account` command requires the confirmation's
`expectedProfileId` and `expectedEpoch`. The server compares both against the cookie-authenticated
selection before acquiring its transition lock, with no intervening await. A mismatch refuses before
logout drainage, detach, backup or erasure. Pending deletion retains the original confirmed epoch for
the same comparison on continuation. The command then uses the normal logout drain and native
settlement. Only the completed exact-person logout can authorize deletion; ordinary logout
continues to retain credentials. `maintenance/account-deletion.ts` owns the installation journal
`account-deletion.json`, with exact file/directory membership, native key metadata, and prior/next
registry, verifier and browser documents. Stopped custody and process closure precede erasure.
Unresolved or parked writes refuse before erasure, preserving their UNKNOWN/no-retry evidence.
The operation deletes the native key, the person's managed tree (including local backups, artifacts
and browser profiles), and canonical machine credential files, then removes only that person's
registry, verifier and browser rows. External exported files and remote Duo registrations are outside
this local account operation. A retained installation-control upgrade backup for the person refuses
deletion before effects; that shared verified archive is never silently edited or partially erased. An interrupted erasure blocks admission and resumes its captured
prefix under the next startup lifetime. Changed or unknown members refuse; no deletion result is
reported until the journal is removed. Settings General consumes the typed client command when its
approved account surface is wired.

### Private onboarding custody

Show setup browser opens one draft-owned full bundled Chromium window on macOS and Windows on the Relay Fast Duo extension's
existing setup page. Open duo.ucsd.edu opens a separate tab in that same context, acquires the
original protected Details only after verifying the exact UCSD SSO document and form controls,
then submits that pinned POST form once. A direct HTTPS `duosecurity.com` landing opens the tab without
acquiring credentials; the starting `duo.ucsd.edu` URL is not landing evidence. Navigation and pinned
submission timeouts have distinct closed diagnostic codes. Successful opening is reused in that context;
a failed portal opening can be retried in the same tab. Login does not prove either enrollment method or MFA completion.
The provider sends a closed recovery hint through the existing extension broker. Manual sign-in
advice requires a known sign-in timeout on a trusted URL. Untrusted pages say not to enter a
password and to close that tab; unknown refusals never suggest signing in there.
An active attempt's lost stop acknowledgement retains uncertain custody until that exact attempt's
startup, reporting, UNKNOWN retention and callbacks settle within its closure deadline. Only the
same owned browser's complete context, page, process and callback closure plus profile deletion
can then supersede that stop failure. Other failures refuse replacement; reopening never retries
or confirms an enrollment.
Failed browser cleanup records its bounded phase in the private Duo diagnostic log. A native probe
that settles after the closure deadline cannot remove the profile or permit replacement.
Only a Playwright target-close poll failure whose worker did not close before its context may
settle with context closing. Other poll failures retain their causes even if closing overtakes their
asynchronous handlers. Closing status alone never proves closure: the context event,
tracked pages, settled callbacks, native exclusion and profile cleanup are still required.
An unproved setup-browser closure holds sign-up with `BROWSER_CLOSURE_UNPROVED`; reads and commands
retain that refusal without reacquiring the held file locks. The dashboard preserves the draft and
asks the operator to close and reopen Relay. Startup removes the unfinished sign-up only after
proving the old process and its exact browser root unused.
The provider carries uncertain browser-close results and their original cause through Cancel and
Finish drains; an absent cause does not turn uncertainty into available authority.
Show and Open focus the selected page and its owned Chromium window, restore a minimized
window and activate its exact process through AppKit or Windows foreground APIs. Return to Relay
uses the original app/window captured before launch; the extension cannot supply a native target.
Close setup tab removes only that extension tab. Focus failures never establish enrollment proof. Failed attempt initialization must settle before closure; it is retained as a failure
without preventing proved worker and browser cleanup. Reopening never rearms the failed attempt.
The first attempt failure retains only its closed `kind` and `causeTag` values. The existing debug
event writer records the same facts as a pinned Duo failure correlated to that attempt in the
draft profile timeline. Raw exception messages, stacks, credentials and account values are excluded. Interception, forwarding, backend receipt, reply, scoped refusal, abort and timeout stages use the same writer. Abort and timeout retain UNKNOWN, including before scope binding, and never permit another capture.
The extension UI receives public draft status and exact attempt commands, never login credentials.
Before enrollment capture is armed, verified native Duo documents may query capability support or
pass a sign-in request to the captured browser implementation. This path exposes no software key,
enrollment, persisted credential, counter reservation or readiness proof.

`profile-onboarding.ts` issues exact operation/generation/method attempts. Software FastDuo readiness
requires native pending-key acknowledgement and ceremony plus either exact scoped operator CONFIRM
or an observed exact-credential request; an unobserved portal acceptance remains false. Touch ID separately requires a platform ceremony with software interception disabled, actual Duo
portal acceptance and operator confirmation. The owned extension prepares platform discovery before answering Duo availability queries. Touch ID uses Chromium's emulated internal authenticator on both macOS and Windows, without a hardware availability probe or installed Chrome dependency. The registration handoff disables native signatures before exporting the observed counter and private key. Login rehydrates ready internal material with native signatures disabled; the current backend ceremony lease remains required for signing. Virtual platform
keys enter the same encrypted Duo custody and must be ready before Finish. The retained receipt and
public method state identify `native-platform` or `chromium-platform`. Public method states display these receipts; they do not
authorize publication. Each SIGN uses a distinct durable reservation nonce.

Platform setup uses the broker-verified top-level Duo page. Same-origin child frames are not
additional enrollment targets; ambiguous top-level pages refuse. Credential IDs remain canonical
base64url in Duo custody and convert to standard base64 only at the Chromium protocol boundary.
A completed Chromium platform receipt with a matching ready encrypted key survives the scoped
retention hook, just like the software key. Actual provider failures still retain their error and
block Finish through the existing custody checks.

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

Startup proves native browser and OS process closure before archiving or erasing anything. The
stopped raw-byte archive excludes recognized credential, browser/auth and runtime containers;
those sources remain intact until the archive and its exact source membership verify. Backup or
verification failure stops startup with `PROFILE_FLAT_STORE_MIGRATION_FAILED` and preserves all
source data, including credentials. The archive lives outside the removed state at
`.tracker/control/storage-backups/<installationId>/`. Its historical rows stay opaque and are never
adopted into a new person.

The finite start-clean reader accepts the known plaintext native6 credential layout. Encrypted,
key-bearing or unknown layouts refuse before browser preparation or erasure; no native key account
is inferred from old HR data. Registered-person credential/key erasure stays with its canonical owner.

After verification, schema2 `flat-start-clean.json` binds the archive operation, source digest and
membership, planned private verifier-pepper digest, recorded probe timing and deletion cursor.
Each unlink or empty-directory removal first records the one pending member. Recovery accepts only
that member's exact present/absent outcomes: prior members must be absent and later members must
remain unchanged. New files, changed evidence or a substituted archive refuse. Fresh native and OS
closure precede recovery, even after the old database is gone; the saved operation supplies timing
and the physical census uses the remaining exact membership. An uncertain resource close retains
its actual admission and lifetime.

Empty registry publication reuses the exact prepared pepper and verifies every existing publication
prefix. The completed registry digest remains in `flat-start-clean-complete.json`; normal bootstrap
then uses current registry readers and sign-up creates a fresh private profile. Installation markers,
artifact-root identity and the empty fixed process-lock directory stay in place. Ordinary document
and report roots outside the erased state are preserved.

Backups are automatic. After clean application resource closure, the held lifetime obtains stopped exclusive custody and verifies a SQLite backup for each READY saved person. Shutdown backups use the `.shutdown.sqlite` filename class. Retention verifies those manifests and copies again, keeps the newest three, and removes only older verified shutdown pairs. Pre-upgrade backups and the pre-erase flat archive stay protected. Retirement first durably renames the obsolete manifest to `.retiring`. Startup and shutdown finish that exact same-person record before full backup inventory: three newer verified shutdown backups must remain, changed bytes refuse, and an already removed copy is an accepted prefix. The record disappears only after copy deletion and directory sync.

Shutdown admits each current profile through the sign-in-independent backup purpose under the held stopped machine owner, verifies worker, browser, Duo and control custody closed before and after backup, and repeats native browser closure against the exact source. Never-initialized settings and retained ordinary files keep their meaning; parked write evidence is copied without resubmission.

The actual native browser closure step precedes source capture. A private in-memory closure observation binds the exact operation, admitted source, browser census and directory identities. Backup revalidates that observation and read-only OS closure at IO boundaries; copied, foreign, expired or changed observations refuse. Unproved closure retains actual owners and the lifetime listener. Manual backup, restore and recovery commands do not exist. Automatic repairs retain their records and logging on disk without publishing a dashboard notice.

The flat archive copies the original SQLite database and every present sidecar unchanged, along
with recognized HR-managed files. Its schema2 source intent records files, directories and absent
database companions, source modes, sizes and SHA-256 digests. Entire recognized Chromium profile,
credential, key/auth and runtime containers are excluded with exact private member/digest census;
unknown source shapes refuse. Credential-free means excluding Relay's identified credential owners,
not scanning arbitrary HR payload bytes. Unretired, nonterminal and UNKNOWN historical rows remain
opaque bytes: archiving never retires, cancels, adopts or retries them. Registered-person backup and
UNKNOWN-write protections stay at their existing owners.
Every source file keeps its bytes and mode throughout archive IO. Path and descriptor identities
remain transient same-operation checks. Receipt authority is exact operation/source membership and
bytes, with independent copy readback and fresh physical closure before completion; it persists no
inode authority. Empty source directories are metadata only; physical copy directories are exactly
file ancestors. The schema2 receipt is an immutable archive, never a person restore manifest.
A fresh automatic archive acquisition probes again; changed post-probe source refuses with STORAGE_BACKUP_SOURCE_CHANGED
and preserves the first verified archive and source.json. It never overwrites that receipt or
creates a versioned substitute. An exact interrupted copy prefix may resume; missing, extra or
corrupt completed copies and old schema1 receipts refuse.
A genuinely abandoned admission mutex requires current closed process custody and exact backup,
source-record, allocation and recovery-history evidence. Unproved source closure retains custody.
