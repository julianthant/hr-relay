# Plan — dashboard architecture audit, and where its findings fall in the rebuild

**Date:** 2026-08-20 · **Scope:** `src/server/dashboard/**` (BFF), `src/domain/dashboard/**` (wire),
`src/dashboard/**` (frontend) · **Kind:** read-only structural audit + placement proposal ·
**Status:** proposal — nothing below is ratified until it lands in its owning doc (doc 07 / doc 13)
with a decision number. D255 is the last minted number; this document mints none.

**Lens (operator, 2026-08-20):** solo, local, never hosted (D193). Everything here is ranked under
that lens, against the load legacy production actually carries: **2,093 runs over 11 active days,
busiest day 1,240 runs, ordinary busy days 130–250, largest operation 108 members, ~187k JSONL
lines per month.** The rebuild's own state root today: 762 span lines, ~40 runs.

---

## 1 · The one-paragraph answer

The stack and the shape are right for a single-operator local dashboard and should not change:
in-process Hono BFF, server-side projections over SQLite authority + JSONL spans, REST snapshots +
ONE resumable SSE stream + ONE command route, zod wire schemas as the single source of truth, React
19 + Vite + Tailwind v4 + five Radix primitives. Four independent read-only mappers found **zero
layer violations**. What is not optimal is one level down: the frontend data/render layer repeats
itself instead of centralising (no cache, no `memo`, whole-day re-validation per patch, a
1,100-line `LoadedApp`), the BFF read side has grown a second derivation of run status and three
folds of the same task spans, the command path has four services in four patterns, and a handful of
per-request scans go quadratic at legacy's real operation sizes. None of it is a rewrite; all of it
is a short list of targeted moves.

---

## 2 · The rebuild plan — phases, and what is done

Source: `docs/rebuild/07-master-plan.md` §2 (the phase table), `ROADMAP.md` §1–§3, and
`docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` §6 (the Phase 3
tracks). Doc 07 wins on any disagreement.

| Phase | What it is | Status |
|---|---|---|
| **0** — foundation design | docs 00–13 reconciled, testing policy, all-at-once cutover ratified (D1–D94) | **COMPLETE 2026-07-31** |
| **1** — the SPINE | 1a–1f base (guards, strict domain, authority storage/recovery, commands, registry, workers, write sequencer) + 1g-spine (span emission + the ONE projection + the BFF) + 1i-spine (Person Lookup parity slice in the approved shell) | **COMPLETE 2026-08-04** — D74 live exit: person-lookup ran against real UCPath + CRM on the new executor |
| **2** — transaction proof + the deferred tails | controlled Kuali commit on real doc 4489 (D135) · 2g trust/evidence/notifications/ledger · 2h data-intake/OCR/capture/Edit Data · 2i operator surfaces (trust, bell, rail, settings, intake, phone capture, explorer, advisories, archive + Activity) · 2j integration/restore/soak gate | **COMPLETE 2026-08-09** — runtime marker `completedThrough: "2j"` |
| **3+** — per-workflow migration | the 13 remaining legacy workflows, one at a time (doc 07 §3.3 order), each through the 7-step loop (§3.1) + non-workflow capability closure (§3.6) | **ACTIVE** — entry point **separations** (order 8, D193); Phase 3 is organised into the tracks below |
| **Cutover** | one all-at-once authority switch (D89/D93); legacy preserved as the rollback asset | not started; gated on doc 07 §6 + §7.4 and doc 13 §10 |

### Phase 3 as it stands today (the 2026-08-18 plan's tracks)

| Track | What | Status 2026-08-20 |
|---|---|---|
| **0** — plan repairs | fix the four plan-text staleness items | landed in wave 1 |
| **A** — separations backend completion | the three controlled commits (①pending sweep ②UCPath termination ③Kuali finalization) + A5 measurements + A6 live retry + A7 profile wedge + A8 close-out | **operator-blocked at A1** (canary naming); A7 closed by D243/D244; A6 open; separations is at 7 of 9 exit criteria |
| **B** — dashboard completion | B1 gate ceremonies · B2 honesty gaps · B3 run modal · B4 queue rows + bulk · B5 archive · B6 explorer · B7 worker/rail/ledger batch · B8 findings sweep | **B1–B8 ALL LANDED** (D226 · D237/D238 · D250/D251 · D230–D235 · D223 · D227–D229 · D252/D253 · D254/D255); findings ledger at zero-or-decided |
| **C** — connection proof | one real dashboard ↔ real composed separations dry run, every surface paired against authority | **in progress** — `docs/migrations/separations.md` §9.22 written today (items 1–8) |

