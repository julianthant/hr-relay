# Clock, Config & Secrets

**What this doc is.** The contract for the four runtime inputs every other doc depends on and none
of them owns: the TIME a run reads, the CONFIGURATION it resolves, the immutable per-run SNAPSHOT
that records which configuration governed it, and the CREDENTIALS it presents. Each has exactly ONE
source module in `src/`, each source is held by a registered guard, and the guards are why "one
source" is a property of the tree rather than a habit.

**Why it is foundation work.** Doc `01 §Phase summary` states the critical path in one sentence:
building on raw `new Date()` / `process.env` "would require re-threading later; the
`clock-single-source` and `secrets-single-source` guards must be green from the first `src` file."
They were, and they are — both allowlists are EMPTY.

**Two standing facts frame everything below.**

1. **Two repositories, one machine (D93/D88).** The legacy runtime and this one share no module
   graph, so importing, proxying or reading across is structurally impossible rather than merely
   banned. What a repository boundary does NOT separate is the HOST: both worlds resolve env vars,
   write state, bind ports, take process locks and open Chromium profiles on the same laptop. So
   distinct state/artifact roots, ports, process locks and browser SESSION namespaces stay a hard
   requirement, pinned as data in `config/runtime-isolation.json` and proved by
   `operational-isolation.test.ts` (§4).
2. **The rebuild is a loopback-only, single-operator tool (§6.1).** No accounts, roles, secret
   manager or remote access. That is a scope decision, not a licence — strict schemas, declared
   redaction, `0700`/`0600` file modes and no secret-bearing URLs are base requirements precisely
   because the tool drives live HR systems from one desk.

**Section map.** §1 the legacy baseline this replaces · §2 the Clock · §3 the config resolver ·
§4 the per-run snapshot and instance selection, §4.1 its generation line · §5 fiscal-year dates ·
§6 the secrets accessor, §6.1 scope, §6.2 the environment doctor · §7 the rot vectors and what
holds each · §8 a worked example · §9 the settled questions.

## 0. Ownership header (D1)

| Concept | Owner |
|---|---|
| The Clock — sole time-read site, freshness `now`, trace-id time-of-day, span/ledger timestamps | **This doc** |
| Config resolver — env > settings.json > default precedence, typed schema | **This doc** |
| Immutable per-run config/instance resolution + snapshot | **This doc** (fields live on ref workflow-model's `RunEnvelope`) |
| Fiscal-year date source + rollover fail-loud | **This doc** |
| Secrets accessor (`.env` / `.auth` / Duo credential) | **This doc** |
| Local-only network boundary and secret/PII redaction classification | **This doc** |
| Operational isolation between the two runtimes on one machine (D88/D216/D247) | **This doc** §4; the guard is ref guards-and-tests' |

Imports (never redefines): ref task-contract `CommitTaskContract.writeSafety`; ref workflow-model
`RunEnvelope`, field provenance, and the declared-DAG freshness walk — this doc supplies the
clock/config snapshot; ref dashboard-surfaces' span/event wire schema (`ts: string` on `Base` — this
doc supplies the value); ref execution-and-sessions' timeouts/backpressure knobs (they narrow this
doc's config, they do not re-declare precedence); ref write-safety's ledger
(`write.attempting`/`write.committed` timestamps — this doc's Clock, ref write-safety's events); ref
operator-trust's evidence/diagnostic bundles consume this doc's redaction classifications.

---

## 1. Grounding — what exists today, why it hurts

**Every figure and path in this section is the LEGACY repository's, measured 2026-07-18 for doc 08's
gap audit** (`legacy:src/…`, per the D94 path convention §4 restates). It is kept because it is the
baseline each design below was chosen against, and because a rebuild claim like "one resolver" only
means something beside the thing it replaced. Nothing here describes this repository.

- **No central clock.** `grep -c "new Date(" src` = 238, `grep -c "Date\.now(" src` = 207 → **445
  direct wall-clock reads**, zero abstraction, confirmed against the gap audit's figure. The one
  disciplined pattern, `buildTraceId({ at })` (`legacy:src/tracker/queue-trace-id.ts:76-82`), takes
  `at` as a parameter specifically to stay pure and testable — but every production caller defeats
  it with `at: new Date()` inline (`tracked-workflow.ts:229`, `run-one-item.ts:441`,
  `ocr/orchestrator.ts:404`). `todayLocal()`-shaped date-partition formatting is duplicated ad hoc
  in ≥4 places (`jsonl-core.ts:31`, `deletions/store.ts:13`). Injectability is scattered private
  `now?: () => number` params (`duo-webauthn.ts:580`, `identity.ts:154`) — each hand-rolled, none
  shared. **→ §2.**
- **Config is a real single-source with re-implemented precedence.** `legacy:src/config.ts` +
  `domain/settings/types.ts` + `tracker/settings/store.ts` already do `env > settings.json >
  default` correctly (verified reading `config.ts` in full) — but the precedence expression
  (`process.env.X ?? SETTINGS.y.z`) is written out at **every individual read site**
  (`KUALI_SPACE_URL`, `ANNUAL_DATES.jobEndDate`, `getTimekeeperName`, …: 8 separate call sites in
  `config.ts` alone), and the code-default literal is duplicated between `config.ts` and
  `DEFAULT_OPERATOR_SETTINGS` (`types.ts:229-273`) with a hand-maintained comment as the only thing
  keeping them in sync. Several knobs escape the settings schema entirely (`I9_APP_URL`,
  `CRM_SECTION_URLS`). **URL overrides are process-global** — `SETTINGS.urls.*` applies to every run
  in the process; there is no way to send one run at a test instance while another concurrently hits
  production. **→ §3 for the precedence, §4 for the per-run instance.**
- **Secrets: one good choke, leaky edges.** `validateEnv()` (`legacy:src/utils/env.ts:33-49`) is a
  clean, batch, fail-loud gate for the two UCPath SSO vars — but `HRAUTO_DASHBOARD_LAN_PASSWORD`,
  the `.auth/duo-webauthn.json` private-key file (`DUO_WEBAUTHN_CREDENTIAL_PATH`,
  `infra/auth/duo-webauthn.ts:37`), and ~20 files reading `process.env.*` inline sit outside it.
  `getTimekeeperName()` (`config.ts:119-123`) is a second, independent throw-loud pattern — correct
  in isolation, but a second place, not the one place. **→ §6.**
- **Fiscal dates are static, mirrored, and already stale.** `ANNUAL_DATES.jobEndDate` defaults to
  `"06/30/2026"` (`config.ts:109-113`, mirrored in `types.ts:232`) — the audit ran on 2026-07-18.
  The value was already past and nothing detected or flagged it; the next run that consumed it
  silently filled a date that had lapsed. **→ §5.**

## 2. The Clock

<!-- roadmap: p1-base -->
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-base -->
- [x] `src/domain/clock.ts` is the sole time source and the sole permitted site of `new Date()` / `Date.now()` / `performance.now()` — 66 lines, `systemClock` frozen at module load, reached by 71 modules under `src/`
- [x] `clock-single-source` is an AST walk with an EMPTY allowlist, so new `src` code has zero tolerance and an alias, a destructure, a `globalThis.` hop or a `node:perf_hooks` import cannot slip past a grep (`tests/unit/architecture/clock-single-source.test.ts`)
- [x] `manual-clock-test-only` bans the IDENTIFIER `manualClock` anywhere in `src/**` but `clock.ts` — import, call, re-export and dynamic property access all fail
- [x] one resolver implements `env > settings.json > default` exactly once, with per-leaf provenance and a canonical fingerprint (§3; `src/domain/config/resolve.ts`)
- [x] one secrets accessor covers environment secrets, registered key FAMILIES, the local ngrok source and the Duo credential file; `secrets-single-source` and `no-secret-values-in-logs` both carry EMPTY allowlists (§6)
- [x] closed per-system route schemas, explicit prod/test instance refusal, current-fiscal-year validation, the runtime environment/dependency registries and the strict preflight report schemas are all implemented and bidirectionally audited (§3 · §4 · §5 · §6.2)
- [ ] the `settings.json` layer of the precedence has NO producer — both composition roots call `resolveConfigWithProvenance(env, {}, clock)`, so nothing in `src/` reads a settings file (§3)
- [ ] `SettingsOverrideSchema.browser` is accepted and then dropped by `mergeSettings` (§3) — a settings-supplied `browser.headless` is silently ignored
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/clock.ts`, `src/domain/config/{resolve,schema,runtime-paths,fiscal-year,instance}.ts`, `src/domain/secrets.ts` and the four guards; left: the settings producer and the dropped `browser` group, both named in §3
<!-- /roadmap-status -->

**One injectable interface is the sole permitted site of `new Date()` / `Date.now()` /
`performance.now()` in `src/`.** Every timestamp the system produces — span `ts`, checkpoint fact
`observedAt`/`correctedAt`, trace-id time-of-day, write-safety ledger events, fiscal-year lookups —
reads through it.

```ts
// src/domain/clock.ts — the ONLY file in this repository allowed to read the host clock
export interface Clock {
  now(): Date;
  nowMs(): number;
  /** Process-monotonic milliseconds for elapsed budgets/durations; never serialized as an instant. */
  monotonicMs(): number;
  /** Local calendar day, YYYY-MM-DD — tracker partitioning, one impl. */
  todayLocal(): string;
  /** HHMMSS local time-of-day — feeds buildTraceId(at). */
  timeOfDayCode(at?: Date): string;
  /** UC fiscal year containing `at`: Jul 1–Jun 30, NAMED by its ending calendar year. */
  fiscalYear(at?: Date): number;
}

export interface TestClock extends Clock {
  advanceWall(ms: number): void;
  advanceMonotonic(ms: number): void;
  setWall(at: Date): void;
}

