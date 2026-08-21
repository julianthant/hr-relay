# 04 · Phase 4 — close the deferrals

This doc is the dedicated home of **Phase 4**, tree node `{#deferred}` — every "I want to do X; the
plan said build Y; Y is deferred" answer, and the **trigger** that ends each one. Phase 4 is not a
block of work with a start date: it is eight named absences, each waiting on an event somebody can
recognize. Nothing here blocks the cutover unless `05-cut-over.md` §Exit criteria names it — and it
names none of them. Contracts these deferrals belong to live in `reference/`.

## Phase summary
<!-- roadmap: deferred -->

<!-- roadmap-status: deferred -->
- [x] every deferral names its trigger, and none is a silent drop — eight nodes, eight triggers or decided stances
- [x] two have a decided STANCE instead of a trigger (D193) — the retention sweep's schedule and the content-store refcount; they are `wont-build-unless-asked`
- [-] the record-sanity-check advisory — **retired** by the operator 2026-08-18 (D192; `config/legacy-capabilities.json`), not deferred any more
- [ ] the five deferrals whose trigger has not fired: the capture→run binding (order 3), the production byte path (order 3), the explorer's EDIT half (a second workflow), editable settings (Phase 3 cross-cutting), search / screenshots / export (Phase 3 cross-cutting)
- [ ] the propagation windows — measured for Kuali only (D135/D207); UCPath and ServiceNow wait on their own live probes at order 7
- [ ] nothing has been RATIFIED in this phase: a deferral closes with the decision that ends it, and none has been written
> 2026-08-20 | docs-cohesion 04 | verified against src/control/workflow-registry.ts:194, src/core/runtime-composition.ts:162, src/server/dashboard/routes/api.ts:141-403, src/core/command-kernel.ts:141, src/services/trust/diagnostic-retention.ts:45, src/domain/contracts/**/write-safety blocks; left: all five untriggered deferrals, plus the propagation measurements for two systems
<!-- /roadmap-status -->

### What Phase 4 is

**It is the answer sheet.** Every deferral in this program was created by a decision that said why,
and every one of them names the event that ends the deferral. This doc collects them in one place so
an operator asking "why can't I do X?" gets three things in one section: what the absence IS, the
decision that made it an absence, and what has to happen before it stops being one. A deferral with
no trigger is a silent drop, and this program does not have any.

**It is not a milestone.** Nothing in Phase 4 is scheduled. Five of the eight wait on an event in
Phase 3 (a migration order, a second workflow, the cross-cutting closure); two carry a decided
STANCE — D193's `wont-build-unless-asked`, which is off every milestone and blocks no gate; one is
retired outright. None of them is a waiver: a waiver has no owner, and each of these has one.

**It is not the cutover's blocker list.** `05-cut-over.md` §Exit criteria is where the cutover's
conditions live, and it names none of these eight. A deferral that reached the cutover unclosed is
carried past it deliberately, with its trigger still standing.

### The eight, and what ends each one

| Deferral | Node | Created by | Trigger — the event that ends it |
|---|---|---|---|
| Photograph a paper form → an OCR-backed run | `{#def-capture-binding}` | D174 | the first OCR-consuming workflow (**order 3**) declares a `CaptureIntakeBinding` |
| Run the dashboard without the dev server / the phone page in production | `{#def-byte-path}` | D189 (with D174/D175) | **order 3** — the byte path is what makes the phone surface reachable at all |
| Edit a workflow's presentation / policy without a code change | `{#def-explorer-edit}` | D79a, reassigned by **D186** | a **SECOND** production workflow whose policy you want to change |
| A record-sanity-check advisory panel | `{#def-sanity-check}` | D192 | **none — RETIRED 2026-08-18.** The §14.2 gate packet's deterministic comparison IS the sanity check |
| Edit settings in the dashboard | `{#def-settings}` | D169/D184, stance D193(b) | the Phase-3 **cross-cutting** closure; no single event |
| Trust UCPath / ServiceNow wait-before-negative-read windows | `{#def-propagation}` | D128/D135 (Kuali, measured), D207 (separations) | each system's own live probe — UCPath at **order 7** |
| Search runs across dates / view screenshots / export Excel | `{#def-search-export}` | the 2i tail (D168–D180) that named them out | the Phase-3 **cross-cutting** closure, shaped against a real run corpus |
| Auto-purge diagnostics · reclaim unreferenced artifact bytes | `{#def-retention}` | D137, stance **D193(b)** | **none — you ask.** `wont-build-unless-asked`, off every milestone |

