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
| Config resolver — env > settings.json > default precedence, typed schema (D331: `settings > default` once 1.6 lands; the environment stops being a resolver input) | **This doc** |
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
- [x] one secrets accessor covers environment secrets, registered key FAMILIES, and the Duo credential file; `secrets-single-source` and `no-secret-values-in-logs` both carry EMPTY allowlists (§6)
- [x] closed per-system route schemas, explicit prod/test instance refusal, current-fiscal-year validation, the runtime environment/dependency registries and the strict preflight report schemas are all implemented and bidirectionally audited (§3 · §4 · §5 · §6.2)
- [x] `.tracker/settings.json` (the state root; `config/settings.json` until D321) is one strict revisioned file authority; both composition roots read it before the one resolver runs, and `settings/apply-settings` is its sole producer (§3, D282)
- [x] `mergeSettings` is compiler-exhaustive over all 16 `ConfigSchema` groups, including `browser`; the focused resolver test pins both browser leaves and their `settings` provenance (§3)
- [ ] no contract or descriptor declares the secrets its tasks need, so `validateBootSecrets` / `validateDescriptorSecrets` have no production caller and a missing credential surfaces at the first task that needs one (§6)
> 2026-08-28 | DCC1 | the strict settings producer, restart reader and exhaustive browser merge landed; secret declaration/preflight remains separate
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
- [x] the resolver's SETTINGS layer is fully contracted — `SettingsOverrideSchema`, the exhaustive per-group merge in `resolve.ts` and a `"settings"` provenance value every persisted leaf can carry
- [x] the command boundary hashes the closed `EditableSettingsOverrideSchema`, which deliberately excludes credentials, runtime paths, annual dates and every other environment-owned leaf (`src/domain/config/{schema,settings}.ts`)
- [x] `apply-settings` is an active single command path: it verifies expected revision plus schema, patch and full command-envelope fingerprints, resolves the fully merged candidate, and persists the whole sparse override atomically
- [x] dashboard and worker boot both read and reconcile the same revisioned file authority before calling the one resolver; a non-baseline file must match the exact durable command journal, audit and `settings_current` singleton
- [x] `mergeSettings` applies `browser` and every other resolver-accepted group, preserving `env > settings > default` and exact per-leaf provenance
- [x] DCC2/DCC3 serve the bounded editor/readback and retained preflight rerun controls; health/doctor stays read-only, and broader legacy settings remain explicit deferrals
> 2026-08-30 | DCC1 reconciliation | the selected file/current/runtime authority feeds the existing DCC3 wire through a read-only adapter; no second persistence engine
<!-- /roadmap-status -->

**One resolver implements `env > settings.json > default` exactly once**
(`src/domain/config/resolve.ts`). No read site repeats the precedence, and the defaults live in
exactly one place — the zod schema's `.default()`s — so the legacy duplication between `config.ts`
and `DEFAULT_OPERATOR_SETTINGS` (§1) cannot recur by construction.
> 2026-09-04 | D331 (0.3 Task 2) | SUPERSEDED for the precedence, kept for "exactly once": at 1.6 the one resolver implements `settings > default` and takes NO environment input — the ordinary document, the host facts and the contract/runtime-path defaults are its whole input (§D331.8). `"env"` leaves `ConfigProvenanceSchema`. Every catalogued leaf has exactly one source.

### The schema is closed, per system and per group

`src/domain/config/schema.ts` is a `z.strictObject` of 16 groups: `actor`, `urls`, `timeouts`,
`paths`, `annualDates`, `operator`, `display`, `performance`, `ocr`, `capture`, `browserHealth`,
`browser`, `concurrency`, `daemon`, `features`, `providers`. Every group but `paths` carries a
complete `.default(...)`; `paths` is required (see D121 below).
> 2026-09-04 | D331 | CORRECTION: the schema is 15 groups — there is no `capture` group (D294 retired it; `snapshot.ts` refuses to mint the key). The closed-per-system route objects stand; under D331 the ORDINARY document schema has no `urls.<system>.prod` member at all, so no document input can move a production endpoint (§D331.8).

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

`src/domain/commands.ts` imports `EditableSettingsOverrideSchema` from `schema.ts`, and the dashboard bundle
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

### A display default is the host's primary display (D324, 2026-09-03)

The operator's rule: with nothing applied in Settings, the browser viewport IS the screen the
dashboard runs on. The precedence does not change; as with D121 the split is on WHERE the default
comes from:

- `schema.ts` keeps `DEFAULT_DISPLAY` (2560 × 1440) as the CONTRACT default. It is the headless
  fallback for a host that has no display to report (a CI runner, an SSH session — a genuinely valid
  state for a headless browser viewport) and nothing else.
- `src/infra/host/primary-display.ts` probes the host's primary display once per process tree: the
  macOS main display's LOGICAL resolution from `system_profiler SPDisplaysDataType -json` (never the
  backing pixels), the Windows primary screen bounds through PowerShell, the X11 `primary` output
  through `xrandr`. Every parser is strict: an unrecognized answer is a thrown error naming the tool,
  never a guessed viewport; a missing tool or no attached display is `unavailable`.
- `src/domain/config/host-display.ts` owns the encoding. `hostAwareResolutionEnvironment` in
  `secrets.ts` — the ONE permitted environment write — publishes the observation as
  `HRAUTO_HOST_PRIMARY_DISPLAY` (`<width>x<height>` or `none`) if no parent already did, and the
  three compositions that resolve config (dashboard, worker, dry-run scenario) obtain their
  environment through it. A parent's published value is kept verbatim and never re-probed, so a
  monitor plugged in between the dashboard boot and a worker spawn cannot split the config
  generation: children inherit the environment and resolve the identical fingerprint.
- `resolve.ts` reads that one key as the `display` DEFAULT (`hostDisplayDefault`), beneath a
  Settings override and reported as `default`, which is what it is. A malformed published value is
  a refusal. The Settings editor's "default" column resolves against the host display leaf alone
  (`hostPrimaryDisplayEnvironment`), so it shows the host value rather than the headless fallback.
- The key is registered in `src/domain/runtime-environment.ts` on its own `config-default` channel:
  a runtime-published input to the resolver's DEFAULT layer, deliberately without a
  `CONFIG_ENV_BINDINGS` entry, because an env-layer binding would let it outrank Settings.

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
> 2026-09-04 | D331 | CORRECTION and SUPERSESSION: 33 bindings are registered today, not 38 — the five `HRAUTO_CAPTURE_*` names have zero occurrences in the tree (D294). All 33 retire at 1.6: `CONFIG_ENV_BINDINGS` becomes empty (its type stays so the guard can assert emptiness), every migrated key becomes `retired-in-target`, and the annual-dates group rule and "unset by omission" are restated as document-schema invariants (§D331.8). The `apply`-per-binding coercion has no successor because the document is typed JSON, not text.

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

### The settings producer and editable boundary

`SettingsOverrideSchema` remains the resolver's complete sparse input contract, including
deployment-owned values supplied by composition. The persisted command boundary is intentionally
narrower: `EditableSettingsOverrideSchema` is a closed server allowlist for actor label, selected
test URLs and timeouts, display, capture, browser and provider settings, plus the DCC3 leaves
`ocr.pageConcurrency`, `ocr.maxValidationRetries`, `concurrency.defaultWorkers` and
`paths.reportsDir`. The report-output destination is the sole admitted path: `stateRoot`,
`artifactRoot`, `browserProfileRoot`, credential/auth paths and every other path remain excluded.
Credentials, annual dates and other non-admitted environment-owned leaves cannot enter `.tracker/settings.json`; widening the
general config schema cannot widen the editor by accident. `SETTINGS_SCHEMA_HASH` is derived from
that exact editable schema, and the command also binds the canonical patch fingerprint and the full
canonical command-envelope fingerprint.

`src/infra/config/settings-file.ts` owns one revisioned file envelope. Under its exclusive file
authority it strictly validates regular-file ownership, permissions, link count and size; durably
prepares the exact prior and next bytes; writes a private temporary file; fsyncs and atomically
replaces; then verifies exact readback. The enclosing SQLite transaction records the command,
audit and canonical `settings_current` singleton. Dashboard boot separately activates the runtime
generation in SQLite with its exact config snapshot. Boot reconciliation
keeps the next bytes only for that exact committed identity, restores exact prior evidence for a
proved absent outcome, and otherwise fails loud. A retry of an already-applied settings command
performs this reconciliation before returning success.

An exception reported after SQLite COMMIT must not trigger blind file compensation: the kernel
re-reads the command and verifies the exact audit/current conjunction before settling a committed
result. It compensates only on proved command absence; a failed inspection retains uncertainty.
After staging, the writer checks destination bytes again before replacement and refuses a concurrent
change. Separately, it verifies directory ownership, mode and full ancestry before lock acquisition,
file operations and settlement. The authority directory must be runtime-owned without group/world
write; ancestors must be root/runtime-owned, with foreign write allowed only under sticky semantics.
Owned 0755 directories are valid. Application symlinks refuse; root-owned system aliases under
root-owned parents retain their inode and have their target ancestry verified too. A raw symlink
target containing a whole `..` component refuses before lexical normalization, so validation cannot
skip an intermediate symlink that physical traversal follows. Every bound pathname retains its
device/inode; a missing or replaced bound directory refuses without recreation, chmod or evidence
cleanup. These guarantees assume local POSIX ownership/mode/sticky enforcement and trusted root
and runtime UID; they do not audit ACL grants or protect against privileged mounts or same-UID/root
interference. Private 0600 files alone are not this directory-integrity proof.

