# 01 · Phase 1 — build the spine

This doc is the dedicated home of **Phase 1**, tree node `{#phase-1}`: its tasks, what is done and
what is left, its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] the spine carries ONE real workflow end to end — `person-lookup` ran LIVE against real UCPath + CRM on the new executor (D74, 2026-08-04; run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`)
- [x] all five work-item nodes landed and are still the shape the code has: `p1-base` (07-31) · `p1-authority` (08-01) · `p1-kernel` (08-02→03) · `p1-spine` (08-04) · `p1-exit` (08-04)
- [x] the three presentation defects the live run exposed were closed the SAME day — D123 skipped-arm, D124 terminal duration, D126 accessible-name channel
- [x] the one liveness defect it exposed was root-caused and fixed — a dead CRM session cost 262.9 s to surface → `timeouts.sessionAcquireMs` (D125)
- [x] historical Parts **1.1–1.5** and their original exit criteria remain evidenced
- [ ] **1.6** waits for 0.3, then implements the canonical run/settings authorities and migrates only lifecycle/configuration writers plus core runtime consumers; 2.6 owns downstream read models and 3.1 owns dashboard behavior
> 2026-09-03 | D326/D327 authority reset | reopening 1.6 does not invalidate the live spine proof; it prevents Phase 2/3 consumers from continuing on authorities 0.3 is about to supersede
- [ ] residuals that trace back to spine contracts, all owned in LATER nodes — `src/dashboard/state/` never built its cache half (Track D row D6) · five of six stream topics have no producer and the notes stream has no emitter (`{#track-c}` / `{#observed-logs}`) · `ref:dashboard-surfaces` §3.2's three declaration shapes unimplemented · D71's type BUDGET unmeasured
> 2026-08-29 | D75 authority close | verified one BFF request-identity checkpoint and pre-effect command attribution matching; left: nothing IN this phase — every open line above is a named residual whose owner is a later node
<!-- /roadmap-status -->

### What Phase 1 built

**The minimum of the base's dependency graph (`00-design-the-foundation.md` §The base's dependency
graph) that can carry ONE real workflow end to end** — in this repository's `src/`, inside its own
tsconfig project, with unit tests and `test:architecture` ratchets covering it from its first file.
That last clause is a charter non-negotiable, not a preference: there is no ungated window in this
tree's history.

**Why the cut is where it is (D74, operator ACCEPTED 2026-07-23).** The prior plan built ten base
work items — the whole trust layer, all data services, mobile capture, Edit Data, the explorer, the
AI adapters — against **synthetic fixtures with no consumer**, and only then ran a workflow. Two
problems: a live run falsifies contracts a fixture cannot, and the program's own stop-loss trigger
(b) — *"a base contract flaw surfaces after ≥2 consumers depend on it"* — is far cheaper to hit with
six work items built than with ten. So Phase 1 became **1a–1f plus two thin slices**, and its exit
test is a live workflow. Everything cut is *deferred, not deleted*: it reappears in
`02-prove-writes-build-the-tails.md` as the four base tails, built against a proven spine and a real
consumer. **No contract in `reference/` changed — only delivery order.** The record justifies the
call: every defect §Exit criteria lists was found by the live run and by nothing else.

| In the spine | Deferred to the Phase-2 tails |
|---|---|
| 1a guard plumbing · 1b strict domain/clock/config/secrets · 1c authority storage + recovery + command/write type shell · 1d semantic UI registry + drivers + task/store/session contracts · 1e workflow DAG + delegation + completion + scenarios · 1f registry + workers + command service + write sequencer, including minimal failure/result authority and generic provider admission | 2g (rich evidence receipts, diagnostic bundles, failure/explain projections, notifications, knowledge/fix records, ledger services over the 1f failure authority) · 2h (extraction/normalization/ocr/roster stores, production provider pools/consumers, column mapping, intake manifests, durable capture, Edit Data) · 2i (explorer, AI advisories, storage-health UI, generated catalog UI) · 2j soak/restore/doc gate |
| **1g-spine** — spans/notes emission + the run/queue projection only (what the queue surface reads) | |
| **1i-spine** — the four parity surfaces only: Queue Panel rows, Log Panel, Session Cards, Workflow Panel counts | |

**The program invariant Phase 1 establishes — two isolated repositories, one production authority
(D88/D90, re-mechanized by D93).** The legacy repo keeps running and may receive production
maintenance. This repo cannot import, invoke, proxy, or read/write legacy live state — that is
**structural**, not guarded: two repositories share no module graph. What still had to be *chosen*
and *proved*, because both worlds run on one machine, is operational separation: commands/
entrypoints, state/artifact roots, ports, process locks, and browser profiles/sessions are distinct
on both sides (`config/runtime-isolation.json`, `operational-isolation.test.ts`). Verified leaf
knowledge is ported with provenance (legacy commit hash + path). *As-built correction:* the
per-change legacy accounting this invariant originally carried —
`config/legacy-change-accounting.json` — is **RETIRED (D150, 2026-08-05)**; the risk it covered (a
ported selector going stale after legacy fixed it) is now covered by mandatory live re-verification
at each workflow's migration, and the frozen file is a historical record only. Phase 1 proved only
inside this repository and never changed production routing.

### The exit test, in one line

`person-lookup` ran live, recovered a dead CRM session mid-run without an operator, terminalized
`done` at attempt 2 with a correct result, and rendered all four parity surfaces from the ONE
projection. The full record — node walk, result, recovery, the four surfaces, the speed and
wall-clock observations, and the failure-latency root cause — is §Exit criteria; the node's own
section is §Phase 1 exit — the live run.

### The honest state at HEAD

**Phase 1 is DONE and stayed done.** Every node is `[x]`, every exit criterion is MET, and the spine
has carried every workflow built since. The contracts it froze — the task contract, the DAG builder,
authority storage, the command kernel, the write sequencer, spans and the ONE projection — are the
contracts the code still implements; the later rewrites verified them against the tree rather than
against this doc.

**What the later rewrites found are residuals, not regressions, and each has an owner elsewhere.**
They are listed here because they trace back to a Phase-1 contract and an operator reading this doc
should not have to discover them in Phase 3:

| Residual | Where the contract was set | Owner |
|---|---|---|
| `src/dashboard/state/` never built its cache half — six modules of resource hooks, no invalidation/generation layer, and three surfaces bypass it | 1i-spine, the transport/state split | **Track D row D6** (`{#dash-defaults}`) |
| five of the six declared stream topics have no producer (only `dashboard-day` is emitted); `emitNote` is composed and never called, so `.tracker-rebuild/notes/` has never existed | 1g-spine, the subscription protocol | `{#track-c}` (§3.5) and `{#observed-logs}` |
| `StepDisplayRule`, `GateProjectionDefinition` and the `ArtifactSinkId` sink registry are declared in `ref:dashboard-surfaces` §3.2 and implemented nowhere; `span.ended` carries no `verdict` | 1e/1g-spine, the descriptor's presentation declarations | `ref:dashboard-surfaces` §3.2 / §1.3 |
| D71's type-inference proof EXISTS (`tests/types/`, a 21-node graph plus `@ts-expect-error` controls) but its 5 s / 1 GiB BUDGET is unmeasured — nothing runs `tsc --extendedDiagnostics` against it | 1e, the real-scale type proof | `ref:guards-and-tests` §3.12 |
| two port-map invariants are held by nothing named — `cancel-mechanism` and `tracker-row-emission` | 1a, the guard inventory | `ref:guards-and-tests` §2.1 / §5.1 |
| the artifact resource schemas have no route serving bytes | 1b/1g-spine, the wire primitives | `{#def-byte-path}` (D189, `04-close-the-deferrals.md`) |

None of these blocks a phase, and none is a waiver: each names where it is owned.

## 1.1 · Guardrails and strict domain
<!-- roadmap: p1-base -->

<!-- roadmap-status: p1-base -->
- [x] 1a — the guard lane exists BEFORE the tree does: nine executable ratchet arms, each run over the real tree AND its own violating fixture by `guard-manifest` (`tests/unit/architecture/helpers/ratchet-arms.ts`)
- [x] 1a — the reviewed guard inventory is the machine SSOT and matches `tests/unit/architecture/` by `deepEqual` in BOTH directions; 75 entries at HEAD (65 active · 8 retired · 2 planned)
- [x] 1a — zero-debt from the first file: `--max-warnings 0`, no debt manifest, no per-file allowlist (`Record<file,{count,reason}>` did not travel from legacy)
- [x] 1a — runtime isolation pinned and proved: `config/runtime-isolation.json` + `operational-isolation.test.ts` (`.tracker-rebuild`, 3938/5174, `.tracker-rebuild/locks`, `hrauto-rebuild`)
- [x] 1b — the strict domain leaf: branded ids, canonical JSON / absence / boundary types, injectable Clock, `env > settings.json > default` config with provenance + fingerprint, typed secrets + redaction, and the base failure / evidence / scenario / knowledge schemas (2026-07-31)
- [x] 1b — the strict wire primitives are still the served ones — `src/domain/dashboard/{bootstrap,projection,run-detail,subscription,artifacts,primitives}.ts`, recursively strict, unknown keys refused (`strict-boundary-schemas`)
- [x] 1b — single-source enforced, not merely intended: `clock-single-source`, `manual-clock-test-only`, `secrets-single-source`, `no-secret-values-in-logs`
- [ ] two invariants the ratchet port map NAMES are held by nothing — `cancel-mechanism` (one-mechanism cancel) and `tracker-row-emission` (no arm bans an `appendFileSync` to the event JSONL outside the emitter); owner `ref:guards-and-tests` §2.1 / §5.1
- [ ] the coverage floor is still 60/80 (`vitest.config.ts:40-41`); R10 raises the global floor to 80 (measured 84/82/85) and that has not landed — owner `{#workflow-authoring-core}`
> 2026-08-21 | docs-cohesion 01 | verified against tests/unit/architecture/helpers/ratchet-arms.ts, docs/rebuild/guard-inventory.json (75 entries, 65/8/2), vitest.config.ts:40-41, src/domain/dashboard/** and the filled `p1-base` blocks in reference/{guards-and-tests §2, operator-trust §2, frontend-backend-integration §3}; left: the two unheld port-map invariants and the coverage-floor raise, both owned elsewhere

<!-- /roadmap-status -->

### Task 1 · Land guardrails and baselines (COMPLETE 2026-07-31)
<!-- roadmap: p1a-guards -->

**The order is the point.** With no rebuild source yet, 1a extracted the shared walk/allowlist
helpers as a zero-count-change commit, then landed the reviewed guard inventory, the D58 capability
baseline, exact path/state-root isolation tests, and the zero-debt lint/coverage commands — so the
first line of `src/` was written into a tree that already refused warnings, already refused a
missing guard, and already refused a shared state root. The charter's *no ungated tree* is a fact
about this repository's history, not an aspiration.

**Acceptance hardening is what makes the lane non-vacuous.** Ratchet arms are executable against
adversarial fixtures (a dead arm cannot stand in for enforcement — `guard-manifest.test.ts` runs
each arm over a checked-in violating fixture); guard discovery recurses; coverage exclusions carry
independent owner/status activation; and every activated arm must resolve a NON-EMPTY file set, so
an unmatched glob is a failure rather than a skip.

**Two pieces of 1a were retired, both with successors named — never a silent shrink.** The
bidirectional cross-tree runtime-isolation guard family, the AST/call-site bridge scan and the
preservation manifest's scanning of changed legacy files retired with **D93**: isolation became
physical when the repositories split, and legacy files are governed by the legacy repo's own gates.
The legacy-change-accounting manifest retired with **D150 (2026-08-05)**; what replaced it is
mandatory live re-verification at each workflow's migration. `legacy-selector-port-provenance` is
unaffected — it pins all 406 keys to a FIXED legacy commit's blobs, so legacy moving on cannot
invalidate it. The inventory records both retirements with their deciding decisions, which is why a
reader can tell a retirement from an accident.

**As-built at HEAD:** nine arms (fail-loud-catch-default, nullish-literal-data-fallback,
wait-for-timeout, inline selectors, evaluate-named-fn, import cycles, layer matrix, code
conventions, tailwind palette); 75 inventory entries, 65 active. The gate family was later
simplified by **D191** — `npm run test:coverage` is a strict superset of the earlier
`test` + `test:architecture` pair and measured faster — and the `*:rebuild` command names retired
with D93, the `rebuild:` runtime prefix with D247. Those are command-name changes; the lane itself
is 1a's.

### Task 2 · Build the strict domain leaf (COMPLETE 2026-07-31)
<!-- roadmap: p1a-domain -->

**What landed.** Closed and branded ids; canonical JSON, absence and boundary types; the injectable
`Clock`; strict config resolution over `env > settings.json > default` with provenance and a
fingerprint; fail-loud fiscal and instance rules; typed environment / local-source / file secrets;
redaction; exhaustive runtime-dependency and environment/preflight registries; the base failure,
evidence, scenario and knowledge schemas; and the strict bootstrap / day / detail / artifact /
subscription wire primitives. `ObservationId` is a stable dotted semantic identity while UUID
`EvidenceEntryId` owns dynamic receipt rows — two different questions, two different id kinds.
Trace hours are `00–23`; the live 60 s UKG timeout is reconciled; ngrok local-source absence or
unreadability is descriptor-preflight visible. Whole-`src` ratchets and the layer matrix went active
here, and the fail-loud catch arm was widened to multi-statement and block-bodied Promise handlers.

**Every closed union 1b froze is still the served one** — `RunDetailSectionSchema`, `TopicKeySchema`,
`QueueStatus`, and the capability `{state:"present"|"absent", reason}` shape — and no frontend
module hand-writes a mirror of any `*Wire` type (`dashboard-wire-boundary`). The evidence half is
the same story: strict schemas for failures, redacted bundles, receipts, scenario manifests,
preflight scenarios and knowledge/fix records all date from 1b, exercised against recursive
unknown-key injection. The TABLES that store them came later (D134, schema v10) — the schema half
and the storage half are separate landings and `ref:operator-trust` §2 now says which is which.

**Two later decisions amended a 1b contract without re-opening it, and both are worth knowing
here.** **D121** removed `node:path` from `src/domain/config/schema.ts`: a browser-reachable
module may not statically import a Node built-in, so `paths` became REQUIRED in `ConfigSchema` and is
supplied by the server-only `src/domain/config/runtime-paths.ts` through the same one resolver — an
alias or a browser stub was refused because a stubbed `resolve()` invents a plausible-but-wrong
absolute path. **D133** then found that a required config leaf is a durable-schema change: stored
`config_snapshots` parse strictly at database OPEN, so `src/domain/config/snapshot-generations.ts`
pins the leaf set per generation and a stored config is read FORWARD, never back-filled. Both
strengthened 1b's rule; neither changed it.

**Guards standing at this step:** the strict-boundary catalog plus unknown-key fixtures; the
typecheck / lint / test / architecture / coverage gates; clock, secrets, config, preflight and
redaction canaries; defaults / env / settings provenance; bidirectional system, provider, endpoint
and secret prerequisite coverage; adversarial ratchet fixtures; and no open decision maps.

**What is LEFT on this node** is two named invariants and one number. `cancel-mechanism` and
`tracker-row-emission` appear in the ratchet port map and no arm holds them — written down in
`ref:guards-and-tests` §2.1 / §5.1 rather than implied. And the coverage floor in
`vitest.config.ts:40-41` is still the 1a value (60 global / 80 safety-critical); R10's raise to a
global 80 is planned under `{#workflow-authoring-core}` and is not landed.

## 1.2 · Durable authority and workflow model
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] 1c — the authority/projection table split, the exhaustive frozen registry and the once-per-transaction generation rule (`src/domain/authority.ts`, `src/infra/sqlite/authority-database.ts`)
- [x] 1c — this branch's migration history is IMMUTABLE: every version's ordered statement bytes pinned by a literal digest, v1 through the current v21 (`src/infra/sqlite/migrations.ts`, `migration-history-immutability`); conflicting unmerged suffixes still require an explicit integration disposition
- [x] 1c — permanent `(system, idempotency_key)` fencing, Clock-injected stabilized-negative settlement, and the all-or-none intent + attempt + ledger + terminal-span commit
- [x] 1c — the nine strict command target families and the actor-stamped idempotent envelope (D95, `ref:dashboard-surfaces` §2.4)
- [x] 1d — 406 ported selector keys with pinned commit/blob provenance, four branded semantic ids (`src/domain/ids.ts:43-46`), four per-store server-only recipe registries, and the recipe-free generated catalog as the ONE projection (D177 — it throws when stale)
- [x] 1d — typed drivers: raw `Page`/`Locator` confined to driver and session internals by AST **plus** transitive import graph (`task-driver-boundary`); verification is conjunctive (D98/D99)
- [x] 1e — the real-scale type proof EXISTS: `tests/types/{task-contracts,flow-graph}.typecheck.ts`, a 21-node graph plus `@ts-expect-error` controls, inside the one `tsc` program
- [x] 1e — the bundle-safe node vocabulary and the ONE builder; the transform-free canonical-input validator with proven round-trip (D62); delegation fan-out, fingerprinted replay verification and joins; the sealed completion program; descriptor assembly with `contractFingerprint`; `run_checkpoints` (schema v3) and the D8 freshness walk
- [x] 1e — `person-lookup` registered as the FIRST descriptor with its four contracts, and `tests/scenario/`'s executable per-branch / gate / policy corpus
- [ ] `StepDisplayRule`, `GateProjectionDefinition` and the `ArtifactSinkId` sink registry are declared in `ref:dashboard-surfaces` §3.2 and implemented nowhere — owner `ref:dashboard-surfaces` §3.2
- [ ] `semantic-ui-registry` never calls Kuali's own audit functions — three stores of four — owner `ref:operator-trust` §1.7
- [ ] D71's BUDGET half is unmeasured: nothing runs `tsc --extendedDiagnostics` against the 21-node graph, so the 5 s / 1 GiB acceptance value is unenforced — owner `ref:guards-and-tests` §3.12
- [ ] D208 rule 1 is an authoring obligation, not a machine check; its trigger is a second exception — owner `ref:operator-trust` §1.6
> 2026-08-21 | docs-cohesion 01 | verified against src/domain/{authority,ids}.ts, src/infra/sqlite/{authority-database,migrations}.ts, src/domain/workflow/**, src/control/workflow-registry.ts, tests/types/ and the filled `p1-authority` blocks in reference/{dashboard-surfaces §2, operator-trust §1, guards-and-tests §3}; left: the four lines above, each owned in a reference doc

<!-- /roadmap-status -->

### Task 1 · Build durable storage and recovery (COMPLETE 2026-08-01)
<!-- roadmap: p1b-storage -->

**What landed.** The private native `node:sqlite` authority adapter; the exact authority/projection
registry and the immutable migration chain; savepoint-correct generation accounting; a
self-describing verified online backup with generation follow-up; strict authority-record
validation; read-only doctor and degraded boot; the one-time runtime/process-generation-bound
stopped-system restore proof; the full D95 command families; the strict proof / settlement / binding
/ intent / attempt / dependency / manifest / gate / notification / outbox shells; permanent
`(system, idempotency_key)` fencing; Clock-injected stabilized-negative settlement; and the
all-or-none intent + attempt + ledger + terminal-span commit.

**This is the authority and TYPE shell, and the row said so.** Workers, browser mutation, the
command service, the sequencer and projectors, HTTP/UI and live writes were all later items. Saying
which half landed is what let 2j find the gap below.

**The one thing 1c got wrong, and how it surfaced (D181, 2026-08-09).** The offline restore service
has demanded a one-time `StoppedSystemProof` since this item, and `RecoveryStopProofStore` refuses
to issue one without a recorded `RecoveryRuntimeLockSnapshot` — but **nothing in production ever
recorded a snapshot**: `recordRuntimeState` had no caller and `.tracker-rebuild/locks` was never
created. So `cli storage restore` was complete, tested and unreachable from its first day, and every
gate stayed green because a precondition nothing produces makes a path unreachable without failing
anything. FIXED in 2j: one lock file per role, written by the dashboard and worker compositions
before the database opens and released after its handle closes, with the snapshot COMPOSED at
observation time from both files. It is recorded here because the defect is a 1c contract's, not
2j's.

**Guards standing at this step:** the exact v1 upgrade fixture, DDL invariants and the raw
`DatabaseSync` boundary; authority/projection enumeration; corrupt / foreign / newer /
invariant / record-invalid boot fixtures; verified native backup with bounded follow-up; exact
consumable stopped-proof restore and projection rebuild; sequential and competing-connection
permanent-key dedupe; caught nested fence/commit rollback; observed-present zero-attempt
write-outbox; exact Clock settlement boundaries; failure after every atomic storage step rolling
back all rows and the generation; no untyped command / proof / gate / notification / outcome arm;
and the active `storage-recovery`, `permanent-key-dedupe`, `recovery-negative-proof-settlement` and
`atomic-write-outbox` guards.

### Task 2 · Build store, task, and driver contracts (COMPLETE 2026-08-01)
<!-- roadmap: p1b-contracts -->

**What landed.** The full legacy selector port map with pinned commit and blob provenance; the
server-only closed recipe registry; the recipe-free generated `ui-catalog.json` and per-system
`UI-CATALOG.md` projection with its `selector:search` consumer; the typed driver boundary; sealed
read / prepare / commit contract overloads with subject specs, freshness and provenance; the
unforgeable `MutationCapability`; the crash-recoverable content-addressed artifact writer;
capability-declared provider adapters with narrowed injected clients; and all nine browser stores
with matching session providers and OnBase-only exclusivity. The first `stores/common/` leaf
(Kronos timecard) was ported with provenance. D98/D99/D101 (conjunctive fixture + live verification,
UI-owned verification scenarios, imported semantic ids) and D96/D97/D100 (one `SessionNeed`,
separate artifact and content identity, provider scope stops at the seam) are ratified in their
owning reference docs.

**Login wiring, session lifecycle, mutation-token minting and worker execution are 1f** — 1d built
the shapes those consume.

**Guards standing at this step:** semantic-id uniqueness, dependencies and catalog freshness;
premature `commit` implementations and capability forgery rejected; raw `Page`/`Locator` absent
outside driver and session internals through AST plus transitive import-graph checks; remote I/O
requiring a provider declaration and an infra adapter; the effect / capability / subject / contract
/ impl / example / error / store / no-any / artifact / OnBase guards; and every published
observation or recipe carrying both a fixture and a read-only live evidence ref bound to the same
port-map row.

### Task 3 · Build the workflow definition model (COMPLETE 2026-08-01)
<!-- roadmap: p1b-workflow-model -->

**It began with a real-scale type-inference proof, deliberately.** The deleted spike covered two
effects and three linear steps. The replacement compiles a representative 15–25-node graph with
read/prepare/commit, transaction pairing, an output-dependent branch, fork/join, typed child runs,
external and children gates, heterogeneous completion stages, decorations, errors, and schema
changes that deliberately fail their consumers — plus sixteen `@ts-expect-error` controls. No
production builder or skeleton landed until the positive and negative controls passed under the real
toolchain with no `any`/`unknown` target erasure. The measurement recorded at the time was
`tsc --extendedDiagnostics` **0.47 s / 215 MiB** against a 5 s / 1 GiB budget. **As-built, the proof
survives and the BUDGET does not:** `tests/types/{task-contracts,flow-graph}.typecheck.ts` is a
21-node graph inside the one `tsc` program, and nothing re-measures it, so the acceptance value is
unenforced (`ref:guards-and-tests` §3.12). The D71 disposable 40-node simplified chain was a
feasibility floor, never a substitute.

**What else landed.** The bundle-safe node vocabulary and the ONE builder; the transform-free
canonical-input validator with a proven round-trip and fail-loud snapshot re-validation (D62);
delegation fan-out planning, fingerprinted replay verification and joins; graph-level scenario
coverage derived from the node tuple; the sealed completion program with its stage chain proven
against a sample; the closed run-surface ingress specs and their exhaustive interpreters; descriptor
assembly with derived steps / gates / systems / requires and a build-manifest `contractFingerprint`;
checkpoint storage (`run_checkpoints`, schema v3), the checkpoint and canonical-snapshot migrations,
and the D8 freshness walk. `person-lookup` was registered as the first descriptor with its four
contracts, and `tests/scenario/` got its executable per-branch / gate / policy corpus. D102–D107 are
ratified in their owning docs.

**Three later decisions amended 1e's checkpoint identity without re-opening the contract, and each
was found by a real run.** **D144** — a durable row's schema hash describes the BYTES IT HOLDS, so
when a transaction node could not be a terminal dependency the READER moved rather than the writer.
**D214** — a run ATTEMPT is not one execution of its graph: a gate park and its resume are two
executions inside one attempt, so the checkpoint key gained the claim generation, conditionally, and
every historical row's `record_key` stayed byte-identical. **D221** — every component of an
ITEM-scoped key must itself be item-scoped, so the attempt counter became the item's next unspent
attempt. All three strengthened 1e's key; none moved a stored byte.

**Exit evidence for this item, as recorded:** the realistic graph type suite MET; the transform-free
canonical-input audit and round-trip MET; the delegation matrix MET; no erased target MET; strict
terminal/gate result MET; the ingress→canonical round-trip over stored authority MET; transaction
pairing MET; the descriptor projection matrix MET; and the executable per-branch / gate / policy
scenarios MET — with `dry-run` and `subject-mismatch` correctly booked as executor behaviours,
pinned as 1f obligations and re-pointed at a real run there.

## 1.3 · Execution kernel and write safety
<!-- roadmap: p1-kernel -->

### Task 1 · Build registry, workers, and command admission
<!-- roadmap: p1c-execution -->

Owns the workflow composition root, plan admission, queue claim/heartbeat/retry, provider budgets,
failure/result authority, and exhaustive command dispatch.

### Task 2 · Build sequenced write authority
<!-- roadmap: p1c-write-safety -->

Owns probe → prepare → binding proof → fence → commit → proof → atomic authority publication.

### Historical combined implementation record

<!-- roadmap-status: p1-kernel -->
- [x] the ONE `WORKFLOW_MODULES` composition root above workflows — every registry derives from that single tuple (`src/control/workflow-registry.ts`)
- [x] exact raw + canonical start plans and atomic consumption (D109, schema v6) — the ingress retains what an operator SUBMITTED beside the canonical snapshot, so a default or a transform can never erase it
- [x] one-item claims with unfinished-write recovery BEFORE requeue (D118), verified-neutral navigation and explicit fresh-session boundaries keyed by config fingerprint (D116/D117), and the required non-no-op provenance collector (D115)
- [x] minimal durable `FailureRecord` and terminal `RunResultRecord` under a strict pre-terminal authorization (D110/D114, schema v7→v8); the exact strict failure record is in non-rebuildable authority for every failed task and run, its `failureId` associated atomically with the failure transition
- [x] D112/D119 generic provider admission and fixed-window budgets (schema v9, 2026-08-03) — reserve before I/O, reconcile only on a strict measured result, retain the maximum on any uncertain outcome
- [x] ONE exhaustive command kernel with the Phase-1 arms active and later arms typed `capability-unavailable` (D113); the arm partition is checked against the D95 registry in BOTH directions at module load, so an action neither list carries — or both — throws before any command can dispatch (`src/core/command-kernel.ts`)
- [x] the write sequencer's beats ①–⑦ — probe → prepare → binding proof → fence → commit → proof → the one checkpoint/run/outbox transaction (D111); `write-safety-contract` is active and asserts durable ABSENCE over a real database (D188)
- [x] D120 — a session's authentication is a CONTENT-level proof, never a URL; live-verified on ucpath (~17 s) and crm (~12 s) including a real Duo ceremony
- [x] D75 — one BFF admission checkpoint derives only the strict configured solo actor; every schema-valid command `requestedBy` claim must match before handler effects (2026-08-29)
- [ ] the bulk `all-or-none` mode is declared and refuses `capability-unavailable` (D235) — owner `ref:frontend-backend-integration` §3.4
- [!] `supersede-active` is implemented in the kernel, unanticipated by the planner, and reported to the operator as unimplemented — three sites, two answers; owner `ref:dashboard-surfaces` §2.4
> 2026-08-29 | D75 authority close | verified the one admission checkpoint and command-claim match against the BFF route registry; left: the two lines above, both owned in reference docs

<!-- /roadmap-status -->

**COMPLETE 2026-08-04 — the core registry, workers, checkpoints, the command service and the write
sequencer.** This is the item that turned a set of contracts into a runtime, and it is the one
whose decisions (D109–D120) the rest of the program still runs on.

**The composition root.** `src/control/workflow-registry.ts` holds the ONE `WORKFLOW_MODULES` tuple
every registry derives from — the descriptor list, the store bindings, the start surfaces. A second
registry cannot exist because there is nowhere else to declare one.

**The interpreter never tracks a run version locally.** Heartbeat renewal bumps the version
concurrently with node transitions, so each transition re-reads the current row and CASes with the
constant claim token; a conflict then only ever means real ownership loss, and the worker abandons
rather than terminalizing over it. Entry validation runs in `validating` before any browser and
aggregates every problem into ONE no-node `FailureRecord`. `always-rerun` nodes structurally never
reach `loadCheckpoint`; replayed nodes emit no spans; a replayed checkpoint's exact stored record is
what terminal evidence reuses. Every task invocation races a mandatory injected monotonic deadline,
so a signal-ignoring driver cannot hold the worker.

**Terminal authority binds its consequence.** A failed run is settled only with the exact existing
`FailureRecord`; a done run only with a strict schema-bound `RunResultRecord` plus a pending
`run_terminal_outbox` row. Both validate the current run identity, version and claim, and write
every durable row and the terminal CAS in ONE outer authority transaction. Result dependencies come
from a factory-authenticated terminal view and retain either the exact checkpoint identity, output
and provenance digests and fingerprints, or a CLOSED `not-run` reason for a conditional node — never
a silent omission. The initial success path additionally carries the descriptor factory's
unforgeable in-process seal: a schema-valid caller-built result is not authority.

**The write sequencer owns beats ①–⑦ and is the sole `MutationCapability` mint.**
`src/core/write-sequencer.ts` sits behind the interpreter's seam; the capability is runtime-
unforgeable through a module-private WeakSet, and `task-driver-boundary` allowlists exactly that
file. Beat ⑦ is one outer authority transaction over run-claim revalidation, the Phase-1c four-row
primitive (nested savepoint), the `TransactionOutcome` checkpoint and the run transition.
Post-fence uncertainty parks intent-first, then the run; PRE-fence indeterminacy refuses with zero
fence and zero click. Dry-run is a separate `executeDryRun` arm — `executeTransaction` with
`dryRun` refuses loudly.

**D120 is the decision most worth re-reading.** A live UCPath login smoke had passed in ~3 seconds
having authenticated nothing: the recipe matched a host SUBSTRING, so the PUBLIC portal read as the
application. Every browser system now declares a verifier proving TWO independent facts — a
server-issued session artifact (`PS_TOKEN` for UCPath, `sid` for CRM) and the ABSENCE of every
sign-in form — and `defineVerifiedLoginRecipe` runs it after the flow on every return path,
including the neutral reset. A URL may be a necessary precondition; it is never the conclusion.

**Two decisions after Phase 1 fixed the recovery half without re-opening the contract.** **D200** —
a recovery mechanism that lives inside the thing it recovers cannot recover the thing it lives
inside: the D118 sweep runs in a RUNNING worker's maintenance ticker and is staleness-gated, so a
worker whose loop threw restarts and inherits its own fresh-heartbeat claim, wedged. The fix is that
the LEASE is the evidence — `workerLeases.start` succeeding proves no other process answers to this
id — so the sweep request grew a `workerId` scope rather than a widened `staleBefore`. **D218** —
the BFF's projection was fed by an in-process `onEvent` hook on its own span writer, which is a
single-process assumption wearing a cross-process contract; that one is 1g-spine's and is recorded
there.

**Guards standing at this step:** atomic plan-consumption crash and conflict tests; command
idempotency plus typed-unavailable zero-side-effect cases; one-active-item-per-worker;
recovery-before-requeue; exact config-key session reuse; the neutral-reset and fresh-boundary proof;
live and derived provenance completeness; result and failure authority integrity; no visible-root
fallback; dry-run commit-free; binding mismatch or unknown creating zero fence and zero click;
provider admission; the full beat-⑦ crash tests; and `authentication-proof-not-url`.

**What is LEFT on this node** is two filed items. The bulk `all-or-none` mode is declared and
answers `capability-unavailable` (D235). And
`supersede-active` has three sites giving two answers — implemented in the kernel, unanticipated by
the planner, reported to the operator as unimplemented — filed in `ref:dashboard-surfaces` §2.4
rather than fixed in a docs pass.

## 1.4 · Projection, BFF, and operator shell
<!-- roadmap: p1-spine -->

<!-- roadmap-status: p1-spine -->
- [x] 1g — the span wire union, its two identity tuples and the emit-time write-once rule (`src/events/types.ts`, `src/infra/events/span-jsonl-writer.ts`)
- [x] 1g — the ONE server-side run/queue projection every surface reads (`src/server/dashboard/projectors/run-queue-projection.ts`); `one-projection-counts` (D81) is active and no count anywhere is computed by a second path
- [x] 1g — the in-process typed Hono BFF on 3938: `GET /api/v1/bootstrap`, `GET /api/v1/dashboard?day=`, `GET /api/v1/runs/:runId` + `/:section`, `POST /api/v1/commands` (+ the bulk arm), and ONE resumable stream `GET /events/v1` resuming on `Last-Event-ID`
- [x] 1g — the projector is fed by an offset-aware DISK TAIL, not an in-process hook (D218) — `compose.ts` seeds `rebuildFromJsonl()` and polls `ingestFromDisk()`
- [x] 1g — span folding is keyed by `(runId, attempt, spanPath)`, later extended by D214 so two executions of one node inside ONE attempt are distinguishable, and by D215's `not-observed` preview verdict
- [x] 1i — the exact Person Lookup capability slice in the approved shell at 5174: Queue Panel rows (three row types, eight statuses), run/member `Logs · Receipt`, the persistent timeline, the Context rail, typed Start Run, Session Cards, Workflow Panel / Status Bar / day counts — all from the 1g BFF
- [x] 1i — ONE typed transport client (`src/dashboard/client/transport.ts`, `isNetworkOwner`), no handwritten frontend mirror of any `*Wire` type, and no workflow-id switches in the shell
- [x] 1i — the Playwright parity lane in ASSERT mode: both halves of every reference compared, a missing reference failing rather than being minted, and the bundle built and digest-stamped by the lane itself (D132)
- [ ] the NOTES stream has no production emitter — `emitNote` is composed and never called, and `.tracker-rebuild/notes/` has never existed; owner `{#observed-logs}`
- [ ] five of the six declared stream topics have no producer — only `dashboard-day` is ever emitted; owner `{#track-c}` (`ref:frontend-backend-integration` §3.5)
- [ ] `span.ended` carries no `verdict`, so the descriptor's `verdicts` vocabulary has nothing to key off; owner `ref:dashboard-surfaces` §1.3 / §3.2
- [ ] `src/dashboard/state/` is six modules of resource hooks with no invalidation/generation layer, and three surfaces bypass it; owner **Track D row D6**
- [ ] the artifact resource schemas have no route serving bytes; owner `{#def-byte-path}` (D189)
> 2026-08-21 | docs-cohesion 01 | verified against src/events/types.ts, src/infra/events/**, src/server/dashboard/{compose.ts,routes/api.ts,queries/**,projectors/**,subscriptions/**}, src/dashboard/client/** and the filled `p1-spine` blocks in reference/{dashboard-surfaces §1, frontend-backend-integration §3, guards-and-tests §3.13}; left: the five lines above, each owned in a later node

<!-- /roadmap-status -->

### Task 1 · Build spans and the shared projection (COMPLETE 2026-08-04)
<!-- roadmap: p1d-projection -->

**Only the slice the queue surface reads.** Strict spans and notes on the executor's paths, and the
single server-side run/queue projection every surface renders from, served by the in-process typed
dashboard BFF on port 3938. Evidence receipts, diagnostic bundles, rich failure projections and
explain, notifications, knowledge and the ledger *services* were deferred to the Phase-2 tails; 1f's
minimal failure and result authority is available, and the ledger *tables plus atomic outbox* landed
in 1c — so no write was ever unrecorded, even while the surfaces that display one did not exist.

**D81 holds as-built, proved by a real run.** The live exit test's counts agreed across every
surface (All 1 / Done 1 / workflow 1) because they are ONE projection, not three.

**The identity tuple is the lesson this item taught.** Span folding is keyed by
`(runId, attempt, spanPath)` — a node re-run after a recovered failure is two real spans that share
a path, and folding on the path alone erased one of them. Every fixture had one attempt, so the key
looked satisfied by using two thirds of it; the live run had two. **D214** later extended the same
reasoning one level in: a gate park and its resume are two executions inside ONE attempt, so the
task span path carries the claim generation. **D215** added the `not-observed` subject verdict for a
preview that settles before anything is staged — and its landing found that the kernel's union and
the wire leaf the JSONL writer parses had forked, because a fixture `SpanEmitter` does not parse the
wire schema.

**D218 corrected how the projection is FED, and it is the defect most worth knowing here.** The BFF
ingested spans two ways: a one-shot boot replay and a post-append `onEvent` hook on its own span
writer. The worker is a separate OS process, so every run enqueued after the dashboard booted served
an EMPTY timeline while its full span history sat in `spans/*.jsonl` — daily-use, since this item
shipped. It hid because run STATUS joins authority per surface and LOGS re-read the notes JSONL per
request, so the two surfaces beside the timeline kept working. The fix takes 1g's own "one
projector" sentence literally: the ONE live feed is an offset-aware disk tail with byte cursors
seeded by `rebuildFromJsonl`, and the `onEvent` hook is DELETED so "append first, fold after" is
structural.

**Guards standing at this step:** boundary corruption; redaction canaries; atomic projection tests;
the one-projection guard; and the run/task identity `(runId, attempt, spanPath)` plus worker/browser
identity `(workerId, spanPath)`.

### Task 2 · Build the BFF and first operator shell (COMPLETE 2026-08-04)
<!-- roadmap: p1d-shell -->

**The exact Person Lookup capability slice inside the approved full shell** — not four approximate
legacy components. Queue Panel rows with their three row types and eight statuses; run and member
`Logs · Receipt`; the persistent timeline; the Context rail; typed Start Run; Session Cards; the
Workflow Panel, Status Bar and day counts. All render from the 1g-spine BFF at the contracted
frontend port 5174, and all four were verified headless against the live run. Review and People
tabs, the full trust and data surfaces, and the Archive / Explorer / Activity / Settings tails
remained deferred to the Phase-2 tails.

**Three presentation defects the live run exposed were closed the same day** — D123, D124 and D126.
Their full records are in §Exit criteria, and the normative text is in
`ref:dashboard-surfaces` §Phase 1g/1i-spine as-built presentation deltas.

**Two defects this item shipped were found five days later by 2j, and both are worth reading as
warnings about what a green gate proves (D187).** **(1)** Every `paper-ink` parity reference had been
photographed DARK since the corpus existed: the harness stamped the theme on `<html>`/`<body>` with
a post-navigation `page.evaluate`, and the app root's own attribute won the cascade. The semantic
half AGREED with the pixels, so there was nothing to diff. **(2)** Behind it, `LogPanel`'s root is a
flex child that never claimed a width, so it sized to content and its own grid resolved to
**`2px 376px`** — the entire run-detail panel, where the failure record and the evidence receipt
live, was a two-pixel sliver at every viewport since this item, while the accessibility tree
reported every word of it. D82's acceptance bar was unmet ON SCREEN through a dozen green gates and
two deliberate reference reviews. Both are fixed (`page.addInitScript` seeding the product's own
stored preference before navigation, an `assertThemeApplied` that refuses when the three writers
disagree, and `w-full` on the panel root). The generalization is the parity lane's own:
**when a test asserts through one representation of a surface, something must assert the other.**

**The parity lane itself was later hardened by D132**, and for the same reason: it asserted only the
`.png` and rewrote every `.a11y.yml` / `.meta.json` unconditionally, so an accessible-name change
rewrote 56 references, changed zero screenshots and stayed green — and it served a `dist/dashboard`
it never rebuilt. Both halves of a pair are now compared, `PARITY_UPDATE=1` is the single switch
driving both writers, and the lane builds and digest-stamps the bundle itself.

**Guards standing at this step:** one typed transport client; finished wires only; no workflow-id
switches; both-theme headless a11y and screenshot parity at the reference viewports; and
browser-bundle purity — `dashboard-wire-boundary` walks the entry declared in `index.html` and fails
on any reachable Node built-in, printing the whole import chain (D121, after `src/domain/config/
schema.ts`'s `node:path` import reached the bundle six hops from the entry and killed the app at
module evaluation in dev while the production build only warned).

**What is LEFT on this node** is four absences and a folder that over-promises. The NOTES stream is
composed and has no producer — `emitNote` is never called and `.tracker-rebuild/notes/` has never
existed. Five of the six declared stream topics have no producer; only `dashboard-day` is emitted.
`span.ended` carries no `verdict`, so the descriptor's `verdicts` vocabulary has nothing to key off.
`src/dashboard/state/` is six modules of resource hooks with no invalidation or generation layer,
and three surfaces bypass it. And the artifact resource schemas have no route serving bytes. Each is
owned: `{#observed-logs}`, `{#track-c}`, `ref:dashboard-surfaces` §1.3, **Track D row D6**, and
`{#def-byte-path}` respectively.

## 1.5 · Live foundation proof
<!-- roadmap: p1-exit -->

### Task 1 · Prove one real workflow on the spine
<!-- roadmap: p1e-live-proof -->

<!-- roadmap-status: p1-exit -->
- [x] the exit test RAN and passed (D74, 2026-08-04): `person-lookup` against real UCPath + CRM on the new executor — run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, EID `10873698`, terminal `done` at attempt 2
- [x] the result is CORRECT, not merely schema-valid — `activeStatus.state = "active"`, `hdh = true`, and `crm-dates` recorded as `not-run / condition-false`, a closed reason exactly as D114 requires
- [x] mid-run recovery worked unprompted: the poisoned CRM session was closed, reopened, and the node re-ran under attempt 2 with no operator action
- [x] all four parity surfaces rendered from the ONE projection, verified headless — Queue row, Workflow Panel count, Session Panel, Log Panel timeline showing BOTH Cross Verification entries
- [x] the speed criterion — which budgets FIXED SLEEP — is met at the floor: `sleepMs` is absent on every task span of the run
- [x] the four defects the run exposed are all closed: D123, D124, D126 the same day, D125 as a separate acquisition bound
- [x] `ref:workflow-model` §8 / §8.1 carry the worked example and its five as-built deltas — the exit run is the source of both
> 2026-08-21 | docs-cohesion 01 | verified against §Exit criteria below, `ref:workflow-model` §8/§8.1 and the D123/D124/D125/D126 records in `reference/decisions.md` rounds 23–24; left: nothing — this node is the proof, and its residual (failure latency) became D125

<!-- /roadmap-status -->

**This node IS the phase's proof, and it is a test rather than a demo.** D74's whole argument is
that a live run falsifies contracts a fixture cannot. It did: the run found three presentation
defects and one liveness defect, every one of them green on every gate beforehand, and each is
recorded in §Exit criteria with the code that changed.

**What it cost, stated honestly.** Discovering the dead CRM session took **262.9 s** of the run's
~14.5 minutes — the single largest line item, and a failure-path cost, not a happy-path one. The
lesson the program carried forward is to budget for the failure path. The fix is D125's separate,
much shorter `timeouts.sessionAcquireMs` (60 000 ms), armed on the same kernel scheduler, failing
loud and never retrying.

**Where the full record lives.** The node walk, the result, the recovery, the four surfaces, the
speed and wall-clock observations and the failure-latency root cause are the first bullet of
§Exit criteria below, where the plan wrote them. `ref:workflow-model` §8 is the person-lookup worked
example and §8.1 is its as-built, recording the five deltas this run forced.

## 1.6 · Implement canonical run and settings authorities
<!-- roadmap: p1-authority-implementation -->

**Session workflow (operator amendment, 2026-09-04):** use roadmap §Governance's
[Plan, implement, review](../roadmap/roadmap.md#plan-implement-review-operator-amendment-2026-09-04) rule.
The approved phase section is the executor's brief. A candidate stays awaiting independent review;
only the original supervisor finalizes after accepted review, required integration gates and cleanup.
Existing task seams, dependency order, contracts and proof obligations remain unchanged.

This reopened implementation part waits for 0.3's approved contracts. It does not redesign the
authority model and does not own Phase-2 downstream read models or Phase-3 dashboard presentation.
Its scope is the stores, migrations, lifecycle/configuration writers, core runtime consumers, and
their deletion tests.

**The binding (0.3 Task 4, R04, 2026-09-04).** 1.6 implements **D330** (ref dashboard-surfaces
§D330.1–§D330.12), **D331** (ref clock-config-secrets §D331.1–§D331.12) and **D332** (ref
dashboard-surfaces §2.5 D332.1–D332.12, its settings half ref clock-config-secrets §D332.S1–S6, the
adapter roster ref guards-and-tests §5.2) verbatim; a task that needs a contract change returns it to
a newly numbered 0.3 task and does not improvise. Every task below is one supervisor session (D326)
bound to ONE seam (the files it may touch), ONE gate, its place in the integration order, the proofs
it owes from the three ladders (§D330.11's 26, §D331.11's 41, §D332.11's 27 — 94 rows, each assigned
exactly once below, plus the guard entries and the one unit test ref guards-and-tests §5.2 names),
and ONE deletion test — the red-capable proof that the displaced authority is gone, never a switch.
The **base gate** every task runs before its own row is
`npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check`
(a descriptor's import closure includes `src/domain/**`, so a stale manifest is a red gate, not drift);
`npm run test:parity` must stay green UNCHANGED through the whole part — adapter A8 (the served
eight-leaf editor inventory and the `settings.json: not set` line) is re-frozen deliberately at 3.1,
never here. **Operator exception (2026-09-04, choice 3 A):** before wave 2, a serial supervisor
repair may refresh stale derived-hash parity metadata inherited from D324. The operator's subsequent
explicit approval includes verified displayed descriptor/implementation hashes and their screenshot
and accessibility references. All other semantic content and layout must remain unchanged; retain
production code, assertions, and the existing pixel tolerance. Prove the exact hash-only differences
and pass parity in assertion mode after the repair. This admits no A8 or Settings UI change and no
general reference refreeze.
Both wave peers branch from the same integrated repaired baseline. Every leaf a task adds to a served contract is dispositioned under D183 in the same commit
(§D331.11 P41, §D332.11 M26). **Integration order:** Task 1 → wave 2 (`2-1` ∥ `2-2`) → 3 → 4 → 5 →
6 → 7, each merged `--no-ff` onto master with the base gate green before the next branches.

**The wave ruling.** The roadmap admitted Tasks "1 and 2" as a wave only after 0.3 proved their
schemas and migration boundaries independent. R04's cross-contract review proved they are NOT
independent as written — both add SQLite schema steps, both would bump `CURRENT` (two floors, two
frozen D290 lists, §D332.3 step 3(b)), both edit `migrations.ts`, `AUTHORITY_TABLE_REGISTRY` and
`authority-database.ts`, and §D332.5 makes the run half and the settings half one transaction by
design. They become independent the moment the schema floor is one serial commit: after it, the
run-record service touches the lifecycle adapter/service files and the settings work touches
`src/domain/config/**`, `src/infra/config/**`, `secrets.ts`, the settings runtime and the bootstrap,
with no shared file. So the part is re-sliced (D328): **Task 1 is the serial floor; Tasks 2-1 and 2-2
are the wave**, each in its own worktree and `codex/<unit>` branch from the master that contains
Task 1's merge and both approved focused plans. Each focused plan records its exact branch, worktree,
ownership and merge condition; the common base is resolved and verified before either supervisor
creates a worktree. Tasks 3–7 keep their numbers and run serially. No other pair is admitted as a wave:
Tasks 3 and 5 both edit the composition roots.

### Task 1 · Land the schema floor
<!-- roadmap: p1f-floor -->

**Seam:** `src/infra/sqlite/migrations.ts` (ONE numbered migration `v30`, the **floor**, carrying every
D332 schema step: `deleted_runs` + `item_id`/`attempt`/`run_number`/`ordinal_source` with
`deleted_runs_immutable_update` dropped and re-created with the four columns in its equality set;
`checkpoint_payloads_never_deleted` created relaxed behind the tombstone with its tally key;
`protected_settings_current`; `authority_upgrades`); `src/domain/authority.ts` (`AUTHORITY_TABLE_REGISTRY`
and the `AuthorityUpgradeRecord` schema); `src/domain/run/deleted-run.ts` (the existing
`DeletedRunTableSchema` owner, extended with nullable ordinals, `ordinal_source` and `tallyVersion`);
`src/infra/sqlite/authority-database.ts` for exactly four things — the
D290 `integratedByVersion` FROZEN literal lists for 27, 28 and 29, the `#runMigrations` floor gate with the
read-only no-migrate open mode for `storage backup`, `storage doctor` and the upgrade's preflight, the
`baseline` `authority_upgrades` row written in the transaction that creates a fresh at-floor database
(D321 regeneration), and the `protectedSettingsCurrent` singleton repository (get / advance-in-transaction)
so wave peer 2-2 never edits this file; the `authority-ahead` open wrapper that releases the `server`
process record (§D332.6); `src/server/dashboard/compose.ts` and its focused composition test solely to
place the already-acquired `server` process lock inside that open-failure wrapper. The operator admitted
this narrow seam expansion on 2026-09-04 because preserving the earlier file list would leave M9
unimplemented with no later owner. **Owes:** §D332.11 M3 (the open half), M9, M21, M10's `baseline` cell; the
`planned` `guard-inventory.json` entry for `no-lifecycle-sql-outside-the-adapter` (activation: 1.6 Task 4;
its `.test.ts` must not exist yet, ref guards-and-tests §5.1). **Gate:** base + those proofs + every
existing storage/backup/doctor suite green, with a direct v29 fixture proving each of the three
read-only no-migrate opening modes leaves `user_version` at 29. This is M3's **open half** only:
Task 6 owns the backup/doctor inspector and manifest widening and re-runs the complete command-level
M3 proof in which both commands succeed and the backup manifest reports 29. **Deletion test:** none is
deleted here; the direct M3 open-half test is the red-capable oracle (remove the gate and the fixture
reports the floor). **Order:** first; merged before 2-1/2-2 branch. Later additive migrations (`v31+`)
apply at open as before — the floor is a one-time gate (§D332.1).

- [x] One migration `v30 = floor` with the four D332 schema steps and the re-created `deleted_runs`
  trigger; `CURRENT` bumped in the SAME commit as the frozen 27/28/29 literals (§D332.3 step 3(b), M21).
- [x] `#runMigrations` gated at the floor; the read-only no-migrate open mode for its three callers;
  every other door `upgrade-required { schemaVersion, floor }`; the `baseline` journal row at
  regeneration; the open releases the `server` record on `authority-ahead` (§D332.1, §D332.5, §D332.6; M3, M9).
- [x] `AUTHORITY_TABLE_REGISTRY`, the record schemas, the `protectedSettingsCurrent` repository and the
  `planned` guard entry; base gate green with a v29 fixture untouched by each direct read-only
  no-migrate open mode. Task 6 owns successful pre-floor backup/doctor command and manifest compatibility.


**Continuation verification (2026-09-04, C858cc3dc R01).** Independent verification found and closed
M9's exact older-build/zero-settings-access proof and M21's full v27/v28/v29 traversal plus negative
controls. Test commit `d650a43b`, report/evidence `df41e0b5`, integrated by `5b1fb626`; the base gate
passes 411 files / 5,040 tests, and assertion-only parity passes 269 tests with unchanged references.
Seven mutation controls fail at their intended assertions. Task 1's supervisor worktree, branch and
exact task are fully closed. M3 command/manifest compatibility and M21's command-level `foreign-suffix`
wire and upgrade repetition remain Task 6. The historical coordinator launch of wave peers 2-1/2-2
from `d2fe05dd` produced no Task-2-1 candidate and its temporary evidence was later removed; the direct
focused plans below supersede that launch record and require a newly verified common base.

### Task 2-1 · Implement the canonical run-record service
<!-- roadmap: p1f-run-store -->

**Seam:** NEW `src/core/run-record-service.ts` (the §D330.5 operation set with its closed refusal union
and the canonical owner of lifecycle mutations; Tasks 3/4 cut over the remaining callers and activate
§D330.10's ONLY-caller guard); `src/infra/sqlite/run-store-contracts.ts` (strict request/result schemas,
including the required full claim token and named claim refusals); the lifecycle repositories in
`src/infra/sqlite/authority-database.ts` over `tasks` / `archived_runs` / `deleted_runs` (create with the
two-source watermark and the tombstone check; `claimNext` with the token REQUIRED IN FULL, the dependency
and disposition predicates and the §D330.6 order in one write transaction; `renewClaim`;
`workerTransition`; the composite `terminalize`; `requeue`; `archive`; `delete`/`deleteArchived` with the
member tree leaves-first, gate records, tombstone-first and `ordinal_source = tombstone`; `read` three-way;
`list` ordered; as-built throws converted to named refusal arms); `src/domain/authority.ts` run-record
types (existence union and refusal union); `src/domain/run/record.ts` (the actual strict persisted
`RunRecordSchema` owner, including the fields D330 requires such as `cancelRequested`; source-owner
path corrected during C858cc3dc R02 verification, 2026-09-04, without a contract change);
`src/domain/commands.ts` and `src/infra/sqlite/storage-records.ts` only for D333's strict internal
lifecycle-journal record arm and table-schema union (operator-approved during S2; product commands,
the command kernel and DDL remain unchanged);
`src/infra/sqlite/migrations.ts` for ONE additive `v31` migration only (rebuild the
`archive_relaunches` source relation so deleting an archived source preserves a live descendant's
lineage, while the row remains owned/deletable only by its NEW run, exactly §D330.9); the generated
`src/domain/workflow/generated-build-manifest.ts`; `tests/unit/run-record-service/`.
**Does not touch:** any migration except the admitted `v31`, any composition root, the command kernel,
the queue-root builder, the worker loop,
`src/domain/config/**`, `src/infra/config/**`, `secrets.ts`, the settings runtime (2-2's). **Owes:**
§D330.11 #1–#23, #25, #26 over the real service and a temporary database (never a hand-inserted `tasks`
row, §D330.10); §D331.11 P33's claim half (an absent token refuses, never skips); the table-class
coverage rows extended to every service method (§D330.10); A6 read-forward proven by #25 over
NULL-ordinal rows; direct fresh-v31 and v30→v31 proofs that an archived-source delete preserves the
live descendant's relaunch row and deletion of the NEW run removes it only behind that run's tombstone.
**Gate:** base + those proofs. **Deletion tests:** #16 (every `*_never_deleted`
trigger enumerated at test time — 17 as-built plus the floor's) and #25 (the watermark reads
tombstones; drop the tombstone columns and it is red). **Order:** wave 2, peer 1.

- [x] The service and repository API for the closed operation set with named refusals, three-way
  `read`, ordered `list` and CAS on `version` alone (§D330.2, §D330.4, §D330.5, §D330.6).
- [x] The invariants: one-transaction first-eligible claim with the full token, claim fence vs.
  operator CAS, composite terminalize, retry/restart/relaunch lineages, archive-if-identical, D308 tree
  delete behind the tombstone with gate records and the two-source watermark (§D330.1, §D330.6–§D330.9).
- [x] §D330.11 #1–#23, #25, #26 and P33's claim half, red-capable against the displaced writers; the
  coverage rows for every service method.

#### Approved focused-session plan (2026-09-04)

**Approval and correction.** The operator approved the proposed Task-2-1 plan by requesting its
supervisor prompt, then explicitly chose option A on 2026-09-04 when the feasibility check exposed the
schema conflict: this task owns one additive `v31` migration. The rejected alternatives were a new
serial prerequisite or weakening D330's retained-lineage rule. No other DDL or contract change is
admitted.

**Outcome and exclusions.** One supervisor implements D330's canonical run-record service, its closed
operation/refusal boundary and Task-2-1 proof matrix. The adapter remains the sole SQL owner. The
service accepts an injected post-commit queue-root publisher and proves authority commits before
evidence; it does not import or edit the server builder. Tasks 3/4 retain production caller cutover and
guard activation, so their staged direct callers may compile but no new bypass is added. Task 4 retains
proof #24 and Task 4/3 own full cancellation proof #27. Settings, composition, product commands/the
command kernel, workers, live state and UI remain outside this task. The narrow D333 lifecycle-journal
schemas and table-schema union named in the seam are the sole exception.

**Verified prerequisites.** Task 1's proof merge `5b1fb626` is an ancestor of the current integration
line. The previous R02 launch stopped during intake and produced no candidate; its worktree/branch are
absent. Before either wave peer starts, use the exact `master` commit containing both approved focused
plans as the common base; verify Task 1 ancestry, clean owned paths, worktree capacity, and the absence
of both planned path and branch. Full baseline gates passed at pre-plan `c77d2b76`: 411 files / 5,040
tests, manifest current, and 269 assertion-only parity tests with unchanged references.

**Implementation sequence.** Stable supervisor steps:

1. **S1 — admit the exact base and seam.** Verify the common wave base, Task 1 floor, linked D330/D331
   contracts, current repository/request schemas, proof ledger, exact owned paths and exclusions.
2. **S2 — establish the closed service boundary.** Add strict operation, existence and named-refusal
   types; extend the persisted run record for D330 fields; require the full runtime token; keep later
   production-caller cutover compiling without claiming §D330.10's final guard.
3. **S3 — implement atomic authority behavior.** Extend the adapter/service for create, claim/renew,
   worker/operator transitions, composite terminalize, requeue, retry/restart/relaunch, archive,
   total read/list and D308 tree delete. Preserve attempt on requeue; use task+tombstone watermarks;
   validate parent/retry sources, eligibility, dependencies and disposition; publish the queue root only
   after commit through the injected dependency.
4. **S4 — preserve relaunch lineage through schema and cascade.** Add only `v31`; make
   `archive_relaunches` owned by the NEW run so an archived-source deletion retains its row and a NEW-run
   deletion removes it behind that run's tombstone. Prove fresh and v30 upgrade shapes and fail-loud
   integrity. Do not fold Task 6's stopped-system upgrade command into this migration.
5. **S5 — discharge the proof matrix.** Use the real service over temporary databases for D330.11
   #1–#23, #25, #26, P33's claim half, every-service-method table-class coverage, A6 NULL-ordinal
   read-forward and the red controls for #16/#25. Fixtures create lifecycle state through the service,
   never hand-insert `tasks` rows.
6. **S6 — freeze the candidate.** Regenerate the build manifest, run focused and full gates, inspect
   exclusions, commit exact owned paths by logical category, then record the immutable candidate range,
   gate evidence and `awaiting independent review`. Stop; do not merge, push or mark the task complete.

**Acceptance and gates.** Every caller-known refusal returns a closed result rather than throwing; each
mutation is one authority transaction and advances authority generation exactly once; read/list are
total and ordered; claim, lineages, archive/delete, ordinals and evidence ordering match D330. Use real
temporary SQLite authorities and map every assigned proof name to its intended-red oracle. Run focused
run-record, migration, storage and table-class suites, then:

```text
npm run build:manifest
npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check
npm run test:architecture
npm run test:parity
```

Parity must pass unchanged. Any test run is paired with lint. A needed contract change returns to a
newly numbered 0.3 task; a behavior-changing conflict fix requires a renewed independent review.

**Supervisor sizing and wave assignment.** One supervisor fits: service API, adapter transactions, the
single coupled lineage migration and proof family require continuous lifecycle judgment. Splitting them
would create overlapping ownership in `authority-database.ts`, schemas and tests. Task 2-2 is an
independent peer. The peers use separate worktrees and serialize full coverage, architecture, parity,
roadmap generation and integration. Generated-manifest conflicts are resolved only by regeneration from
the combined tree, never by hand-editing generated output.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.2-1` | `codex/phase-1-6-run-record` | `/Users/julianhein/Projects/hr-worktree-run-record` | Verified common `master` SHA containing Task 1 and both approved wave plans; record it before either peer starts | Task-2-1 seam above, only additive `v31`, temporary SQLite roots and injected test publishers; no real runtime/live state | Assigned proof matrix; focused migration/run/storage suites; full gate, architecture and unchanged parity | Freeze the independently reviewed candidate. The 2-1 supervisor merges it first with `--no-ff` to `master`, runs integration gates, removes this worktree/local branch, records review/merge/gate/cleanup evidence, and marks only Task 2-1 complete. Task 2-2 then integrates; its supervisor regenerates the combined manifest and runs its own merge gates. |

**Task 2-1 completed (2026-09-04).** The independently accepted immutable implementation candidate is
`bc82fe47e9ee51e3ec46b15eb51367a124c463bb`, range
`aaffe367084c95e06606a3b42cb058b541acd1a8..bc82fe47e9ee51e3ec46b15eb51367a124c463bb`,
on `codex/phase-1-6-run-record` in `/Users/julianhein/Projects/hr-worktree-run-record`. The exact base
remained reachable from `master` and contained Task 1 merge `5b1fb626` plus both approved wave plans;
the primary checkout was not used. The implementation commits are `c291dc30` (canonical service and
D333 journal arm), `423c3a7a` (the sole additive v31 migration), `0146a2a6` (proof matrix),
`a060b4f8` (first-review corrections), `52942ebd` (parked-write continuation correction), and
`bc82fe47` (fail-loud gate-resume metadata correction).

| Candidate evidence | Result |
|---|---|
| Initial independent `/review` by `/root/sup_analyst_run_record_review` at `0146a2a6` | CHANGES REQUIRED — parked-gate continuation was lost; terminalization missed active descendants; distinct terminal self-edge/rename remained mutable |
| Red-capable corrections | PASS — each finding reproduced before correction; parked continuation, direct/nested tree settlement and terminal self-edge/rename now have five public-service regressions |
| Renewed independent `/review` by the same reviewer at `a060b4f8` | CHANGES REQUIRED — canonical `parked-write → queued` could not carry its mandatory continuation node; the three prior findings remained resolved |
| Parked-write correction | PASS — both write-resolution arms and the no-continuation mutant failed before correction; canonical CAS-fenced resume now requires and persists `startAt`; direct Task-3 callers remain untouched |
| Renewed independent `/review` by the same reviewer at `52942ebd` | CHANGES REQUIRED — gate resume accepted queued metadata that its adapter then discarded; every prior finding remained resolved |
| Gate-resume correction | PASS — the lossy request failed before correction; gate resolution now returns named `illegal-transition` without writing when queued metadata is present |
| Final independent `/review` by `/root/sup_analyst_run_record_review` at `bc82fe47` | PASS — high confidence; all prior findings resolved; no new correctness, concurrency, security, documentation or scope finding |
| Focused run-record service | PASS — 40 tests; typecheck and lint green |
| `npm run build:manifest` | PASS — regenerated byte-identically |
| `npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check` | PASS — 5,082 tests; 85.48% statements, 76.31% branches, 89.53% functions, 87.55% lines; manifest current. An earlier unrelated 16-process storage-lock timing assertion failed once, passed focused, and passed in both later complete reruns |
| `npm run test:architecture` | PASS — 73 files / 745 tests |
| `npm run test:parity` | PASS — 269 tests; assertion-only references unchanged |
| Scope/exclusions | PASS — only the recorded Task-2-1 seam, D333 exception and one v31 migration changed; no Tasks 3–4, settings, live state or push |
| Integration | PASS — candidate evidence commit `bb98dabc` merged `--no-ff` to `master` as `49120609`; the merge parents are prior `master` `94d70886` and accepted candidate `bb98dabc` |
| Integration gates | PASS — manifest regenerated byte-identically; typecheck and lint green; 5,082 coverage tests at 85.48% statements, 76.31% branches, 89.53% functions and 87.55% lines; manifest check green; architecture 73 files / 745 tests; unchanged parity 269 tests |
| Cleanup and preservation | PASS — `codex/phase-1-6-run-record`, `/Users/julianhein/Projects/hr-worktree-run-record` and the temporary integration worktree were removed; the dirty primary checkout retained its exact pre-integration status and unstaged/staged content hashes; no push; Task 2-2 remains unintegrated |

Status is `complete`. Fresh independent review accepted the final behavior-changing correction before
integration; the required merge, integration gates and cleanup are complete. Task 2-2 integrates afterward.

### Task 2-2 · Implement the settings catalog and protected root
<!-- roadmap: p1f-settings-store -->

**Seam:** NEW `src/domain/config/catalog.ts` (the closed 88-row registry, §D331.1/§D331.9);
`src/domain/config/{schema,resolve,provenance,settings,snapshot,snapshot-generations,runtime-generation}.ts`
(A4 deleted: `CONFIG_ENV_BINDINGS`, the env application and the `"env"` provenance arm gone, `resolveConfig`
deleted with its thirteen importers, `settings > default`; `operator.timekeeperName` leaves `ConfigSchema`
under generation 5's retirement arm); `src/infra/config/settings-file.ts` (the `settings/` root: two
documents, one lock, prepare/rollback per target, the private-file protocol, the D321 coupling per
document); `src/server/settings-runtime.ts`, `src/server/settings/**`, the existing
`src/server/dashboard/commands/settings-service.ts` adapter, `src/domain/dashboard/bootstrap.ts` +
`src/server/dashboard/queries/bootstrap.ts` solely for P14's schema hashes (source-owner paths
corrected during C858cc3dc R03 verification, 2026-09-04), the kernel's
`apply-protected-settings` arm (§D331.5's two CAS arms, marked envelope, `{present, valueId, updatedAt}`
readback); `src/domain/secrets.ts` (A5 deleted: migrated names read from the protected store only, the
`config-and-secret` dual channel gone, `providerModelChain`'s `legacyModelEnv` fallback gone,
`optionalTestTargetSecret` from the store); `src/domain/runtime-environment.ts` +
`scripts/secure-env-bootstrap.ts` (`RETIRED_ENVIRONMENT_KEYS` refused by name; the `.env` allowlist is the
five provider families); `src/domain/runtime-dependencies.ts`; `src/infra/sqlite/backup-service.ts` +
`recovery-contracts.ts` for the `manifestVersion` 2 WRITE shape only (the two ordinary documents plus
protected presence metadata, P15 — the READ widening is Task 6's); the nine `resolveConfigWithProvenance`
call sites, minimally (the `env` argument drops); `tests/unit/architecture/settings-catalog.test.ts` with
its `active` inventory entry and the `config-snapshot-generations` entry's invariant text extended for the
`retired-leaves-are-a-closed-list` arm (same commit as P38); P39's sixteen deliberately edited files;
`src/dashboard/surfaces/settings-model.ts`, `src/dashboard/surfaces/settings.tsx` and their focused tests
only for the D331.5 request-shape transition below. **Does not touch:** `migrations.ts`,
`authority-database.ts` (Task 1 landed the singleton), the run-record service, the worker loop, or the
Settings SURFACE beyond the approved producer-only exception: translate the existing draft to D331.5's
leaf operations and remove the impossible `env` provenance branch, with no DOM, copy, style, served
inventory or parity-reference change. The full Settings/Setup interface remains 3.1; the settings-editor
query keeps serving DCC3's eight-leaf inventory derived from the catalog until then (A8). **Owes:**
§D331.11 P1–P15, P17–P19, P21–P32, P33's protected half, P34–P39,
P41; §D332.11 M14's schema half (generation 5 registered; a pre-floor snapshot with the leaf parses).
**Gate:** base + those proofs + `npm run test:parity` green UNCHANGED. **Deletion tests:** P3/P4 (A4 —
compile-time red at every caller, runtime red under a hostile `process.env`), P34 plus the
`secrets-single-source` WRITE arm (A5), P38's negative control (A7's arm `retired-leaves-are-a-closed-list`
on the existing `config-snapshot-generations` entry). **Order:** wave 2, peer 2.

- [ ] The catalog, the `.tracker/settings/` root with two documents and one lock, the two CAS arms,
  write-only protected values with presence/revision readback (§D331.1–§D331.6; P1, P2, P5–P12, P21–P32).
- [ ] The environment leaves the resolver and the accessors in THIS task — A4 and A5 are deleted with the
  catalog, not carried; every migrated key is `RETIRED_ENVIRONMENT_KEYS`; provider API keys alone stay in
  `.env` (§D331.8; P3, P4, P34, P35).
- [ ] Host-derived display as the catalogued default (P36), credentials and canary references in the
  store (P32), permissions/symlink/redaction/restart-scope/concurrent-update proofs (P13–P15, P17–P19,
  P22–P25, P33 protected half, P37), generation 5's retirement (P38), P39's deliberate edits, P41.

#### Approved focused-session plan (2026-09-04)

**Outcome and exclusions.** One supervisor implements the complete D331 settings authority and the
Task-2-2 portions of D332 without redesign: the 88-row catalog; catalog-derived ordinary schema;
environment-free resolver; generation-5 retirement; the two-document `.tracker/settings/` repository;
ordinary/protected CAS commands and presence-only readback; A4/A5 retirement; provider-only `.env`;
backup-manifest-v2 write/verification; and D183 dispositions for every new served leaf. The narrow `/ui`
Operate-mode exception above keeps the existing eight-leaf page functional while the wire changes. It
does not implement 3.1's expanded Settings interface. Task 5 still owns full composition/runtime
consumer cutover; Task 6 owns pre-floor upgrade/read widening; no real `.env`, `.tracker`, browser or live
system is touched.

**Verified prerequisites.** Task 1's schema-floor proof merge `5b1fb626` is an ancestor of the current
integration line; `d2fe05dd` was the prior common wave baseline, and runtime source has not changed since
that baseline. Snapshot `02942b40` is incomplete historical implementation evidence only: inspect and
reuse reviewed current-contract hunks, never cherry-pick it wholesale or import its deleted coordinator
artifacts. Before either wave peer starts, integrate the approved 2-1 and 2-2 plans on `master`, record
that exact common SHA, and recheck the worktree path, branch and four-worktree repository budget.

**Implementation sequence.** The supervisor keeps the cross-layer judgment and performs these steps in
order:

1. Verify the common wave base, Task 1 floor/singleton, exact owned paths, proof ledger and snapshot
   limits. Establish synthetic private roots only.
2. Land the catalog, generated ordinary schema, host-display fact input, settings-over-default resolver,
   and generation-5 retirement. Remove the resolver's environment parameter and adapt every compiler-
   discovered caller in the same change.
3. Land the protected schemas and shared settings root: two documents, one lock/reaper, per-target
   prepare/rollback, private-file admission, independent revisions, D321 journal coupling and both CAS
   arms. Add the marked protected command, presence-only readback and schema hashes.
4. Move migrated credentials, canaries, model chains and other operator-managed leaves to their single
   catalogued authorities. Refuse every migrated environment name before value access and retain only
   the five provider-key families in `.env`.
5. Add manifest-v2 write and current-v2 verification for the two ordinary files plus protected presence
   metadata. Preserve manifest-v1 and pre-floor compatibility for Task 6's bounded read widening. Add
   every required D183 disposition.
6. Apply the producer-only UI adaptation with no rendered/reference change. Complete the assigned proof
   and intended-red matrix, regenerate the build manifest, run the gates, commit the exact candidate and
   record `awaiting independent review` without marking the task complete.

**Acceptance.** Map §D331.11 P1–P15, P17–P19, P21–P32, P33's protected half, P34–P39 and P41, plus
§D332.11 M14's schema half, to a real test and intended-red oracle. P16/P20 remain Task 5; P40 remains
3.1; Task 6 retains full upgrade and pre-floor manifest reading. Run the focused settings/config,
command, bootstrap, backup, redaction, activity-export, diagnostic, worker/dry-run and snapshot tests,
then:

```text
npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check
npm run test:architecture
npm run test:parity
```

Parity must pass unchanged. Any needed contract change returns to a newly numbered 0.3 task. Any test
run is paired with lint, and generated descriptor closure changes use `npm run build:manifest` before
the check.

**Supervisor sizing and wave assignment.** One supervisor fits because the catalog, file authority,
command schemas and proof matrix form one coupled authority seam; a second supervisor would overlap the
central schemas, settings repository and acceptance tests. Task 2-1 remains an independently planned
peer, not part of this assignment. File isolation does not isolate fixed ports or test artifacts, so the
two peers serialize full coverage, architecture and parity runs.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.2-2` | `codex/phase-1-6-settings` | `/Users/julianhein/Projects/hr-worktree-settings` | Verified common `master` SHA containing Task 1 and both approved wave plans; record it before either peer starts | Task-2-2 seam above; synthetic settings roots only; no real runtime or live state | Assigned proof matrix; focused suites; full gate, architecture and unchanged parity | Freeze the independently reviewed candidate. Task 2-1 receives PASS and merges first. The 2-2 supervisor then merges `--no-ff` to `master`; behavior-changing conflict fixes require renewed review. Run integration gates, remove this worktree and local branch, record review/merge/gate/cleanup evidence, then mark only Task 2-2 complete. |

#### Revised implementation candidate awaiting renewed independent review (2026-09-05)

Task 2-2 is implemented on `codex/phase-1-6-settings` at revised immutable implementation candidate
`595647fb`. The first fresh independent review returned `CHANGES REQUIRED`; all six findings now have
regression proofs and fixes. The task remains incomplete and unmerged pending renewed independent
acceptance, integration gates and cleanup.

| Evidence | Result |
|---|---|
| Plan and common base | PASS — approved Task-2-2 plan `0d2520f7`; common wave base `aaffe367`, containing Task 1 and both approved wave plans |
| Required peer order | PASS — accepted Task 2-1 completed on `master` at `a5afdb07`; merged into this branch as `57ad0653` before the combined gates |
| Initial candidate commits | `8c9cedd7`, `2945cfea`, `e874505c`, `87118792`, `fa93a623`, `2cd0029f`, `a3305537`, `4fe9c24d`, `4016e2af`, `15bb3c2b`, `01385201`, `f944a2ab`, `fd5f860c`, `d3ac830c`, `e1d9f008`, `8f8777e4` |
| First independent review | `CHANGES REQUIRED` — fresh read-only reviewer `/root/sup_review_settings_2_2` (`sup_review`) reviewed plan `0d2520f7`, base `aaffe367`, Task-2-1 merge `57ad0653`, implementation `8f8777e4` and evidence `5a48faf6` |
| Finding dispositions | `f8ea3551` authenticates protected authority before mutation; `1b877014` returns the assigned value-free settings ingress refusals; `866cbf1f` makes the settings-consumer guard bidirectional; `595647fb` binds backup files to one authenticated SQLite snapshot, materializes both revision-1 files, validates patch leaves and maps merged cross-field failures |
| Revised candidate commits | `f8ea3551`, `1b877014`, `866cbf1f`, `595647fb`; revised implementation head `595647fb` |
| Authorized ownership amendment | Operator selected option A: Task 2-2 may add the transaction-safe, read-only historical protected-command `writeId` lookup in `src/infra/sqlite/authority-database.ts`. `d3ac830c` supplies it, strict request validation, restart/non-adjacent reuse proof and production dashboard composition; no other Task-1/Task-2-1 ownership moved. |
| Full revised gate | PASS — typecheck; lint; coverage 5,173 tests, 85.51% statements / 76.53% branches / 89.70% functions / 87.58% lines; build-manifest check |
| Supplemental gates | PASS — architecture 74 files / 754 tests; parity 269/269 |
| Focused revised proof | PASS — combined settings, backup, config, command, ingress, catalog, composition and recovery suites: 10 files / 503 tests; exact lint, typecheck and `git diff --check` clean |
| Parity provenance | The combined manifest changed descriptor and implementation fingerprints. `8f8777e4` refreshes only the resulting hash/provenance fields and hash pixels: 210 accessibility references, 210 metadata references and 31 PNGs. Audit found no DOM, copy, control, layout or style change. |
| Isolation | PASS — synthetic empty ignored mode-0600 `.env`; no real `.env`, `.tracker`, live state, browser transaction, submit or push touched |
| Review state | `awaiting renewed independent review`; first review findings are fixed, but no acceptance is claimed and the task remains unchecked/unmerged |

### Task 3 · Cut over executor and worker lifecycle writers
<!-- roadmap: p1f-run-writers -->

**Seam:** `src/core/worker-loop.ts`, `src/core/worker-sessions.ts` and `src/server/worker/compose.ts`
(claim, heartbeat, worker transitions, terminalize and the recovery sweep's `requeue` through the
service; the worker holds no repository mutator); the executor / write-sequencer terminal path
(`terminalize` through the worker under the claim fence; the 2026-08-25 fenced-write lesson and
`retainAfterFence()` unchanged; `span.ended` after commit); the start/fan-out publication — `create`
then the write-once `run.queued` root through the shared queue-root builder — in
`src/server/dry-run-scenario/runtime.ts` and the dashboard start/intake fan-out services;
`tests/unit/worker-composition.test.ts`, `tests/unit/dry-run-scenario-composition.test.ts`. **Does not
touch:** the command kernel's operator verbs (Task 4), config consumers (Task 5), any schema. **Owes:**
§D330.11 #4–#7, #9, #10 re-run THROUGH the real worker composition (the service proved them; this proves
the wiring); the existing worker/dry-run suites re-pointed with identities byte-identical. **Gate:** base +
those. **Deletion test:** `worker-loop-writes-only-through-the-service` — a spy adapter whose lifecycle
mutators the loop must never call directly; red while any direct call survives. **Order:** third, after
the wave merges.

- [ ] Route start/fan-out publication, claim, heartbeat, executor transitions, retry scheduling and
  terminal publication through the run service without changing stable run/session/evidence identity.
- [ ] Guard or remove direct core-runtime lifecycle writes outside the service: the loop and the sweep
  hold no mutator; `span.ended` only after the terminal commit (§D330.4, §D330.9).

### Task 4 · Cut over operator run commands and archive/delete writers
<!-- roadmap: p1f-run-commands -->

**Seam:** `src/core/command-kernel.ts` (the run family and the version-archive family through the
service: start, retry, restart, cancel, bump, rename, archive, relaunch, `delete` / `delete-archived-run`
with the D308 member tree, bulk as N children, purge as evidence retention; the typed settlement
vocabulary with the one new code `target-deleted`, §D330.5's wire mapping),
`src/server/dashboard/commands/command-service.ts`, the `cli` run verbs, `tests/unit/command-kernel.test.ts`;
`tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts` lands HERE with its entry flipped
`planned → active` in the commit that removes the last direct mutator import, carrying the
`runs-view-has-no-reader` arm and its stub-throws negative control (ref guards-and-tests §5.2 A3). **Does
not touch:** `deriveRunStatus` and its two callers (A2, 2.6), the projector's `runs_view` writes (A3, 2.6),
any schema. **Owes:** §D330.11 #24; the kernel suites re-pointed; every command's idempotence, stale CAS
and worker-race arms through the real kernel. **Gate:** base + `npm run test:architecture` with the guard
active. **Deletion test:** the guard itself (#24) — red on any lifecycle SQL or mutator import outside
the two-module literal allowlist. **Order:** fourth. **Cancel of a claimed run:** the coordinator ruled
option A on 2026-09-04 and it is landed in §D330.5 (the request arm), §D330.3 (self-edge and tree sentence),
§D330.11 #27 and the `cancelling` served status — an operator `cancel` on a `claimed`/`validating`/`running`
row sets `cancelRequested` under CAS and the worker settles `terminal/cancelled` at its next non-fenced
boundary; this task implements exactly that arm and owes #27.

- [ ] Route CLI/dashboard start, retry, cancel, rename, archive, relaunch, D308 terminal-only
  delete/tombstone, bulk and purge commands through the run service; one typed settlement/conflict
  vocabulary with actor/version attribution (§D330.5, §D330.8, D233, D235, D308).
- [ ] Prove typed settlements, idempotence, stale CAS, worker races and relaunch lineage through the
  real kernel; activate `no-lifecycle-sql-outside-the-adapter` (#24) in the same commit.

### Task 5 · Cut over settings mutation and runtime resolution
<!-- roadmap: p1f-settings-consumers -->

**Seam:** `src/server/dashboard/compose.ts`, `src/server/worker/compose.ts`,
`src/server/dry-run-scenario/runtime.ts` (every composition reads the catalog + protected store; boot
activation from the ordinary document; the `restartRequired` / `runtimeStatus` reporting);
`src/server/dashboard/worker-supervisor.ts` (a value-free spawn environment, P20); the browser/login
credential accessors under `src/infra/browser/**` (`next-use`: read the store at each use, nothing cached);
workflow defaults; `src/domain/preflight.ts` + `src/server/preflight/**` (settings inputs by name, P16); the
settings-editor query keeps the eight-leaf inventory (A8). **Does not touch:** schema, the run service,
the kernel's run verbs, the Settings surface. **Owes:** §D331.11 P16, P20, P33's composition half, P4 at
composition level. **Gate:** base + `npm run test:parity` UNCHANGED + those. **Deletion test:**
`composition-reads-no-environment-leaf` — boot each composition root under a hostile `process.env`
populated for every retired key and assert byte-identical `Config`, zero accessor reads and a refusal by
key name; red while any composition still reads the environment. **Order:** fifth.

- [ ] Route secure bootstrap, workers, browser/login, workflow defaults and preflight inputs through the
  catalog and the protected store; leave Settings UI behaviour to 3.1 (§D331.7, §D331.8, §D331.10).
- [ ] Revision/CAS updates, validation, restart-required reporting and protected write-only input reach
  every composition; every setting resolves from exactly one catalog leaf and one persisted authority.

### Task 6 · Prove upgrade, rollback, recovery, and compatibility deletion
<!-- roadmap: p1f-migration-proof -->

**Seam:** `src/cli.ts` (`storage upgrade [--plan] [--json]`, the fourth `storage` subcommand); NEW
`src/infra/compat/pre-floor-upgrade-readers.ts` (A0: frozen pre-floor copies of
`SettingsFileRecordSchema`, `EditableSettingsOverrideSchema` and the pre-floor `SETTINGS_SCHEMA_HASH`
literal, the widened `.env` admission as a parameter of the command, the tombstone backfill, the
orphan-gate sweep) and `old-pathname-reconciler.ts` (A1); the upgrade module (the 15-step preflight,
`upgrades/<id>.prepare.json` / `.rollback.json` under the private-file protocol, the ONE exclusive
transaction with the two journaled commands, settle, the §D332.5 arms); the boot matrix completed in the
open/interlock (`upgrade-unsettled`, `mixed-generation`, `authority-deleted { settings/ }`); the backup
READ-path widening — three schemas, the inspector, `manifestVersion` 1 and 2 — plus the observed-version
WRITE in `recovery-contracts.ts` / `backup-service.ts`, and `offline-restore.ts`'s rollback pairing
(`rollback-evidence-missing`, `protected-entries-written` against the journal's `protectedRevisionAfter`);
the doctor lines (`authority_upgrades` by basename, `tombstone-ordinal-unknown`, `possibleExternalWrite`);
the DCC2 preflight's `storage-authority` check with its six literals (§D332.6 wire mapping);
`guard-inventory.json`: `authority-upgrade-adapters-isolated` (`active`), `authority-upgrade-adapters-retired`
and `settings-root-single-pathname` (`planned`, 2.6). Then the command is RUN on the operator's real root after an explicit `cli storage backup`, and
the plan's remove-list is announced: the first post-upgrade boot refuses `migrated-refused { key }` until
those `.env` lines are gone (§D332.S5). **Owes:** §D332.11 M1–M27 (M3, M9, M21, M14 re-run here over the
real command), §D332.S1–S6's import rules, the A0/A1 rows of ref guards-and-tests §5.2. **Gate:** base +
M1–M27 + `npm run cli -- storage upgrade --plan` and the full upgrade over a v29 fixture COPY + `npm run
cli -- storage doctor` green + `npm run test:architecture` with the three new entries. **Deletion tests:**
`authority-upgrade-adapters-isolated` (red while A0/A1 are reachable from any composition root); nothing is
DELETED in this task — A4/A5 left in 2-2, A0–A3 expire at 2.6 (A0/A1 in 2.6 Task 2, A2/A3 in 2.6 Task 1-3),
A6/A7 are permanent read-forward, A8 expires at 3.1 Task 9-2. **Order:** sixth.

- [ ] Require an explicit verified `cli storage backup`, then run the idempotent transactional migration
  with journal, rollback, mixed-generation refusal and representative evidence checks (§D332.1–§D332.8;
  M1–M27).
- [ ] Import non-provider-key local configuration once, refuse ambiguous duplicates, never read a
  provider value (§D332.S1–S6; M6, M15, M20, M24); land A0/A1 with their `active`/`planned` entries and
  delete nothing — every remaining adapter's deletion task is named above.

### Task 7 · Close the rebuilt foundation
<!-- roadmap: p1f-close -->

**Seam:** no product code beyond fixes the gates demand; `docs/rebuild/01` §1.6 (this section's
`log:`/status), the roadmap nodes, ref lessons, the 2.6 handoff. **Gate:** base + `npm run test:parity`
+ `npm run stores:catalog:check` + `npm run test:architecture` + `npm run cli -- storage doctor` on the
upgraded operator root + both workflows' T1b live manifests (`dry-run-scenario person-lookup` `live-read`,
`dry-run-scenario separations` `dry-run-preview`, exact zero write-authority deltas) + one adversarial
review that finds no second run/settings lifecycle authority, no secret value on any sink and the
`no-lifecycle-sql` negative control intact. **Hands 2.6:** the migrated fixture pair (a v29→floor copy and
a fresh root); A0/A1 → 2.6 Task 2, A2 with `run-status-fold-contributes-no-lifecycle-arm` landing in the
deletion commit → 2.6 Task 1-3, A3's table removal → 2.6 Task 1-3, A8/P40 → 3.1 Task 9-2; the D183
disposition table; the operator-visible `migrated-refused` note; the `checkpoint_payloads` single-writer
fact §D330.11 #22 / M23 guard; any residual as a named defect, never absorbed.

- [ ] Pass targeted, full, generated, storage, live-dry-run and adversarial authority gates.
- [ ] Record the migration in this section's `log:` and hand 2.6 only verified contracts, fixtures,
  residuals and exact commands.

## Integration amendment — Phase 1's share

`reference/frontend-backend-integration.md` is the owning companion for the composition boundary
between the approved frontend and the backend contracts in `reference/`
(workflow-model · dashboard-surfaces · data-intake-and-edit-data · write-safety ·
clock-config-secrets · operator-trust). It introduces no second sequence: the rows below AMEND the
work items above, and they are recorded here because a reader auditing Phase 1 needs to know which
integration obligations rode on which item.

**"Four parity surfaces" means the exact Person Lookup capability slice inside the approved full
shell**, not four approximate legacy components. It includes the typed Start Run surface, the
day/count/navigation shell, the Context rail, the Receipt placeholder, and the live/reconnecting
Session Panel states needed to operate that workflow.

| Item | Integration addition | Exit evidence — as built |
|---|---|---|
| **1b** | strict bootstrap / day / detail / subscription / artifact primitives, schema versions, revisions, projection cursors and explicit absence/error unions | every boundary schema parses fixtures and rejects unknown/invalid combinations (`strict-boundary-schemas`); the closed unions 1b froze are still the served ones |
| **1c** | durable command type shells for start, intake, worker/browser, atomic settings and version/archive targets beside the run/gate/notification/capture arms; D95 reserves run `bump` for priority, names the version actions `plan-version-bump`/`apply-version-bump`, and adds a strict run `rename` | every product mutation has ONE idempotent actor-stamped command family before a route can exist — nine families, and no discriminant would have meant losing either priority or version work |
| **1e** | one complete client descriptor projection: start methods, dry-run/instance absence reasons, panel kind and sections, actions, graph summary and capability availability | no workflow / start / panel registry exists outside the descriptor projection. **One standing exception, named:** the run modal still reads `WORKFLOW_DESCRIPTORS` from the bundle — Track D row **D11**, amending D251 |
| **1g-spine** | the in-process typed BFF; bootstrap / day / run-detail queries; one transport client; resumable cursor-based SSE; the Phase-1 start and run command routes | a snapshot plus any valid patch sequence equals a fresh snapshot; gaps or schema/revision changes reset visibly. **As built the stream carries one producer** — `dashboard-day`; the other five topics are declared and unserved (`ref:frontend-backend-integration` §3.5) |
| **1i-spine** | port the approved tokens and primitives and the exact Person Lookup shell composition; wire Start, Queue, Detail/Context/Receipt, counts and the Session Panel end to end | live Person Lookup plus both-theme Playwright a11y and screenshot parity at the reference viewports — with the correction that until D187 the `paper-ink` half of that corpus was photographed dark (§1i-spine above) |

## Decisions this phase ratified

_Indexed from `reference/decisions.md`'s round headings and their `_phase: 1_` markers. The
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 13 | 2026-07-31 | D95 | the command-family ambiguity closure (1c's type shell) |
| 14 | 2026-08-01 | D96–D101 | 1d's session / artifact / provider seams — one `SessionNeed`, separate artifact and content identity, provider scope stopping at the seam, conjunctive verification, imported semantic ids |
| 15–16 | 2026-08-01 | D102–D107 | 1e's descriptor closure — forward-referencing branch cases, the bundle-safe descriptor closure, `pending-impl-bindings` |
| 17 | 2026-08-02 | D108 | the person-lookup CRM read stays source-semantic and EID-bound |
| 18 | 2026-08-02 | D109–D118 | **1f's runtime/authority closure**: atomic start plans (D109), the minimal durable failure record (D110), beat ⑦ as one transaction (D111), the generic provider-admission core (D112), the exhaustive command kernel (D113), factory-derived terminal results (D114), the required provenance collector (D115), config-keyed session reuse (D116/D117), recovery-before-requeue (D118) |
| 19–20 | 2026-08-03 | D119–D120 | provider budget windows; **a login is proven by CONTENT, never a URL** (D120) |
| 21 | 2026-08-04 | D121 | browser-bundle purity — no module the dashboard entry can value-reach may statically import a Node built-in, and a runtime-only config leaf is required in the shared schema and supplied by the server resolver |
| 23 | 2026-08-04 | D123–D125 | the live exit run's defects — `skipped` is its own state (D123), a terminal row's duration is served not computed (D124), and session acquisition gets its own bound (D125) |
| 24 | 2026-08-04 | D126 | the accessible name is its own channel |

Round 22 (D122, the Phase-2 Kuali transaction proof) and rounds 25 onward carry `_phase: 2_` or
later and are indexed by `02-prove-writes-build-the-tails.md`.

## Exit criteria

**ALL MET 2026-08-04.** Each criterion below carries its evidence; where a later phase found the
criterion was met more narrowly than it read, the correction is stated inline rather than left for
a reader to discover.

### THE exit test — person-lookup runs LIVE on the spine (D74). MET 2026-08-04

A submit-free live run against real UCPath + CRM (Duo cleared hands-off by Autopilot,
`reference/charter.md` §9) produced a correct person-lookup result on the new executor, and every
projected surface rendered from the descriptor via the single 1g-spine projection — verified
headless with the `playwright-cli` seed→boot→assert loop. **This criterion is not satisfiable by
fixtures; that is the point of moving it here.** Its `descriptor-coverage` guard is green, and the
speed criterion — which budgets **fixed sleep time** (`ref:execution-and-sessions` §5) — is met at
**zero**, with wall clock recorded beside it as an observation and not as a threshold.

**The run.** `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, workflow
`person-lookup`, input EID `10873698`, terminal `done` **at attempt 2**. Node walk: `searching` done
(22.5 s) → `cross-verify` **cancelled** (262.9 s — the CRM browser died) → run re-attempt →
`cross-verify` done (12.8 s) → `active-status` done → `crm-dates` **skipped**
(`condition-false`).

**The result is correct, not merely schema-valid.** `activeStatus.state = "active"`, `hdh = true`,
reason *"UCPath reports active and CRM record a1ZVr000004Xoq9MAC matches…"*;
`crmDates.state = "not-requested"`. The terminal dependencies record `active-status` resolved with
full output and provenance fingerprints, and `crm-dates` as `state: not-run, reason:
condition-false` — a closed reason for a conditional node, exactly as D114 requires, never a silent
omission.

**Mid-run recovery worked unprompted.** The poisoned CRM session was closed, reopened, and the node
re-ran under attempt 2 with no operator action. That is 1f's worker-owned browser lifecycle and
D118's recovery-before-requeue behaving as designed against a real failure rather than a fixture.

**The four parity surfaces, all from the ONE projection** (BFF 3938, frontend 5174), verified
headless against this run: the Queue row (*"EID 10873698 — done"*, trace `pl-000619-4ebf`, attempt
2); the Workflow Panel count (1); the Session Panel (*"0 working 1 idle"*, status Live, v0.1.0); and
the Log Panel run-detail timeline showing all five events **including both Cross Verification
entries**. Projection counts agreed across every surface (All 1 / Done 1 / workflow 1) — D81 proved
by a real run, not only by its guard.

**Speed sanity — what this criterion budgets is FIXED SLEEP, and it is zero.**
`ref:execution-and-sessions` §5 is the speed contract, and the quantity it names is the *sleep tax*:
fixed `waitForTimeout` sleeps are replaced by waits on real readiness predicates, and cumulative
fixed-sleep time is recorded per task span. **Met exactly, and at the floor:** `sleepMs` is **absent
on every task span** of the exit run. The executor emitted no fixed sleeps at all, because it waits
on conditions and never on a hardcoded duration — so legacy's ~24 s of `waitForTimeout` on this path
is *removed*, not reduced, and there is no residual sleep budget to shrink later.

**Wall clock is recorded as an OBSERVATION, not as a pass/fail threshold.** The UCPath person-org
read took **22.5 s** end to end, dominated by UCPath's own page loads. Stated plainly: **22.5 s is
not materially below the old ~24 s**, and it must never be reported as though it were a speed win.
The two numbers do not measure the same thing — 22.5 s is total wall clock for the read, ~24 s was
legacy's *sleep alone* — so comparing them proves nothing in either direction, and **no exit
criterion turns on the 22.5 s.** What the measurement does establish is that removing the sleep tax
cost nothing, and that the remaining time is real work on the far side of the network. Making that
work faster is a Phase-2 concern and was not attempted here. Authentication is D120 content-level
proof, live-verified at ~17 s (ucpath) and ~12 s (crm) including a real Duo ceremony — also
observations, on the same footing.

**Failure latency — root-caused and FIXED 2026-08-04 (D125).** The `cross-verify` cancellation took
**262.9 s** to surface. The run recovered correctly and no wrong data was produced, but 4 m 23 s is
the cost of discovering a dead browser session, and it was charged to the operator's wall clock. The
hang was in session ACQUISITION, not in the read: `factory.open` succeeded (which is why the run's
CRM close span reads `login-failed` with no matching start span), and the login recipe then chained
steps that are each individually bounded while **nothing bounded the chain**. The only outer bound
reaching that code was `timeouts.taskMs` (180 000 ms) — which must stay generous for the real read
and never fired here anyway: the D118 claim sweep (wall-clock 60 s staleness, 30 s cadence) requeued
the run first, the heartbeat then reported the claim lost, and the span closed `cancelled`. Claim
expiry is recovery, not a liveness bound. The fix is a separate, much shorter acquisition bound —
`timeouts.sessionAcquireMs`, default 60 000 ms — armed on the same kernel scheduler, failing loud
and never retrying (`ref:execution-and-sessions` §"Session acquisition is bounded separately from
the task").

_A later correction to this same message, worth knowing: `describeStalledLanding` — the function
whose whole job is explaining a stalled Duo login — is unreachable at the shipped defaults, because
`duoApprovalSeconds` (180 s) sits inside a 60 s acquisition envelope. D244 answers it from the other
side: the refusal is decided by CONTENT, so the wait observes Duo's own "canceled or timed out" and
refuses in 9.52 s naming the real cause._

### Three presentation defects the exit run exposed — ALL THREE FIXED 2026-08-04

All three are presentation-only: the durable authority is correct in every case, which is why none
of them blocked the exit. They are logged because this program's charter is that a surface must
never mislead the operator, and each of these did. Normative text lives in `ref:dashboard-surfaces`
§Phase 1g/1i-spine as-built presentation deltas.

1. **FIXED (D123) — a conditionally-skipped node rendered as "cancelled" in the run-detail
   timeline.** The `RunDetailWire` step-state enum (`src/domain/dashboard/run-detail.ts`) had no
   `skipped` arm, so `src/server/dashboard/queries/run-detail.ts` mapped `skipped → cancelled`. The
   durable result was right (`crm-dates` = `not-run / condition-false`); the timeline was not.
   "Cancelled" names an act someone took — the D-status vocabulary is explicit that it means *"You
   stopped it"* — and a branch that was never supposed to run is the opposite. The wire enum now has
   a `skipped` arm, every timeline event carries an explicit `notRun` reason-or-absence over the
   durable result's own closed vocabulary, the executor stamps that reason on the skip span, and the
   surface draws a skipped step with its own shape and its own accessible name.
2. **FIXED (D124) — the queue row's elapsed kept counting after a run went terminal.**
   `RowFooterLine` (`src/dashboard/surfaces/queue.tsx`) computed `now − startedAt` for every
   non-`queued` status, so the exit-test row displayed **2 h 47 m** for a run whose actual execution
   was ~14.5 minutes. It was **elapsed-since-start, not run duration.** The queue wire now serves an
   explicit terminal `endedAt`, an in-flight row is schema-refused from carrying one, and the row
   renders `took <endedAt − startedAt>` once terminal — or an explicit `duration unknown` with the
   server's reason if the instant is genuinely missing, never a silent fall back to `now`.
3. **FIXED (D126) — two status controls computed the same ACCESSIBLE name, "Done — n".**
   `verifiedDone` and `doneWarnings` in `src/dashboard/ds/primitives-status.tsx` both carry
   `label: "Done"`, so `StatusFilters` produced two buttons named `"Done — 1"` / `"Done — 0"` and
   two queue rows both ended `"— done"`. Put to the operator, who **ratified the visible design and
   refused to change it**: on screen the pair is *not* colour-only — `doneWarnings` draws an amber
   warning triangle with its count beside the pill and `verifiedDone` draws the bare green word, so
   icon + hue + count are three visible channels and the short word is the one that fits the header.
   The real defect was assistive-technology only. `ref:dashboard-surfaces`'s D22 is amended to record
   that as-built ground, and the fix is a non-visual `accessibleLabel` channel — `doneWarnings`
   announces `Done with warnings` while the drawn word is untouched. Verified by re-freezing the
   parity corpus: **56 `.a11y.yml` references changed, zero `.png` files.**

_A later correction, and it is the reason the parity lane is what it is today: D132 found that the
lane ASSERTED only the `.png` and rewrote every `.a11y.yml` unconditionally — so this re-freeze was
green by construction — and D187 found that every `paper-ink` reference had been photographed dark
and the run-detail panel was two pixels wide. Both are fixed; both are recorded in §1i-spine above._

### The gate criteria — MET, with the command names as they stand today

- **The gates are green over the whole tree.** `npm run typecheck`, `npm run lint` and
  `npm run test:coverage` pass with every guard inventoried and covering `src/` and `tests/`.
  *Correction to the criterion as written:* it named `npm run test` + `npm run test:architecture` as
  the per-commit pair and a legacy-side `lint:legacy-tests-ratchet` beside them. **D191** replaced
  the pair with `test:coverage` (a strict superset, measured faster), and the legacy half retired
  with **D93/D150** — nothing here reads legacy's working tree and legacy work blocks no rebuild
  gate. `test:coverage` gates **60/80** lines/statements/functions (`vitest.config.ts:40-41`);
  branches are report-only. R10 raises the global floor to 80 and has not landed (`{#workflow-authoring-core}`).
- **Write-safety fixtures** pin simultaneous and later sequential same-key dedupe, proof validation
  for every completion arm, fresh subject binding, crash injection across the atomic commit, and
  ledger-projector concurrency and tail loss. Alternating EID and file-digest mismatch produce zero
  fence and zero click.
- **Command and delegation fixtures** prove transactional enqueue policies, versioned idempotent
  actions, scoped CAS only for real-race arms, authority-only cancel targets, the
  zero/one/many/partial/cancel/retry/replay/multi-edge child behaviours, and no duplicate active
  runs when authority lookup fails.
- **Strict schema mutation tests** cover every durable / wire / config / intake / evidence boundary
  recursively; raw `Page`/`Locator`/selector access exists only in driver and session internals; the
  generated UI catalog has no duplicate ids, invalid `supersedes` references, or unresolved
  dependencies.
- **Recovery is proved end to end:** a real-shaped copied authority DB passes corruption detection →
  read-only degraded mode → newest checksummed-backup restore → projection rebuild, preserving
  commands, dependencies, checkpoints, write intents and outboxes, with backup age and health
  visible. *Correction:* the OFFLINE restore path this criterion also covers was proved by fixture
  and was **unreachable in production** until D181 supplied the runtime-lock snapshot its one-time
  stopped-system proof derives from — see §1c above.
- **Every task, workflow and UI dependency in the spine references executed scenarios** (every
  branch, gate, delegation policy and control path has one). Evidence receipts, diagnostic bundles
  and the notification inbox were correctly OUT of scope here and landed in the 2g tail (D134–D145).
- **D81's one-projection guard is green:** no count anywhere is computed by a second path.
- **Zero new-code allowlist entries** in any extended ratchet (ported leaves are shrink-only and
  argued), and every activated guard arm resolves a non-empty file set — ESLint's CLI target and its
  typed config block both cover `src/` and `tests/`, so a missing path or an unmatched pattern is a
  failure and not a skip.
- **No external HR WRITE.** The exit test is a submit-free live read; existing selector knowledge is
  ported from the legacy registry with provenance, and newly introduced page-state and observation
  recipes receive read-only live verification as they enter the catalog. All external-write proof
  begins in Phase 2, and the controlled-commit proof was MET live on 2026-08-04 (D135).

### What this phase leaves open

Nothing in Phase 1's own scope. Every residual the later rewrites found on a spine contract is
listed with its owner in §Phase summary above, and each is owned by a later node: `{#track-c}`,
`{#observed-logs}`, **Track D row D6** and **row D11**, `{#def-byte-path}`, `{#workflow-authoring-core}`, and
three reference-doc sections. D75 closed the former unowned `requestedBy` admission check on
2026-08-29 without adding a second actor.
