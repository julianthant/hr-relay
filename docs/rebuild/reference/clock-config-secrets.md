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

**Current test-input target:** D341 below separates test configuration from application settings;
implementation is pending in the approved pre-1.6.7 detour.

**Section map.** §1 the legacy baseline this replaces · §2 the Clock · §3 the config resolver ·
§4 the per-run snapshot and instance selection, §4.1 its generation line · §5 fiscal-year dates ·
§6 the secrets accessor, §6.1 scope, §6.2 the environment doctor · §7 the rot vectors and what
holds each · §8 a worked example · §9 the settled questions.

## D343 — preserve the reference environment; isolate runtime provider keys (2026-09-07)

The operator requested this amendment during Task 1.6.7. The fixed normal-startup provider source is
now ignored `.env.providers`, anchored to `scripts/secure-env-bootstrap.ts`, with no `.env` fallback.
The operator's `.env` remains untouched for reference. This supersedes current-source `.env` wording
in D331 and §6; historical explicit D332 storage-upgrade inputs and immutable evidence remain unchanged.

Only the existing GEMINI, GROQ, MISTRAL, OPEN_ROUTER and SAMBANOVA API-key pools are admitted, each
with its existing maximum of eight cells. The secret accessor remains the sole credential reader.
No-follow descriptor admission, owner-only regular-file permissions, byte bound, strict grammar,
parser cross-check, parent-environment refusal and explicit parent binding precedence remain intact.
Missing or invalid `.env.providers` fails before runtime imports. Workers admit the same fixed source
independently; no automatic import from the reference file occurs at startup.

The authorized one-time setup copies only supported bindings into an absent owner-only runtime file,
validates the result with the existing reader and proves the source bytes unchanged without publishing
values or derived hashes. Operational credentials remain in their credential store; canary inputs
remain in D341 private test configuration. Runtime diagnostics identify `.env.providers`; Settings
continues to expose only provider availability. Additional OCR providers and provider-editing UI remain
deferred. The existing `.env.example` is a value-free template for `.env.providers`.

The operator subsequently approved refreshing only generated descriptor/implementation identifiers
and their screenshot pixels in Task 7's parity references. The source-path change moves generated
fingerprints; all other semantics/layout and the existing zero-pixel tolerance remain fixed. Require
classified changes, assertion-mode parity and full candidate gates; this is no general UI refreeze.

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

##### D336 — SQLite settings and an independent credential store (operator decision, 2026-09-06)

**Approved target; implementation belongs to Phase 1.6 Task 6.** Runs and ordinary settings use
one SQLite authority database. Credentials and other protected settings use one separate credential
store reached through the existing sole secret reader. Credential updates are independent operations,
not participants in a run/settings transaction. This section supersedes the conflicting D321/D331/D332
file layout, file/journal coupling, backup-pairing and recovery requirements below; their original
text remains evidence for already-built code and input formats, not the target implementation.
Tasks 1–4 retain their completed evidence and the in-flight Task-5 assignment remains bounded as
approved. Task 6 performs the storage conversion and all necessary consumer changes together.

**Ordinary settings.** The existing closed catalog, leaf validation, set/clear behavior, revision
compare-and-swap, defaults, restart scopes and immutable per-run snapshots remain. The persisted
settings values, revision and successful command/audit records commit in the same SQLite transaction.
The resolver reads that database through the settings service. No JSON file, sidecar, lock, prepared
file, rollback file or second database row acts as an independently authoritative copy of ordinary
settings. JSON export/import may be an explicit operation; an export is never a runtime authority.
For example, applying `concurrency.defaultWorkers = 3` at revision 7 either commits revision 8 and
its audit together, or leaves both unchanged. The exact table/schema/API binding is Task 6's focused
plan, based on the then-integrated code; this decision does not invent a parallel repository.

**Protected settings.** Preserve write-only inputs, value-free presence readback, per-name validation,
next-use reads, missing-credential refusals and the sole reader boundary. A credential value never
enters the authority database, ordinary configuration, fingerprints, snapshots, logs, API readback,
backups or child-process environment. The credential backend owns its own durable updates and reports
success, refusal or an uncertain outcome truthfully. SQLite may retain value-free audit observations,
but no SQLite singleton or journal row authenticates the credential store's current revision or gates
its availability. An audit failure must not be reported as success; it also must not roll back an
unrelated database transaction or make a database restore pretend to restore a password. Credential
write authorization and replay/readback semantics must be bound in the Task-6 plan before code changes.
Provider keys retain their current dedicated `.env` source until the separately owned OS credential
backend is implemented; ordinary settings never return to environment precedence. This is a storage
boundary decision, not approval to replace the OS backend or import real credentials in this session.

**Backup and restore.** A verified SQLite backup now contains runs and ordinary settings together;
credential values are excluded by construction. Restoring it leaves the separate credential store
unchanged and reports current credential availability from that store. A missing credential blocks
the operation that needs it. Do not add a cross-store generation handshake, force-delete credentials,
or infer credential absence from old SQLite metadata. Existing snapshots/evidence and D332's rule
against re-admitting an externally uncertain write remain binding.

**Transition.** Task 6 inventories the actual supported source formats, including the pre-floor
settings family and the D331 files already created by Tasks 2-2/5. It validates and imports ordinary
values into SQLite once, refuses conflicting sources, and proves that old files/environment values
cannot influence the resolver after conversion. Credential setup/import is separate, with value-free
status and explicit failure; it never makes the SQLite upgrade a cross-store transaction. A new empty
root starts directly in the target format. Existing local data is preserved; this decision does not
authorize deleting the rebuild's state or touching legacy production. `storage upgrade --plan`, a
verified explicit backup, database migration/restore checks and preservation proofs remain; the old
prepare/commit/file-settle boot matrix is replaced, not carried forward under new names.

Task 6's import binding is private credential-store data: before committing the SQLite conversion,
the store durably records the exact protected input and opaque upgrade identity without advancing
its current credential revision. A stopped retry requires the same private binding; missing or
changed input refuses before application. SQLite retains only value-free identities. SQL rollback
never removes this binding, and neither SQLite restore nor normal credential readback exposes or
rewrites it. This binds the one-time import without making either store's commit roll back the other.

**2026-09-07 approved migration-input amendment.** Exactly `I9_USER_ID`, `I9_PASSWORD`,
`TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID` are historical **cleanup-only** names admitted by the
stopped upgrade adapter. Strict syntax, duplicate-name and private-file checks still apply. Report
these names in `envKeysToRemove`, but do not decode, import, persist, compare or expose their values.
They are not catalog entries, registered runtime/provider environment keys, or credential-store inputs.
Normal runtime admission continues to refuse them; every other unregistered name still refuses plan
and apply before authority effects. Preserve `.env` bytes during planning, conversion and retry.
This exact migration-only exception belongs to A0 and expires with its Phase-2.6 deletion; it is not
an unknown-key fallback. Task 6's observed operator inventory is its deciding evidence.

**Why.** The split file/SQLite design requires an application-level transaction and recovery protocol
for an ordinary setting. SQLite already provides the required atomicity. Keeping all values, including
plaintext credentials, in SQLite would simplify commits but violate the intentional secret-free backup
boundary. One database for ordinary state plus independent credential operations retains that boundary
without pretending the two stores can commit atomically. Phase 6 consumes the same credential reader
interface when it supplies the platform backend.

##### D341 — Test inputs have a separate owner

**Operator-approved 2026-09-07; implemented by the test-data foundation detour (candidate awaiting
independent review; completion evidence in `ref guards-and-tests` §10.5).** Test-only inputs are not
application settings. This amendment supersedes D300/D318's
old source location and the test-target portions of D331/D332/D336, not their privacy, ingress,
availability, isolation or write-safety requirements. This contract does not claim the actual private
conversion ran until §10.5 records it.

**As built.** Schemas: `src/domain/test-data.ts` (`TestDataSharedConfigSchema`,
`TestDataLocalConfigSchema`, `TEST_DATA_INPUT_NAMES` = the two canary names judged by the workflows'
own value schemas). Reader: `src/control/test-data.ts` for the tracked file and
`src/infra/config/test-data-local.ts` for the private file (0600, no symlink, ≤64,000 bytes, unique
keys, errors name keys only), capture-once `TestDataInputSource` with an opaque `sourceId` carried
by the `test-data-local` protected-input binding. Retired names: `RETIRED_TEST_TARGET_PROTECTED_NAMES`
in `src/domain/config/protected-settings-legacy.ts` (the frozen seven-name family and its pinned
schema hash, used only by migration and D331 historical readers) and
`RETIRED_TEST_TARGET_ENVIRONMENT_KEYS` in the catalog, refused by name before any value is decoded.
Credential document schemaVersion 2 (`src/infra/config/credential-store.ts`): the live five-name
record plus an optional value-free migration `baseline` that retires the legacy command/write/value
identities and the applied upgrade binding; a schemaVersion-1 document is refused by the ordinary
reader with `credential-store-migration-required`. Commands: `npm run cli -- test-data check --json
[--subject <label> [--workflow <id>]] [--file <name>]` and `npm run cli -- test-data migrate
--from-credentials [--plan] --json`; both bypass `.env` loading and refuse unknown options before work.

**Owners and files.** Tracked `config/test-data.json` owns public subject declarations, named safe
fixture paths and reusable synthetic data. It incorporates the existing `config/test-subjects.json`
registry rather than duplicating it. Ignored `config/test-data.local.json` owns actual canary values
and private document paths; a tracked example contains no private values. One typed test-data reader
validates these sources. Each input has one owner, not an override chain. Application settings,
credentials and `.env` are not fallback sources. Current application credential handling otherwise
stays under D336. The two canary rows leave the application catalog (88 → 86), Settings set/clear and
readback schemas, and application secret registries. Retired environment names remain rejected
independently of their removal from the catalog. Tests and explicit test commands consume test data;
ordinary application startup must not read private test configuration or offer it to users.

**Loading and identity.** Offline tests need only tracked data. Private reads are explicit and lazy;
unknown/unavailable/pending subjects block before private access or browser composition. Resolve
relative paths against the declaring config file, never the working directory or another checkout.
Tracked fixture paths remain within the repository; private files may use explicit local paths.
Strict shape, missing-file and permissions failures report keys/status, never values. Shared data is
immutable; fixture builders return isolated values. Capture the selected live input once per start
with an opaque source identity and preserve it through admission, fingerprints, receipts, redaction,
resume/rerun and archive. Later config edits affect later starts. No identifier or value-derived hash
may leak through the new binding. Expected assertions remain independent from shared inputs.

**Verified conversion.** The detour owns one explicit stopped-system conversion from the authenticated
current credential document to private test configuration and a test-free credential representation.
The old document's strict replayed history and upgrade binding must be understood before removing
fields. Preserve operational credential values/current identities and accepted command/write identity
non-reuse; never relabel a historical command fingerprint as a new request. A versioned migration
baseline and value-free retired identity records may replace obsolete canary-bearing history.
Missing destination can be created privately, equal values permit verified idempotent completion,
and conflicting/malformed destinations or changed sources stop without overwrite. Stage, durably
verify and bind the destination before retiring source entries. Interruption/retry must establish
which exact state settled; uncertain state never reports success. No runtime fallback survives.
Existing general historical readers remain isolated and frozen to their source schema; reducing the
live catalog cannot silently discard historical input or reintroduce a test-only setting.

**Scope and proof.** The operator discarded all existing rebuild runs on 2026-09-07. No old run data
is required to migrate, and this amendment does not restore it or remove unrelated historical/recovery
safeguards. Future migration/recovery tests use reproducible synthetic data. The detour proves new
source-bound run behavior, complete shared-fixture adoption, migration failures/retry and actual
private-file conversion with no browser/provider/external write. Task 1.6.7 retains its two live
workflow proofs and honest missing-input/selection prerequisites. Full testing/fixture requirements
and implementation completion evidence belong to `ref guards-and-tests` §10.5, which also records the
accepted review, `--no-ff` integration (`bc6dc9b54`) and actual private conversion of 2026-09-07; the
temporary execution handoff was removed at that closure after its unique evidence moved to §10.5.

##### D331 — the settings catalog and protected root contract (0.3 Task 2, 2026-09-04)

