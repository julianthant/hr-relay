<!-- R02 research record · persisted by the supervisor from read-only unit U02-R1 (sup-scout) · 2026-09-04 · findings only, superseded by ref clock-config-secrets §D331.9 wherever they differ -->

# U02-R1 — Raw leaf inventory (config / credential / environment)

Repo root: `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-0-3-authority-design-c31da5310-r02-settings-authority-design`
All paths below are relative to that root unless prefixed `legacy:`.

## Table A — ConfigSchema leaves (src/domain/config/schema.ts)

| leaf path | zod type (short) | default | in EditableSettingsOverrideSchema? | CONFIG_ENV_BINDINGS entry | main consumer file:line |
|---|---|---|---|---|---|
| actor | strictObject{id,label} | `{id:LOCAL_OPERATOR_ACTOR_ID,label:"Local operator"}` | yes (label only) | — | schema.ts:136-137 |
| urls.kuali.prod.entry | url | literal kualibuild URL | no | — | resolve.ts:71 (testEntryBinding) |
| urls.kuali.test.entry | url (partial) | none | no | HRAUTO_KUALI_TEST_URL | resolve.ts:85 |
| urls.newKronos.prod.entry | url | literal mykronos URL | no | — | resolve.ts:72 |
| urls.newKronos.test.entry | url (partial) | none | no | HRAUTO_NEW_KRONOS_TEST_URL | resolve.ts:86 |
| urls.crm.prod.{entry,onboardingSearch,ucPathEntrySheet,onboardingHistory,idocsViewer} | url x5 | 5 literal act-crm/idocs URLs | no | — | resolve.ts:73 |
| urls.crm.test.* | partial url x5 | none | yes (test, omit entry) | HRAUTO_CRM_TEST_URL (entry only) | resolve.ts:87, schema.ts:340-342 |
| urls.onbase.prod.entry | url | literal hylandcloud URL | no | — | resolve.ts:74 |
| urls.onbase.test.entry | url (partial) | none | no | HRAUTO_ONBASE_TEST_URL | resolve.ts:88 |
| urls.ucpath.prod.{login,smartHr,jobSummary,personalData,personProfile} | url x5 | 5 literal ucphrprdpub/ucpath URLs | no | — | resolve.ts:75 |
| urls.ucpath.test.* | partial url x5 | none | yes (test, omit smartHr) | HRAUTO_UCPATH_TEST_URL (→ smartHr only) | resolve.ts:94-100, schema.ts:343-345 |
| urls.i9.prod.{entry,app} | url x2 | literal i9complete URLs | no | — | resolve.ts:75 |
| urls.i9.test.* | partial url x2 | none | yes (test, omit entry) | HRAUTO_I9_TEST_URL (entry only) | resolve.ts:89, schema.ts:346-348 |
| urls.oldKronos.prod.entry | url | literal kronos.net URL | no | — | resolve.ts:76 |
| urls.oldKronos.test.entry | url (partial) | none | no | HRAUTO_OLD_KRONOS_TEST_URL | resolve.ts:90 |
| urls.servicenow.prod.entry | url | literal support.ucsd.edu URL | no | — | resolve.ts:77 |
| urls.servicenow.test.entry | url (partial) | none | no | HRAUTO_SERVICENOW_TEST_URL | resolve.ts:91 |
| urls.sharepoint.prod.entry | url | literal sharepoint.com URL | no | — | resolve.ts:78 |
| urls.sharepoint.test.entry | url (partial) | none | no | HRAUTO_SHAREPOINT_TEST_URL | resolve.ts:92 |
| timeouts.navigationMs | int positive | 15000 | no | — | schema.ts:214-224 |
| timeouts.longNavigationMs | int positive | 30000 | no | — | schema.ts:216 |
| timeouts.ukgNavigationMs | int positive | 60000 | no (excluded via omit) | HRAUTO_UKG_NAVIGATION_MS | resolve.ts:136-139, schema.ts:350 |
| timeouts.taskMs | int positive | 180000 | no | — | schema.ts:218 |
| timeouts.sessionAcquireMs | int positive | 60000 | no | — | schema.ts:219 |
| timeouts.duoCeremonyLeaseGraceMs | int positive | 20000 | no | — | schema.ts:220 |
| timeouts.transactionMs | int positive | 300000 | no | — | schema.ts:221 |
| timeouts.duoApprovalSeconds | int positive | 180 | no | — | schema.ts:222 |
| timeouts.duoApprovalCrmSeconds | int positive | 60 | no | — | schema.ts:223 |
| timeouts.retryDelayMs | int positive | 5000 | no | — | schema.ts:224 |
| (other timeouts leaves) | — | — | yes (editable, all except ukgNavigationMs) | — | schema.ts:350 |
| paths.reportsDir | absolute path string | "runtime-paths" (resolve("data/reports")) | yes (editable) | — | runtime-paths.ts:52, schema.ts:351 |
| paths.downloadsDir | absolute path | "runtime-paths" | no | — | runtime-paths.ts:53 |
| paths.onboardingDocsDir | absolute path | "runtime-paths" | no | — | runtime-paths.ts:54 |
| paths.i9CheckTrackerPath | absolute path | "runtime-paths" | no | — | runtime-paths.ts:55 |
| paths.stateRoot | absolute path | "runtime-paths" (resolve(".tracker")) | no | — | runtime-paths.ts:56 |
| paths.artifactRoot | absolute path | "runtime-paths" (resolve(".tracker/artifacts")) | no | — | runtime-paths.ts:57 |
| paths.browserProfileRoot | absolute path | "runtime-paths" (rebuildRuntimeIsolation.browserProfileRoot resolved) | no | — | runtime-paths.ts:44,58 |
| paths.duoCredential | absolute path | "runtime-paths" (join(profileRoot,"duo-webauthn.json")) | no | — | runtime-paths.ts:59 |
| paths.duoExtensionDir | absolute path | "runtime-paths" (resolve("duo-autopilot")) | no | — | runtime-paths.ts:60 |
| annualDates.<FY>.jobEndDate | US-date regex | none (record default {}) | no (override-only, no editable) | ANNUAL_DATES_END | resolve.ts:107-113 |
| annualDates.<FY>.kronosDefaultEndDate | US-date regex | none | no | KRONOS_DEFAULT_END_DATE | resolve.ts:115-121 |
| annualDates.<FY>.kronosDefaultStartDate | US-date regex | none | no | KRONOS_DEFAULT_START_DATE | resolve.ts:123-129 |
| operator.timekeeperName | string | "" | no (editable schema has no `operator` group) | TIMEKEEPER_NAME | resolve.ts:102-105 |
| display.screenWidth / screenHeight | int positive | "host-display" (DEFAULT_DISPLAY 2560x1440 fallback) | yes (editable) | — (published via HRAUTO_HOST_PRIMARY_DISPLAY, not a CONFIG_ENV_BINDINGS row) | host-display.ts:83-91, schema.ts:352 |
| performance.navigationRetries | int positive | 10 | no | HRAUTO_NAVIGATION_RETRIES | resolve.ts:131-134 |
| performance.separationTerminationWindowDays | int positive | 14 | no | HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS | resolve.ts:141-144 |
| ocr.secondOpinionMax | int positive | 5 | no | OCR_SECOND_OPINION_MAX | resolve.ts:146-149 |
| ocr.pageMaxWaitMs | int positive | 120000 | no | OCR_PAGE_MAX_WAIT_MS | resolve.ts:151-154 |
| ocr.tier1PatienceMs | int positive | 90000 | no | OCR_TIER1_PATIENCE_MS | resolve.ts:156-159 |
| ocr.pageConcurrency | int nonneg | 0 | yes (editable) | OCR_PAGE_CONCURRENCY | resolve.ts:161-164, schema.ts:353-356 |
| ocr.disambigConcurrency | int positive | 4 | no | OCR_DISAMBIG_CONCURRENCY | resolve.ts:166-169 |
| ocr.suggestConcurrency | int positive | 4 | no | OCR_SUGGEST_CONCURRENCY | resolve.ts:171-174 |
| ocr.backoffBaseMs | int positive | 2000 | no | OCR_BACKOFF_BASE_MS | resolve.ts:176-179 |
| ocr.backoffCapMs | int positive | 60000 | no | OCR_BACKOFF_CAP_MS | resolve.ts:181-184 |
| ocr.maxValidationRetries | int nonneg | 1 | yes (editable) | OCR_MAX_VALIDATION_RETRIES | resolve.ts:186-189, schema.ts:354-356 |
| browserHealth.monitorTickMs | int positive | 30000 | no | HRAUTO_HEALTH_MONITOR_TICK_MS | resolve.ts:191-194 |
| browserHealth.maxAutoRefresh | int nonneg | 10 | no | HRAUTO_HEALTH_MONITOR_MAX_REFRESH | resolve.ts:196-199 |
| browserHealth.maxReopen | int nonneg | 3 | no | HRAUTO_HEALTH_MONITOR_MAX_REOPEN | resolve.ts:201-204 |
| browser.headless | boolean | true | yes (editable) | — | schema.ts:271-274,358 |
| browser.closeProofMs | int positive | 15000 | yes (editable) | — | schema.ts:273,358 |
| concurrency.defaultWorkers | int positive | 4 | yes (editable) | HRAUTO_DEFAULT_WORKERS | resolve.ts:206-209, schema.ts:357 |
| daemon.idleMs | int positive | 900000 | no | HRAUTO_DAEMON_IDLE_MS | resolve.ts:211-214 |
| daemon.idleRepollMs | int positive | 30000 | no | HRAUTO_DAEMON_IDLE_REPOLL_MS | resolve.ts:216-219 |
| features.debugScreenshots | boolean | false | no | DEBUG_SCREENSHOTS | resolve.ts:221-224 |
| features.duoWebAuthn | boolean | true | no | HR_AUTOMATION_DUO_WEBAUTHN | resolve.ts:226-229 |
| providers.{ocrExtract,geocodeCensus,geocodeNominatim,aiAdvisory}.{timeoutMs,concurrency,requestsPerMinute,dailyRequestLimit,costLimitUsdMicros} | int x5 per family x4 families | see schema.ts:91-94 literal defaults | yes (editable, whole group partial) | — | schema.ts:280,359 |