### The honest state

**Five are untriggered, and every one of them is a named absence on a surface that ships.** The
explorer renders and refuses to edit; Settings renders and `apply-settings` answers
`capability-unavailable`; the Top Bar filters the served day and has no cross-date search; the phone
capture page is built, bundled and has no delivery path. In each case the surface tells the truth
about what it cannot do — that is what distinguishes a deferral from a hole.

**One is retired**, and the reason generalizes: its deferral condition was met **deterministically**
by something else. D192 deferred the sanity check to order 8 so it could render beside the
identity-approval gate; separations arrived and the gate packet's own server-computed `comparisons`
array occupies exactly that slot. The operator ruled on 2026-08-18 that the deterministic comparison
IS the sanity check, and no AI feature is built.

**Two carry a stance, not a schedule.** D193(b)'s argument is worth reading where it was made
(`reference/operator-trust.md` §2.2.1): this authority database stores records of COMPLETIONS, not
primary records — the real record of a filed HR transaction lives in UCPath or Kuali and can be
checked there. That is why disk growth on one local machine did not earn a durable reference count.

**One is partly closed.** Propagation is measured for Kuali and only for Kuali: two commit
contracts carry `recoveryAbsence: stabilized` with real numbers, and the two UCPath contracts carry
`operator-only` with an explicit refusal to guess. The deferral is per system, not global.

_The Phase-2h/2i scheduling narrative that used to sit here — where the service stores, the intake
manifest, the Edit-Data UI and mobile capture slot, and the Phase-0 deferred-decision log — is
`history/superseded/2026-08-20-master-plan-dissolved.md` §3.5 and §3. Every milestone it named has
landed (2h closed 2026-08-08, 2i 2026-08-09), so repeating it here would be a schedule for work that
is done. What survived it is the eight rows above._

## Photograph a paper form on your phone → it becomes an OCR-backed run
<!-- roadmap: def-capture-binding -->

<!-- roadmap-status: def-capture-binding -->
- [x] the whole capture pipeline is built and composed — token-scoped phone page, durable session, ordered photos, bundle finalization, restart drain (2i-F, D174)
- [x] the handoff seam exists and refuses BY NAME rather than inventing an input — `captureIntakeRegistry` (`src/control/workflow-registry.ts:167-193`)
- [ ] a workflow that can honestly derive its input from a photograph — `CAPTURE_INTAKE_BINDINGS` is `{}` because none exists (`src/control/workflow-registry.ts:194`)
- [ ] the phone page has no delivery path either, which is `{#def-byte-path}` — both close at order 3
> 2026-08-20 | docs-cohesion 04 | verified against src/control/workflow-registry.ts:150-194 and src/server/dashboard/compose.ts:747-760; left: the binding itself, which order 3 declares
<!-- /roadmap-status -->

**What the deferral is.** You can photograph a paper form with your phone today and the system will
keep the photographs — a token-scoped capture session, an ordered set of digests, a finalized
bundle. What it will not do is turn that bundle into a queued run, because **no workflow has
declared how a bundle becomes its input.**

**The decision that deferred it: D174** (round 41, 2026-08-09). The handoff seam was built with an
explicitly EMPTY registry rather than a plausible first binding, and the registry's own comment says
why: `person-lookup` is identified by an employee id or a name, `kuali-timekeeper-annotation` by a
document number, and neither is derivable from a photograph without an OCR-backed workflow that does
not exist. This is `INTAKE_PROJECTIONS` between D170 and D172 for the same reason — an invented
binding puts a plausible-but-wrong canonical input into a real run.

