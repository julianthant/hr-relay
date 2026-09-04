<!-- R02 research record · persisted by the supervisor from read-only unit U02-R2 (sup-analyst) · 2026-09-04 · findings only; dispositions are in ref clock-config-secrets §D331 and reports/r02.md -->

# U02-R2 — D327 settings catalog: contract conflicts, leak surfaces, classification, restart scope

Work identity: phase-0-3-authority-design · C31da5310 · R02 · U02-R2 (read-only analyst).
Repo root for every path below:
`/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-0-3-authority-design-c31da5310-r02-settings-authority-design`.
Scouts used: 2 (`sup-scout` — guard/test map; `sup-scout` — config leak-channel map).

**COUNTS: 12 discrete conflicts across 8 areas · 6 doc passages needing dated supersession ·
16 leak channels · 5 unresolved classifications · 3 escalations.**

---

## 1. CONFLICTS

### (a) The blanket `env > settings > default` rule and the CONFIG_ENV_BINDINGS registry

**VERDICT: DIRECT CONFLICT. D327 governs; §3's blanket-precedence text must be superseded with a
dated note. Two collateral factual errors in the same section must be corrected in the same edit.**
CONFIDENCE: high — D327's own text names this rule as the thing it supersedes.

| evidence | path:line / § | note |
|---|---|---|
| "D327 supersedes the current single-file/sidecar layout **and the blanket `env > settings > default` precedence** for operator-managed non-provider-key values" | `docs/rebuild/reference/clock-config-secrets.md:464`ff (§3 D327 block) | the superseding text is already in the owning doc |
| "**One resolver implements `env > settings.json > default` exactly once**" | `clock-config-secrets.md:~217` | stale as a blanket rule; the "exactly once" half stays binding |
| "Precedence remains **`env > settings > default`**" | `clock-config-secrets.md:~455` (settings producer block) | second stale statement, same section |
| provenance computation | `src/domain/config/resolve.ts:396-401` — `source: envPaths.has(path) ? "env" : settingsPaths.has(path) ? "settings" : "default"` | the single line 1.6 must change; the three-value vocabulary is `src/domain/config/provenance.ts:6` |
| binding count | `resolve.ts:84-241` — 8 `testEntryBinding(...)` + 25 inline `env: "…"` = **33**, not 38 | doc says "**38 bindings are registered today**" (`clock-config-secrets.md:356`) and names five `HRAUTO_CAPTURE_*` that D294 retired; `grep -rn HRAUTO_CAPTURE src tests config` returns zero hits |
| group count | `src/domain/config/schema.ts:130-278` — 15 groups; there is no `capture` group | doc says "a `z.strictObject` of 16 groups: … `capture` …" (`clock-config-secrets.md:~232`); `src/domain/config/snapshot.ts:30-36` actively *refuses to mint* a `capture` key |

**Which text stays binding:** one resolver implements the precedence exactly once and no read site
repeats it; provenance is bidirectionally complete or the resolver throws (`resolve.ts:406`);
`fingerprint` is SHA-256 over `canonicalJsonStringify(config)`; the D121 contract/runtime path split;
consumers narrow rather than redeclare. **What must be restated, not deleted:** the annual-dates
group rule (all three or throw, `resolve.ts:367`) and the "trimmed, empty string is UNSET" rule —
both are properties of the *environment* layer and need a settings-layer equivalent, or they vanish
silently with the env arm.

**Guards/tests 1.6 owes a change (evidence, scout T1/T2/T5):**
`tests/unit/architecture/runtime-environment-coverage.test.ts` (every migrated key's
`owner`/`channel` row in `src/domain/runtime-environment.ts:224-229` changes);
`tests/unit/architecture/secrets-single-source.test.ts:55,60-64,101` (the
`CONFIG_OWNER_PREFIX = "src/domain/config/"` env-read permission);
`tests/unit/architecture/strict-boundary-schemas.test.ts:38,46,220` (catalog schemas join the
boundary inventory); `tests/unit/architecture/config-snapshot-generations.test.ts` (see (g)).
Non-guard tests: `tests/unit/config.test.ts` (~40 `settings.json` path hits),
`tests/unit/settings-file-service.test.ts`, `tests/unit/server/settings-runtime-reader.test.ts:63`,
`tests/unit/command-kernel.test.ts:1585,1614,1729`, `tests/unit/worker-composition.test.ts:186,220,578,590`,
`tests/unit/dry-run-scenario-composition.test.ts` (11 hits),
`tests/unit/server/compose-real-port.test.ts` (11 hits), `tests/unit/server/bff-flow.test.ts:236`,
`tests/unit/fixtures/{settings-runtime-corruption-fixtures.ts:162,dry-run-admission-fixtures.ts:33}`,
and **11 frozen parity references** containing the literal string `settings.json: not set`
(`tests/parity/references/{settings,storage-settings}--*.yml`, line 54/57) — the Settings surface
label at `src/dashboard/surfaces/settings.tsx:605,616` is part of the reference bytes.

WHAT WOULD CHANGE THIS: an operator ruling that env precedence is retained for a named subset.

---

### (b) `EditableSettingsOverrideSchema` (the allowlist) and `SETTINGS_SCHEMA_HASH`

**VERDICT: PARTIAL CONFLICT — two problems. D327 governs both.** CONFIDENCE: high.