export const systemClock: Clock = Object.freeze({ /* new Date() / Date.now() / performance.now() */ });
export function manualClock(at: Date, initialMonotonicMs = 0): TestClock { /* … */ }
```

Three shape choices are load-bearing. `systemClock` is **frozen at module load**, so a test cannot
monkey-patch the production clock in place and leave it patched for the next file. `TestClock`
advances wall and monotonic time **independently**, which is what makes skew and elapsed-budget
behaviour testable without sleeping. And `localDatePart` / `formatTraceTimestamp` are exported pure
functions taking a `Date`, so the two implementations (`systemClock` and `manualClock`) share one
formatter rather than agreeing by coincidence.

**Composition with the other contracts (nothing else changes shape — only the `now` input):**

- **Ref workflow-model's freshness walk.** `now − fact.observedAt > fieldLimit` reads `clock.now()`,
  so a `manualClock` test can assert the exact boundary (`maxAgeMs` exactly exceeded vs. not).
- **Ref dashboard-surfaces' spans.** The executor holds ONE `Clock`; every `SpanEvent.ts` is
  `clock.now().toISOString()`, stamped once at emission and never re-derived.
- **Trace ids.** `buildTraceId({ code, runId, at: clock.now() })` — the builder was already pure, so
  only the caller changed.
- **Ref write-safety's ledger.** `write.attempting` / `write.committed` timestamps and the
  crash-window fence read the same executor-held instance, so a fence and its span are never
  timestamped by two different reads.
- **Prewrite age.** `probeToFenceMaxMs` compares `clock.monotonicMs()` at probe completion against
  the value immediately before the fence, so a wall-clock correction cannot make an over-age probe
  look fresh.
- **Checkpoint provenance.** Live observations and operator corrections both stamp through the
  Clock; a correction does not replace the original observation time.
- **The negative-settlement decision is fully deterministic under the injected Clock** (Phase 1c
  Stage D, 2026-08-01). `evaluateNegativeSettlement` stamps `decidedAt` from `clock.now()`
  (`src/domain/write-safety.ts:203-207`), the post-fence propagation boundary is
  `Date.parse(fencedAt) + policy.minSinceFenceMs` (line 252), and the read-spacing and
  future-observation rules are arithmetic over stored instants. No wall-clock read and no sleeping
  test appears anywhere on that path, and the authority adapter's transaction metadata uses its own
  injected Clock while accepting already schema-validated external confirmation instants.

**The two guards** (both registered in `docs/rebuild/guard-inventory.json`, owner this doc):

`clock-single-source.test.ts` is a **TypeScript AST walk, not a grep**, and its allowlist is
**empty**. It scans every git-visible `src/**` source file except `src/domain/clock.ts` and reports
`file:line:column` for a call or construction that reaches the host clock through ANY spelling it
can resolve: `new Date()`, `Date.now()`, `performance.now()`, `process.hrtime()` /
`process.hrtime.bigint()`, the same through `globalThis.`, through a namespace or named import of
`node:perf_hooks` / `node:process`, through an alias (`const D = globalThis.Date`), and through a
destructure (`const { now } = Date`). Aliases are resolved to a fixed point per scope, and a
binding that a local declaration, function parameter or import SHADOWS is cleared — so
`function f(Date: { now(): number })` is not a violation. Two negative controls run against
synthetic sources through the same exported function: a fixture spelling eight distinct forms must
report exactly 8, and a shadowing/comment fixture must report 0.

What the guard deliberately does NOT ban is a **deterministic** `Date`: `new Date("2026-01-01…")`
and `Date.parse(storedInstant)` convert a value that already exists rather than reading the host,
and banning them would push callers toward re-deriving instants by hand. The rule is about the
SOURCE of time, not about the `Date` type.

`manual-clock-test-only.test.ts` bans the **identifier** `manualClock` anywhere under `src/**`
except `clock.ts` — an import, a call, a re-export and a dynamic `module["manualClock"]` all fail,
while the same characters inside a comment or a string do not. A `manualClock` reference in
production code is the symptom of a test double wired into a real executor, where every trace id,
span and freshness check would be wrong in the same way, all at once, with no crash.

## 3. Config resolver

<!-- roadmap: p1-base -->
<!-- roadmap: p1-spine -->
<!-- roadmap: def-settings -->
<!-- roadmap: cross-cutting -->

<!-- roadmap-status: p1-spine -->
- [x] a path default is a RUNTIME value, so it cannot live in the browser-reachable contract — `ConfigPathsSchema`'s nine leaves are REQUIRED with no `.default()`, and the server-only `src/domain/config/runtime-paths.ts` supplies them (D121, 2026-08-04)
- [x] the memoized absolute profile root and the `duoCredential` path derived from it live in `runtime-paths.ts:41-61`, parsed through `ConfigPathsSchema` rather than asserted — a default that failed to resolve absolute fails at its source
- [x] `src/domain/config/resolve.ts:348` is the only caller, and the general rule + its walker live in ref frontend-backend-integration §8.13 (`dashboard-wire-boundary`)
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/config/schema.ts:105-131,212-214` and `runtime-paths.ts`; the D121 as-built block folded into this section, and the claim that `schema.ts` resolves the isolation root was corrected — it is `runtime-paths.ts` that does
<!-- /roadmap-status -->

<!-- roadmap-status: def-settings -->
- [x] the resolver's SETTINGS layer is fully contracted — `SettingsOverrideSchema` (`src/domain/config/schema.ts:316-357`), the per-group merge (`resolve.ts:291-320`) and a `"settings"` provenance value every leaf can carry
- [x] `apply-settings` is schema-recognized and refused: the kernel answers `rejected{code:"capability-unavailable"}` with no journal row, no audit row and no generation advance (`src/core/command-kernel.ts:143,2467-2477`), and Settings serves ONE section, `storage`, read-only (D169/D184)
- [ ] BE nothing in `src/` reads a settings FILE — both composition roots pass a literal `{}` (`src/server/dashboard/compose.ts:343`, `src/server/worker/compose.ts:344`), so the settings layer has no producer and `config/settings.json` does not exist in this repository
- [ ] BE `mergeSettings` never applies `override.browser`, so a settings-supplied `browser.headless` / `browser.closeProofMs` parses and is then dropped — the one group the merge forgets
- [ ] BE `apply-settings` stops answering `capability-unavailable`; the family, its `expectedRevision` target and its atomic `{settingsSchemaHash, patchFingerprint, patch}` payload are already contracted (`src/domain/commands.ts:186-197`)
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/config/{schema,resolve}.ts`, `src/domain/commands.ts`, `src/core/command-kernel.ts` and both composition roots; left: the settings producer, the dropped `browser` group, and the write path 04 §Edit settings in the dashboard tracks
<!-- /roadmap-status -->

**One resolver implements `env > settings.json > default` exactly once**
(`src/domain/config/resolve.ts`). No read site repeats the precedence, and the defaults live in
exactly one place — the zod schema's `.default()`s — so the legacy duplication between `config.ts`
and `DEFAULT_OPERATOR_SETTINGS` (§1) cannot recur by construction.

### The schema is closed, per system and per group

`src/domain/config/schema.ts` is a `z.strictObject` of 16 groups: `actor`, `urls`, `timeouts`,
`paths`, `annualDates`, `operator`, `display`, `performance`, `ocr`, `capture`, `browserHealth`,
`browser`, `concurrency`, `daemon`, `features`, `providers`. Every group but `paths` carries a
complete `.default(...)`; `paths` is required (see D121 below).

```ts
// each system owns an equally CLOSED route object — adding a route is a schema change,
// misspelling one is an unknown-key error, and there is no open Record<string, url> anywhere
function endpoints<Shape extends z.ZodRawShape>(routes: z.ZodObject<Shape>) {
  return z.strictObject({ prod: routes, test: routes.partial().optional() });
}
```

The route sets are exhaustive over ref task-contract's `BrowserSystemId` and are exactly what the
drivers navigate, not a sample: `kuali`/`newKronos`/`onbase`/`oldKronos`/`servicenow`/`sharepoint`
declare `entry`; `i9` declares `entry` + `app`; `crm` declares `entry`, `onboardingSearch`,
`ucPathEntrySheet`, `onboardingHistory`, `idocsViewer`; `ucpath` declares `login`, `smartHr`,
`jobSummary`, `personalData`, `personProfile`. `CONFIG_ROUTE_SCHEMAS` / `CONFIG_ROUTE_KEYS` expose
the same set as data so D68's coverage audit can check it both ways. Naming follows the domain ids
one-for-one (`old-kronos` → `oldKronos`; never a parallel `ukg` key).

**`test` is a PARTIAL of the production route object, and optional.** That is deliberate: a sandbox
usually exposes one or two of a system's routes, so demanding a complete mirror would make the test
map unusable and push someone to copy production URLs into it — which is exactly the state §4's
instance check refuses to run against. It also means `test` is a genuinely sparse override, never a
second production map.

`timeouts` carries the D125 leaf `sessionAcquireMs` (60 000 ms) beside `navigationMs` (15 000),
`longNavigationMs` (30 000), `ukgNavigationMs` (60 000), `taskMs` (180 000), `transactionMs`
(300 000), `duoApprovalSeconds` (180), `duoApprovalCrmSeconds` (60) and `retryDelayMs` (5 000).
`sessionAcquireMs` bounds ONE acquisition — launching or attaching the context plus that system's
login recipe — and exists because `taskMs` must stay generous for the real read while a login is a
CHAIN of individually-bounded steps that nothing bounded: a dead CRM session on the live exit run
burned 262.9 s inside `withDriver` before anything noticed. 60 s is more than 3× the live-verified
~17 s (UCPath) / ~12 s (CRM) logins. The leaf's own comment records the one deployment that must
raise it — a hands-on Duo approval, where the inner `duoApprovalSeconds` wait would otherwise
outlive its envelope; ref execution-and-sessions owns that interaction.

`providers` is `ProviderBudgetConfigSchema` over the four registered capabilities (`ocr.extract`,
`geocode.census`, `geocode.nominatim`, `ai.advisory`), each with `timeoutMs`, `concurrency`,
`requestsPerMinute`, `dailyRequestLimit` and `costLimitUsdMicros`. **Provider budget windows are
fixed UTC calendar windows (D119)**, never a worker-relative rolling approximation:
`requestsPerMinute` resets at the next UTC minute, `dailyRequestLimit` and `costLimitUsdMicros` at
the next UTC day. `costLimitUsdMicros: 0` is a hard zero-cost cap — only a request whose adapter
supplies a conservative maximum estimate of exactly zero may be admitted — and never means
unlimited. Counters are shared globally by capability across config fingerprints, while each
admission decision retains and applies the exact immutable run snapshot's budget.

### A path default is a runtime value, not a contract value (D121, 2026-08-04)

`src/domain/commands.ts` imports `SettingsOverrideSchema` from `schema.ts`, and the dashboard bundle
imports commands — so `schema.ts` is evaluated **in the browser**. Its `node:path`-derived defaults
made that fatal: Vite's dev server replaces an externalized built-in with a proxy that throws on the
first property read, so the named-import **binding alone** killed the bundle at module-evaluation
time, before any default could be materialized. Making the defaults lazy was therefore not
sufficient — the import itself had to go.

The precedence did not change; the split is on WHERE a default comes from:

- `schema.ts` stays a pure, browser-reachable contract. `ConfigPathsSchema`'s nine leaves —
  `reportsDir`, `downloadsDir`, `onboardingDocsDir`, `i9CheckTrackerPath`, `stateRoot`,
  `artifactRoot`, `browserProfileRoot`, `duoCredential`, `duoExtensionDir` — are `AbsolutePathSchema`
  and **REQUIRED**, so a caller that omits `paths` gets a loud zod error naming the exact leaf.
- `src/domain/config/runtime-paths.ts` is server-only and owns those defaults. It resolves each
  against the process working directory, memoizes the profile root (which `duoCredential` is
  `join`ed onto), and **parses** the result through `ConfigPathsSchema` — a default that failed to
  resolve absolute fails loud at its source rather than downstream. `resolve.ts:348` is its only
  caller.
- A repo-relative literal is never a runtime path. A worker or daemon started from another working
  directory would otherwise resolve a different, empty profile root and silently re-authenticate,
  or write a second credential home.

**A browser stub, bundler alias, or polyfill for `node:path` is explicitly rejected.** A stubbed
`resolve()` invents a plausible-but-wrong absolute path, which would point Duo credential reads and
artifact writes at the wrong location — the silent-wrong-value failure this program exists to
prevent. The browser is not entitled to a filesystem default; it is entitled to a loud error. The
general rule and its walker are ref frontend-backend-integration §8.13's.

### The environment layer is a validated binding registry, not a path→name map

```ts
// src/domain/config/resolve.ts — one declarative table replaces every scattered `process.env.X ?? …`
export const ConfigEnvBindingSchema = z.strictObject({
  env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  path: ConfigLeafPathSchema,
  /** applies the raw string to a config, parsing it — the binding owns its own coercion */
  apply: z.custom<(config: Config, raw: string, fiscalYear: string) => Config>(…),
});
export const CONFIG_ENV_BINDINGS = deepFreeze(ConfigEnvBindingRegistrySchema.parse([ … ]));
```

A binding carries its own **apply** function rather than a type tag, so `HRAUTO_DEFAULT_WORKERS`
parses through a positive-integer text schema, `DEBUG_SCREENSHOTS` through a `"0"|"1"` flag, and a
URL through `z.url()` — a malformed value throws at resolve time naming the leaf, and there is no
generic coercion to be wrong in one place for everything. The registry's `superRefine` requires
`env` names AND `path`s to be unique, so a copy-pasted binding cannot shadow the leaf it was cloned
from.

**38 bindings are registered today.** Eight are per-system test-entry overrides
(`HRAUTO_KUALI_TEST_URL`, `HRAUTO_NEW_KRONOS_TEST_URL`, `HRAUTO_CRM_TEST_URL`,
`HRAUTO_ONBASE_TEST_URL`, `HRAUTO_I9_TEST_URL`, `HRAUTO_OLD_KRONOS_TEST_URL`,
`HRAUTO_SERVICENOW_TEST_URL`, `HRAUTO_SHAREPOINT_TEST_URL`), a ninth is `HRAUTO_UCPATH_TEST_URL` →
`urls.ucpath.test.smartHr` (UCPath's task route, not its login portal). The rest are
`TIMEKEEPER_NAME`, the three `annualDates` variables, `HRAUTO_NAVIGATION_RETRIES`,
`HRAUTO_UKG_NAVIGATION_MS`, `HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS`, nine `OCR_*`, five
`HRAUTO_CAPTURE_*`, three `HRAUTO_HEALTH_MONITOR_*`, `HRAUTO_DEFAULT_WORKERS`, two
`HRAUTO_DAEMON_IDLE*`, `DEBUG_SCREENSHOTS` and `HR_AUTOMATION_DUO_WEBAUTHN`. **Every binding writes
into `urls.<system>.test` or into a non-URL leaf — no environment variable can move a production
endpoint**, which is what makes §4's "production is the code default" true rather than customary.

The three annual-date variables are treated as a GROUP. If any of them is set while the current
fiscal year has no configured entry, all three must be set or resolution throws
`environment overrides for FY<n> are incomplete` — a half-configured year would otherwise produce an
entry that passes the schema and lies about two of its three dates. Each value re-parses through
`UsDateSchema`.

An environment value is **trimmed, and an empty string is UNSET**. That is the honest reading of a
`.env` line someone commented out by deleting its value, and it means `KEY=` cannot blank a
configured default by accident.

### Resolution, provenance, and the fingerprint

```ts
export function resolveConfig(env: NodeJS.ProcessEnv, settingsInput: unknown, clock?: Clock): Config;
export function resolveConfigWithProvenance(env, settingsInput, clock?): ResolvedConfig;