**Its trigger: the first OCR-consuming workflow, order 3.** The OCR pipeline workflow migrates at
order 3 precisely so its OCR/roster consumers at orders 4–6 and 9 have something to build on; it is
the first descriptor whose input a photograph can honestly produce. When it declares a
`CaptureIntakeBinding` through `defineCaptureIntakeBinding`, the registry stops being empty and the
handoff stops refusing. The node's own "close this first" is the `run.queued` span identity for
projector-enqueued runs — a capture-minted run is enqueued off the operator's own path, and the
projection folds every run through a write-once `run.queued` identity
(`src/server/dashboard/projectors/run-queue-projection.ts:541-549`), so that is the seam to prove
before a bundle mints one.

**Built today.** Everything except the binding. `composeCaptureSurface` is wired into the production
dashboard composition (`src/server/dashboard/compose.ts:747-760`) with the real registry, restart
recovery drains whatever the last process left `pending` before the first request is served, and the
capture surface's own tests assert against `CAPTURE_INTAKE_BINDINGS` itself rather than a fixture —
`tests/unit/server/capture-surface.test.ts:896` names the production state in a comment so a test
can never prove a surface the product does not have. D174's identity rule holds underneath: a replay
returns the SAME manifest and run ids because both are `deriveStableUuid(namespace,
outbox.stableKey)`, never minted.

**Not built.** One thing: a workflow whose input a photograph can produce. Nothing else about this
deferral is code that is missing.

## Run the dashboard without the dev server / use the phone page in production
<!-- roadmap: def-byte-path -->