Row count: 62 distinct leaf rows (urls grouped per system/route; annualDates counted per field).

## Table B — CONFIG_ENV_BINDINGS (src/domain/config/resolve.ts:84-230)

| env name | target path | apply/parse rule | file:line |
|---|---|---|---|
| HRAUTO_KUALI_TEST_URL | urls.kuali.test.entry | z.url() then merge into urls.kuali.test.entry | resolve.ts:85 (testEntryBinding) |
| HRAUTO_NEW_KRONOS_TEST_URL | urls.newKronos.test.entry | same pattern | resolve.ts:86 |
| HRAUTO_CRM_TEST_URL | urls.crm.test.entry | same pattern | resolve.ts:87 |
| HRAUTO_ONBASE_TEST_URL | urls.onbase.test.entry | same pattern | resolve.ts:88 |
| HRAUTO_I9_TEST_URL | urls.i9.test.entry | same pattern | resolve.ts:89 |
| HRAUTO_OLD_KRONOS_TEST_URL | urls.oldKronos.test.entry | same pattern | resolve.ts:90 |
| HRAUTO_SERVICENOW_TEST_URL | urls.servicenow.test.entry | same pattern | resolve.ts:91 |
| HRAUTO_SHAREPOINT_TEST_URL | urls.sharepoint.test.entry | same pattern | resolve.ts:92 |
| HRAUTO_UCPATH_TEST_URL | urls.ucpath.test.smartHr | z.url() into smartHr only | resolve.ts:93-100 |
| TIMEKEEPER_NAME | operator.timekeeperName | z.string().min(1) | resolve.ts:101-105 |
| ANNUAL_DATES_END | annualDates.*.jobEndDate | raw string merged per fiscal year | resolve.ts:106-113 |
| KRONOS_DEFAULT_END_DATE | annualDates.*.kronosDefaultEndDate | raw string merged | resolve.ts:114-121 |
| KRONOS_DEFAULT_START_DATE | annualDates.*.kronosDefaultStartDate | raw string merged | resolve.ts:122-129 |
| HRAUTO_NAVIGATION_RETRIES | performance.navigationRetries | integer() (positive int text) | resolve.ts:130-134 |
| HRAUTO_UKG_NAVIGATION_MS | timeouts.ukgNavigationMs | integer() | resolve.ts:135-139 |
| HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS | performance.separationTerminationWindowDays | integer() | resolve.ts:140-144 |
| OCR_SECOND_OPINION_MAX | ocr.secondOpinionMax | integer() | resolve.ts:145-149 |
| OCR_PAGE_MAX_WAIT_MS | ocr.pageMaxWaitMs | integer() | resolve.ts:150-154 |
| OCR_TIER1_PATIENCE_MS | ocr.tier1PatienceMs | integer() | resolve.ts:155-159 |
| OCR_PAGE_CONCURRENCY | ocr.pageConcurrency | nonNegativeInteger() | resolve.ts:160-164 |
| OCR_DISAMBIG_CONCURRENCY | ocr.disambigConcurrency | integer() | resolve.ts:165-169 |
| OCR_SUGGEST_CONCURRENCY | ocr.suggestConcurrency | integer() | resolve.ts:170-174 |
| OCR_BACKOFF_BASE_MS | ocr.backoffBaseMs | integer() | resolve.ts:175-179 |
| OCR_BACKOFF_CAP_MS | ocr.backoffCapMs | integer() | resolve.ts:180-184 |
| OCR_MAX_VALIDATION_RETRIES | ocr.maxValidationRetries | nonNegativeInteger() | resolve.ts:185-189 |
| HRAUTO_HEALTH_MONITOR_TICK_MS | browserHealth.monitorTickMs | integer() | resolve.ts:190-194 |
| HRAUTO_HEALTH_MONITOR_MAX_REFRESH | browserHealth.maxAutoRefresh | nonNegativeInteger() | resolve.ts:195-199 |
| HRAUTO_HEALTH_MONITOR_MAX_REOPEN | browserHealth.maxReopen | nonNegativeInteger() | resolve.ts:200-204 |
| HRAUTO_DEFAULT_WORKERS | concurrency.defaultWorkers | integer() | resolve.ts:205-209 |
| HRAUTO_DAEMON_IDLE_MS | daemon.idleMs | integer() | resolve.ts:210-214 |
| HRAUTO_DAEMON_IDLE_REPOLL_MS | daemon.idleRepollMs | integer() | resolve.ts:215-219 |
| DEBUG_SCREENSHOTS | features.debugScreenshots | flag() ("0"/"1"→bool) | resolve.ts:220-224 |
| HR_AUTOMATION_DUO_WEBAUTHN | features.duoWebAuthn | flag() | resolve.ts:225-229 |