export const ResolvedConfigSchema = z.strictObject({
  config: ConfigSchema,
  /** Provenance is explanatory metadata, never runtime decision input. */
  provenance: z.record(ConfigLeafPathSchema, ConfigProvenanceSchema), // "env" | "settings" | "default"
  fingerprint: FingerprintSchema,                                     // sha256 over canonical config bytes
});
```

The `clock` parameter is not decoration: the annual-date bindings are keyed by the CURRENT fiscal
year, so resolution needs a time source, and taking it as a parameter (defaulting to `systemClock`)
keeps §2's single-source rule intact and makes the whole resolver testable at a fixed date.

Three properties are enforced rather than intended:

- **"Empty settings = the defaults", structurally.** `ConfigSchema.parse({ paths: … })` fills every
  other leaf from its own `.default()`, so `resolveConfig(env, {})` reproduces the schema defaults
  by construction. There is no second literal to drift.
- **Provenance is bidirectionally complete.** It is computed over every POPULATED leaf of the
  resolved config, and the resolver throws `config provenance is not bidirectionally complete` if
  the two key sets differ — a leaf with no provenance entry, or an entry naming a leaf that is not
  there, is a resolver bug rather than a rendering gap. This is also what §4.1's generation line
  measures, since a populated leaf is exactly what a stored snapshot contains.
- **The fingerprint is a SHA-256 over `canonicalJsonStringify(config)`** — the exact bytes, so §4's
  reuse identity and §4.1's snapshot binding hash the same thing the row stores.

Consumers **narrow, they never redeclare**: a store selects `resolveSystemEntryUrl(config, system,
instance, context)` (§4) rather than writing its own `env > settings > default` expression. That is
what closes §1's "precedence re-implemented per read site".

### What the settings layer does not yet have: a producer

`SettingsOverrideSchema` is real and complete — a sparse partial of every group, with `urls`
narrowed so an override can reach `test` and **never** `prod` — and `mergeSettings` applies it group
by group. But **no module in `src/` reads a settings file.** Both composition roots call
`resolveConfigWithProvenance(env, {}, clock)` with a literal empty object
(`src/server/dashboard/compose.ts:343`, `src/server/worker/compose.ts:344`), there is no
`config/settings.json` in this repository, and the `"settings"` provenance value is therefore
reachable only from a test. That is the resolver-side face of the `apply-settings` deferral: the
command family is schema-recognized and the kernel answers
`rejected{code:"capability-unavailable"}` with zero authority side effects
(`src/core/command-kernel.ts:143`), Settings serves one read-only `storage` section, and 04 §Edit
settings in the dashboard owns closing it. Whoever builds the write path builds the READ path in the
same change, or the operator's saved value will round-trip through a file nothing loads.

**One group is worse than absent, and it is a defect rather than a deferral.** `mergeSettings`
enumerates its groups explicitly and omits `browser`, so a settings override carrying
`browser.headless` or `browser.closeProofMs` parses cleanly, contributes nothing, and reports
`default` provenance. Nothing fails; the value simply disappears. It is invisible today only because
the layer has no producer — which is exactly the condition under which the bug would ship.

## 4. Immutable per-run config and instance snapshot — required in Phase 1

<!-- roadmap: p1-base -->
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] `src/domain/config/snapshot.ts` is the immutable durable snapshot: strict id/revision/fingerprint/`capturedAt`/`capturedBy`, the complete already-resolved non-secret `Config`, and the per-leaf provenance map from the one resolver (Phase 1c Stage A, 2026-07-31)
- [x] `ConfigSnapshotWriteSchema` refuses to MINT a row missing any current-generation leaf, so §4.1's read tolerance never becomes a licence to persist a hole
- [x] the envelope retains `configFingerprint` + `configSnapshotId`, and the executor reads the RETAINED row back by id — a missing row refuses the node rather than re-resolving current config (`src/core/run-executor.ts:1150-1156`)
- [x] D116 reuse identity `(worker, system, resolvedInstance, configFingerprint)`, bound for the claimed run's window by `withBoundRunConfigFingerprint` (`src/core/worker-sessions.ts`), with the fingerprint in the on-disk profile path too
- [x] the isolation contract is DATA (`config/runtime-isolation.json` v3) reaching the runtime through one exported direct-`const` `defineRuntimeIsolation` call, audited on both real checkouts by `operational-isolation.test.ts` (D88/D216/D247)
- [ ] the snapshot is captured ONCE per dashboard process at boot (`src/server/dashboard/compose.ts:361-370`, `revision: 1`), not per enqueue — every run started by one process shares one row, and the worker process resolves its own config and inserts nothing
- [ ] `src/domain/config/instance.ts`'s `resolveInstances` — the arm that proves a requested TEST endpoint EXISTS before the run is queued — has no production caller; enqueue uses `src/services/start/plan.ts:83-95`, which defaults every declared system to `prod` and refuses an undeclared one but performs no URL check, so a `test` request with no distinct test URL is refused at session acquisition instead
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/config/{snapshot,instance}.ts`, `src/services/start/plan.ts`, `src/core/run-executor.ts`, `src/server/{dashboard,worker}/compose.ts`, `config/runtime-isolation.json` and `tests/unit/architecture/operational-isolation.test.ts`; left: the two as-built gaps above
<!-- /roadmap-status -->

