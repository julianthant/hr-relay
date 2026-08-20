# Audit — `reference/dashboard-surfaces.md`, the step 5.1 ledger the rewrite works from

**Date:** 2026-08-20 · **Unit:** `docs-dash-surfaces-audit` (worktree `.hr-rebuild-worktrees/docs-dash-surfaces-audit`, branch `feature/docs-dash-surfaces-audit`) · **Subject HEAD:** `22a3453f`
**Plan:** `docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` §0 (R6–R12, R9 item 3), §3.4, §3.5 · **Node map:** `docs/plans/2026-08-20-cohesion-node-map.md` §2 (this doc's block), §3(c) items 1/3/5
**Subject:** `docs/rebuild/reference/dashboard-surfaces.md` — 4,070 lines, **109 sections** (the H1 excluded), zero `<!-- roadmap: -->` tags today.

This unit produces the ledger. It edits nothing — not the doc, not the tree, not `src/`. A second (and third) unit rewrites from it.

## 0 · Method, and what a classification means

Every "done" here was checked against the **code**, not against the prose (D252, plan §1). Four parallel read-only surveys covered the span/projection/wire layer, the queue/run-detail/rail surfaces, the archive/activity/explorer/settings/notifications/shell surfaces, and intake/capture/completion/cutover; every claim below carries a `file:line`. Where the doc and the code disagree, §3 quotes both sides and the rewrite corrects the **prose**.

| class | meaning | what the rewrite does |
|---|---|---|
| **done-as-built** | the prose describes what the code does; evidence cited | keep, tag, tick the status block with the commit/D |
| **needs-attention** | stale, contradicted by the code, or a measurement the doc asserts and nobody took | correct the prose to what IS; `- [ ]` or `- [!]` in the status block |
| **to-build** | describes something that does not exist and is planned | keep the contract, say plainly that no producer exists, `- [ ]` with the owning node |
| **superseded** | narrative overtaken by a later section or a ruling | move to `history/superseded/`, fold the normative residue into the section it amends (R9 item 1) |
| **reference** | closed decisions, legacy grounding, guard tables, worked examples | keep as reference prose; no status block |

**Counts (109 sections):** done-as-built **49** · needs-attention **32** · to-build **15** · superseded **8** · reference **5**.

Read the shape of that: nearly half the doc is accurate as written, and the largest single class after it is prose that has drifted rather than prose that was wrong. Only eight sections leave the doc; only fifteen describe something with no producer — and five of those fifteen are one root cause (§3 C2, nothing mints an `operation` run).

**The evidentiary standard that mattered most.** D254's own bar — *"verified against the real state root, not merely against the source tree"* — was applied twice more, and it found the two largest holes in this doc: `.tracker-rebuild/notes/` **does not exist** (contradiction C1), and no enqueue path in `src/` has ever minted an `operation` run (contradiction C2).

---

## 1 · Section ledger

Target-home codes are §2's sections: **S0** house rules · **S1** run modal · **S2** queue rows + bulk · **S3** run detail + timeline · **S4** Context rail · **S5** gate ceremonies · **S6** notifications · **S7** archive · **S8** activity · **S9** explorer + catalog · **S10** settings/storage · **S11** intake + Edit Data · **S12** capture phone · **S13** the shell · **P** the projection and the wire · **C** the command protocol · **DF** descriptor fields consumed · **DG** delegation, group rows and the completion contract · **X** cross-repo boundary and cutover · **REF** reference matter.

### 1a · The header and the as-built delta blocks (sections 1–21, L28–L1033)

| # | section (line) | node(s) | class | evidence | home |
|---|---|---|---|---|---|
| 1 | `## Ownership (D1)` L28 | REFERENCE | needs-attention | the "Where" column says `§§1–5, §9–10`; the doc has owned §11–§13 since 2i (L3789/L3885/L3982). The dated amendment log above it is a chronology, not a contract | S0 |
| 2 | `## Phase 1c Stage A as-built contract delta` L40 | `p1-authority` | superseded | its normative residue is `src/domain/authority.ts` + `src/domain/commands.ts:33-79`, restated by §2.3/§2.4; the stage framing ("Phase 1c remains in progress") is dead | → `history/superseded/2026-08-21-dashboard-surfaces-phase-1c-stage-deltas.md`; residue folds into **P**/**C** |
| 3 | `## Phase 1c Stage B as-built storage delta` L58 | `p1-authority` | superseded | `src/infra/sqlite/authority-database.ts`, `migrations.ts` v1; §2.3 owns the live statement | same file; residue → **P** |
| 4 | `## Phase 1c Stage C as-built recovery delta` L90 | `p1-authority` | superseded | `src/infra/sqlite/offline-restore.ts`, `recovery-stop-proof.ts`; §2.5 + D181 own the live statement | same file; residue → **S10** |
| 5 | `## Phase 1c Stage D as-built authority-write delta` L124 | `p1-authority` | superseded | `migrations.ts` v2; beat ⑦ now lives in `src/core/write-sequencer.ts` and is `ref write-safety`'s | same file; residue → **P** |
| 6 | `## Phase 1f authority and command ratification` L153 | `p1-kernel` | done-as-built | `src/core/command-kernel.ts:141-171` (`PHASE1_ACTIVE`/`PHASE1_DEFERRED`, partition checked against the D95 registry both ways at module load); `migrations.ts` v6–v9; `hide`/`unhide` correctly recorded as retired by D234 | fold into **C** |
| 7 | `## Phase 1g/1i-spine as-built presentation deltas` L223 | `p1-spine` · `p1-exit` | done-as-built | D123 `notRunReason` `src/events/types.ts:197-220` + `TimelineEventWireSchema.state` `src/domain/dashboard/run-detail.ts:110-116`; D124 `endedAt` + `refineEndedAt` `src/domain/dashboard/projection.ts:245-259, 388-399` and `runTiming` `src/dashboard/surfaces/format.ts:83-101`; D126 `accessibleLabel` `src/dashboard/ds/primitives-status.tsx:175-176, 289-293` | split: D123 → **S3**, D124 → **S2**, D126 → **S13** |
| 8 | `## Queue-row projection as-built delta` L327 | `track-b` | done-as-built | `liveMessage`/`dryRun`/`gateOpenedAt` served at `src/domain/dashboard/projection.ts:161-172, 260-278, 318-321`, producers `run-queue-projection.ts:889-903` | **S2** |
| 9 | `### The second batch: ordinal, class, links and outcome` L377 | `track-b` | done-as-built | `runNumber` `projection.ts:180-195` / `run-queue-projection.ts:1113-1117`; `containment`+`linkedRuns` `:205, 220`; `facts` `:221-242`; `memberPreview` `:532-575` | **S2** |
| 10 | `### Drawing the second batch: the rehearsal hue and the rename control` L433 | `track-b` | done-as-built | `--ds-rehearsal-*` `src/dashboard/surfaces/queue.tsx:229-241`; rename served `queue-row-actions.ts`, dialog `dashboard-app.tsx:781-793` → `run-identity.tsx:30`; CAS on all three presentation verbs | **S2** |
| 11 | `### The per-row action descriptors` L507 | `track-b` | needs-attention | the served table is real (`src/server/dashboard/projectors/queue-row-actions.ts`, `cancel-tree` at `:254`); its closing "one conflict this work surfaced" (D12's age served-not-drawn) is still open and is `{#operator-calls}`'s | **S2** (the open conflict cross-links to S0) |
| 12 | `### The row title is the SUBJECT, and \`displayName\` is served beside it` L562 | `track-b` | needs-attention | the subject resolver is as described (`run-subject-title.ts`, `projection.ts:279-312`), but the closing paragraph — *"There is still no operator-facing way to REACH `rename`"* — was falsified by D233 two sections above it | **S2** |
| 13 | `### D225 — the run-detail timeline is CATEGORICAL` L635 | `sep-dash` · `dash-defaults` | needs-attention | built: `deriveTimeline` `src/base/workflow.ts:742-781`, fold `run-detail.ts:451-466, 526-596`, renderer `log-panel.tsx:323-411`. Its own "what this does not land" is STILL open — no parity reference serves `steps` (`tests/parity/references/` has no categorical strip) | **S3** |
| 14 | `#### D259 — a REPLAYED step is its own arm` L697 | `track-c` | done-as-built | `TimelineStepStateSchema` `run-detail.ts:152`, `replaySourceOf` `queries/run-detail.ts:501-517`, renderer `log-panel.tsx:243-247` | **S3** |
| 15 | `### D234 — the queue's model is runs and archived runs` L751 | `track-b` | done-as-built | `ActionCommandKeySchema` `src/domain/dashboard/actions.ts:47-50` holds no `hide`/`unhide`; `RunRecord.hidden` is the parse-tolerated vestige at `src/domain/run/record.ts:232-244` | **S2** |
| 16 | `### D235 — a bulk command is N children and one vector` L807 | `track-b` | done-as-built | `BulkRunCommandResponseSchema` `src/domain/commands.ts:390-405` (four per-target arms), `all-or-none` refused `command-service.ts:334-352`, client `bulk-dispatch.ts` + `queue-toolbar.tsx:311-513` | **S2** |
| 17 | `### D238 — a rehearsal's terminal outcome is never \`verified-done\`` L844 | `track-b` | done-as-built | `terminalOutcomeText` `src/dashboard/surfaces/log-panel-model.ts:67-72`; the `rehearsal`/`verified-done` refinement in `run-detail.ts` | **S3** |
| 18 | `## Wave-2 connection-proof presentation deltas` L894 | `track-c` | done-as-built | block header for 19–21 | **S0** (or dissolve into 19–21) |
| 19 | `### A live elapsed TICKS … (D256)` L903 | `track-c` | needs-attention | the mechanism is exact (`src/dashboard/state/served-clock.ts:80-92, 103-129`; ONE caller `dashboard-app.tsx:298`). Its **measurement is stale**: "139 captures fail and 12 behaviour cases pass" was true before Track C's deliberate re-freeze, which the tree records as `151/151 assert-green` (`{#track-c}`) | **S13** (the served clock) + **S2** |
| 20 | `### The open run-detail panel FOLLOWS its run (D257)` L966 | `track-c` | done-as-built | `planRunDetailFollow` `src/dashboard/state/use-run-detail.ts:54-62`, 300 ms settle `:85-100`, `servedRowRevision` `dashboard-app.tsx:316-318` | **S3** |
| 21 | `### The shape hazard compares a run against ITS OWN workflow's served shape` L1002 | `track-c` | done-as-built | `classifyRunShape` `src/dashboard/surfaces/run-identity-model.ts:50`, three verdicts, pinned both ways | **S2** |

### 1b · §0–§3 — the model, the wire, the command protocol (sections 22–41, L1034–L2215)

| # | section (line) | node(s) | class | evidence | home |
|---|---|---|---|---|---|
| 22 | `## 0. What exists today (and what specifically hurts)` L1034 | REFERENCE | reference | legacy grounding, all of it about the legacy tree | **REF** (keep, or → `history/superseded/…-what-exists-today.md`; recommend keep — it is the argument for the whole design) |
| 23 | `## 1. The span event model` L1059 | `p1-spine` | done-as-built | header | **P** |
| 24 | `### 1.1 Primitives` L1061 | `p1-spine` | needs-attention | the TS sketch has drifted from `src/events/types.ts:99-257` (11 strict arms). It still types `SpanEvent` with `SpanPatched`; it omits `transaction.previewed` (`:167-184`); `SubjectObserved` is described as an emitted arm and is **not** in the union (`:30` records it as a deliberate absence); `span.ended` carries `notRunReason` (`:197-211`) and carries **no `verdict` and no `evidenceReceiptId`** — both are in the sketch; the task span path is `<trace>/<node>#<claimGeneration>.<taskAttempt>` (`src/core/span-emitter.ts:205-213`), not `#<attempt>` | **P** |
| 25 | `#### D254 — the \`span.patched\` detail channel is RETIRED` L1217 | `track-b` | done-as-built | verified at D254's own bar: no arm in `src/events/types.ts`, no writer branch, and no line in `.tracker-rebuild/spans/`. One code-comment residue remains (§3 C10) | **P** |
| 26 | `### 1.2 What each of today's surfaces becomes` L1298 | `p1-spine` · `dash-defaults` | needs-attention | the mapping is right for five rows and wrong for one: *"Timeline / log panel ← run span tree's **notes** ⊕ the owning worker span"* — nothing in `src/` writes a note (§3 C1). The `wfCounts` row is as-built (`buildDashboardDayWire` `run-queue-projection.ts:1428-1440`) | **P** |
| 27 | `### 1.3 Decision: archetypes survive as vocabulary, die as per-row stamps` L1310 | REFERENCE | needs-attention | the shape/subjectKind stamped-once half is as-built (`src/events/types.ts:108`), but three of four shapes have no producer (§3 C2), and the `verdicts` mechanism it promises is declared per descriptor (`src/workflows/*/descriptor.ts`) with **no `verdict` field on the span wire** to key it off | **P** (+ a to-build line under **DG**) |
| 28 | `## 2. Storage and transport` L1332 | `p1-authority` | done-as-built | the mermaid picture is accurate to the as-built topology | **P** |
| 29 | `### 2.1 On disk — JSONL-per-day stays, two streams` L1395 | `p1-spine` · `def-retention` | needs-attention | layout and the 30-day floor are exact (`src/infra/events/jsonl-streams.ts:15-27`, `EVENT_STREAM_RETENTION_DAYS = 30` `src/domain/archive/retention.ts:38`, pruned once at boot `compose.ts:578`). The "two greps" rationale and the notes-volume paragraph describe a stream with no producer (C1) | **P** |
| 30 | `### 2.2 Projections are computed server-side` L1458 | `p1-spine` | needs-attention | the rule holds; the `EventsHubPayload`/`QueueSurfaceWire` sketches are two generations behind `src/domain/dashboard/projection.ts:141-372` (`QueueBaseFields`: `runNumber`, `endedAt`, `gateOpenedAt`, `displayName`, `facts`, `warnings`, `containment`, `linkedRuns`, `appVersion`, `rowRevision`, `availableSections`, `actions` — none in the sketch; the sketch's `detailSurfaces`, `links`, `evidence`, `memberRollup{status,count}` are gone or reshaped) | **P** |
| 31 | `### 2.3 SQLite (role per D14)` L1516 | `p1-authority` | done-as-built | the authority/projection split and the generation rule are exact (`authority-database.ts`, `src/domain/authority.ts`) | **P** |
| 32 | `#### D218 — the projector consumes the span stream FROM DISK` L1557 | `platform-fixes` | done-as-built | `ingestFromDisk` `run-queue-projection.ts:428-445`, cursor seeding `:479-513`, 250 ms tick `compose.ts:292,598`, command-service tick `command-service.ts:158,227,253,302`, torn-line rule `jsonl-streams.ts:168-182`, shrink throws `:139-144` | **P** |
| 33 | `#### D255 — a \`span.ended\` binds to an OPEN entry` L1594 | `track-b` | done-as-built | backwards scan for the last open entry `run-queue-projection.ts:686-708`; the beat-span deferral and its trigger are stated and still open | **P** |
| 34 | `#### D258 — the timeline event id carries the OCCURRENCE ordinal` L1636 | `track-c` | done-as-built | `queries/run-detail.ts:660-691` | **S3** (its home is the timeline) |
| 35 | `### 2.4 One command protocol with strict target families` L1673 | `p1-kernel` · `def-settings` | needs-attention | the nine families and every action name are exact (`src/domain/commands.ts:33-79`, `COMMAND_FAMILY_REGISTRY:449-459`) and `apply-settings` is correctly the one deferred arm (`command-kernel.ts:141-148, 2467-2477`). Three sketch blocks have drifted: `CommandActionId` omits `resolve-gate` which `ActionCommandKeySchema` carries (`actions.ts:47-50`); `ActionDescriptorWire`'s shape is wrong in both arms (`actions.ts:73-104` — `key`/`intent`/`placement[]`/`confirm`/`resolution`/`writeTarget`, and `navigate:{kind:self\|panel\|drill}`; there is no `ActionFormWire`); and the Enqueue row's `supersede-active` sentence needs the split in §3 C6 | **C** |
| 36 | `### 2.5 Non-rebuildable SQLite recovery contract` L1836 | `p1-authority` · `p2-2j` | done-as-built | boot checks, the 15-minute dirty-only cadence (`compose.ts:268,275,467-486`), the doctor (`queries/storage.ts:28-46`), and the two named remainders (retention sweep, configurable path) are all accurate | **S10** |
| 37 | `#### D181 — the restore command, and the process locks` L1909 | `p2-2j` | done-as-built | `src/server/storage/compose.ts:220-306`, role locks `dashboard/compose.ts:346-350` + `worker/compose.ts:348-352`, proof age 5 min `:56-61` | **S10** |
| 38 | `### 2.6 Durable single-operator notifications` L1996 | `p2-2g` · `platform-fixes` · every `*-dash` | needs-attention | the durable model, the fold, D222's storage watch and D262's gate-park watch are all as-built (`src/services/notifications/{inbox,storage-health,gate-park}.ts`, index `migrations.ts:812-842`). **Five of the seven trigger arms have no producer** — `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure`, `verified-done` (§3 C4). The `interface NotificationWire` sketch is already marked SUPERSEDED in place and should be deleted rather than layered | **S6** |
| 39 | `## 3. Descriptor fields this layer consumes` L2149 | `p1-authority` | done-as-built | emit-time validation and the retired fourth clause | **DF** |
| 40 | `### 3.1 Read from ref workflow-model's descriptor` L2158 | `p1-authority` | needs-attention | the list omits `timeline` (D225) and `subjectProjection`, both of which this layer reads (`base/workflow.ts:244-249`, `run-subject-title.ts`) | **DF** |
| 41 | `### 3.2 Contributed by this doc, adopted into ref workflow-model's descriptor` L2166 | `p1-authority` | needs-attention | `details` (D254's restated meaning), `capabilities`, `enqueue`, `actions`, `scenarios`, `presentation` are real. `StepDisplayRule`, `GateProjectionDefinition` and `artifactProjections`' `ArtifactSinkId` registry are **not implemented as named** — `artifactProjections` is read by the executor (`run-executor.ts:1078`) with no declaring descriptor; no `xlsx-retention` sink exists | **DF** + a to-build line |

### 1c · §4–§8 — completion, cutover, guards, the worked example (sections 42–57, L2216–L2761)

| # | section (line) | node(s) | class | evidence | home |
|---|---|---|---|---|---|
| 42 | `## Phase 1e as-built completion + delegation-manifest delta` L2216 | `p1-authority` | done-as-built | both `deriveItemId`s return `ItemId` (`src/domain/workflow/completion.ts:170,177`); the seal + `revealCompletionProgram` `:208-228`; D105's manifest corrections `src/domain/dependencies.ts:71-108` | fold into **DG** |
| 43 | `## 4. Unified completion contract` L2248 | `order-4` · `order-5` | to-build | the typed layer is fully built and guarded; **nothing declares or executes it** — `grep "completion:" src/workflows/` = 0 | **DG** |
| 44 | `### 4.1 The typed staged completion program` L2257 | `order-4` | needs-attention | the contract is faithful and mechanically proven (`completion.ts:268-312`, `defineCompletionProgram:321-349`). The code fence names `src/descriptor/completion.ts`; the real path is `src/domain/workflow/completion.ts` | **DG** |
| 45 | `### 4.2 Cross-spec borrowing becomes impossible` L2329 | `order-4` | needs-attention | mechanism 2 (the seal) is built and guarded (`descriptor-coverage.test.ts:520-529`). Mechanism 1's home — `src/forms/shared/eligibility.ts`, `defineFormSpec`, `extendFormSpec` — **does not exist**; `definePredicate` is the built substitute (`completion.ts:141-154`) | **DG** |
| 46 | `### 4.3 Intent-derived child shape and stage consumption` L2351 | `order-4` | to-build | `CompletionConsumptionSpecSchema` + `CoordinatorPolicySchema` exist (`completion.ts:353-367`); no descriptor declares either, and there is **no `displayOnly` field** on `run.queued` | **DG** |
| 47 | `### 4.4 Durability: the approval manifest` L2384 | `order-4` | to-build | `ocr_approvals` is an OPAQUE table with no strict schema and no production writer (`migrations.ts:295,455`; `authority-database.ts:3764`); no claim/lease/heartbeat/recovery exists | **DG** |
| 48 | `### 4.5 oath-upload — owner-consumes via a sibling born-at-upload task` L2398 | `order-7` | to-build | no `oath-upload` workflow, no `subscribeToApproval`, no approval-subscription gate | **DG** |
| 49 | `### 4.6 verify — in-run enrichment, not completion` L2422 | `order-4` | to-build | the parallel `all-settled` join it needs is a typed seam that refuses by name (`src/core/run-executor.ts:1350-1356`) | **DG** |
| 50 | `## 5. Cross-repo runtime boundary and one cutover` L2432 | `cutover` · `p1-base` | done-as-built | the live half: `config/runtime-isolation.json` schemaVersion 3, `operational-isolation.test.ts`, the `legacy:` scheme `src/domain/runtime-environment.ts:12-15`, D216's narrowing | **X** |
| 51 | `### 5.1 The seam: one direction, one place` L2506 | `cutover` | superseded | inside the doc's own `<details>` "superseded by D88/D89/D93; **do not implement**" block (L2499–L2634). `grep liftLegacy\|compat/\|temp_src src/` = 0 — correctly absent | → `history/superseded/2026-08-21-dashboard-surfaces-coexistence-design.md` |
| 52 | `### 5.2 The mapping — from the kernel terminal contract (D12)` L2545 | `cutover` | superseded | same block; no legacy status/pseudo-step decoder anywhere | same file |
| 53 | `### 5.3 Source authority — immutable per run` L2583 | `cutover` | superseded | same block; `RunRecord` carries no `engine`/`cutoverGeneration` (`src/domain/run/record.ts`). **This one is cited outside the block as if live** — see §3 C9 | same file |
| 54 | `### 5.4 The flip is SCOPED (D13), then per-workflow migration` L2595 | `cutover` · `migrations` | superseded | same block; `config/legacy-capabilities.json` sets `proxyDispositionAllowed: false`, which makes the "proxied long tail" structurally forbidden | same file |
| 55 | `## 6. Adversarial self-review — how this rots` L2638 | REFERENCE | needs-attention | 19 rot vectors, most with a real guard in `guard-inventory.json`. Three name a guard that does not exist: row 1 (`src/dashboard` may not contain `workflow ===`), row 7 (`interrupted` derived for an open span whose worker pid is dead — `interrupted` appears only as an outcome enum value, never derived), row 10 (a grep guard on `note.message`). Rows 9/11's `one-time-import-offline` is `status: planned` with no subject | **REF**, per-row reconciled against `guard-inventory.json` |
| 56 | `## 7. Worked example — operation coordinator flow` L2664 | `order-5` | reference | an illustration of a shape nothing can mint today (§3 C2); keep as the worked example the completion contract is read against, with one sentence saying so | **DG** |
| 57 | `## 8. Settled design questions and one volume monitor` L2737 | REFERENCE | reference | four closed questions; item 1's 30-day floor is as-built | **REF** |

### 1d · §9 — the row-model decisions D5–D24 and the shell (sections 58–79, L2762–L3428)

The whole block is the presentation half R9 item 3 redistributes. Node column follows the map.

| # | section (line) | node(s) | class | evidence | home |
|---|---|---|---|---|---|
| 58 | `## 9. Ratified delegation and presentation decisions (D6–D24)` L2762 | `dash-defaults` | reference | the series preamble + the row-model-vs-`reference/decisions` collision warning; both must survive the redistribution | **S0** |
| 59 | `### Row-model D5 — a settled group collapses shut` L2796 | `order-4` | to-build | group rows render (`queue.tsx:849-1000`) but no `operation` run is ever minted (§3 C2), so the settle-collapse arm has never run against a real group | **S2** |
| 60 | `### D6 — oath-upload's signers are \`linked\`, not \`member\`` L2811 | `order-7` | to-build | `containment: "linked"` is served (`run-queue-projection.ts:1129-1131`); no oath-upload workflow exists | **S2** / **DG** |
| 61 | `### D7 — a packet still at OCR review shows its extracted count` L2831 | `order-3-dash` | to-build | no OCR workflow; the `review` section is enum-declared and **never served** (§3 C3) | **S3** |
| 62 | `### D8 — record approval exists only after Review` L2837 | `order-3-dash` | to-build | same | **S3** |
| 63 | `### D9 — rejected members never count toward done` L2847 | `order-4-dash` | to-build | `ContainmentSchema` has no `rejected` arm (`projection.ts:102-110`) — the doc's own vocabulary says three, the wire serves two | **S2** |
| 64 | `### D10 — depth-2 delegated lookups visible only from the OCR review row` L2855 | `order-3-dash` | to-build | no OCR review surface | **S3** |
| 65 | `### D11 — one member presentation at every count` L2862 | `order-4-dash` | needs-attention | `PersonWell`/`PersonLine` do not exist by those names; the well is `MemberWell`/`MemberLine` (`queue.tsx:731,765`). **The two numbers are wrong**: `--ds-h-member-well` is `calc(5 × 28px + 4 × 1px)` = **144px, five whole lines** (`tokens.css:484-486`), not "136px ≈ 5.67 rows … deliberately not 144px". And an **in-row expand to 20 lines** now exists (`--ds-h-member-well-open`, `queue.tsx:749`) that the entry never mentions | **S2** |
| 66 | `### D12 — the collapsed row shows the gate's age` L2908 | `operator-calls` | needs-attention | `gateOpenedAt` is served (`projection.ts:260-278`) and `StatusPill` suppresses the age for `waiting`; the operator call is open | **S2** |
| 67 | `### D13 — a failed \`linked\` child makes the parent \`Failed\`, with \`Re-upload\`` L2918 | `order-7-dash` | to-build | `liveMessage` serves the failure summary verbatim (built); `Re-upload` is not in `ActionCommandKeySchema` (`actions.ts:47-50`) | **S2** |
| 68 | `### D14 — a group of one still renders as a Group Row` L2925 | `order-4-dash` | to-build | the group shape exists; nothing mints it | **S2** |
| 69 | `### D15 — Person Lookup carries Search and Match as modes` L2930 | `order-1` | to-build | `src/workflows/person-lookup/descriptor.ts` declares one graph, no mode | **S1** |
| 70 | `### D16 — cancelling a group is tree-scoped, final, no dialog` L2942 | `order-4-dash` | needs-attention | the key is served (`queue-row-actions.ts:254` `cancel-tree`) and the footer titles it with its blast radius — but the surface **does** raise a confirm (`ActionConfirmWireSchema`, `actions.ts:65-71`; `confirm.body` counts the members), which is the opposite of "no confirmation dialog". Either D16's no-dialog half is superseded by the confirm-first pattern or the code is wrong; the doc must say which | **S2** |
| 71 | `### D17 — per-member confirmation numbers inline on the packet receipt` L2958 | `order-5-dash` | to-build | `receipt.tsx` (133 lines) renders no member table | **S3** |
| 72 | `### D18 — Status Bar pills: \`All\`, a composite \`Needs you\`, then the individual statuses` L2964 | `p1-spine` · `dash-defaults` | needs-attention | built exactly (`shell.tsx:514-658`, `needsYouCount` `shell-model.ts:278-291` over `awaiting-approval` + `blocked`). But its own vocabulary has drifted: the pill for `waiting` reads **`Review`**, not `Waiting on you` (`primitives-status.tsx:123-127`), and `Needs you` survives as the composite pill and the queue BAND label only. Its 2026-07-28 amendment (banner deleted, inline decision, `defaultTabFor` puts logs first for a failure) is as-built (`log-panel-model.ts:42-49`, `log-panel.tsx:531-596`) | **S13** + **S3** |
| 73 | `### D19 — run-detail tabs derive from panel kind; screenshots in Receipt; Data in Context` L2997 | `dash-defaults` · `track-b` | needs-attention | (a) built as a served set, not a fixed one (`tabsFor` `log-panel-model.ts:30-33`) — **but `review` and `people` are never served, so the real set is Logs + Receipt** (§3 C3). (b) Receipt owns the tiles. (c)/(d) the rail is built for reads (`context-rail.tsx`, `--ds-w-context-rail-wide` 520px `tokens.css:545`); the two named-open arms (`Load a prior run` / `Start a run from this data`; `actions[]` gating at the `data` placement) are **still open**. `context-evidence` is fetched and rendered nowhere (§3 C5) | **S3** + **S4** |
| 74 | `### D20 — \`Write parked\` means an unknown write outcome` L3074 | `p2-proof` | done-as-built | the two typed resolutions and nothing else (`park-resolve.tsx:6-12`, `park-resolve-model.ts:13-18`); the wire refuses a write target on any other verb (`actions.ts:104-125`) | **S5** |
| 75 | `### D21 — every step segment is the same width; the duration is printed` L3094 | `dash-defaults` | done-as-built | `flex-1 basis-0` on every segment (`log-panel.tsx:334`, `:456`); hatch for `blocked` `:355`; outlined-empty for not-reached; the three legible states as described | **S3** |
| 76 | `### D22 — the status vocabulary shortens: \`Verified done\` renders as \`Done\`` L3151 | `dash-defaults` · `track-b` | needs-attention | as-built (`primitives-status.tsx:167-176, 232-245`), including the accessible-name channel. Its own closing "reconciliation debt" paragraph cites `docs/rebuild/reference/operator-trust.md:284` by LINE — that pointer must be re-resolved or dropped in the rewrite | **S13** |
| 77 | `### D23 — the motion rule is narrowed on purpose` L3192 | `dash-defaults` | done-as-built | `useAttentionAnnounce` `queue-model.ts:182-200`, `ATTENTION_ANNOUNCE_MS = 900` `:163`, applied once `queue.tsx:1157`; `DS_ATTENTION_STATUSES = ["waiting","failed"]` `primitives-status.tsx:268` | **S0** |
| 78 | `### D24 — a professional dashboard does not explain itself` L3215 | `dash-defaults` | done-as-built | the ⓘ pattern is everywhere (`RowInfo` `queue.tsx:439-487`, the activity ⓘ `activity.tsx:1141-1160`); `src/dashboard/DESIGN.md` is the binding companion | **S0** |
| 79 | `### Shell and layout as rebuilt` L3239 | `p1-spine` | needs-attention | mostly exact: grid at `min-[1180px]` with `--ds-w-side-panel: 376px` (`dashboard-app.tsx:1221`, `tokens.css:537-538`), the three panel modes (`shell-model.ts:153-167`), `w` cycling and the whole key map (`global-keys.ts:105-217`), the action-bar island (D224), the context menu, D219/D220/D241's grouping rules (`workflow-category.ts`). Two corrections: the "detail cell splits at 1280" is as-built a **container** query at `@min-[868px]/detail` and `@min-[1068px]/detail` (`log-panel.tsx:1735-1772`, `layout-metrics.ts:49-50`) — the doc states the principle and then names window numbers; and `--ds-w-context-spine` (the collapsed rail) is unmentioned | **S13** |

### 1e · §10–§13 — counts, archive, naming, intake, capture, the takeovers (sections 80–109, L3429–L4070)

| # | section (line) | node(s) | class | evidence | home |
|---|---|---|---|---|---|
| 80 | `## 10. Round-8 obligations this doc owns` L3429 | `p2-2i` | reference | block header for 81–87 | dissolve into **S7**/**S8**/**S2**/**S6** |
| 81 | `### 10.1 ONE projection owns every count (D81)` L3434 | `p1-spine` · every `*-dash` | done-as-built | `buildActivityReportWire` `run-queue-projection.ts:1538-1710` (refuses while degraded `:1539-1543`); the day wire's counts all fold from one `surfaces` array `:1428-1440`; `one-projection-counts` guard is `active` in the inventory | **S8** |
| 82 | `#### D236 — the write-ledger carve-out` L3457 | `track-b` · `sep-dash` | done-as-built | the ledger port `run-queue-projection.ts:157-172`, passed unfolded `:1703-1709`; the seam printed in the block's subtitle `activity.tsx:977-980` and in the CSV `activity-export.ts:182-192` | **S8** |
| 83 | `### 10.2 Versioning and archive-on-version-bump (D80)` L3511 | `p2-2i` · every `*-dash` | needs-attention | rules 1–3 are as-built (`archive-service.ts:279`; `command-kernel.ts:2225-2250`; `:2137-2153` re-derives blockers inside the applying transaction). **Rule 4 — "Hide/Unhide still exists for same-version runs (D49)" — is dead**, retired by D234 fifty sections earlier and by `actions.ts:47-50`. This is the doc's sharpest internal contradiction | **S7** |
| 84 | `#### D179 — the archive model as-built` L3550 | `p2-2i` | done-as-built | the three v13 tables and their six `RAISE(ABORT)` triggers (`migrations.ts:389-435, 911-966`); the frozen label + D242 code from ONE registry lookup (`archive-service.ts:253-258`, call site `command-kernel.ts:2195-2210`); `appVersion` read-forward `:265-267`; the read path resolves nothing (`queries/archive.ts:6-12`) | **S7** |
| 85 | `#### D223 as-built — frozen sections, Export, the change record` L3645 | `track-b` | needs-attention | generation 2, the four frozen sections and the described capture tiles are exact (`queries/archive.ts:383-542`); Export writes the held wire verbatim (`archive.tsx:1094-1123`); the change record is authored at plan time (`archive.tsx:1923-1926`, copied verbatim `command-kernel.ts:2178-2181`). Its own closing item is **unmeasured**: *"The measured per-run delta is owed in this block once a real archive exists"* — no production database has archived a run | **S7** |
| 86 | `### 10.3 Operator-assigned run display names (D83)` L3764 | `track-b` | done-as-built | `displayName` served in its own right (`projection.ts:295-312`), the `rename` command and its bounds (`commands.ts:247-255`), the dialog and its draft rule (`rename-draft.ts:37-58`) | **S2** |
| 87 | `### 10.4 Notification model (D79b + D86)` L3773 | `p2-2g` | needs-attention | the routing table is implemented exactly (`projectNotificationTrigger` `src/domain/notification-triggers.ts:151-217`). But the **bell's `Pings` and `Inbox` filter chips both read 0 always** — `delivery` is a client-side optional extra never on the wire (`top-bar.tsx:541-547, 624-627`), so the surface that renders the routing cannot see it | **S6** |
| 88 | `## 11. The intake workspace — the surface contract` L3789 | `p2-2i` · `order-6-dash` | done-as-built | header | **S11** |
| 89 | `### 11.1 Proposed against decided is a PLACE, not a colour` L3795 | `p2-2i` | done-as-built | two real columns (`intake.tsx:459-476`), `BoundColumnCell:504-546` solid, `SuggestionCell:557-613` recessed+dashed with `Use it`, ambiguity stated with no visual preference `:605` | **S11** |
| 90 | `### 11.2 The grid's rows are the WORKFLOW's fields` L3812 | `p2-2i` | done-as-built | `session.targets.map` `intake.tsx:449`; targets from the workflow projection `intake-service.ts:134-142, 250` | **S11** |
| 91 | `### 11.3 It is a workspace at \`?intake=<sessionId>\`` L3819 | `p2-2i` | done-as-built | `url-state.ts:24, 91, 104, 132`; hides rather than dims (`dashboard-app.tsx:1027-1049`); the sticky outcome band `intake.tsx:946` | **S11** |
| 92 | `### 11.4 Readiness is DERIVED for courtesy and JUDGED by the kernel` L3833 | `p2-2i` | done-as-built | courtesy blockers `intake.tsx:933-938`; authority `command-kernel.ts:1547-1574` over `enqueueReadiness` `src/domain/intake/manifest.ts:525-549`; the refusal rendered verbatim `intake.tsx:207-215` | **S11** |
| 93 | `### 11.5 The destructive act names its cost` L3844 | `p2-2i` | done-as-built | `intake.tsx:260-269, 330-360`; the banner ARRIVES via `useDsEnterTransition` `:186-199` | **S11** |
| 94 | `### 11.6 Which control is in flight` L3851 | `p2-2i` | needs-attention | true for the five keyed buttons (`bind:`, `fix:`, `exclude:`, `validate`, `run`); **`inspect` and `upload` have no spinning control** — the Sheet/Header selects only disable (`intake.tsx:299, 317`) and the Dropzone takes `busy` (`:1198`) | **S11** |
| 95 | `### 11.7 As-built notes` L3857 | `p2-2i` | needs-attention | `Dropzone` (`primitives-form.tsx:666-678`), `requestJsonResponse` (`transport.ts:42,98`) and the `Banner` spread finding are exact. **The size-cap claim is wrong**: the hint and `accept` are hardcoded literals (`intake.tsx:115, 1196`) while the server constants sit unimported at `intake-service.ts:60, 66-70` — and "25 MB" is 25 MiB. The `constants`/unbind deferral is still accurate (`intake.tsx:526-529`) | **S11** |
| 96 | `## 12. The capture phone surface` L3885 | `p2-2i` · `def-byte-path` | done-as-built | header | **S12** |
| 97 | `### 12.1 The use scene picks the theme` L3891 | `p2-2i` | needs-attention | the phone does select the light palette, but the attribute value is `light` (`capture.html:2, 22`; `theme.ts:39`) — `Paper Ink` is the palette's product name, not the token value. Two vocabularies, one fact; the doc should say both | **S12** |
| 98 | `### 12.2 It is ONE page whose bottom bar changes verb` L3901 | `p2-2i` | done-as-built | `capture-app.tsx:18-29, 541-554`; three verb sets `:338-358, 412-429, 446-465`; no router anywhere in `src/dashboard/phone/` | **S12** |
| 99 | `### 12.3 Order is meaning — a numeral and a button, never a drag` L3909 | `p2-2i` | done-as-built | `photo-tile.tsx:48-49, 80-82, 136-143`; `grep draggable src/dashboard/phone/` = 0; reorder is a server round trip `capture-app.tsx:225-231` | **S12** |
| 100 | `### 12.4 The camera is the platform's, not ours` L3917 | `p2-2i` | done-as-built | `phone-controls.tsx:165-191` (`<input type="file" accept="image/*" capture="environment">` in a `<label>`), value reset `:185`, cancel returns without a guess `:186-188` | **S12** |
| 101 | `### 12.5 A failure is the server's own sentence, in reserved space` L3924 | `p2-2i` | done-as-built | `NoticeSlot` `capture-app.tsx:510-534` (`min-h`, always in the DOM, `role="alert"`); the server refuses to substitute a sentence `capture-service.ts:206-213` | **S12** |
| 102 | `### 12.6 The QR is the operator's half, and the token exists once` L3933 | `p2-2i` · `def-byte-path` | needs-attention | the fragment, the digest-only durable row and the uniform refusal are exact (`capture-surface.ts:60-83`, `capture-service.ts:247-259`). Two corrections: the token is **not single-use** — it is re-presented on every phone request and bounded by TTL (`capture-service.ts:221-245`); and "Start Capture is a small control inside the existing dashboard" is as-built **only inside the intake takeover's empty/refused dropzone state** and vanishes once a session loads (`intake.tsx:1182-1206`) | **S12** |
| 103 | `### 12.7 As-built notes` L3943 | `p2-2i` | done-as-built | separate Vite entry `vite.dashboard.config.ts:41-44`; the generalised `*.html` walk + phone-scope arm `dashboard-wire-boundary.test.ts:43-51`; house motion tokens `phone.css:101-115`; red reserved for Discard `phone-controls.tsx:30`; the 15 + 12 parity references match `tests/parity/references/` | **S12** |
| 104 | `## 13. The two reference takeovers` L3982 | `p2-2i` | done-as-built | header | **S9** |
| 105 | `### 13.1 A read-only explorer must not look like an editor` L3987 | `p2-2i` · `def-explorer-edit` | done-as-built | read-only is structural — the client has no mutating method (`queries.ts:246-247`) and the surface says so on screen (`explorer.tsx:1339-1342`); the only pencils are read-only indicators `:1109-1137` | **S9** |
| 106 | `### 13.2 A structure rail beside a record column` L4000 | `p2-2i` | done-as-built | the graph rail, the declared `when` in words (`node-condition.ts:125-135`, rendered three places), the census (`explorer-model.ts:44-70`), the container query asked from a wrapper | **S9** |
| 107 | `### 13.3 One saturated mark, spent on consequence` L4019 | `p2-2i` | done-as-built | only `transaction` tinted in the explorer; `observation` + non-`observe` `effect` in the catalog | **S9** |
| 108 | `### 13.4 They are takeovers, and precedence is resolved in one place` L4029 | `p2-2i` | needs-attention | the ONE resolver is real (`url-state.ts:129-142`) and better than the doc says — there are **five** takeover keys, not three, and the order is `intake → archive → activity → explore → catalog`. The doc's "Three takeover keys … (`intake` → `explore` → `catalog`)" predates the archive and activity surfaces | **S9** |
| 109 | `### 13.5 As-built notes` L4046 | `p2-2i` | done-as-built | `ChipRow`'s width argument, `--ds-w-explorer-measure: 1120px` (`tokens.css:557`), the `10002992 → 4h` rule, inherited motion, real-projection parity fixtures | **S9** |

---

## 2 · The per-surface structure the rewrite produces (R9 item 3)

**One section per wire square**, in the order the tree's `builds:` lines already use (`run modal · queue row · run detail · gate ceremony · archive · explorer · activity · notifications`), with the cross-surface contracts kept as their own numbered sections because they are what every square binds to. `S`-codes below are the ledger's; the real numbering is §6's open ruling.

A section's status block follows plan §3.4: tick lines with the commit or D, then exactly ONE dated note `> 2026-08-2x | docs-dash-surfaces rewrite | verified against <files>; left: …`.

### The cross-surface half (kept numbered, cited by 33 nodes)

| § | name | tag | folds in | status block will say |
|---|---|---|---|---|
| **S0** | House rules for every surface | `dash-defaults` | 1, 18, 58, 77, 78 | `[x]` D23 the attention edge, once, two statuses (`queue-model.ts:163,182-200`) · `[x]` D24 the ⓘ rule and `DESIGN.md` as binding · `[!]` D12's gate age is served and not drawn — an operator call (`{#operator-calls}`) |
| **P** | The projection and the wire | `p1-spine` | 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 42 (residue of 2–5) | `[x]` D218 the disk tail, one cursor, two triggers (`run-queue-projection.ts:428-513`) · `[x]` D255 the open-entry bind · `[x]` D254 the retirement, verified against the state root · `[ ]` the notes stream has no production emitter (C1) · `[ ]` §1.1/§2.2's TS sketches re-derived from `src/events/types.ts` and `src/domain/dashboard/projection.ts` |
| **C** | The command protocol | `p1-kernel` | 6, 35 | `[x]` nine families, 33 actions, one exhaustive dispatcher (`commands.ts:33-79`, `command-kernel.ts:141-171`) · `[x]` CAS on every run verb (D233/D234) · `[ ]` `apply-settings` deferred (`{#def-settings}`) · `[ ]` the `ActionDescriptorWire` sketch replaced by `actions.ts:73-125` |
| **DF** | Descriptor fields this layer consumes | `p1-authority` | 39, 40, 41 | `[x]` `details` as a declaration with three readers (D254) · `[ ]` `timeline` + `subjectProjection` added to §3.1 · `[ ]` `StepDisplayRule` / `GateProjectionDefinition` / the `ArtifactSinkId` sink registry have no implementation |
| **DG** | Delegation, group rows and the completion contract | `order-4` (+ `order-5`, `order-7`) | 43–49, 56, 59, 60, 63, 68 | `[x]` the sealed typed program, proven at construction (`completion.ts:268-349`) · `[x]` D105's manifest corrections · `[ ]` nothing declares a completion program · `[ ]` no `operation` run is ever minted (C2) · `[ ]` no approval manifest, no child-run executor, no `displayOnly` |
| **X** | Cross-repo boundary and cutover | `cutover` | 50 (51–54 leave) | `[x]` physical separation, one-machine isolation pinned and guarded · `[x]` D216's one narrowing · `[ ]` `legacy-capabilities.json` zero-open at cutover: 47 open today |
| **REF** | Adversarial self-review · settled questions · what exists today | — | 22, 55, 57 | no status block (reference matter); §6's three unguarded rows get a note |

### The per-surface half (one section per wire square)

| § | name | tag(s) | folds in | status block will say |
|---|---|---|---|---|
| **S1** | The run modal — the start door | `sep-dash`, `order-*-dash`, `dash-defaults` | 69 | `[x]` D250/D251 the four rows, three read from the bundle (`run-start.tsx:841-1005`) · `[x]` D261 the typed start surface takes ONE box · `[ ]` D15 person-lookup's Search/Match modes (`{#order-1}`) · `[!]` `supersede-active` says two different things in two files (C6) |
| **S2** | Queue rows, the bulk strip, and the row model | `track-b`, `sep-dash` | 7 (D124), 8, 9, 10, 11, 12, 15, 16, 21, 59, 60, 63, 64, 66, 67, 68, 70, 86 | `[x]` D230–D235 every second-batch fact served and drawn · `[x]` D124 `endedAt` · `[x]` D83/D233 rename · `[x]` D234 runs and archived runs · `[ ]` D9's `rejected` containment arm is not on the wire · `[ ]` D13's `Re-upload` · `[!]` D11's two well numbers are wrong and its in-row expand is unrecorded (C7) · `[!]` D16's "no dialog" versus the served confirm (C8) |
| **S3** | Run detail — header, timeline, tabs, receipt, failure record | `dash-defaults`, `track-b`, `track-c` | 7 (D123), 13, 14, 17, 20, 34, 61, 62, 64, 71, 72 (part), 73, 75 | `[x]` D19 the served tab set · `[x]` D225 the categorical fold and D259's `replayed` arm · `[x]` D258 the occurrence ordinal · `[x]` D257 the panel follows its run · `[x]` D21 equal-width segments · `[x]` D187 `w-full` (`log-panel.tsx:1754`) · `[ ]` `review` and `people` are never served (C3) · `[ ]` no parity reference photographs the categorical strip · `[ ]` D17's per-member receipt table |
| **S4** | The Context rail — Data, Edit Data, provenance | `track-b`, `p2-2i` | 73 (c/d) | `[x]` D168/D252 the rail's Data section, direction and bound from the declaration (`context-rail.tsx`, `context-rail-model.ts:151-206`) · `[x]` D253 both refusal arms through `settleCommandResult` · `[ ]` `Load a prior run` / `Start a run from this data` · `[ ]` `actions[]` gating at the `data` placement · `[!]` `context-evidence` is fetched and rendered nowhere (C5) |
| **S5** | Gate ceremonies and park resolutions | `sep-dash`, `dash-defaults` | 74 | `[x]` D226 the three ceremonies + rejection, shape from the server (`identity-ceremony.ts:114-148`) · `[x]` D237 the settled decision record inline at `resolvedAt` · `[x]` D20 two typed exits and nothing else · `[x]` D211 the write plan inside the packet |
| **S6** | Notifications — the durable inbox and the bell | `p2-2g`, `platform-fixes`, every `*-dash` | 38, 87 | `[x]` D134 the fold, D138 the ordering, the closed trigger union · `[x]` D222 storage-degraded, D262 the gate park · `[ ]` five of seven trigger arms have no producer (C4) · `[!]` the bell's `Pings`/`Inbox` chips can never be non-zero |
| **S7** | Archive | `p2-2i`, `track-b` | 83, 84, 85 | `[x]` D179 the v13 tables, insert-only in SQL · `[x]` D242 the frozen code beside the label · `[x]` D223 generation 2, five tabs, Export · `[ ]` §10.2 rule 4's Hide/Unhide sentence deleted (C11) · `[ ]` the per-archived-run storage delta is unmeasured |
| **S8** | Activity | `p1-spine`, every `*-dash` | 80, 81, 82 | `[x]` D81 one projection, one count path, `one-projection-counts` active · `[x]` D236 the write-ledger carve-out, bounded both ways · `[x]` D239 hours-saved dropped · `[x]` D240 the CSV with its caveats block first |
| **S9** | The Workflow Explorer and the UI catalog | `p2-2i`, `def-explorer-edit` | 104–109 | `[x]` D176/D177 read-only structurally · `[x]` D227–D229 census, declared `when` in words, descriptor prose · `[!]` the precedence sentence names three keys; there are five (C12) · `[ ]` D186 the EDIT half, with its named trigger |
| **S10** | Settings and the storage doctor | `p2-2j`, `def-retention` | 4 (residue), 36, 37 | `[x]` 2i-D the cadence and the two health readings · `[x]` D181 `cli storage restore` and the role locks, drilled · `[x]` D222 the banner narrowed to authority-unavailable · `[ ]` the 14/8/5 retention sweep (`{#def-retention}`, D193 `wont-build-unless-asked`) · `[ ]` a configurable backup path |
| **S11** | Intake and Edit Data | `p2-2i`, `order-6-dash` | 88–95 | `[x]` D173 all seven surface decisions · `[!]` the Dropzone hint is hardcoded, not the server's constants (C13) · `[!]` two of seven command keys carry no spinner · `[ ]` a run-wide constant arm and an unbind arm · pointer to `reference/data-intake-and-edit-data` for the FLOW |
| **S12** | The capture phone surface | `p2-2i`, `def-capture-binding`, `def-byte-path` | 96–103 | `[x]` D175 every decision, verified · `[!]` the token is TTL-bounded, not single-use (C14) · `[!]` Start Capture lives only inside the intake takeover's empty state · `[ ]` D189 the BFF serves no frontend bytes and `dashboard:prod` is a name nothing parses, so the surface has no delivery path |
| **S13** | The shell — top bar, status pills, worker cards, keys, theme | `p1-spine`, `dash-defaults` | 7 (D126), 19, 72, 76, 79 | `[x]` D18 the pill row and the composite · `[x]` D22 + D126 the two Dones and the accessible channel · `[x]` D219/D220/D241 the grouping rules · `[x]` D224 the action-bar island · `[x]` D256 the served clock, one caller · `[!]` the drawn word for `waiting` is `Review`, not `Waiting on you` (C15) · `[!]` D256's capture measurement is superseded by Track C's re-freeze · `[ ]` the breakpoint table restated as container queries |

### What goes to `history/superseded/`

| file | what it holds | why |
|---|---|---|
| `2026-08-21-dashboard-surfaces-phase-1c-stage-deltas.md` | sections 2, 3, 4, 5 (L40–L152) | four dated stage narratives whose normative residue is already in §2.3/§2.4/§2.5 and in `src/`; their "Phase 1c remains in progress" framing is dead. Fold, do not layer (R9 item 1) |
| `2026-08-21-dashboard-surfaces-coexistence-design.md` | sections 51, 52, 53, 54 (L2499–L2634, the whole `<details>` block) | already labelled *superseded by D88/D89/D93 — do not implement*; keeping a 130-line unbuildable contract inside a live reference doc is what R6 moved to `history/` |
| `2026-08-21-dashboard-surfaces-amendment-log.md` | the L1–L27 dated amendment chronology | eleven "Amended YYYY-MM-DD" paragraphs; each amendment's content already lives in the section it amended. The rewritten header states what the doc IS |

Each gets a one-line successor header and a row in `docs/rebuild/history/README.md`'s table.

---

## 3 · Contradictions — where the prose and the code disagree

The rewrite corrects the **prose**. Where the code looks wrong, that is said and the finding is filed, never silently "fixed" in a doc.

### The five that matter most

**C1 — the notes stream has no production emitter, and three sections describe it as the Log Panel's source.**
Doc §1.1: *"**Notes** (high-volume annotations — log lines, screenshots, per-action records, data points) are a parallel stream"*; §1.2: *"Timeline / log panel ← run span tree's **notes** ⊕ the owning worker span's lifecycle events"*; §2.1: *"`grep ou-1430 .tracker-rebuild/notes/*.jsonl` answers **what it did**"*.
Code: `emitNote` exists (`src/infra/events/note-jsonl-writer.ts:50,69`) and the writer is composed and exposed (`src/server/dashboard/compose.ts:572, 885`) — and **no caller in `src/` ever invokes it**; the only callers are three test/fixture files. The worker logs to stdout instead (`src/server/worker/compose.ts:128, 333`). At D254's own evidentiary bar: **`.tracker-rebuild/notes/` does not exist** — nine span files, no notes directory. The run-detail Logs section re-reads that stream per request (`src/server/dashboard/queries/run-detail.ts:806-814`), and `defaultTabFor` opens a **failed** run on it (`log-panel-model.ts:42-49`). This is `span.patched`'s shape one stream over, on the surface a failure lands on. It is what `{#observed-logs}` is about, and the tree does not currently say the gap is total.

**C2 — no `operation` or `operation-member` run has ever been minted, and §9's whole group model presumes one.**
Doc §1.3: the four shapes are *"kept — they are the proven queue vocabulary"*; §9 D5/D9/D11/D14 and §7's worked example are all about group rows.
Code: every enqueue path stamps `shape: "single"` — `src/core/command-kernel.ts:1617, 2274`, `src/core/capture-intake-handoff.ts:242`, `src/server/dashboard/commands/start-plan-service.ts:116` — and the kernel says so itself at `command-kernel.ts:1608-1612`: *"the coordinator/member fan-out has no runtime yet (nothing mints an `operation` run)"*. The projection, the containment fold, `memberRollup`, `memberPreview`, the member well and the `run-group`/`run-member` parity references are all real and all fed by hand-composed fixtures. This is presentation for a shape the system cannot create — correct to build ahead of the workflows, and the doc must say it is ahead.

**C3 — four of the eleven declared run-detail sections can never be served.**
Doc §D19(a): *"Tabs derive from the panel kind … the sets are Run 2 · Review 3 · Group 3 · Member 2 — `Logs · Review · Receipt`, plus `People` on a group"*.
Code: `RunDetailSectionSchema` declares eleven arms (`src/domain/dashboard/primitives.ts:26-29`) and `availableSections` returns at most seven (`src/server/dashboard/queries/run-detail.ts:369-396`) — `review`, `people`, `captures` and `context-evidence` are never in it, and `buildRunSection` **throws by name** for them (`:842`). The client renders `review`/`people` as `UnservedTab` (`log-panel.tsx:1219-1228, 1965`). So the real tab set is **Logs + Receipt**, and two of the doc's four panel kinds have no distinct set.

**C4 — five of the seven notification triggers have no producer.**
Doc §2.6: *"Triggers are closed and base-owned: run failure, subject mismatch, open operator gate, unknown write outcome, storage degradation, stalled lease/outbox, and failed backup."* §10.4 routes all six D79b keys.
Code: `grep '\.publish(' src/` returns exactly two production callers — `src/services/notifications/storage-health.ts:80` (`storage-degraded`) and `src/services/notifications/gate-park.ts:119` (`gate-opened`). `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure` and `verified-done` are schema-declared, routed, rendered and unreachable. D222 and D262 each closed one arm and each named the shape; the doc never says how many are left.

**C11 — §10.2's rule 4 is dead and sits inside the live archive contract.**
Doc §10.2: *"**Hide/Unhide still exists** for same-version runs (reversible presentation tombstone, D49). Archive-on-bump is the automatic path; Hide is the manual one."*
Doc §D234, fifty sections earlier: *"The `hide`/`unhide` presentation pair is RETIRED across the whole stack. This section is the normative text; every earlier sentence in this doc that describes hiding is superseded by it."*
Code: `ActionCommandKeySchema` (`src/domain/dashboard/actions.ts:47-50`) holds neither key; `RunRecord.hidden` is a parse-tolerated vestige written by nothing (`src/domain/run/record.ts:232-244`). D234 already claims the correction; the rewrite must actually make it, because a reader arriving at §10.2 from a `ref:dashboard-surfaces §10.2` citation never sees D234.

### The rest, in ledger order

| # | doc says | code does | cite |
|---|---|---|---|
| **C5** | D19: screenshot evidence and the evidence ledger have homes | `context-evidence` is fetched whenever advertised (`use-panel-sections.ts:17,22`) and handed to nothing — it is explicitly withheld from the rail (`log-panel.tsx:1693-1706`, `context-rail.tsx:1039-1045`) and no consumer of `sections["context-evidence"]` exists | as cited |
| **C6** | §2.4 Enqueue: *"`supersede-active` terminalizes the exact active generation and creates the new run atomically"* | true of the kernel (`src/core/run-fan-out.ts:112-127`) and false of the planner, which checks only `reject-active` (`src/services/start/plan.ts:191`). The run modal prints *"Declared, and not implemented — the planner supersedes nothing"* (`run-start-model.ts:46`) to the operator. All eight descriptors declare `reject-active`, so the arm is unexercised either way. **Two code sites disagree; the doc must state the split and the finding filed** | as cited |
| **C7** | D11: *"`--ds-h-member-well` = **136px ≈ 5.67 rows**. The half-cut sixth row IS the depth cue, which is why it is deliberately **not** 144px / 6 whole rows"* | `--ds-h-member-well: calc(5 * var(--ds-h-member-line) + 4 * var(--ds-border-w))` = 5 × 28 + 4 × 1 = **144px, five whole lines** (`tokens.css:484-486`, `layout-metrics.ts:60`). The half-cut cue is gone, and an in-row expand to **20** lines (`--ds-h-member-well-open`) exists that D11 never mentions (`queue.tsx:749`) | as cited |
| **C8** | D16: *"There is **no confirmation dialog and no undo window**; cancel commits immediately"* | the served `cancel-tree` descriptor carries an `ActionConfirmWireSchema` whose body counts the members (`actions.ts:65-71`, `queue-row-actions.ts:254`), and the row raises a confirm-first dialog | as cited |
| **C9** | §5.3: *"Every enqueue stamps `(engine:"legacy"\|"native", cutoverGeneration)` in the authoritative run record"* — and §5.3 is cited elsewhere as if live | it is inside the `<details>` *do not implement* block; `RunRecord` has no such field and no enqueue path writes one | `src/domain/run/record.ts`; block at L2499–L2634 |
| **C10** | §3.2/D254: `details` is *"no longer a patch-key validation set"* | `src/domain/workflow/presentation.ts:183-186` still documents it as *"The declared patch set: ref dashboard-surfaces validates every `SpanPatched` key against this list"* — a code comment the retirement missed | as cited |
| **C12** | §13.4: *"**Three** takeover keys can be present on one link, so `activeTakeover` resolves the winner in ONE place (`intake` → `explore` → `catalog`)"* | five keys, one resolver, order `intake → archive → activity → explore → catalog` (`src/dashboard/app/url-state.ts:129-142`); the mutual-exclusion-on-write rule clears all five (`dashboard-app.tsx:939-947`) | as cited |
| **C13** | §11.7: the Dropzone *"states what it takes and its size cap **from the server's own constants**"* | both are hardcoded client literals — `INTAKE_ACCEPT` (`intake.tsx:115`) and `hint="A .csv or .xlsx, up to 25 MB…"` (`:1196`) — while `INTAKE_UPLOAD_MAX_BYTES` and `INTAKE_UPLOAD_MEDIA_TYPES` sit unimported at `intake-service.ts:60, 66-70`. (25 × 1024 × 1024 is 25 MiB, printed as "25 MB".) | as cited |
| **C14** | §12.6: *"the token exists once"* — read by every later reader as single-use | minted once and stored only as a digest, but **re-presented on every phone request** and resolved fresh each time (`capture-service.ts:250-259`); the bound is TTL (`preConnectTtlMs`, `activeIdleTtlMs`, `:221-245`), not a use count. The sentence is defensible and is being read wrong; say TTL | as cited |
| **C15** | D12/D18/D22/D23 all name the status **`Waiting on you`** | the drawn word is **`Review`** (`primitives-status.tsx:123-127`). `Needs you` survives only as the composite pill (`shell.tsx:646-651`) and the queue band label (`queue-model.ts:62`). `Verified done` is likewise gone as a drawn word — both terminal dones say `Done` (D22, as-built) | as cited |
| **C16** | §1.1's `SpanEvent` type alias lists `SpanPatched`; `SubjectObserved` is shown as an emitted arm; `span.ended` carries `verdict` and `evidenceReceiptId`; the task span path is `…#<attempt>` | the wire union is 11 strict arms with no `span.patched`, and `subject.observed` is recorded at `src/events/types.ts:30` as a deliberate absence; `transaction.previewed` (`:167-184`) is missing from the sketch; `span.ended{task}` carries `outcome`/`failureId?`/`errorSummary?`/`notRunReason?` and no verdict (`:197-220`); the path is `<trace>/<node>#<claimGeneration>.<taskAttempt>` (`span-emitter.ts:205-213`) | as cited |
| **C17** | Section 12 (L562): *"There is still no operator-facing way to REACH `rename`"* | D233 (L433), twenty lines earlier in the same file, served it and built the dialog (`queue-row-actions.ts`, `dashboard-app.tsx:781-793`). The doc contradicts itself across two same-day as-built blocks | as cited |
| **C18** | D256: *"**139 captures fail and 12 behaviour cases pass**"* | that was the pre-re-freeze corpus; Track C's ONE deliberate re-freeze landed at **151/151 assert-green** (`{#track-c}`, commit `81287bb1`) and the corpus is 139 references × 3 files | `tests/parity/references/` |
| **C19** | §6 rows 1, 7, 10 each name a mechanical guard | none exists: no guard bans `workflow ===` under `src/dashboard`; `interrupted` is never derived from a dead worker pid (it is only an outcome enum value); there is no grep guard on `note.message`. Rows 9/11's `one-time-import-offline` is `status: planned` with no subject and an owner pointing at the dissolved master plan | `docs/rebuild/guard-inventory.json:382-389` |
| **C20** | §2.2's `EventsHubPayload` / `QueueSurfaceWire` | two generations behind `src/domain/dashboard/projection.ts:141-372` and `:795-814`; and the wire's only patch op is `replace-queue-surface` — `remove-queue-surface` and `tombstone-queue-surface` are declared at `src/domain/dashboard/subscription.ts:29-32` with **no producer anywhere in `src/`** | as cited |
| **C21** | §11.6: *"that control alone carries the spinner"* | true for five keys; `inspect` and `upload` have no spinning control (`intake.tsx:299, 317, 1198`) | as cited |
| **C22** | §12.1: *"the phone selects `paper-ink`"* | the attribute value is `light` (`capture.html:2,22`; `theme.ts:39`); `Paper Ink` is the palette's product name (`tokens.css:12`) and the parity label | as cited |
| **C23** | §4.1's fence names `src/descriptor/completion.ts` | `src/domain/workflow/completion.ts` | as cited |
| **C24** | §Ownership's "Where" column: `§§1–5, §9–10` | the doc has owned §11, §12 and §13 since 2i | L3789, L3885, L3982 |
| **C25** | §Shell: *"**≥ 1180** queue 376px … The detail cell splits itself again into shape · detail · context at 1280"* | the shell grid is a window query at `min-[1180px]` (`dashboard-app.tsx:1221`) and the detail split is a **container** query at `@min-[868px]/detail` / `@min-[1068px]/detail` (`log-panel.tsx:1735-1772`), derived as 1280−412 and 1480−412 (`layout-metrics.ts:36-50`). The doc states the container-query principle two paragraphs later and then leaves window numbers in the table | as cited |
| **C26** | §1.1's `GateResolved`: *"Descriptor-validated display/audit key"* | the command service hard-codes `resolutionKey: "resolved"` for every gate (`command-service.ts:250`), which is why D237 moved the reader to the durable `gate_results` row | as cited |

---

## 4 · To-build and needs-attention, rolled up by node

Candidate `builds:` lines are **suggestions for the orchestrator**, not edits. Nothing in this unit touched `docs/roadmap/roadmap.md`. Layer tags follow the tree's own vocabulary.

### `{#observed-logs}` — the biggest gap this audit found

Carries today: `BE` provenance points on the span at record time · `BE` transaction beats stream their observations · `FE` the log panel renders observed rows · `PROOF` a dry run reads as a ledger of page facts.
Missing, and it is the premise the four lines rest on:

```
- [ ] BE the notes stream has NO production emitter — `emitNote` is composed and never called, and
      `.tracker-rebuild/notes/` has never existed; the Logs section (and a failed run's default tab)
      reads a stream nothing writes (ref dashboard-surfaces §1.1 · §1.2 · §2.1)
```

### `{#track-d}` — dashboard hardening

Carries today: D1–D5 planned, D6–D11 proposed. D1 ("ONE `panelKindOf`", one status derivation) is confirmed by this audit: `panelKindOf` is duplicated at `run-detail.ts:250` and `run-queue-projection.ts:261`; `TASK_OUTCOME_*` at `run-detail.ts:437` and `:342`; and there is no `deriveRunStatus` — two mapping tables (`status-model.ts:70-96`) plus a third result table in `receipt.tsx:31-37` and a raw-`result` sentence in `log-panel-model.ts:67-72`.
Candidates for D2's hygiene row (each an unreachable declared arm, the shape D254 retired):

```
- [ ] BE `remove-queue-surface` / `tombstone-queue-surface` have no producer — build or retire
      (src/domain/dashboard/subscription.ts:29-32)
- [ ] BOTH `context-evidence` is fetched by the panel and rendered by nothing — give it a home or
      drop the section (ref dashboard-surfaces §D19; use-panel-sections.ts:17 vs log-panel.tsx:1693-1706)
- [ ] FE the notification bell's `Pings` / `Inbox` filter chips can never be non-zero — `delivery`
      is never on the wire (top-bar.tsx:541-547, 624-627)
- [ ] BE the `details` declaration's stale `SpanPatched` comment (src/domain/workflow/presentation.ts:183-186)
- [ ] BOTH `supersede-active`: the kernel implements it and the planner does not, and the run modal
      tells the operator it is unimplemented (run-fan-out.ts:112 vs services/start/plan.ts:191 vs
      run-start-model.ts:46)
```

### `{#sep-dash}` and the `Dashboard · wire` template (`{#order-*-dash}`)

Every square is already a `builds:` line; the audit adds no square. Two template lines are worth adding once, to the template rather than per node, because they are how a wired square is proved:

```
- [ ] PROOF a parity reference that serves the descriptor's `steps` — the categorical strip
      (D225) is unphotographed at every viewport (ref dashboard-surfaces §D225's own open item)
```

### `{#order-3-dash}` — the OCR pipeline's wire

Carries the generic template. Missing the two sections that exist as declared-but-unserved arms:

```
- [ ] BOTH the run-detail `review` section — declared in RunDetailSectionSchema, never served,
      `buildRunSection` throws by name (row-model D7 · D8 · D10)
```

### `{#order-4-dash}` / `{#order-4}` — group people and the completion contract

```
- [ ] BOTH the run-detail `people` section — same declared-but-unserved shape (row-model D9 · D11 · D14)
- [ ] BE `ContainmentSchema` has no `rejected` arm; row-model D9's rollup rule cannot be expressed
      (src/domain/dashboard/projection.ts:102-110)
- [ ] BE nothing mints an `operation` run — the coordinator/member fan-out has no runtime
      (command-kernel.ts:1608-1612); the whole group presentation is fed by fixtures today
- [ ] BE the approval manifest — `ocr_approvals` is an opaque table with no schema and no writer
- [ ] BE the child-run executor seam (run-executor.ts:1508-1515) and the parallel all-settled join
      (:1350-1356), both refusing `capability-unavailable` today
```

### `{#order-5-dash}` · `{#order-7-dash}` · `{#order-1}`

```
- [ ] FE row-model D17 — per-member confirmation numbers inline on the packet receipt (order-5-dash)
- [ ] BE row-model D13's `Re-upload` action key (order-7-dash; not in ActionCommandKeySchema)
- [ ] BOTH row-model D15 — Person Lookup's Search and Match modes (order-1; the descriptor declares one graph)
```

### `{#p2-2i}` · `{#track-b}` — the two named-open arms of D19(c)

```
- [ ] FE the Context rail's `Load a prior run` / `Start a run from this data` footer (D19(c))
- [ ] BE `actions[]` gating at the `data` placement — the served-actions projection is still empty,
      and the wire's `editing` union carries the gate meanwhile
```

### `{#def-*}` — already carried, confirmed still open

`{#def-settings}` `apply-settings` (the ONE deferred kernel arm, `command-kernel.ts:141-148`) · `{#def-retention}` the 14/8/5 sweep **and** a configurable backup path (`ref dashboard-surfaces §2.5`'s second remainder, unlisted today) · `{#def-byte-path}` D189, confirmed on three axes (no static handler in `http-server.ts`; `--prod` parsed nowhere; `on-demand-ngrok` returns `ingress-not-built`) · `{#def-explorer-edit}` D186 · `{#def-capture-binding}`.

### `{#operator-calls}`

Carries the D12 gate-age call. The audit adds one more, and it is a visible-design call the doc explicitly may not relitigate without the operator (D126's rule):

```
- [ ] you: row-model D16 says cancel has NO confirmation dialog; the served `cancel-tree` descriptor
      carries a member-counting confirm. Which wins?
```

### `{#test-tiers}` · `{#migrations}` — two notes for the orchestrator

- §6's rot-vector table names three guards that do not exist (C19). They belong in `reference/guards-and-tests`'s rewrite, not this doc's — but the row is this doc's to correct.
- `{#migrations}`'s note reads *"48 open · 20 replaced · 7 native · 3 retired"*. `config/legacy-capabilities.json` at HEAD is **47 open · 20 replaced · 7 native · 4 retired**. Not this doc's node; reported.

---

## 5 · Cross-doc overlaps — who owns what, and what stays here as a pointer

| overlap | this doc's sections | who should own it | what stays here |
|---|---|---|---|
| **The wire shapes** — `QueueSurfaceWire`, `EventsHubPayload`, the SSE envelope, `ActionDescriptorWire`, `RunDetailWire` | §2.2 (30), §2.4's sketches (35) | **`reference/frontend-backend-integration`** — it already owns §3.2's approved queue contract, §8.5's action rule, §5/§5.1's per-square wire, and §7's parity lane. It is also the doc §3(c) item 5 splits per square, so the two land in the same shape | the SEMANTICS — what a row means, why a fact is absent rather than defaulted, which absence reasons are honest. Delete the TS sketches; cite `ref frontend-backend-integration §5.1.<square>` and the schema module by path |
| **Trust surfaces** — the evidence receipt, the failure record, the diagnostic bundle, redaction | §D19(b), §D22's read-back guarantee, §2.6's redaction rule, §10.4 | **`reference/operator-trust`** (D82/D137/D183 are its) | where the receipt and the failure record RENDER (Receipt tab, inline in the stream) and why; the routing table stays here because it is a surface decision |
| **The notification MODEL** — trigger vocabulary, dedupe, severity, delivery | §2.6 (38), §10.4 (87) | **split, deliberately**: `reference/operator-trust` §6.1 already owns the durable row's justification and its boundary against the ledger. This doc owns the **surface** — the bell, the inbox, what a row can say, the link rule | keep §2.6's as-built D222/D262 blocks (they are surface decisions: which surface carries which hazard); move the durable-representation paragraph to a pointer |
| **Intake UI** | §11 (88–95) | **this doc keeps the surface contract**; `reference/data-intake-and-edit-data` owns the FLOW (§2.2), the invariant (§2.5), the manifest and readiness (§5.2), and the capture durability (§5.1). That split is already stated in §11's and §12's opening lines and is correct | §11 and §12 stay; add a one-line pointer at the top of each, as they already have |
| **Edit Data** | §D19(c)/(d) | **`reference/data-intake-and-edit-data` §6.4.1** owns the wire and the field policy | the rail's PLACE and its edit-in-place decision; the `editPolicyFor` composition stays here because it is presentation |
| **The command protocol** | §2.4 (35) | **this doc** (D95/D67 are its, and `reference/decisions` points here) | everything; `reference/frontend-backend-integration` cites it for the HTTP mapping |
| **Archive** | §10.2, D179, D223 | **this doc** | everything; `reference/operator-trust` cites it for evidence pointers |
| **Storage / recovery** | §2.5, D181 | **this doc** for the contract; `reference/clock-config-secrets` owns the config leaves the cadence reads | everything |
| **Explorer / catalog** | §13 | **this doc** owns where they sit and what they refuse to look like; `reference/operator-trust` §5 owns what the explorer IS and §1.3 what the catalog IS | as stated in §13's opening line — correct as is |
| **The completion contract** | §4 (43–49) | **this doc** contributed it and `reference/workflow-model` adopted the descriptor fields | everything, plus the plain statement that nothing declares it |
| **Cutover** | §5 (50–54) | **`05-cut-over.md`** now owns the phase; this doc owns the runtime-boundary CONTRACT | §5's live half (isolation, the `legacy:` scheme, the zero-open gate) as a contract; §5.1–§5.4 leave for `history/superseded/` |

**One structural note for the frontend-backend-integration unit** (it is dispatched in the same batch as this doc's rewrite): §3(c) item 5 splits its §5.1 into one subsection per wire square. That split and this doc's per-surface split must use **the same square names in the same order**, or every `*-dash` node ends up citing two different taxonomies. The order in this audit is the tree's own: run modal · queue row · run detail · gate ceremony · archive · explorer · activity · notifications, with Context rail folded under run detail on the tree and given its own section here because it is 1,340 lines of contract.

---

## 6 · Rewrite plan

### 6.1 The unit split — three units, not two

4,070 lines and 109 sections do not fit one 350k unit alongside the code verification each section needs. The split is by **surface group**, because that is the axis the rewrite reorganizes on, and each unit owns whole sections so two units never touch one heading.

| unit | scope | sections | inputs | rough size |
|---|---|---|---|---|
| **5.1b — the platform half** | the doc header, §0, §1, §2 (all), §3, §6, §7, §8, and the two `history/superseded/` extractions for the 1c stage deltas and the amendment log. Produces **S0 · P · C · DF · REF** | 1–6, 18, 22–41, 55, 57, plus the header block | this audit §1a/§1b/§1c/§3 (C1, C6, C9, C10, C16, C19, C20, C26) · `src/events/types.ts` · `src/core/span-emitter.ts` · `src/infra/events/**` · `src/server/dashboard/projectors/run-queue-projection.ts` · `src/domain/dashboard/projection.ts` · `src/domain/commands.ts` · `src/core/command-kernel.ts` | ~1,650 doc lines |
| **5.1c — the run surfaces** | the run modal, queue rows, run detail, the Context rail, gate ceremonies, and the row model that governs them. Produces **S0's D23/D24 · S1 · S2 · S3 · S4 · S5 · S13** | 7–17, 19–21, 58–79 | this audit §1a/§1d/§3 (C2, C3, C5, C7, C8, C15, C17, C18, C25) · `src/dashboard/surfaces/{run-start,queue,log-panel,context-rail,identity-approve,park-resolve,shell,top-bar,status}*` · `src/server/dashboard/queries/run-detail.ts` · `src/server/dashboard/projectors/queue-row-actions.ts` · `src/dashboard/ds/{primitives-status.tsx,tokens.css}` | ~1,300 doc lines |
| **5.1d — the standing surfaces and the contracts they carry** | notifications, archive, activity, explorer, settings/storage, intake, capture, the completion contract, the cutover boundary, and the coexistence extraction. Produces **S6–S12 · DG · X** | 42–54, 56, 80–109 | this audit §1c/§1e/§3 (C4, C11, C12, C13, C14, C21, C22, C23) · `src/dashboard/surfaces/{archive,activity,explorer,settings,intake}*` · `src/dashboard/phone/**` · `src/services/notifications/**` · `src/server/dashboard/queries/{archive,explorer,storage}.ts` · `src/services/archive/archive-service.ts` · `src/domain/workflow/completion.ts` · `config/legacy-capabilities.json` | ~1,120 doc lines |

**Sequencing.** 5.1b first and alone — it owns the numbering (§6.2) and every later unit's `§` targets depend on the decision landing. 5.1c and 5.1d can then run in parallel worktrees, because after 5.1b they share no heading. Each commits on its own branch; the orchestrator merges `--no-ff` in that order.

**Shared-file discipline.** All three touch `docs/roadmap/roadmap.md` only for `log:` lines on their own nodes; the `doc:` sweep (§6.2) is ONE commit by whoever lands last, or by the orchestrator. `docs/rebuild/history/README.md` gains three rows — 5.1b writes two, 5.1d writes one; different table rows, resolvable if they collide.

### 6.2 What the orchestrator must rule BEFORE 5.1b is dispatched

**Ruling 1 (blocking) — the section numbering.** R9 item 3 reorganizes per wire square, and every `doc:` ref, every code comment and every sibling doc cites this file by section number. The citation load, measured at HEAD:

- `docs/roadmap/roadmap.md`: **33 nodes** carry a `ref:dashboard-surfaces §N` ref (the binding guard resolves each against a numbered heading).
- `src/` + `tests/` + `scripts/` + `config/`: **150** `ref dashboard-surfaces §N` comments.
- `docs/**` excluding `history/`: **167**.

| option | what it does | citation sweep | delivers R9 item 3? |
|---|---|---|---|
| **A — full renumber** | §1…§20, one per section in §2's list | ~350 refs | fully |
| **B — the §9 shelf** *(recommended)* | §1–§8 keep their numbers and their meanings (they are the model, the wire, the command protocol, the descriptor fields, the completion contract, the boundary, the guards, the settled questions — none of them a surface). **§9 becomes "The operator surfaces", one numbered subsection per wire square** (§9.1 run modal … §9.13 the shell), and §10/§11/§12/§13 fold into it | ~110 refs (`§9`, `§10.1`, `§10.2`, `§10.3`, `§10.4`, `§11`, `§12`, `§12.6`, `§13`, `§13.2`) — and `§9` itself still resolves, because the heading keeps its number | fully, for every surface |
| **C — structure in place** | reorder within the existing numbers, no renumber | 0 | only partly — archive stays under §10.2, notifications under §2.6, and the squares are not one-per-section |

**Recommendation: B.** It buys the whole per-surface shelf for a third of A's sweep, keeps the 100+ heaviest code citations (`§1.1` ×37, `§2.x` ×100+) byte-stable, and leaves `§9` resolvable for the twelve nodes and six code comments that already point at it. Whichever is chosen, the rewritten doc carries a permanent **§ number map** (old → new) near the top, because `history/` and `docs/migrations/separations.md` cite the old numbers and are not swept.

**Ruling 2 — the wire-square taxonomy must be shared with `reference/frontend-backend-integration`.** §5's closing note. Both docs are in batch 1/2; one list, one order, or the `*-dash` nodes cite two taxonomies.

**Ruling 3 — the Context rail: its own square or a sub-square of run detail?** The tree treats it as part of `run detail` (`{#sep-dash}`'s `WIRE run detail` line names "the data rail"). This audit gives it **S4**, its own section, because `context-rail.tsx` + its model is 1,340 lines with its own edit-policy contract. Either is defensible; the tree's `builds:` line should not have to change.

**Ruling 4 — how far "fold, do not layer" goes (R9 item 1).** This audit recommends folding for the four 1c stage deltas, the amendment log and the `<details>` coexistence block (all → `history/superseded/`), and folding the ten remaining as-built delta blocks INTO their surface sections. That is the (ii) option §3(c) item 1 called "by far the most work" — for this doc it is also the only way to get one section per square, because the as-built blocks ARE the surface contracts. Confirm.

**Ruling 5 — two operator calls the rewrite cannot make.** C8 (row-model D16's "no confirmation dialog" versus the served member-counting confirm) is a visible-design question, and D126's rule says the visible design is the operator's. C15 (`Waiting on you` → `Review` on the pill) is the same class: the code changed the drawn word and no D records it. The rewrite will state the code's behaviour and mark both `- [!]` unless the orchestrator rules otherwise.

**Ruling 6 — three findings this audit will not fix in prose.** C1 (the notes stream), C2 (no `operation` run), C6 (`supersede-active`'s two answers) are code facts with owners. The rewrite states them; whether they also become `docs/findings/` rows or `builds:` lines is §4's candidate list and the orchestrator's call.

### 6.3 Per-unit acceptance

Each unit runs the full gate in its worktree (`export HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`): `npm run roadmap && npm run roadmap:check`, then `npm run typecheck && npm run lint && npm run test:coverage` — the binding guard (`roadmap-doc-binding`) is inside it and will fail loudly on any `doc:` ref the renumber broke, which is the point. A unit that cannot resolve a ref it did not create stops and reports rather than editing another doc's node.