> **Current target:** §D336 supersedes the file destinations and database/file coupling below.
> Keep the catalog and user-visible behavior; use SQLite for ordinary settings and independent
> credential operations. File-specific paragraphs describe the source implementation to convert.


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
`ConfigSchema` leaf, every `SECRET_SPECS` entry (`TEST_TARGET_SECRET_SPECS` was retired by D341), every
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
| `currentSource` / `targetSource` | closed `{ kind, name }` pairs (`env:UCPATH_PASSWORD`, `settings.json`, `protected.json`, `.env`, `probe`, `code`); a leaf with two live sources today carries BOTH pairs as a `currentSource` ARRAY — never a compound string, never a parenthetical | the migration edge 0.3 Task 3 consumes; identical on both sides for an unmoved leaf. Where the two current sources disagree at import, Task 3 refuses the upgrade by key name (D327's ambiguous-duplicate rule) and imports only when they are byte-equal or one is absent |

> 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | the `currentSource` tie-break sentence is implemented by §D332 (settings half) §D332.S3: canonicalize through the leaf's own schema, import once when equal, refuse `ambiguous-duplicate { key, sources }` when not.

Two consequences the columns force. **`sensitivity` decides storage, not the operator's taste**: a
`protected-*` row can only have `sourceClass: protected-store`, a `provider-key` row only
`provider-env`, a `derived-host` row only `derived-host`; the registry's `superRefine` refuses any
other pairing, so a credential cannot be catalogued into the ordinary document by a typo. Exactly
one pairing is exempted BY NAME: `duoWebauthnCredential`, the machine-written `credential-file`
under the profile root, is `protected-secret` with `sourceClass: runtime-isolation` and
`editability: machine` (§D331.2 says why it is not in the store); the guard pins that exemption's
cardinality at one. Editability and source class are also paired: `operator` ⇔ `ordinary-settings`
or `protected-store`; `deployment`/`machine` ⇔ `runtime-isolation`; `derived` ⇔ `derived-host`;
provider families are `operator`-editable only through `.env` (`provider-env`). **A leaf
has one `sourceClass`**, so "read it from settings, else from the environment" is not expressible
in the catalog's type — that is how §D331.8's precedence rule is enforced rather than intended.

###### D331.2 — the five source classes and the one authority per class

| Source class | Members (§D331.9 is exhaustive) | The ONE active authority | Read through |
|---|---|---|---|
| `ordinary-settings` | every `Config` leaf with `editability: operator` — exactly the set the ordinary document may hold: actor label, the nine `urls.<system>.test` overrides, every `timeouts.*`, the four operator paths (`reportsDir`, `downloadsDir`, `onboardingDocsDir`, `i9CheckTrackerPath`), `annualDates`, `display` (as an explicit override only), `performance.*`, `ocr.*`, `browserHealth.*`, `browser.*`, `concurrency.*`, `daemon.*`, `features.*`, `providers.<capability>.*` budgets, and the five provider MODEL CHAINS (model ids are not secrets; §6 kept them in the secrets module only because it was the sole environment reader — that reason expires with the environment layer; 1.6 deletes `providerModelChain`'s environment reads outright, both the `modelsEnv` chain and the `legacyModelEnv` singular fallback, so the five `OCR_*_MODEL` spellings retire with the five `OCR_*_MODELS` keys) | `.tracker/settings/settings.json`, revisioned (§D331.4) | the resolver, into `Config`; provenance `settings` or `default` |
| `protected-store` | `ucpathUserId`, `ucpathPassword`, `timekeeperName` (it leaves `operator.timekeeperName` and `Config` entirely — its dual `config-and-secret` channel is retired), `sharepointOnboardingRosterUrl`, the D288 pseudonym HMAC key and its public generation id (stored as one pair so a rotation cannot split them), and the local canary/test inputs (`separationsKualiFinalizationCanaryDocumentNumber`, `personLookupCanaryEid`) | `.tracker/settings/protected.json`, separately revisioned, write-only (§D331.6) | the secrets accessor (`requireSecret` / `optionalSecret` / `inspectSecret` / `optionalTestTargetSecret`), whose SOURCE becomes the protected store; the resolver never sees these |
| `provider-env` | the five `SECRET_FAMILY_SPECS` key pools (`GEMINI_API_KEY{,2..8}`, `GROQ_…`, `MISTRAL_…`, `OPEN_ROUTER_…`, `SAMBANOVA_…`) — API KEYS ONLY | the repository's fixed `.env`, admitted by the secure bootstrap (unchanged) | `requireSecretFamily` / `optionalSecretFamily` |
| `derived-host` | `HRAUTO_HOST_PRIMARY_DISPLAY` (D324) — the probed primary display | the once-per-process-tree probe, published on the `config-default` channel | the resolver's DEFAULT layer for `display`, beneath an explicit ordinary override |
| `runtime-isolation` | every leaf FIXED BY CODE, where a change is a code change and a new process: the five isolation paths `paths.stateRoot`, `paths.artifactRoot`, `paths.browserProfileRoot`, `paths.duoCredential`, `paths.duoExtensionDir` (D121/D216/D321); the nine `urls.<system>.prod` route sets ("production is the code default", §4); `actor.id` (the fixed local-operator id); and the Duo WebAuthn credential FILE (machine-written under the profile root; `credential-file`, read by `requireSecretFile` only) | `config/runtime-isolation.json` + `runtime-paths.ts` + `schema.ts` defaults (a code change), the ceremony | the resolver (paths, prod routes, actor id — provenance `default`, never overridable by any document) / `requireSecretFile` |

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
and adds the protected store beside it. Nothing else may live in the directory: the six listed
entries, plus the lock's acquisition-named hard-link twin and at most one stale-reaper recovery
barrier matching `.settings.lock.reaper.<uuid>` (the as-built protocol's own transient names,
`settings-file.ts` `recoveryPath`). Any other entry is an integrity refusal by basename, never
ignored; a second barrier is the as-built multiple-barrier refusal, not an integrity refusal.

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
                                 — `rootFingerprint` is SHA-256 over the canonical `{ schemaVersion,
                                 settingsSchemaHash, protectedSchemaHash, ordinary, protected }` tuple
                                 ONLY: never a function of either document's contents and never of a
                                 protected value (the sidecar is backed up; a digest of a value would
                                 leave the root inside it)
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
never written in one command; a command names exactly one target. A prepare or rollback record
whose `target` is `protected` carries protected VALUE bytes and is therefore itself a
protected-class artifact: never backed up, never served on any wire, never named in a doctor or
preflight report beyond its existence and `target`, and removed as part of settlement (P15/P16).
Because every prepare/rollback/authority/lock record is bound to the exact settings PATHNAME
(`settingsPathFingerprint`), the move to `.tracker/settings/` invalidates all of them by
construction: 0.3 Task 3 must refuse the upgrade BY NAME while any `.prepare.json` or
`.rollback.json` survives at the old pathname, reconcile the old authority first, and never carry
a path-bound record across the move.

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

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (cross-contract close) | the paragraph above describes the 1.6 TARGET, not the as-built backup: today `AuthorityBackupManifestSchema` (`src/infra/sqlite/recovery-contracts.ts:70–84`) is `manifestVersion: 1` — one `backupFileName`/`sha256`, no file list, no settings copy (`backup-service.ts` names no settings file). 1.6 Task 2-2 lands the multi-file `manifestVersion` 2 manifest carrying the two ordinary documents and the protected presence metadata (§D331.11 P15), and ref dashboard-surfaces §D332.4 (as amended) keeps `manifestVersion` 1 readable so every pre-floor backup stays restorable.

###### D331.4 — revision, journal coupling and the two singletons

Each document has its own monotonic `revision` (1 = the never-applied baseline). The as-built
rules for the ordinary document stand unchanged: the file's `lastApplied` binds the command id,
whole-envelope fingerprint, expected revision, schema hash and patch fingerprint; the SQLite
`settings_current` singleton (`revision ≥ 2`, `settingsFingerprint`, `commandId`,
`commandFingerprint`, `auditId`, `committedAt`) is written in the same transaction as the command
and audit rows; boot reconciliation keeps next bytes only for that exact committed identity.

The protected store gets the SAME protocol under a second singleton, `protected_settings_current`:
`{ revision ≥ 2, commandId, commandFingerprint, auditId, committedAt, entries: [{ name, valueId,
updatedAt }] }`. It holds NAMES and write identities only — no value, no digest, no length.
Because the protected store has no value fingerprint, its boot predicate is stated explicitly
rather than inherited from the settings-shaped one (which compares `settingsFingerprint`, requires
`restartRequired` and a `family: "settings"` target): the file's `revision` equals
`protected_settings_current.revision`; its `lastApplied.commandId` / `commandFingerprint` equal the
singleton's; the audit exists with `restartRequired: false` and `affectedTargets = [{ family:
"protected-settings", revision }]`; and the file's `{ name, valueId, updatedAt }` set is byte-equal
to the singleton's `entries`. A file ABOVE the singleton's revision refuses `authority-unjournaled`
by document name; a file BELOW it, or with a divergent `valueId` set (a database restored in place
under a surviving newer store, or an operator-restored foreign copy), refuses `authority-uncertain`
by document name with the remedy "delete `protected.json` and re-enter every entry" — never a
silent adoption and never a regeneration.
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
| `apply-settings` (exists) | `{ expectedRevision }` of `settings.json` | `{ settingsSchemaHash, patchFingerprint, patch }` — `patch` is a strict object over the closed editable schema's leaf paths whose entries are `{ set: <value> }` or `{ clear: true }`, exactly as arm 2 (the as-built `mergeSettingsPatch` MERGE cannot express an unset, so `clear` is the ONE way an ordinary leaf returns to its default: a cleared leaf is absent from the persisted document and resolves `default`); the editable schema under D331 equals the `ordinary-settings` class EXACTLY (every row with `editability: operator`; §D331.9 is the list). DCC3's eight-leaf allowlist is therefore superseded as a boundary — it becomes the first eight rows of a longer closed list, not a second list | `{ revision, settingsFingerprint, restartRequired: true }` |
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
replay is detected inside the executor, under the lock, by a constant-time comparison of the
replayed `set` value against the stored value (§D331.6 rule 4) — the journal never learns it. (A journaled per-value digest was considered and rejected:
a salted or unsalted hash of a password in a non-`0600` table is an offline guessing oracle, and the
random `valueId` already gives the journal a stable write identity without one.)

**Refusal arms** (closed; every arm names the key or document, never a value). The table order IS
the evaluation order: the first failing arm names the refusal, so `write-id-reused` is judged after
`revision-conflict`. Setting the SAME value again under a DIFFERENT command id is a normal
revision-advancing apply (new `valueId`, new `updatedAt`), never `already-applied`.

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
| `already-applied { revision }` | byte-exact envelope replay under the same command id (protected: same marked fingerprint AND every `set` value byte-equal to the stored value) | no |
| `command-divergent` | same command id, different fingerprint — or, protected arm only, same marked fingerprint and a `set` value that differs from the stored value | no |
| `write-id-reused { writeId }` | protected arm only: a `writeId` the journal already holds under a DIFFERENT command id (`writeId`s are unique per store; a reuse is a client bug, never a second apply) | no |

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
  entries: { <name>: { valueId: uuid, value: <the exact string>, updatedAt: iso } },
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
   (`activityPersonPseudonym`, R04 2026-09-04: D288's PUBLIC generation id is served — on Activity and in
   `activity_person_pseudonyms.keyGeneration` — from the durable key-commitment binding and the evidence rows,
   never from this store's readback; the store entry's VALUE is the key plus that label as one pair and stays
   write-only, and D288's reviewed batch comparison is what proves the two agree. The public label is
   evidence, not a setting, so rule 1 and D288 do not collide.)
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
4. **Replay divergence is judged inside the file's own lock, by direct comparison.** An exact
   replay of `apply-protected-settings` proves its `set` values are the values the first apply
   stored (`already-applied`) or are not (`command-divergent`) by a constant-time byte comparison
   against the stored value under the lock. Nothing derived from a value — no MAC, no digest, no
   key — is stored beside it, journaled, served or logged, and there is no password-verification
   oracle (no "check this password" command). A keyed MAC was considered and rejected: its key would
   live in the same `0600` file as the plaintext it authenticates, adding no property a direct
   comparison lacks while creating undefined rotation and restore semantics.
5. **Absent is a valid state, and it is distinguishable.** An entry that was never set or was
   cleared is `present: false`; the accessor's `requireSecret` throws `SecretMissingError` naming the
   KEY; `inspectSecret` answers `missing`; a store that cannot be read (mode, owner, size, parse)
   is `unknown` and re-throws everything else. "The check failed" is never "the check found nothing".
6. **Canary inputs are protected, not ordinary.** _Superseded by §D341 (2026-09-07): canary values now
   live in ignored `config/test-data.local.json` and the public registry is the `subjects` member of
   `config/test-data.json`; the rule below is the D331 design as written._ `config/test-subjects.json` stays the committed
   PUBLIC registry (label → workflow, kind, availability, `lastObserved`, reference NAME);
   `optionalTestTargetSecret` reads the protected store by that name with the same per-kind schema.
   D300's semantics are unchanged — unset is `blocked` by key, malformed is a defect by key, the
   number is never copied into a name or EID field — only the SOURCE moves from `.env` to the
   store. A person-lookup EID canary is a `protected-identifier`; a Kuali document number is a
   `protected-identifier` too (it resolves to a person).

   > 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | the import of both canary references — valid imports, malformed refuses `invalid-value { key }`, absent stays `blocked` by key — is §D332 (settings half) §D332.S4.
   **Protected-source transaction projection (operator-approved 2026-09-05).** Test admission retains
   the configured canary value privately with its protected name, canonical input path and `valueId`.
   Public plans and fingerprints substitute that binding. The natural permanent transaction key and
   its authoritative digest remain unchanged inside private write-safety authority, including across
   protected rotation and clear/re-set. Receipts, logs, refusals, diagnostics and dashboard/Archive
   projections omit that protected-derived digest, using a closed withheld marker and existing
   independent run/write-intent identities. Historical authority remains immutable; its protected
   values and old derived digests are not newly served. This is the narrow exception to mandatory
   digest presentation in ref write-safety; it is not an exception permitting public protected data.

   **Historical archive lifecycle identity (operator-approved 2026-09-06, Task 1.6.5).**
   Canonical relaunch/delete requests retain the value-free `archiveFingerprint` already cited by
   Archive, never its private historical `contentDigest`. The lifecycle service authenticates the
   retained private content before matching that reference on first apply. Its existing journal
   commits the safe reference and permitted request facts; relaunch/create input projection applies
   retained protected bindings across both raw and parsed copies. Archive command commitments use
   the authenticated permitted archive projection, excluding already-withheld diagnostic blobs.
   Exact replay of these requests remains read-only after source deletion; a different reference,
   ordinary request fact or original fence refuses. Protected bytes and historical derived digests
   neither enter these commitments nor appear in refusals. No raw-digest fallback, secondary hash,
   new table, run verb or screen is admitted. Historical private archive records remain unchanged.
   For new value-free-sealed archives, the repository authenticates private input by exact direct
   comparison with the independently retained run input in the same SQLite read snapshot. A missing
   or differing copy refuses before citation or use. This comparison supplies no current-run display
   content and consults neither current settings nor the protected store. Historical raw seals keep
   their existing authentication path; no new protected-derived digest is created.

7. **Clear is a write.** `{ clear: true }` removes the entry and retires its `valueId`; it is
   journaled, CAS-fenced and revision-advancing like a set. **Every protected row has a per-name
   value schema** the apply arm and the accessor share: the canaries keep `KualiDocumentNumberSchema`
   / `EidSchema`, the pseudonym pair keeps its 64-hex + generation-id shape, and the four credentials
   — which today are validated only as non-empty strings — get a closed, length-bounded string
   schema each (1.6 owes it, §D331.11); an empty string is `invalid-value`, never "cleared".
8. **Historical exposure is named, not erased.** Today `operator.timekeeperName` is a `Config` leaf,
   so every existing `config_snapshots` row carries the timekeeper's name verbatim, every
   `configFingerprint` has it in its preimage, and every `cli storage backup` copied it. §4.1
   forbids rewriting a released snapshot generation for three reasons that still hold; D331 records
   this as ACCEPTED historical exposure of one `direct-identifier` (never a password, never a
   canary), requires backup files to stay `0600` under existing writer hygiene (§6.1), and forbids
   any claim that the migration erases it. Retiring the leaf also needs an explicit RETIREMENT arm in
   `snapshot-generations.ts` (`auditConfigSnapshotGenerations` refuses a vanished registered leaf
   today) — an owed 1.6 change, and 0.3 Task 3 owns the generation rule.

**2026-09-05 — Task 1.6.5 operator amendment: the timekeeper is not displayed.** Each
installation has one timekeeper; the operator already knows their identity. Admission reads
`timekeeperName` once and retains the value in canonical run input with its protected name,
input path and immutable store `valueId`. Approval and evidence bind that retained identity,
never the value or a digest derived from it. The Separations identity approval packet omits the
name and all name-derived text, including initials within generated comments; its digest binds
the value-free retained identity and the remaining decision facts. Later protected rotation
neither changes that run nor invalidates its approval. Changing any other approved fact still
invalidates approval. Historical input uses an explicit legacy binding marker; old protected
bytes or their digests must not be newly served. This narrowly supersedes ref write-safety
§14.5/§14.10's inclusion of the timekeeper among displayed and hashed write-plan values.

**2026-09-06 — Task 1.6.5 rendered-proof amendments.** The operator approved generated
code-version provenance updates in 194 additional reference triples, beyond the twelve Separations
Start and four directly affected identity-approval triples. This includes metadata, a11y headers
and displayed hashes. Six `explorer-transaction` triples may additionally update generated schema
field totals from `103 reads / 13 writes` to `107 / 14`, reflecting the admitted protected binding
fields; no transaction is added. Only those count glyphs and corresponding a11y text are admitted.
The owning Task-5 section records the exact review and negative-control evidence. All other
non-hash visual changes remain limited to the previously approved Start/identity scope.

###### D331.7 — restart scope, and where the D330 claim token comes from

| `restartScope` | Rows | Takes effect | Mechanism |
|---|---|---|---|
| `generation` | every `ordinary-settings` row (the host display VALUE reaches `Config` only through the next activation, which is the `generation` scope of the `display.*` ordinary rows) | at the next dashboard boot, for every process the dashboard then spawns | `apply-settings` advances `settings_current`; the dashboard's boot activates a new runtime generation with the resolved config; workers compare the token on every claim |
| `next-use` | every `protected-store` CREDENTIAL row (`ucpathUserId`, `ucpathPassword`, `timekeeperName`, `sharepointOnboardingRosterUrl`, the pseudonym pair) | at the next accessor call | the accessor reads the store at each use; nothing caches a credential across uses; a run that already holds a browser session keeps it. Each of these is ALSO a blocking enqueue-time dependency (`src/domain/runtime-dependencies.ts` `secret.ucpath-sso` / `secret.timekeeper` / `secret.sharepoint-roster`), so a cleared entry blocks new enqueues immediately while an already queued run keeps the canonical input it was enqueued with; `timekeeperName`'s filed value is run INPUT, never re-read at use. `sharepointOnboardingRosterUrl` is the one `next-use` leaf whose value selects DATA rather than authenticating: it is read at most once per run, at first use, and held in process memory for that run — never in canonical input or evidence — so a mid-run change cannot move the source a started download reads |
| `next-start` | the canary/test-input rows | at the next dry-run start admission | admission reads the store once and retains the reference NAME (never the value) in the run's start record |
| `process` | `runtime-isolation` rows; the `derived-host` row (the host display PROBE); the five `provider-env` families (`.env` is admitted once per process by the bootstrap) | at the next process start | code / once-per-process-tree probe (D324: a child never re-probes) / the bootstrap |

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
  `OCR_*_MODELS` chain keys, and the five legacy singular `OCR_*_MODEL` spellings once
  `providerModelChain`'s fallback arm is deleted) takes a NEW registry disposition,
  `migrated-refused`. The pre-existing `retired-in-target` disposition keeps its inert meaning
  ("not read by the rebuild runtime"; `DEBUG`, `PLAYWRIGHT_BROWSERS_PATH` and the rest stay
  documented, unread and never a boot refusal). A `migrated-refused` key PRESENT in the admitted
  `.env` refuses at bootstrap by key name with the remedy ("set it in Settings, then remove it from
  `.env`"); a `migrated-refused` key present in the parent process environment is reported by the
  environment doctor (§6.2) and refuses dashboard and worker boot by key name. Neither is ever read
  as a value. This is the "stale `.env` leaf shadowing a migrated value" case closed at the door: a
  value that cannot be read cannot shadow.
- The `.env` admission allowlist becomes: the five provider key families' pool cells, and nothing
  else. The bootstrap's mechanics (no-follow open, `mode & 0o077 === 0`, 64 000-byte bound, strict
  grammar, one-to-one `parseEnv` cross-check, explicit parent bindings win) are unchanged; only the
  set of keys it will carry into the process changes. Unknown keys were already refused.
- `SettingsOverrideSchema` (the resolver's sparse input) and `EditableSettingsOverrideSchema` (the
  persisted/editable document) become ONE schema over the `ordinary-settings` class — which by
  §D331.2 is exactly the `editability: operator` subset of `Config`, so `runtime-isolation` leaves
  (prod routes, `actor.id`, the isolation paths) are not members and `not-editable { key }` refuses
  them by construction: the resolver accepts exactly what the document can hold, so no composition
  can inject an override the operator cannot see. The `paths` group of that schema holds the four operator paths only; the five
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
  the schema rather than of the layer that was removed; (iv) `display` is group-valid: both
  `screenWidth` and `screenHeight` are present or the group is absent — a half override is a
  document-schema refusal and a `cross-field-invalid { keys }` arm, never a hybrid of the saved
  width and the probed height (a plausible-but-wrong browser geometry is the fail-loud rule's
  cardinal case).

**What still comes from the environment, and why each is not a duplicate:** provider API keys
(secrets accessor, never the resolver — one authority, `.env`); the host display publication (a
DEFAULT beneath the ordinary override — the override is the only competing value, and it is the
operator's explicit one); the launch nonce (process ownership, not configuration); test-only keys
(never a production leaf).

###### D331.9 — the catalog (frozen 2026-09-04)

This table is the enumeration §D331.1 requires: one row per catalogued leaf, every cell a closed enum
or a literal. 1.6's registry must match it bidirectionally — a leaf without a row or a row without a
leaf is a red gate. Grouping: each `urls.<system>.prod` route set is ONE row per system and each
`urls.<system>.test` override set is ONE row per system (the route leaves are listed in `key`); each
`providers.<capability>` budget is ONE row carrying its five budget leaves. Everything else is one
row per leaf.

| key | schema | defaultKind | editability | sensitivity | restartScope | sourceClass | consumers | current → target |
|---|---|---|---|---|---|---|---|---|
| `actor.id` | `LocalOperatorActorSchema.id` (`ids.ts`) | `contract` | `deployment` (`src/domain/ids.ts` — `LOCAL_OPERATOR_ACTOR_ID`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `code → code` |
| `actor.label` | `LocalOperatorActorSchema.label` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `urls.kuali.prod.entry` | `KualiRoutesSchema` | `contract` | `deployment` (`src/domain/config/schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback (default provenance)` | `code → code` |
| `urls.newKronos.prod.entry` | `NewKronosRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.crm.prod.{entry,onboardingSearch,ucPathEntrySheet,onboardingHistory,idocsViewer}` | `CrmRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.onbase.prod.entry` | `OnBaseRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.ucpath.prod.{login,smartHr,jobSummary,personalData,personProfile}` | `UcpathRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.i9.prod.{entry,app}` | `I9RoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.oldKronos.prod.entry` | `OldKronosRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.servicenow.prod.entry` | `ServiceNowRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.sharepoint.prod.entry` | `SharePointRoutesSchema` | `contract` | `deployment` (`schema.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/resolve.ts: contract route set` · `server/settings-runtime.ts: readback` | `code → code` |
| `urls.kuali.test.entry` | `KualiRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_KUALI_TEST_URL → settings.json` |
| `urls.newKronos.test.entry` | `NewKronosRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_NEW_KRONOS_TEST_URL → settings.json` |
| `urls.crm.test.{entry,onboardingSearch,ucPathEntrySheet,onboardingHistory,idocsViewer}` | `CrmRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `[settings.json, env:HRAUTO_CRM_TEST_URL] → settings.json` |
| `urls.onbase.test.entry` | `OnBaseRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_ONBASE_TEST_URL → settings.json` |
| `urls.ucpath.test.{login,smartHr,jobSummary,personalData,personProfile}` | `UcpathRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `[settings.json, env:HRAUTO_UCPATH_TEST_URL] → settings.json` |
| `urls.i9.test.{entry,app}` | `I9RoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `[settings.json, env:HRAUTO_I9_TEST_URL] → settings.json` |
| `urls.oldKronos.test.entry` | `OldKronosRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_OLD_KRONOS_TEST_URL → settings.json` |
| `urls.servicenow.test.entry` | `ServiceNowRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_SERVICENOW_TEST_URL → settings.json` |
| `urls.sharepoint.test.entry` | `SharePointRoutesSchema.partial()` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: test-override merge` · `server/settings-runtime.ts: readback` | `env:HRAUTO_SHAREPOINT_TEST_URL → settings.json` |
| `timeouts.navigationMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.longNavigationMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.ukgNavigationMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_UKG_NAVIGATION_MS → settings.json` |
| `timeouts.taskMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.sessionAcquireMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.duoCeremonyLeaseGraceMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.transactionMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.duoApprovalSeconds` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.duoApprovalCrmSeconds` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `timeouts.retryDelayMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `paths.reportsDir` | `AbsolutePathSchema` | `runtime-path` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/runtime-paths.ts: default composition` · `config/resolve.ts: leaf supply` | `settings.json → settings.json` |
| `paths.downloadsDir` | `AbsolutePathSchema` | `runtime-path` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/runtime-paths.ts: default composition` · `config/resolve.ts: leaf supply` | `code → settings.json` |
| `paths.onboardingDocsDir` | `AbsolutePathSchema` | `runtime-path` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/runtime-paths.ts: default composition` · `config/resolve.ts: leaf supply` | `code → settings.json` |
| `paths.i9CheckTrackerPath` | `AbsolutePathSchema` | `runtime-path` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/runtime-paths.ts: default composition` · `config/resolve.ts: leaf supply` | `code → settings.json` |
| `annualDates.<FY>.jobEndDate` | `UsDateSchema` (`AnnualDateEntrySchema`) | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: per-fiscal-year merge` · `server/settings-runtime.ts: readback` | `env:ANNUAL_DATES_END → settings.json` |
| `annualDates.<FY>.kronosDefaultEndDate` | `UsDateSchema` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: per-fiscal-year merge` · `server/settings-runtime.ts: readback` | `env:KRONOS_DEFAULT_END_DATE → settings.json` |
| `annualDates.<FY>.kronosDefaultStartDate` | `UsDateSchema` | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: per-fiscal-year merge` · `server/settings-runtime.ts: readback` | `env:KRONOS_DEFAULT_START_DATE → settings.json` |
| `display.screenWidth` | `z.number().int().positive()` | `host-derived` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: explicit override above the host default` · `server/settings-runtime.ts: readback beside the observation` | `settings.json → settings.json` |
| `display.screenHeight` | `z.number().int().positive()` | `host-derived` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: explicit override above the host default` · `server/settings-runtime.ts: readback beside the observation` | `settings.json → settings.json` |
| `performance.navigationRetries` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_NAVIGATION_RETRIES → settings.json` |
| `performance.separationTerminationWindowDays` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS → settings.json` |
| `ocr.secondOpinionMax` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_SECOND_OPINION_MAX → settings.json` |
| `ocr.pageMaxWaitMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_PAGE_MAX_WAIT_MS → settings.json` |
| `ocr.tier1PatienceMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_TIER1_PATIENCE_MS → settings.json` |
| `ocr.pageConcurrency` | `z.number().int().nonnegative()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `[settings.json, env:OCR_PAGE_CONCURRENCY] → settings.json` |
| `ocr.disambigConcurrency` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_DISAMBIG_CONCURRENCY → settings.json` |
| `ocr.suggestConcurrency` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_SUGGEST_CONCURRENCY → settings.json` |
| `ocr.backoffBaseMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_BACKOFF_BASE_MS → settings.json` |
| `ocr.backoffCapMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:OCR_BACKOFF_CAP_MS → settings.json` |
| `ocr.maxValidationRetries` | `z.number().int().nonnegative()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `[settings.json, env:OCR_MAX_VALIDATION_RETRIES] → settings.json` |
| `browserHealth.monitorTickMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_HEALTH_MONITOR_TICK_MS → settings.json` |
| `browserHealth.maxAutoRefresh` | `z.number().int().nonnegative()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_HEALTH_MONITOR_MAX_REFRESH → settings.json` |
| `browserHealth.maxReopen` | `z.number().int().nonnegative()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_HEALTH_MONITOR_MAX_REOPEN → settings.json` |
| `browser.headless` | `z.boolean()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `browser.closeProofMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `concurrency.defaultWorkers` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `[settings.json, env:HRAUTO_DEFAULT_WORKERS] → settings.json` |
| `daemon.idleMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_DAEMON_IDLE_MS → settings.json` |
| `daemon.idleRepollMs` | `z.number().int().positive()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HRAUTO_DAEMON_IDLE_REPOLL_MS → settings.json` |
| `features.debugScreenshots` | `z.boolean()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:DEBUG_SCREENSHOTS → settings.json` |
| `features.duoWebAuthn` | `z.boolean()` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/resolve.ts: leaf composition` · `server/settings-runtime.ts: readback` | `env:HR_AUTOMATION_DUO_WEBAUTHN → settings.json` |
| `providers.ocrExtract.{timeoutMs,concurrency,requestsPerMinute,dailyRequestLimit,costLimitUsdMicros}` | `ProviderBudgetSchema` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/schema.ts: providerBudget lookup` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `providers.geocodeCensus.{timeoutMs,concurrency,requestsPerMinute,dailyRequestLimit,costLimitUsdMicros}` | `ProviderBudgetSchema` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/schema.ts: providerBudget lookup` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `providers.geocodeNominatim.{timeoutMs,concurrency,requestsPerMinute,dailyRequestLimit,costLimitUsdMicros}` | `ProviderBudgetSchema` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/schema.ts: providerBudget lookup` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `providers.aiAdvisory.{timeoutMs,concurrency,requestsPerMinute,dailyRequestLimit,costLimitUsdMicros}` | `ProviderBudgetSchema` | `contract` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `config/schema.ts: providerBudget lookup` · `server/settings-runtime.ts: readback` | `settings.json → settings.json` |
| `providers.gemini.models` | model-chain list schema — 1.6 (`readonly string[]`, comma-separated today) | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `domain/secrets.ts: providerModelChain` · `server/settings-runtime.ts: readback` | `env:OCR_GEMINI_MODELS → settings.json` |
| `providers.groq.models` | model-chain list schema — 1.6 | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `domain/secrets.ts: providerModelChain` · `server/settings-runtime.ts: readback` | `env:OCR_GROQ_MODELS → settings.json` |
| `providers.mistral.models` | model-chain list schema — 1.6 | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `domain/secrets.ts: providerModelChain` · `server/settings-runtime.ts: readback` | `env:OCR_MISTRAL_MODELS → settings.json` |
| `providers.openRouter.models` | model-chain list schema — 1.6 | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `domain/secrets.ts: providerModelChain` · `server/settings-runtime.ts: readback` | `env:OCR_OPENROUTER_MODELS → settings.json` |
| `providers.sambanova.models` | model-chain list schema — 1.6 | `none` | `operator` | `ordinary` | `generation` | `ordinary-settings` | `domain/secrets.ts: providerModelChain` · `server/settings-runtime.ts: readback` | `env:OCR_SAMBANOVA_MODELS → settings.json` |
| `ucpathUserId` | `SECRET_SPECS` entry; per-name value schema owed by 1.6 (non-empty string today) | `required` | `operator` | `protected-identifier` | `next-use` | `protected-store` | `domain/secrets.ts: requireSecret/optionalSecret` · `server/settings-runtime.ts: presence readback` · `domain/runtime-dependencies.ts: blocking enqueue preflight` | `env:UCPATH_USER_ID → protected.json` |
| `ucpathPassword` | `SECRET_SPECS` entry; per-name value schema owed by 1.6 | `required` | `operator` | `protected-secret` | `next-use` | `protected-store` | `domain/secrets.ts: requireSecret` · `server/settings-runtime.ts: presence readback` · `domain/runtime-dependencies.ts: blocking enqueue preflight` | `env:UCPATH_PASSWORD → protected.json` |
| `timekeeperName` | `SECRET_SPECS` entry; per-name value schema owed by 1.6 | `required` | `operator` | `protected-identifier` | `next-use` | `protected-store` | `domain/secrets.ts: requireSecret` · `server/settings-runtime.ts: presence readback` · `domain/runtime-dependencies.ts: blocking enqueue preflight` | `[settings.json, env:TIMEKEEPER_NAME] → protected.json` |
| `sharepointOnboardingRosterUrl` | `SECRET_SPECS` entry; per-name value schema owed by 1.6 | `required` | `operator` | `protected-secret` | `next-use` | `protected-store` | `domain/secrets.ts: requireSecret/optionalSecret` · `server/settings-runtime.ts: presence readback` · `domain/runtime-dependencies.ts: blocking enqueue preflight` | `env:ONBOARDING_ROSTER_URL → protected.json` |
| `activityPersonPseudonym` (HMAC key + public generation id, one pair) | 64-hex key shape + generation-id shape (`requireActivityPersonPseudonymDomain`) | `required` | `operator` | `protected-secret` | `next-use` | `protected-store` | `domain/secrets.ts: requireActivityPersonPseudonymDomain` · `server/settings-runtime.ts: presence readback` | `env:HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY + env:HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION → protected.json` |
| `separationsKualiFinalizationCanaryDocumentNumber` — **row retired by D341 (2026-09-07)** | `KualiDocumentNumberSchema` (`TEST_TARGET_SECRET_SPECS`) | `none` | `operator` | `protected-identifier` | `next-start` | `protected-store` | `domain/secrets.ts: optionalTestTargetSecret` · `dry-run start admission: retains the reference NAME only` | `env:HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER → protected.json` |
| `personLookupCanaryEid` — **row retired by D341 (2026-09-07)** | `EidSchema` (`TEST_TARGET_SECRET_SPECS`) | `none` | `operator` | `protected-identifier` | `next-start` | `protected-store` | `domain/secrets.ts: optionalTestTargetSecret` · `dry-run start admission: retains the reference NAME only` | `env:HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID → protected.json` |
| `geminiApiKeys` (pool, ≤8 cells) | `SecretFamilySpecSchema` (`SECRET_FAMILY_SPECS`) | `none` | `operator` | `provider-key` | `process` | `provider-env` | `domain/secrets.ts: requireSecretFamily/optionalSecretFamily` · `server/settings-runtime.ts: inspectSecret-shaped availability` | `env:GEMINI_API_KEY{,2..8} → .env.providers` |
| `groqApiKeys` (pool, ≤8 cells) | `SecretFamilySpecSchema` | `none` | `operator` | `provider-key` | `process` | `provider-env` | `domain/secrets.ts: requireSecretFamily/optionalSecretFamily` · `server/settings-runtime.ts: availability only` | `env:GROQ_API_KEY{,2..8} → .env.providers` |
| `mistralApiKeys` (pool, ≤8 cells) | `SecretFamilySpecSchema` | `none` | `operator` | `provider-key` | `process` | `provider-env` | `domain/secrets.ts: requireSecretFamily/optionalSecretFamily` · `server/settings-runtime.ts: availability only` | `env:MISTRAL_API_KEY{,2..8} → .env.providers` |
| `openRouterApiKeys` (pool, ≤8 cells) | `SecretFamilySpecSchema` | `none` | `operator` | `provider-key` | `process` | `provider-env` | `domain/secrets.ts: requireSecretFamily/optionalSecretFamily` · `server/settings-runtime.ts: availability only` | `env:OPEN_ROUTER_API_KEY{,2..8} → .env.providers` |
| `sambaNovaApiKeys` (pool, ≤8 cells) | `SecretFamilySpecSchema` | `none` | `operator` | `provider-key` | `process` | `provider-env` | `domain/secrets.ts: requireSecretFamily/optionalSecretFamily` · `server/settings-runtime.ts: availability only` | `env:SAMBANOVA_API_KEY{,2..8} → .env.providers` |
| `display` (host primary-display publication, `HRAUTO_HOST_PRIMARY_DISPLAY`) | `DEFAULT_DISPLAY` shape (`screenWidth`/`screenHeight`, int positive) | `host-derived` | `derived` | `derived-host` | `process` | `derived-host` | `config/host-display.ts: probe once per process tree and publish` · `config/resolve.ts: DEFAULT layer for the display group` | `probe → probe` |
| `paths.stateRoot` | `AbsolutePathSchema` | `runtime-path` | `deployment` (`config/runtime-isolation.json` + `config/runtime-paths.ts`) | `ordinary` | `process` | `runtime-isolation` | `config/runtime-paths.ts: isolation default composition` · `config/resolve.ts: leaf supply (not overridable)` | `code → code` |
| `paths.artifactRoot` | `AbsolutePathSchema` | `runtime-path` | `deployment` (same files) | `ordinary` | `process` | `runtime-isolation` | `config/runtime-paths.ts: isolation default composition` · `config/resolve.ts: leaf supply` | `code → code` |
| `paths.browserProfileRoot` | `AbsolutePathSchema` | `runtime-path` | `deployment` (same files) | `ordinary` | `process` | `runtime-isolation` | `config/runtime-paths.ts: isolation default composition` · `config/resolve.ts: leaf supply` | `code → code` |
| `paths.duoCredential` | `AbsolutePathSchema` | `runtime-path` | `deployment` (same files) | `ordinary` | `process` | `runtime-isolation` | `config/runtime-paths.ts: joins the profile root` · `domain/secrets.ts: requireSecretFile target` | `code → code` |
| `paths.duoExtensionDir` | `AbsolutePathSchema` | `runtime-path` | `deployment` (same files) | `ordinary` | `process` | `runtime-isolation` | `config/runtime-paths.ts: isolation default composition` · `config/resolve.ts: leaf supply` | `code → code` |
| `duoWebauthnCredential` (file at `paths.duoCredential`) | `SecretFileSpecSchema` (`SECRET_FILE_SPECS`, `credential-file`, ≤ `REGISTERED_SECRET_FILE_MAXIMUM_BYTES`) | `none` | `machine` | `protected-secret` | `process` | `runtime-isolation` | `domain/secrets.ts: requireSecretFile` · `domain/secrets.ts: resolveSecretFileIdentity` | `code → code` |

**Counts** — `ordinary-settings` 59 · `protected-store` 7 · `provider-env` 5 · `derived-host` 1 · `runtime-isolation` 16 · **total 88 rows**. The dashboard launch nonce and the `test-only` keys are excluded by name (§D331.2), not counted.

###### D331.10 — the Settings/Setup interface edit contract (3.1 consumes)

The Settings/Setup surface renders the served catalog projection and nothing else: it never reads
`.tracker/settings/settings.json`, never reads `protected.json`, never reads a SQLite table, and
never reconstructs either document from parts (ref frontend-backend-integration §4, "the browser
never reads files/tables or reconstructs either authority" — the D327 ownership cut). Every value,
default, provenance label, presence flag, availability arm, restart scope and refusal message on the
page arrives on the one bootstrap/readback wire of §D331.5, already redacted by the server; a leaf
the wire does not serve does not exist for the surface. The surface's sections are the five source
classes of §D331.2 in this fixed order — `ordinary-settings`, `protected-store`, `provider-env`,
`derived-host`, `runtime-isolation` — each a labelled section with the class's own control grammar,
because the class decides what may be shown and what may be typed. Within `ordinary-settings` the
existing DCC3 section grouping (General · Display · Performance · Paths, plus the groups §D331.9's
longer list adds) is presentation only; the catalog row, not the section, is the authority.

| Source class | What is shown | What is editable | Control | Readback after save | Restart banner |
|---|---|---|---|---|---|
| `ordinary-settings` | per row: persisted value (or "not set"), active value, default value, provenance badge (`settings` \| `default` — there is no `Environment` badge after D331.8), the leaf key, the row's `restartScope`, and the row's hazard copy where the catalog carries one | every row whose catalog `editability` is `operator` — which under D331 is exactly this class (§D331.5, `apply-settings`) | typed input bound to the leaf's own schema (text/number/boolean/date per the catalog `schema` reference), per-leaf Reset to the persisted value, Discard all, one Save that submits the whole dirty draft as ONE patch with `expectedRevision` (§D331.5 arm 1) | the served persisted values re-read from the wire after apply, plus the new `revision` and `settingsFingerprint`; the draft is cleared only for rows the readback confirms | yes — `restartRequired: true`, rendered from the served `runtimeStatus` (§D331.7 `generation` scope) |
| `protected-store` | per catalogued protected NAME: the name, its purpose copy, and the presence tuple ONLY — `present: true \| false`, `updatedAt?`, plus the store `revision` for the section. Never a value, never a digest, never a length, never a `last4`, never a "changed since" diff | every catalogued protected name (`apply-protected-settings`, §D331.5 arm 2) | a write-only input: always empty on render, never pre-filled from any served field, never echoed back into the field after save, with NO reveal/"show" toggle and NO "verify this password" control (there is no such command — §D331.6 rule 4); beside it a `Clear` action that submits `{ clear: true }`. Save submits `{ protectedSchemaHash, writeId, entries }` with the PROTECTED store's own `expectedRevision` | the presence tuple per name from the command result (`present`, `valueId?`, `updatedAt?`) and the store's new `revision`; the input is emptied, never repopulated | no — `restartRequired: false` (§D331.7 `next-use` / `next-start`); the surface says when it takes effect ("at the next login" / "at the next dry-run start"), never "restart required" |
| `provider-env` | per FAMILY (the five `SECRET_FAMILY_SPECS` pools), the `inspectSecret`-shaped availability arm only: `present` with the count of populated pool cells, `missing`, or `unknown`. No key, no cell name, no prefix value | nothing | no input at all — read-only rows plus fixed instruction copy: edit `.env.providers` and restart (D343 supersedes the source path in §D331.2, §D331.8) | none (nothing is submitted) | no |
| `derived-host` | the observed primary display (D324, `process` scope, never persisted) AND, beside it, the ordinary `display` override row with its own persisted/active/default columns, so the operator can see that an explicit override is hiding a changed host (§D331.7, last paragraph) | the `display` override only — it is an `ordinary-settings` row and travels in arm 1 | the ordinary control, plus a deliberate `Clear override` action that submits the omission of the leaf (returning the row to the host-derived default); the observation itself has no control | the override's persisted value (or "not set") and the unchanged observation | yes for the override (it is `generation` scope); the observation alone never raises one |
| `runtime-isolation` | the resolved absolute paths (`paths.stateRoot`, `paths.artifactRoot`, `paths.browserProfileRoot`, `paths.duoCredential`, `paths.duoExtensionDir`) and the Duo credential file's path, read-only, with the copy that they change by code, not by Settings (§D331.2) | nothing | no input; copy naming the owning file (`config/runtime-isolation.json` / `runtime-paths.ts`) | none | no |

**Conflict and refusal UX.** `revision-conflict { currentRevision }` is not an error page: the
surface re-reads the wire, shows the CURRENT persisted/active values beside the operator's own
unsaved edits, and keeps the draft intact — nothing is discarded, nothing is auto-merged, and the
operator re-submits deliberately against the new revision (a client-side merge of two drafts is
forbidden; §D331.4 has no "latest wins"). Each of the closed refusal arms in §D331.5
(`schema-mismatch`, `patch-fingerprint-mismatch` / `envelope-fingerprint-mismatch`,
`not-editable { key }`, `invalid-value { key }`, `revision-conflict`, `cross-field-invalid { keys }`,
`document-too-large`, `authority-unjournaled` / `authority-uncertain`, `directory-integrity` /
`lock-unavailable`, `command-divergent`, and `write-id-reused { writeId }` — a client bug, never a
second apply: the surface mints a fresh `writeId` and re-submits without asking the operator to
retype the value) maps to one fixed sentence that names the KEY or the
DOCUMENT and never the value — the surface never composes a message from a server string that could
carry one, and a protected refusal names the protected NAME only. `already-applied { revision }` is
presented as SUCCESS (the exact-replay arm; the copy says the values were ALREADY stored — never "your new
value was saved", because for the protected arm it means the same value was already there — so the
operator is never invited to re-type a credential to "make it stick").

**The restart contract.** An applied ordinary write renders `restartRequired` from the command
result together with the served `runtimeStatus` (`current` → active; `restart-required` → the banner
naming the persisted revision and the revision this dashboard still runs, as the as-built banner
does). That state is a served fact, not a client inference from a revision comparison. An applied
protected write renders no restart banner and no generation language at all: §D331.7 fixes that a
protected apply advances no runtime generation and never touches an in-flight claim.

**Accessibility and parity.** The write-only protected input, its clear action and the presence
tuple are ordinary labelled form controls under the surface's existing field/hint/error grammar and
its 44px pointer-coarse rule; the section list gains rows, not a new interaction model. The eleven
frozen parity references that today contain the Settings surface's `settings.json: not set` line
(`tests/parity/references/{settings,storage-settings}--*.yml`) necessarily change when the provenance
badge loses its `Environment` arm and the protected/provider/isolation sections appear — Phase 3.1
re-freezes the Settings surface's ref frontend-backend-integration §7 references deliberately through
`npm run test:parity:update`. This subsection does NOT design those references, the layout, or any
component.

**What 3.1 must NOT build.** No settings or catalog dump inside a diagnostic bundle, an export or a
support archive (§D331.6 rule 1). No password reveal, no masked-value echo, no `last4`, no
"copy value" affordance. No digest comparator, no "does this match?" control, no offline check of a
served hash against a typed value — replay divergence is judged only inside the executor under
the lock (§D331.6 rule 4). No export of protected presence beyond the served tuple (no CSV, no XLSX column,
no clipboard bundle of names and `updatedAt`). No client-side merge of two drafts, no optimistic
"latest wins" retry after a `revision-conflict`, and no client-composed patch for a key the wire did
not serve as editable.

###### D331.11 — what 1.6 must prove

Each row is one owed proof: the invariant, the oracle that makes it red-capable, and the file that
carries it. 1.6 writes them; this list is the obligation, not the code. `settings-catalog` is a NEW
architecture guard and lands with its `docs/rebuild/guard-inventory.json` entry in the same commit
(`guard-manifest.test.ts` checks both directions, and the arm is executed against a violating
fixture like every mechanical arm). P23–P30 live in unit tests by nature, so the `settings-catalog`
guard also asserts that every proof row's named test file exists and references its `P<n>` id — a
deleted or renamed proof is a red guard, not silent drift.

| # | Invariant | Proven by | Where (guard/test/file) |
|---|---|---|---|
| P1 | The catalog is bidirectionally complete: one row per populated `ConfigSchema` leaf, per `SECRET_SPECS` entry (D341 retired `TEST_TARGET_SECRET_SPECS`; 86 rows), per `SECRET_FAMILY_SPECS` family and per `config-default`/process-ownership channel — and no row without a leaf | enumerate every source at test time (never a hand-kept list) and diff both directions; adding a leaf without a row, or a row naming nothing, is red | NEW guard `tests/unit/architecture/settings-catalog.test.ts` + `docs/rebuild/guard-inventory.json` |
| P2 | One `sourceClass` per row, the `sensitivity` → `sourceClass` pairing is refused when wrong, and every listed consumer exists while every reader of the key is listed | feed the registry's `superRefine` a `protected-secret` row with `sourceClass: ordinary-settings` (and each other illegal pairing) and assert the parse refuses by key; drop a real reader from `consumers` and the guard is red | `settings-catalog.test.ts`; `src/domain/config/catalog.ts` |
| P3 | `CONFIG_ENV_BINDINGS` is empty and `runtime-environment.ts`'s `config` channel has zero members (the `config-and-secret` dual channel is gone with its leaf) | assert emptiness and zero cardinality directly; any restored binding is red | `settings-catalog.test.ts`, `tests/unit/architecture/runtime-environment-coverage.test.ts` |
| P4 | The resolver takes no environment input — `resolveConfig(document, hostFacts, clock?)` — and `ConfigProvenanceSchema` is exactly `"settings" \| "default"` | type-level plus runtime: resolve with a hostile `process.env` populated for every retired key and assert byte-identical output and no `"env"` provenance value anywhere | `src/domain/config/resolve.ts`, `provenance.ts`, `tests/unit/config.test.ts` |
| P5 | L1 — no catalogued protected name is a `ConfigSchema` leaf; `operator.timekeeperName` is deleted, not emptied | walk the parsed `ConfigSchema` leaf paths against the catalog's protected rows and assert an empty intersection | `settings-catalog.test.ts`, `src/domain/config/schema.ts` |
| P6 | L2 — no protected value is in the `configFingerprint` preimage | derived from P5: assert the fingerprint preimage is `canonicalJsonStringify(config)` and that `config` contains no protected key | `settings-catalog.test.ts`, `tests/unit/config.test.ts` |
| P7 | L3 — the durable command row and its audit `request` hold the MARKED envelope; no `set` value byte and no function of one is ever journaled | apply a protected write with a canary value, then scan the `commands`/`command_audits` rows for the value and for any digest of it; both absent, `"<set>"` present | `tests/unit/command-kernel.test.ts`, `tests/unit/settings-file-service.test.ts` |
| P8 | L4 — the ordinary `settings` object can never hold a protected name | submit a patch naming a protected key and assert `not-editable { key }` before authority access; assert the persisted schema has no protected member | `tests/unit/settings-file-service.test.ts`, `src/domain/config/settings.ts` |
| P9 | L5 — `config_snapshots` rows carry no protected value after the migration | mint a snapshot with the store populated and assert the stored `config` and its keys contain no protected name | `tests/unit/config.test.ts`, `src/domain/config/snapshot.ts` |
| P10 | L6 — the provenance map carries leaf PATHS and the two-value vocabulary only; no protected path and no value | assert the record's keys are exactly the resolved ordinary leaf paths and its values are within `settings\|default` | `tests/unit/config.test.ts`, `src/domain/config/provenance.ts` |
| P11 | L7 — `runtime_config`, `settings_current`, `protected_settings_current` and the D330 claim token hold counters, hashes, names and write identities only | assert the four claim-token fields and each singleton's columns against a populated store; a protected value or digest in any of them is red | `tests/unit/architecture/strict-boundary-schemas.test.ts`, `src/domain/config/runtime-generation.ts` |
| P12 | L8 — the protected readback wire is exactly `{ present, valueId?, updatedAt? }` per name plus the store `revision`; the strict schema admits no extra key | round-trip a populated store through the wire schema and assert the exact key set; add `effectiveValue`/`defaultValue`/`last4`/any digest and the parse refuses | `tests/unit/server/settings-runtime-reader.test.ts`, `strict-boundary-schemas.test.ts` |
| P13 | L9 — the settings FACTS wire is not widened by the catalog (system hosts and workflow capabilities only) | assert the served fact keys against the frozen list with a populated protected store | `tests/unit/server/bff-flow.test.ts`, `src/server/dashboard/queries/settings.ts` |
| P14 | L10 — the bootstrap wire serves SCHEMA hashes (ordinary and protected) and never a value fingerprint of either document's contents | assert the served fields and that the protected hash is a function of the schema alone (identical across two stores with different values) | `tests/unit/server/bff-flow.test.ts`, `src/server/dashboard/queries/bootstrap.ts` |
| P15 | L11 — `cli storage backup` copies `settings.json` and `authority.json`, NEVER `protected.json`, and records the protected store's revision plus `{ name, valueId, updatedAt }` per entry | back up a root with a populated store, assert the manifest's file list excludes `protected.json`, grep the whole backup for the canary value, and assert the presence metadata is present and value-free; assert `authority.json`'s `rootFingerprint` is identical across two stores holding different protected values, and that no protected-target prepare/rollback record is ever in the manifest | `tests/unit/storage-backup.test.ts`, `src/infra/sqlite/backup-service.ts`, `recovery-contracts.ts` |
| P16 | L12 — storage doctor and preflight report a protected leaf by NAME and presence only, inside the existing closed reason-code policy | run the doctor and preflight over a populated root and assert no value and no path beyond the configured root's basename | `tests/unit/storage-doctor.test.ts`, `tests/unit/preflight.test.ts` |
| P17 | L13 — a diagnostic bundle carries `configFingerprint` and no settings/catalog dump | build a bundle with the store populated and assert the canary value and every catalog value are absent from bundle bytes | `tests/unit/server/diagnostic-bundle.test.ts` |
| P18 | L14 — spans, logs, receipts, failure records and every settings/secrets refusal name key, document or leaf id and never a value | drive each refusal arm with a canary value and assert the sinks; the existing family guard covers the mechanical half | `tests/unit/architecture/no-secret-values-in-logs.test.ts`, `tests/unit/architecture/secrets-single-source.test.ts` |
| P19 | L15 — XLSX exports remain free of any config/settings/protected reference | assert the composed workbook cells and metadata against a populated store; a new settings column is red | `tests/unit/server/activity-export.test.ts` |
| P20 | L16 — no protected value is published into `process.env` for a child; each process reads the store itself, and the parent's spawn environment is value-free | assert `secrets-single-source`'s new WRITE arm refuses a `process.env` write of a catalogued protected name, and inspect the worker supervisor's spawn environment for the canary | `secrets-single-source.test.ts`, `tests/unit/worker-composition.test.ts`, `src/server/dashboard/worker-supervisor.ts` |
| P21 | The protected envelope is canonicalized with every `set` value replaced by `"<set>"`, and boot re-authentication compares MARKED bytes to MARKED bytes | re-authenticate a stored command after restart with the value re-supplied and with a different value: both authenticate, because the journal never saw either | `tests/unit/server/settings-runtime-reader.test.ts`, `src/server/settings-runtime.ts` |
| P22 | Nothing derived from a protected value (no MAC, digest or key) is stored beside it, journaled, served or logged; replay divergence is a constant-time comparison under the lock, and there is no value-verification command | assert the store record schema has exactly `{ valueId, value, updatedAt }` per entry; grep every wire/journal/log sink for any digest of a canary value; assert the command family has exactly the two arms of §D331.5 | `settings-catalog.test.ts`, `tests/unit/settings-file-service.test.ts` |
| P23 | Both documents pass the private-file protocol: directory mode `0700`, runtime UID owner, full verified ancestry, no-follow open, regular file, `nlink` 1, mode exactly `0600`, size bound by stat AND bytes read, post-read fstat identical; an unlisted entry in the root is an integrity refusal by basename | drive each violation (group-readable `protected.json`, symlinked ancestor, raw `..` symlink target, replaced directory inode, extra file) and assert a named refusal with nothing written | `tests/unit/settings-file-service.test.ts`, `src/infra/config/settings-file.ts` |
| P24 | ONE lock serializes both documents, with one reaper and one acquisition twin; there is no second lock and no lock ordering | run concurrent ordinary and protected applies and assert serialization plus exactly one lock pathname; assert the stale-reaper protocol still holds for the shared lock | `tests/unit/settings-file-service.test.ts` |
| P25 | `prepare.json` / `rollback.json` name their `target` and hold the exact prior and next bytes of THAT document and of `authority.json`; at most one of each exists; settlement and rollback move both as a unit | crash-inject after each step of both arms and assert the reconciled bytes and the surviving evidence's `target` | `tests/unit/settings-file-service.test.ts` |
| P26 | `settings_current` and `protected_settings_current` are independent: advancing one never writes the other, and only the ordinary one participates in the runtime generation | apply each arm and assert the other singleton is byte-identical and the generation moved only for the ordinary arm | `tests/unit/command-kernel.test.ts`, `src/infra/sqlite/authority-database.ts` |
| P27 | The D321 coupling holds per document: a document whose revision exceeds 1 with no matching journal row refuses BY DOCUMENT NAME ("no durable command journal for protected.json" / "... for settings.json"), and a fresh state root regenerates the root, a migrated database, the never-applied revision-1 ordinary baseline and an EMPTY revision-1 protected store | delete the database beside each document in turn and assert the exact named refusal; boot a fresh root and assert both revision-1 baselines and that every protected entry reads `present: false` | `tests/unit/server/settings-runtime-reader.test.ts`, `src/server/settings-runtime.ts` |
| P28 | CAS is the only mutation protocol for both documents, and the request-only refusals (`schema-mismatch`, `patch-fingerprint-mismatch`/`envelope-fingerprint-mismatch`, `not-editable`, `invalid-value`) happen BEFORE any authority access | drive each request-only arm against pristine paths and assert zero lock acquisitions, zero `readState`, and absent settings/initialization bytes afterwards (never pre-initialize the fixture); then assert `revision-conflict { currentRevision }` writes nothing under the lock | `tests/unit/settings-file-service.test.ts` |
| P29 | `already-applied` / `command-divergent` for BOTH arms, including the protected value case: same command id + same marked fingerprint + every `set` value byte-equal to the stored value is `already-applied`; a differing `set` value under the same id and fingerprint is `command-divergent`; the same value under a NEW command id is an ordinary revision-advancing apply | replay each combination and assert the result plus a byte-identical store on both refusal paths | `tests/unit/settings-file-service.test.ts`, `tests/unit/command-kernel.test.ts` |
| P30 | The remaining refusal arms hold: `cross-field-invalid { keys }` on a fully merged candidate the composition's resolver rejects, `document-too-large` leaving the prior file untouched, `authority-unjournaled` / `authority-uncertain` and `directory-integrity` / `lock-unavailable` by name | submit individually valid leaves that break a cross-field invariant; submit a schema-valid oversized leaf; plant surviving prepare/rollback evidence; assert prior bytes unchanged in each | `tests/unit/settings-file-service.test.ts`, `tests/unit/config.test.ts` |
| P31 | `{ clear: true }` is a journaled, CAS-fenced, revision-advancing write that retires the `valueId`; afterwards the entry is `present: false`, `requireSecret` throws `SecretMissingError` naming the KEY, `inspectSecret` answers `missing`, and an unreadable store answers `unknown` (never `missing`) | clear an entry and assert the revision, journal row and readback; corrupt the store's mode/size/parse and assert `unknown` with the underlying error re-thrown | `tests/unit/settings-file-service.test.ts`, `tests/unit/secrets.test.ts` |
| P32 | _Source superseded by D341: the private source is `config/test-data.local.json`, proven in `tests/unit/test-target-registry.test.ts`._ D300 semantics survive the source move: `config/test-subjects.json` stays public (label → workflow, kind, availability, `lastObserved`, reference NAME), `optionalTestTargetSecret` reads the protected store by that name under the same per-kind schema, unset is `blocked` BY KEY before any read, malformed is a registry defect BY KEY, and no canary value reaches a name or EID field | drive unset/malformed/valid through the real admission path and assert the blocked arm precedes any store or browser access; assert the bootstrap's two-arm import allowlist and the document-number smoke read the store, not `.env` | `tests/unit/architecture/test-target-registry.test.ts`, `tests/unit/dry-run-scenario-composition.test.ts`, `scripts/secure-env-bootstrap.ts` |
| P33 | Restart scopes are exactly §D331.7: a protected apply advances no runtime generation and never touches an in-flight claim; an ordinary apply makes the NEXT `claimNext` refuse `runtime-stale`; and the worker's claim token is REQUIRED IN FULL — the as-built "fields absent, skip the check" arm is closed | apply protected mid-run and assert the claimed row's `version`, generation and settings epoch are byte-identical and the run settles; apply ordinary and assert the next claim refuses `runtime-stale`; call `claimNext` with an absent token and assert refusal, not a skip | `src/infra/sqlite/authority-database.ts`, `tests/unit/worker-composition.test.ts`, `tests/unit/command-kernel.test.ts` |
| P34 | Every migrated key is `RETIRED_ENVIRONMENT_KEYS`: present in the admitted `.env` it refuses at bootstrap BY KEY NAME with the remedy; present in the parent process environment it refuses dashboard and worker boot BY KEY NAME and is reported by the environment doctor — never read as a value | plant each retired key in `.env` and in `process.env` and assert the two named refusals and that no resolver or accessor read occurred | `runtime-environment-coverage.test.ts`, `tests/unit/secrets.test.ts`, `tests/unit/worker-composition.test.ts` |
| P35 | The `.env` admission allowlist is exactly the five provider families' pool cells and nothing else; the bootstrap's mechanics (no-follow, `mode & 0o077 === 0`, byte bound, strict grammar, one-to-one `parseEnv` cross-check, explicit parent bindings win) are unchanged | assert the admitted key set against `SECRET_FAMILY_SPECS`; plant a non-family key and assert refusal; re-run the existing mechanics assertions unchanged | `tests/unit/secrets.test.ts`, `scripts/secure-env-bootstrap.ts` |
| P36 | The `config-default` channel has exactly ONE member, the D324 host display publication; a second member is red | assert channel cardinality 1 and the member's identity | `runtime-environment-coverage.test.ts`, `settings-catalog.test.ts` |
| P37 | Two properties of the retired env layer are now DOCUMENT-SCHEMA properties: `annualDates.<FY>` is all-three-or-absent (also re-checked by `cross-field-invalid`), and the ordinary document schema has NO `urls.<system>.prod` member at all | submit a half-year and assert the schema refusal and the cross-field arm; submit a `prod` URL and assert the strict object refuses the unknown key | `tests/unit/config.test.ts`, `tests/unit/settings-file-service.test.ts`, `src/domain/config/schema.ts` |
| P38 | `snapshot-generations.ts` gains an explicit RETIREMENT arm so `operator.timekeeperName` may vanish from `ConfigSchema` without a released generation being rewritten; an unretired vanished leaf still refuses | retire the leaf and assert the audit passes; vanish a different leaf without a retirement entry and assert the existing refusal | `tests/unit/architecture/config-snapshot-generations.test.ts`, `src/domain/config/snapshot-generations.ts` |
| P39 | Every existing guard/test the migration invalidates is changed deliberately in the same commit, not deleted | update and re-run: `runtime-environment-coverage.test.ts`, `secrets-single-source.test.ts` (the `CONFIG_OWNER_PREFIX` env-read permission and the new WRITE arm), `strict-boundary-schemas.test.ts` (catalog + protected schemas join the inventory), `config-snapshot-generations.test.ts`, `test-target-registry.test.ts`, `evidence-receipt.test.ts`; and the non-guard set `config.test.ts`, `settings-file-service.test.ts`, `settings-runtime-reader.test.ts`, `command-kernel.test.ts`, `worker-composition.test.ts`, `dry-run-scenario-composition.test.ts`, `compose-real-port.test.ts`, `bff-flow.test.ts`, `fixtures/settings-runtime-corruption-fixtures.ts`, `fixtures/dry-run-admission-fixtures.ts` | the named files, each with its `guard-inventory.json` row where it has one |
| P40 | The eleven frozen parity references containing the Settings surface's `settings.json: not set` line are re-frozen DELIBERATELY, never tolerated as drift | run `npm run test:parity` to see the eleven fail, re-freeze with `npm run test:parity:update`, and review the diff as bytes | `tests/parity/references/{settings,storage-settings}--*.yml` |
| P41 | (R04, 2026-09-04) Every leaf D331 adds to a served contract is dispositioned under D183 by name in the commit that adds it: the presence tuple `{ present, valueId, updatedAt }` and store `revision`, the protected schema hash, `restartRequired` + `runtimeStatus`, the observed/active `display` pair, `revision-conflict { currentRevision }` and every §D331.5 refusal literal | the schema-driven `redaction-surface-scan` is red on an undispositioned leaf; a disposition naming a value class other than closed-literal/identifier-free is red at review | `tests/unit/architecture/redaction-surface-scan.test.ts` and its disposition table |

> 2026-09-06 | D331 P16 | Operator-approved read-only inspection clarification: SQLite may
> update only WAL-index (`state.db-shm`) reader marks at byte offsets 100–119 while establishing
> a coherent live read snapshot. No settings file, database/WAL content, table, authority metadata
> or filesystem metadata may change; all other SHM bytes remain pinned by the proof. These
> transient marks contain no database data. Doctor neither acquires/reaps settings locks nor
> initializes, repairs or settles authority; unreadable or unsettled protected state stays
> unavailable. See [SQLite WAL format](https://www.sqlite.org/walformat.html#the_wal_index_header).


###### D331.12 — what this contract supersedes (dated 2026-09-04)

Each item is also carried as a dated note beside the superseded text, so a reader of that section
meets the supersession where the old rule stood (the §0 ownership-header row carries a
parenthetical pointer too); the ledger row (`reference/decisions.md`) points here.

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

   > 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | landed: §D332 (settings half) §D332.S2 owns the leaf-for-leaf carry and the two re-validations; the rewrite's revision/journal identity is ref dashboard-surfaces §D332.3 step 3(d).
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
   `live-read` canary (`personLookupCanaryEid`, `docs/rebuild/migrations/person-lookup.md` §T1b, D318's arm)
   is the second member of the class, registered per workflow label exactly as D284/D300 require.
   The D300 ledger row carries the same dated note.
7. **ref dashboard-surfaces §2.1** — the state-root tree still says `.tracker-rebuild/` (stale since
   D321, noted by R01); the dated note there names `.tracker/` and adds the `settings/` subtree.
8. **What is NOT superseded, and is cited rather than restated:** ref frontend-backend-integration
   §4's D327 ownership cut ("the browser never reads files/tables or reconstructs either authority")
   binds §D331.10; §4's immutable per-run snapshot and §4.1's generation rule bind §D331.7; D324 is
   preserved verbatim (§D331.2 `derived-host`); D322's explicit-only backup rule binds §D331.3;
   D330.4/§D330.6 bind the claim token; ref execution-and-sessions owns the Duo credential file's
   lock/signCount protocol; ref stores' catalog is unaffected (no task contract changes).

##### D332 (settings half) — importing today's `.env`, `settings.json` and canary inputs at the upgrade (0.3 Task 3, 2026-09-04)

> **D336 target amendment (2026-09-06):** the key classifications, validation, conflict refusals and
> historical-source facts below remain inputs to migration. Ordinary values now import into SQLite;
> credential import is independent. File destinations and the coupled two-command settlement are
> superseded by §D336. Task 6 must cover both pre-floor and already-created D331 files.


ref dashboard-surfaces §D332 owns the upgrade command, its preflight, its one exclusive transaction,
its journal, its rollback and its boot matrix. §D332.10 assigns THIS subsection the import: which key
becomes which leaf, the seven tie-breaks, the canary references, the `migrated-refused` first boot,
and what the protected store's first revision holds and does not hold. §D332.3 step 3(d)–(e) consumes
the output below as exactly two journaled commands — one `apply-settings` envelope for the ordinary
document, one marked `apply-protected-settings` envelope for the store — and adds nothing to it.
Every refusal named here names a KEY or a DOCUMENT and never a value. Nothing here changes runtime
code (D326); every as-built sentence names its file and line.

###### D332.S1 — what imports, from where, to where

The migrated set is closed and countable. `CONFIG_ENV_BINDINGS` registers **33** bindings today
(`src/domain/config/resolve.ts:84–241`; §D331.12 item 1 fixes the count, and §D331.8's "32 config
bindings" is that same set minus `TIMEKEEPER_NAME`, which it lists separately because
`runtime-environment.ts:226` gives that one key the dual `config-and-secret` channel). Adding the
three remaining credentials, the pseudonym pair, the two canary references and the five provider
model chains gives **45 imported names**; the five legacy singular `OCR_*_MODEL` spellings are
`migrated-refused` but never imported, so the closed removal vocabulary is **50 names**. The plan's
`envKeysToRemove[]` (§D332.5) lists exactly those of the 50 observed present in the admitted `.env`.

| `.env` key(s) | catalog row (§D331.9 `key`) | destination | per-leaf schema | absent ⇒ |
|---|---|---|---|---|
| `HRAUTO_KUALI_TEST_URL` · `HRAUTO_NEW_KRONOS_TEST_URL` · `HRAUTO_ONBASE_TEST_URL` · `HRAUTO_OLD_KRONOS_TEST_URL` · `HRAUTO_SERVICENOW_TEST_URL` · `HRAUTO_SHAREPOINT_TEST_URL` | `urls.<system>.test.entry` (six single-leaf rows) | `settings/settings.json` → same leaf path | `<System>RoutesSchema.partial()`'s `entry` (as built `z.url()`, `resolve.ts:61–83`) | leaf omitted; `defaultKind: none` — there is simply no test override |
| `HRAUTO_CRM_TEST_URL` | `urls.crm.test.entry` (one leaf of the five-leaf row) | `settings/settings.json` → `urls.crm.test.entry` | `CrmRoutesSchema.partial()`'s `entry` | leaf omitted |
| `HRAUTO_I9_TEST_URL` | `urls.i9.test.entry` (one leaf of the two-leaf row) | `settings/settings.json` → `urls.i9.test.entry` | `I9RoutesSchema.partial()`'s `entry` | leaf omitted |
| `HRAUTO_UCPATH_TEST_URL` | `urls.ucpath.test.smartHr` — **`smartHr`, not `entry`** (`resolve.ts:93–99`) | `settings/settings.json` → `urls.ucpath.test.smartHr` | `UcpathRoutesSchema.partial()`'s `smartHr` | leaf omitted |
| `ANNUAL_DATES_END` · `KRONOS_DEFAULT_END_DATE` · `KRONOS_DEFAULT_START_DATE` | `annualDates.<FY>.{jobEndDate,kronosDefaultEndDate,kronosDefaultStartDate}` | `settings/settings.json` → ONE fiscal-year entry (below) | `UsDateSchema` per leaf; the entry is group-valid (§D331.8 (i)) | the year has no entry; a workflow that needs it refuses at its own use |
| `HRAUTO_UKG_NAVIGATION_MS` | `timeouts.ukgNavigationMs` | `settings/settings.json` | `z.number().int().positive()` | leaf omitted = `default` (`contract`) |
| `HRAUTO_NAVIGATION_RETRIES` · `HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS` | `performance.navigationRetries` · `performance.separationTerminationWindowDays` | `settings/settings.json` | `z.number().int().positive()` | leaf omitted = `default` (`contract`) |
| `OCR_SECOND_OPINION_MAX` · `OCR_PAGE_MAX_WAIT_MS` · `OCR_TIER1_PATIENCE_MS` · `OCR_PAGE_CONCURRENCY` · `OCR_DISAMBIG_CONCURRENCY` · `OCR_SUGGEST_CONCURRENCY` · `OCR_BACKOFF_BASE_MS` · `OCR_BACKOFF_CAP_MS` · `OCR_MAX_VALIDATION_RETRIES` | the nine `ocr.*` rows | `settings/settings.json` | `z.number().int().positive()`, and `nonnegative()` for `pageConcurrency` / `maxValidationRetries` | leaf omitted = `default` (`contract`) |
| `HRAUTO_HEALTH_MONITOR_TICK_MS` · `HRAUTO_HEALTH_MONITOR_MAX_REFRESH` · `HRAUTO_HEALTH_MONITOR_MAX_REOPEN` | `browserHealth.{monitorTickMs,maxAutoRefresh,maxReopen}` | `settings/settings.json` | `z.number().int().positive()` / `nonnegative()` | leaf omitted = `default` (`contract`) |
| `HRAUTO_DEFAULT_WORKERS` | `concurrency.defaultWorkers` | `settings/settings.json` | `z.number().int().positive()` | leaf omitted = `default` (`contract`) |
| `HRAUTO_DAEMON_IDLE_MS` · `HRAUTO_DAEMON_IDLE_REPOLL_MS` | `daemon.{idleMs,idleRepollMs}` | `settings/settings.json` | `z.number().int().positive()` | leaf omitted = `default` (`contract`) |
| `DEBUG_SCREENSHOTS` · `HR_AUTOMATION_DUO_WEBAUTHN` | `features.{debugScreenshots,duoWebAuthn}` | `settings/settings.json` | `z.boolean()` | leaf omitted = `default` (`contract`) |
| `OCR_GEMINI_MODELS` · `OCR_GROQ_MODELS` · `OCR_MISTRAL_MODELS` · `OCR_OPENROUTER_MODELS` · `OCR_SAMBANOVA_MODELS` | `providers.{gemini,groq,mistral,openRouter,sambanova}.models` | `settings/settings.json` | the 1.6 model-chain list schema (`readonly string[]`; comma-separated in the environment today, `secrets.ts:659` `providerModelChain`) | leaf omitted; the family has no configured chain |
| `TIMEKEEPER_NAME` (dual-channel, `runtime-environment.ts:226`) | `timekeeperName` | `settings/protected.json` → entry `timekeeperName`; the ordinary leaf `operator.timekeeperName` is DELETED, not carried (§D332.S2) | the per-name schema 1.6 owes (`SECRET_SPECS` entry, non-empty string as built, `secrets.ts:147`) | entry absent → `present: false`; `requireSecret` throws `SecretMissingError` naming the key at first use |
| `UCPATH_USER_ID` | `ucpathUserId` | `settings/protected.json` | per-name schema owed by 1.6 (`secrets.ts:145`) | `present: false`; the blocking enqueue preflight refuses by key |
| `UCPATH_PASSWORD` | `ucpathPassword` | `settings/protected.json` | per-name schema owed by 1.6 (`secrets.ts:146`) | `present: false`; the blocking enqueue preflight refuses by key |
| `ONBOARDING_ROSTER_URL` | `sharepointOnboardingRosterUrl` | `settings/protected.json` | per-name schema owed by 1.6 (`secrets.ts:148`) | `present: false`; the blocking enqueue preflight refuses by key |
| `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY` **+** `HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION` | `activityPersonPseudonym` — **ONE** entry (`secrets.ts:111–131`) | `settings/protected.json` | the 64-hex key shape + generation-id shape (`requireActivityPersonPseudonymDomain`) | `present: false`; D288 evidence writes refuse by name, and no pseudonym is recomputed (§D332.S6) |
| `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` — **D341: refused by name (`retired-test-target-env { key }`); the value belongs in `config/test-data.local.json`** | `separationsKualiFinalizationCanaryDocumentNumber` | `settings/protected.json` | `KualiDocumentNumberSchema` (`TEST_TARGET_SECRET_SPECS`, `valueKind: kuali-document-number`) | `present: false` → the next dry-run start resolves `blocked` by key (D300, §D332.S4) |
| `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID` — **D341: refused by name (`retired-test-target-env { key }`); the value belongs in `config/test-data.local.json`** | `personLookupCanaryEid` | `settings/protected.json` | `EidSchema` (`TEST_TARGET_SECRET_SPECS`, `valueKind: ucpath-eid`) | `present: false` → the next dry-run start resolves `blocked` by key (D300, §D332.S4) |
| — (no environment key) | every other `ordinary-settings` leaf the old document already holds | `settings/settings.json`, leaf-for-leaf (§D332.S2) | the catalog's per-leaf schema | leaf omitted = `default` by its `defaultKind` |

**Annual dates get exactly one fiscal-year entry, chosen at plan time.** As built the three annual
keys apply to `FY${clock.fiscalYear()}` at the moment of resolution (`resolve.ts:360, 363–385`), and a
partial set for a year the document does not already hold throws. The import therefore materializes
ONE entry under `FY<clock.fiscalYear()>` observed once from the runtime clock at plan time, prints
that exact key in the plan, and imports the leaves it finds onto that entry exactly as the resolver
merges them today: as built (`resolve.ts:366–373`) a partial environment set throws ONLY when the
fiscal year has no existing entry at all, and merges per field when one exists — so a partial set
refuses `cross-field-invalid { keys }` naming the missing leaves only when `config.annualDates[FY]`
would otherwise be absent, and an operator whose `.env` holds `ANNUAL_DATES_END` alone over a
defaulted year today keeps a working entry rather than gaining a refusal (§D331.5, §D331.8 (i)
still bind the resulting document: the merged entry is complete or the document does not parse). The
old ordinary document can never already hold the entry: `EditableSettingsOverrideSchema` has no
`annualDates` member today (`schema.ts:337–360`), so the only pre-floor sources are the defaults and
these three keys. Because the
fiscal-year key is part of the plan it is part of `planDigest`, so a plan minted before a fiscal-year
roll and executed after it re-plans (§D332.5's re-plan arm) instead of writing last year's entry —
which is why the year is fixed at plan time and never re-derived at settlement. After the floor the
wildcard binding is gone with the environment layer: a NEW fiscal year is an operator edit in
Settings, not an inherited environment value. That is a real behaviour change and the plan says so.

**What is never read or copied, by name.**

- **The five provider key families' pool cells** — `GEMINI_API_KEY{,2..8}`, `GROQ_API_KEY{,2..8}`,
  `MISTRAL_API_KEY{,2..8}`, `OPEN_ROUTER_API_KEY{,2..8}`, `SAMBANOVA_API_KEY{,2..8}`
  (`secrets.ts:151–155`). The upgrade classifies the key NAME as `provider-env` and **never opens the
  value**. They stay `.env`'s under the shrunken allowlist (§D331.8), are read only by
  `requireSecretFamily` / `optionalSecretFamily` (`secrets.ts:627, 638`), and `protected.json` gets no
  row for them.
- **The five legacy singular spellings** `OCR_GEMINI_MODEL`, `OCR_GROQ_MODEL`, `OCR_MISTRAL_MODEL`,
  `OCR_OPENROUTER_MODEL`, `OCR_SAMBANOVA_MODEL` (`secrets.ts:151–155` `legacyModelEnv`). They are not
  a catalogued `currentSource`, so importing one would carry a source the target does not have. The
  plan lists a present singular key under "present, never imported" with the remedy "set
  `OCR_<FAMILY>_MODELS` to the intended chain and re-run `storage upgrade --plan`, then remove both
  lines", and §D331.8 makes them `migrated-refused` at the first post-upgrade boot once 1.6 deletes
  the fallback arm. This deliberately does not mint an eighth dual-source row: §D331.1's
  `currentSource` arrays are seven and stay seven. As built the registry already classes all five
  `retired-in-target` (`runtime-environment.ts:171–186, 277–283`) while `providerModelChain` still reads
  them as a one-element fallback (`secrets.ts:666–667`) — a present singular key is therefore already
  relying on an arm the registry calls retired, which is exactly why the import refuses to carry it
  rather than guessing a chain.
- **`test-only` keys** — `HRAUTO_E2E_STUBS`, `HRAUTO_LEGACY_REPO`, `HR_DRYRUN_DOC_ID`,
  `HR_SOAK_ITERATIONS`, `HR_TEARDOWN_SOAK_ITERATIONS`, `HR_TEST_HEADED`, `PARITY_UPDATE`,
  `SEL_SESSION`, `TMPDIR`, `TZ`, `__NUMENV_TEST__` and the four test-only families
  (`CEREBRAS_API_KEY`, `COHERE_API_KEY`, `OCRSPACE_API_KEY`, `ZEP_API_KEY`)
  (`runtime-environment.ts:165–169, 270–276`). None targets a catalogued leaf; none is imported,
  refused or reported as migrated.
- **`retired-in-target` keys** — the inert list at `runtime-environment.ts:171–183` (`DEBUG`,
  `HRAUTO_TRACKER_DIR`, the `KRONOS_*` picker/calendar timings, the capture keys D294 retired, and the
  rest). Unread before the upgrade, unread after it, never a refusal, never imported.
- **The launch nonce** `HRAUTO_DASHBOARD_LAUNCH_NONCE` (`runtime-environment.ts:236–243`) — process
  ownership, not configuration (§D331.2) — and `HRAUTO_HOST_PRIMARY_DISPLAY`, which is the D324
  `config-default` PUBLICATION, not a source: the upgrade neither reads nor writes it, and
  `display.*` imports only from the old document.

###### D332.S2 — the `settings.json` side

The old ordinary document is read once, in preflight, through the as-built no-follow reader and
adapter A0's FROZEN pre-floor copies of `SettingsFileRecordSchema`, `EditableSettingsOverrideSchema`
(`src/domain/config/schema.ts:337–360`, `src/domain/config/settings.ts:25, 39`) and the pre-floor
`SETTINGS_SCHEMA_HASH` literal — never the live schemas: `SettingsFileRecordSchema`'s `superRefine`
refuses any record whose `settingsSchemaHash` differs from the build's (`settings.ts:47–53`), and the
hash is derived from `EditableSettingsOverrideSchema` (`settings.ts:13`), which rule 4 below widens by
construction, so the live reader cannot parse an old file and the fingerprint comparison of §D332.2
step 9 is computed under the frozen schema — under that step's journal agreement. Its leaves are then
carried **leaf-for-leaf** into `settings/settings.json` under the NEW `SETTINGS_SCHEMA_HASH`. Four
rules govern the carry:

1. **One patch, no clears.** The `apply-settings` patch of §D332.3 step 3(d) is the union of (the
   carried document leaves) and (the imported environment leaves of §D332.S1), each as
   `{ set: <value> }`. There is no `{ clear: true }` entry, because nothing is being unset — a leaf
   the old document did not hold is simply absent from the patch and resolves `default` by its
   `defaultKind`.
2. **`operator.timekeeperName` leaves the ordinary document.** It becomes the protected entry
   `timekeeperName` (§D332.S1) and is REMOVED from the ordinary document, because §D331.6 rule 2
   deletes the leaf from `ConfigSchema` outright. As built the persisted document cannot hold it —
   `EditableSettingsOverrideSchema` has no `operator` member — so on a document this build can parse
   the removal is a no-op; it is stated because the post-upgrade document must be provably free of the
   leaf, and "cannot happen" is not "checked".
3. **Every carried leaf re-validates twice.** First through the catalog's per-leaf schema (the
   `schema` column of §D331.9); a failure is `invalid-value { key }`. Then the fully merged candidate
   goes through the composition's exact resolver, exactly as §D331.5's arm requires; a failure is
   `cross-field-invalid { keys }` (lesson 2026-08-28: individually valid leaves can break a
   cross-field invariant on restart, and `display`'s two leaves and `annualDates`' three are the live
   cases). The canonical next bytes must also be ≤ 1 048 576 B or the plan refuses
   `document-too-large { file }` (§D332.2 step 15). Every one of these is a preflight refusal: nothing
   is written.
4. **A leaf the old document holds that the catalog does not** refuses `not-editable { key }`
   (§D331.5's arm, evaluated over the old document because the catalog is static). None is expected —
   the strict parse above admits only `EditableSettingsOverrideSchema` members, and §D331.5 makes
   that set the first rows of the longer `ordinary-settings` class — so the arm should be unreachable;
   it is stated anyway, because an unchecked "expected empty" is how a leaf disappears silently.

`SETTINGS_SCHEMA_HASH` is derived from `EditableSettingsOverrideSchema`
(`src/domain/config/settings.ts:13`), so widening that schema to the whole `ordinary-settings` class
changes the hash by construction: the old file's `settingsSchemaHash` will not equal the new build's,
and that mismatch is precisely what the rewrite resolves rather than tolerates (§D331.12 item 2). The
revision, command, audit and `settings_current` identity of the rewrite belong to §D332.3 step 3(d)
and are cited, not restated here.

###### D332.S3 — the tie-break for the seven dual-source leaves

§D331.1 fixes the rule and §D332.2 step 12 runs it in preflight. The seven `currentSource` arrays are
`urls.crm.test.*` ↔ `HRAUTO_CRM_TEST_URL`, `urls.ucpath.test.*` ↔ `HRAUTO_UCPATH_TEST_URL`,
`urls.i9.test.*` ↔ `HRAUTO_I9_TEST_URL`, `ocr.pageConcurrency` ↔ `OCR_PAGE_CONCURRENCY`,
`ocr.maxValidationRetries` ↔ `OCR_MAX_VALIDATION_RETRIES`, `concurrency.defaultWorkers` ↔
`HRAUTO_DEFAULT_WORKERS`, and `timekeeperName` ↔ `TIMEKEEPER_NAME` / `operator.timekeeperName`.

**The rule, per leaf:**

| Observed | Outcome |
|---|---|
| byte-equal after canonicalization | import once, from either source; the plan names the leaf and both sources |
| exactly one present | import it; the plan names the one source |
| both present and different | refuse `ambiguous-duplicate { key, sources }`, `sources` the closed pair `["settings.json", "env:<KEY>"]`; nothing is written |

The remedy the refusal carries is fixed text: **"make them equal or remove one, then re-run
`npm run cli -- storage upgrade --plan`"**. There is no precedence tie-break — today's resolver would
silently pick the environment side, and D327 says refuse (§D331.1).

**Canonicalization is the leaf's own schema, and nothing else.** Parse BOTH candidates through the
catalog's `schema` for that leaf, then compare the PARSED values; never compare raw strings, and never
apply a normalization the schema does not itself perform.

- **Integer leaves** (`ocr.pageConcurrency`, `ocr.maxValidationRetries` — `z.number().int().nonnegative()`;
  `concurrency.defaultWorkers` — `z.number().int().positive()`): the environment side is text and the
  document side is a JSON number, so the canonical form is the parsed integer — `"4"` and `4` are
  equal and import once. An environment value that fails the leaf schema is `invalid-value { key }`
  (§D332.2 step 11) and never reaches the comparison.
- **URL leaves** (`urls.crm.test.entry`, `urls.i9.test.entry`, `urls.ucpath.test.smartHr`): the
  canonical form is the string the leaf's `z.url()` returns, unchanged. No trimming, no case folding,
  no trailing-slash equivalence, no default-port removal. Two endpoints that differ by one byte after
  the schema are DIFFERENT and refusing is the correct answer: a "close enough" URL is exactly the
  plausible-but-wrong substitution the fail-loud rule forbids, and it would point a live run at the
  wrong system.
- **`timekeeperName`**: the comparison is on the value bytes, in constant time, under the plan; the
  refusal names the KEY only — never either value, never a length, never a digest (§D331.6 rule 1,
  §D331.5's marked-envelope discipline). This is the one dual-source row whose comparison touches a
  `protected-identifier`, so the plan records only that the two sources disagreed.

**Evaluate per leaf, not per group.** For the three multi-leaf URL rows the array is a GROUP fact: as
built the editable document omits exactly the environment-owned leaf from each group
(`CrmRoutesSchema.omit({ entry: true })`, `UcpathRoutesSchema.omit({ smartHr: true })`,
`I9RoutesSchema.omit({ entry: true })` — `schema.ts:341–348`), so the two sources are leaf-disjoint by
construction and the refusal cannot trip on a document this build can parse. The per-leaf check runs
anyway. The same holds for `timekeeperName`: `EditableSettingsOverrideSchema` has no `operator`
member, so a persisted document carrying one fails the strict parse in preflight before the tie-break
is reached; the arm exists for the catalog's completeness and for a resolver-input caller, and for
`ocr.pageConcurrency`, `ocr.maxValidationRetries` and `concurrency.defaultWorkers` — the three rows
where both sources really can hold the SAME leaf today — it is the arm that actually fires.

`--plan` and execution evaluate this rule over the same evidence, and `upgradeId` binds the old
document's `settingsFingerprint` while `planDigest` binds the plan (§D332.5), so an edit to either
source between the two yields a different digest and re-plans rather than importing a value the
operator never saw in a plan.

###### D332.S4 — canary references

_Superseded by §D341 (2026-09-07): the upgrade now refuses a retired canary name in a D331 protected
source (`retired-test-target { key }`) or in `.env` (`retired-test-target-env { key }`) before any
value is decoded; the registry is the `subjects` member of `config/test-data.json`._

`config/test-subjects.json` stays the committed PUBLIC registry and the upgrade does not touch it
(§D332.8's file row; §D331.6 rule 6). It carries, today, exactly two closed references:

| target label | workflow | reference NAME | environment key | per-kind schema |
|---|---|---|---|---|
| `finalization-canary` | `separations` | `separationsKualiFinalizationCanaryDocumentNumber` | `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` | `KualiDocumentNumberSchema` |
| `person-lookup-canary` | `person-lookup` | `personLookupCanaryEid` | `HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID` | `EidSchema` |

Per reference, at preflight (§D332.2 step 13) and then at import:

- **present and valid** → imports as that protected NAME in `settings/protected.json`, judged by that
  reference's per-kind schema and by no other. Only the SOURCE moves; `optionalTestTargetSecret` reads
  the same name afterwards and the dry-run start admission keeps retaining the reference NAME only.
- **present and malformed** → `invalid-value { key }`, a preflight refusal that writes nothing. It
  names the environment key and the reference name; never the observed value, never its length.
- **absent** (unset, or whitespace-only — as built `optionalTestTargetSecret` treats a
  whitespace-only value as absent, `secrets.ts:476`, and `resolveSecretValue` does the same at
  `:517–521`; never as malformed) → imports nothing. The entry reads back `present: false`, and the next dry-run start
  resolves `blocked` by key before any browser starts — D300's semantics, unchanged.

The reference is CLOSED in code (`TestTargetDocumentNumberSecretReferenceSchema` /
`TestTargetEidSecretReferenceSchema`, `secrets.ts:90–104`): the registry names exactly one
`(name, env)` pair per target and the upgrade never chooses, invents or re-points one. A document
number is never copied into a name or EID field and an EID never into a document-number field — the
per-kind schema decides, and a value that would parse under the wrong kind is still refused because
the reference binds the pair.

The availability labels are registry facts the upgrade neither reads as permission nor changes: a
`gone`, `unknown` or `consumed` label blocks at start exactly as D284/D300 already require, and
importing that target's value changes nothing about that. Configuration is not availability
(lesson 2026-09-01), and the upgrade does not re-observe a subject or edit a `lastObserved` date.

###### D332.S5 — the first post-upgrade boot (`migrated-refused`)

**The plan says it before it happens.** `storage upgrade --plan`, and the final report of a real run,
list every migrated key still present in the admitted `.env` **by name** — the journal's
`envKeysToRemove[]` (§D332.5) — with the remedy **"remove these lines from `.env`"**. Nothing about
this is a surprise at the next boot.

**The next boot refuses, by design.** After the floor, a `migrated-refused` key present in the
admitted `.env` refuses at the bootstrap door by key name, and one present in the parent process
environment refuses dashboard and worker boot by key name and is reported by the environment doctor
(§D331.8). The refusal text repeats the same list the plan printed. Neither is ever read as a value
again: `protected.json` and `settings/settings.json` are the only sources after the upgrade.

**Why the upgrade cannot remove them itself.** `.env` is the one file the upgrade never touches
(§D332.3's opening sentence). It is operator-owned and mode `0600`; the runtime never writes it; its
comments, ordering and non-catalogued content are the operator's; and it holds the five provider
families the upgrade is forbidden to open, so rewriting it would mean reading through a file whose
values it must never see. The bootstrap's grammar admission
(`admitLocalEnvironmentFile`, `src/domain/secrets.ts:382–430`) is a READ contract — no-follow open,
fstat, `mode & 0o077 === 0`, bounded size, strict grammar, one-to-one `parseEnv` cross-check, explicit
parent bindings win — not an edit contract, and turning it into one would put a writer on the one
file that proves what the operator chose.

**Why leaving them is safe.** A value that cannot be read cannot shadow (§D331.8). The keys are
refused by NAME at the door, before any value is applied to the process environment, so a stale line
cannot re-enter the resolver, which after 1.6 takes no environment input at all
(`resolveConfig(document, hostFacts, clock?)`, §D331.2).

**The downgrade hole, and how D332 closes it.** The dangerous case is not a new build — it is an OLD
build run against an upgraded root. An old build still carries `CONFIG_ENV_BINDINGS` and would read
the still-present migrated keys, so its resolver would silently shadow the new documents with the very
values the operator was told to remove. That path is closed one step earlier than config resolution:
the upgraded database's `user_version` is above the old build's `CURRENT_AUTHORITY_SCHEMA_VERSION`, so
`#admitExistingSchema` refuses **`authority-ahead { schemaVersion, supported }` at the database open**,
before any settings byte is read and before any migrated environment value is applied to `Config`
(the pre-open work is `mkdirSync(stateRoot)`, the artifact-root check, the process lock and the host
display probe — `resolveConfigWithProvenance` runs only after the open; §D332.6's `ahead` row names
the unreleased lock record that attempt leaves behind and its stated ordering;
the same ordering also prevents the old build from reaching the vacant old pathname and reading it as
"virgin"). Both halves are load-bearing: the boot refusal closes the new-build path, and the
open-ordering closes the old-build path. Neither alone would do.