Dashboard and worker composition both reconcile and read this same authority, pass its sparse
settings into `resolveConfigWithProvenance`, and require the resulting revision/settings/config
identity before starting or claiming work. The merge now includes `browser` and every other
resolver-accepted group, so a persisted leaf reads back with `settings` provenance unless a named
environment binding wins. Precedence remains **`env > settings > default`**. DCC3 retains the existing
server-listed eight-leaf editor and exact persisted/active readbacks. Its visible inventory is not
the whole backend allowlist. `src/server/settings-runtime.ts` derives that read-only wire from the
selected file/current/runtime authorities; no separate mutable runtime-generation file exists.
> 2026-09-04 | D331 | SUPERSEDED: "Precedence remains `env > settings > default`" → `settings > default` (§D331.8). DCC3's eight-leaf editor is superseded AS A BOUNDARY: the editable schema becomes the whole `ordinary-settings` class and the catalog is the ONE generator of the persisted schema, the editor inventory and the resolver input (§D331.5); "its visible inventory is not the whole backend allowlist" ceases to be true. Credentials and canary inputs enter `.tracker/settings/protected.json` under their own schema, never the ordinary document; annual dates and every other operator-managed leaf become ordinary rows. The as-built file protocol in the two paragraphs above is REUSED for both documents under one lock (§D331.3).

The previous broad-hash envelope without `lastApplied` is incompatible and refuses by contract;
there is no implicit data conversion. Runtime-state migration needs separate authorization.

### D327 — one settings catalog and protected root (planned in 0.3, implemented in 1.6)

D327 supersedes the current single-file/sidecar layout and the blanket `env > settings > default`
precedence for operator-managed non-provider-key values. One closed catalog must enumerate every
local configuration leaf exactly once with its schema, default kind, editability, sensitivity,
restart scope and owning consumers. One protected `.tracker/settings/` root holds its revisioned
ordinary settings, protected credentials/local canary inputs, authority metadata, prepare/rollback
evidence and lock/journal material. The directory remains inside the D321 state root and remains
bound to the durable SQLite command journal; deleting `.tracker` still removes both halves.

The catalog distinguishes sources rather than flattening them:

- ordinary operator-managed settings persist under `.tracker/settings/` and have revision/CAS
  updates;
- usernames, passwords and local canary/test inputs also live there under stricter protected,
  write-only storage and return only presence/revision metadata;
- provider API keys are the sole values left in `.env` and retain the secure-bootstrap boundary;
- host observations such as D324's probed primary display remain derived defaults, not persisted
  settings, unless the operator saves an explicit override.

No migrated leaf retains environment precedence as a shadow authority. Phase 0.3 must define the
exact catalog, file split, permission/redaction model, source transition, restart semantics and
failure recovery before implementation. The upgrade imports current admitted non-provider-key
values once, refuses ambiguous duplicates and preserves provider API keys in place. It requires an
explicit verified D322 `cli storage backup`; a transactional migration journal is not an automatic
backup cadence. Phase 1.6 owns the repository, writers and core runtime resolution, Phase 2.6 owns
downstream consumers, and Phase 3.1 owns the Settings/Setup interface.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R02 | designed as **D331** (§D331.1–§D331.12 below); no runtime code changed (D326). 0.3 Task 3 owns migration/recovery; 1.6 implements; §D331.11 lists the owed proofs.

##### D331 — the settings catalog and protected root contract (0.3 Task 2, 2026-09-04)

D327 required the settings half of the authority reset to be DESIGNED before 1.6 implements it. This
subsection is that design: one closed catalog that enumerates every local configuration leaf exactly
once, five source classes with exactly one active authority each, one protected `.tracker/settings/`
root that supersedes D321's single-file layout while keeping its database-journal coupling, one
revisioned compare-and-swap update API with two closed arms, a write-only protected-value policy
with presence/revision readback, one restart-scope vocabulary that names where the D330 claim
token's four fields come from, and a precedence rule under which a resolver leaf has exactly ONE
source. It changes no runtime code (D326): Phase 1.6 implements the repository, writers and core
resolution; 2.6 rewires downstream consumers; 3.1 builds the Settings/Setup interface (§D331.10).
Migration, read-forward and recovery from today's `.env`/`settings.json`/registry layout are 0.3
Task 3's, not this subsection's; §D331.12 names what this subsection supersedes.

**Vocabulary.** A *leaf* is one catalogued configuration value with one key. A *source class* is
where a leaf's value is allowed to come from; a leaf has exactly one. The *ordinary document* is the
revisioned JSON document of operator-managed non-protected leaves. The *protected store* is the
separately revisioned file of credentials and local canary/test inputs. The *resolver* is the ONE
function that turns (ordinary document, host facts, contract defaults) into a `Config`; it never
sees a protected value. A *generation* is D330's runtime token (§D331.7).

###### D331.1 — the catalog: one closed registry, one row per leaf