Row count: 32 bindings (registry asserts uniqueness of both `env` and `path` — resolve.ts:232-239).
Note: `display.*` has NO binding row; its default source is `HRAUTO_HOST_PRIMARY_DISPLAY` via `hostDisplayDefault` (host-display.ts:83), which is a DEFAULT-layer input, not an env-override layer (confirmed by runtime-environment.ts:504-507 channel `config-default`).

## Table C — src/domain/runtime-environment.ts entries

Registry is declarative (arrays), not one row per literal env var in all cases — captured as generated groups plus explicit rows.

| variable / group | channel/class | purpose | credential? | canary/test-subject? | provider key? | runtime/isolation/process-ownership? | config-default (D324)? | file:line |
|---|---|---|---|---|---|---|---|---|
| 32 keys in CONFIG_ENVIRONMENT_KEYS (Table B set) | config (TIMEKEEPER_NAME is config-and-secret) | env override layer for ConfigSchema | no (except TIMEKEEPER_NAME = direct-identifier) | no | no | no | no | runtime-environment.ts:102-136,221-229 |
| UCPATH_USER_ID | secret, classification direct-identifier | UCPath SSO login id | yes | no | no | no | no | runtime-environment.ts:139,230-235 |
| UCPATH_PASSWORD | secret, classification secret | UCPath SSO password | yes | no | no | no | no | runtime-environment.ts:140 |
| ONBOARDING_ROSTER_URL | secret, classification secret | SharePoint onboarding roster URL | yes(secret-classified) | no | no | no | no | runtime-environment.ts:141 |
| HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY | secret, classification secret | D288 HMAC key for person pseudonym generation | yes | no | no | no | no | runtime-environment.ts:143-146 |
| HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION | secret channel, classification non-secret-config | public generation id paired with key | no | no | no | no | no | runtime-environment.ts:147-151 |
| HRAUTO_DASHBOARD_LAUNCH_NONCE | process-ownership, direct-identifier | dashboard launcher/Vite ownership proof | no | no | no | yes | no | runtime-environment.ts:236-243 |
| HRAUTO_HOST_PRIMARY_DISPLAY | config-default, non-secret-config | published host primary display (D324) | no | no | no | no | yes | runtime-environment.ts:244-253 |
| HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER | secret, classification direct-identifier | separations canary Kuali document number | no | yes | no | no | no | runtime-environment.ts:254-261 (TEST_TARGET_SECRET_SPECS) |
| HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID | secret, classification direct-identifier | person-lookup canary UCPath EID | no | yes | no | no | no | runtime-environment.ts:254-261 |
| OCR_GEMINI_MODELS / OCR_GROQ_MODELS / OCR_MISTRAL_MODELS / OCR_OPENROUTER_MODELS / OCR_SAMBANOVA_MODELS | provider-model, non-secret-config | model chain per provider family | no | no | yes(model id, non-secret) | no | no | runtime-environment.ts:156-159,262-269 |
| GEMINI_API_KEY{,2..8} / GROQ_API_KEY{...} / MISTRAL_API_KEY{...} / OPEN_ROUTER_API_KEY{...} / SAMBANOVA_API_KEY{...} (families, max 8 each) | secret family | OCR provider API keys | yes | no | yes | no | no | runtime-environment.ts:286-293 |
| HRAUTO_E2E_STUBS, HR_DRYRUN_DOC_ID, HR_SOAK_ITERATIONS, HR_TEARDOWN_SOAK_ITERATIONS, HR_TEST_HEADED, PARITY_UPDATE, SEL_SESSION, TMPDIR, TZ, __NUMENV_TEST__ | test-only | test-lane only vars | no | no | no | no | no | runtime-environment.ts:165-169,270-276 |
| HRAUTO_LEGACY_REPO | test-only | test-lane locates legacy repo for audit (guard-files.ts only) | no | no | no | no | no | runtime-environment.ts:205 |
| 30 RETIRED_ENVIRONMENT_KEYS (CAPTURE_NGROK, DEBUG, HRAUTO_DASHBOARD_ALLOWED_ORIGINS, KRONOS_CALENDAR_*, OCR_PROVIDER_ATTEMPT_TIMEOUT_MS, PLAYWRIGHT_BROWSERS_PATH, SEPARATIONS_ROSTER_URL, legacy provider model singular vars, etc.) | retired-in-target | legacy-only, not read by rebuild runtime | mixed (n/a) | n/a | n/a | n/a | n/a | runtime-environment.ts:171-186,277-283 |
| CEREBRAS_API_KEY / COHERE_API_KEY / OCRSPACE_API_KEY / ZEP_API_KEY (families) | test-only | legacy probe-providers script only | n/a | no | test-probe key | no | no | runtime-environment.ts:294-297 |