Every run and ledger entry must say which environment and configuration actually governed it. The
request may omit instance preferences (meaning production), but a run is always stamped with a
complete snapshot identity, and runtime tasks never re-read mutable process settings mid-run.

```ts
// amends ref workflow-model's RunEnvelope — ref workflow-model remains the OWNER of the envelope's
// shape; these fields are specified HERE because instance selection is this doc's concept (D1),
// the same pattern as dryRun (D6) living on the envelope and being specified in ref workflow-model.
interface RunEnvelope {
  // … runId, workflow, itemId, traceId, parent, shape, dryRun, startAt, injected,
  //    freshnessOverride, retryOf, attempt, enqueuedAt (ref workflow-model, unchanged) …
  /** ABSENT (the default) means every system this run touches resolves to PRODUCTION. */
  requestedInstance?: InstanceSelection;
  /** Exactly the descriptor-derived browser systems this run touches; no extras, no omissions. */
  resolvedInstance: InstanceSelection;
  configFingerprint: Fingerprint;
  configSnapshotId: ConfigSnapshotId;
}
```

`InstanceSelection` is a `z.strictObject` with one optional `"prod" | "test"` leaf per
`BrowserSystemId` (`ucpath`, `crm`, `onbase`, `kuali`, `servicenow`, `i9`, `new-kronos`,
`old-kronos`, `sharepoint`) — the domain's kebab-case ids, not the config's camel-case route keys.

- **Loud default, never silent.** Omitting `requestedInstance` resolves every declared system to
  production. There is no implicit "test" state to fall into by omission, and an instance requested
  for a system the workflow never reaches is refused by name at plan time
  (`<workflow> never reaches <system>; it cannot resolve an instance for it`).
- **Production is the code default, not a settings value.** `resolveSystemEntryUrl(config, system,
  instance, context)` returns the production literal for `prod` and cannot be redirected by a
  settings edit, because §3's override schema can only reach `urls.<system>.test`.
- **A test request with no distinct test endpoint THROWS.** `requested === "test"` with
  `urls.<system>.test` absent, or holding the production URL, refuses:
  `<context> requested TEST instance for <system> but no distinct test URL is configured; refusing
  production fallback`. This is the structural impossibility the charter asks for — a run that
  believes it is hitting a sandbox can never silently land on production. `resolveSystemLoginUrl` is
  the same rule for the LOGIN entry, which differs only for UCPath: the deep PeopleSoft routes are
  not reachable unauthenticated, so authentication starts at `urls.ucpath.<instance>.login` and
  rides the campus-discovery → Shibboleth chain (ported from
  `legacy:src/infra/auth/login.ts`, `hr-automation@793abe1f`).
- **As-built, that refusal lands at ACQUISITION, not at enqueue.** The plan-time resolver
  (`src/services/start/plan.ts:83-95`) derives the systems from the descriptor's projections,
  defaults each to `prod` and refuses an undeclared one — but it does not consult the config, so it
  cannot see a missing test URL. The version that does (`src/domain/config/instance.ts:88-107`,
  which calls `resolveSystemEntryUrl` per system) has only a test caller. The refusal is therefore
  correct and late: it fires inside the session factory rather than before the run is queued.
- **Recorded in the audit trail.** `resolvedInstance` travels on the envelope and on the queued
  span, so every run's actual target per system is queryable rather than inferred.
- **Worker-owned context partitioning.** Each worker owns its browser contexts keyed by
  `(worker, system, resolvedInstance, configFingerprint)`. Prod and test runs never share a context;
  a config change creates new contexts and existing runs finish against their stamped snapshot.

**Phase 1f reuse identity (D116).** That tuple is the session manager's actual lookup identity, not
metadata added after acquisition. `reuse-worker` may return an existing context only when worker,
system, resolved instance and `configFingerprint` all match the requesting run, and download /
exclusivity launch requirements must remain compatible; a mismatch closes the old context with
proof and authenticates a new one. Neither equal URLs nor the same credential set permits reuse
across a different fingerprint, because timeouts, feature flags, provider or browser policy, or
another non-secret resolved leaf may have changed even when the route did not.

**As-built (2026-08-03).** The worker loop binds the claimed run's `configFingerprint` on the
session manager before any task executes and releases it when the run finishes; a driver lease
without a bound fingerprint fails loud rather than defaulting to "whatever session exists". The
concrete factory carries the fingerprint into the on-disk profile path too, so a config change
cannot be silently inherited through a warm profile. The bind/execute/release window is one shared
discipline (`withBoundRunConfigFingerprint`, `src/core/worker-sessions.ts`) so no caller re-derives
it. A lease taken OUTSIDE a claimed run's window — today only ref write-safety §4 recovery's
idempotency probe — binds the TARGET run's retained `configFingerprint`, read from that run's
authority row, never recomputed from current config and never taken from a caller's claim; a
missing or foreign binding there is a loud precondition refusal, not a silent skip.

Three config leaves landed with it: `browser.headless` (the runtime default is headless — Duo
Autopilot answers the WebAuthn ceremony in-page, so there is no OS dialog to watch),
`browser.closeProofMs` (the bound on the teardown that must PROVE page/context closure), and
`paths.duoExtensionDir` (the unpacked extension the session factory loads). `urls.ucpath.*.login`
joined them under §3's unchanged prod/test rule.

### Every runtime path leaf is absolute, including the profile root and the Duo credential

`paths.browserProfileRoot` is an `AbsolutePathSchema` leaf like its siblings, and
`paths.duoCredential` is `join`ed onto it — neither is a relative literal pinned by `z.literal`. Two
reasons, both load-bearing:

- **cwd-independence.** The isolation contract states its roots as repo-relative literals because
  that is the text the operational-isolation audit compares on both sides. A *runtime* path may not
  be that literal: `.auth/duo-webauthn.json` resolves against `process.cwd()`, so a worker or daemon
  started anywhere but the repo root silently looks for the Duo credential in a directory that does
  not have it, and `requireSecretFile` then reports a missing credential that is in fact present.
  `src/domain/config/runtime-paths.ts` resolves the isolation root exactly once per process and both
  leaves derive from that single absolute value (§3), so no consumer re-derives it.
- **The real credential home must be redirectable.** The profile directory is created by
  `factory.open()` (a real `mkdirSync`) and the credential is a real file read, so any caller that
  must NOT touch the operator's `.auth/` — every unit test — has to be able to say so. Before this,
  `tests/unit/browser-session-factory.test.ts` created directories in the real root and then
  `rmSync(…, { recursive: true, force: true })`'d it, deleting the Duo WebAuthn credential on every
  `npm run test`; fresh enrollment is the one Duo ceremony Autopilot cannot perform unattended, so
  that was silent destruction of an operator asset behind a green gate.

The isolation contract is not weakened by this. The default still comes from
`rebuildRuntimeIsolation.browserProfileRoot`, `define-runtime-isolation.ts` still pins the literal
with `z.literal`, and `workerProfileDirectory` still takes the `browserSessionNamespace` segment
from the contract — that namespace, not the root, is what makes a rebuild profile unreachable from
the legacy runtime. A relative `profileRoot` is refused loudly rather than resolved.
`test-runtime-root-isolation.test.ts` (ref guards-and-tests) is the ratchet: no test may pass a
real-root-derived path into a filesystem mutator, and a test that constructs the real session
factory must bind its own profile root.

### Operational isolation: two runtimes, one machine (D88 · D216 · D247)

A repository boundary does not separate two runtimes on one host. The values that must differ are
**data** in `config/runtime-isolation.json` (schema version 3), and
`tests/unit/architecture/operational-isolation.test.ts` audits both real checkouts against them:

|                             | legacy                                           | rebuild                                          |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| state root                  | `.tracker`                                       | `.tracker-rebuild`                               |
| artifact root               | `.tracker`                                       | `.tracker-rebuild/artifacts`                     |
| backend / frontend port     | 3838 / 5173                                      | 3938 / 5174                                      |
| process locks               | `.tracker/daemons`                               | `.tracker-rebuild/locks`                         |
| browser profile / session   | `.auth` / `hrauto-legacy`                        | `.auth` / `hrauto-rebuild`                       |
| launch commands             | `dashboard`, `dashboard:prod`, `dashboard:watch` | `dashboard`, `dashboard:prod`, `cli`             |

`DISTINCT_RESOURCE_KEYS` is `stateRoot`, `artifactRoot`, `processLockRoot`,
`browserSessionNamespace`, plus both ports checked in their own right. **Two entries in that table
are deliberately EQUAL, and each says why.**

- **`browserProfileRoot` left the distinct list with D216** (operator decision, 2026-08-14): both
  repositories name their profile root `.auth`, and the roots are repo-relative, so they can never
  collide on disk. The browser-state identity that MUST stay distinct is `browserSessionNamespace`,
  which is what keeps a session opened in the wrong checkout from reusing the other runtime's
  authenticated state.
- **Command NAMES are not an isolation resource (D247).** A muscle-memory `npm run dashboard` in the
  wrong checkout starts THAT checkout's dashboard, on its own port, under its own roots and locks —
  which the rows above make legible and harmless. What is still pinned is that each declared command
  is **byte-exactly** the script in its own checkout's `package.json`, so a drifted or missing
  launch command fails on either side.

Isolation values reach the runtime through ONE exported direct-`const` `defineRuntimeIsolation`
call (`src/config/runtime-isolation.ts`) whose schema is a strict object of `z.literal`s, invoked at
top level by a composition root (`src/cli.ts` → `startRebuildRuntime({ isolation })`). The guard
proves all four halves of that sentence against a seeded fixture repository: a drifted literal, a
locally shadowed factory, a non-exported binding, and a composition root that merely MENTIONS the
binding — or calls it inside a function nobody invokes, or under the wrong argument path — each
fail by name. An identifier mention is not proof.

### 4.1 The durable snapshot is versioned by its LEAF SET, not by the migration chain (D133)