**Where the program actually is:** the platform is finished and proven; the product is ~2 of 15
workflows; the dashboard is at its "frontend done" definition (B8). What remains on the critical
path is operator-blocked (Track A) or verification (Track C). **That is exactly why this audit is
timely and not urgent:** it is the first moment since 1i-spine that nothing in the dashboard is
mid-flight, so a hardening pass cannot collide with a feature slice.

---

## 3 · What the audit found — ranked under the solo/local lens

Evidence is `file:line` at HEAD `e06fc5e`. Full per-layer reports were read and cross-checked;
every load-bearing claim below was re-verified by hand.

### 3.1 Keep — the decisions that are right and already enforced

| Decision | Why it is right here | Enforced by |
|---|---|---|
| In-process Hono BFF, hand-rolled Node→Hono bridge (`http-server.ts:52-74`) | the chunk-by-chunk pipe is what lets SSE flush without `@hono/node-server`; no benefit to a network split for one operator | doc 13 §2 "the BFF remains in-process" |
| REST snapshots + ONE SSE + ONE command route | matches append/project; GraphQL/WebSockets/polling rejected for stated reasons | doc 13 §0.3, §9 |
| ONE projector (`run-queue-projection.ts:354`), 250 ms disk tail, no in-process hook | cross-process spans have no other way in (D218) | doc 03 §2.3, D218 |
| `src/domain/dashboard/*` zod schemas as the single wire truth; client types are all `z.infer`; no `any`/loose record at the wire | no handwritten twin anywhere | `dashboard-wire-boundary`, `strict-boundary-schemas` |
| `client/` as one frozen facade; `subscription.ts` cursor/gap/generation logic headless and tested | the hard part of live updates, separated from React | `client-transport.test.ts`, doc 13 §3.5 |
| URL-as-state without a router; `activeTakeover` precedence as one function (`url-state.ts:129`) | deep-linkable, no dependency, testable | `global-keys.test.ts` |
| Bespoke `primitives-layout/-status`; Radix only for dialog/popover/tooltip/context-menu/checkbox; `cva` only for Button/IconButton/Badge | the primitives encode DESIGN.md rules no library has | `DESIGN.md`, parity lane |
| Tailwind: zero raw palette utilities, 1,472 `var(--ds-*)` references, inline `style` only for `<col>` widths | one approach, held | `tailwind palette` ratchet |
| Surface/model pairing (`<surface>.tsx` components-only, `<surface>-model.ts` pure) | Fast Refresh boundary + the only way `.tsx` logic becomes unit-testable | `dashboard-refresh-boundary` (doc 13 §8.14) |
| `.tsx` proven by the Playwright parity lane, extracted `.ts` by vitest | a deliberate split, documented in `vitest.config.ts` | coverage exclusions with reasons |
| `{state:"present"|"absent", reason}` everywhere; `buildActivityReportWire` living on the projector (D81: one count path) | refuses coerced zeros; one count family | guards + doc 03 §10.1 |
| Layer discipline | server never imports `src/dashboard`; domain never imports infra; browser closure reaches no Node built-in | four mappers, zero findings |

### 3.2 Tier 1 — correctness (scale-free; fix regardless)

| # | Finding | Evidence | Why it matters to one operator |
|---|---|---|---|
| C1 | **Detail-panel status diverges from queue status.** `statusOf` lacks the `row.ended` and `row.claimedBy` arms `#status` has, and inlines a copy of `RUN_OUTCOME_STATUS` | `queries/run-detail.ts:256` vs `projectors/run-queue-projection.ts:835`, `:267` | a run whose span stream ended before authority settled reads `done` in its row and `running`/`queued` in its panel — two derivations of one fact (doc 03 §2.3 says one); nobody else is there to notice |
| C2 | **Two task-outcome vocabularies.** `TASK_OUTCOME_PIPELINE` maps `cancelled/discarded→blocked`; `TASK_OUTCOME_STEP` maps them `→cancelled` | `run-queue-projection.ts:342` vs `run-detail.ts:437` | same span, two words, two panels |
| C3 | **HTTP status chosen by sniffing the error message** | `routes/api.ts:70-96` | a reworded message silently turns 404 into 500 |
| C4 | **The capture phone-host gate middleware is inert** — `deps.capturePhoneHost` is never supplied | `routes/api.ts:141-156`, `compose.ts:759-818` | harmless until D189's ingress is built; a gate that compiles and never fires is D181's shape |
| C5 | **Command settlement: 9 `executeCommand` sites, 2 through `settleCommandResult`** — the others enumerate both refusal arms by hand (correct; the guard passes) | fold: `context-rail.tsx:587`, `top-bar.tsx:643`; by hand: `dashboard-app.tsx:603,686`, `run-start.tsx:747`, `archive.tsx:2561`, `park-resolve.tsx:622`, `identity-approve.tsx:522`, `intake.tsx:1118` | `src/dashboard/CLAUDE.md`'s D253 lesson says "every command-issuing surface now settles through" the fold — that sentence is currently false |