###### D332.S6 — what the import never claims

1. **Provider keys are never copied, and `.env` is byte-identical.** The upgrade classifies the five
   families' pool cells by NAME and never opens a value; `.env` is unchanged after the upgrade, which
   §D332.11 proof M20 (`env-untouched`) pins together with the plan's key list and the first boot's
   refusals.
2. **Protected values are imported WRITE-ONLY.** The command row, its audit and
   `protected_settings_current` hold the MARKED envelope (`"<set>"` per value, §D331.5) and
   `{ name, valueId, updatedAt }` per entry (§D331.4); `authority_upgrades` holds
   `protectedEntryNames[]` and no value, no digest of a value and no length (§D332.5). The ONE place a
   value transits is `<stateRoot>/upgrades/<upgradeId>.prepare.json`, which is a protected-class
   artifact for exactly that reason — never backed up, never served, named in a report only by
   existence — and is removed at settlement (§D332.3 step 2 and step 4). The import never returns,
   digests, lengths or `last4`s a value, and never answers "is this the same value as before"; there
   is no verification oracle (§D331.6 rules 1 and 4).
3. **Historical exposure is recorded, never claimed erased.** The pre-upgrade backup §D332.2 step 10
   requires carries `operator.timekeeperName` in every `config_snapshots` row and in every
   `configFingerprint` preimage, and the retained `<upgradeId>.rollback.json` carries it in the prior
   `settings.json` bytes wherever the leaf was set there. The journal's `planned` row records
   `historicalExposure: ["operator.timekeeperName"]` and the plan prints it (§D332.7 item 5); §4.1
   forbids rewriting a released snapshot generation, and §D331.6 rule 8 forbids any report, doctor
   line or Settings surface saying the migration removed it. This is one accepted `direct-identifier`
   exposure — never a password, never a canary. Both files stay `0600`, and the rollback file is
   excluded from backups.