Row count: 33 exact entries (`RUNTIME_ENVIRONMENT_EXACT`: 32 config + UCPATH_USER_ID + UCPATH_PASSWORD + ONBOARDING_ROSTER_URL + 2 pseudonym + LAUNCH_NONCE + HOST_PRIMARY_DISPLAY + 2 test-target + 5 provider-model + 10 test-only + 1 legacy-repo test-only + 30 retired = counted via array concatenation, see runtime-environment.ts:221-284) plus 9 families (5 active secret + 4 test-only probe, runtime-environment.ts:286-298).

## Table D — src/domain/secrets.ts accessors

| exported function | env key(s) read | returns (shape) | validation rule | file:line |
|---|---|---|---|---|
| admitLocalEnvironmentFile | (reads .env file bytes, then applies each parsed key not already in parent env) | void (mutates `env`) | strict grammar scan + parseEnv cross-check + O_NOFOLLOW open + 0600/regular/≤64000 bytes | secrets.ts:382-453 |
| optionalTestTargetSecret | TEST_TARGET_SECRET_SPECS[name].env | string \| undefined | KualiDocumentNumberSchema or EidSchema per valueKind | secrets.ts:470-485 |
| inspectSecret | SECRET_SPECS[name].env | SecretAvailability discriminated union (present/missing/unknown) | resolveSecretValue trim/empty check | secrets.ts:525-551 |
| optionalSecret | SECRET_SPECS[name].env | string \| undefined | trim/empty→undefined | secrets.ts:553-559 |
| configResolutionEnvironment | (passthrough) | NodeJS.ProcessEnv | none (identity) | secrets.ts:569-571 |
| hostAwareResolutionEnvironment | HRAUTO_HOST_PRIMARY_DISPLAY (via establishHostPrimaryDisplay) | NodeJS.ProcessEnv | delegates to host-display.ts probe/publish | secrets.ts:581-587 |
| requireSecret | SECRET_SPECS[name].env | string (throws SecretMissingError if absent) | same as optionalSecret + throw | secrets.ts:589-601 |
| requireActivityPersonPseudonymDomain | HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION, HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY | ActivityPersonPseudonymDomain | both required non-empty; throws SecretMissingError | secrets.ts:608-625 |
| optionalSecretFamily | SECRET_FAMILY_SPECS[name].envPrefix{,2..maximum} | readonly string[] | trim/empty filtered | secrets.ts:627-636 |
| requireSecretFamily | same family prefix | readonly [string,...string[]] | throws SecretMissingError if first undefined | secrets.ts:638-646 |
| providerModelChain | SECRET_FAMILY_SPECS[name].modelsEnv, fallback legacyModelEnv | readonly string[] | comma-split, trim, filter empty; legacy single-model fallback | secrets.ts:659-669 |
| validateBootSecrets | all SECRET_SPECS/SECRET_FAMILY_SPECS with requiredAtBoot=true | void (throws SecretMissingError aggregated) | inspectSecret + optionalSecretFamily | secrets.ts:677-688 |
| validateDescriptorSecrets | supplied names/families | void (throws) | same pattern, scoped to descriptor's declared secrets | secrets.ts:690-702 |
| requireSecretFile | config.paths.duoCredential | Buffer | file: regular, 0600-or-stricter mode, ≤maximumBytes | secrets.ts:704-722 |
| resolveSecretFileIdentity | (reads duoCredential file via requireSecretFile) | Fingerprint (sha256 over sorted rpId/credentialId pairs) | JSON.parse + shape check (rpId+credentialId per entry) | secrets.ts:766-793 |