### 3.3 Tier 2 — what the operator will feel, at legacy's real volume

| # | Finding | Evidence | At 1,240 rows / 108-member operations |
|---|---|---|---|
| P1 | **Whole-day zod re-parse + whole-tree re-render per patch.** Every single-row SSE patch runs `DashboardDayWireSchema.parse` over the entire day; `LoadedApp` then re-renders with no `memo` anywhere; `viewState` and the inline `nav={{…}}` prop are recreated per render | `client/day-state.ts:24,40`; `dashboard-app.tsx:507`; zero `React.memo` in `src/dashboard` | a bulk run emits patches per row change; each re-validates 1,240 rows and re-renders every panel — **the one item on this list a single operator will perceive** |
| P2 | **`#memberPreview` walks every member, then `.slice(0,3)`** — `getRun` + checkpoint per member | `run-queue-projection.ts:1178` | a 108-member group costs ~216 SQLite hits to print three names, on every day wire AND every SSE snapshot |
| P3 | **Whole notes corpus read per logs GET**, and the archive freeze loops it up to 500× | `run-detail.ts:707` (`readEventStreamLines(stateRoot,"notes")`), `archive.ts:412` | 187k lines/month in legacy; a read that grows forever for a tool that runs for years |
| P4 | **Duplicate receipt read per row** (`#warningVerdict` + `#facts` each `getReceipt`) ≈ 5 SQLite hits per terminal row per day wire and per snapshot | `run-queue-projection.ts:978`, `:1230` | ~6k queries to serve a 1,240-row day; fine on loopback SQLite today, but it multiplies P1 |
| P5 | No virtualization/paging in queue/logs/activity/archive | plain `.map()` everywhere; only a comment at `primitives-data.tsx:42` | **an unmet documented budget** (doc 13 §7.4) — but secondary to P1: 1,240 plain rows render; 1,240 rows re-rendered per patch do not |

Dropped under the lens (cloud/multi-tenant concerns, not yours): SSE keep-alive frames, request
dedupe/abort-on-unmount, bundle bytes (343 kB gzip from disk), `/archive` N+1 and `/explorer`
scenario re-reads (rare GETs), `buildDashboardDayWire` joining before the day filter (~2k rows
total), one CAS transport for every mutating route.

### 3.4 Tier 3 — maintainability (gains weight when one person + agents are the whole staff)