4. **The pseudonym pair moves as ONE entry.** `activityPersonPseudonym` carries the HMAC key and its
   public generation id together (`secrets.ts:111–131`), so a rotation cannot split them and D288's
   generation-bound commitment semantics are unchanged. No pseudonym is recomputed and no
   `activityPersonPseudonyms` row is read, rewritten or backfilled by the upgrade: re-derivation
   belongs to D288's reviewed backfill capability, which this command does not invoke and this
   contract does not authorize.
5. **Absence is a state, not a default and not a failure.** A name absent from the plan imports
   nothing and reads back `present: false` at revision 1's empty store (§D331.3). The upgrade never
   describes such a store as "configured", never treats absence as "not configured by choice", and
   never regenerates an entry — the operator enters it through §D331.5's protected arm, and until then
   the first credential-needing action refuses by key name.

### D353 — Editable browser and Duo paths · 2026-09-26

`paths.browserProfileRoot`, `paths.duoCredential`, and `paths.duoExtensionDir` are independent
ordinary Settings leaves. They autosave through the existing revision CAS and activate for new
runs. Existing run snapshots remain immutable. A profile override never implicitly rebases the
Duo credential path; defaults still derive from the installation's default profile location.

Before activation, validate changed effective paths only. An arbitrary browser-profile target
must be a fresh, absent or empty location with safe ownership and permissions; no profile is
copied. Reset may reuse the safe canonical installation default. The Duo file must be an owned
0600 regular file with the existing parser's recognizable credential identity; this is not proof
that its private key works. Browser/preflight checks remain the usability boundary. The extension
must be an owned unpacked MV3 extension directory. Invalid targets refuse before snapshot
activation, while unchanged paths do not block unrelated Settings edits.