<!-- roadmap-status: def-byte-path -->
- [x] the phone surface itself is built and bundled — its own entry, its own closure, `CAPTURE_PHONE_ASSET_ENTRY = "/capture.html"` (`src/domain/capture-surface.ts:83`)
- [x] the ingress refuses BY NAME when it cannot be built — `on-demand-ngrok` with no credential answers a named remediation, never a loopback QR (`src/server/dashboard/commands/capture-service.ts:531-546`)
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed `serveStatic` (`tests/parity/helpers/fixture-bff.ts:298`); every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — the flag `package.json:12` passes is read by nothing (`src/core/runtime-composition.ts:162-200`), so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`
- [ ] BE `/capture.html` delivered, so 2i-F's token-scoped phone surface is reachable from a phone
- [ ] BE the on-demand ngrok tunnel launcher (D175) — the shipped default names a launcher that does not exist
- [ ] BE the guard arm — a phone-origin request may be served nothing outside the capture allow-list
- [ ] BE wire or delete the INERT capture-ingress host gate: `deps.capturePhoneHost` is declared and read (`src/server/dashboard/routes/api.ts:65,142`) and supplied by nothing, so the middleware compiles and can never fire (also Track D row D2)
> 2026-08-20 | docs-cohesion 04 | verified against src/core/runtime-composition.ts:162-200, src/server/dashboard/routes/api.ts:141-403 (no static or asset route), src/domain/capture-surface.ts:83, src/server/dashboard/commands/capture-service.ts:495-546; left: all six build items
<!-- /roadmap-status -->

**What the deferral is.** The production BFF **serves no frontend bytes.** Every dashboard byte you
have ever seen came from the vite dev server on 5174; the BFF on 3938 answers `/api/v1/**` and
`/events/v1` and 404s everything else. Two consequences, and the second is the one that matters: the
dashboard has no way to run without the dev server, and 2i-F's token-scoped phone capture page —
built, bundled, entry-pointed at `/capture.html` — **has no delivery path to a phone at all.**

**The decision that deferred it: D189** (round 45, 2026-08-09), a named gap with an owner rather
than a waiver, taken at the Phase-2 exit. Its reasoning has two halves. Those bytes would ride the
one internet-exposed path in this system — the capture ingress behind the Host gate — which is a
security surface, not a build task. And the tunnel launcher D175 specified is unbuilt anyway, so
serving the page would produce a QR that scans perfectly and fails on the phone with a network
error explaining nothing. D193(a) fixes what "production" means here: **LOCAL** — the day this repo
becomes the operator's daily tool on their own machine, never a hosting platform.

**Its trigger: order 3**, alongside `{#def-capture-binding}`. The two close together on purpose —
a delivered phone page with no workflow that can consume a photograph is a page with nothing to do,
and a capture binding with no delivery path is a binding no phone can reach.

**Built today.** The phone surface, completely: its own bundle entry, its own module closure that
may not reach `surfaces/`/`client/`/`app/`, D174's fragment-borne token (`#t=<token>`, never
transmitted to a server), the closed phone route union, and the uniform refusal that makes an
unknown / malformed / expired / discarded token indistinguishable. The ingress preflight is honest
in the other direction too: `capture.ingress` is `on-demand-ngrok` by default and refuses by name
when its credential is absent or its launcher is missing.

**Not built.** Six things, listed above. The two worth calling out because they read as done and are
not: **`npm run dashboard:prod` names a mode the runtime never parsed** — `package.json:12` passes
`--prod` and `startRebuildRuntime` dispatches on `args[0]` alone, so the flag reaches nothing — and
**the Host gate is inert**. `deps.capturePhoneHost` is optional, and the middleware's first line is
`if (phoneHost === undefined) return next();`. Nothing supplies it in any composition, so the
allow-list that exists to keep a phone origin off the operator's dashboard has never evaluated a
single request. It is correct code in front of a door nobody opened, and either wiring it or
deleting it is part of closing this deferral.

## Edit a workflow's presentation / policy without a code change
<!-- roadmap: def-explorer-edit -->

<!-- roadmap-status: def-explorer-edit -->
<!-- /roadmap-status -->

## A record-sanity-check advisory panel
<!-- roadmap: def-sanity-check -->

<!-- roadmap-status: def-sanity-check -->
<!-- /roadmap-status -->

## Edit settings in the dashboard
<!-- roadmap: def-settings -->

<!-- roadmap-status: def-settings -->
<!-- /roadmap-status -->

## Trust UCPath / ServiceNow wait-before-negative-read windows
<!-- roadmap: def-propagation -->

<!-- roadmap-status: def-propagation -->
<!-- /roadmap-status -->

## Search runs across dates / view screenshots / export Excel
<!-- roadmap: def-search-export -->

<!-- roadmap-status: def-search-export -->
<!-- /roadmap-status -->

## Auto-purge diagnostics on the 14/8/5 schedule · reclaim unreferenced artifact bytes
<!-- roadmap: def-retention -->

<!-- roadmap-status: def-retention -->
<!-- /roadmap-status -->

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

**Nothing has been ratified in this phase yet** — a deferral is closed by the decision that ends it,
and none has been written. What is listed here is the decision that CREATED each deferral, so the
trigger can be read beside the reasoning that deferred it:

| Deferral | Created by | Round · date |
|---|---|---|
| the explorer's EDIT half | D79a (the DSL mode cut) then **D186** (reassigned out of Phase 2 on D79a's own argument) | rounds 8 · 2026-07-23 and 45 · 2026-08-09 |
| the production frontend byte path / the phone in production | **D189** (a named gap, not a waiver) with D174/D175's capture ingress | rounds 41 · 2026-08-09 and 45 · 2026-08-09 |
| the capture → OCR-backed run binding | **D174** (the handoff seam's idempotent identities) | round 41 · 2026-08-09 |
| the record-sanity-check advisory | **D192** (retire run-summary and selector-suggest; sanity check stays open, deferred to order-8) | round 46 · 2026-08-12 |
| editable settings | **D193**'s storage clause (done until asked) | round 47 · 2026-08-12 |
| UCPath / ServiceNow propagation windows | **D207** (separations' provisional `stabilized` window, confirmable only by a controlled commit) and D128/D135's measured Kuali window | rounds 52 · 2026-08-14 and 30 · 2026-08-04 |
| cross-date search · screenshots · Excel export | the Phase-2 tail scope (D168–D180) that named them out | round 44 · 2026-08-09 |
| diagnostic auto-purge · unreferenced artifact bytes | **D137** (retention purges the row and its index, never the shared content-addressed bytes) | round 32 · 2026-08-04 |

## Exit criteria

07 records no exit block for the deferrals — by construction: a deferral closes when
its own trigger fires, and each trigger is named in that deferral's section above (and normatively
in its owning `reference/` doc). Two of them are Phase-2's explicit dispositions and carry their
owners in `02-prove-writes-build-the-tails.md` §Exit criteria: the explorer's EDIT half (D186) and
the production BFF's frontend bytes (D189).