| # | Finding | Evidence |
|---|---|---|
| M1 | **`dashboard-app.tsx` is a god component** — `LoadedApp` spans `:266→1368`, 17 `useState` / 12 `useMemo` / 13 `useCallback`, ~18 concerns (route, boot, subscription, detail+sections, bulk plans, 3 dispatch paths, 4 dialogs, toasts, keys, nav-history, 5 takeover layouts); **37 commits since 08-01**, the hottest file in the tree | `src/dashboard/app/dashboard-app.tsx` |
| M2 | **The fetch effect is hand-copied ≥9×** and 13 of 19 `useDashboardClient` consumers bypass `state/`; `async-resource.ts` (27 lines, the right shape) is used by 4 | `use-bootstrap.ts:17`, `use-dashboard-day.ts:58`, `use-run-detail.ts:24,66`, `use-panel-sections.ts:87`, `activity.tsx:1050`, `explorer.tsx:1427`, `archive.tsx:2528/2542`, `ui-catalog.tsx` |
| M3 | **Three folds of `row.taskSpans`** with hand-copied duration math (the comment at `:1055` admits it); `panelKindOf` byte-identical twice | `run-queue-projection.ts:1027`, `run-detail.ts:471`, `archive.ts:498`; `:261` / `run-detail.ts:250` — **this is what produced C1/C2** |
| M4 | **Four command services, four patterns** — result union returned / same union thrown as `CaptureRefusal` / two bypass the kernel with their own transaction; `expectedVersion` travels in body, query, and plan wire; `intake.prepare(body)` makes three envelope parses per POST | `command-service.ts`, `capture-service.ts:277`, `start-plan-service.ts:122`, `intake-service.ts:317`, `api.ts:299,380` |
| M5 | **Model-pairing gaps** that pass the guard only because nothing is exported: `intake.tsx` 1,361 lines / **no model**; `archive.tsx` 2,748 / model 22 lines; `useSeekAnchor` is the one hook still inside a `.tsx` — this logic is untested by construction | `intake.tsx:165,370,385`; `archive.tsx:236,321,328,363`; `log-panel.tsx:893` |
| M6 | **`archive.tsx` is two surfaces** — the version-bump dialog + `VersionsView`/`BlockerTable` are a workflow-versioning surface mounted in the archive file (`log-panel`/`explorer`/`queue` are long-but-cohesive; this one is not) | `archive.tsx:1912-2151`, `:2188-2496` |
| M7 | **Dead code**: hooks `useDashboardDaySnapshot` (doc claims it is the parity read path; nothing imports it) and `useRunSection`; `GET /api/v1/dashboard` is product-dead with them; ~12 dead BFF/domain exports; ~60 sub-schemas exported but referenced only by their own parent; 4 ds primitives with zero callers that the specimen page does not exercise | `use-dashboard-day.ts:54`, `use-run-detail.ts:57`; `command-service.ts:97`, `intake-service.ts:66,72`, `start-plan-service.ts:34,43`, `compose.ts:263,278,287`; `domain/dashboard/explorer.ts:573`, `queries/bootstrap.ts:133`, `run-detail.ts:760`, `worker-cards.ts:44`; `ProgressBar`, `VisuallyHidden`, `CardFooter`, `ContextMenuLabel` |
| M8 | **Small duplications**: TEST-instance banner derived 4 ways (wording already diverged); `plural()` forked; `shortHash` archive-private while intake inlines `.slice(0,8)`; three private button-variant factories beside `ds/Button`; raw `<input>` where `ds/Input` exists; ~20 magic pixel widths against DESIGN.md; ~10–25 % of 239 tokens orphaned (sampled) | `queue.tsx:259`, `run-start-kit-model.ts:22`, `run-identity.tsx:89`, `receipt.tsx:62`; `format.ts:127`/`intake.tsx:365`; `archive.tsx:186`/`intake.tsx:872`; `actions-model.ts:52`, `shell-model.ts:129`, `queue.tsx:243`; `archive.tsx:675,1316,2669` |

### 3.5 One item that is yours to rule, not mine

**`WORKFLOW_DESCRIPTORS` is in the browser bundle** (`dashboard-app.tsx:25`, used at `:476`;
`run-start.tsx`). It drags 49 modules — all 8 descriptors, 22 task contracts, `base/workflow.ts`,
the build manifest; 22 % of the 219-module closure; `grep -c separation` = 462 in `index-*.js` —
to supply three plain fields. **D251 (today) ruled** that the bundle already carries these, so
serving them over bootstrap would be a second source (doc 13 §8.2). The other reading: doc 13 §0.1
("the frontend renders finished read models") and §4's owner column ("descriptor/config projection")
point at the wire, and the reason there would be two sources is that `run-start.tsx` imports the
registry at all. Bytes are irrelevant locally; the principle is not. Recorded here as **unclear**;
no move below depends on it.

---

## 4 · Where these fall in the plan

Nothing above is a new phase. Every item already has an owner in the existing structure:

| Bucket | Items | Owning place | Why there |
|---|---|---|---|
| **Doc 03 §2.3 / doc 13 §10 item 5 — "one projection family, all counts reconcile"** | C1, C2, M3 | `docs/findings/dashboard-projection.md` (the category is literally "served surfaces disagree"); fix ratified in doc 03 | a second status derivation is a projection defect, not a frontend feature |
| **Doc 13 §7.4 performance/resilience budgets** (program-wide pre-cutover exit criterion via doc 07 §7.4) | P1–P5 | doc 13 §7.4 — the budgets exist, "measured on the local production build with a realistic large fixture … thresholds recorded from the first Person Lookup slice"; **they have never been measured** | the budget text already names virtualize/page, the 50-member no-rebuild rule, and the one-EventSource rule; this audit supplies the first numbers |
| **Doc 13 §3.4 one command protocol / §8 guards** | C5, M4, M7 (the dead `GET /dashboard`) | doc 13 §3.4 + `src/dashboard/CLAUDE.md` (correct the D253 sentence) | "one command protocol" is the contract; four patterns is drift by addition |
| **Doc 13 §2 module boundaries + §8.14 refresh boundary** | M1, M2, M5, M6 | doc 13 §2 (`state/` is named as "normalized server cache + client-only UI state" — the cache half was never built) and `src/dashboard/CLAUDE.md` | the structure is documented; the implementation under-delivers it |
| **D189 / capture ingress** | C4 | doc 13 §6.9 | the inert gate is the guard-arm D189 promised for the ingress slice; wire it or delete it before that slice starts |
| **Hygiene** | C3, M7, M8 | no doc change; a commit | — |
| **Operator ruling** | §3.5 | doc 13 §4 + D251 | a doc amendment either way |