The state and artifact roots remain under D352's separate relocation authority. The ordinary-path
schema change preserves verified v55 SQLite command history and DB-only backups, including the
prior hash `09853878dd557c777b6df18ff2fb0d03310fad409ced3367ab17ceb4626f57a4`.
The historical v2 reader and its `restartRequired === true` invariant remain unchanged.

### D352 — Planned runtime storage relocation and the v56 activation gate · 2026-09-26

The operator may request a new absolute state-root and artifact-root pair independently. A
checkout-local private installation control directory binds an immutable installation UUID to
the canonical workspace and owns one atomic active pair and global generation. After adoption,
missing or malformed control cannot fall back to `config/runtime-isolation.json`; retained source
markers are negative witnesses, never replacement locators. Other isolation values retain their
existing authority unless separately admitted, but the adopted state and artifact roots are
selected only through this installation control. A shared lifetime admission
precedes any runtime, credential or authority read; an exclusive offline admission blocks every
shared opener. The current foundation is not yet wired to runtime entrypoints.

At schema v55, `storage-relocation/plan-storage-relocation` and
`storage-relocation/cancel-storage-relocation` record desired intent as immutable SQLite commands
with one matching audit each. The projected revision starts at zero, advances by one per command,
and refuses missing, multiple or mismatched audits, duplicate or skipped revisions, reused write
IDs, invalid request/destination digests and installation/source-pair drift. A plan binds the
installation UUID, source global generation and complete active and desired pairs; cancel names
the current plan command and digest. Exact command retry returns its recorded result. A stale
expected revision conflicts without a write. These commands neither switch the active locator
nor create a second settings or plan authority; the planned Settings UI can save intent while the
v55 runtime still uses the old paths. No state-root, artifact-root or credential value is added to
`app_settings`, and no secret-derived fingerprint enters relocation history. A state-only move that
would leave artifacts nested in the old state root is structurally refused; artifact-only moves
require a destination outside source-root overlap.
The generic command arm remains unavailable until its admitted installation lease and dashboard
composition are wired; the bounded producer and read projector are the current implementation.