Row count: 14 exported functions.

Call sites (file:line) found by targeted grep of the scope files only (not a full-repo grep — see COVERAGE):
- `resolveConfigWithProvenance`/`resolveConfig` consumers pass `configResolutionEnvironment`/`hostAwareResolutionEnvironment` output — src/server/settings-runtime.ts:189 (`resolveConfigWithProvenance(input.environment, ...)`), src/domain/config/host-display.ts is the sole owner of `hostAwareResolutionEnvironment`'s companion probe (host-display.ts:98-107); `admitLocalEnvironmentFile` is called at scripts/secure-env-bootstrap.ts:33-35.
- Full-repo call-site enumeration for the other 12 accessors (e.g. `requireSecret`, `requireSecretFile`, `providerModelChain`) was NOT performed — out of the read budget for a targeted grep beyond the listed scope files; see COVERAGE.

## Table E — as-built settings authority struct fields

**SettingsFileRecordSchema** (src/domain/config/settings.ts:35-102) — the durable `.tracker/settings/settings.json` envelope (per CLAUDE.md, moved under state root by D321; module docstring at settings-file.ts still says `config/settings.json` — see NOTES):
```
revision: PositiveIntSchema
settingsSchemaHash: FingerprintSchema
settingsFingerprint: FingerprintSchema
settings: EditableSettingsOverrideSchema
lastApplied?: {
  commandId: CommandIdSchema
  commandFingerprint: FingerprintSchema
  expectedRevision: PositiveIntSchema
  settingsSchemaHash: FingerprintSchema
  patchFingerprint: FingerprintSchema
}
```
file:line settings.ts:35-46. Invariants (superRefine, settings.ts:47-102): schema hash must match build's `SETTINGS_SCHEMA_HASH`; fingerprint must re-derive; revision 1 is the baseline (no lastApplied, empty settings); revision>1 requires lastApplied with `expectedRevision+1===revision` and matching schema hash.

**settings_current singleton** — `SettingsCurrentRecordSchema` (src/domain/config/settings-current.ts:11-26):
```
revision: PositiveIntSchema (must be >=2)
settingsFingerprint: FingerprintSchema
commandId: CommandIdSchema
commandFingerprint: FingerprintSchema
auditId: CommandAuditIdSchema
committedAt: IsoInstantSchema
```
file:line settings-current.ts:11-18.

**Runtime-generation activation row** — `ActiveRuntimeConfigRecordSchema` (src/domain/config/runtime-generation.ts:10-17):
```
generation: PositiveIntSchema
settingsRevision: PositiveIntSchema
settingsFingerprint: FingerprintSchema
configSnapshotId: ConfigSnapshotIdSchema
configFingerprint: FingerprintSchema
activatedAt: IsoInstantSchema
```
Plus derived: `ActiveRuntimeConfigActivationSchema` (omits generation, runtime-generation.ts:20-22), `ActiveRuntimeConfigExpectationSchema` (settingsRevision/settingsFingerprint/configFingerprint, runtime-generation.ts:24-28), `RuntimeConfigClaimTokenSchema` (generation+settingsRevision+settingsFingerprint+configFingerprint, runtime-generation.ts:30-35). file:line runtime-generation.ts:10-35.

