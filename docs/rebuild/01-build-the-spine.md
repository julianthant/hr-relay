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
- [x] every Phase-1 hard exit criterion is MET (§Exit criteria), and no later phase re-opened a Phase-1 contract — later work AMENDED spine surfaces (D144, D214, D218, D253) without moving the contracts
- [ ] residuals that trace back to spine contracts, all owned in LATER nodes — `requestedBy` stamped and never checked (§1f, unowned) · `src/dashboard/state/` never built its cache half (Track D row D6) · five of six stream topics have no producer and the notes stream has no emitter (`{#track-c}` / `{#observed-logs}`) · `ref:dashboard-surfaces` §3.2's three declaration shapes unimplemented · D71's type BUDGET unmeasured
> 2026-08-21 | docs-cohesion 01 | verified against src/control/workflow-registry.ts, src/core/{run-executor,worker-loop,command-kernel}.ts, src/domain/contracts/base.ts, src/infra/sqlite/{authority-database,migrations}.ts and the filled `p1-*` status blocks in reference/{guards-and-tests,operator-trust,dashboard-surfaces,frontend-backend-integration}.md; left: nothing IN this phase — every open line above is a named residual whose owner is a later node
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
| `requestedBy` is stamped verbatim on every command; the identity-checkpoint match `ref:frontend-backend-integration` §3.4 requires is unenforced | 1f, the command kernel | **unowned** — no D-number, no `pending-wire-bindings` entry; reachable only if a second actor ever exists. Reported, not filed |
| `src/dashboard/state/` never built its cache half — six modules of resource hooks, no invalidation/generation layer, and three surfaces bypass it | 1i-spine, the transport/state split | **Track D row D6** (`{#dash-defaults}`) |
| five of the six declared stream topics have no producer (only `dashboard-day` is emitted); `emitNote` is composed and never called, so `.tracker-rebuild/notes/` has never existed | 1g-spine, the subscription protocol | `{#track-c}` (§3.5) and `{#observed-logs}` |
| `StepDisplayRule`, `GateProjectionDefinition` and the `ArtifactSinkId` sink registry are declared in `ref:dashboard-surfaces` §3.2 and implemented nowhere; `span.ended` carries no `verdict` | 1e/1g-spine, the descriptor's presentation declarations | `ref:dashboard-surfaces` §3.2 / §1.3 |
| D71's type-inference proof EXISTS (`tests/types/`, a 21-node graph plus `@ts-expect-error` controls) but its 5 s / 1 GiB BUDGET is unmeasured — nothing runs `tsc --extendedDiagnostics` against it | 1e, the real-scale type proof | `ref:guards-and-tests` §3.12 |
| two port-map invariants are held by nothing named — `cancel-mechanism` and `tracker-row-emission` | 1a, the guard inventory | `ref:guards-and-tests` §2.1 / §5.1 |
| the artifact resource schemas have no route serving bytes | 1b/1g-spine, the wire primitives | `{#def-byte-path}` (D189, `04-close-the-deferrals.md`) |

None of these blocks a phase, and none is a waiver: each names where it is owned.