Activation requires a later stopped, verified-backup upgrade to authority schema v56. That
version is a runtime-location capability floor: supported pre-location binaries must refuse a
v56 authority before touching an archive writer, including when an artifact-only move leaves the
database path unchanged. v56 is not required to record v55 intent, and this producer does not
perform the migration or relocation. Normal startup must admit both the exact v55 and v56 layouts
without advancing an existing v55 database. The v56 capability migration is an explicit stopped,
verified-backup operation; fresh databases may start at v56. v55 DB-only and paired backups retain
normal verification and restore behavior, without historical archive quarantine. Versions below
v55 keep their existing stopped-upgrade and recovery boundaries. The source authority is upgraded
to v56 under the verified pre-upgrade backup before staging begins, even when the state root will
move. Upgrading only the destination would leave the old source writable by a pre-location binary
after a process crash and restore-lock reaping. The staged copy therefore inherits v56; a JSON
source fence alone is not an older-binary write barrier. The later offline engine must bind the exact plan command,
revision and request fingerprint to its durable journal, source fence, atomic locator switch and
activation receipt. Completed older-generation plan history remains immutable; future projection
must validate its source transitions through activation receipts rather than discard it. Retained
source data is never deleted or made an automatic fallback.

The offline engine must preserve fixed checkout process-lock locations and inspect their stopped
state in addition to holding installation admission. Only the two storage roots follow the locator.
It copies managed authority, archive, evidence, credential, backup, and recovery data; a SQLite
backup captures committed WAL content. Unknown entries, unsafe links, divergent receipts, and
unverifiable references refuse the move. Nested artifacts are copied once. Old run snapshots and
path-free artifact identities remain unchanged. The destination receives an explicitly selected
configuration snapshot for its admitted root pair, with the ordinary Settings revision unchanged,
and a freshly verified backup bound to the database's final path before activation.

