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

## Phase 1b as-built foundation (2026-07-31)

`src/domain/clock.ts` is the sole production time source and exposes wall/local/monotonic/fiscal
operations; test-only `manualClock` is import-guarded. Config is one recursively strict schema and
one resolver with `env > settings > default` provenance and a canonical fingerprint. Closed system
routes, explicit prod/test instance refusal, current-fiscal-year validation, runtime environment and
dependency registries, provider/feature prerequisites, and strict preflight report schemas are
implemented and bidirectionally audited.

The production `timeouts.ukgNavigationMs` contract is retained explicitly: rebuild default
`60_000`, sparse settings override, optional `HRAUTO_UKG_NAVIGATION_MS` environment override, and
per-leaf provenance all resolve through the same closed config path. Secret access covers every
registered source kind. Environment names/families, the registered macOS local ngrok config source,
and named credential files share typed fail-loud access; file/source I/O is injected for tests.
Presence-only `present | missing | unknown` diagnostics feed descriptor preflight without exposing
values, so a missing/unreadable ngrok source blocks selected capture instead of passing because it
was not an environment secret. Redaction canaries and single-source guards are active. Immutable
per-run snapshots and the consumers that use these leaves still land with their owning later items.

## Phase 1c Stage A as-built config delta (2026-07-31)

`src/domain/config/snapshot.ts` now defines the immutable durable snapshot shell: strict snapshot
id/revision/fingerprint/timestamp/actor, the complete already-resolved non-secret `Config`, and the
typed per-leaf provenance map from the one resolver. This records the exact value/source world a
future run will bind without re-reading mutable settings. Stage A adds no snapshot repository,
enqueue integration, settings handler, or browser-context partitioning; those consumers remain
later spine work and Phase 1c is not complete.

---

## Phase 1c Stage C as-built storage-health delta (2026-08-01)

The registered `authority.health` preflight runner now consumes the same read-only storage doctor
used for recovery decisions. It reports healthy only when the authority inspection is healthy and
the newest backup is verified and current; missing, corrupt, foreign, newer-schema,
foreign-key-invalid, invariant-invalid, missing-backup, stale-backup, and generation-gap states
remain distinct strict health causes. Operator-facing summaries are fixed redacted text, while the
injected `Clock` supplies report timestamps and backup-age calculations. The runner checks abort
signals before and after inspection and does not repair storage, read environment/config directly,
or contact any external system.

This is the runner primitive, not the full operator surface. CLI/dashboard doctor presentation,
scheduled backup wiring, command/worker/projector integration, and a complete offline recovery
orchestrator remain Stage-D or later work; Phase 1c is not complete.

---

## Phase 1c Stage D as-built Clock/acceptance delta (2026-08-01)

The negative-settlement safety decision is now fully deterministic under the injected `Clock`:
`decidedAt`, the post-fence propagation boundary, rejection of future observations, and exact
read-spacing boundaries require no wall-clock read or sleeping test. The authority adapter uses its
injected Clock for transaction metadata and accepts already schema-validated external confirmation
instants; no new direct `Date`, environment, settings, or secret read site was introduced. The
existing Clock single-source and manual-Clock-test-only guards remain green.

Phase 1c acceptance advances the isolated runtime status to `completedThrough:"1c"` and
`active:"1d"`. It does not create a second config/secret world, browser profile, port, state root,
or production launcher, and it does not wire run snapshots or external systems. Those consumers
remain with their named later spine items. Phase 1c is complete; Phase 1 and production cutover are
not.

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

Every run and ledger entry must say which environment/config actually governed it. The request may
omit instance preferences (meaning production), but enqueue always resolves and stamps a complete
snapshot; runtime tasks never re-read mutable process settings mid-run.