<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
- [x] `src/domain/config/snapshot-generations.ts` is the config schema's own version line, separate from the SQLite migration chain — an ordered append-only registry naming the deciding decision, the leaves it introduced, and a literal SHA-256 over the complete leaf set at that generation (D133, 2026-08-04)
- [x] exactly ONE leaf is generation-gated today: `timeouts.sessionAcquireMs`, introduced by generation 2 (D125). Generation 1 (D121) is the shape the preserved Phase-1 exit database carries, and `POST_BASELINE_CONFIG_LEAVES` — the complete set a stored row may lack — is that one leaf and nothing else
- [x] `StoredConfigSchema` strips every group `.default(...)`, so a pre-`browser` row fails loud instead of reading back as today's launch policy
- [x] `ConfigSnapshotWriteSchema` refuses to MINT a row that omits a current-generation leaf; `auditConfigSnapshotGenerations` is the ratchet, executed by `tests/unit/architecture/config-snapshot-generations.test.ts`
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/config/snapshot-generations.ts` (the two registered generations and both pinned digests) and `src/domain/config/snapshot.ts`; nothing left — the next required leaf is the next entry
<!-- /roadmap-status -->

**A stored `config_snapshots` row is evidence of the configuration one run executed under, and it is
never rewritten.** D125 added the required leaf `timeouts.sessionAcquireMs` with a default for FRESH
resolves and no path for already-durable rows. Every snapshot parses strictly at database OPEN, so
every authority database created before that change stopped opening — the whole runtime, including
every unrelated row, was unreachable on a real pre-D125 database. The exact failure, reproduced
against the preserved Phase-1 exit database:

```
authority table config_snapshots record 42a1d831-… failed strict record schema validation:
  path ["config","timeouts","sessionAcquireMs"] — expected number, received undefined
```

This is the §3 config schema's own version line, and it is **separate from the SQLite migration
chain**, because adding a required leaf changes no TABLE — it changes what a stored ROW must
contain. Three facts forbid the obvious "migrate the rows" repair:

1. `fingerprint` is a SHA-256 over exactly the stored `config` bytes and the run envelope retains
   the same value (§3 · §4). Editing the row breaks the binding the row exists to prove.
2. `config_snapshots` is an insert-only authority repository. A migration that `UPDATE`d it would
   contradict the store's own immutability.
3. **Back-filling the default misstates history.** A pre-D125 run had NO session-acquire bound at
   all — that absence is precisely why a dead CRM session burned 262.9 s inside `withDriver` on the
   live exit run. Writing `60000` into that row would claim the run held a bound it did not, and the
   snapshot's only job is to say what actually governed the run. D109's precedent (delete rather
   than fabricate) does not transfer either: a start plan is a short-lived proposal, while a config
   snapshot is permanent evidence that completed runs and `provider_admissions` still reference.

So the record is **read forward**, and the tolerance is registered rather than assumed
(`src/domain/config/snapshot-generations.ts`):

- `CONFIG_SNAPSHOT_GENERATIONS` is an ordered, append-only registry. Each generation names the
  deciding decision, lists the leaves it INTRODUCED, and pins a literal SHA-256 over the complete
  leaf set of the config at that generation. **Generation 1 is D121** — the shape the 2026-08-04
  Phase-1 exit database (`.tracker-rebuild/phase1-exit-state.db`) actually carries, introducing
  nothing by definition. **Generation 2 is D125's `timeouts.sessionAcquireMs`**, and it is the only
  entry with a leaf, so `POST_BASELINE_CONFIG_LEAVES` — the complete set of leaves a stored row is
  permitted to lack — is that one path. Anything OLDER than generation 1 is deliberately not
  tolerated: an unverifiable historical shape gets a loud refusal, not a guess.
- `StoredConfigSchema` permits exactly the registered post-baseline leaves to be ABSENT and nothing
  else (today: `timeouts` is `.partial({ sessionAcquireMs: true })`, every other group whole).
  `configSnapshotAbsentLeaves(config)` reports which — **"this leaf did not exist at capture" is a
  different fact from "this leaf was set to 60000", and only the former is true of an old row.** No
  value is substituted, so the stored fingerprint keeps hashing exactly what it hashed at capture,
  and `configSnapshotGeneration(config)` reads a row's generation back off the same evidence.
- `StoredConfigSchema` also **strips every group `.default(...)`** (each group is taken through
  `.unwrap()`; `paths`, which has no default, is taken as-is). Defaults exist so a fresh resolve can
  start from nothing; applying them while READING a durable row silently fabricates a whole group
  the run never had. That hole is how `browser.headless` / `browser.closeProofMs` landed without a
  visible brick — a pre-`browser` row quietly read back as today's launch policy. A stored row now
  carries its own values or fails loud.
- Reading an older generation forward is a concession to history; MINTING one is a bug.
  `ConfigSnapshotWriteSchema` is `ConfigSnapshotRecordSchema` plus one `superRefine` that refuses an
  insert whose config omits any current-generation leaf, naming the row and the leaves. Without that
  arm the read tolerance would quietly become a licence to persist a hole.
- Every OTHER shape defect — a missing baseline leaf, a missing group, an unknown key, a wrong type
  — still fails loud at database open, because that is corruption rather than schema evolution.
- `auditConfigSnapshotGenerations` is the ratchet, enforced by
  `tests/unit/architecture/config-snapshot-generations.test.ts` (ref guards-and-tests). It walks the
  registry in REVERSE, digesting the current leaf set against the newest pin, then removing that
  generation's introduced leaves and digesting again against the previous pin — so every older
  generation's pinned set must still be reconstructible. It also refuses an out-of-order generation,
  a baseline that introduces leaves, a later generation that introduces none, a
  `CURRENT_CONFIG_SNAPSHOT_GENERATION` that does not name the newest entry, a leaf introduced twice,
  and a registered leaf that has since VANISHED from the schema (a released generation is never
  rewritten). The digest is domain-separated (`hrauto:config-leaf-set:v1`) over the sorted unique
  set, so it is order-independent and cannot collide with another leaf-set hash in the tree.
  **Adding or tightening a required config leaf without registering it and bumping
  `CURRENT_CONFIG_SNAPSHOT_GENERATION` fails there, before it can reach a durable row.**

The same hazard had already fired four times unnoticed, each brickable for any database older than
the change: `urls.ucpath.*.login`, `paths.duoExtensionDir`, and `paths.browserProfileRoot` were
required leaves added inside existing required objects, and `paths.duoCredential` was TIGHTENED from
a relative `z.literal(".auth-rebuild/duo-webauthn.json")` to `AbsolutePathSchema` — a tightening
invalidates a stored row exactly as an addition does, because the stored value no longer satisfies
the leaf. A fifth, `browser`, was a whole new group carrying a `.default(...)`, so it did not brick;
it silently fabricated, which is worse. None of the five bricked a surviving database only because
no database survives from before them. The registry covers tightenings as well as additions: any
change to the effective leaf set moves the digest, and the stripped group defaults turn the silent
half loud.

## 5. Fiscal-year dates — fail-loud, not silently stale

<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] `Config.annualDates` is keyed by fiscal year (`z.record(FiscalYearKeySchema, AnnualDateEntrySchema)`), not a flat literal, and every key and value parses strictly (`src/domain/config/schema.ts:9,72-76,215`)
- [x] `requireAnnualDates(config, clock)` is the one lookup and it throws by name for a missing year AND for an existing-but-past `jobEndDate` (`src/domain/config/fiscal-year.ts:45-63`)
- [x] the comparison is pure calendar arithmetic — a strict `M/D/YYYY` parse with leap-year validation, compared as an integer date code against `clock.todayLocal()` — so it needs no `Date` parsing, no timezone and no sleeping test
- [ ] `annualDates` defaults to `{}` and NO production module calls `requireAnnualDates`: the only caller in the tree is `tests/unit/config.test.ts`. The consumers §1 named (onboarding hire-date fill, Kronos report range) are unmigrated workflows, so the contract is built and unexercised
- [ ] the `fiscal.current` preflight check is registered as a blocking `workflow`-scope check for `workflow.kuali-fill` (`src/domain/runtime-dependencies.ts:369`) and has no runner — see §6.2
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/config/fiscal-year.ts` and `schema.ts`, and by grepping the tree for callers; left: the first migrated workflow that fills a fiscal date is what exercises this
<!-- /roadmap-status -->

Legacy's `ANNUAL_DATES` is a flat, single-year literal with no rollover mechanism, and it was already
past due when the audit ran (§1). The rebuild makes staleness a **loud failure at the point of use**,
not a silently-wrong fill.

- **Keyed by fiscal year, not flat.** `Config.annualDates: Record<"FY${number}", AnnualDateEntry>`.
  There is no single "the" `jobEndDate` — there is `annualDates["FY2027"].jobEndDate`, looked up by
  the Clock. UC's fiscal year runs Jul 1 – Jun 30 and is NAMED by its ending calendar year, which is
  `Clock.fiscalYear`'s one line of arithmetic (§2).
- **Intentional dynamic-map exception.** Fiscal years are unbounded configuration keys rather than
  domain field names, so this constrained `z.record(FiscalYearKeySchema, AnnualDateEntrySchema)` is
  allowed where an open record would not be. `FiscalYearKeySchema` is `/^FY\d{4}$/`, every entry is
  a strict `{jobEndDate, kronosDefaultEndDate, kronosDefaultStartDate}` of `UsDateSchema` values, and
  no task reads the map directly.

```ts
// src/domain/config/fiscal-year.ts — the one call site every consumer goes through
export function requireAnnualDates(config: Config, clock: Clock): AnnualDateEntry {
  const fiscalYear = clock.fiscalYear();
  const key = `FY${String(fiscalYear)}`;
  const entry = config.annualDates[key];
  if (entry === undefined) {
    throw new FiscalDateNotConfiguredError(
      `no ANNUAL_DATES configured for ${key} (today ${clock.todayLocal()} falls in ${key}, `
      + `Jul 1 ${String(fiscalYear - 1)} – Jun 30 ${String(fiscalYear)}); configure annualDates.${key}`,
    );
  }
  assertNotPast(entry.jobEndDate, `${key}.jobEndDate`, clock);   // an ENTRY existing is not enough
  return entry;
}
```

- **A second, narrower check: an existing-but-stale entry is also loud.** A copy-pasted-forward
  entry (this year's key holding last year's date by operator mistake) passes the lookup and is
  still wrong. `assertNotPast(value, field, clock)` parses the value as a strict `M/D/YYYY` calendar
  date — validating the month, the day-of-month and leap years, so `2/30/2027` is refused as a
  malformed date rather than silently normalized — converts both it and `clock.todayLocal()` to an
  integer date code, and throws `<field>=<value> is stale for today <YYYY-MM-DD>` when the value is
  strictly BEFORE today. Today itself is not stale. Nothing here parses a `Date` or reasons about a
  timezone: the comparison is arithmetic over two calendar triples, which is why it is exact at the
  boundary and testable without a clock that moves.