Moved source data is retained under journal-bound sibling locations. An outermost moved source
directory normally becomes a regular-file tombstone; a moved parent also blocks its former nested
artifact path. The default state root has one necessary exception: `.tracker/locks` is the fixed
checkout process-lock authority. Its ancestor directory must remain as a lock shell. Move managed
non-lock entries into the retained sibling with an exact per-entry journal, leave the lock subtree
in place, and install an invalid-SQLite regular-file tombstone at the old `state.db` path. A moved
artifact directory beneath that shell can receive its own directory-path tombstone. Source markers
and fences remain negative witnesses. The engine holds the existing runtime restore-admission lock
continuously, as well as installation-exclusive admission, so supported older processes cannot
start during the entry-rename/tombstone gaps. After settlement their main database opener refuses
the tombstone before any archive writer. The lock shell is never an alternative active state root.

An unchanged storage root remains usable only with the new v56 authority and valid root-ownership
evidence. Locator v2 records the global generation and separate `stateRootGeneration` and
`artifactRootGeneration` marker epochs; an unchanged role retains its epoch. A v1 locator reads as
both marker epochs equal to its global generation. Generation-zero v1 adoption remains valid;
a nonzero generation without its complete activation receipt chain is refused. No real relocation
was admitted through the earlier foundation alone. Each partial rename, fence, locator change, and
completion receipt must be recoverable from the exact durable operation binding. An interrupted
operation blocks normal admission until explicit offline recovery verifies it. The completion
receipt is durable before the transient journal is cleared; later plan projection checks completed
source generations through those receipts. These are acceptance requirements for the pending
engine, not claims that movement or recovery is implemented.