```ts
// amends ref workflow-model's RunEnvelope — ref workflow-model remains the OWNER of RunEnvelope's shape; this field is
// specified HERE because instance selection is this doc's concept (D1), same pattern as dryRun (D6)
// living on the envelope but being fully specified in ref workflow-model.
interface RunEnvelope {
  // … runId, workflow, itemId, traceId, parent, shape, dryRun, startAt, injected,
  //    freshnessOverride, retryOf, attempt, enqueuedAt (ref workflow-model §2, unchanged) …
  /**
   * Per-system instance targeting. ABSENT (the default) means every system this run touches
   * resolves to PRODUCTION — the loud-safe default. A system present here as `"test"` means this
   * run's tasks against that system resolve config from the settings.json test-URL override
   * instead of the production literal.
   */
  requestedInstance?: Partial<Record<BrowserSystemId, "prod" | "test">>;
  /** Exact keys are the descriptor-derived browser systems touched by this run; no extras or
   * omissions survive RunEnvelopeSchema validation. */
  resolvedInstance: Partial<Record<BrowserSystemId, "prod" | "test">>;
  configFingerprint: Fingerprint;
  configSnapshotId: ConfigSnapshotId; // immutable SQLite row containing non-secret effective values+sources
}
```

- **Loud default, never silent.** Omitting `requestedInstance` resolves
  every system to production, matching current behavior byte-for-byte. There is no implicit "test"
  state to fall into by omission.
- **Fail-loud mismatch check, at resolve time.** `resolveSystemUrl(config, systemId, requested)`:
  - `requested === "prod"` (default) → always the production literal. Cannot be silently
    redirected to test by a stray settings.json edit — production is the code-default, not a
    settings value that could accidentally be left pointing at a sandbox.
  - `requested === "test"` but no distinct test URL is configured for that system (the settings
    override is empty or equals the production literal) → **throws**: `"run <runId> requested TEST
    instance for <system> but no test URL is configured (urls.<system> is empty/matches
    production) — refusing to silently run against production."` This is the structural
    impossibility the charter asks for: a run that believes it's hitting a sandbox can never
    silently land on production.