## 1a · 1b — guards, baselines, the strict domain leaf
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
- [ ] the coverage floor is still 60/80 (`vitest.config.ts:40-41`); R10 raises the global floor to 80 (measured 84/82/85) and that has not landed — owner `{#test-tiers}`
> 2026-08-21 | docs-cohesion 01 | verified against tests/unit/architecture/helpers/ratchet-arms.ts, docs/rebuild/guard-inventory.json (75 entries, 65/8/2), vitest.config.ts:40-41, src/domain/dashboard/** and the filled `p1-base` blocks in reference/{guards-and-tests §2, operator-trust §2, frontend-backend-integration §3}; left: the two unheld port-map invariants and the coverage-floor raise, both owned elsewhere

<!-- /roadmap-status -->

### 1a — the guard lane lands before the source it guards (COMPLETE 2026-07-31)

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

### 1b — the strict domain leaf, and full coverage activation (COMPLETE 2026-07-31)

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
here.** **D121/D122** removed `node:path` from `src/domain/config/schema.ts`: a browser-reachable
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
global 80 is planned under `{#test-tiers}` and is not landed.

## 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] 1c — the authority/projection table split, the exhaustive frozen registry and the once-per-transaction generation rule (`src/domain/authority.ts`, `src/infra/sqlite/authority-database.ts`)
- [x] 1c — released migrations are IMMUTABLE: every version's ordered statement bytes pinned by a literal digest, v1 through the current v15 (`src/infra/sqlite/migrations.ts`, `migration-history-immutability`)
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

### 1c — authority storage, recovery, and the command/write type shell (COMPLETE 2026-08-01)

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

### 1d — the semantic UI registry, typed drivers, task and store contracts (COMPLETE 2026-08-01)

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

### 1e — the workflow DAG, delegation, completion and the descriptor (COMPLETE 2026-08-01)

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

## 1f — registry, workers, commands, the write sequencer
<!-- roadmap: p1-kernel -->

<!-- roadmap-status: p1-kernel -->
- [x] the ONE `WORKFLOW_MODULES` composition root above workflows — every registry derives from that single tuple (`src/control/workflow-registry.ts`)
- [x] exact raw + canonical start plans and atomic consumption (D109, schema v6) — the ingress retains what an operator SUBMITTED beside the canonical snapshot, so a default or a transform can never erase it
- [x] one-item claims with unfinished-write recovery BEFORE requeue (D118), verified-neutral navigation and explicit fresh-session boundaries keyed by config fingerprint (D116/D117), and the required non-no-op provenance collector (D115)
- [x] minimal durable `FailureRecord` and terminal `RunResultRecord` under a strict pre-terminal authorization (D110/D114, schema v7→v8); the exact strict failure record is in non-rebuildable authority for every failed task and run, its `failureId` associated atomically with the failure transition
- [x] D112/D119 generic provider admission and fixed-window budgets (schema v9, 2026-08-03) — reserve before I/O, reconcile only on a strict measured result, retain the maximum on any uncertain outcome
- [x] ONE exhaustive command kernel with the Phase-1 arms active and later arms typed `capability-unavailable` (D113); the arm partition is checked against the D95 registry in BOTH directions at module load, so an action neither list carries — or both — throws before any command can dispatch (`src/core/command-kernel.ts`)
- [x] the write sequencer's beats ①–⑦ — probe → prepare → binding proof → fence → commit → proof → the one checkpoint/run/outbox transaction (D111); `write-safety-contract` is active and asserts durable ABSENCE over a real database (D188)
- [x] D120 — a session's authentication is a CONTENT-level proof, never a URL; live-verified on ucpath (~17 s) and crm (~12 s) including a real Duo ceremony
- [ ] `requestedBy` is stamped verbatim on every command; the identity-checkpoint match `ref:frontend-backend-integration` §3.4 requires is UNENFORCED, with no D-number and no `pending-wire-bindings` entry — reachable only if a second actor ever exists
- [ ] the bulk `all-or-none` mode is declared and refuses `capability-unavailable` (D235) — owner `ref:frontend-backend-integration` §3.4
- [!] `supersede-active` is implemented in the kernel, unanticipated by the planner, and reported to the operator as unimplemented — three sites, two answers; owner `ref:dashboard-surfaces` §2.4
> 2026-08-21 | docs-cohesion 01 | verified against src/control/workflow-registry.ts, src/core/{command-kernel,run-executor,worker-loop,write-sequencer,write-recovery}.ts, src/services/start/plan.ts and the filled `p1-kernel` blocks in reference/{dashboard-surfaces §2.4, operator-trust §2.1, guards-and-tests §3.3, frontend-backend-integration §3.4}; left: the three lines above, all owned in reference docs

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

**What is LEFT on this node** is one unowned check and two filed items. `requestedBy` is stamped on
every command envelope and never compared against an identity checkpoint — the check
`ref:frontend-backend-integration` §3.4 describes has no decision behind it and no
`pending-wire-bindings` entry, and it is reachable only if this system ever has a second actor. The
bulk `all-or-none` mode is declared and answers `capability-unavailable` (D235). And
`supersede-active` has three sites giving two answers — implemented in the kernel, unanticipated by
the planner, reported to the operator as unimplemented — filed in `ref:dashboard-surfaces` §2.4
rather than fixed in a docs pass.

## 1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell
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

### 1g-spine — span emission and the ONE projection (COMPLETE 2026-08-04)

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

### 1i-spine — the four parity surfaces (COMPLETE 2026-08-04)

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

## Phase 1 exit — the live run
<!-- roadmap: p1-exit -->

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

## Integration amendment — Phase 1's share (master plan §7)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §7 intro, §7.1's parity-surface bullet, §7.2's `1b`/`1c`/`1e`/`1g-spine`/`1i-spine` rows on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

`docs/rebuild/reference/frontend-backend-integration.md` is now the owning companion for the composition
boundary between the approved rebuild frontend and refs workflow-model/dashboard-surfaces/data-intake-and-edit-data/write-safety/clock-config-secrets/operator-trust's backend contracts. It
does **not** introduce another sequence; the delivery slices below amend the existing work items in
this plan.

- “Four parity surfaces” means the **exact Person Lookup capability slice inside the approved full
  shell**, not four approximate legacy components. It includes the typed Start Run surface,
  day/count/navigation shell, Context rail, Receipt placeholder, and live/reconnecting Session
  Panel states needed to operate that workflow.

| Existing item | Integration addition | Exit evidence |
|---|---|---|
| **1b** | strict bootstrap/day/detail/subscription/artifact primitives, schema versions, revisions, projection cursors and explicit absence/error unions | every boundary schema parses fixtures and rejects unknown/invalid combinations |
| **1c** | durable command type shells for start, intake, worker/browser, atomic settings and version/archive targets in addition to run/gate/notification/capture arms; D95 reserves run `bump` for priority, names version actions `plan-version-bump`/`apply-version-bump`, and adds strict run `rename` | every product mutation has one idempotent actor-stamped command family before a route can exist; no discriminant means both priority and version work |
| **1e** | one complete client descriptor projection: start methods, dry-run/instance absence reasons, panel kind/sections, actions, graph summary and capability availability | no workflow/start/panel registry exists outside the descriptor projection |
| **1g-spine** | in-process typed dashboard BFF; bootstrap/day/run-detail queries; one transport client; resumable cursor-based SSE; Phase-1 start/run command route | snapshot + any valid patch sequence equals a fresh snapshot; gaps or schema/revision changes reset visibly |
| **1i-spine** | port the approved tokens/primitives and exact Person Lookup shell composition; wire Start, Queue, Detail/Context/Receipt, counts and Session Panel end to end | live Person Lookup plus both-theme Playwright a11y/screenshot parity at the reference viewports |

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 13 | 2026-07-31 | D95 | the command-family ambiguity closure (1c's type shell) |
| 14–16 | 2026-08-01 | D96–D107 | 1d's session/artifact/provider seams (D96–D101) and 1e's descriptor closure (D102–D107 — forward-referencing branch cases, the bundle-safe descriptor closure, `pending-impl-bindings`) |
| 17 | 2026-08-02 | D108 | the person-lookup CRM read stays source-semantic and EID-bound |
| 18 | 2026-08-02 | D109–D118 | **1f's runtime/authority closure**: atomic start plans (D109), the minimal durable failure record (D110), beat ⑦ as one transaction (D111), the generic provider-admission core (D112), the exhaustive command kernel (D113), factory-derived terminal results (D114), the required provenance collector (D115), config-keyed session reuse (D116/D117), recovery-before-requeue (D118) |
| 19–20 | 2026-08-03 | D119–D120 | provider budget windows; **a login is proven by CONTENT, never a URL** (D120) |
| 21 | 2026-08-04 | D121 | browser-bundle purity — no browser-reachable module statically imports a Node built-in |
| 23–24 | 2026-08-04 | D123–D126 | **the three presentation defects the live exit run exposed** (D123 `skipped` is its own state, D124 a terminal row's duration, D126 the accessible name is its own channel) and D125's separate session-acquisition bound |

Rounds 22 and 25 onward belong to Phase 2 (`02-prove-writes-build-the-tails.md`).

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 1's hard exit criteria, with the three presentation defects the exit run exposed) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Hard exit criteria (Phase 1) — ALL MET 2026-08-04.**

- **THE exit test — person-lookup runs LIVE on the spine (D74). MET 2026-08-04.** A submit-free live
  run against real UCPath + CRM (Duo cleared hands-off by Autopilot, charter §9) produced a correct
  person-lookup result on the new executor, and every projected surface (Queue Row, Log Panel,
  Session Card, Workflow Panel count) rendered from the descriptor via the single 1g-spine
  projection — verified headless with the `playwright-cli` seed→boot→assert loop (root
  `CLAUDE.md`). This criterion is not satisfiable by fixtures; that is the point of moving it here.
  Its `descriptor-coverage` guard is green, and the speed criterion — which budgets **fixed sleep
  time**, ref execution-and-sessions §5 — is met at **zero**, with wall clock recorded beside it as an observation and
  not as a threshold.

  **The run.** `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, workflow
  `person-lookup`, input EID `10873698`, terminal `done` **at attempt 2**. Node walk:
  `searching` done (22.5s) → `cross-verify` **cancelled** (262.9s — the CRM browser died) → run
  re-attempt → `cross-verify` done (12.8s) → `active-status` done → `crm-dates` **skipped**
  (`condition-false`).

  **The result is correct, not merely schema-valid.** `activeStatus.state = "active"`, `hdh = true`,
  reason *"UCPath reports active and CRM record a1ZVr000004Xoq9MAC matches…"*;
  `crmDates.state = "not-requested"`. The terminal dependencies record `active-status` resolved with
  full output/provenance fingerprints and `crm-dates` as `state: not-run, reason: condition-false` —
  a closed reason for a conditional node, exactly as D114 requires, never a silent omission.

  **Mid-run recovery worked unprompted.** The poisoned CRM session was closed, reopened, and the node
  re-ran under attempt 2 with no operator action. That is 1f's worker-owned browser lifecycle and
  D118's recovery-before-requeue behaving as designed against a real failure rather than a fixture.

  **The four parity surfaces, all from the ONE projection** (BFF 3938, frontend 5174), verified
  headless against this run: Queue row (*"EID 10873698 — done"*, trace `pl-000619-4ebf`, attempt 2);
  Workflow Panel count (1); Session Panel (*"0 working 1 idle"*, status Live, v0.1.0); Log Panel
  run-detail timeline showing all five events **including both Cross Verification entries**.
  Projection counts agreed across every surface (All 1 / Done 1 / workflow 1) — D81 proved by a real
  run, not only by its guard.

  **Speed sanity — what this criterion budgets is FIXED SLEEP, and it is zero (ref execution-and-sessions §5).** Ref execution-and-sessions
  §5 is the speed contract, and the quantity it names is the *sleep tax*: fixed `waitForTimeout`
  sleeps are replaced by waits on real readiness predicates, and cumulative fixed-sleep time is
  recorded per task span. **Met exactly, and at the floor:** `sleepMs` is **absent on every task
  span** of the exit run. The executor emitted no fixed sleeps at all, because it waits on
  conditions and never on a hardcoded duration — so legacy's ~24s of `waitForTimeout` on this path
  is *removed*, not reduced, and there is no residual sleep budget to shrink later.

  **Wall clock is recorded as an OBSERVATION, not as a pass/fail threshold.** The UCPath person-org
  read took **22.5s end to end**, dominated by UCPath's own page loads. Stated plainly: **22.5s is
  not materially below the old ~24s**, and it must never be reported as though it were a speed win.
  The two numbers do not measure the same thing — 22.5s is total wall clock for the read, ~24s was
  legacy's *sleep alone* — so comparing them proves nothing in either direction, and **no exit
  criterion turns on the 22.5s.** What the measurement does establish is that removing the sleep tax
  cost nothing, and that the remaining time is real work on the far side of the network. Making that
  work faster is a Phase-2 concern and was not attempted here.

  Authentication is D120 content-level proof, live-verified at ~17s (ucpath) and ~12s (crm)
  including a real Duo ceremony — also observations, on the same footing.

  **Failure latency — root-caused and FIXED 2026-08-04 (D125).** The `cross-verify` cancellation took
  **262.9s** to surface. The run recovered correctly and no wrong data was produced, but 4m23s is the
  cost of discovering a dead browser session, and it was charged to the operator's wall clock. The
  hang was in session ACQUISITION, not in the read: `factory.open` succeeded (which is why the run's
  CRM close span reads `login-failed` with no matching start span), and the login recipe then chained
  steps that are each individually bounded while **nothing bounded the chain**. The only outer bound
  reaching that code was `timeouts.taskMs` (180 000 ms) — which must stay generous for the real read
  and never fired here anyway: the D118 claim sweep (wall-clock 60s staleness, 30s cadence) requeued
  the run first, the heartbeat then reported the claim lost, and the span closed `cancelled`. Claim
  expiry is recovery, not a liveness bound. The fix is a separate, much shorter acquisition bound —
  `timeouts.sessionAcquireMs`, default 60 000 ms — armed on the same kernel scheduler, failing loud
  and never retrying. See ref execution-and-sessions §"Session acquisition is bounded separately from the task".

**Three presentation defects the exit run exposed — ALL THREE FIXED 2026-08-04.** All three are
presentation-only: the durable authority is correct in every case, which is why none of them
blocked the exit. They were logged here because this program's
charter is that a surface must never mislead the operator, and each of these did. Normative text
lives in ref dashboard-surfaces's *Phase 1g/1i-spine as-built presentation deltas*.

1. **FIXED (D123) — a conditionally-skipped node rendered as "cancelled" in the run-detail
   timeline.** The `RunDetailWire` step-state enum (`src/domain/dashboard/run-detail.ts`) had no
   `skipped` arm, so `src/server/dashboard/queries/run-detail.ts` mapped `skipped → cancelled`. The
   durable result was right (`crm-dates` = `not-run / condition-false`); the timeline was not.
   "Cancelled" names an act someone took — ref dashboard-surfaces D-status vocabulary is explicit that it means
   *"You stopped it"* — and a branch that was never supposed to run is the opposite. The wire enum
   now has a `skipped` arm, every timeline event carries an explicit `notRun` reason-or-absence over
   the durable result's own closed vocabulary, the executor stamps that reason on the skip span, and
   the surface draws a skipped step with its own shape and its own accessible name.
2. **FIXED (D124) — the queue row's elapsed kept counting after a run went terminal.**
   `RowFooterLine` (`src/dashboard/surfaces/queue.tsx`) computed `now − startedAt` for every
   non-`queued` status, so the exit-test row displayed **2h 47m** for a run whose actual execution
   was ~14.5 minutes. It was **elapsed-since-start, not run duration**. The queue wire now serves an
   explicit terminal `endedAt`, an in-flight row may not carry one at all, and the row renders
   `took <endedAt − startedAt>` once terminal — or an explicit `duration unknown` with the server's
   reason if the instant is genuinely missing, never a silent fall back to `now`.
3. **FIXED (D126) — two status controls computed the same ACCESSIBLE name, "Done — n".**
   `verifiedDone` and `doneWarnings` in `src/dashboard/ds/primitives-status.tsx` both carry
   `label: "Done"`, so `StatusFilters` produced two buttons named `"Done — 1"` / `"Done — 0"` and
   two queue rows both ended `"— done"`. Put to the operator, who **ratified the visible design and
   refused to change it**: on screen the pair is *not* colour-only — `doneWarnings` draws an amber
   warning triangle with its count beside the pill and `verifiedDone` draws the bare green word, so
   icon + hue + count are three visible channels and the short word is the one that fits the header.
   The real defect was assistive-technology only. Ref dashboard-surfaces's D22 is amended to record that as-built
   ground (icon + colour + a distinct accessible name, no longer "the word remains"), and the fix is
   a non-visual `accessibleLabel` channel — `doneWarnings` announces `Done with warnings` while the
   drawn word is untouched. Verified by re-freezing the parity corpus: **56 `.a11y.yml` references
   changed, zero `.png` files.**
- In the rebuild repo, `npm run typecheck`, `npm run lint`, `npm run test`, and
  `npm run test:architecture` are **all green**, with every guard inventoried and covering the
  rebuild `src/` and `tests/` roots. In the legacy repo, `npm run lint:legacy-tests-ratchet` is the
  honest gate while maintained legacy tests still exist; `npm run lint:tests` is reported truthfully
  but is not an initial-cutover gate. The manifest may remain or shrink, but any new/replaced
  fingerprint fails and touched legacy files cannot add debt. The rebuild repo's `test:coverage`
  gates 60/80 lines/statements/functions; branches are report-only.
- Write-safety fixtures pin simultaneous and later sequential same-key dedupe, proof validation for
  every completion arm, fresh subject binding, crash injection across atomic commit, and ledger
  projector concurrency/tail loss. Alternating-EID/file-digest mismatch produces zero fence/click.
- Command/delegation fixtures prove transactional enqueue policies, versioned/idempotent actions,
  scoped CAS only for real-race arms,
  authority-only cancel targets, zero/one/many/partial/cancel/retry/replay/multi-edge child behavior,
  and no duplicate active runs when authority lookup fails.
- Strict schema mutation tests cover every durable/wire/config/intake/evidence boundary recursively;
  raw Page/Locator/selector access exists only in driver/session internals; generated UI catalog has
  no duplicate ids, invalid `supersedes` references, or unresolved dependencies.
- A real-shaped copied authority DB passes corruption detection → read-only degraded mode → newest
  checksummed-backup restore → projection rebuild, preserving commands/dependencies/checkpoints/
  write intents/outboxes. Backup age/health is visible.
- Every task/workflow/UI dependency in the spine references executed scenarios (every branch, gate,
  delegation policy, and control path has one). *Evidence receipts, diagnostic bundles, and the
  notification inbox move to the Phase-2 tails — the spine emits spans and the ONE projection.*
- **D81 one-projection guard is green:** no count anywhere is computed by a second path.
- Zero new-code allowlist entries in any extended ratchet (ported leaves shrink-only, argued).
- Every activated guard arm resolves a non-empty file set; ESLint's CLI target and typed config block
  both cover the rebuild repo's `src/` and `tests/`. Missing paths and unmatched patterns are
  failures, not skips.
- **No external HR WRITE yet.** The exit test is a submit-free live read; existing selector
  knowledge maps from the maintained legacy registry, and newly introduced page-state/observation
  recipes receive read-only live verification as they enter the catalog. All external-write proof
  begins in Phase 2.
