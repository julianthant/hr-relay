# Task 3 · Harden shared status, commands, and read budgets
<!-- roadmap: track-d -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: track-d -->
- [x] D1 one status/outcome derivation — `deriveRunStatus`, `taskStateOf` and `panelKindOf` are one implementation each in `src/server/dashboard/run-status.ts`, read by the queue projector AND the run-detail query; the detail panel can no longer disagree with the queue row (**D268**, `81bfed73`)
- [x] D2 the hygiene commit — the HTTP status is the error's KIND (`src/server/failures.ts` + `routes/failure-status.ts`, `f39b2e95`), the phone-host gate is WIRED from `capture.ingress: "forwarded"` with a producer guard (`47eeb44e`), the two dead hooks and ten dead exports are gone (`69102aaf`), and `testInstanceSystems`/`pluralize`/`shortHash` are one each (`6d44bb1e`); the D253-sentence half landed with D3 (`1b13115f`)
- [x] D3 every command settlement folds through `settleCommandResult` — all NINE command-issuing surfaces fold (`1b13115f`); the guard's second arm requires any module calling `.executeCommand(` to import it (`5c36a82d`)
- [x] D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; MEASURED against the seeded 1,240-row / 108-member fixture — one SSE row patch `22.30 → 0.02 ms` and `dayWireSchemaParses 1 → 0`, with the four untouched rows held as the control (`345475bf` splice + tests, `bb406615` `memo` + stable props + the `dashboard-memo-prop-stability` guard); recorded in ref frontend-backend-integration §7.4
- [x] D5 bound the read scans — the member preview slices ids before joining and a row reads its receipt once (`d6d6c758`), the notes reader opens only its run's own `(workflow, date)` partitions (`c1fa129b`; the margin corrected to zero-below / one-day-above in `c547f65a`), the archive freeze scans once per page walk (`c74efcca`), all four pinned by their BOUND rather than a duration (`4d3247d8`) and MEASURED — day wire 6,718 → 5,568 SQLite statements, member-preview delta 216 → 6, logs scope 4 → 2 partitions (`ref frontend-backend-integration` §7.4's AFTER table)
- [?] D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate
- [?] D7 split `LoadedApp` along its own seams — the three hooks into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx`
- [?] D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, ONE `foldTaskExecutions(row)`
- [?] D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured — still proposed behind its trigger; observed-logs proves the current exact 200-row page complete/searchable with zero eager continuation and does not claim the shared primitive
- [?] D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped
- [x] D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads on `WorkflowStartWireSchema`, `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import, and `dashboard-wire-boundary` arm (15) holds the closure (amends D251; `149bc5f8`, `0911becd`; bundle 1,114,214 → 753,197 bytes)
> 2026-08-20 | docs-cohesion 03a | every row re-verified unlanded at HEAD against src/server/dashboard and src/dashboard; D6–D10 stay proposed behind the named trigger, which has not fired
> 2026-08-21 | track-d D11 | D11 LANDED (`149bc5f8` the wire block + server projection + a test driving `buildBootstrap` over the whole registry, `0911becd` the frontend drop + `dashboard-wire-boundary` arm 15, proved to bite). `ref frontend-backend-integration` §4's one named divergence is closed and its §7.4 exit-criterion 2 is MET. Bundle 1,114,214 → 753,197 bytes; `run-start.tsx` needed no edit — the composed `RunStartWorkflow` is identical field for field. Left in this track: D2–D5
> 2026-08-21 | track-d D1 | D1 LANDED as **D268** (`81bfed73`) — one `deriveRunStatus`, one task-outcome vocabulary (`cancelled` wins on D123's rule; `PipelineStepWireSchema.state` gains the arm), one `panelKindOf`, in a sibling module because the archive read path may not reach the projector's registry import; left: D2–D5 and D11
> 2026-08-21 | track-d D2 | D2 LANDED — four commits by category. The status mapper stopped reading its own error MESSAGES (`f39b2e95`): three declared kinds, every reachable producer converted, and a test that a plain `Error` wearing each retired phrase is a 500 rather than the 404 the substring table gave it. The phone-host gate is WIRED rather than deleted (`47eeb44e`) — `capture.ingress: "forwarded"` is a mode an operator can set today, so the scope check now has a producer instead of waiting for the byte-path slice that would open the door in the same commit; the guard gains §2b so it cannot lose that producer in silence. `GET /api/v1/dashboard` was KEPT against the audit's reading: two tests drive it, one of them the only proof a really-composed BFF serves a day. `INTAKE_UPLOAD_MEDIA_TYPES` was kept exported for its named open wire task. One operator-visible change: the receipt's TEST banner no longer uppercases its system names
> 2026-08-21 | track-d3 | D3 LANDED (`1b13115f`, guard `5c36a82d`) — the seven hand-enumerating sites now read `settleCommandResult`, which gained the server's own per-arm facts beside the composed sentence so a surface drawing a refusal in its own components need not re-take the union apart; ZERO operator text moved, deliberately, because the parity corpus photographs identity-approve's conflict alert
<!-- /roadmap-status -->

**Ratified 2026-08-20 as D264**, out of the same-day architecture audit
(`9993ab39^:docs/plans/2026-08-20-dashboard-architecture-audit.md`), whose one-paragraph verdict is that the
stack and the shape are right and nothing is swapped: in-process Hono BFF, server-side projections
over SQLite authority plus JSONL spans, REST snapshots with ONE resumable SSE stream and ONE command
route, zod wire schemas as the single source of truth, React 19 + Vite + Tailwind v4. Four
independent read-only mappers found zero layer violations. What is not optimal is one level down,
and every item is a targeted move rather than a rewrite.

**Why here, and why now.** The audit is timely and not urgent: this was the first moment since
1i-spine that nothing in the dashboard was mid-flight, so a hardening pass cannot collide with a
feature slice. The operator's ruling placed the track under the dashboard defaults, after Track C
(which is done, so the fold-into-Track-C alternative expired) and before the next workflow leans on
the dashboard in anger.

**The instrument exists, and the BEFORE numbers are recorded (2026-08-21).** D4 and D5 owe MEASURED
numbers, and a measurement needs an instrument that predates the fix — otherwise the first number is
taken by the change it is supposed to judge. `npm run perf:dashboard` (`tests/perf/`) seeds the
1,240-row / 108-member fixture this track has always named — real authority, real writers, real
projection, deterministic — and times the five audit paths in-process through the production
functions the BFF calls. The baseline table, taken at `407d373f` before any Track D row landed, is
in `ref frontend-backend-integration` §7.4 with the exact command and the machine it ran on; three
of its counts (216 statements for a 108-member preview, 5.42 per row for the day wire, one whole-day
parse per single-row patch) confirm what the audit predicted from reading. D4 and D5 re-run that
command against the same seed and record the delta beneath it. The instrument touches nothing under
`src/` — it measures the tree, it does not fix it.

**D4 and D5's AFTER numbers are recorded (2026-08-21).** Same command and seed: D4's row patch
falls **22.30 → 0.02 ms** and `dayWireSchemaParses` **1 → 0** (`345475bf`, `bb406615`). D5's
same eleven-iteration run (`c547f65a`) records, in §7.4's AFTER table, the day wire dropping
**6,718 → 5,568** SQLite statements (5.42 →
4.49 per row, decomposing exactly into 940 saved receipt reads and 210 saved preview joins), the
member-preview delta drops **216 → 6** and stops scaling with the member count at all, and a logs
GET may now open **2 of the corpus's 4 partitions** instead of all of them. Two honest readings
travel with the table. The logs row moves only 15 % in LINES because 78 % of this fixture's corpus
sits on the measured run's own day — what changed is that the read stopped growing with the corpus,
which is the bound audit P3 is actually about. And the archive freeze's own fix does not appear at
all, because at 13 notes per run the freeze walks one page; its bound is pinned in the unit lane
instead. Together those two rows close the measured-budget exit gate.

**The eleven rows, and their state at HEAD.** D1–D5 and D11 landed; D6–D10 remain proposed behind
their named trigger. Each was re-verified against the code for the 2026-08-20 rewrite rather than
carried forward on the audit's say-so.

| Row | What it closes | Verified at HEAD (2026-08-20) |
|---|---|---|
| D1 | detail-panel status diverges from queue status; two task-outcome vocabularies; `panelKindOf` byte-identical twice | **LANDED 2026-08-21 as D268** (`81bfed73`) — `src/server/dashboard/run-status.ts` exports `deriveRunStatus` / `taskStateOf` / `panelKindOf`; both vocabularies are one and `cancelled` is the word (D123); pinned by `tests/unit/server/run-status-derivation.test.ts` |
| D2 | HTTP status sniffed from an error message; the inert capture phone-host gate; dead hooks and exports; small duplications | ~~`useDashboardDaySnapshot` and `useRunSection` have no importers; `deps.capturePhoneHost` is read at `routes/api.ts:142` and supplied nowhere~~ **CLOSED 2026-08-21** (`f39b2e95`, `47eeb44e`, `69102aaf`, `6d44bb1e`) — three declared refusal kinds in `src/server/failures.ts` map to status by `instanceof`; the gate is wired from `capture.ingress: "forwarded"` and `capture-durability-and-scope` §2b refuses a composition root that stops supplying it; the dead pair is deleted and ten exports un-exported; the TEST-instance hazard, `plural` and `shortHash` are one each |
| D3 | seven command-issuing sites enumerate both refusal arms by hand | ~~`settleCommandResult` is imported by exactly two surfaces, `top-bar.tsx` and `context-rail.tsx`~~ **CLOSED 2026-08-21 (`1b13115f`)** — all nine import it; the guard now refuses a module that posts through `executeCommand` without it |
| D4 | whole-day zod re-parse and whole-tree re-render per SSE patch | ~~zero `React.memo` anywhere under `src/dashboard`~~ **CLOSED 2026-08-21** (`345475bf`, `bb406615`) — `applyDashboardDayPatch` splices (one patch: `22.30 → 0.02 ms`, `dayWireSchemaParses 1 → 0`, ref frontend-backend-integration §7.4's D4 AFTER table); the three hot panels are `memo`'d with every prop stabilized at the parent, held by `dashboard-memo-prop-stability`. The D256 live clock is a prop of all three and ticks 1 Hz, so `memo` buys the re-renders BETWEEN ticks and the browser render count is left to D9 |
| D5 | member preview, duplicate receipt reads, whole-notes-corpus reads, the archive freeze loop | ~~unchanged in `run-queue-projection.ts` / `run-detail.ts` / `archive.ts`~~ **CLOSED 2026-08-21** (`d6d6c758`, `c1fa129b`, `c74efcca`, `c547f65a`) — all four bounded, behaviour byte-identical over the §7.4 fixture, measured and recorded |
| D6–D10 | the maintainability slice | proposed; the trigger has not fired |
| D11 | `WORKFLOW_DESCRIPTORS` in the browser bundle | ~~still imported at `dashboard-app.tsx:25`, used at `:516`~~ **CLOSED 2026-08-21 (`149bc5f8`, `0911becd`)** — the three fields ride `WorkflowStartWireSchema`, the import is gone, and `dashboard-wire-boundary` arm (15) refuses any dashboard entry whose closure reaches `src/workflows/**` or `src/control/**`; bundle 1,114,214 → 753,197 bytes |

**D4 and D5 are also the first measurement `ref frontend-backend-integration` §7.4 ever gets.** That
section's budgets have never carried a measured number — it says so itself ("Not one of these is
measured or asserted anywhere in this repository"), and the Person Lookup vertical slice shipped
without recording one. The numbers D4/D5 record on the local production build against a seeded
1,240-row / 108-member fixture (legacy's real volume: 2,093 runs over 11 active days, busiest day 1,240, largest operation 108 members) BECOME
the non-regression gates every later workflow is held to. That is why the budgets appear in this
phase's exit criteria and not only in the cutover's.

**D6–D10 carry one named trigger** — they start before the second migration's `Dashboard · wire`
task does, and until then they stay `proposed`. Once D1–D5 land they can be dispatched as
independent worktree units.

**D11 answered the audit's one open question, and LANDED 2026-08-21.** `WORKFLOW_DESCRIPTORS`
dragged 49 modules into the browser bundle to supply three plain fields. D251 had ruled that the
bundle already carries them, so serving them over bootstrap would be a second source; the operator
ruled the other way — the registry LEAVES the bundle, bootstrap serves `summary`, `enqueue` and
`surfaces.inputRun`, and the frontend drops the import. Bytes were called irrelevant locally and the
principle — the frontend renders finished read models — was the whole argument; the bytes turned out
to be the larger half anyway. **Measured at the change: 1,114,214 → 753,197, a 32 % production
bundle.** The as-built lives in `ref frontend-backend-integration` §4.

Two things the build is worth remembering for. **The rule is held by a CLOSURE arm, not a lint on
import lines** (`dashboard-wire-boundary` (15)): one shared helper re-exporting a descriptor would
put the whole tuple back with nothing in the diff that reads like a registry import, and the arm was
proved to bite by re-adding the deleted import. And **serving a fact does not change where its bytes
came from**: the redaction audit demanded an origin for seven new free-text leaves — the summary,
the placeholder, the delimiters, D250's worked examples — and every one is a descriptor constant a
developer typed into this repository, so every one is `repository-authored`. A guard asking that
question at the moment a field crosses onto a wire is the guard working.