**apply-settings command fields** — `SettingsCommandRequestSchema` (src/domain/commands.ts:195-205):
```
...CommandEnvelopeFields (generic envelope: id/actor/time/etc, not read in this scope)
family: "settings"
type: "apply-settings"
target: { expectedRevision: PositiveIntSchema }
payload: {
  settingsSchemaHash: FingerprintSchema
  patchFingerprint: FingerprintSchema
  patch: EditableSettingsOverrideSchema
}
```
file:line commands.ts:195-205; fingerprint derivation `deriveSettingsCommandFingerprint` commands.ts:208-213.

**SettingsApplyInputSchema** (settings.ts:104-111):
```
commandId, commandFingerprint, expectedRevision, settingsSchemaHash, patchFingerprint, patch: EditableSettingsOverrideSchema
```

**Sidecar/lock/prepare/rollback files and permission bits** (src/infra/config/settings-file.ts):

| file | schema | fields | permission bits | size bound | file:line |
|---|---|---|---|---|---|
| `<settingsPath>` (settings.json) | SettingsFileRecordSchema | see above | 0600 exact (write `flag:"wx",mode:0o600`; read requires exact 0600, owner-uid match) | MAX_SETTINGS_FILE_BYTES = 1,048,576 | settings-file.ts:109,252-257,347 |
| `<settingsPath>.lock` | SettingsAuthorityLockRecordSchema `{schemaVersion:1, acquisitionId:uuid, pid:PositiveInt, processIdentity:ProcessStartIdentitySchema, settingsPathFingerprint:Fingerprint}` | — | 0600 (openSync ...,"wx",0o600 for hard-link twin) | MAX_SETTINGS_LOCK_BYTES = 16,384 | settings-file.ts:120-127,577-578,822 |
| `<settingsPath>.lock.reaper` | SettingsStaleReaperRecordSchema `{schemaVersion:1, reaperId:uuid, pid, processIdentity, settingsPathFingerprint}` | — | 0600 (same descriptor path) | MAX_SETTINGS_LOCK_BYTES = 16,384 | settings-file.ts:129-136,578 |
| `<settingsPath>.authority.json` (initialization sidecar) | SettingsInitializationRecordSchema `{schemaVersion:1, settingsPathFingerprint, settingsSchemaHash, state: "virgin"\|"initialized"}` | — | private/0600 via readPrivateRegularFile | MAX_SETTINGS_INITIALIZATION_BYTES = 16,384 | settings-file.ts:138-144,1104,1136 |
| `<settingsPath>.rollback.json` | SettingsRollbackRecordSchema `{schemaVersion:1, rollbackId:uuid, settingsPathFingerprint, commandId:uuid, appliedRevision, priorRevision, appliedSettingsBytesFingerprint, priorSettingsBytesFingerprint:Fingerprint|null, priorInitializationBytesFingerprint}` (superRefine: priorRevision+1===appliedRevision) | — | private/0600 | MAX_SETTINGS_ROLLBACK_BYTES = 16,384 | settings-file.ts:146-165,1105,1145 |
| `<settingsPath>.prepare.json` | SettingsPrepareRecordSchema `{schemaVersion:1, prepareId:uuid, settingsPathFingerprint, command:{commandId,commandFingerprint,expectedRevision,settingsSchemaHash,patchFingerprint}, priorSettingsBytesBase64:base64|null, nextSettingsBytesBase64:base64, priorInitializationBytesBase64:base64, nextInitializationBytesBase64:base64}` | — | private/0600 | MAX_SETTINGS_PREPARE_BYTES = MAX_SETTINGS_FILE_BYTES*3 = 3,145,728 | settings-file.ts:168-184,1106,1154 |

**Directory ownership/mode checks** (`verifySettingsDirectory`, settings-file.ts:448-514): walks every ancestor from root; requires runtime-owned uid (or root-owned for non-authority ancestors); rejects group/world-writable directories (mode & 0o022) unless sticky-bit-protected non-authority ancestor; missing components created with `mkdirSync(path,{mode:0o700})` (line 474); symlinks refused unless root-owned under root-owned parent, target re-walked, and raw target must not contain a literal `..` component (lines 486-498); binds device/inode per pathname and rechecks identity on reuse (lines 456-485).

**Private regular-file read invariants** (`readPrivateRegularFile`, settings-file.ts:223-286): no-follow open (O_NOFOLLOW), must be regular file, hard-link count in allowed set (default `[1]`), owner uid must equal runtime uid, mode must equal exactly 0o600 (line 252-257), size ≤ maximumBytes both via stat and actual read, and post-read fstat must match pre-read metadata exactly (dev/ino/uid/mode/nlink/size) or it throws "changed while ... being read" (lines 269-278).

Row count: 6 durable struct schemas (SettingsFileRecord, SettingsCurrentRecord, ActiveRuntimeConfigRecord + 3 derived, SettingsCommandRequest) + 6 sidecar/lock file kinds.

## Table F — config/test-subjects.json labels

| label | workflow(s) | kind | availability.state | lastObserved | environment key NAME(s) referenced | loader resolution file:line |
|---|---|---|---|---|---|---|
| finalization-canary | separations (full-chain-dry-run); separations-kuali-finalization (ordinary, pending) | mixed | available | 2026-09-03 | HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER (via reference name `separationsKualiFinalizationCanaryDocumentNumber`) | test-subjects.json:19-30; resolved at runtime via secrets.ts `optionalTestTargetSecret`/registeredTestTargetSecretSpec (secrets.ts:455-485), spec closed in TEST_TARGET_SECRET_SPECS (secrets.ts:160-173) |
| person-lookup-canary | person-lookup (search-by-eid) | ordinary | available | 2026-09-02 | HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID (reference name `personLookupCanaryEid`) | test-subjects.json:59-70; same secrets.ts accessor path, EidSchema validation (secrets.ts:477) |