The catalog is CODE, not a document: 1.6 lands it as one parsed and recursively frozen registry
(`src/domain/config/catalog.ts`, name illustrative) with exactly one row per leaf, and the guard
lane proves it bidirectionally complete against every source it enumerates — every populated
`ConfigSchema` leaf, every `SECRET_SPECS` / `TEST_TARGET_SECRET_SPECS` entry, every
`SECRET_FAMILY_SPECS` family and every `config-default` / process-ownership channel of
`runtime-environment.ts` has exactly one row, and no row names a leaf that does not exist. A leaf
without a row, or a row without a leaf, is a red gate, never a rendering gap (the same posture as
§3's bidirectional provenance). §D331.9 is the human-readable projection of that registry, frozen
here as the design's enumeration; when 1.6's registry and §D331.9 disagree, the registry is wrong
until the disagreement is a ratified decision.

A row carries these columns, every one a closed enum or a literal — never free text:

| Column | Values | Meaning |
|---|---|---|
| `key` | the resolver's `ConfigLeafPath` (`group.leaf`), or a secret name (`ucpathPassword`), or a family name (`gemini`) | the ONE name a consumer asks for; also the row's identity |
| `schema` | a zod schema reference by name | the value contract; the catalog never redeclares it — it POINTS at `schema.ts` / `secret-names.ts` |
| `defaultKind` | `contract` (a `.default()` in `schema.ts`) · `runtime-path` (D121, `runtime-paths.ts`) · `host-derived` (D324, probed once per process tree) · `none` (absent is a valid, distinguishable state; the consumer decides) · `required` (absence refuses by name at the consumer's first use) | WHERE the default comes from; a leaf has exactly one |
| `editability` | `operator` (writable through the update API, §D331.5) · `deployment` (writable only by a code change; the row names the file) · `derived` (never written; observed) · `machine` (written by the runtime itself, never by an operator) | who may change it |
| `sensitivity` | `ordinary` · `protected-identifier` · `protected-secret` · `provider-key` · `derived-host` | the redaction class AND the storage class; joins §6's `classification` one-to-one (`direct-identifier` → `protected-identifier`, `secret`/`credential-file` → `protected-secret`) |
| `restartScope` | `generation` · `next-start` · `next-use` · `process` | when a change takes effect (§D331.7) |
| `sourceClass` | `ordinary-settings` · `protected-store` · `provider-env` · `derived-host` · `runtime-isolation` | the ONE active authority the value comes from (§D331.2) |
| `consumers` | one or more `{ module, purpose }` literals | who reads it; the guard proves every consumer listed exists and every reader of the key is listed |
| `currentSource` / `targetSource` | closed `{ kind, name }` pairs (`env:UCPATH_PASSWORD`, `settings.json`, `registry`, `probe`) | the migration edge 0.3 Task 3 consumes; identical on both sides for an unmoved leaf |

Two consequences the columns force. **`sensitivity` decides storage, not the operator's taste**: a
`protected-*` row can only have `sourceClass: protected-store`, a `provider-key` row only
`provider-env`, a `derived-host` row only `derived-host`; the registry's `superRefine` refuses any
other pairing, so a credential cannot be catalogued into the ordinary document by a typo. **A leaf
has one `sourceClass`**, so "read it from settings, else from the environment" is not expressible
in the catalog's type — that is how §D331.8's precedence rule is enforced rather than intended.

###### D331.2 — the five source classes and the one authority per class

| Source class | Members (§D331.9 is exhaustive) | The ONE active authority | Read through |
|---|---|---|---|
| `ordinary-settings` | every operator-managed non-protected leaf: actor label, the nine `urls.<system>.test` overrides, every `timeouts.*`, the four operator paths (`reportsDir`, `downloadsDir`, `onboardingDocsDir`, `i9CheckTrackerPath`), `annualDates`, `display` (as an explicit override only), `performance.*`, `ocr.*`, `browserHealth.*`, `browser.*`, `concurrency.*`, `daemon.*`, `features.*`, `providers.<capability>.*` budgets, and the five provider MODEL CHAINS (model ids are not secrets; §6 kept them in the secrets module only because it was the sole environment reader — that reason expires with the environment layer) | `.tracker/settings/settings.json`, revisioned (§D331.4) | the resolver, into `Config`; provenance `settings` or `default` |
| `protected-store` | `ucpathUserId`, `ucpathPassword`, `timekeeperName` (it leaves `operator.timekeeperName` and `Config` entirely — its dual `config-and-secret` channel is retired), `sharepointOnboardingRosterUrl`, the D288 pseudonym HMAC key and its public generation id (stored as one pair so a rotation cannot split them), and the local canary/test inputs (`separationsKualiFinalizationCanaryDocumentNumber`, `personLookupCanaryEid`) | `.tracker/settings/protected.json`, separately revisioned, write-only (§D331.6) | the secrets accessor (`requireSecret` / `optionalSecret` / `inspectSecret` / `optionalTestTargetSecret`), whose SOURCE becomes the protected store; the resolver never sees these |
| `provider-env` | the five `SECRET_FAMILY_SPECS` key pools (`GEMINI_API_KEY{,2..8}`, `GROQ_…`, `MISTRAL_…`, `OPEN_ROUTER_…`, `SAMBANOVA_…`) — API KEYS ONLY | the repository's fixed `.env`, admitted by the secure bootstrap (unchanged) | `requireSecretFamily` / `optionalSecretFamily` |
| `derived-host` | `HRAUTO_HOST_PRIMARY_DISPLAY` (D324) — the probed primary display | the once-per-process-tree probe, published on the `config-default` channel | the resolver's DEFAULT layer for `display`, beneath an explicit ordinary override |
| `runtime-isolation` | `paths.stateRoot`, `paths.artifactRoot`, `paths.browserProfileRoot`, `paths.duoCredential`, `paths.duoExtensionDir` (D121/D216/D321) and the Duo WebAuthn credential FILE (machine-written under the profile root; `credential-file`, read by `requireSecretFile` only) | `config/runtime-isolation.json` + `runtime-paths.ts` (a code change), the ceremony | the resolver (paths) / `requireSecretFile` |

**The environment layer of the resolver is RETIRED for catalogued leaves.** After 1.6,
`CONFIG_ENV_BINDINGS` is empty and `resolve.ts` takes no environment override input at all; its
inputs are (the ordinary document, the host facts, the contract/runtime-path defaults). What remains
environment-sourced is exactly: provider API keys (through the secrets accessor, never the
resolver), the `config-default` host display publication (a DEFAULT, not an override), the
process-ownership launch nonce, and the test-lane-only keys the environment registry already
classes `test-only`. The resolver signature loses its `env` parameter outright:
`resolveConfig(document, hostFacts, clock?)`, where `hostFacts` is a strict object the composition
root builds from the `config-default` channel — never `process.env` itself and never a projection of
it (today `configResolutionEnvironment` returns `process.env` by identity, which is the latent
channel through which a "migrated" leaf could keep a shadow authority). The bootstrap's `.env` admission does not change shape — it changes what it
will ACCEPT (§D331.8).

**What is deliberately NOT under `.tracker/settings/`.** The Duo WebAuthn credential file stays
under the browser profile root because the runtime, not the operator, writes it (its signCount and
lock protocol are ref execution-and-sessions'); the isolation paths stay code because two runtimes on
one machine must not be able to point at each other's roots by editing a file (§Operational
isolation). Both are catalogued (`editability: machine` / `deployment`) so the enumeration is
complete, and both are excluded from the update API by that column, not by omission. Two things are
NOT configuration and are excluded from the catalog BY NAME rather than catalogued: the dashboard
launch nonce (`HRAUTO_DASHBOARD_LAUNCH_NONCE`, process-ownership evidence between the launcher and
Vite) and the environment registry's `test-only` keys (test-lane inputs that never target a
production leaf). The registry's `retired-in-target` list is the third non-catalogued set, and
§D331.8 grows it.

###### D331.3 — the protected root: `.tracker/settings/`

D321 put `settings.json` and five siblings directly in the state root (as built:
`join(stateRoot, "settings.json")` plus `.lock`, `.lock.reaper`, `.authority.json`,
`.prepare.json`, `.rollback.json`). D331 moves that whole family one level down into ONE directory
and adds the protected store beside it. Nothing else may live in the directory; an unlisted entry
is an integrity refusal by basename, never ignored.

```
<stateRoot>/settings/            directory · mode 0700 · owner = runtime UID · every ancestor verified
                                 from the filesystem root before any lock (lesson 2026-08-30: walk,
                                 create missing components one at a time below verified ancestors,
                                 refuse application symlinks and any raw `..` symlink target, bind
                                 dev/inode and recheck before admission, file ops and settlement)
├── settings.json                the ORDINARY document · 0600 exactly · nlink 1 · ≤ 1 048 576 B ·
                                 `SettingsFileRecord` (revision, settingsSchemaHash,
                                 settingsFingerprint, settings, lastApplied?) — unchanged shape
├── protected.json               the PROTECTED store · 0600 exactly · nlink 1 · ≤ 64 000 B ·
                                 `ProtectedStoreRecord` (§D331.6) — never backed up, never served
├── authority.json               the initialization sidecar for BOTH documents: `{ schemaVersion,
                                 rootFingerprint, settingsSchemaHash, protectedSchemaHash,
                                 ordinary: "virgin" | "initialized", protected: "virgin" | "initialized" }`
├── prepare.json                 transient · at most one · names its `target: "ordinary" | "protected"`
├── rollback.json                transient · at most one · names its `target`
├── settings.lock                ONE lock for the whole root (the atomic hard-link claim, its
└── settings.lock.reaper         acquisition twin and the stale-reaper barrier — protocol unchanged)
```

**One lock, two documents.** Both arms of the update API (§D331.5) serialize on the same lock, so
there is no lock ordering, no cross-document race, and one reaper. The prepare/rollback protocol is
the as-built one (root CLAUDE.md lessons 2026-08-28/08-30, lifted verbatim into 1.6's brief), applied
per target: a prepare record holds the exact prior and next bytes of the target document AND of
`authority.json`, and settlement/rollback restores or keeps them as one unit. The two documents are
never written in one command; a command names exactly one target.

**Every file is a private regular file read through one no-follow descriptor** (`readPrivateRegularFile`
semantics: `O_NOFOLLOW`, fstat that descriptor, regular, nlink in the allowed set, owner = runtime
UID, mode exactly `0600`, size within the file's bound by stat AND by bytes read, post-read fstat
identical). A group- or world-readable `protected.json` is a refusal naming the file, never a
warning: the value it protects is a live SSO password.

**The D321 coupling is kept and doubled.** Deleting `.tracker` deletes the directory, the database
that journals it, and the backups' subject together; a fresh `npm run dashboard` regenerates the
root, a migrated database, the never-applied revision-1 ordinary baseline and an EMPTY revision-1
protected store (every entry absent — the dashboard opens; the first credential-needing action
refuses by key name). A document whose revision is above 1 while the database holds no matching
journal row refuses by document name ("no durable command journal for protected.json"), exactly as
today's rule for `settings.json`. The journal side is two singletons (§D331.4).

**Backups (D322) copy the ordinary half only.** `cli storage backup` includes `settings.json` and
`authority.json` in its verified manifest; it NEVER copies `protected.json` (a backup is a second
copy of a password the operator did not ask to make). The manifest records the protected store's
revision and each entry's `{ name, valueId, updatedAt }` so a restore can say which entries must be
re-entered. What a restore does with that is 0.3 Task 3's; D331 fixes only that a restored root
reports those entries `absent`, never regenerates them, and never treats their absence as "not
configured by choice".

###### D331.4 — revision, journal coupling and the two singletons

Each document has its own monotonic `revision` (1 = the never-applied baseline). The as-built
rules for the ordinary document stand unchanged: the file's `lastApplied` binds the command id,
whole-envelope fingerprint, expected revision, schema hash and patch fingerprint; the SQLite
`settings_current` singleton (`revision ≥ 2`, `settingsFingerprint`, `commandId`,
`commandFingerprint`, `auditId`, `committedAt`) is written in the same transaction as the command
and audit rows; boot reconciliation keeps next bytes only for that exact committed identity.

The protected store gets the SAME protocol under a second singleton, `protected_settings_current`:
`{ revision ≥ 2, commandId, commandFingerprint, auditId, committedAt, entries: [{ name, valueId,
updatedAt }] }`. It holds NAMES and write identities only — no value, no digest, no MAC, no length.
`settings_current` and `protected_settings_current` are independent: advancing one never touches
the other, and only the ordinary one participates in the runtime generation (§D331.7).

**CAS is the only mutation protocol** (the same sentence as D330.4, on purpose). Every apply carries
the target document's `expectedRevision`; a mismatch refuses `revision-conflict { currentRevision }`
with nothing written and no lock held longer than the read. There is no unconditional write, no
"latest wins", and no merge of two concurrent patches.

###### D331.5 — the update API: one command family, two closed arms

The settings command family is exactly two commands, both through the existing loopback command
ingress (Host/Origin door, `application/json`, server-stamped `requestedBy`/`source`/time, one
command id from acceptance to settlement, bulk parents unchanged):

| Command | Target | Payload | Result |
|---|---|---|---|
| `apply-settings` (exists) | `{ expectedRevision }` of `settings.json` | `{ settingsSchemaHash, patchFingerprint, patch }` — `patch` is the closed editable schema, which under D331 equals the `ordinary-settings` class EXACTLY (every row with `editability: operator`; §D331.9 is the list). DCC3's eight-leaf allowlist is therefore superseded as a boundary — it becomes the first eight rows of a longer closed list, not a second list | `{ revision, settingsFingerprint, restartRequired: true }` |
| `apply-protected-settings` (new) | `{ expectedRevision }` of `protected.json` | `{ protectedSchemaHash, writeId, entries }` — `entries` is a closed strict object keyed by protected NAME whose values are `{ set: <value> }` or `{ clear: true }`; `writeId` is a client-minted UUID naming this write | `{ revision, entries: { <name>: { present, valueId?, updatedAt? } } , restartRequired: false }` |

**The two envelope fingerprints differ in what they cover, and that difference is the design.** The
ordinary command's fingerprint covers the whole canonical envelope INCLUDING the patch (values are
not secret; a replay must reproduce them). The protected command's fingerprint covers the whole
canonical envelope with every `set` value replaced by the literal marker `"<set>"` — it binds the
command id, actor, source, time, reason, expected revision, `writeId` and the SET/CLEAR SHAPE of
`entries`, and never the value bytes or any function of them (a hash of a password is an offline
guessing oracle, and the journal is not 0600). The durable command row and its audit `request` hold that MARKED
envelope — never the submitted one — and boot re-authentication (today a byte comparison of
`canonicalJsonStringify(audit.request)`) compares marked bytes to marked bytes, so the journal's
authentication protocol works without ever retaining a value. Divergence of a VALUE under an exact
replay is detected inside the executor, under the lock, against the store's own keyed MAC
(§D331.6) — the journal never learns it. (A journaled per-value digest was considered and rejected:
a salted or unsalted hash of a password in a non-`0600` table is an offline guessing oracle, and the
random `valueId` already gives the journal a stable write identity without one.)

**Refusal arms** (closed; every arm names the key or document, never a value):

| Arm | When | Before authority access? |
|---|---|---|
| `schema-mismatch` | the caller's schema hash ≠ the build's | yes — request-only (lesson 2026-08-30: refuse before lock or `readState`; even a read initializes virgin evidence) |
| `patch-fingerprint-mismatch` / `envelope-fingerprint-mismatch` | recomputed ≠ supplied | yes |
| `not-editable { key }` | a key whose catalog `editability ≠ operator`, or a protected name absent from the catalog | yes — the catalog is static |
| `invalid-value { key }` | zod refusal on the leaf's own schema (the protected arm validates through the SAME per-name schema the accessor uses — `KualiDocumentNumberSchema`, `EidSchema`, the 64-hex HMAC shape…) | yes |
| `revision-conflict { currentRevision }` | CAS | no — under the lock |
| `cross-field-invalid { keys }` | the fully merged ordinary candidate fails the composition's resolver (lesson 2026-08-28: individually valid leaves can break a cross-field invariant on restart) | no |
| `document-too-large` | the canonical next bytes exceed the target's bound; the prior file is untouched | no |
| `authority-unjournaled` / `authority-uncertain` | D321 rule; surviving prepare/rollback evidence | no — refuses restart reconciliation and any apply by name |
| `directory-integrity` / `lock-unavailable` | §D331.3 checks; the reaper protocol's refusals | no |
| `already-applied { revision }` | byte-exact envelope replay under the same command id (protected: same fingerprint AND every `set` value's MAC matches) | no |
| `command-divergent` | same command id, different fingerprint — or, protected arm only, same fingerprint and a `set` value whose MAC differs | no |

**Wire mapping.** One bootstrap/readback wire (`settings-runtime.ts`'s successor) serves, per
catalogued row: for `ordinary-settings` the persisted, active and default values with provenance
(as DCC3 does today) plus the row's `restartScope`; for `protected-store` the presence tuple only
(§D331.6); for `provider-env` `inspectSecret`-shaped availability per family (`present` with the
count of populated pool cells, `missing`, `unknown`) and NOTHING else; for `derived-host` the
observed value and its provenance `default`; for `runtime-isolation` the resolved absolute paths,
read-only. The browser never reads a file or a table and never reconstructs either document
(ref frontend-backend-integration §4).

###### D331.6 — protected values are write-only; readback is presence and revision

`ProtectedStoreRecord`:

```
{ schemaVersion: 1, revision, protectedSchemaHash,
  storeKey: <32 random bytes, base64>,                 // minted at store creation, rotated never; MAC key only
  entries: { <name>: { valueId: uuid, value: <the exact string>, updatedAt: iso,
                       mac: HMAC-SHA256(storeKey, name ‖ valueId ‖ value) } },
  lastApplied?: { commandId, commandFingerprint, expectedRevision, protectedSchemaHash, writeId } }
```

The rules, each a proof 1.6 owes (§D331.11):

1. **Never returned after write.** No wire, receipt, span, log, notification, preflight/doctor
   report, diagnostic bundle, XLSX export, Explorer projection or error message carries a protected
   VALUE, a digest of it, its length, a `last4`, a "matches?" comparator or a "changed since"
   diff. The readback tuple is exactly `{ present: boolean, valueId?, updatedAt? }` per catalogued
   name, plus the store `revision`. (`§6`'s evidence transforms are unchanged for RUN evidence: a
   receipt may still carry the `last4` §6 already permits for a `direct-identifier` observed during
   a run — that is evidence redaction, not a Settings readback, and it is produced by the run, not
   by the store.)
2. **Never in a fingerprint or a snapshot.** A protected value is not a `Config` leaf, so it is not
   in `configFingerprint`, not in `settingsFingerprint`, not in the provenance map, not in a
   per-run config snapshot, not in the D330 claim token. `timekeeperName` leaves `ConfigSchema`
   (`operator.timekeeperName` is deleted, not emptied); its consumers call the accessor.
3. **Never in a child's environment.** Today a worker inherits credentials because the bootstrap put
   `.env` into the parent's `process.env`. Under D331 the parent publishes NOTHING protected: each
   process reads the store itself through the accessor under the same file checks. The
   `secrets-single-source` guard extends to forbid any `process.env` WRITE of a catalogued protected
   name, and the environment registry lists every migrated name as `retired-in-target` so a stale
   shell export is a boot refusal by name (§D331.8), never a silent shadow.
4. **The MAC never leaves the file.** It exists for one purpose: under the lock, an exact replay of
   `apply-protected-settings` proves its `set` values are the values the first apply stored
   (`already-applied`) or are not (`command-divergent`). It is not journaled, not served, not
   logged, and not a password-verification oracle (there is no "check this password" command).
5. **Absent is a valid state, and it is distinguishable.** An entry that was never set or was
   cleared is `present: false`; the accessor's `requireSecret` throws `SecretMissingError` naming the
   KEY; `inspectSecret` answers `missing`; a store that cannot be read (mode, owner, size, parse)
   is `unknown` and re-throws everything else. "The check failed" is never "the check found nothing".
6. **Canary inputs are protected, not ordinary.** `config/test-subjects.json` stays the committed
   PUBLIC registry (label → workflow, kind, availability, `lastObserved`, reference NAME);
   `optionalTestTargetSecret` reads the protected store by that name with the same per-kind schema.
   D300's semantics are unchanged — unset is `blocked` by key, malformed is a defect by key, the
   number is never copied into a name or EID field — only the SOURCE moves from `.env` to the
   store. A person-lookup EID canary is a `protected-identifier`; a Kuali document number is a
   `protected-identifier` too (it resolves to a person).
7. **Clear is a write.** `{ clear: true }` removes the entry and retires its `valueId`; it is
   journaled, CAS-fenced and revision-advancing like a set.
8. **Historical exposure is named, not erased.** Today `operator.timekeeperName` is a `Config` leaf,
   so every existing `config_snapshots` row carries the timekeeper's name verbatim, every
   `configFingerprint` has it in its preimage, and every `cli storage backup` copied it. §4.1
   forbids rewriting a released snapshot generation for three reasons that still hold; D331 records
   this as ACCEPTED historical exposure of one `direct-identifier` (never a password, never a
   canary), requires backup files to stay `0600` under existing writer hygiene (§6.1), and forbids
   any claim that the migration erases it. Retiring the leaf also needs an explicit RETIREMENT arm in
   `snapshot-generations.ts` (`auditConfigSnapshotGenerations` refuses a vanished registered leaf
   today) — an owed 1.6 change, and 0.3 Task 3 owns the generation rule.

###### D331.7 — restart scope, and where the D330 claim token comes from

| `restartScope` | Rows | Takes effect | Mechanism |
|---|---|---|---|
| `generation` | every `ordinary-settings` row; the `derived-host` display default | at the next dashboard boot, for every process the dashboard then spawns | `apply-settings` advances `settings_current`; the dashboard's boot activates a new runtime generation with the resolved config; workers compare the token on every claim |
| `next-use` | every `protected-store` CREDENTIAL row (`ucpathUserId`, `ucpathPassword`, `timekeeperName`, `sharepointOnboardingRosterUrl`, the pseudonym pair) | at the next accessor call | the accessor reads the store at each use; nothing caches a credential across uses; a run that already holds a browser session keeps it |
| `next-start` | the canary/test-input rows | at the next dry-run start admission | admission reads the store once and retains the reference NAME (never the value) in the run's start record |
| `process` | `runtime-isolation` rows; the launch nonce; the host display PROBE | at the next process start | code / launcher / once-per-process-tree probe (D324: a child never re-probes) |

**The claim token's four fields, by provenance** (R01 residue, closed here):

| Field | Minted by | Value |
|---|---|---|
| `generation` | the dashboard's boot activation (`runtime_config` singleton), monotonic across boots | +1 per activation; never reused |
| `settingsRevision` | `settings_current` (the ORDINARY document's revision) | the revision the activation resolved from |
| `settingsFingerprint` | SHA-256 over the canonical ordinary document bytes | must equal `settings.json`'s own `settingsFingerprint` at activation |
| `configFingerprint` | SHA-256 over `canonicalJsonStringify(config)` for the resolver's output over (ordinary document, host facts, defaults) | the snapshot identity every run retains (§4) |

The protected store's revision is NOT a token field, by design: a credential rotation must not make
every idle worker `runtime-stale`, and it must not invalidate an in-flight claim — D330.4's rule
("a generation advance never touches an in-flight claim") holds a fortiori for a write that advances
no generation. A worker that claimed under generation N and reaches its first login after a
protected apply logs in with the NEW credential: that is the `next-use` scope working, and the run's
receipt names the run, not the credential revision.

**A saved display override versus a changed host.** The probe is `process` scope and the leaf is
`generation` scope, so: with no override, plugging in a different monitor changes nothing until the
next dashboard boot, whose activation carries a new `configFingerprint` (the default moved) — every
worker it spawns inherits the published value, and the old generation's idle workers refuse
`runtime-stale` on their next claim. With an explicit override saved, the host change is invisible
to `Config` at any boot; the Settings surface shows the override AND the current host observation
side by side so the operator can clear the override deliberately (§D331.10). The override is an
ordinary row; the observation is never persisted.

###### D331.8 — precedence: a leaf has exactly one source

**The rule.** For an `ordinary-settings` row the value is `settings > default`, where `default` is
the row's `defaultKind` (`contract`, `runtime-path` or `host-derived`). For every other class the
value is its one authority (§D331.2) and there is no second layer at all. `ConfigProvenanceSchema`
shrinks to `"settings" | "default"`; the `"env"` arm is deleted, not deprecated. §3's sentence
"One resolver implements `env > settings.json > default` exactly once" is superseded by the dated
note beside it: one resolver implements `settings > default` exactly once, and the ENVIRONMENT IS
NOT AN INPUT to it.

**What "duplicate fallback authorities are forbidden" means, mechanically:**

- The catalog's type admits one `sourceClass` per row (§D331.1), so a second source is
  unrepresentable, not merely unadvised.
- `CONFIG_ENV_BINDINGS` is empty and its registry type is retained only so the guard can assert
  emptiness; `runtime-environment.ts`'s `config` channel has zero members; `TIMEKEEPER_NAME`'s
  `config-and-secret` dual channel is deleted with its leaf.
- Every migrated environment key (the 32 config bindings, `UCPATH_USER_ID`, `UCPATH_PASSWORD`,
  `TIMEKEEPER_NAME`, `ONBOARDING_ROSTER_URL`, the two pseudonym keys, the two canary keys, the five
  `OCR_*_MODELS` chain keys) moves to `RETIRED_ENVIRONMENT_KEYS`. A retired key PRESENT in the
  admitted `.env` refuses at bootstrap by key name with the remedy ("set it in Settings, then remove
  it from `.env`"); a retired key present in the parent process environment is reported by the
  environment doctor (§6.2) and refuses dashboard and worker boot by key name. Neither is ever read
  as a value. This is the "stale `.env` leaf shadowing a migrated value" case closed at the door: a
  value that cannot be read cannot shadow.
- The `.env` admission allowlist becomes: the five provider key families' pool cells, and nothing
  else. The bootstrap's mechanics (no-follow open, `mode & 0o077 === 0`, 64 000-byte bound, strict
  grammar, one-to-one `parseEnv` cross-check, explicit parent bindings win) are unchanged; only the
  set of keys it will carry into the process changes. Unknown keys were already refused.
- `SettingsOverrideSchema` (the resolver's sparse input) and `EditableSettingsOverrideSchema` (the
  persisted/editable document) become ONE schema over the `ordinary-settings` class: the resolver
  accepts exactly what the document can hold, so no composition can inject an override the operator
  cannot see. The `paths` group of that schema holds the four operator paths only; the five
  isolation paths are not overridable by any input.
- Test-lane keys (`HRAUTO_E2E_STUBS`, `PARITY_UPDATE`, `SEL_SESSION`, …) stay `test-only` in the
  environment registry; none targets a catalogued leaf, and the guard keeps it that way.
- The `config-default` channel has exactly ONE member, the host display publication. No other leaf
  may ever use it; a second `config-default` member is the "no shadow authority" rule reopened
  through the default layer, and the environment-coverage guard pins the channel's cardinality.
- Three properties of the retired environment layer are RESTATED as document-layer invariants so
  they do not vanish with it: (i) `annualDates.<FY>` is group-valid — an entry is either complete
  (all three dates) or absent, enforced by the document schema and re-checked by `cross-field-invalid`,
  never a half-year that parses; (ii) a leaf is UNSET by omission from the sparse document — there
  is no "empty string means unset" rule because the document is typed JSON, not text, and an empty
  string is an `invalid-value` refusal wherever the leaf's schema does not admit it; (iii) no
  document input can move a production endpoint — the ordinary document schema has NO
  `urls.<system>.prod` member at all, so "production is the code default" (§4) stays a property of
  the schema rather than of the layer that was removed.

**What still comes from the environment, and why each is not a duplicate:** provider API keys
(secrets accessor, never the resolver — one authority, `.env`); the host display publication (a
DEFAULT beneath the ordinary override — the override is the only competing value, and it is the
operator's explicit one); the launch nonce (process ownership, not configuration); test-only keys
(never a production leaf).

###### D331.12 — what this contract supersedes (dated 2026-09-04)

Each item is also carried as a dated note beside the superseded text, so a reader of that section
meets the supersession where the old rule stood; the ledger row (`reference/decisions.md`) points
here.

1. **§3 "One resolver implements `env > settings.json > default` exactly once"** — the "exactly
   once" half stands; the precedence becomes `settings > default` and the environment is not a
   resolver input (§D331.8). `"env"` leaves `ConfigProvenanceSchema`. The same section's two
   factual errors are corrected in the dated note: the schema has 15 groups (there is no `capture`
   group — D294 retired it and `snapshot.ts` refuses to mint the key), and 33 bindings are registered
   today, not 38 (the five `HRAUTO_CAPTURE_*` names have zero occurrences in the tree). All 33 retire
   at 1.6.
2. **§3 "The settings producer and editable boundary"** — "Precedence remains `env > settings >
   default`" is superseded; "DCC3 retains the existing server-listed eight-leaf editor" is superseded
   as a BOUNDARY (the editable schema becomes the whole `ordinary-settings` class, §D331.5); "Its
   visible inventory is not the whole backend allowlist" ceases to be true — the catalog is the one
   generator of the persisted schema, the editor inventory and the resolver's input. "Credentials,
   annual dates and other non-admitted environment-owned leaves cannot enter `.tracker/settings.json`"
   stays true of the ORDINARY document for credentials and canaries (they enter `protected.json`
   under their own schema) and becomes false for annual dates and every other operator-managed
   leaf, which are ordinary rows. `SETTINGS_SCHEMA_HASH` moves with the catalog; the existing file's
   refusal under the new hash is the upgrade problem 0.3 Task 3 owns (a journaled rewrite under the
   new hash after a verified D322 backup, never a tolerated mismatch).
3. **§Operational isolation, D321's layout sentence** — "`settings.json` with its `.authority.json`,
   `.prepare.json`, `.rollback.json` and lock siblings" in the state root becomes the
   `.tracker/settings/` directory of §D331.3. The coupling sentences ("deleting `.tracker` removes
   both halves together"; "the next `npm run dashboard` recreates the root, a fresh migrated database
   and the never-applied revision-1 baseline") stand and now cover two documents. The as-built
   refusal text "remove settings.json and its .authority.json sidecar there" names files that will
   not exist; 1.6 rewords it with the directory.
4. **§6 "The three registries"** — `timekeeperName` (`source: environment`) and every other
   non-provider `SECRET_SPECS` row move to `source: protected-store`; the `source` discriminant gains
   that arm and `environment` survives only for the five provider families. `providerModelChain`
   stops reading the environment: model chains are ordinary rows (§D331.2). The two
   `direct-identifier` rows keep their classification and their §6 redaction join.
5. **§6 the bootstrap paragraph and §6.2** — the `.env` admission mechanics stand; its accepted key
   set shrinks to the provider families (§D331.8) and every migrated key becomes
   `retired-in-target`, reported by the environment doctor and refused at bootstrap/boot by name.
   The D300 `test-target-document-number` smoke selector stays a bootstrap arm but reads the
   document number from the protected store through `optionalTestTargetSecret`, not from `.env`.
6. **D300 (2026-09-01)** — its semantics are unchanged (one closed document-number reference; unset
   is `blocked` by key; malformed is a defect by key; never a name or EID in the registry). Its
   SOURCE sentence ("in `.env`") is superseded by §D331.6 item 6; its "only test-target secret"
   sentence is read as "the only test-target secret OF SEPARATIONS": the person-lookup
   `live-read` canary (`personLookupCanaryEid`, `docs/migrations/person-lookup.md` §T1b, D318's arm)
   is the second member of the class, registered per workflow label exactly as D284/D300 require.
7. **ref dashboard-surfaces §2.1** — the state-root tree still says `.tracker-rebuild/` (stale since
   D321, noted by R01); the dated note there names `.tracker/` and adds the `settings/` subtree.
8. **What is NOT superseded, and is cited rather than restated:** ref frontend-backend-integration
   §4's D327 ownership cut ("the browser never reads files/tables or reconstructs either authority")
   binds §D331.10; §4's immutable per-run snapshot and §4.1's generation rule bind §D331.7; D324 is
   preserved verbatim (§D331.2 `derived-host`); D322's explicit-only backup rule binds §D331.3;
   D330.4/§D330.6 bind the claim token; ref execution-and-sessions owns the Duo credential file's
   lock/signCount protocol; ref stores' catalog is unaffected (no task contract changes).

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

**D306 narrows `browser.headless` to a compatibility/default role.** New dashboard plans require an
explicit `headless`/`headed` selection and retain it in the immutable plan and run envelope; the
worker does not re-resolve current Settings to override that choice. Older and programmatic runs
whose stored contract has no selection continue to resolve this config leaf, preserving their
captured behavior without manufacturing a new historical field.

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

### Operational isolation: two runtimes, one machine (D88 · D216 · D247 · D321)

A repository boundary does not separate two runtimes on one host. The values that must differ are
**data** in `config/runtime-isolation.json` (schema version 3), and
`tests/unit/architecture/operational-isolation.test.ts` audits both real checkouts against them:

|                             | legacy                                           | rebuild                                          |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| state root                  | `.tracker`                                       | `.tracker`                               |
| artifact root               | `.tracker`                                       | `.tracker/artifacts`                     |
| backend / frontend port     | 3838 / 5173                                      | 3938 / 5174                                      |
| process locks               | `.tracker/daemons`                               | `.tracker/locks`                         |
| browser profile / session   | `.auth` / `hrauto-legacy`                        | `.auth` / `hrauto-rebuild`                       |
| launch commands             | `dashboard`, `dashboard:prod`, `dashboard:watch` | `dashboard`, `dashboard:prod`, `cli`             |

`DISTINCT_RESOURCE_KEYS` is `artifactRoot`, `processLockRoot`, `browserSessionNamespace`, plus
both ports checked in their own right. **Three entries in that table are deliberately EQUAL, and
each says why.**

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
- **`stateRoot` left the distinct list with D321** (operator decision, 2026-09-03): both repositories
  name their state root `.tracker`, and the roots are repo-relative, so the two runtimes never share
  a directory — the same argument D216 made for `.auth`. The artifact root (`.tracker/artifacts` vs
  `.tracker`), the lock root (`.tracker/locks` vs `.tracker/daemons`), both ports and the session
  namespace still differ and are still audited. **The state root must regenerate to defaults when deleted.** D321 therefore also moves the settings
  authority — `settings.json` with its `.authority.json`, `.prepare.json`, `.rollback.json` and lock
  siblings — from `config/` into the state root, beside the database whose command journal proves it.
  Deleting `.tracker` now removes both halves together, and the next `npm run dashboard` recreates the
  root, a fresh migrated database and the never-applied revision-1 settings baseline. Before D321 the
  settings file lived in `config/` and outlived a deleted state root, and the boot refused with
  "settings revision 2 has no durable command journal" — correct fail-loud, wrong place for the file
  (see ref lessons, 2026-09-03). The refusal now names that fix.
  > 2026-09-04 | D331 | the LAYOUT sentence is superseded: at 1.6 the family lives in the `.tracker/settings/` directory (`settings.json`, `protected.json`, `authority.json`, transient `prepare.json`/`rollback.json`, one `settings.lock` + reaper) — §D331.3. The COUPLING sentences stand and cover both documents: deleting `.tracker` removes both halves together; a document whose revision outlives its journal refuses by document name; the regenerated baseline is revision-1 ordinary plus an EMPTY revision-1 protected store. The refusal text naming `settings.json` and its `.authority.json` sidecar is reworded by 1.6.

Isolation values reach the runtime through ONE exported direct-`const` `defineRuntimeIsolation`
call (`src/config/runtime-isolation.ts`) whose schema is a strict object of `z.literal`s, consumed by
the declared exported `runCli` composition runner (`src/cli.ts` →
`startRebuildRuntime({ isolation })`). The secure environment bootstrap is the runner's sole
production invoker. The guard proves the binding and runner against a seeded fixture repository: a
drifted literal, a locally shadowed factory, a non-exported binding, a mention, another function, or
the wrong argument path each fail by name. An identifier mention is not proof.

**The runner returns the runtime's LIFETIME (2026-09-03).** `runCli` is `async` and awaits
`startRebuildRuntime`, which the secure environment bootstrap awaits in turn, so a rejection crashes
the process loudly instead of becoming an unobserved rejection. For `dashboard` that promise settles
only after the composed runtime stopped: the command awaits the first `SIGINT`/`SIGTERM` through an
injectable `signals` seam and then calls `composeDashboardRuntime`'s `stop()` exactly once — that
ordering (HTTP ingress → hub/timers → worker supervisor → database → process
lock) remains the sole shutdown authority, and this only awaits it. The production seam registers
both signals with `process.on`, never `process.once`: a `once` listener removes itself the moment it
fires, and a signal with ZERO listeners falls back to Node's default disposition. Both listeners
therefore stay subscribed until `stop()` SETTLES, so a second Ctrl+C during the drain is absorbed
rather than terminating the process mid-ordering and abandoning the database handle and the process
lock; only then does the disposer run, in `finally`. The binding guard therefore accepts `await startRebuildRuntime({ isolation })` as the ONE
direct call — every other dimension of that proof is unchanged.

### 4.1 The durable snapshot is versioned by its LEAF SET, not by the migration chain (D133)

<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
- [x] `src/domain/config/snapshot-generations.ts` is the config schema's own version line, separate from the SQLite migration chain — an ordered append-only registry naming the deciding decision, the leaves it introduced, and a literal SHA-256 over the complete leaf set at that generation (D133, 2026-08-04)
- [x] exactly ONE leaf is generation-gated today: `timeouts.sessionAcquireMs`, introduced by generation 2 (D125). Generation 1 (D121) is the shape the preserved Phase-1 exit database carries, and `POST_BASELINE_CONFIG_LEAVES` — the complete set a stored row may lack — is that one leaf and nothing else — and, since D267 (2026-08-21), `timeouts.duoCeremonyLeaseGraceMs` by generation 3 (ref execution-and-sessions §10.3)
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
| `duoWebauthnCredential` | file | `paths.duoCredential` (§4) | `credential-file` |
> 2026-09-04 | D331 | SUPERSEDED for `source`: at 1.6 `ucpathUserId`, `ucpathPassword`, `timekeeperName` and `sharepointOnboardingRosterUrl` (and the D288 pseudonym pair, and both test-target references) read from the protected store (`source: protected-store`, §D331.2/§D331.6); `environment` survives only for the five provider key families; `providerModelChain` stops reading the environment because model chains are ordinary rows. `timekeeperName` also leaves `ConfigSchema` — its `config-and-secret` dual channel is deleted with the leaf (§D331.8). Classifications and the redaction join are unchanged.

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
export function admitLocalEnvironmentFile(path, env?, access?): void;     // secure exact-byte startup
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
- **Neither batch validator has a production caller yet, and the list they would take does not
  exist.** `validateBootSecrets` and `validateDescriptorSecrets` are exercised only by
  `tests/unit/secrets-redaction.test.ts`, and no task contract or descriptor declares the secrets its
  tasks need — the `requires: SecretName[]` §9's first settled question assumes is unwritten. So the
  discovery mechanism today is the per-call `requireSecret` backstop: a run reaches its first
  credential-needing task and fails there, having already acquired a session. Closing it is two
  changes in one: the declaration on the contract, and the enqueue call that reads it.
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
- **The fixed local `.env` is admitted from the bytes that are actually used.** Package scripts do
  not ask Node or `tsx` to preload an environment file. Instead, the closed bootstrap accepts only
  the CLI or D300 `test-target-document-number` smoke selector, derives the repository's absolute
  `.env` from its own module URL
  (never `process.cwd()`), no-follow opens that exact path, and fstats that
  same descriptor before reading it. The shared registered-file validator requires a regular file,
  mode `0600` or stricter (`mode & 0o077` is zero), and the one 64 000-byte bound; the descriptor's
  exact bytes are then size-checked and decoded as fatal UTF-8. Before Node's `parseEnv` may see
  them, the accessor consumes those bytes with the project's closed `.env` grammar: uppercase
  registered-style keys, exactly one unambiguous assignment per meaningful line, unique keys,
  comments/blanks, CRLF, quoted `#`/`=`, and closed single/double/backtick values (including
  multiline quoted values). Junk, `export`, invalid keys, duplicates and unterminated quotes fail
  before any binding is applied. `parseEnv` is retained only after the strict pass and its key set
  must be one-to-one with that pass. The descriptor is then closed. Explicit parent-environment
  bindings win over parsed bindings. Only
  after admission may the bootstrap dynamically import and explicitly invoke the fixed inert CLI
  or smoke runner; importing or directly executing either runner module starts nothing. Arbitrary
  target execution is unrepresentable. Every refusal names only the public `.env` label and failure
  category, never an absolute path, binding or value. Tests may inject descriptor access into this
  same admission function; production callers receive no skip, alternate path or permissive mode.
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

The same guard resolves the two admitted runner exports through the TypeScript AST. The secure
bootstrap must dynamically import and invoke each runner exactly once after the canonical admission
call. Every other file is forbidden from importing, calling, aliasing, re-exporting or indirectly
invoking either runner; namespace/property access, promise `.then` callback destructuring and
`call`/`apply`/`bind` are resolved rather than searched as substrings. Literal and locally
computable dynamic-import specifiers are followed; a runtime-computed specifier is a loud refusal,
not an unreviewed safe path. The production scan covers `src/**`, `scripts/**`, and every external
Vite config derived from a direct static `vite --config <TypeScript path>` declaration in
`package.json`; a repository-local path to the Vite binary is the same executable identity. A
Vite-bearing package command must be one statically tokenized executable segment; shell control
syntax that could chain another executable is a loud refusal. Each admitted external config brings
its recursively discovered executable local import/re-export, TypeScript import-equals/CommonJS
require, and literal dynamic-import closure into the scan. That walk is repository-relative and
bounded by file count and total source size; a missing, unresolved, escaping, unreadable or
over-bound local source refuses, while bare package dependencies are deliberately outside this
source-provenance closure. Runner provenance survives object/array property selection and
destructuring. The current derived root is `vite.dashboard.config.ts`, pinned so package-script
drift is reviewed. Strings, comments and type-only imports are deliberately inert controls.

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

The closed direct-identifier family also covers employee/timekeeper names and the EID spellings
used by the codebase, including `eid`, `emplId`, `documentEid`, `employeeId`, and the reviewed
observed/expected/query variants. Presentation templates are exempt only when they are the direct
return expression that renders typed UI; a nested callback or local template is still a violation.
Runtime diagnostics project a bounded digest reference instead of a raw identifier, while typed UI
keeps a full EID as structured React content rather than first collapsing it into an opaque string.
The direct-identifier allowlist remains empty.

The scanner follows scoped aliases through declarations, assignments, single-return functions,
destructuring, direct object-literal payloads (property, shorthand, static-computed and spread
forms), object/array packing and property reads, including locally resolvable computed-key aliases
at both construction and read, as well as concatenation, conditionals, arrays, `join`, `String` and
`JSON.stringify`. A computed read whose key remains dynamic fails closed when the container's
provenance carries a sensitive value. It resolves aliased `Error`, `new Error`, logger/console calls
and `ctx.fail` as diagnostic sinks; console/logger method identity survives object/array packing,
property selection, destructuring, aliasing and `call`/`apply`/`bind`, with unresolved selection
from a sink-bearing container treated as a sink.
Structural EID/EMPLID suffixes cover target/person/current variants while
reviewed schema/field/path names and equality predicates remain descriptors. Alias provenance is
resolved before a descriptor-looking local name can claim an exemption. Natural idempotency-key
bindings join the closed sensitive family even
though their stable business identity is still retained in authority. A sanitizer exemption exists
only when the call resolves to the canonical imported helper in `src/domain/redaction.ts`; a local or
shadowed look-alike remains a violation. Likewise, the two descriptor-only exceptions are tied to the
real imported `defineWorkflowDescriptor` call: direct `presentation.title`/`subtitle` returns and the
durable `identity.matchKey` callback. Look-alike objects and shadowed factories receive no exemption.

### The planned successor: the OS keychain, behind this accessor

The desktop application will move credential STORAGE from `.env` to the operating system's keychain,
and the reason it can is this section: `requireSecret` / `optionalSecret` / `requireSecretFile` are
already the only readers, every entry is already registered with a source kind, and
`SecretSpecSchema` is already a discriminated union on `source` — so a `keychain` arm is an added
variant and a resolver branch, not a re-threading of the tree. That work is tracked as
`{#desk-secrets}`; nothing in this section changes shape for it, and the guard that makes the
migration safe (one owner, empty allowlist) is the one already green.

### Hygiene closure and remaining scope

- [x] **The rebuild `.env.example` is current and safe to instantiate.** It names the rebuild ports
  and commands, gives an `umask 077` / `install -m 600` creation sequence, carries the one D300
  public reference key (the canary's Kuali document number), and labels `CAPTURE_PUBLIC_URL` /
  `CAPTURE_NGROK_URL` as retired, unset legacy aliases rather than supported configuration. Startup
  enforces the resulting local file boundary as described above.
- [ ] **The example remains a curated setup surface, not a generated exhaustive inventory.** It
  intentionally does not enumerate every §3 config binding or provider-family slot. The separate
  `DOCUMENTED_ENVIRONMENT_KEYS` inventory remains hand-maintained, so exhaustive bidirectional
  example-to-binding generation is still open and is not evidence supplied by this closure.
- [x] **The live canary carries no person value at all, hardcoded or registered.** D286 (moved the
  employee display name, timekeeper display name and EID behind exact registered references) is
  superseded 2026-09-01 by D300: the canary is now ONE Kuali document number behind one closed
  registered reference in ignored `.env`; the three person-value references and their smoke retire,
  and the composed `separations` chain derives every person fact (employee name, document EID, the
  UCPath subject) live instead. Committed config and smoke output still carry only public
  field/reference/key metadata. See doc 03.3 Tasks 1–3 for the current acceptance admission.

### 6.1 Explicit single-operator/local scope

<!-- roadmap: later-unplanned -->

<!-- roadmap-status: later-unplanned -->
- [x] the BFF listener is loopback-only in code: it defaults to `127.0.0.1`, admits only `127.0.0.1` or `localhost`, and refuses anything else by name — `the dashboard BFF is loopback-only; refusing to bind <hostname>` (`src/server/dashboard/http-server.ts:45-50`)
- [x] no accounts, roles, permissions, teams, remote synchronization, high availability, secret manager, certificate management or signed audit anchoring exists, and D193(a) reaffirms that as the standing scope — not a gap
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

D294 retires the former capture ingress configuration and the ngrok credential source. The dashboard
is loopback-only; a future non-loopback feature requires a new threat model and decision rather than
reactivating those settings.

Local-only does **not** waive correctness or privacy hygiene. The tool still controls live HR
systems and stores sensitive evidence, so strict schemas, output redaction, least-retained capture,
file permissions (`0700` directories / `0600` authority, backup, evidence, and secret files),
loopback Origin checks, and no secret-bearing URLs or logs remain base requirements. These measures
also make diagnostic bundles safer to share with an AI assistant.

### 6.2 One environment doctor replaces scattered startup surprises

> 2026-09-04 | D331 | at 1.6 the doctor also reports every `retired-in-target` catalogued key present in the process environment or the admitted `.env` as a named refusal ("set it in Settings, then remove it"), so a stale exported credential or test URL can never shadow a migrated leaf (§D331.8).

<!-- roadmap: cross-cutting -->
<!-- roadmap: p1-authority -->

<!-- roadmap-status: cross-cutting -->
- [x] the strict preflight REGISTRY is built and bidirectionally audited: `PreflightCheckSpec` (id, scope, severity, pure/IO runner, dependencies, capabilities, consumer, scenarios, timeout, redaction policy, remediation) and `PREFLIGHT_CHECKS` — twelve explicit checks plus generated per-feature, per-endpoint and per-provider ones (`src/domain/runtime-dependencies.ts:362-383`)
- [x] `PreflightReportSchema` is closed and refines its own rules — a blocking check cannot be a warning, an optional check cannot fail, and the provider/feature verdicts must agree (`src/domain/preflight.ts:55-208`)
- [x] preflight scenarios cover missing browser, stale fiscal year, prod/test endpoints, low disk, corrupt DB, missing workflow secret, provider/OCR/AI exhaustion, busy port, runtime mismatch, invalid config and orphan processes (`src/domain/trust/preflight-scenarios.ts`)
- [x] the dashboard's six selected runners are implemented once from `requiredPreflightChecks(["dashboard.serve"])`: runtime/package-lock, retained config, filesystem, authority/backup/span reconciliation, ports and orphaned worker leases (`src/server/preflight/dashboard-runners.ts`)
- [x] `createPreflightAuthority` owns execution, report readback and exact command-id replay; dashboard composition runs it at startup, bootstrap serves that report, and `POST /api/v1/preflight/rerun` accepts/returns closed schemas with config + descriptor compare-and-set identity
- [x] every selected runner's registered timeout is armed through the injected monotonic scheduler; expiry aborts the runner signal but awaits actual settlement, so non-cooperative I/O is never detached and a late healthy-looking return still fails by check id + timeout
- [x] a selected refresh awaits every runner's settlement before propagating failure; multiple failures retain registry order in a primary-first `AggregateError` whose cause is the primary failure
- [x] FE the typed dashboard client and Settings control consume the strict rerun route; it binds the active runtime fingerprint and refuses a persisted-but-not-restarted settings revision (DCC3)
- [ ] BOTH there is no broad `cli doctor` verb and no `test-login`. `cli storage doctor` now consumes the same strict D282 storage reconciliation and health judgment as `authority.health`, but it is not a projection of the complete preflight registry
> 2026-08-28 | DCC3 Settings caller | strict browser call and rendered control now consume the rerun route; left: non-dashboard capability runners, broad `cli doctor` and `test-login`
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
provider-key availability, and stale orphan processes or leases.
Rules:

- dashboard boot blocks only on checks required to read authority and serve safely; missing
  credentials for an unused workflow are visible warnings, not a reason the local dashboard cannot
  open;
- enqueue and daemon start run the descriptor-derived workflow/system/feature subset and reject
  before launch if any required capability fails — no Duo or browser work is spent on a doomed run;
- optional AI checks report the exact unavailable feature; they never masquerade as
  healthy and never block unrelated workflows;
- `cli doctor [--workflow <id>]`, Settings health, startup logs and `test-login` consume the SAME
  results. `test-login` adds bounded live authentication checks but cannot mutate HR data;
- the doctor never auto-installs packages, edits `.env`, changes settings, kills processes, restores
  a database, or opens a tunnel. It offers exact explicit commands and records only redacted facts.

The registry has forward and reverse coverage: every blocking runtime prerequisite is referenced by
at least one check, and every check has a consumer and a scenario — audited by
`runtime-dependency-coverage` and `runtime-environment-coverage` (ref guards-and-tests). Fifteen
scenario manifests pin missing browser, stale fiscal year, bad prod/test URL, low disk, corrupt DB,
missing workflow-specific secret, provider / OCR / AI exhaustion, busy port, runtime mismatch,
invalid config, orphan processes and the healthy mode.

**As-built: the dashboard slice is one composed authority.** `createPreflightAuthority` derives its
ordered check membership from the registry, executes the six checks selected by `dashboard.serve`,
retains the exact report bootstrap serves, and reruns through a closed read-only command. The command
compares the caller's config and descriptor fingerprints before executing, returns the exact report,
returns the exact prior result for an identical command-id replay, and refuses divergent reuse. It
does not enter the mutation command kernel or author a command journal row because it changes no
authority state. Each registry timeout is enforced by the same injected monotonic scheduler used by
the runtime: expiry aborts that runner's signal, but execution does not race the promise away. A
non-cooperative detector remains process-owned until it settles, and its late result is rejected as
timed out rather than converted into a pass. A refresh awaits every selected detector before it
returns or throws; multiple failures are aggregated in registry order with the primary failure
first and as the aggregate cause.

The retained authority rejects missing, duplicate and surplus runners, serializes refreshes through
actual detector settlement, and retains both successful and failed command identities. Its process-local
capacity is 256 identities: exact replay remains available at capacity and no earlier identity is evicted.
The rerun route validates a loopback Host and loopback-or-absent Origin, reads at most 4 KiB of streamed
JSON with distinct transport/decoding refusals, admits one active request until actual settlement, and
limits ingress starts to six per monotonic minute. Occupied Vite ports are owned only when the
launcher nonce, index and Vite-client proof all match within the registered deadline and response bound.
Runtime, filesystem and process-lock failures report closed safe reason codes, never caught raw messages.

`AuthorityHealthPreflightRunner` consumes the same read-only storage doctor used for recovery and
now includes D282's exact span/authority reconciliation. It is healthy only when authority is
healthy, the newest backup is verified/current, every current authority run has its queued root,
and every span identity is current or explicitly archived. Missing-span, unaccounted,
malformed-authority, malformed-span and unavailable are distinct; archived is accounted rather than
silently omitted. The CLI storage doctor consumes that same reconciliation judgment. No doctor path
repairs storage, chooses another database/row, kills a process, or substitutes an empty inventory.

The remaining work is narrower and named: non-dashboard capabilities still need their own registry-selected runners; and broad
`cli doctor` plus `test-login` do not exist. `cli storage doctor` is storage truth, not a fabricated
complete preflight projection.

## 7. Adversarial self-review

Each row names a way this contract could rot, and what holds it. **A ✅ row is held by something
that RUNS; a 🔶 row is held by a design decision whose enforcement is not built** — the distinction
matters more than the table, because a design nobody executes is a promise.

| ✓ | Vector | Risk | What holds it |
|---|---|---|---|
| ✅ | A config default masks a genuinely missing value (empty URL silently = production) | An operator who *meant* to set a test URL, typo'd it empty, unknowingly runs against production | This is the charter's "verified + genuinely valid" exception, not a masked failure: empty-URL-means-production is a documented, live-verified default. What closes the *dangerous* half (test intended, prod delivered) is §4's fail-loud instance check, which is orthogonal to and stricter than the plain default — though as-built it fires at session acquisition, not at enqueue |
| ✅ | Stale fiscal-date fallback | A rollover is missed; last year's date silently reused | §5: a missing FY throws, and an existing-but-past `jobEndDate` ALSO throws (`assertNotPast`) — both the "nobody rolled it over" and the "somebody rolled it over wrong" cases |
| 🔶 | Clock skew (the host OS clock is wrong) | Freshness comparisons and trace-id time-of-day become wrong in lockstep | Constant skew cancels in `now − observedAt`; changing skew is residual. Durations already use `monotonicMs`, which is the half that matters for budgets. **The detector is not built** — nothing in `src/` compares wall against monotonic or warns on a backward jump, so §9's second settled question records a decision, not a mechanism |
| ✅ | `manualClock` leaks into a production executor | A daemon silently runs with a frozen clock — every trace id, span and freshness check wrong in the same way, all at once, no crash | `manual-clock-test-only.test.ts` bans the identifier anywhere in `src/**` but `clock.ts` (§2) |
| 🔶 | A config leaf that SHOULD be environment-overridable has no binding | An operator sets a variable that silently does nothing, because the resolver never looks for it | Half is held and half is not. **Held:** `ConfigEnvBindingRegistrySchema` refuses duplicate `env` names and duplicate `path`s; `tests/unit/config.test.ts` proves every registered binding's path resolves to a real leaf AND comes back `env`-provenanced; `runtime-environment-coverage` proves every binding key is a registered ACTIVE environment spec on the config channel. **Not held:** the reverse direction. There is no `envBacked` leaf annotation to compare against, so a leaf that ought to be overridable and has no binding is invisible. `config-env-map-coverage.test.ts` does not exist |
| ✅ | Runtime re-reads config after enqueue | One run changes target or timeouts mid-flight, or the ledger mislabels the instance | The immutable snapshot + fingerprint on the envelope (§4); contexts partitioned by that fingerprint (D116); the executor reads the RETAINED snapshot by id and refuses the node when it is absent, rather than re-resolving current config |
| ✅ | Resolver return type drifts | Consumers expect plain values and receive provenance wrappers | `ResolvedConfigSchema` is a strict object and the two exported signatures are separate: `resolveConfig(): Config`, `resolveConfigWithProvenance(): ResolvedConfig` |
| ✅ | A route-name typo is accepted by an open endpoint map | A driver navigates to a missing or wrong route and a fallback hides it | Per-system `z.strictObject` route schemas — an unknown key fails config parse — and `CONFIG_ROUTE_KEYS` is audited against the endpoint specs in both directions (`src/domain/runtime-dependencies.ts:467-481`, `runtime-dependency-coverage`) |
| ✅ | A diagnostic bundle copies sensitive state because a new field lacks a classifier | Credentials or HR data leak into debugging artifacts | Unclassified means DROP, never allow; the (classification, transform) pair is refused at declaration time and again at application time (§6); `redaction-surface-scan` plus canary tests scan every serializer and attachment |
| ✅ | A "temporary" LAN bind turns the local tool into a multi-user surface | Unaudited remote control of live HR automation | The listener refuses any hostname but `127.0.0.1`/`localhost` by name (§6.1); D294 retires the former capture-ingress exception |
| ✅ | A settings value is accepted and dropped | An operator applies a value, restarts, and gets the default | The editable command schema is closed, the fully merged candidate must pass the one resolver before replacement, `settingsOverrideByConfigGroup` is compiler-exhaustive, including `browser`, and restart tests assert exact persisted leaves plus `settings` provenance (§3) |

## 8. Worked example

**Illustrative, not as-built.** The workflow shown (onboarding) is unmigrated and the two batch
secret gates have no caller yet (§6), so this is what a run's inputs are SUPPOSED to look like when
they all come from their one source. Every signature below is the real one.

```ts
const clock = systemClock;                                       // §2 — the only time source
const { config, provenance, fingerprint } =
  resolveConfigWithProvenance(configResolutionEnvironment(), settingsOverride, clock);  // §3

validateBootSecrets();                                           // §6 — no unused workflow credential gate
validateDescriptorSecrets(descriptor.requiredSecrets, descriptor.requiredSecretFamilies);  // §6 — not yet declared

const traceId = buildTraceId({ code: "ou", runId, at: clock.now() });                // §2
const resolvedInstance = resolveInstances(descriptor, request.requestedInstance);     // §4
const ucpathUrl = resolveSystemEntryUrl(config, "ucpath", resolvedInstance.ucpath ?? "prod", runId);

const annualDates = requireAnnualDates(config, clock);           // §5 — FY2027, not past-due; else throws
const ucpathPassword = requireSecret("ucpathPassword");          // §6 — throws loud if unset, never logged

// … tasks run; checkpoint facts stamp observedAt from the same clock; configSnapshotId stays fixed …
// span.ended(run, "done") — the resolved instance map and the config fingerprint are on the record
```

**The same run one fiscal year later, nobody rolled the dates over:**

```ts
const annualDates = requireAnnualDates(config, clock);
// throws FiscalDateNotConfiguredError:
// no ANNUAL_DATES configured for FY2028 (today 2027-07-03 falls in FY2028, Jul 1 2027 – Jun 30 2028);
// configure annualDates.FY2028
```

The run fails before touching UCPath — no hire-date fill is ever attempted with a stale or absent
fiscal literal. And had the operator rolled FY2028 forward by copying last year's row, the second
check catches it instead:

```
FY2028.jobEndDate=06/30/2027 is stale for today 2027-07-03
```

## 9. Settled design questions

1. ~~Secret requirement timing~~ — **resolved 2026-07-21:** descriptors derive `requires` from task
   contracts; enqueue checks the complete set before creating a run. Per-task `requireSecret()`
   remains a fail-loud defense-in-depth backstop, not the primary discovery mechanism.
   **As-built:** the ANSWER stands and the BUILD does not — no contract declares `requires`, so the
   backstop is currently the only mechanism (§6). The decision is what to implement, not what to
   re-litigate.
2. ~~Clock-skew detection~~ — **resolved:** durations use monotonic time; the executor compares wall
   against monotonic deltas and emits a loud health warning, pausing new commits on a material
   backward wall jump until the operator acknowledges. Existing runs never rewrite timestamps.
   **As-built:** the monotonic half is real and load-bearing (`Clock.monotonicMs`, §2's prewrite
   age); the comparison and the warning are **not built** — nothing in `src/` mentions skew. §7
   carries it as an open 🔶 row rather than as a closed question, because a settled answer with no
   implementation is a design, not a guard.
3. ~~`ENV_KEY_MAP` for URLs~~ — **resolved:** only intentionally supported leaves appear in the
   explicit registry. No reflection, no uniform "every leaf" override. Production endpoint maps
   remain code defaults; settings and named URL environment variables populate sparse test maps
   only. **As-built: held exactly** — all 38 bindings write into `urls.<system>.test` or a non-URL
   leaf (§3).
4. ~~Fiscal-year entry authoring UI~~ — **resolved:** schema and file authoring work in Phase 1;
   operator UI lands with native Settings. **As-built: the generic backend settings authority is
   live, but fiscal dates are deliberately not in its editable allowlist while the DCC3 Settings UI edits its separate eight-leaf inventory.** The working fiscal channel is still the three environment variables, set as a
   complete group; adding annual-date editing requires an explicit allowlist and UI decision rather
   than inheriting reachability from the broader resolver schema (§3).
5. ~~Per-run config snapshot timing~~ — **resolved 2026-07-21:** required in Phase 1, because every
   write-ledger record needs trustworthy instance and config provenance even when all runs are
   prod. **As-built: held, at process granularity** — the snapshot row is captured once per
   dashboard process and every run that process starts binds its id and fingerprint (§4).