- **Recorded in the audit trail.** `RunQueued.resolvedInstance` (ref dashboard-surfaces's span schema) carries the resolved
  map (even when empty/all-prod) — so every run's actual target, per system, is queryable from the
  ledger (gap-audit gap 5), not inferred.
- **Worker-owned context partitioning.** Each worker owns its browser contexts, keyed by
  `(system,resolvedInstance,configFingerprint)`. Prod/test runs never share a context. A config
  change creates new worker-owned contexts; existing runs finish against their stamped snapshot.

**Phase 1f reuse identity (D116, ratified 2026-08-02).** The tuple above is the runtime session
manager's actual lookup identity, not evidence metadata added after acquisition. `reuse-worker`
may return an existing context only when worker, system, resolved instance, and
`configFingerprint` all match the requesting run; download/exclusivity launch requirements must
also remain compatible. A mismatch closes the old context with proof and authenticates a new one.
Neither equal URLs nor the same credential set permits reuse across a different fingerprint,
because timeouts, feature flags, provider/browser policy, or another non-secret resolved leaf may
have changed even when the route did not.

**Phase 1f as-built (2026-08-03).** The worker loop binds the claimed run's `configFingerprint` on
the session manager before any task executes and releases it when the run finishes; a driver lease
without a bound fingerprint fails loud rather than defaulting to "whatever session exists". The
concrete factory carries the fingerprint into the on-disk profile path too (ref execution-and-sessions, Phase-1f
concrete session factory), so a config change cannot be silently inherited through a warm profile.
The bind/execute/release window is one shared discipline (`withBoundRunConfigFingerprint`,
`src/core/worker-sessions.ts`) so no caller re-derives it. Driver leases taken OUTSIDE a claimed
run's worker-loop window — today only ref write-safety §4 recovery's idempotency probe — bind the TARGET
run's retained `configFingerprint` themselves, read from that run's authority row, never recomputed
from current config and never taken from caller claims; a missing/foreign binding there is a loud
precondition refusal, not a silent skip (ref write-safety §4 records the park/refusal split).

Three config leaves landed with it: `browser.headless` (the runtime default is headless — Duo
Autopilot answers the WebAuthn ceremony in-page, so there is no OS dialog to watch),
`browser.closeProofMs` (the bound on the teardown that must PROVE page/context closure), and
`paths.duoExtensionDir` (the unpacked extension the session factory loads). `urls.ucpath.*.login`
joins them: the deep PeopleSoft routes are not reachable unauthenticated, so UCPath's login entry is
its own route under this section's unchanged prod/test rule.

**Every runtime path leaf is absolute, including the profile root and the Duo credential
(2026-08-03).** `paths.browserProfileRoot` is a config leaf like its siblings, and
`paths.duoCredential` is an `AbsolutePathSchema` leaf beneath it — neither is a relative literal
pinned by `z.literal`. Two reasons, both load-bearing:

- **cwd-independence.** The runtime-isolation contract states its roots as repo-relative literals
  because that is the text the operational-isolation audit compares on both sides. A *runtime* path
  may not be that literal: `.auth/duo-webauthn.json` (the root `.auth-rebuild` before D216) resolves against `process.cwd()`, so a
  worker or daemon started anywhere but the repo root silently looks for the Duo credential in a
  directory that does not have it, and `requireSecretFile` then reports a missing credential that is
  in fact present. `src/domain/config/schema.ts` resolves the isolation root exactly once and both
  leaves derive from that single absolute value, so no consumer re-derives it.
- **The real credential home must be redirectable.** The profile directory is created by
  `factory.open()` (a real `mkdirSync`) and the credential is a real file read, so any caller that
  must NOT touch the operator's `.auth/` — every unit test — has to be able to say so.
  Before this, `tests/unit/browser-session-factory.test.ts` both created directories in the real
  root and then `rmSync(..., { recursive: true, force: true })`'d it, deleting the Duo WebAuthn
  credential on every `npm run test`; fresh enrollment is the one Duo ceremony Autopilot cannot
  perform unattended, so that was silent destruction of an operator asset behind a green gate.

The isolation contract is not weakened by this. The default still comes from
`rebuildRuntimeIsolation.browserProfileRoot`, `define-runtime-isolation.ts` still pins the literal,
and `workerProfileDirectory` still takes the `browserSessionNamespace` segment from the contract —
that namespace, not the root, is what makes a rebuild profile unreachable from the legacy runtime.
A relative `profileRoot` is refused loudly rather than resolved. `test-runtime-root-isolation.test.ts`
(ref guards-and-tests) is the ratchet: no test may pass a real-root-derived path into a filesystem mutator, and a
test that constructs the real session factory must bind its own profile root.

### 4.1 The durable snapshot is versioned by its LEAF SET, not by the migration chain (D133)

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
   the same value (§4). Editing the row breaks the binding the row exists to prove.
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
  leaf set of the config at that generation. Generation 1 is the shape the 2026-08-04 Phase-1 exit
  database actually carries; generation 2 is D125's `timeouts.sessionAcquireMs`.
- `StoredConfigSchema` permits exactly the registered post-baseline leaves to be ABSENT and nothing
  else. `configSnapshotAbsentLeaves(config)` reports which — **"this leaf did not exist at capture"
  is a different fact from "this leaf was set to 60000", and only the former is true of an old row.**
  No value is substituted, so the stored fingerprint keeps hashing exactly what it hashed at capture.
- `StoredConfigSchema` also **strips every group `.default(...)`**. Defaults exist so a fresh resolve
  can start from nothing; applying them while READING a durable row silently fabricates a whole group
  the run never had. That hole is how `browser.headless` / `browser.closeProofMs` landed without a
  visible brick — a pre-`browser` row quietly read back as today's launch policy. A stored row now
  carries its own values or fails loud.
- Reading an older generation forward is a concession to history; MINTING one is a bug.
  `ConfigSnapshotWriteSchema` refuses an insert whose config omits any current-generation leaf.
- `auditConfigSnapshotGenerations` is the ratchet, enforced by
  `tests/unit/architecture/config-snapshot-generations.test.ts` (ref guards-and-tests): the current leaf set must
  digest to the newest generation's pin, and every older generation's pinned set must still be
  reconstructible by removing the leaves introduced after it. **Adding or tightening a required
  config leaf without registering it and bumping `CURRENT_CONFIG_SNAPSHOT_GENERATION` fails there,
  before it can reach a durable row.**

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

---

## 5. Fiscal-year dates — fail-loud, not silently stale

Today's `ANNUAL_DATES` is a flat, single-year literal that has no rollover mechanism and is already
past due (`jobEndDate: "06/30/2026"`, today 2026-07-18). The rebuild makes staleness a **loud
failure at the point of use**, not a silently-wrong fill.

- **Keyed by fiscal year, not flat.** `Config.annualDates: Record<"FY${number}", AnnualDateEntry>`
  (§3's schema). There is no single "the" `jobEndDate` — there is `annualDates["FY2027"]
  .jobEndDate`, looked up by the Clock.
- **Intentional dynamic-map exception.** Fiscal years are unbounded configuration keys rather than
  domain field names, so this constrained `z.record(FiscalYearKeySchema, AnnualDateEntrySchema)` is
  allowed. The strict config parser validates every key and every value; no task reads it directly,
  and `requireAnnualDates` returns exactly one typed current-year entry or throws.
- **`requireAnnualDates(config, clock)`** — the one call site every consumer (onboarding hire-date
  fill, Kronos report range fill) goes through:

```ts
export function requireAnnualDates(config: Config, clock: Clock): AnnualDateEntry {
  const fy = `FY${clock.fiscalYear()}`;
  const entry = config.annualDates[fy];
  if (!entry) {
    throw new FiscalDateNotConfiguredError(
      `no ANNUAL_DATES configured for ${fy} (today ${clock.todayLocal()} falls in ${fy}, ` +
      `Jul 1 ${clock.fiscalYear() - 1} – Jun 30 ${clock.fiscalYear()}). Add config/settings.json ` +
      `→ annualDates.${fy} = { jobEndDate, kronosDefaultEndDate, kronosDefaultStartDate }, or set ` +
      `ANNUAL_DATES_END / KRONOS_DEFAULT_END_DATE / KRONOS_DEFAULT_START_DATE for this year.`
    );
  }
  assertNotPast(entry.jobEndDate, clock);   // see below — an ENTRY existing is not enough
  return entry;
}
```

- **A second, narrower check: an existing-but-stale entry is also loud, not just a missing one.**
  A copy-pasted-forward entry (this year's key holding last year's date by operator mistake) would
  pass the lookup above but still be wrong. `assertNotPast(entry.jobEndDate, clock)` parses the
  date and throws if it is chronologically before `clock.now()` — this is the exact "already stale"
  failure mode gap-audit gap 7 names, closed structurally rather than by operator vigilance.
- **This is the charter's fail-loud rule, applied verbatim** (root `CLAUDE.md` §"Fail loud"): a
  fiscal date is "an expected value" whose absence/staleness is not a "genuinely valid, expected
  state" (a hire-date fill genuinely needs a *current* fiscal year's date) — so it fails loud
  instead of substituting the nearest available literal.
- **Rollover is then a config edit, not a code deploy.** Adding `annualDates.FY2028` to
  `config/settings.json` (or the equivalent env vars) each June is the entire rollover procedure —
  same operator action as today, but now a missed rollover is caught at the first onboarding/
  separation run that needs it, not discovered months later.

---

## 6. Secrets accessor

One typed accessor is the sole rebuild home for every credential—rebuild-scoped `.env` resolution
and a distinct rebuild auth/profile root—replacing inline reads inside the rebuild repo's `src/`.
The legacy repo keeps its existing config/secret world unchanged. Since D93 the two runtimes live in
separate repositories with no shared module graph, so importing each other's accessors or proxying
requests is **structurally impossible** rather than merely forbidden. What the repo split does *not*
do is separate the machine: both worlds resolve env vars, write state, bind ports, take process
locks, and open browser profiles on the same host. So two distinct `.env`/settings/secret worlds and
two distinct state/auth/profile roots stay an explicit REQUIREMENT of this doc — neither runtime may
read the other's settings/state/auth files, and neither may reuse the other's port, lock, or browser
profile.

**D94 cross-repo naming/accounting cross-reference.** Runtime code never reads the legacy repo;
only the guard lane may do so. In inventories that name both repositories, `legacy:` qualifies a
legacy path and an unprefixed path means this rebuild repo (ratified F2). Single-root legacy
manifests remain unprefixed. Ref guards-and-tests §3.13 owns checkout resolution, commit-centred change
accounting, the clean-tree requirement, and the closed recheck/evidence catalog; this secrets doc
only consumes that path-ownership convention.

Within the rebuild repo's `src/`, the accessor covers environment variables, the registered local
ngrok config source, and the rebuild Duo private-key file — replacing `validateEnv()` +
`getTimekeeperName()` + ~20 files' inline
`process.env.*` reads with one surface. No legacy-proxy secret/config class exists.

```ts
// src/domain/secrets.ts
interface SecretSpec { env?: string; envFamily?: string; source?: string; requiredAtBoot: boolean }

const SECRETS = {
  ucpathUserId:      { env: "UCPATH_USER_ID", requiredAtBoot: false },
  ucpathPassword:     { env: "UCPATH_PASSWORD", requiredAtBoot: false },
  timekeeperName:     { env: "TIMEKEEPER_NAME", requiredAtBoot: false }, // descriptor-scoped
  // Provider key families are registered patterns, not ad-hoc process.env scans. The existing
  // Gemini 1..8 pool and each provider's supported cardinality are explicit in the spec.
  geminiApiKeys:      { envFamily: "GEMINI_API_KEY{1..8}", requiredAtBoot: false },
  groqApiKeys:        { envFamily: "GROQ_API_KEY{n}", requiredAtBoot: false },
  mistralApiKeys:     { envFamily: "MISTRAL_API_KEY{n}", requiredAtBoot: false },
  openRouterApiKeys:  { envFamily: "OPEN_ROUTER_API_KEY{n}", requiredAtBoot: false },
  sambaNovaApiKeys:   { envFamily: "SAMBANOVA_API_KEY{n}", requiredAtBoot: false },
  ngrokCredential:    { source: "local-ngrok-config", requiredAtBoot: false },
} as const;
type SecretName = keyof typeof SECRETS;

const SECRET_FILES = {
  duoWebauthnCredential: { configPath: "paths.duoCredential", classification: "credential-file" },
} as const;
type SecretFileName = keyof typeof SECRET_FILES;

/** Throws SecretMissingError naming the secret + its env var + .env.example pointer. Never `?? ""`. */
export function requireSecret(name: SecretName): string { /* … */ }
export function optionalSecret(name: SecretName): string | undefined { /* … */ }

/**
 * `timekeeperName` and every workflow credential stays `requiredAtBoot:false` (so process
 * boot doesn't demand it for workflows that never touch Kuali) but IS on the mandatory-at-startup
 * list for any run whose descriptor reaches a Kuali fill task — the descriptor declares which
 * secrets its tasks need (a `requires: SecretName[]` on the contract, mirroring ref task-contract's session
 * needs), so "lazy" is descriptor-driven, not a second ad hoc throw site.
 */

/** Boot gate covers only secrets required to read authority and serve safely. It starts empty. */
export function validateBootSecrets(): void { /* batch-report missing requiredAtBoot entries */ }

/** Enqueue/daemon preflight batch-reports the descriptor-derived secret subset before launch. */
export function validateDescriptorSecrets(names: readonly SecretName[]): void {
  /* resolve registered env/family/local sources; throw once with every missing/unknown requirement */
}

/** Named file secrets only—callers cannot turn this into an arbitrary path reader. */
export function requireSecretFile(name: SecretFileName): Buffer { /* resolve configured path,
  validate owner/mode/type/size, read or throw a named SecretFileError */ }
```

This block is the intended **registry shape**, not permission to stop at the shown entries. Phase
1b's D68 inventory starts from `.env.example`, all current `process.env`/computed-env reads (including
provider key/model families), `.auth`, capture tooling, and each descriptor's requirements. Every
entry is classified as secret, non-secret config, test-only, or retired-in-target; every rebuild runtime
read maps back to exactly one entry. Optional provider keys remain optional globally but become a
blocking workflow/feature preflight when a required provider capability has no usable configured
cell.

- **Fail loud at the correct scope.** `validateBootSecrets()` runs once at daemon/dashboard boot
  and covers only secrets required to read authority and serve safely. Enqueue/daemon preflight
  calls `validateDescriptorSecrets()` for the selected descriptor-derived capability subset and
  reports every missing requirement at once. An unused workflow credential never blocks dashboard
  boot, while a selected workflow still fails before spending Duo/browser work.
- **Local source failures stay distinguishable.** The ngrok resolver checks the one registered
  config path as a regular `0600`-or-stricter bounded file and parses exactly one `authtoken`.
  Descriptor preflight reports `missing` when no token is configured and `unknown` when the source
  cannot be inspected or read; neither state includes the credential value or passes as healthy.
- **Never logged.** The accessor is the only function permitted to read a secret's raw value; every
  other module receives it as an opaque string to hand to a login/fill call, never to `log.*`. A
  grep-ratchet guard (below) backstops this structurally.
- **`.auth/` and Duo credentials get one owned home.** `requireSecretFile("duoWebauthnCredential")`
  replaces the direct `readFileSync` in `infra/auth/duo-webauthn.ts:1` — the cross-process
  lock and signCount-reservation logic (live-verified, ported verbatim per the charter) stay
  exactly as they are; only the raw-file-read call site changes to go through this accessor.
- **Redaction is schema-owned.** Secret schemas and sensitive domain fields carry a classification
  (`secret`, `credential-file`, `direct-identifier`, `sensitive-hr`, or `safe-diagnostic`) plus an
  allowed evidence transform (`drop`, `digest`, `last4`, `basename`, `count`, or `allow`). Ref operator-trust's
  logger/evidence/bundle writers accept classified values and transform before serialization.
  Unknown/unclassified fields are dropped with a redaction warning, never passed through. Tests
  seed canary passwords, cookies, storage state, SSNs, DOBs, and private keys and scan every
  produced note/failure/screenshot metadata/bundle/notification.

**The guard:** `secrets-single-source.test.ts` — bans `process.env.` outside `domain/secrets.ts`
and `domain/config/` (the config resolver's own env-precedence reads are a distinct, permitted
concern from secret *values*; the guard's allowlist distinguishes a config *URL* env read from a
*credential* env read by the `SECRETS`/`ENV_KEY_MAP` table membership). `no-secret-values-in-logs.
test.ts` — a grep-ratchet flagging `log.*`/template-literal interpolation of identifiers named
`password`/`privateKey`/`credential`/`secret` (case-insensitive), same `Record<file,{count,reason}>`
shape as the existing ratchets, catching an accidental `log.info(`login as ${password}`)`.

### 6.1 Explicit single-operator/local scope

The rebuilt operator dashboard binds `127.0.0.1`/`::1` only. Phase 1 does not build accounts, roles,
permissions, teams, remote synchronization, high availability, a secret manager, certificate
management, or signed audit anchoring. Legacy-only LAN configuration remains inside the preserved
legacy repo and cannot reach the rebuild at all — separate repositories share no module graph (D93),
so there is nothing to import or proxy. Because both servers may run on the same host, the rebuild
binds its **own** loopback port and never reuses the legacy dashboard's. A non-loopback
bind is rejected by the native server with a message that remote access is outside the current
contract; adding it later requires a separate threat model and explicit operator decision.

Ref data-intake-and-edit-data's mobile capture is the sole explicit exception and does not turn the operator server into a
remote app. `capture.ingress:"on-demand-ngrok"` starts a short-lived separately scoped ingress only
after the operator creates a capture session; `forwarded` requires an explicit HTTPS URL;
`disabled` makes Start Capture fail with a named configuration result. The ingress exposes the
closed token-gated phone-route union only and shuts down after the last live session expires or
finishes. Its route allowlist is generated from the same capture-route schema and deny-tests every
operator/API catch-all. `forwardedUrl` is routing config, never authority; each capture session
stamps the resolved ingress mode/origin digest so troubleshooting can explain which path was used.
`ConfigSchema.superRefine` requires `forwardedUrl` exactly for `ingress:"forwarded"` and rejects it
for the other modes, so a stale forwarded origin cannot be silently reused.

**As-built (D174, 2026-08-09 — normative text in ref data-intake-and-edit-data §5.1).** All three modes resolve to an
origin or to a NAMED configuration result, and none of them falls back. `disabled` refuses
`ingress-disabled`; `forwarded` resolves to its explicit HTTPS URL; `on-demand-ngrok` refuses
`ingress-credential-missing` without its credential and **`ingress-not-built` with one**, because
the on-demand tunnel launcher does not exist in this repository yet and a QR pointing at
`127.0.0.1` scans perfectly and then fails on the phone with a network error that explains nothing
— the plausible-but-wrong outcome the charter forbids. The allowlist is generated from
`CAPTURE_PHONE_ROUTES` as this section requires, and the deny test is stronger than "refuses":
a request arriving on the ingress **Host** gets a status and body **byte-identical** to an unrouted
path, so the ingress cannot be used to enumerate what the operator's dashboard serves. The session's
`{mode, originDigest}` stamp is an OPTIONAL leaf (D133), so rows written before D174 still parse.
The token that gates every one of those routes never appears in a URL the server sees: it rides the
QR payload's URL FRAGMENT and the `X-Capture-Token` header, which is how "no secret-bearing URLs"
above stays true of a surface whose entire purpose is to be opened from a scanned link.

Local-only does **not** waive correctness or privacy hygiene. The tool still controls live HR
systems and stores sensitive evidence, so strict schemas, output redaction, least-retained capture,
file permissions (`0700` directories / `0600` authority, backup, evidence, and secret files),
loopback Origin checks, and no secret-bearing URLs/logs remain base requirements. These measures
also make diagnostic bundles safer to share with Codex/Claude.

### 6.2 One environment doctor replaces scattered startup surprises

The existing `setup`, `/api/preflight`, and `test-login` behaviors become projections of one strict
preflight registry, not three lists that drift. Each `PreflightCheck` has a stable id, scope
(`dashboard|executor|workflow|system|feature`), severity, pure/IO runner, timeout, redaction policy,
and remediation template. `PreflightReportSchema` contains config/descriptor fingerprints, checked
at/time, and a non-empty closed result tuple:

```ts
type PreflightResult =
  | { status: "pass"; check: PreflightCheckId; summary: string }
  | { status: "warning"; check: PreflightCheckId; summary: string;
      impact: string; remediation: string }
  | { status: "fail"; check: PreflightCheckId; summary: string;
      blocks: readonly [RuntimeCapability, ...RuntimeCapability[]]; remediation: string };
```

Base checks cover Node/package-lock compatibility, Playwright browser/extension assets, configured
paths and permissions, disk space, port availability, SQLite/migration/backup health, required
workflow secrets, production/test URL completeness, current fiscal dates, optional provider-key
availability, capture ingress dependencies, and stale orphan processes/leases. Rules:

- dashboard boot blocks only on checks required to read authority/serve safely; missing credentials
  for an unused workflow are visible warnings, not a reason the local dashboard cannot open;
- enqueue/daemon start runs the descriptor-derived workflow/system/feature subset and rejects before
  launch if any required capability fails—no Duo/browser is spent on a doomed run;
- optional AI/capture checks report the exact unavailable feature; they never masquerade as healthy
  and never block unrelated workflows;
- `cli doctor [--workflow <id>]`, Settings health, startup logs, and `test-login` consume the same
  results. `test-login` adds bounded live authentication checks but cannot mutate HR data;
- doctor never auto-installs packages, edits `.env`, changes settings, kills processes, restores a
  DB, or opens a tunnel. It offers exact explicit commands/actions and records only redacted facts.

The registry has forward/reverse coverage: every blocking runtime prerequisite is referenced by at
least one check, and every check has a consumer and scenario. Fixtures pin missing browser, stale
fiscal year, bad test URL, low disk, corrupt DB, missing workflow-specific secret, optional provider
exhaustion, unavailable ngrok, and healthy mode.

---

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