- **Only `jobEndDate` is staleness-checked, and that is deliberate.** The two Kronos values are the
  ENDS of a reporting range whose start is expected to be years in the past (legacy's default was
  `1/1/2017`), so refusing a past `kronosDefaultStartDate` would refuse every correct
  configuration. They are still schema-validated as dates.
- **This is the charter's fail-loud rule applied verbatim.** A fiscal date is an expected value whose
  absence or staleness is not a genuinely valid state — a hire-date fill needs a *current* fiscal
  year's date — so it fails loud instead of substituting the nearest available literal.
- **Rollover is then a config edit, not a code deploy.** Adding `annualDates.FY2028` (or setting the
  three environment variables as a complete group, §3) each June is the entire rollover procedure,
  and a missed rollover is caught at the first run that needs it rather than discovered months later.

**As-built: built, guarded, and not yet exercised.** `annualDates` defaults to `{}`, so
`requireAnnualDates` currently throws for every fiscal year on a default resolve — which is the
correct behaviour and also means the contract has no production caller. The consumers §1 named live
in workflows that are not migrated yet; the first migrated workflow that fills a fiscal date is what
turns this section from a contract into a running check, and it must call `requireAnnualDates` rather
than reading the map, or the staleness half is lost.

## 6. Secrets accessor

<!-- roadmap: p1-base -->

`src/domain/secrets.ts` is the sole home for every credential this runtime reads, and the ONLY
module permitted to touch `process.env` at all. It replaces legacy's `validateEnv()` +
`getTimekeeperName()` + ~20 files of inline `process.env.*` (§1) with one surface, and its coverage
is a registry rather than a habit: three declarative tables, each a parsed and frozen array, each
audited from both sides.

Since D93 the two runtimes live in separate repositories with no shared module graph, so importing
each other's accessors or proxying requests is **structurally impossible** rather than merely
forbidden. What the repo split does *not* do is separate the machine, so two distinct `.env` /
settings / secret worlds and two distinct state, auth and profile roots stay an explicit requirement
(§4 pins them as data). In inventories that name both repositories, `legacy:` qualifies a legacy
path and an unprefixed path means this repository (D94, ratified F2); single-root legacy manifests
stay unprefixed. Ref guards-and-tests owns the guard lane's checkout resolution; this section only
consumes the path convention.

### The three registries

```ts
// src/domain/secrets.ts — names live in ./secret-names.ts so a schema can bind one without
// importing the reader. Every spec carries the CLASSIFICATION §6's redaction contract reads.
export const SECRET_SPECS = […];        // 5: a discriminated union on `source`
export const SECRET_FAMILY_SPECS = […]; // 5 provider key families
export const SECRET_FILE_SPECS = […];   // 1: the Duo WebAuthn credential
```

| name | source | env / path | classification |
|---|---|---|---|
| `ucpathUserId` | environment | `UCPATH_USER_ID` | `direct-identifier` |
| `ucpathPassword` | environment | `UCPATH_PASSWORD` | `secret` |
| `timekeeperName` | environment | `TIMEKEEPER_NAME` | `direct-identifier` |
| `sharepointOnboardingRosterUrl` | environment | `ONBOARDING_ROSTER_URL` | `secret` |
| `ngrokCredential` | `local-ngrok-config` | `~/Library/Application Support/ngrok/ngrok.yml` | `secret` |
| `duoWebauthnCredential` | file | `paths.duoCredential` (§4) | `credential-file` |

**The classification is not decoration — it is the join to §6's redaction contract**, and the two
`direct-identifier` rows are the reason it is per-entry rather than per-table: an operator's user id
and the timekeeper's name are real identifiers that must never reach a diagnostic verbatim, but they
are not passwords, and a receipt may legitimately carry a `last4` or a digest of one where it may
carry nothing at all of `ucpathPassword`.

Provider keys are a **registered pattern, not an ad-hoc `process.env` scan**. Each family declares
an `envPrefix`, its `modelsEnv` chain variable, the singular `legacyModelEnv` spelling the
operator's `.env` predates, and a `maximum` of 8. The pool is read as the bare prefix followed by
`2..maximum` (`GEMINI_API_KEY`, `GEMINI_API_KEY2`, … `GEMINI_API_KEY8`) — the first cell has no
suffix, which is what legacy's `.env` already holds. `providerModelChain` lives here too: model ids
are not secrets, but this module is the only permitted environment reader, so the reader lives with
the permission. An empty chain is returned as an empty array — a fact the composition root judges,
never a default minted here.

### The accessors

```ts
export function requireSecret(name, env?, access?): string;      // throws SecretMissingError, never `?? ""`
export function optionalSecret(name, env?, access?): string | undefined;
export function inspectSecret(name, env?, access?): SecretAvailability; // present | missing | unknown
export function optionalSecretFamily(name, env?): readonly string[];
export function requireSecretFamily(name, env?): readonly [string, ...string[]];
export function providerModelChain(name, env?): readonly string[];
export function validateBootSecrets(env?, access?): void;                 // batch, requiredAtBoot only
export function validateDescriptorSecrets(names, families, env?, access?): void;  // batch, per run
export function requireSecretFile(name, config, access?): Buffer;         // named files only
export function configResolutionEnvironment(env?): NodeJS.ProcessEnv;     // the resolver's env, once
```

Every reader takes its environment and its filesystem access as **injected parameters defaulting to
the real ones**, so a test exercises the production code path rather than a double, and no test needs
to mutate `process.env`.

- **Fail loud at the correct scope.** `validateBootSecrets()` covers only entries marked
  `requiredAtBoot` and batch-reports every unresolved one at once. **Today no entry is marked, so it
  passes vacuously** — deliberately: an unused workflow credential must never stop the local
  dashboard from opening. `validateDescriptorSecrets(names, families)` is the per-run gate, reporting
  every missing requirement together so a selected workflow fails before spending Duo or browser
  work, not on the third of five prompts.
- **Three distinct errors, and the difference is load-bearing.** `SecretMissingError` means the value
  is not configured; `SecretSourceError` means the SOURCE could not be inspected or parsed;
  `SecretFileError` wraps a named credential file's failure with the source error as its `cause`.
  `inspectSecret` maps a `SecretSourceError` to `unknown` and **re-throws anything else** — so "the
  check failed" can never be reported as "the check found nothing", which is the exact confusion the
  charter's fail-loud rule names.
- **`configResolutionEnvironment` is the one sanctioned production source of the environment object**
  the resolver takes as a parameter. `resolve.ts` reads nothing itself — it reads only its
  statically-declared `CONFIG_ENV_BINDINGS` keys off the value it is handed — so a composition root
  obtains that value here instead of growing its own read.