**Phase placement:** all of it is **Phase 3, non-workflow** — it is neither a workflow migration
(§3.1) nor a legacy-capability closure (§3.6). The honest home is a **new Track D in the 2026-08-18
plan — "dashboard hardening, pre-cutover budgets"** — sequenced *after* Track C's connection proof
(so the proof runs against the tree the operator has been using, not a freshly refactored one) and
*before* any workflow after separations starts consuming the dashboard in anger. The §7.4 budget
measurement doubles as the **non-regression gate** doc 13 says those thresholds become.

---

## 5 · Proposed Track D (for ratification — not yet in the plan)

Dependency-safe order; each row is one commit group; gate: `npm run typecheck && npm run lint &&
npm run test:coverage`, plus `npm run test:parity` for anything touching `.tsx`.

| # | Move | Closes | Risk | Size |
|---|---|---|---|---|
| D1 | **One status/outcome derivation.** Export `deriveRunStatus(row, authority)` + one `TASK_OUTCOME` vocabulary + one `panelKindOf` from the projector; `run-detail.ts` and `archive.ts` read them. Record as a decision (it corrects the panel). | C1, C2, part of M3 | low | S |
| D2 | **Hygiene commit.** Delete dead hooks/exports; un-export in-file-only components; typed `NotFoundError` instead of message-sniffing; wire `capturePhoneHost` (or delete the middleware with a D189 note); unify `testSystemsOf`/`plural`/`shortHash`; correct the D253 sentence. | C3, C4, C5 (doc half), M7, M8 | low | S |
| D3 | **Fold every command settlement** through `settleCommandResult` (7 sites). | C5 | low | S |
| D4 | **Patch-splice without full re-parse** — validate the patch (already parsed), splice, full parse on snapshot/reset only; `memo` `QueuePanel`/`TopBar`/`LogPanel`; memoize `viewState`/`nav`. Then **measure** P1 against a 1,240-row / 108-member seeded fixture and record the numbers in doc 13 §7.4. | P1, first §7.4 numbers | medium | M |
| D5 | **Bound the read scans**: `#memberPreview` slices ids before joining; one receipt read per row; notes reader scoped by `(workflow, run day-range)`; archive freeze reads the corpus once. Measure and record. | P2, P3, P4 | low–medium | S–M |
| D6 | **`useResource` in `state/`** over `async-resource.ts` (per-key cache, invalidate-on-nonce); migrate the ≥9 copies; `state/` becomes what doc 13 §2 says it is. | M2 | medium | M |
| D7 | **Split `LoadedApp`** along its existing seams (`useDayRoute` / `useRunDetailState` / `useBulkSelection` into `app/*-model.ts`; the five takeover layouts into `app/takeovers.tsx`). | M1 | medium | M |
| D8 | **Models for intake/archive/log-panel**; split the versioning half of `archive.tsx` into `versions.tsx`; one `foldTaskExecutions(row)` for pipeline/timeline/archive. | M3, M5, M6 | medium | M |
| D9 | **Virtualized list primitive** in `ds/`, adopted by queue/logs/archive; re-measure. | P5 | medium | M |
| D10 | **One CAS transport** (`expectedVersion` in body everywhere) and drop the `intake.prepare` double-parse. | M4 | medium | S |

D1–D3 are a day and scale-free. D4–D5 are the perceived-performance pair. D6–D10 are the
maintainability slice and can be dispatched as independent worktree units after D1–D5 land.

---

## 6 · What needs YOU

1. **Ratify the placement** — Track D in the 2026-08-18 plan, after Track C, before the next
   workflow's dashboard consumption. (Alternative: fold D1–D5 into Track C's close-out and defer
   D6–D10 to a named later trigger. I recommend the former; D6–D10 are exactly the kind of work that
   never gets a slot unless it has a track.)
2. **Rule §3.5** — descriptors in the bundle stay (D251 as written) or move to bootstrap (a doc 13
   §4 / D251 amendment).
3. **Scope** — (a) D1–D3 only · (b) D1–D5 · (c) the whole track. Say which and I execute in that
   order, committing per row, gates green per commit, no push.