1. **Two lists exist where the catalog demands one.** The persisted allowlist is broader than the
   served editor: `EditableSettingsOverrideSchema` admits `actor`, three `urls.*.test` groups,
   nine `timeouts` leaves, `paths.reportsDir`, `display`, two `ocr` leaves,
   `concurrency.defaultWorkers`, all of `browser`, all of `providers`
   (`src/domain/config/schema.ts:326-352`), while the DCC3 editor serves exactly **8** leaves
   (`src/server/dashboard/queries/settings-editor.ts:40-88`). The doc already admits this ("Its
   visible inventory is not the whole backend allowlist", `clock-config-secrets.md:~457`). D327 leaf
   1 ("enumerate every setting once") makes that split illegal: the catalog must be the *single*
   generator of the persisted schema, the editor inventory and the resolver's source table.
2. **The hash is a migration brick.** `SETTINGS_SCHEMA_HASH = deriveSchemaHash(EditableSettingsOverrideSchema, "input")`
   (`src/domain/config/settings.ts:13`) and `SettingsFileRecordSchema`'s `superRefine` **refuses any
   persisted record whose `settingsSchemaHash` differs from this build's**
   (`settings.ts:47-53`), as does the initialization sidecar
   (`src/infra/config/settings-file.ts:1205-1208`) and the apply request
   (`settings-file.ts:1553-1557`). Any catalog change moves the hash, so *every existing
   `settings.json` refuses at the next boot*. The design must specify the upgrade as a journaled
   rewrite under the new hash (D327 already requires an explicit `cli storage backup` first), not as
   a tolerated mismatch.

Text to supersede with a dated note: `clock-config-secrets.md:~450-460` ("The settings producer and
editable boundary"), specifically "Credentials, annual dates and other non-admitted
environment-owned leaves cannot enter `.tracker/settings.json`" — under D327 credentials and canary
inputs *do* enter the settings root, but under a **separate protected schema**, never inside the
`settings` object this hash covers (see §2, channel L3).

WHAT WOULD CHANGE THIS: a decision to keep protected values outside the settings root entirely.

---

### (c) D321's `settings.json` + `.authority.json`/`.prepare.json`/`.rollback.json`/`.lock` layout, and the "outlives its database" refusal

**VERDICT: PARTIAL CONFLICT, already adjudicated — D327 supersedes the LAYOUT and preserves the
COUPLING, verbatim in its own ledger row.** CONFIDENCE: high.

| evidence | path:line / § | note |
|---|---|---|
| "This supersedes D321's single `settings.json` plus sibling-file layout while preserving its state-root/database-journal coupling" | `docs/rebuild/reference/decisions.md:2001` (D327) | the ruling is explicit; no operator call needed on the layout |
| D321 primary text (settings authority moves into the state root; delete `.tracker` removes both halves; next `npm run dashboard` regenerates root + fresh DB + revision-1 baseline) | `clock-config-secrets.md:~600-615` (§4 Operational isolation) | this half **stays binding** and the design must restate it for a directory |
| the refusal the coupling produces | `src/server/settings-runtime.ts:26-31` — "the settings file outlived its authority database (both live in the state root) — restore the state root, or **remove settings.json and its .authority.json sidecar there**" | the message text is normative operator guidance and names files that will not exist after 1.6; it must be re-worded in the same change |
| path binding of every evidence record | `src/infra/config/settings-file.ts:424` `settingsPathFingerprint(path)`, enforced at `:660, :834, :876, :983, :1176, :1202, :1375, :1405-1408` | **hard migration constraint**: every prepare/rollback/authority/lock record is bound to the *exact* settings pathname. Moving the file invalidates all of them by design |
| sidecar/lock names as built | `settings-file.ts:577` `${settingsPath}.lock`; `:1104-1106` `.authority.json` / `.rollback.json` / `.prepare.json` | four siblings + reaper/twin hard-links (`:817-834, :983`) |
| directory protocol that survives unchanged | `settings-file.ts:441-510` (full-ancestry walk, `mkdirSync(mode 0o700)` at `:474`, group/world-write refusal at `:504-507`), file mode `0o600` at `:252-253, :347, :898` | the `.tracker/settings/` root inherits this protocol; the design should state it is reused, not re-invented |

**Design obligation the code forces:** the migration must define behaviour when a `.prepare.json`
or `.rollback.json` exists at upgrade time. `settings-file.ts` refuses reconciliation while
ambiguous evidence survives; a mover that ignores it either strands recovery evidence at a dead
pathname or discards a half-applied revision. Recommend: refuse the upgrade until the old authority
reconciles cleanly, and say so by name.

WHAT WOULD CHANGE THIS: nothing in scope — D327 already ruled.

---

### (d) The secure bootstrap's `.env` admission and the "secrets.ts is the only `process.env` credential reader" guard

**VERDICT: COMPATIBLE IN SHAPE, but D327's four source classes do not cover three keys that live in
`.env` today. That gap is an OPERATOR CALL, not mine.** CONFIDENCE: high on the inventory, low on
the intended classification.

| evidence | path:line | note |
|---|---|---|
| provider API keys stay in `.env` per D327 | `decisions.md:2001`; `clock-config-secrets.md` D327 bullet 3 | the bootstrap and both guards therefore survive |
| the five provider families | `src/domain/secrets.ts:150-155` — `geminiApiKeys`, `groqApiKeys`, `mistralApiKeys`, `openRouterApiKeys`, `sambaNovaApiKeys`, each `envPrefix` + `2..8` pool | this **is** "provider API keys" per D327; the five `OCR_*_MODELS` chain vars beside them are model ids, not keys (`clock-config-secrets.md:~880`) |
| credentials to migrate | `secrets.ts:145-146` `UCPATH_USER_ID` (`direct-identifier`), `UCPATH_PASSWORD` (`secret`) | D327 names "usernames, passwords" explicitly |
| **orphan 1** | `secrets.ts:148` `sharepointOnboardingRosterUrl` / `ONBOARDING_ROSTER_URL`, classification `secret` | not a credential, not a canary, not a provider key, not a host fact — unclassified by D327 |
| **orphan 2 + 3** | `secrets.ts:121-131` and `runtime-environment.ts:143-151` — `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY` (`secret`) and `..._KEY_GENERATION` (`non-secret-config`, channel `secret`) | D288's generation-bound pseudonym key; also outside D327's four classes |
| the guard as built | `tests/unit/architecture/secrets-single-source.test.ts:55,60-64,101` — `SECRET_OWNER = "src/domain/secrets.ts"`, `CONFIG_OWNER_PREFIX = "src/domain/config/"`, `ALLOWLIST = {}` | scout T4: `src/**` has real `process.env` reads in exactly one file (`secrets.ts`, 14); three other hits are comments (`login-contract.ts:152`, `runtime-environment.ts:433`, `host-display.ts:22`) |
| the one permitted WRITE | `secrets.ts:581-587` `hostAwareResolutionEnvironment` → `establishHostPrimaryDisplay` mutates `process.env` (`src/domain/config/host-display.ts:98-107`) | D324; survives |
| bootstrap admission | `scripts/secure-env-bootstrap.ts` + `secrets.ts:382` `admitLocalEnvironmentFile`; two-arm dynamic-import allowlist (`cli` \| D300 doc-number smoke) per `clock-config-secrets.md:~920` | shrinking `.env` to provider keys does **not** relax any of this |

**Guard change 1.6 owes:** `secrets-single-source.test.ts` keeps its shape but its
"config owner reading a `SECRET_SPECS` key is a violation" arm must be re-pointed once
`TIMEKEEPER_NAME` stops being a config binding (see (g)); `runtime-environment-coverage.test.ts`
must lose or retag every migrated key in `RUNTIME_ENVIRONMENT_EXACT`;
`evidence-receipt.test.ts:50,507,517` binds receipt field classification 1:1 to `SECRET_SPECS` and
must follow any spec that moves source.

OPERATOR CALL: which class `ONBOARDING_ROSTER_URL` and the two D288 pseudonym keys belong to.

---

### (e) D324's `HRAUTO_HOST_PRIMARY_DISPLAY` config-default channel

**VERDICT: NO CONFLICT. D324 is preserved verbatim by D327 and is structurally immune to removing
env precedence.** CONFIDENCE: high.

| evidence | path:line | note |
|---|---|---|
| D327 bullet 4: "host observations such as D324's probed primary display remain derived defaults, not persisted settings, unless the operator saves an explicit override" | `clock-config-secrets.md` D327 block | explicit preservation |
| the key is deliberately NOT a `CONFIG_ENV_BINDINGS` entry | `src/domain/runtime-environment.ts:246-254` — `channel: "config-default"`, `owner: src/domain/config/host-display.ts`, and `clock-config-secrets.md:~345` "deliberately without a `CONFIG_ENV_BINDINGS` entry, because an env-layer binding would let it outrank Settings" | removing the env layer does not touch it |
| editor "default" column resolves through the host key alone | `src/server/dashboard/queries/settings-editor.ts:112` `resolveConfigWithProvenance(hostPrimaryDisplayEnvironment(env), {}, clock)` | must keep working after migration |
| the contract fallback | `src/domain/config/schema.ts:128` `DEFAULT_DISPLAY` 2560×1440 | headless-only fallback, unchanged |

**Design must state:** a saved `display` override wins over a changed host (unchanged today —
settings layer sits above the default layer); the catalog records `display.*` as *editability:
editable, default kind: derived-host-fact*; and **no other leaf may use the `config-default`
channel**, or D327's "no shadow authority" rule is reopened through the back door.

WHAT WOULD CHANGE THIS: an operator asking for the host display to be persisted on probe.

---

### (f) D300's single document-number `.env` reference and `config/test-subjects.json`

**VERDICT: DIRECT CONFLICT ON LOCATION — D327 (2026-09-04) is later and names "local canary/test
inputs" as moving; D300's (2026-09-01) *semantics* stay binding. Separately, the code contradicts
D300's "only test-target secret" claim — ESCALATE.** CONFIDENCE: high on both halves.

| evidence | path:line / § | note |
|---|---|---|
| D300 row: "The single closed reference `separationsKualiFinalizationCanaryDocumentNumber` / `HRAUTO_TEST_SUBJECT_..._DOCUMENT_NUMBER` … **is the only test-target secret**" | `decisions.md:1760` | |
| the code registers **two** | `src/domain/secrets.ts:160-172` — `separationsKualiFinalizationCanaryDocumentNumber` AND `personLookupCanaryEid` / `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID`, both `direct-identifier`; schema union at `secrets.ts:101-107` | |
| the guard pins two | scout T1: `tests/unit/architecture/test-target-registry.test.ts:8,357` — "exactly TWO registered test-target secrets" | so this is committed, gated state, not drift |
| D327 moves the class | `decisions.md:2001` — "protected credentials, **local canary/test inputs**, provider API keys and derived host facts: operator-managed non-provider-key values move under `.tracker/settings/`" | |
| D300 semantics that survive | unset ⇒ `blocked` **by key**; malformed ⇒ registry defect **by key, never by value**; the committed registry holds only `document: { state: "configured", reference }` and nothing that resolves; no person value anywhere | `decisions.md:1760`; root `CLAUDE.md` 2026-08-28/09-01 lessons |
| the bootstrap arm that must change | `clock-config-secrets.md:~920` — the closed bootstrap accepts "only the CLI or D300 `test-target-document-number` smoke selector"; admission is `npm run smoke:test-target-document-number` | if the doc number leaves `.env`, this two-arm allowlist and that smoke's source both change — a named 1.6 seam |

WHAT WOULD CHANGE THIS: evidence that `personLookupCanaryEid` was ratified after D300 by a decision
I did not read (I checked D300/D321/D322/D324/D327/D330 rows only).

---

### (g) §4's immutable per-run config snapshot / fingerprint, and D330's claim token

**VERDICT: THE CENTRAL CONFLICT. A value the brief names as protected and write-only
(`timekeeper identity`) is TODAY a `ConfigSchema` leaf, persisted verbatim in an insert-only durable
row, hashed into `configFingerprint`, and copied into every authority backup. D327 governs; the leaf
must leave `ConfigSchema`, and the historical rows are unrepairable by construction.**
CONFIDENCE: high — every link in the chain is code.

| evidence | path:line | note |
|---|---|---|
| `TIMEKEEPER_NAME` → `operator.timekeeperName` | `src/domain/config/resolve.ts:101-105` | env binding |
| the same key is a registered secret | `src/domain/secrets.ts:147` — `{ name: "timekeeperName", env: "TIMEKEEPER_NAME", classification: "direct-identifier" }` | |
| the tree already calls it dual-channel | `src/domain/runtime-environment.ts:226` — `channel: key === "TIMEKEEPER_NAME" ? "config-and-secret" : "config"` | the one key with two owners — exactly the "duplicate fallback authority" D327 leaf 4 forbids |
| it is a `Config` leaf | `src/domain/config/schema.ts:229` — `operator: z.strictObject({ timekeeperName: z.string() }).default({ timekeeperName: "" })` | |
| the whole `Config` is persisted | `src/domain/config/snapshot.ts:15-22` (`config: StoredConfigSchema`); `src/infra/sqlite/migrations.ts:342` (`config_snapshots` json record table); `src/infra/sqlite/authority-database.ts:4803-4810` | insert-only |
| and hashed | `clock-config-secrets.md:~400` — "The fingerprint is a SHA-256 over `canonicalJsonStringify(config)` — the exact bytes" | so the value is in the fingerprint preimage |
| and never rewritten | `clock-config-secrets.md:~700-760` (§4.1, three reasons a migration is forbidden) | historical exposure is permanent |
| removal is itself gated | `clock-config-secrets.md:~770` — `auditConfigSnapshotGenerations` refuses "a registered leaf that has since VANISHED from the schema (a released generation is never rewritten)" | **removing** `operator.timekeeperName` fails `tests/unit/architecture/config-snapshot-generations.test.ts` today; 1.6 needs an explicit *retirement* arm in `src/domain/config/snapshot-generations.ts` |

**D330 claim token: NO CONFLICT.** `RuntimeConfigClaimTokenSchema` is
`(generation, settingsRevision, settingsFingerprint, configFingerprint)`
(`src/domain/config/runtime-generation.ts:29-34`) — four counters/hashes, no value. The design owns
their *provenance*: after migration `settingsRevision`/`settingsFingerprint` must cover the whole
catalog root (ordinary **and** protected), or a credential rotation would not force worker
reactivation. **Recommended rule for the design:** a protected leaf contributes a per-leaf salted
digest to the settings fingerprint, never its bytes — so rotation moves the fingerprint without
putting the secret in a hash preimage that a backup could carry.

WHAT WOULD CHANGE THIS: a ruling that the timekeeper name is an ordinary setting, not protected —
which contradicts doc 00 §0.3 Task 2 and the brief's leaf list.

---

### (h) `frontend-backend-integration` §4 — the D327 ownership cut

**VERDICT: NO CONFLICT. It is already the D327 statement and stays binding as written.**
CONFIDENCE: high.

| evidence | § | note |
|---|---|---|
| "**D327 planned ownership cut.** … The canonical settings catalog and protected `.tracker/settings/` repository own operator-managed local configuration; provider API keys remain the sole `.env` class and derived host facts remain defaults." | `docs/rebuild/reference/frontend-backend-integration.md:~965` (§4 State ownership) | |
| "The browser never reads files/tables or reconstructs either authority." | same block | binding constraint on the 3.1 Settings UI contract |
| the table row it narrows | same §4 table, row `run/worker/capture/intake/settings/archive state \| SQLite authority \| never mutated locally` | the design should cite, not restate |

Adjacent stale text worth a dated note only if touched: `dashboard-surfaces.md:751,755,793-804`
still describes `.tracker-rebuild/` as the rebuild state root — stale since D321 (also
`clock-config-secrets.md:730`, which is a *historical* database filename and is correctly stale).

---

## 2. LEAK SURFACES for a write-only protected value

Protected values in scope: SSO username, SSO password, timekeeper identity, canary document number
(and, pending §1(d), the roster URL and pseudonym HMAC key).

**Is a credential inside `ConfigSchema` today? YES — exactly one:
`operator.timekeeperName` (`src/domain/config/schema.ts:229`), a `direct-identifier` per
`src/domain/secrets.ts:147`.** No password, EID, API key or canary number is a `Config` leaf.
`paths.duoCredential` is a *path*, not a value (`schema.ts:126`).

| # | channel | today's behaviour (evidence) | what the design must state |
|---|---|---|---|
| L1 | **resolved `Config` object** | `resolveConfig(env, settings, clock)` (`resolve.ts:415-423`); carries `operator.timekeeperName` | No protected leaf may exist in `ConfigSchema`. Protected values are read at use through `secrets.ts`-shaped accessors backed by the protected store, never merged into `Config`. |
| L2 | **`configFingerprint`** | SHA-256 over `canonicalJsonStringify(config)` (`clock-config-secrets.md:~400`); today the timekeeper name is in the preimage | Once L1 holds, this is automatically clean. State it as a derived invariant, and add the settings-fingerprint rule from §1(g) (per-leaf digest, never bytes). |
| L3 | **the settings command journal — the worst one** | `SettingsCommandRequestSchema.payload = { settingsSchemaHash, patchFingerprint, **patch: EditableSettingsOverrideSchema** }` (`src/domain/commands.ts:198-205`); the command and its audit are durable, insert-only, and `settings-runtime.ts:117` compares `canonicalJsonStringify(audit.request)` byte-for-byte on every boot | **A protected value must NEVER be a member of the journaled patch.** Protected writes journal `(leafId, valueDigest, revision)` only; the journal-authentication comparison must be defined over that digest form, or the authentication protocol itself forces plaintext retention forever. |
| L4 | **the settings file `settings` object** | `SettingsFileRecordSchema.settings = EditableSettingsOverrideSchema`, whole record fingerprinted and read back into `resolveConfigWithProvenance` (`settings.ts:34-45`; `settings-runtime.ts:186`) | Protected values live in a **separate file** under the root with its own schema, own mode `0600`, own revision, and are never parsed into the resolver's settings input. |
| L5 | **`config_snapshots` durable rows** | full `config` persisted insert-only (`snapshot.ts:15-22`; `migrations.ts:342`; `authority-database.ts:4803-4810`), never rewritten (§4.1) | Follows from L1. **Also state the residue honestly:** existing rows retain the timekeeper name and cannot be repaired (§4.1's three reasons); the design records that as accepted historical exposure, not a migration task. |
| L6 | **provenance map** | `z.record(ConfigLeafPathSchema, ConfigProvenanceSchema)` — path → `"env"\|"settings"\|"default"` (`provenance.ts:6-9`); stored on the snapshot row (`snapshot.ts:22`) | Values never appear; **leaf paths do**. Safe today. If protected leaves ever gain provenance entries, the vocabulary needs a `protected` arm that carries presence only. |
| L7 | **`runtime_config` / `settings_current` rows** | denormalized columns are `generation`, `settings_revision`, `settings_fingerprint`, `config_snapshot_id`, `config_fingerprint`, `created_at` (`authority-database.ts:1352`; `settings-current.ts:10-17`) | Clean by construction; keep it that way — no protected leaf may be denormalized for query convenience. |
| L8 | **DCC3 editor readback wire** | `EditableSettingsWireSchema` serves per-leaf `effectiveValue`, `defaultValue`, optional `settingsValue`, `source`, `environmentVariable` name, `editable` for the **8** named leaves (`src/server/dashboard/queries/settings-editor.ts:114-131`; route `src/server/dashboard/routes/api.ts:380`) — none protected today | The protected class gets a **different wire arm**: `{ leafId, state: "set"\|"unset", revision, updatedAt }` and nothing else. Never `effectiveValue`, never `defaultValue`, never a `last4`, never a digest the browser can compare offline. |
| L9 | **settings *facts* wire** | `buildSettingsFacts` serves system hosts + workflow capabilities only (`src/server/dashboard/queries/settings.ts:74-104`; route `api.ts:377`) | Unchanged; state that the catalog does not widen it. |
| L10 | **bootstrap wire** | serves `settingsSchemaHash` (`src/server/dashboard/queries/bootstrap.ts:59,108`; composed at `src/server/dashboard/compose.ts:1223`) | A hash of the *schema*, not of values — safe. If the catalog splits into two schemas, decide which hash the bootstrap serves; serving the protected schema's hash is harmless, serving a protected *value* fingerprint is not. |
| L11 | **`cli storage backup` (D322)** | `AuthorityDatabase.onlineBackupTo` copies the whole authority DB — including `config_snapshots` and the settings command/audit rows (`src/infra/sqlite/backup-service.ts`; manifest carries `configFingerprint`/`configSnapshotId`, `src/infra/sqlite/recovery-contracts.ts:144-145`) | Because D327 *requires* a backup before upgrade, the backup will contain the pre-migration plaintext. State this explicitly and require the backup file to be `0600` under the existing writer hygiene (`clock-config-secrets.md` §6.1: `0700` dirs / `0600` backup files). Do not claim the migration erases history. |
| L12 | **storage doctor / preflight reports** | doctor emits `configFingerprint`/`configSnapshotId` only (`src/infra/sqlite/storage-doctor.ts:376-377`); preflight refusals are closed reason codes with at most a configured root's basename (root `CLAUDE.md` DCC2 lesson) | Unchanged; add "a protected leaf is reported by id and presence only". |
| L13 | **diagnostic bundles** | wire carries `configFingerprint` (hash) only (`src/server/dashboard/queries/diagnostic-bundle.ts:170`) | Unchanged; the catalog must not add a settings dump to the bundle. |
| L14 | **spans / logs / receipts / errors** | queued span carries `configFingerprint` + `configSnapshotId` (`src/server/dashboard/commands/run-queued-span.ts:41-42`); every config-side `throw` interpolates ids, leaf **path names**, or truncated hashes only (`snapshot.ts:35,43`; `resolve.ts:236,367,406`; `command-kernel.ts:1751-1752`; `authority-database.ts:4910,4976,4987`) — `no-secret-values-in-logs.test.ts` guards the family | Protected refusals name **leaf id + failure category** only; the existing `secrets.ts` pattern (`"${name} is missing from registered source environment UCPATH_PASSWORD"`) is the model — key, never value. |
| L15 | **XLSX exports** | scout found no config/settings reference in `src/server/dashboard/queries/activity-export.ts` | Not a channel; state that it must not become one. |
| L16 | **child-process environment** | `hostAwareResolutionEnvironment` **mutates `process.env`** in place (`secrets.ts:581-587` → `host-display.ts:98-107`); `configResolutionEnvironment(env)` returns `process.env` **itself** (`secrets.ts:569-571`); the worker supervisor spawns with no explicit `env:` (`src/server/dashboard/worker-supervisor.ts:345`), so children inherit the whole parent environment | Two rules: (i) once a value is protected it must **not** be re-published into `process.env` for a child — the file is the transport; (ii) the catalog resolver must be handed a **projection** of the declared catalog keys, not the raw `process.env` object. Today `resolve.ts` reads only declared keys, so this is latent, not live — but it is the mechanism by which a "migrated" leaf could keep a shadow env authority. |
| — | **Explorer** | Explorer's override document is workflow presentation/policy (root `CLAUDE.md` D283 lessons); no settings or credential path | Not a channel. State it. |

---

## 3. CLASSIFICATION JUDGMENT

Classes: (i) ordinary setting · (ii) protected credential · (iii) local canary/test input ·
(iv) provider API key · (v) derived host fact.

| key / group | class | deciding evidence |
|---|---|---|
| `TIMEKEEPER_NAME` → `operator.timekeeperName` | **(ii) protected credential** (as an identity, not a password) | dual-registered: `resolve.ts:102` **and** `secrets.ts:147` (`direct-identifier`); the tree already names it `config-and-secret` (`runtime-environment.ts:226`); doc 00 §0.3 Task 2 and the R02 brief list "timekeeper identity" among the values that move |
| `ANNUAL_DATES_END`, `KRONOS_DEFAULT_END_DATE`, `KRONOS_DEFAULT_START_DATE` | **(i) ordinary** — but a *group-valid* one | `resolve.ts:106-129`; group rule at `resolve.ts:367` (all three or throw); values are calendar dates, no classification in `secrets.ts`. The catalog must carry the cross-leaf invariant, or it is silently lost with the env layer |
| `HR_AUTOMATION_DUO_WEBAUTHN` → `features.duoWebAuthn` | **(i) ordinary** (boolean feature flag) | `resolve.ts:226`; `schema.ts:275`; no secret spec. *Not* the Duo credential |
| `DEBUG_SCREENSHOTS` → `features.debugScreenshots` | **(i) ordinary** | `resolve.ts:221`; `schema.ts:275` |
| the nine `HRAUTO_*_TEST_URL` | **(i) ordinary**, with a caveat | `resolve.ts:85-99`; they write only `urls.<system>.test.*`, and three of them are already in `EditableSettingsOverrideSchema` (`schema.ts:329-340`). Caveat: `clock-config-secrets.md:~365` ("no environment variable can move a production endpoint") is what makes §4's "production is the code default" structural — the catalog must preserve that as a *schema* property, not as a property of the env layer being removed |
| `HRAUTO_DEFAULT_WORKERS` → `concurrency.defaultWorkers` | **(i) ordinary**, already editable | `resolve.ts:206`; `schema.ts:349`; served leaf `settings-editor.ts:76-83` with a hazard string |
| the nine `OCR_*` (`resolve.ts:146-189`) | **(i) ordinary** | two of them (`pageConcurrency`, `maxValidationRetries`) are already editable (`schema.ts:344-347`) |
| the three `HRAUTO_HEALTH_MONITOR_*` | **(i) ordinary** | `resolve.ts:191-203` → `browserHealth` (`schema.ts:262`) |
| the two `HRAUTO_DAEMON_IDLE*` | **(i) ordinary** | `resolve.ts:211-217` → `daemon` (`schema.ts:273`) |
| the five `HRAUTO_CAPTURE_*` named in the doc | **none — they do not exist** | zero hits in `src`/`tests`/`config`; D294 retired capture and `snapshot.ts:30-36` refuses to mint the group. Doc-only ghost |
| `HRAUTO_NAVIGATION_RETRIES`, `HRAUTO_UKG_NAVIGATION_MS`, `HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS` | **(i) ordinary** | `resolve.ts:131-143` |
| Duo credential **path** (`paths.duoCredential`) | **(i) ordinary** (a path is configuration) | `schema.ts:126`; default derived in `src/domain/config/runtime-paths.ts:41-61` |
| Duo credential **file contents** | **(ii) protected**, but a *file secret*, not a settings leaf | `secrets.ts:158` (`source: "file"`, `credential-file`, 64 000-byte cap); `requireSecretFile` validates regular-file + `mode & 0o077 === 0`. **Recommendation: leave it a file secret** — moving bytes into the settings root would put a WebAuthn credential (whose signCount is mutated under a cross-process lock) inside a CAS-revisioned store. Flag as a design choice to state explicitly |
| `UCPATH_USER_ID` | **(ii) protected credential** | `secrets.ts:145`, `direct-identifier`; D327 names "usernames" |
| `UCPATH_PASSWORD` | **(ii) protected credential** | `secrets.ts:146`, `secret`; D327 names "passwords" |
| `ONBOARDING_ROSTER_URL` (`sharepointOnboardingRosterUrl`) | **UNRESOLVED** — reads as (ii) by classification, but it is a URL, not a credential | `secrets.ts:148` classification `secret`; `runtime-environment.ts:141` channel `secret`. D327's four non-ordinary classes do not fit it. **OPERATOR CALL** |
| `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY` | **UNRESOLVED** — a real secret, not a provider key | `secrets.ts:113-126`; `runtime-environment.ts:143-146`. Rotating it under an existing generation refuses a whole batch (D288), so its lifecycle is unlike an ordinary credential. **OPERATOR CALL** |
| `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION` | **UNRESOLVED** — classified `non-secret-config` on the `secret` channel | `runtime-environment.ts:147-151`. Reads as (i) ordinary but must move *with* its key or the pair splits across two authorities. **OPERATOR CALL** |
| `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` | **(iii) local canary/test input** | `secrets.ts:162-166`; D300 (`decisions.md:1760`) |
| `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID` | **(iii) local canary/test input — but its existence contradicts D300.** See §5 | `secrets.ts:168-172`; pinned by `tests/unit/architecture/test-target-registry.test.ts` |
| `GEMINI_API_KEY[2..8]`, `GROQ_API_KEY*`, `MISTRAL_API_KEY*`, `OPEN_ROUTER_API_KEY*`, `SAMBANOVA_API_KEY*` | **(iv) provider API keys** — exactly these five families, and nothing else | `secrets.ts:150-155`. This is the precise answer to "which exactly are provider API keys per D327" |
| `OCR_*_MODELS` (five) and the five legacy `OCR_*_MODEL` spellings | **(i) ordinary** (model ids are not secrets) — but they are read by `secrets.ts` because it owns the permission, not because they are secret | `clock-config-secrets.md:~880`; `runtime-environment.ts:262-269` channel `provider-model`. If they stay beside the keys in `.env`, say so; if they migrate, `providerModelChain` needs a new source |
| `HRAUTO_HOST_PRIMARY_DISPLAY` | **(v) derived host fact** | `runtime-environment.ts:246-254` channel `config-default`; D324 |
| `HRAUTO_DASHBOARD_LAUNCH_NONCE` | **UNRESOLVED — none of the five**; it is process-ownership evidence, not configuration | `runtime-environment.ts:238-244` channel `process-ownership`, owner `src/domain/dashboard-frontend-owner.ts`. Should be named as explicitly out of the catalog |
| the 11 `TEST_ONLY_ENVIRONMENT_KEYS` and 30+ `RETIRED_ENVIRONMENT_KEYS` | out of catalog | `runtime-environment.ts:164-188` |

**Unresolved count: 5** (`ONBOARDING_ROSTER_URL`, the two pseudonym keys, `personLookupCanaryEid`'s
standing vs D300, `HRAUTO_DASHBOARD_LAUNCH_NONCE`).

---

## 4. RESTART SCOPE

**VERDICT: today, *every* settings change is restart-scoped — there is no live-reload leaf and no
per-run re-read. Nothing lets a settings apply invalidate an in-flight claim, so D330's rule holds
as-built.** CONFIDENCE: high.

| finding | evidence | note |
|---|---|---|
| an applied settings command always returns `restartRequired: true` | `src/server/settings-runtime.ts:120` asserts `audit.result.restartRequired !== true` is a mismatch; root `CLAUDE.md` 2026-08-28 lesson: "An applied or exact replay result carries `restartRequired=true`" | so restart scope is currently **uniform**, not per-leaf |
| the runtime generation is activated only at dashboard boot | `clock-config-secrets.md:~505` "the snapshot is captured ONCE per dashboard process at boot (`src/server/dashboard/compose.ts:361-370`, `revision: 1`)"; activation row `runtime_config` (`src/domain/config/runtime-generation.ts:8-16`; `authority-database.ts:4956-4992`) | |
| the editor tells the operator so | `src/server/dashboard/queries/settings-editor.ts:36-37` — "Changes take effect after restart" on both `performance` and `paths` sections; `runtimeStatus` has a `restart-required` arm (`settings-runtime.ts:190-195`) | |
| **read per run from the snapshot** | run envelope retains `configFingerprint` + `configSnapshotId`; the executor reads the **retained** row by id and refuses if missing rather than re-resolving (`clock-config-secrets.md:~500`, `src/core/run-executor.ts:1150-1156`); session reuse identity is `(worker, system, resolvedInstance, configFingerprint)` (`src/core/worker-sessions.ts`) | this is the whole `Config` — so *every* leaf a run touches is snapshot-read, not live-read |
| **read live** | nothing. `resolve.ts` has no watcher; `settings-runtime.ts` re-reads only to serve the editor wire and compute `restart-required` | |
| **claim-time generation compare (as-built)** | `src/infra/sqlite/authority-database.ts:6029-6064` — inside one write transaction, `claimNext` compares the worker's `RuntimeConfigClaimToken` to the `runtime_config` `active` row (`"…is no longer dashboard-active; restart activation is required"`) and then to `settings_current` revision+fingerprint (`"dashboard runtime settings are stale…"`) | matches D330 §D330.6 step (1) |
| **the check is still optional** | `authority-database.ts:6032` — `if (request.runtimeConfig !== undefined) {…}` | D330 §D330.6: "The worker's runtime token is REQUIRED in full — there is no 'fields absent, skip the check' arm (as-built skips when absent; 1.6 closes it)". An owed 1.6 proof |
| **does anything invalidate an in-flight claim?** | **No.** A settings apply writes the settings file, `commands`, `command_audits` and the `settings_current` singleton in one transaction (`clock-config-secrets.md:~440`); it writes **no** `tasks` row. There is no requeue-on-settings path. Staleness is enforced only at the *next* `claimNext`, plus at planning/start/fan-out/worker-spawn doors (root `CLAUDE.md` 2026-08-28 lesson) | consistent with `dashboard-surfaces.md` §D330.4: "A generation advance never touches an in-flight claim … the run settles under the config snapshot its envelope retained, and only the NEXT `claimNext` refuses `runtime-stale`" |

**Design obligation:** the catalog's per-leaf `restart scope` column is *new information* — no leaf
has a narrower scope than "restart" today. If the design declares any leaf hot-reloadable, it must
also say how a run started before the change reads it, because the retained snapshot is what the
receipt and result name (D330.4). Safest: keep `restart` uniform for every leaf that reaches
`Config`, and give protected credentials their own scope (`next-acquisition`, since they are read at
login time through `secrets.ts`, not from the snapshot) — but that must be stated, not assumed.

---

## 5. ESCALATIONS — contradictions the supervisor must not resolve alone

**E1 — D300 vs the code: one canary secret or two?**
D300 (`decisions.md:1760`) says the Kuali document number "is the only test-target secret". The tree
registers two (`src/domain/secrets.ts:160-172`: `separationsKualiFinalizationCanaryDocumentNumber`
and `personLookupCanaryEid` / `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID`, both
`direct-identifier`), and a guard pins exactly two
(`tests/unit/architecture/test-target-registry.test.ts`). The brief's leaf 2 says "local canary
inputs" move to the protected root; the catalog cannot enumerate that class until membership is
settled. **Escalate:** is `personLookupCanaryEid` ratified (and D300's row stale), or is it drift?

**E2 — three `.env` values D327's four classes do not cover.**
`ONBOARDING_ROSTER_URL` (`secrets.ts:148`) and the D288 pair
`HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY` / `_KEY_GENERATION` (`secrets.ts:121-131`,
`runtime-environment.ts:143-151`) are not provider API keys, not usernames/passwords, not canary
inputs, and not host facts. D327 says "provider API keys **alone** remain in `.env`", which as
written forces them out without saying where to. **Escalate** rather than inventing a sixth class.

**E3 — the brief's leaf 3 ("never return protected values after write") versus the settings command
journal's authentication protocol.**
The journal stores the full `patch` (`src/domain/commands.ts:198-205`) and boot re-authentication
compares `canonicalJsonStringify(audit.request)` byte-for-byte (`settings-runtime.ts:117`). Making
protected values write-only therefore requires *changing the authentication protocol* for protected
writes, not just redacting a wire. That is a design decision with a durable-evidence consequence
(D321's coupling rule, D330's fingerprint provenance) and it is the supervisor's central seam — I
flag it so it is decided deliberately rather than discovered in 1.6. My recommendation, for the
record: journal `(leafId, valueDigest, revision)`; never the value; define the boot comparison over
that form.

---

## ALSO NOTED (one line each, unexplored)

- `clock-config-secrets.md:356` "38 bindings" and `:~232` "16 groups … `capture`" are both factually
  wrong against `resolve.ts` (33) and `schema.ts` (15, no `capture`) — fix in the same dated edit.
- `dashboard-surfaces.md:751,755,793-804` still call the rebuild state root `.tracker-rebuild/` —
  stale since D321; the brief says fix only if that section is touched.
- No architecture guard covers the settings file/precedence/CAS invariants at all — they are proven
  only by non-inventory unit tests, so `guard-manifest.test.ts` will not notice 1.6 changing them
  (scout T5). The design should name a new guard as an owed proof.
- `configResolutionEnvironment(env)` returns `process.env` itself (`secrets.ts:569-571`) — a latent
  shadow-authority channel worth closing when the catalog resolver is written.
- `snapshot-generations.ts` has no *retirement* arm; removing `operator.timekeeperName` from
  `ConfigSchema` fails `config-snapshot-generations.test.ts` as written.