Only public metadata is quoted (workflow, kind, availability.state/lastObserved/reason text, provenance doc pointer, environment KEY names); no value present in the file (schemaVersion:2 at test-subjects.json:2). The loader/label→workflow/kind matching contract is described in CLAUDE.md's "Dry-run subjects" paragraph; the strict recursively-frozen registry loading code itself was not in the read scope for R1 (not among the listed files) — see COVERAGE.

Row count: 2 labels.

## Table G — .env.example keys and secure-env-bootstrap.ts admission rules

| key | classification | comment line beside it | file:line |
|---|---|---|---|
| UCPATH_USER_ID | credential | (none directly; file preamble at .env.example:1-12) | .env.example:14 |
| UCPATH_PASSWORD | credential | — | .env.example:15 |
| TIMEKEEPER_NAME | other (operator default, config-and-secret channel) | "Optional operator default used where a workflow declares it. Keep it local." | .env.example:17-18 |
| HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER | canary | "The separations canary is ONE Kuali document number (D300) ... never put a name or an EID in any canary key." | .env.example:20-26 |
| HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID | canary | "D318 — the person-lookup live-read canary: ONE current UCPath employee id (eight digits). Never commit a value." | .env.example:27 |
| HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY (commented out) | credential | "D288 Activity person pseudonyms. The HMAC key is a 32-byte lowercase hex secret (`openssl rand -hex 32`)..." | .env.example:30-33 |
| HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION (commented out) | other (public generation id) | same block; "must change whenever the key rotates" | .env.example:30-34 |
| ANNUAL_DATES_END (commented) | runtime/config | "Other supported rebuild configuration keys ... Annual dates use MM/DD/YYYY or M/D/YYYY." | .env.example:36-39 |
| KRONOS_DEFAULT_END_DATE (commented) | runtime/config | same block | .env.example:40 |
| KRONOS_DEFAULT_START_DATE (commented) | runtime/config | same block | .env.example:41 |
| ONBOARDING_ROSTER_URL (commented) | credential (SharePoint URL, classification "secret" in secrets.ts) | same block | .env.example:42 |
| HR_AUTOMATION_DUO_WEBAUTHN (commented) | runtime/config | same block | .env.example:43 |
| DEBUG_SCREENSHOTS (commented) | runtime/config | (no per-line comment beyond section) | .env.example:45 |
| HRAUTO_UKG_NAVIGATION_MS (commented) | runtime/config | — | .env.example:46 |
| HRAUTO_NAVIGATION_RETRIES (commented) | runtime/config | — | .env.example:47 |
| HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS (commented) | runtime/config | — | .env.example:48 |
| OCR_SECOND_OPINION_MAX (commented) | runtime/config | — | .env.example:49 |
| OCR_PAGE_MAX_WAIT_MS (commented) | runtime/config | — | .env.example:50 |
| OCR_PAGE_CONCURRENCY (commented) | runtime/config | — | .env.example:51 |
| OCR_DISAMBIG_CONCURRENCY (commented) | runtime/config | — | .env.example:52 |
| OCR_SUGGEST_CONCURRENCY (commented) | runtime/config | — | .env.example:53 |

Row count: 20 key lines (5 uncommented/active-by-default + 15 commented examples).

**scripts/secure-env-bootstrap.ts admission rules:**
- `.env` path is derived from the bootstrap module's own URL, never `process.cwd()`: `fileURLToPath(new URL("../.env", import.meta.url))` — secure-env-bootstrap.ts:13-15.
- Admission is delegated to `admitLocalEnvironmentFile` (src/domain/secrets.ts:382-453), called at secure-env-bootstrap.ts:33-35, unless a test injects `dependencies.admitEnvironmentFile`.
- Mode bits: file must be a regular file with `(metadata.mode & 0o077) === 0` (i.e., no group/other permission bits) — secrets.ts:249-251 (`assertRegisteredSecretFileMetadata`).
- No-follow: opened with `O_RDONLY | O_NOFOLLOW` — secrets.ts:389-392.
- Size bound: `REGISTERED_SECRET_FILE_MAXIMUM_BYTES = 64,000` bytes, checked both via fstat and actual read length — secrets.ts:57,252-253,406-409.
- Parent-env precedence: only keys **absent** from the explicit parent `env` (default `process.env`) are applied from the parsed file — `if (!explicitParentKeys.has(key)) env[key] = value;` secrets.ts:442,447-452.
- Grammar: a strict hand-written scanner (`strictlyValidateLocalEnvironment`, secrets.ts:278-376) validates the complete `.env` grammar (comments, quoted/unquoted values, no duplicate keys) before Node's permissive `parseEnv` is used to decode values, then the two key sets are cross-checked one-to-one (secrets.ts:410-420) — this is the "permissive parser is not an admission proof" lesson from CLAUDE.md.
- Selector: `secureEnvironmentEntrypoint` accepts only `"cli"` or `"test-target-document-number"` — secure-env-bootstrap.ts:17-24; anything else throws.
- The two allowed dynamic imports are `../src/cli.js` (cli) and `./smoke-test-target-document-number.js` (test-target-document-number) — secure-env-bootstrap.ts:44,59.