### D351 — Revisioned provider-key file and exact pending recovery · 2026-09-26

The fixed `.env.providers` remains the sole saved provider-key authority. Five registered
families admit stable sparse slots 1–8. Settings may set or clear a named slot, but no key value
or value-derived binding enters ordinary Config, snapshots, SQLite, command audit, diagnostics,
or logs. The protected credential store stays independent. Parent environment bindings retain
precedence in the active process; a saved file change takes effect at a later startup only for
slots not shadowed by the parent environment.

The private provider writer uses a separate 0600 metadata sidecar with a bounded settled anchor
and at most one pending reservation. It stores nonsecret command fields and operation markers,
plus private SHA-256 bindings of the complete original request and postwrite body; it stores no
key values. The source version token derives only from bigint file metadata
`dev, ino, size, mtimeNs, ctimeNs, birthtimeNs`. The writer checks a stable no-follow descriptor
read and final path identity under its private lock, stages a 0600 same-directory replacement,
fsyncs the stage, durably records pending metadata, then renames the stage over `.env.providers`
and fsyncs the parent directory. The existing strict environment grammar and closed provider
key set remain admission rules. A noncooperating same-UID editor can still race the final
stat-to-rename interval; all application writers must use the private lock.

The previous settled anchor must have its matching durable marked command and audit before
recovering pending work or admitting another write. The latest durable provider journal head
must be that settled anchor or, after rename, the exact pending command; a restored older
file/sidecar pair cannot become current merely because its older audit still exists. An exact retry checks private request/body
bindings and the marked public fingerprint before applying a pre-rename stage or reconciling an
already renamed file. The pending reservation remains until the caller confirms the matching
durable command and audit, after which the sidecar becomes settled. No cancellation follows a
durable pending reservation. Missing, corrupt, divergent, or rewound evidence is unknown and
blocks writes. A headerless file is revision 1 only if no managed history exists; a missing or
rewound managed header is unknown. Manual file edits after a fully journaled write are admitted
through a fresh source token, while pending recovery requires exact body identity. GET and
startup classify recovery state without mutating the file.

The store receives the command family's canonical marked-envelope fingerprint function. It
preserves the original admitted source surface and returns only value-free pending identity from
its public classification read. A server-private pending read verifies and reconstructs the
original request without changing the file; command admission then calls `apply`, which repeats
the checks under the lock before completing any rename.

`src/infra/config/provider-key-store.ts` implements this bounded private file protocol.
`settings/apply-provider-keys` now admits the provider schema and actor before private reads,
uses the real marked command fingerprint, commits its marked command and value-free audit in
the kernel's authority transaction, and settles the sidecar only after SQLite commits. The
SQLite journal adapter verifies the latest head, matching audit and receipt, and both command
and write identities across provider and protected history. A typed source conflict leaves the
draft intact; an uncertain postwrite audit or sidecar settlement reports
`PROVIDER_AUDIT_UNCERTAIN`. Missing or divergent private/journal evidence reports
`PROVIDER_STORE_UNKNOWN`. The same command route accepts a strict value-free retry intent bound
to the pending command, write and receipt IDs. Ingress reconstructs the original request
read-only and passes it through normal command admission; an ordinary exact resend preserves
the original pending timestamp. Neither retry intent nor raw values enter the journal.

The secure bootstrap records parent slot names, file slot names, revision and source token from
the same stable no-follow descriptor whose bytes populate the process environment. The current
editable GET serves saved file slots, revision and token separately from active provider values
keyed by stable slot ID. Active slots use the secret owner's trim/blank normalization and are
captured at composition; later environment mutation cannot change their identity or restart decision.
The read reports parent-shadowed slots and a restart decision based on unshadowed active-versus-saved
values after the same normalization of the saved candidate, while preserving raw saved readback.
It exposes only safe pending identity. Missing boot provenance or unverifiable file
evidence is explicit `unknown`. GET and startup do not settle a pending write. The Credentials
editor UI remains the following Category 3 outcome.

### D350 — Single current-fiscal-year job-end date and historical backup compatibility · 2026-09-26

Settings exposes one employment-date control: `annualDates.FY<year>.jobEndDate`, where the server
selects `<year>` through its injected `Clock.fiscalYear()`. It serves that current-year leaf even
when no value is stored. The job-end date stays required, has no clear/restore action, and does not
receive an invented default. Runtime `requireAnnualDates` continues to fail loud when the current
fiscal-year entry or its job-end date is absent or stale. The UI does not expose other fiscal years,
year creation, or either Kronos date. Existing annual-date maps and historical records are retained
without rewriting them.

The live `AnnualDateEntrySchema` keeps `jobEndDate` required and makes only
`kronosDefaultEndDate` and `kronosDefaultStartDate` optional, so date-only current entries are valid.
The frozen v29 schema remains unchanged. This changes `SETTINGS_SCHEMA_HASH`, but it does not change
the canonical persisted-value fingerprint for existing settings, the v55 authority schema version,
the current settings revision/fingerprint, or any immutable journal, audit, snapshot, or historical
map. `readSettings` projects the current build's schema hash while retaining the settings-current
value fingerprint; no schema-version bump or historical-row migration occurs.

The manifest-v2 reader has a narrow compatibility arm for the exact pre-D350 hash
`b8cd5d1b0056fceb020df20e0682762b2de53d8efa8dd9109c835d0fc0e9908a`. Its frozen historical schema
requires all three date fields and limits ordinary paths to the pre-D350 four operator-editable
paths. It checks the ordinary record fingerprint and revision/last-applied fields, the authority
tuple's exact root fingerprint and schema binding, and the copied database's matching current row,
command and audit. A hash match alone cannot admit a shape or a mismatch. The compatibility arm is
used only while verifying old manifest-v2 backups; `SettingsRootAuthoritySchema` and live-root
validation remain pinned to the current schema hash. Later live path-membership changes must not
alter this frozen v2 shape. Original journals and authority bytes remain untouched.

Owner: this section, `src/domain/config/schema.ts`, `src/server/settings-runtime.ts`,
`src/server/dashboard/queries/settings-editor.ts`, and the isolated historical-v2 reader.

### D349 — Editable Routes and retirement of test-instance runs · 2026-09-25

The operator's Routes page owns the nine production system route sets. Each set is
an ordinary Settings value, edited as a complete URL object and saved through the
existing revision-checked settings command. A confirmed save activates routes
for new runs; retained runs keep their captured configuration. Runtime paths
remain a separate read-only page. The Test routes
and System hosts pages are retired. New run plans refuse every requested test
instance before admission; preflight advertises only production endpoint checks.
Dry run remains a separate workflow behavior and still uses the selected production
route set. Historical run envelopes and config snapshots retain their original
test labels and route values for readback; new snapshots cannot mint test routes.

This supersedes D331's production-route deployment classification and editable
test-route rows. Old `urls.*.test` values and their authenticated command and
snapshot records remain readable. The resolver ignores those values; the Routes
page does not expose them; new commands cannot edit them; and the first later
settings write removes them from the saved override. The original command,
audit and snapshot bytes stay intact. A historical snapshot used for a retained
production run projects the production routes without changing its stored
fingerprint. Historical test-instance runs refuse execution. No missing or
corrupt saved settings may fall back to defaults.

### D346 — Settings values on the local operator surface · 2026-09-24

The independent protected store remains the authority for credentials and
retains its existing revision, integrity and write behavior. The Settings read
serves its authenticated current entries so the local operator can see each
value. The provider availability section likewise serves active provider key
values. Credential edits remain explicit drafts; displaying a saved value does
not submit or change it. This supersedes the write-only UI/readback restriction
in D331.6 for the local dashboard.
Diagnostic bundle fields also retain original classified values. An
unclassified JSON value remains visible in its capture warning.

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
> 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | D332 §D332.7 item 4 adds the registry's
> first RETIREMENT arm (owed by 1.6): a generation may retire a leaf (`operator.timekeeperName`, D331)
> by name and decision id in a closed literal list; rows at or after that generation must lack it,
> older rows keep it, no row is rewritten and every stored `fingerprint` still verifies. A vanished
> leaf that is NOT on the list still refuses — the three reasons above are unchanged.
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
  > 2026-09-04 | D331 | the two-arm selector stands; at 1.6 the D300 smoke reads its document number from `.tracker/settings/protected.json` through `optionalTestTargetSecret`, and the admitted `.env` key set shrinks to the five provider families (§D331.6 item 6, §D331.8).
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
  | { status: "pass"; check: PreflightCheckId; summary: string;
      availableFor?: readonly ("feature.ocr" | "feature.ai-advisory")[] }
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

3.1.11.1's operator-authorized bounded report repair allows a passing provider result to name
`availableFor`, a non-empty, duplicate-free subset of its registered feature capabilities. The report
validator and builder count healthy providers separately for each feature. Thus a configured executable
OCR adapter can pass OCR while AI remains unavailable in the same report. An omitted list preserves
the existing whole-provider pass meaning; only registered provider checks may carry the field.
No registry membership, feature threshold or required/optional severity changes. Executable capability
availability comes from composition; provider keys and model configuration alone do not certify an
adapter, and preflight does not spend provider calls.

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


### Worker/request schema rename and settings preservation (2026-09-08)

[The combined schema-35–37 upgrade](dashboard-surfaces.md#d3321--one-command-stopped-system-never-at-boot)
preserves D331/D336 settings and independent credential authority. Conversion of schema
32–36 sources retains the exact ordinary settings revisions/journals and credential bytes;
it does not replay schema 33's batch defaults or reimport environment values. `config_snapshots`
keeps its name, rows and references. Existing source-change refusal and interrupted settlement
remain required. The [side assignment](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/history/worker-names.md) owns execution evidence.

### Phase 2.6 snapshot naming amendment — 2026-09-09

Naming-only 2.6.2 R changes config_snapshots → settings_snapshots, preserving immutable rows,
existing run bindings, protected-value exclusions and current activation behavior. Released history
retains its original names. Settings consolidation and no-restart activation remain with F/S after
C0; R does not implement them. [Approved scope](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/renames.md).

## C0 settings activation and recovery — 2026-09-09

Under the operator's preapproval of 2.6.3, F/S replace the ordinary-settings generation behavior
in D331.7: `app_settings` owns saved overrides, revision, command/audit identity and the selected
immutable `settings_snapshots` reference. Preserve unset-versus-explicit values. Save resolves and
validates the complete snapshot, inserts it, changes the current reference and journals the action
atomically. Failure activates nothing. No credential or protected-derived digest enters a snapshot.

Every newly created run selects the current committed snapshot in its creation transaction.
This includes explicit retry/restart runs and newly created delegated children; C0 selects the
literal new-run rule, without a parent/source-snapshot exception. Existing queued, running, paused
and resumed runs retain their snapshot. An internal retry of the same run is not new creation.
This changes configuration selection only: preserve inputs/protected bindings, instance/dry-run
constraints, delegation admission, permanent operation keys, checkpoint eligibility and UNKNOWN
refusal. It does not authorize a new child producer or repeated external effect. A changed snapshot
must not relabel reused observations or count a replay as a new transaction.

A reviewed but unaccepted start plan binds its snapshot. If current settings changed, refuse
acceptance with a distinct review-required result and no run creation; a replacement plan uses
current settings and needs fresh confirmation. Exact replay of an already accepted command returns
its original run and snapshot, including after a later settings save. Concurrent save/create chooses
one complete committed configuration. A group created atomically uses one selection; a child created
later selects at its own creation boundary. Parent identity and safety constraints remain enforced.

Separate process ownership/claim fencing from configuration selection so a worker can execute old
and new snapshots without restart. Ordinary pool, timeout, browser and saved display overrides
must take effect according to the retained run configuration, including actual resources, not just
stored fingerprints. Shared quota consumption is never reset by creating a snapshot. Preserve the
existing process-scoped runtime-isolation sources, host probe and provider environment families;
saved display overrides are not the probe. Protected next-use/next-start/input rules remain unchanged.
No additional restart exemption for editable ordinary settings is admitted.
Ordinary idle scheduling reads current saved cadence at the next idle boundary; it does not
retime an active run, held claim or established deadline. Run-bound resources continue using that
run snapshot. Shared admission limits preserve active work and cumulative quota accounting.

L/A extend explicit-only D322 backup/restore to a verified set containing the live database,
`archive.sqlite` under the isolation state root and retained report files. Bind exact source versions,
transfer/deletion progress and file inventories; restore cannot revive moved/deleted runs or guess
missing ownership. Preserve old backup grammars and settings/credential coupling. No live database
upgrade is authorized by C0.

This is the C0-admitted target contract, not a claim of implemented behavior. The [Phase 2.6 owner](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md) binds sequential prerequisites, focused development proof and final 2.6.9 acceptance. Released evidence and migrations remain immutable.

### F implementation baseline — 2026-09-09

Schema47 F consolidates saved/active authority into app_settings plus retained settings_snapshots and routes save/create/claim/resource calls through S-owned modules. The working baseline still requires restart; S owns the approved no-restart change.

Implementation, frozen interfaces and focused evidence: [F execution owner](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/foundation.md#f-execution-record--2026-09-09).
This records implementation of the approved C0 contract, not a new decision or full-phase acceptance.