- **Named file secrets only.** `requireSecretFile("duoWebauthnCredential", config)` resolves
  `config.paths.duoCredential` (§4's absolute leaf), then validates before reading: the path must
  `stat` (a throw becomes a `SecretSourceError`, never a missing-file guess), it must be a regular
  file, its mode must be `0600` or stricter (`mode & 0o077` must be zero), and its size must be
  within the registered 64 000-byte limit. Callers cannot turn this into an arbitrary path reader,
  and the cross-process lock and signCount logic around the Duo credential are untouched — only the
  raw read moved.
- **Local source failures stay distinguishable.** The ngrok resolver reads the one registered config
  path under the same file checks, then requires **exactly one** `authtoken:` line — two is a
  `SecretSourceError`, because choosing between them is how the wrong tunnel gets opened. A quoted
  value must close its quote; a trailing `# comment` is stripped; an empty value resolves to
  `missing`, not `unknown`. Neither state includes the credential value and neither passes as
  healthy, so a missing or unreadable ngrok source blocks selected capture instead of passing because
  it was not an environment secret.
- **Never logged.** The accessor is the only function permitted to read a secret's raw value; every
  other module receives it as an opaque string to hand to a login or fill call. Note that the
  accessor's own refusals name the KEY and never the value — `${name} is missing from registered
  source environment UCPATH_PASSWORD` — which is what makes the second guard below satisfiable.

### Redaction is schema-owned, and unclassified means drop

`src/domain/redaction.ts` declares five classifications — `secret`, `credential-file`,
`direct-identifier`, `sensitive-hr`, `safe-diagnostic` — and six transforms — `drop`, `digest`,
`last4`, `basename`, `count`, `allow`. `ALLOWED_TRANSFORMS` maps which transform each classification
permits, and `evidenceTransformAllowed` is checked **twice**: once when a DECLARATION is parsed (a
receipt field that claims `allow` for a `secret` is refused at declaration time, not when a value
first flows through it) and again inside `redactValue`, which throws rather than degrading. An
`allow` result collapses its classification to `safe-diagnostic`, so nothing downstream can re-widen
it. Ref operator-trust's logger, evidence and bundle writers accept classified values and transform
before serialization; an unknown or unclassified field is dropped with a redaction warning, never
passed through. Canary tests seed passwords, cookies, storage state, SSNs, DOBs and private keys and
scan every produced note, failure, screenshot metadata, bundle and notification.

### The two guards

**`secrets-single-source.test.ts`** — MEMBERSHIP decides, not directory. `src/domain/secrets.ts` is
the sole credential reader; `src/domain/config/**` may read the environment, because the resolver's
precedence is a distinct concern from secret VALUES — but only for keys the config binding table
owns. Concretely, an occurrence is a violation when it is outside both owners (any access at all:
read, write or delete; exact, computed, destructured, aliased, imported or bulk), when the config
owner WRITES or DELETES rather than reads, when the config owner's key is not statically resolvable
(a computed `process.env[key]` is unreviewable), when the key belongs to `SECRET_SPECS` or a
`SECRET_FAMILY_SPECS` pool (the exact confusion the guard exists to reject), or when the key has no
`CONFIG_ENV_BINDINGS` entry. The ported-leaf allowlist is **empty**, so new `src` code has zero
tolerance. Two properties make it evidence rather than decoration: a **non-vacuity** case asserts the
scan set is non-empty AND that the owner itself is found reading the environment — if the AST walker
stopped resolving `process.env`, an all-clean result would be a false pass — and a fixture spelling
ten distinct violating forms is pinned at exactly 10, with the write and delete arms named.

Today the tree is stricter than the contract requires: `resolve.ts` takes `env: NodeJS.ProcessEnv`
as a parameter and reads nothing, so the config owner's permission is currently unexercised.

**`no-secret-values-in-logs.test.ts`** — the companion. `secrets-single-source` decides WHO may read
a credential; this one decides WHAT may be said about it, because the moment a value is spliced into
a string it has left the classification behind and every downstream writer copies it verbatim. It
scans **every template-literal interpolation in `src/**`** (a thrown `Error` message is as durable as
a log line) and **every argument to a `log.*` / `console.*` call** (so a bare `log.info(password)` is
caught without a template). A name is sensitive when its normalized form contains one of fourteen
roots — `password`, `passwd`, `passphrase`, `secret`, `credential`, `privatekey`, `apikey`,
`accesskey`, `authtoken`, `bearertoken`, `sessiontoken`, `refreshtoken`, `cookie`, `storagestate`,
`ssn`. Descriptor suffixes exempt the companions that DESCRIBE a credential (`secretName`,
`credentialPath`, `tokenCount`, `…Spec`, `…Env`, `…Classification`), and `key`/`keys`/`state` are
deliberately NOT on that list, because `apiKey`, `secretKey`, `privateKey` and `storageState` all
carry the value. Its allowlist is empty too.

### The planned successor: the OS keychain, behind this accessor

The desktop application will move credential STORAGE from `.env` to the operating system's keychain,
and the reason it can is this section: `requireSecret` / `optionalSecret` / `requireSecretFile` are
already the only readers, every entry is already registered with a source kind, and
`SecretSpecSchema` is already a discriminated union on `source` — so a `keychain` arm is an added
variant and a resolver branch, not a re-threading of the tree. That work is tracked as
`{#desk-secrets}`; nothing in this section changes shape for it, and the guard that makes the
migration safe (one owner, empty allowlist) is the one already green.

### Two open hygiene items

- **`.env.example` in this repository is still legacy's file, unrevised.** It documents
  `src/config.ts`, `localhost:3838`, `npm run duo:webauthn:enroll`,
  `src/workflows/sharepoint-download/registry.ts` and `src/data/` — none of which exist here — and it
  names `CAPTURE_PUBLIC_URL` / `CAPTURE_NGROK_URL`, which this runtime does not read, while omitting
  most of §3's 38 bindings and every provider family. Nothing binds it: `DOCUMENTED_ENVIRONMENT_KEYS`
  in `src/domain/runtime-environment.ts:169-178` is a hand-maintained set that mirrors what the file
  USED to say, so the inventory's `documented` flag and the file can disagree without failing a gate.
- **A real subject's employee id is hardcoded across seven tracked files.** Ref guards-and-tests
  §10.3 found it in the identity-check scenarios: the same id, with a name beside it, appears in
  `docs/migrations/separations.md` §1. It is not a credential, so no guard in this section sees it —
  but it is a real person's identifier committed to git, which makes it a secrets-hygiene item. The
  fix is owned by `{#test-tiers}`: the scenarios take a schema-shaped SYNTHETIC id that no live
  system would resolve, and the real subject moves into the canary registry (ref guards-and-tests
  §10.5) where a dry-run scenario reads it by LABEL out of the gitignored `.env`.

### 6.1 Explicit single-operator/local scope

<!-- roadmap: later-unplanned -->

<!-- roadmap-status: later-unplanned -->
- [x] the BFF listener is loopback-only in code: it defaults to `127.0.0.1`, admits only `127.0.0.1` or `localhost`, and refuses anything else by name — `the dashboard BFF is loopback-only; refusing to bind <hostname>` (`src/server/dashboard/http-server.ts:45-50`)
- [x] no accounts, roles, permissions, teams, remote synchronization, high availability, secret manager, certificate management or signed audit anchoring exists, and D193(a) reaffirms that as the standing scope — not a gap
- [x] the ONE exception is ref data-intake-and-edit-data's phone capture, and it is a NAMED configuration result in all three modes rather than a fallback (D174, below)
- [x] the hygiene that local-only does not waive is real: `0700` directories and `0600` files on artifacts, authority backups, restore staging and recovery proofs (`src/infra/artifacts/content-addressed-artifact-writer.ts:71-73,208`, `src/infra/sqlite/{recovery-stop-proof,backup-service,offline-restore}.ts`)
- [?] D193(a)'s two LATER items — packaging the local app, and a cooperation/multi-user mode ON TOP of solo — carry no owner and no design. The PACKAGING half now has a named successor in the desktop work (`{#desk-secrets}` moves credential storage to the OS keychain behind §6's accessor); the multi-user half does not, and the refusal below stands unchanged
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/server/dashboard/http-server.ts`, the four `0o700`/`0o600` writers and `src/domain/capture-surface.ts`; nothing left in this section — it describes a decided scope, and `{#later-unplanned}` is `status: never` by design

<!-- /roadmap-status -->

The rebuilt operator dashboard binds loopback only. Phase 1 does not build accounts, roles,
permissions, teams, remote synchronization, high availability, a secret manager, certificate
management, or signed audit anchoring. Legacy-only LAN configuration remains inside the preserved
legacy repository and cannot reach the rebuild at all — separate repositories share no module graph
(D93), so there is nothing to import or proxy. Because both servers may run on the same host, the
rebuild binds its **own** loopback port and never reuses the legacy dashboard's (§4). A non-loopback
bind is rejected by the server with a message naming the address it refused; adding remote access
later requires a separate threat model and an explicit operator decision.

Ref data-intake-and-edit-data's mobile capture is the sole explicit exception and does not turn the
operator server into a remote app. `capture.ingress:"on-demand-ngrok"` starts a short-lived,
separately scoped ingress only after the operator creates a capture session; `forwarded` requires an
explicit HTTPS URL; `disabled` makes Start Capture fail with a named configuration result. The
ingress exposes the closed token-gated phone-route union only and shuts down after the last live
session expires or finishes. Its route allowlist is generated from the same capture-route schema and
deny-tests every operator/API catch-all. `forwardedUrl` is routing config, never authority; each
capture session stamps the resolved ingress mode and origin digest so troubleshooting can explain
which path was used. `ConfigSchema.capture`'s `superRefine` requires `forwardedUrl` exactly for
`ingress:"forwarded"` and rejects it for the other two modes, so a stale forwarded origin cannot be
silently reused.

**As-built (D174, 2026-08-09 — normative text in ref data-intake-and-edit-data §5.1).** All three
modes resolve to an origin or to a NAMED configuration result, and none of them falls back.
`disabled` refuses `ingress-disabled`; `forwarded` resolves to its explicit HTTPS URL;
`on-demand-ngrok` refuses `ingress-credential-missing` without its credential and
**`ingress-not-built` with one**, because the on-demand tunnel launcher does not exist in this
repository yet and a QR pointing at `127.0.0.1` scans perfectly and then fails on the phone with a
network error that explains nothing — the plausible-but-wrong outcome the charter forbids. The
allowlist is generated from `CAPTURE_PHONE_ROUTES` as this section requires, and the deny test is
stronger than "refuses": a request arriving on the ingress **Host** gets a status and body
**byte-identical** to an unrouted path, so the ingress cannot be used to enumerate what the
operator's dashboard serves. The session's `{mode, originDigest}` stamp is an OPTIONAL leaf (D133),
so rows written before D174 still parse. The token that gates every one of those routes never
appears in a URL the server sees: it rides the QR payload's URL FRAGMENT and the `X-Capture-Token`
header, which is how "no secret-bearing URLs" stays true of a surface whose entire purpose is to be
opened from a scanned link.

Local-only does **not** waive correctness or privacy hygiene. The tool still controls live HR
systems and stores sensitive evidence, so strict schemas, output redaction, least-retained capture,
file permissions (`0700` directories / `0600` authority, backup, evidence, and secret files),
loopback Origin checks, and no secret-bearing URLs or logs remain base requirements. These measures
also make diagnostic bundles safer to share with an AI assistant.

### 6.2 One environment doctor replaces scattered startup surprises

<!-- roadmap: cross-cutting -->
<!-- roadmap: p1-authority -->

<!-- roadmap-status: cross-cutting -->
- [x] the strict preflight REGISTRY is built and bidirectionally audited: `PreflightCheckSpec` (id, scope, severity, pure/IO runner, dependencies, capabilities, consumer, scenarios, timeout, redaction policy, remediation) and `PREFLIGHT_CHECKS` — twelve explicit checks plus generated per-feature, per-endpoint and per-provider ones (`src/domain/runtime-dependencies.ts:362-383`)
- [x] `PreflightReportSchema` is closed and refines its own rules — a blocking check cannot be a warning, an optional check cannot fail, and the provider/feature verdicts must agree (`src/domain/preflight.ts:55-208`)
- [x] fifteen scenario manifests cover missing browser, stale fiscal year, prod/test endpoints, low disk, corrupt DB, missing workflow secret, provider/OCR/AI exhaustion, unavailable capture ingress, busy port, runtime mismatch, invalid config and orphan processes (`src/domain/trust/preflight-scenarios.ts`)
- [x] ONE runner is implemented — `AuthorityHealthPreflightRunner` (Phase 1c Stage C), which consumes the same read-only storage doctor the recovery decision uses
- [ ] BE eleven-plus runners are unimplemented, and `buildPreflightReport` / `requiredPreflightChecks` / `executePreflightRunner` have only test callers — the registry is a contract nothing composes yet
- [ ] BE `FrontendBootstrapWireSchema#preflight` is `declared-unserved` (D184, `config/pending-wire-bindings.json:30-33`), so the Top Bar's stethoscope popover never mounts — the honest absence rather than a fabricated pass verdict
- [ ] BOTH there is no `cli doctor` verb and no `test-login`. `cli storage doctor` exists and is the closest thing, but it calls `doctorAuthorityStorage` directly (`src/server/storage/compose.ts:309-332`) rather than composing a preflight report, so the two would drift the moment a second runner lands
> 2026-08-21 | docs-cohesion clock-config-secrets | verified against `src/domain/{preflight,runtime-dependencies}.ts`, `src/domain/trust/preflight-scenarios.ts`, `src/infra/sqlite/authority-health-runner.ts`, `src/server/storage/compose.ts` and `config/pending-wire-bindings.json`; left: the runners, the service that composes them, and the three surfaces that consume it
<!-- /roadmap-status -->

The `setup`, `/api/preflight` and `test-login` behaviours legacy grew separately become projections
of ONE strict preflight registry, not three lists that drift. Each `PreflightCheck` has a stable id,
a scope (`dashboard | executor | workflow | system | feature`), a severity, a pure or IO runner, the
runtime dependencies it covers, the capabilities it blocks, its consumer, its scenario ids, a
timeout, a redaction policy and a remediation template. `PreflightReportSchema` carries the config
and descriptor fingerprints, the checked-at instant, and a non-empty closed result tuple:

```ts
type PreflightResult =
  | { status: "pass"; check: PreflightCheckId; summary: string }
  | { status: "warning"; check: PreflightCheckId; summary: string;
      impact: string; remediation: string }
  | { status: "fail"; check: PreflightCheckId; summary: string;
      blocks: readonly [RuntimeCapability, ...RuntimeCapability[]]; remediation: string };
```

The report schema enforces its own rules rather than trusting its composer: a check the registry
marks blocking may not come back as a `warning`, an optional check may not `fail`, and a feature's
verdict must agree with the count of healthy provider checks behind it. A `fail` must name at least
one blocked capability, and `buildPreflightReport` throws when an error-severity check resolves
none — a refusal that blocks nothing is a refusal nobody can act on.

Base checks cover Node and package-lock compatibility, Playwright browser and extension assets,
configured paths and permissions, disk space, port availability, SQLite/migration/backup health,
required workflow secrets, production and test URL completeness, current fiscal dates, optional
provider-key availability, capture-ingress dependencies, and stale orphan processes or leases.
Rules:

- dashboard boot blocks only on checks required to read authority and serve safely; missing
  credentials for an unused workflow are visible warnings, not a reason the local dashboard cannot
  open;
- enqueue and daemon start run the descriptor-derived workflow/system/feature subset and reject
  before launch if any required capability fails — no Duo or browser work is spent on a doomed run;
- optional AI and capture checks report the exact unavailable feature; they never masquerade as
  healthy and never block unrelated workflows;
- `cli doctor [--workflow <id>]`, Settings health, startup logs and `test-login` consume the SAME
  results. `test-login` adds bounded live authentication checks but cannot mutate HR data;
- the doctor never auto-installs packages, edits `.env`, changes settings, kills processes, restores
  a database, or opens a tunnel. It offers exact explicit commands and records only redacted facts.

The registry has forward and reverse coverage: every blocking runtime prerequisite is referenced by
at least one check, and every check has a consumer and a scenario — audited by
`runtime-dependency-coverage` and `runtime-environment-coverage` (ref guards-and-tests). Fifteen
scenario manifests pin missing browser, stale fiscal year, bad prod/test URL, low disk, corrupt DB,
missing workflow-specific secret, provider / OCR / AI exhaustion, unavailable capture ingress, busy
port, runtime mismatch, invalid config, orphan processes and the healthy mode.

**As-built: the registry is complete, and exactly one runner exists.** The
`authority.health` runner (Phase 1c Stage C, 2026-08-01) consumes the same read-only storage doctor
used for recovery decisions. It reports healthy only when the authority inspection is healthy AND
the newest backup is verified and current; missing, corrupt, foreign, newer-schema,
foreign-key-invalid, invariant-invalid, missing-backup, stale-backup and generation-gap states
remain distinct strict health causes. Operator-facing summaries are fixed redacted text, while the
injected `Clock` supplies report timestamps and backup-age calculations (§2). It checks the abort
signal before and after inspection, and it does not repair storage, read environment or config
directly, or contact any external system.

Everything downstream of that runner is unbuilt, and the honest reading is that **the registry is a
contract nothing composes yet**. `buildPreflightReport`, `requiredPreflightChecks` and
`executePreflightRunner` are exercised only by `tests/unit/preflight-runtime-dependencies.test.ts`;
the bootstrap's optional `preflight` field is `declared-unserved` under D184, so the Top Bar's
stethoscope popover never mounts; there is no `cli doctor` verb and no `test-login`. The nearest
built thing is `cli storage doctor`, which calls `doctorAuthorityStorage` directly and formats its
own report — correct today, and exactly the drift this section exists to prevent the moment a second
runner lands. Closing it is `{#cross-cutting}`'s Phase-3 work, and the shape it must take is the one
above: the doctor SERVICE composes the registry, and `cli storage doctor`, Settings health and
`test-login` become its projections rather than its siblings.

## 7. Adversarial self-review

| Vector | Risk | Guard |
|---|---|---|
| A config default masks a genuinely missing value (empty URL silently = production) | An operator who *meant* to set a test URL, typo'd it empty, unknowingly runs against production | This is the charter's "verified + genuinely valid" exception, not a masked failure: empty-URL-means-production is a **documented, verified** default (every URL's production literal is the live-verified value already in `config.ts` today) — not a guess. What closes the *dangerous* half (test intended, prod delivered) is §4's fail-loud instance-selection check, which is orthogonal to and stricter than the plain config default |
| Stale fiscal-date fallback | A rollover is missed; last year's date silently reused | §5: missing-FY throws; existing-but-past-due entry ALSO throws (`assertNotPast`) — closes both the "nobody rolled it over" and "somebody rolled it over wrong" cases |
| Clock skew (host OS clock is wrong) | Freshness comparisons and trace-id time-of-day become wrong in lockstep | constant skew cancels in `now-observedAt`; changing skew remains residual; compare monotonic vs wall clock and warn/park on a large backward jump |
| `manualClock` (test double) leaks into a production executor | A daemon silently runs with a frozen clock — every trace id, span, and freshness check wrong in the same way, all at once, no crash | `manual-clock-test-only.test.ts` — import-site guard, `manualClock` only importable from `*.test.ts`/`tests/**` |
| `ENV_KEY_MAP` typo (env var name misspelled, or a schema leaf added without a matching env entry) | An operator sets an env var that silently does nothing (the resolver never looks for it) | `config-env-map-coverage.test.ts` — asserts every schema leaf marked `envBacked` in a leaf-level annotation has exactly one `ENV_KEY_MAP` entry, and every `ENV_KEY_MAP` entry resolves to a real schema path (bidirectional coverage, same shape as the existing registry-parity guards) |
| Runtime re-reads config after enqueue | one run changes target/timeouts mid-flight or ledger mislabels instance | immutable snapshot/fingerprint on envelope; contexts partitioned by snapshot; guard bans config resolution from task impls |
| Resolver return type drifts | consumers expect plain values but receive provenance wrappers | type test pins `resolveConfig():Config` and `resolveConfigWithProvenance():ResolvedConfig` separately |
| A route name typo is accepted by an open endpoint map | driver navigates to missing/wrong route and a fallback hides it | per-system strict route schemas; unknown/missing route keys fail config parse and every driver route reference is coverage-checked |
| Diagnostic bundle copies sensitive state because a new field lacks a classifier | credentials/HR data leak into debugging artifacts | unclassified means drop, never allow; canary redaction test scans all serializers and attachments |
| A “temporary” LAN bind turns the local tool into a multi-user surface | unaudited remote control of live HR automation | operator server rejects non-loopback addresses; architecture/config test pins no LAN-password/RBAC path and separately proves the temporary capture ingress exposes only its closed phone-route union |

---

## 8. Worked example

**A live onboarding hire-date fill against production, everything resolved from its one source:**

```ts
const clock = systemClock;
const config = resolveConfig(process.env, readOperatorSettingsOverride());
const onboardingDescriptor = getWorkflowDescriptor("onboarding");
validateBootSecrets();                                        // no unused workflow credential gate
validateDescriptorSecrets(onboardingDescriptor.requiredSecrets); // reports UCPath requirements together

const runId = crypto.randomUUID();
const traceId = buildTraceId({ code: "ou", runId, at: clock.now() });   // §2 — Clock supplies `at`

const ucpathUrl = resolveSystemUrl(config, "ucpath", envelope.resolvedInstance.ucpath);

const annualDates = requireAnnualDates(config, clock);         // §5 — FY2027 entry, not past-due; else throws
const ucpathPassword = requireSecret("ucpathPassword");        // §6 — throws loud if unset, never logged

// … task runs, checkpoint facts record observedAt from clock; configSnapshotId stays fixed …
// span.ended(run, "done") — all-prod resolved map + config fingerprint recorded
```

**The same run one fiscal year later, nobody rolled the dates over:**

```ts
const annualDates = requireAnnualDates(config, clock);
// throws:
// FiscalDateNotConfiguredError: no ANNUAL_DATES configured for FY2028 (today 2027-07-03 falls in
// FY2028, Jul 1 2027 – Jun 30 2028). Add config/settings.json → annualDates.FY2028 = { jobEndDate,
// kronosDefaultEndDate, kronosDefaultStartDate }, or set ANNUAL_DATES_END / KRONOS_DEFAULT_END_DATE
// / KRONOS_DEFAULT_START_DATE for this year.
```

The run parks before touching UCPath — no hire-date fill is ever attempted with a stale or absent
fiscal literal.

---

## 9. Settled design questions

1. ~~Secret requirement timing~~ — **resolved 2026-07-21:** descriptors derive `requires` from task
   contracts; enqueue checks the complete set before creating a run. Per-task `requireSecret()`
   remains a fail-loud defense-in-depth backstop, not the primary discovery mechanism.
2. ~~Clock-skew detection~~ — **resolved:** durations use monotonic time; the executor compares wall
   vs monotonic deltas and emits a loud health warning/pauses new commits on material backward wall
   jumps until the operator acknowledges. Existing runs never rewrite timestamps.
3. ~~`ENV_KEY_MAP` for URLs~~ — **resolved:** only intentionally supported leaves appear in the
   explicit map. No reflection/uniform "every leaf" override. Production endpoint maps remain code
   defaults; settings and named URL env vars populate sparse test maps only.
4. ~~Fiscal-year entry authoring UI~~ — **resolved:** schema/file authoring works in Phase 1;
   operator UI lands with native Settings in Phase 2 tail 2i. Until then, the validated JSON entry
   is the supported rebuild-config path (the rebuild repo's own `config/settings.json`); legacy
   Settings continues independently in the legacy repo and cannot be proxied into the rebuild
   repo (D93).
5. ~~Per-run config snapshot timing~~ — **resolved 2026-07-21:** required in Phase 1 because every
   write ledger record needs trustworthy instance/config provenance even when all runs are prod.
