# Phase 1.4 · Projection, BFF, and operator shell

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

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