---

## NOTES / surprises

1. **Duplicate/renamed authority for the settings envelope path**: CLAUDE.md's "Operational isolation" section states the settings authority now lives INSIDE the state root since D321 (`.tracker/settings/...`), but `src/infra/config/settings-file.ts`'s docstrings and the module's `SettingsFileRecordSchema` comment (settings.ts:32) still say "the one durable `config/settings.json` envelope" — i.e. the in-repo doc comments were not observed to have been updated to the new `.tracker`-relative path in this scope. This is exactly the kind of drift the supervisor's catalog work needs to resolve — confirm the actual composition-root path (not read in this scope; `src/core/runtime-composition.ts` / `src/cli.ts` were out of scope) before authoring the new catalog.
2. **`display` is resolved through a channel with no CONFIG_ENV_BINDINGS row** — its "env override" is really the `HRAUTO_HOST_PRIMARY_DISPLAY` default-layer publish, not a settings/env override in the ordinary sense (host-display.ts:1-26 docstring explicitly calls this out; runtime-environment.ts marks its channel `config-default`, distinct from `config`).
3. **`TIMEKEEPER_NAME` is the sole leaf with TWO channels** (`config-and-secret`): it is both a `CONFIG_ENV_BINDINGS` row (operator.timekeeperName) AND registered in `SECRET_SPECS` (secrets.ts:147) as a `direct-identifier` secret read via `secrets.ts` accessors — `auditRuntimeEnvironmentInventory` explicitly asserts this is the ONLY such overlap (runtime-environment.ts:494-497).
4. **`paths.reportsDir` is the only `paths.*` leaf in EditableSettingsOverrideSchema** (schema.ts:351) — every other `paths.*` leaf is override-eligible (`SettingsOverrideSchema.paths` allows all of `ConfigPathsSchema.partial()`, schema.ts:315) but NOT dashboard-editable — two different "closed sets" for the same group (override contract vs. persisted/editable contract), which the new catalog will need to reconcile explicitly.
5. **`annualDates` and `operator` have NO EditableSettingsOverrideSchema group at all** — they are only reachable via `SettingsOverrideSchema` (i.e., env-injected or resolver-input, never through the dashboard "settings" command). `EditableSettingsOverrideSchema` (schema.ts:337-360) simply omits both keys.
6. **Test-target secrets are a THIRD registry pattern**, distinct from `SECRET_SPECS`/`SECRET_FAMILY_SPECS`: `TEST_TARGET_SECRET_SPECS` is a discriminated union keyed by `valueKind` (`kuali-document-number` | `ucpath-eid`) with its own per-value-kind schema validation (`KualiDocumentNumberSchema`/`EidSchema`) rather than being a generic string secret (secrets.ts:133-173,470-485).
7. **`HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION` is classified `non-secret-config` but travels through the SAME `secret` channel/owner as the actual HMAC key** — i.e., a non-secret value is registered alongside a secret with no separate config-channel path (runtime-environment.ts:142-151).
8. **`ConfigPathsSchema` has NO schema default at all** ("PURE CONTRACT, NO DEFAULT — deliberately", schema.ts:104-117) — its defaults are entirely runtime-composed (`runtime-paths.ts`), unlike every other Config group which carries a `.default(...)`.
9. Nothing outside `src/domain/secrets.ts` and `src/domain/config/host-display.ts` was observed writing to `process.env` in the files read in this scope; `hostAwareResolutionEnvironment` (secrets.ts) is explicitly documented as "the only environment WRITE in the tree."

## COVERAGE

Read in full: src/domain/config/schema.ts, resolve.ts, settings.ts, settings-current.ts, runtime-generation.ts, provenance.ts, host-display.ts, runtime-paths.ts, src/domain/secrets.ts, src/domain/runtime-environment.ts, src/server/settings-runtime.ts, scripts/secure-env-bootstrap.ts, .env.example, config/test-subjects.json, config/runtime-isolation.json, src/infra/host/primary-display.ts, and the relevant apply-settings slice of src/domain/commands.ts (lines 190-220).

Read selectively (grep + targeted ranges, not full file): src/infra/config/settings-file.ts (1787 lines total; read lines 1-354 in full, 424-538 in full via offset, and grepped for schema/permission-bit/path patterns across the whole file — the command-apply/reconcile/rollback control-flow bodies past line ~600, e.g. the full stale-reaper recovery and prepare/rollback commit sequencing, were NOT read line-by-line).

NOT done (out of budget / not requested to full depth):
- Full-repo grep for consumers of each of the 14 `secrets.ts` accessor functions (Table D call-site column is partial — only the two call sites visible in already-read scope files are listed).
- `src/domain/ids.ts`, `src/domain/secret-names.ts`, `src/domain/commands.ts` CommandEnvelopeFields, `src/core/command-kernel.ts`, `src/infra/sqlite/authority-database.ts`, `src/infra/sqlite/runtime-process-locks.ts` (ProcessStartIdentitySchema), and `src/domain/config/host-display.ts`'s composition-root caller were referenced but not opened — their field shapes are quoted only via the imported type names.
- The actual composition-root path resolution for `settings.json` under `.tracker/settings/` (D321) was not verified against source; flagged as NOTE 1 above for the supervisor to confirm before authoring the catalog.
- No `.env` file exists in this worktree and none was read (confirmed per scope instruction).
