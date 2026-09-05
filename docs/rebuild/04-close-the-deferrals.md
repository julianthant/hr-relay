# Phase 5A · Close cutover-readiness gaps

This doc is the dedicated home of Phase 5A, tree nodes `{#deferred}` and `{#cutover-readiness}` —
every "I want to do X; the plan said build Y; Y is deferred" answer, and the **disposition** that
ends each one. It is the readiness inventory before Phase 5B's authority switch. An item may be
completed, retired, or explicitly carried to its owning later part; none may float outside a phase.
Contracts these items belong to live in `reference/`.

**D323 numbering note (2026-09-03).** The stable filename remains `04-...` for links, but this work
is Phase 5A. Phase 4 is the workflow-migration program; Phase 5A closes or assigns readiness gaps
before Phase 5B switches production authority.

## Shelf summary
<!-- roadmap: deferred -->
<!-- roadmap: cutover-readiness -->

<!-- roadmap-status: deferred -->
- [x] every deferral names its trigger, and none is a silent drop — nine nodes, each with a trigger, decided stance or retirement
- [x] two have a decided STANCE instead of a trigger (D193) — the retention sweep's schedule and the content-store refcount; they are `wont-build-unless-asked`
- [-] the record-sanity-check advisory — **retired** by the operator 2026-08-18 (D192; `config/legacy-capabilities.json`), not deferred any more
- [ ] the production byte path remains open: `dashboard:prod` still does not serve the built local dashboard. The cross-cutting trigger fired: DCR3–DCR5 close search, its Separations surface and evidenced XLSX; D291/D292/D306 serve run/Archive screenshots, and the 2026-09-03 D289 amendment retires automatic attempt comparison. The broader generic resource/gallery family, Settings and Explorer retain explicitly named later scope
- [ ] the propagation windows — measured for Kuali only (D135/D207); UCPath and ServiceNow wait on their own live probes at order 7
- [ ] controlled desktop update — v1 is signed manual in-place install; the later updater waits for the packaged upgrade proof and one fail-loud quiescence/ordered-shutdown authority (D297)
- [ ] the non-phone Phase 3a fidelity residue carried in by D279 (2026-08-27) — see §"Carried in from Phase 3a"; each line closes here or is explicitly parked. D294 closes the retired Capture Mode subset.
- [!] D282 ratifies scheduling, not completion — every dashboard-owned deferral is active now, and each row still closes only with its implementation, proof and owning-doc update
> 2026-08-28 | dashboard completion | D282 fires the scheduling trigger for every dashboard-owned deferral and D279 carry-in; no row is marked built by that direction, and Review/People producer facts remain dependencies on their Phase 3c migrations rather than fabricated generic data
> 2026-08-28 | current-workflow scope | D283 runs separations-provable and cross-cutting dashboard work now; OCR Review and Group People remain with their named Phase 3c migrations. D294 later retires mobile Capture Mode rather than creating a capture-to-workflow migration.
> 2026-08-28 | DCR receive | verified DCC1–DCC3's Settings/preflight controls, DCC4–DCC5's complete existing-workflow Explorer boundary and DCR3–DCR5 reporting; left: two trigger-gated absences, artifact bytes/screenshots, the D289 rerun comparison, the stance rows, and UCPath/ServiceNow propagation measurements
<!-- /roadmap-status -->

### What the deferred shelf is

**It is the answer sheet.** Every deferral in this program was created by a decision that said why,
and every one of them names the event that ends the deferral. This doc collects them in one place so
an operator asking "why can't I do X?" gets three things in one section: what the absence IS, the
decision that made it an absence, and what has to happen before it stops being one. A deferral with
no trigger is a silent drop, and this program does not have any.

**It is not a milestone.** Nothing in the deferred shelf is scheduled. Six of the nine wait on a named event;
one carries D193's decided `wont-build-unless-asked` stance, and two are retired. None is a waiver:
a waiver has no owner, and each of these has one.

**It is not the cutover's blocker list.** `05-cut-over.md` §Exit criteria is where the cutover's
conditions live, and it names none of these nine. A deferral that reached the cutover unclosed is
carried past it deliberately, with its trigger still standing.

### The nine, and what ends each one

| Deferral | Node | Created by | Trigger — the event that ends it |
|---|---|---|---|
| Run the built dashboard without the dev server | `{#def-byte-path}` | D189, amended D294 | standalone local operator-dashboard completion: parse `--prod` and safely serve `dist/dashboard` |
| Edit a workflow's presentation / policy without a code change | `{#def-explorer-edit}` | D79a, reassigned by **D186** | D283 closes the complete existing-workflow boundary: label/icon/category hot apply; timeline/grouping and notification unavailable without owners; policy/Edit Data strict source briefs. A **SECOND** production workflow still triggers new-workflow authoring and broader design work. |
| A record-sanity-check advisory panel | `{#def-sanity-check}` | D192 | **none — RETIRED 2026-08-18.** The §14.2 gate packet's deterministic comparison IS the sanity check |
| Broader legacy Settings capabilities | `{#def-settings}` | D169/D184, stance D193(b); bounded backend/editor/preflight closed by DCC1–DCC3 | the Phase-3 **cross-cutting** closure; only the explicitly named broader capability entries remain deferred |
| Trust UCPath / ServiceNow wait-before-negative-read windows | `{#def-propagation}` | D128/D135 (Kuali, measured), D207 (separations) | each system's own live probe — UCPath at **order 7** |
| Search runs across dates / view screenshots / export Excel | `{#def-search-export}` | the 2i tail (D168–D180) that named them out | the Phase-3 **cross-cutting** closure, shaped against a real run corpus |
| Auto-purge diagnostics · reclaim unreferenced artifact bytes | `{#def-retention}` | D137, stance **D193(b)** | **none — you ask.** `wont-build-unless-asked`, off every milestone |
| Controlled desktop updates | `{#def-desktop-update}` | **D297** | the signed manual older→newer upgrade is proved on macOS and Windows, and the desktop owns one fail-loud quiescence verdict plus ordered shutdown that closes workers, browsers, the BFF, storage handles and locks before installation |

### The honest state

**One remains untriggered as an operator-dashboard delivery gap.** `dashboard:prod` does not serve
the built dashboard. Verified run/Archive screenshot evidence is served; the broader generic
resource/gallery family remains unbuilt. DCC1–DCC3 close the
resolver-owned Settings edits and preflight/doctor controls. DCC4–DCC5 complete the existing-workflow
Explorer boundary: label/icon/category hot apply; timeline/grouping and notification unavailable
without owners; policy/Edit Data strict source briefs. DCR3–DCR5 close cross-date search, its
Separations Top Bar surface and evidenced XLSX export; the 2026-09-03 D289 amendment retires automatic attempt comparison.
New-workflow authoring and broader legacy settings/editor capability entries remain open by name,
which is what distinguishes a deferral from a hole.

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
manifest, the Edit-Data UI, and the Phase-0 deferred-decision log — is
`history/superseded/2026-08-20-master-plan-dissolved.md` §3.5 and §3. Every milestone it named has
landed (2h closed 2026-08-08, 2i 2026-08-09), so repeating it here would be a schedule for work that
is done. What survived it is the nine entries above, including the separately recorded retired
Capture Mode._

### Carried in from Phase 3a (D279, 2026-08-27)

Phase 3a closed its exit table 10/10 with row 10 — demo fidelity — met **by disposition**: every Track F line landed, and what the three fidelity ledgers still name is polish that no separations or cutover work waits on. It is carried here by name so it cannot be lost; it adds nothing to `05-cut-over.md`'s blocker list. Each line closes with a commit or is parked with a one-clause reason.

| # | Carried line | Source | State |
|---|---|---|---|
| C1 | ledger 2's 10 structural rows | `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` | closed — DCF1 (`c1507786`) row-by-row disposition |
| C2 | ledger 1's layout/control groups + C69's re-plan path | `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` | closed — DCF2/DCF3 (`f7c5ca65`, `a36f1510`) |
| C3 | ledger 3's AR39/AR59 and remaining non-copy marks | `docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` | closed — DCF4 (`d474f526`) and named D275/D179/D223 dispositions |
| C4 | the `PanelHeader`-span heading finding (P1) | `docs/plans/2026-08-26-p1-refreeze-attribution.md` | closed — 13 production `PanelHeader` headings at `h2` (`029eaba1`); kit specimens excluded |
| C5 | former Capture Mode findings (D278 and photo metadata/retake gaps) | `docs/rebuild/findings/capture.md` | **retired by D294**; no active implementation obligation |

## Retired — phone photograph → OCR-run Capture Mode (D294)

This former deferral is closed by retirement. No OCR workflow must declare a Capture Mode binding,
and no new phone session, bundle, handoff, ingress, or QR authority may be reintroduced. The
historical detail below records D174 provenance only; it is not an implementation plan.

**The decision that deferred it: D174** (round 41, 2026-08-09). The handoff seam was built with an
explicitly EMPTY registry rather than a plausible first binding, and the registry's own comment says
why: `person-lookup` is identified by an employee id or a name, while `separations` needs a Kuali
document number plus workflow constants, and neither is derivable from a photograph without an
OCR-backed workflow that does not exist. This is `INTAKE_PROJECTIONS` between D170 and D172 for the same reason — an invented
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

## Run the built dashboard without the dev server
<!-- roadmap: def-byte-path -->

<!-- roadmap-status: def-byte-path -->
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed `serveStatic` (`tests/parity/helpers/fixture-bff.ts:298`); every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — the flag `package.json:12` passes is read by nothing (`src/core/runtime-composition.ts:162-200`), so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`
> 2026-08-31 | D294 | Capture Mode's page, ingress, tunnel, and host gate are retired. Only ordinary local static serving remains.
<!-- /roadmap-status -->

**What the deferral is.** The production BFF **serves no frontend bytes.** Every dashboard byte you
have ever seen came from the Vite dev server on 5174; the BFF on 3938 answers `/api/v1/**` and
`/events/v1` and 404s everything else. The dashboard therefore has no way to run without the dev server.

**The decision that deferred it: D189** (round 45, 2026-08-09), amended by D294, is a named local
operator-dashboard gap with an owner rather than a waiver. D193(a) fixes what "production" means
here: **LOCAL** — the day this repo
becomes the operator's daily tool on their own machine, never a hosting platform.

**Its trigger is standalone dashboard completion.** It no longer depends on a workflow migration.

**Not built.** Two things remain: **`npm run dashboard:prod` names a mode the runtime never parsed** — `package.json:12` passes
`--prod` and `startRebuildRuntime` dispatches on `args[0]` alone, so the flag reaches nothing — and
the BFF has no static handler for the built dashboard.

## Edit a workflow's presentation / policy without a code change
<!-- roadmap: def-explorer-edit -->

<!-- roadmap-status: def-explorer-edit -->
- [x] Phase A shipped and is proved — the read-only graph is a projection of the ONE composition root (D176), with the UI catalog beside it (D177) and the field-table node panel (D227)
- [x] DCC4/5 complete the closed existing-workflow boundary: one field-row door for label/icon/category, exact draft validation, one typed apply command and exact refreshed readback; timeline/grouping and notification name their unavailable owners; policy and descriptor-allowlisted Edit Data produce strict source briefs; graph and contract facts remain read-only
- [x] `workflow-editor-compile-integrity` is active with Phase-A and DCC4 Phase-B arms; the DCC5 client consumes `POST /api/v1/explorer/validate`, so its pending wire binding is removed
- [x] notification preferences and timeline/grouping remain named unavailable without complete owners; operational policy and descriptor-allowlisted Edit Data produce strict source briefs; unallowlisted source values refuse
- [ ] the new-workflow authoring path (`ref operator-trust` §5.5) — no scaffold flow, CLI command or generator exists; it travels with this deferral by the operator's ruling
- [!] D283 superseded D186's timing only for this closed existing-workflow subset; a SECOND production workflow still triggers broader authoring, policy, notification and Edit Data work
> 2026-08-28 | DCC6 closure | verified field ownership, typed validate/command payload tests, exact refreshed readback, unavailable-owner arms and strict source briefs; left: new-workflow authoring and broader legacy design authority
<!-- /roadmap-status -->

**What remains deferred.** The new-workflow **authoring** path (`ref operator-trust` §5.5) and
broader legacy design authority. Timeline/grouping and notification have named unavailable arms until
complete owners exist. Policy and descriptor-allowlisted Edit Data already produce strict reviewed
source briefs, never a partial hot apply. The Explorer reviews and hot-applies only its served
label/icon/category values; its graph, nodes, contracts, field census and UI facts remain
inspection-only.

**The decision that originally deferred it: D186** (round 45, 2026-08-09), reassigning it out of Phase 2 on
**D79a's own argument one level down.** D79a cut the DSL because a pipeline whose only user is its
own test is not worth building; D186 observes that an editor exists to avoid a code change per tweak
**across many workflows**, and this tree has ONE production workflow plus a one-node transaction
proof. With one workflow, editing the source is the cheaper and more reviewable path — and building
the editor now would fix its closed policy union and its override schema **against a sample of one**,
which is precisely how an authoring surface acquires the wrong shape.

**Its trigger was superseded for the existing-workflow boundary by D283.** The original
second-workflow criterion still explains why new-workflow authoring and broader design remain closed,
but DCC4/5 now provide separately reviewed hot-apply, unavailable-owner and source-brief arms
without broadening that boundary.

**Built today.** The graph remains a projection of the ONE composition root (D176) — everything it
shows is derived from the same `WORKFLOW_MODULES` tuple the runtime executes, so it cannot describe a
workflow the runtime does not have. DCC4 adds a strict draft/validate/apply protocol; DCC5 puts its
three presentation doors on their exact field rows, posts the complete reviewed command envelope and
only announces applied after the refreshed projection exactly matches the reviewed override. The UI
catalog serves the COMMITTED artifact (D177), and the node panel's census is derived (D227).

**Still not built, and still not partial.** No authoring union, no executable descriptor mutation and
no config path can reach a descriptor. Policy/Edit Data requests produce a reviewed strict source
brief; timeline/grouping and notification preferences name their unavailable authority. The legacy workflow modifier
(`ref operator-trust` §5.6) remains in the legacy repo, unproxiable and unimportable under D93.

## A record-sanity-check advisory panel
<!-- roadmap: def-sanity-check -->

<!-- roadmap-status: def-sanity-check -->
- [-] **RETIRED by the operator, 2026-08-18** — no AI feature; the deterministic §14.2 comparison IS the sanity check (D192; `config/legacy-capabilities.json` → `legacy-tool-ops-sanity-check-record`, `disposition.kind: "retired"`)
- [x] the deferral condition D192 named ("renders beside the order-8 ALWAYS-GATE identity approval") was met DETERMINISTICALLY — the gate packet's server-computed `comparisons` array occupies exactly that slot (`ref write-safety` §14.2)
- [x] `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape, `["failure-triage", "contact-normalization"]` (`src/domain/ids.ts:232`) — no surface arm was ever added
- [x] its two siblings retired with it on the same reasoning (D192): run summary duplicates the receipt, selector suggestion is an unverified selector reaching a live driver
> 2026-08-20 | docs-cohesion 04 | verified against config/legacy-capabilities.json (`kind: "retired"`, reason names the 2026-08-18 ruling) and src/domain/ids.ts:232; nothing left — reopening requires a fresh decision, not a build
<!-- /roadmap-status -->

**This is no longer a deferral. It is retired**, by the operator on **2026-08-18**, and the section
exists to say so where somebody looking for the AI sanity check will look.

**What it was.** The one AI advisory tool D192 kept open. Legacy has an ops script
(`src/scripts/ops/sanity-check-record.ts`) that reads a record and says whether it looks wrong;
D192's plan was to render its rebuild equivalent as prose beside the order-8 separations
ALWAYS-GATE, where a human is already being asked to confirm an identity.

**Why it retired instead of being built: its deferral condition was met deterministically.** The
`ref write-safety` §14.2 identity-evidence packet computes its own `comparisons` array SERVER-side —
the disconfirming evidence, Kuali beside UCPath, leading the packet — and that array occupies
exactly the slot the AI prose was reserved for. Separations' §9.17 live pass flagged the condition
as materially satisfied and left the closure to the operator, who ruled: **no AI feature — the
deterministic comparison IS the sanity check.** A paraphrase of a comparison the server already made
is strictly worse than the comparison: it can be wrong, and it cannot be diffed.

**Its two siblings retired with it** on the same argument, which is worth keeping because it is the
general shape. Run summary → `RunEvidenceReceipt` is already the run's structured,
byte-reproducible, per-field-redaction-declared summary, so an LLM digest over the same facts would
duplicate it and reintroduce paraphrase risk on the exact surface D141 built to remove. Selector
suggestion → an operator-facing LLM selector suggestion is an unverified selector reaching a live
driver, which the fail-loud rule bans outright; the deterministic half (`npm run selector:search`)
stays and is unaffected.

**What retirement means structurally.** `AdvisorySurfaceIdSchema` stays closed at D178's two values
(`failure-triage`, `contact-normalization`) — no arm was added for the sanity check and none will be
— and `config/legacy-capabilities.json` carries the disposition as `retired` with the ruling as its
reason, so the `legacy-capability-disposition` guard (D184) validates it like every other closed
entry. **Reopening requires a fresh decision, not a build.**

## Edit settings in the dashboard
<!-- roadmap: def-settings -->

<!-- roadmap-status: def-settings -->
- [x] the Settings surface is server-owned and bounded — the editable inventory/readback is separate from storage health and the on-demand read-only doctor (D169/DCC3)
- [x] the command family, its target and its atomic N-leaf payload are contracted (`src/domain/commands.ts`)
- [x] BE `apply-settings` is active with exact expected-revision enforcement, strict recursive patch/schema fingerprints, atomic file replacement and command-transaction rollback
- [x] BE both composition roots read the strict settings record and the resolver exhaustively applies all owned groups, including `browser`, while retaining `env > settings > default`
- [x] BE the registry-derived dashboard preflight authority is composed at startup, served by bootstrap and rerun through the strict read-only `POST /api/v1/preflight/rerun` command; the old `FrontendBootstrapWireSchema#preflight` declared-unserved binding is removed
- [x] FE the server-listed Settings write path, persisted readback, preflight rerun and on-demand read-only storage doctor controls
> 2026-08-28 | DCC3 | Settings now forms one revision/schema/patch-bound N-leaf command from the resolver-owned editable inventory; environment-owned leaves remain visible but locked, and preflight refuses until a restart activates persisted settings
<!-- /roadmap-status -->

**What remains deferred.** The Settings surface now edits only the resolver-owned inventory the
server serves. Its one atomic patch command, persisted readback, preflight rerun and read-only doctor
do not make credentials, AI assist, delete/recover, or any resolver-unowned legacy setting editable.
Those broader capability entries remain open in `config/legacy-capabilities.json`.

**The decision that deferred it: D169** (round 38, 2026-08-08), which took the doctor/backup wire
live and explicitly left `apply-settings` deferred, reinforced by **D184** (round 45), which marked
`FrontendBootstrapWireSchema#preflight` `declared-unserved` until a real authority existed rather
than letting the Top Bar render a green stethoscope over checks nobody ran. DCC2 closed that
declaration: bootstrap serves the retained strict report, and DCC3 consumes the rerun route with the
active runtime fingerprint. The invariant is unchanged: **an absent verdict is drawn as absent.**

**Its trigger: the Phase-3 cross-cutting closure**, not a single event. This is the honest shape and
the node says so — editable settings is one row of `{#cross-cutting}`'s "where legacy is still
ahead" list, shaped against a real run corpus rather than invented in planning. There is no
workflow whose migration forces it, which is exactly why it has a milestone instead of a trigger.
**The operator fired that scheduling trigger on 2026-08-28 through D282's dashboard-completion
direction.** DCC1 landed the settings executor, file readback and runtime-generation fence; DCC2
landed the preflight service and read-only rerun authority; DCC3 landed the bounded Settings UI
controls. The scheduling direction itself was not an implementation claim.

**Built today.** The command family, target and **atomic N-leaf payload** are contracted and active.
The checked deferred partition is empty. One expected revision covers the whole recursively strict
patch; the writer uses same-directory staging, fsync, atomic replace, directory fsync and exact
readback, while the kernel holds an exact-byte rollback until its journal/audit transaction commits.
Both process roots load the resulting record through the sole resolver, including `browser`, and
environment bindings retain precedence. Stale, malformed, partial and uncertain state fails loud.

**Built in DCC3.** The dashboard reads the strict server-listed editable inventory, retains one
page-wide draft and emits one exact expected-revision/schema/patch-fingerprint command. It renders
persisted readback, conflict/refusal and restart-required states; environment-owned values never become
browser-editable. The retained preflight truth remains visible, and its typed rerun caller binds the
active runtime fingerprint and refuses while restart is required. The read-only storage doctor remains
an on-demand inspection only; the rerun route is no longer `served-unconsumed`.

## Trust UCPath / ServiceNow wait-before-negative-read windows
<!-- roadmap: def-propagation -->

<!-- roadmap-status: def-propagation -->
- [x] **Kuali is measured and closed** — four operator-authorized write/restore cycles on real doc 4490, 2026-08-04: worst observed fence→trustworthy-negative ≈ 3.3 s (D135)
- [x] D135's retired annotation contract measured the Kuali mechanism window: `minSinceFenceMs: 30_000`, two reads 5 s apart, `requireSameSourceState`; the evidence remains ref write-safety §3.4 history
- [x] `kuali/save-separation-finalization` reuses that window under D207's mechanism-transfer rule — **provisionally**, until its own controlled-commit proof confirms
- [ ] the separations finalization's own controlled commit, which is what turns that provisional transfer into a measurement
- [ ] **UCPath is unmeasured** — both termination contracts are `operator-only` with the refusal to guess stated in the contract (`create-termination.ts:105-112`, `delete-pending-terminations.ts:94-99`)
- [ ] **ServiceNow is unmeasured** — no commit contract exists for it yet; its window is measured at its own live probe
> 2026-08-25 | D266 reconciliation | verified against the three current commit contracts' `recoveryAbsence` blocks under src/domain/contracts/{kuali,ucpath}/ and §3.4's historical Kuali measurement; left: the UCPath measurement (order 7) and the separations confirmation
<!-- /roadmap-status -->

**What the deferral is.** When a write's fence lands and the read-back afterwards says the value is
NOT there, the system has two possible answers: *"it genuinely did not land"* or *"it landed and has
not propagated yet."* Trusting the negative requires a **measured propagation window** for that
system, on that mechanism. Kuali has one. **UCPath and ServiceNow do not**, so a post-fence absence
there parks for a human instead of settling.

**The decisions.** **D128** (round 26, 2026-08-04) is where the rule was paid for: Phase 2's one
authorized real write fenced, clicked Save, got HTTP 200 and a rendered *Form saved*, and persisted
nothing — so `recoveryAbsence` stayed `operator-only`, because *a write that never lands measures no
propagation window, and inventing `minSinceFenceMs` is the banned constant.* **D135** (round 30, the
same day) then measured it properly once the real causes were found and fixed. **D207** (round 53,
2026-08-14) is the transfer rule: a measured window travels with the MECHANISM when the reusing
contract names the same write request, the same negative read, and an absence that is safe in the
direction it can be wrong — **provisionally**, until the reusing write's own controlled commit
confirms it.

**Its trigger: each system's own live probe, UCPath at order 7.** This deferral is per system, not
global; it closes one system at a time, and `ref workflow-model` §1.6.2 requires each admitted
Phase 4 packet to name and close its unproven live probes.

**Built today.** The whole mechanism, and two of four contracts carry real numbers. Kuali's window
was measured on the exact form through the exact mutation: the save answers in ~2.5–3.0 s, Kuali's
own document query agrees on the first sample ~270 ms later, and a full browser reload agrees within
~3 s. `minSinceFenceMs` is nonetheless set to **30 s** — about nine times the worst observation —
with two reads 5 s apart on the same source state. That is what a measured window looks like when it
is used conservatively.

**Not built, and the asymmetry is the point.** UCPath's two contracts refuse to guess **in the
contract text itself**, and they give the reason a reader can act on: nothing in this repository has
ever watched a Smart HR submit propagate to the SS Smart HR search page, and the stakes are a real
termination rather than a benign annotation. The direction-of-error argument is what separates the
two systems — settling a Kuali negative re-fences and re-saves the IDENTICAL staged field set, while
settling a UCPath negative wrongly files **a second real termination.** That is why the same
mechanism transfer D207 allows between two Kuali writes does not reach UCPath at all.

## Search runs across dates / view screenshots / export Excel
<!-- roadmap: def-search-export -->

<!-- roadmap-status: def-search-export -->
- [x] the ONE export that ships is the Activity report's CSV, `GET /api/v1/reports/activity.csv` (`src/server/dashboard/routes/api.ts:192`, D240)
- [x] the evidence the missing surfaces would serve is all durable already — diagnostic bundles are content-addressed with an attachment index, artifact refs and resource schemas are complete
- [x] the per-fact half of rerun transparency exists: `retryOf` plus `reuse` rows carrying `ageMs` and the bound they were judged against (`ref operator-trust` §2.4)
- [x] BE the verified run/Archive artifact-byte path — D291/D292 serve diagnostic-index-authorized bytes and D306 mounts the same run collection in Logs and Receipt; only the broader generic resource-status/gallery family remains open
- [x] BOTH the DCR3 cross-date search authority + transport — strict `GET /api/v1/search` query/page contracts and typed client over the measured current separations corpus
- [x] FE the DCR4 cross-date search surface — the Top Bar defaults to the durable Separations corpus and retains an explicit served-day scope
- [x] BE the DCR5 operator xlsx export — a dedicated command verifies and persists exact attachment evidence for a DCR3 snapshot or Activity range; the D164 retention sink remains distinct
- [x] D289 amendment retires automatic rerun comparison — attempts remain separately inspectable with their own ordinary facts and no synthesized diff
- [ ] fold one logical item's runs into one queue row with separately selectable attempt numbers; the current queue projection still emits one top-level row per run
> 2026-09-03 | D289 amendment | comparison registry, endpoint and Receipt panel removed; no replacement comparison is planned
<!-- /roadmap-status -->

**What the deferral is.** The remaining legacy affordances the rebuild does not surface. DCR3–DCR5
now serve strict **search runs across dates**, its Separations Top Bar surface and an evidenced XLSX
for an exact search snapshot or Activity range. Verified diagnostic screenshots can now be opened
from a run's Logs or Receipt and from frozen Archive evidence; the broader generic gallery family
remains unbuilt. The 2026-09-03 D289 amendment retired automatic comparison; each attempt keeps its
own ordinary facts and the operator compares attempts directly. The requested one-item-row attempt
presentation remains unbuilt over the current one-row-per-run queue projection.

**The decision that deferred them.** No single one — they were named OUT of the 2i operator-surface
tail (D168–D180, rounds 38–44) as the tail was scoped, and each has a reason of its own recorded
where its capability lives. `legacy-route-search`'s disposition says it plainly: the search family
closes **as the migrations produce the run corpus a search surface must be shaped by.** D164 built
the xlsx writer as a `xlsx-retention` SINK for the artifact pipeline and left it uncomposed in
production, so what is missing is an operator-facing export, not a writer.

**Its trigger: the Phase-3 cross-cutting closure**, and the shaping constraint is the interesting
half. These three are listed under `{#cross-cutting}` — "where legacy is still ahead" — and every
one of them is deliberately shaped **against a real run corpus** rather than invented in planning.
A search surface built today would be filtered against two workflows' worth of runs. The field-level
rerun diff was later built under D289 and then retired by its 2026-09-03 amendment because the product should present
each attempt's facts without interpreting differences between attempts.
**The operator fired the scheduling trigger on 2026-08-28 through D282.** The implementation must
measure and test the corpus that now exists rather than author ranking from fixture intuition; the
artifact route, search and export rows remain open until their proofs land; the rerun-diff row is
retired.

**Built today.** Diagnostic bundles are content-addressed with a durable attachment index and
per-field redaction applied AT capture; D291/D292 serve verified run and Archive bytes, D306 adds
explicit per-run browser screenshots and exposes the same evidence in Logs and Receipt, the
Activity report has a second authority behind it and a served CSV (D236/D240), and DCR3–DCR5 add
the strict corpus search, surface and evidenced XLSX. The remaining absence is the broader generic
status/gallery family; the 2026-09-03 D289 amendment removed the automatic receipt-comparison feature.

**Not built.** The broader generic status/gallery family remains. Run-bound and Archive screenshot
evidence does not wait on it.

## Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes
<!-- roadmap: def-retention -->

<!-- roadmap-status: def-retention -->
- [x] the sweep is built and tested — `createDiagnosticRetentionSweep` reads the `(retention_kind, purge_after)` index, re-derives each disposition and throws if it disagrees with the row (`src/services/trust/diagnostic-retention.ts:45-85`)
- [x] retention itself is explicit and shipped: an ordinary bundle's `purgeAfter` is its own capture instant plus 30 days (`DIAGNOSTIC_ORDINARY_RETENTION_DAYS`, `src/domain/trust/diagnostic-capture.ts:44`); a pinned bundle stores a named reason and no instant, and is structurally unreachable from the due query
- [x] **D193(b) dispositioned BOTH remainders `wont-build-unless-asked`** — off every milestone, blocking no gate
- [ ] scheduling the sweep — nothing in `compose.ts`, in `src/cli.ts` or on any timer calls it, so **no bundle has ever been purged on this machine**
- [ ] the content-store reference count that would let the sweep's reported unreferenced artifact bytes actually be reclaimed
> 2026-08-20 | docs-cohesion 04 | verified against src/services/trust/diagnostic-retention.ts:45-85 (no production caller — only tests/unit/diagnostic-capture.test.ts:389-393) and src/domain/trust/diagnostic-capture.ts:44; left: both, and both are `wont-build-unless-asked`
<!-- /roadmap-status -->

**The node used to be titled "the 14/8/5 schedule". No constant in this tree implements one, and
the title is corrected here.** The phrase reached the tree and `ref dashboard-surfaces` from an early
draft; the shipped schedule is ONE number — **30 days from the bundle's own capture instant**, D86's
notes floor, which is where the number comes from — with no tiering by kind, sensitivity or age.
Cite the constant, not the phrase. (`ref operator-trust` §2.2 carries the same correction as its own
normative text.)

**What the deferral is.** Two things, and they are different sizes. **(1)** Nothing ever RUNS the
retention sweep, so no diagnostic bundle has ever been purged here. **(2)** Even when it runs, the
content-addressed artifact bytes an attachment points at are **not** deleted — the sweep reports the
now-unreferenced artifact ids and stops there, because reclaiming them needs a reference count the
artifact store does not keep.

**The decision that deferred them: D193(b)** (round 47, 2026-08-12), the operator's own storage
ruling, and it is a **stance, not a schedule** — both items moved from "deferred with an owner" to
`wont-build-unless-asked`: not planned, not owed by any slice, no future gate blocked on them.
D137 (round 32) is where the second half's shape was set: retention purges the bundle row and its
attachment index together and never the shared bytes, because a receipt, a second bundle or a
scenario fixture may still reference exactly those bytes by digest.

**Its trigger: you ask.** There is no event. That is the honest state and the node's chip says so.

**The operator's reasoning, recorded because it is the part that generalizes.** This authority
database stores records of **COMPLETIONS, not primary records.** The real record of a filed HR
transaction lives in the external system — the UCPath transaction, the Kuali document — and can be
checked there in more than one way; the rows here carry HOW a thing was completed and WHETHER it
completed, and once it is completed and approved they mean little going forward. That is what makes
disk growth on one local machine not worth a durable reference count. It says nothing about
durability DURING a write: the fence, its binding proof and a parked intent stay load-bearing for
the run in flight.

**Built today.** More than "the sweep exists". It re-derives each disposition from the row and
throws if the two disagree, purges bundle and attachment rows in ONE transaction so the boot
invariant tying a bundle's `attachments` array to its indexed rows can never see a half-purged
bundle, reports a bundle that was due at query time and gone at purge time as `vanished` rather than
as an error, and **throws by name if asked to purge a pinned bundle** — retention never silently
unpins evidence a knowledge/fix record or a write recovery still depends on. The adjacent stream
prune is a different mechanism and it IS wired: `pruneEventStreams` runs at dashboard boot before
the fold (`src/server/dashboard/compose.ts:574-578`), prunes `spans/` and `notes/` at 30 days by file
date, and can structurally never see `ledger/`, whose floor is forever.

**Not built.** A caller, and a refcount. Read `ref operator-trust` §10's fourth residual through
this: a restricted bundle is local, and it is not short-lived.

## Controlled desktop updates
<!-- roadmap: def-desktop-update -->

<!-- roadmap-status: def-desktop-update -->
- [x] D297 fixes v1 delivery as a signed manual installer run IN PLACE over the existing installation; uninstall-first is not an update path
- [x] D297 fixes the later updater's invariant — discovery/download may occur while open; install/restart/force-quit may not occur while a run, worker or browser session is active
- [ ] PROOF the signed manual older→newer upgrade on macOS and Windows preserves authority rows, artifacts, profiles, settings and OS-keychain credentials
- [ ] BE one fail-loud desktop quiescence verdict and ordered shutdown that stops workers and browsers, stops the BFF, closes storage handles and releases locks before handing off to an installer
- [ ] BE only after that trigger: a controlled update channel that verifies the signed release, refuses active work by name and applies on a clean restart
> 2026-09-01 | D297 | trigger and safety boundary ratified; v1 manual upgrade and later controlled updater remain unbuilt
<!-- /roadmap-status -->

**What the deferral is.** The v1 application does not check for, download or install releases itself.
An operator updates one installed machine by running the newer signed installer over the existing
installation. That is an ordinary supported upgrade path, not an uninstall/reinstall ceremony, and
it does not relocate mutable app data into replaceable program resources.

**The decision that deferred it: D297.** This local app files real HR transactions. Updating between
a write fence and its read-back can turn a known in-flight operation into an UNKNOWN submit, so
convenience cannot own the shutdown decision. D297 keeps Electron because it already has to own the
BFF, workers, browser automation and keychain boundary, then draws the updater behind that same
process-lifecycle authority.

**Its trigger: the manual upgrade and the quiescence seam are both proved.** First, an installed
older version upgrades in place on real macOS and Windows machines while preserving the stable app-
data roots and keychain identity. Second, the desktop exposes one verdict that either names active
work and refuses or proves there is no non-terminal run and no active worker/browser child, then
performs an ordered shutdown of children, storage handles and locks. Only then is an update channel
eligible to be scheduled.

**What the later updater may do.** It may discover and download a signed release while the app is
open. It may not install, restart or force-quit until the quiescence verdict passes and the ordered
shutdown completes. The release channel carries only signed update metadata and binaries; HR data,
authority rows and credentials remain local. An air-gapped machine stays on the same signed manual
installer path.

**Not built.** Both the manual upgrade proof and the controlled updater. The former is a desktop-stage
packaging acceptance criterion; the latter remains here after that stage because the desktop stage can ship
without an update service.

## Decisions this shelf ratified

Checked against `reference/decisions.md`'s `_phase:_` markers on 2026-08-21: **the ledger carries no
`_phase: 4_` marker, and that is correct.** A deferral is closed by the decision that ENDS it, and
none has been written. What follows is therefore the inverse index — the decision that CREATED each
deferral — so a trigger can be read beside the reasoning that deferred it. The ratification act and
the normative pointer stay in the ledger; this is the phase index.

| Deferral | Created by | Round · date |
|---|---|---|
| the capture → OCR-backed run binding | **D174** — the handoff seam ships with an EMPTY registry and idempotent derived identities | 41 · 2026-08-09 |
| the production frontend byte path / the phone in production | **D189** (a named gap, not a waiver) with **D175**'s on-demand ingress; **D193(a)** fixes "production" as LOCAL | 45 · 2026-08-09, 41 · 2026-08-09, 47 · 2026-08-12 |
| the explorer's broad EDIT half + the new-workflow authoring path | **D79a** (the DSL mode cut), then **D186** (reassigned out of Phase 2), with **D283** closing only the strict existing-workflow subset | 8 · 2026-07-23, 45 · 2026-08-09 and 100 · 2026-08-28 |
| the record-sanity-check advisory | **D192** deferred it to order 8; the operator RETIRED it 2026-08-18 | 46 · 2026-08-12 (retired 2026-08-18) |
| editable settings | **D169**'s deferred `apply-settings` family, with **D184**'s former `declared-unserved` preflight arm and DCC1–DCC3's bounded resolver-owned edit/preflight closure | 38 · 2026-08-08, 45 · 2026-08-09 and DCC · 2026-08-28 |
| UCPath / ServiceNow propagation windows | **D128** (the controlled commit that measured nothing, so `operator-only` stands), **D135** (Kuali measured), **D207** (the mechanism-transfer rule, provisional) | 26 · 2026-08-04, 30 · 2026-08-04, 53 · 2026-08-14 |
| cross-date search · screenshots · Excel export | named out of the 2i operator-surface tail (**D168–D180**); DCR3–DCR5 close current-corpus search, its Separations surface and one evidenced operator XLSX; artifact bytes/screenshots remain | 38–44 · 2026-08-08 → 09, 38 · 2026-08-08, 72 · 2026-08-19, DCR · 2026-08-28 |
| diagnostic auto-purge · unreferenced artifact bytes | **D137** (retention purges the row and its index, never the shared content-addressed bytes) with **D193(b)**'s `wont-build-unless-asked` stance | 32 · 2026-08-04 and 47 · 2026-08-12 |
| controlled desktop updates | **D297** — v1 is a signed manual in-place upgrade; the later channel waits for cross-platform upgrade proof plus one fail-loud quiescence/ordered-shutdown authority | 109 · 2026-09-01 |

**What ratifying anything here would look like**, so the next agent recognizes it: a decision that
closes a deferral lands in the OWNING reference doc in the same commit that records it (`ref
frontend-backend-integration` §6.9 for the byte path, `ref operator-trust` §5.3/§5.5 for the
explorer, `ref clock-config-secrets` §3 for settings, `ref write-safety` §4.2 for a propagation
window, `ref operator-trust` §2.2 for retention), `reference/decisions.md` gets the round row with a
`_phase: 4_` marker, and this table gains the closing decision beside the creating one.

## Exit criteria

**There is no exit block to inherit, and that is structural rather than an omission.** A phase with
a start and an end has exit criteria; the deferred shelf is a set of standing answers, and each one ends when
its own trigger fires. What binds instead is the line below: **every deferral is either closed by a
build, or carried past the cutover with its trigger still standing and named.** Neither state is a
waiver. What is forbidden is a third state — a deferral nobody can find the trigger for.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | **Every deferral names a trigger or a decided stance** | **MET** | nine nodes: the controlled updater adds the cross-platform manual-upgrade + quiescence proof trigger (D297); the existing triggers, D193 stance and retirements remain |
| 2 | **No deferral is silently dropped** | **MET** | each has a node in `{#deferred}`, a section here, and a decision in the ledger that created it |
| 3 | **The record-sanity-check advisory is dispositioned** | **MET** | RETIRED by the operator 2026-08-18 (D192); `config/legacy-capabilities.json` carries `kind: "retired"` and `AdvisorySurfaceIdSchema` stays closed at two values |
| 4 | **The storage remainders are dispositioned** | **MET** | D193(b): scheduling the sweep and the content-store refcount are `wont-build-unless-asked`, off every milestone |
| 5 | **The capture → run binding** | **open** | trigger unfired — order 3 declares the first `CaptureIntakeBinding`; `CAPTURE_INTAKE_BINDINGS` is `{}` at HEAD |
| 6 | **The production byte path serves the built local dashboard** | **open** | standalone D189/D294 task: parse `--prod` and safely serve `dist/dashboard` |
| 7 | **The explorer's EDIT half + the authoring path** | **partly MET** | D283/DCC4–DCC5 complete the existing-workflow boundary: label/icon/category hot apply; timeline/grouping and notification unavailable without owners; policy/Edit Data strict source briefs. New-workflow authoring and broader design remain under D186's later-workflow boundary. |
| 8 | **Editable settings** | **partly MET** | DCC1–DCC3 close the resolver-owned atomic edit, readback, preflight rerun and doctor controls; credentials, AI assist, delete/recover and resolver-unowned legacy settings remain open |
| 9 | **Cross-date search · screenshots · Excel export** | **partly MET** | DCR3–DCR5 deliver current-corpus search, its Separations Top Bar surface and evidenced XLSX; artifact bytes/screenshots remain open, while the 2026-09-03 D289 amendment retired automatic rerun comparison |
| 10 | **Propagation windows, per system** | **partly MET** | Kuali measured and closed (D135), transferred provisionally to the separations finalization (D207); **UCPath open** (order 7, both contracts `operator-only`), **ServiceNow open** (no commit contract yet) |
| 11 | **The Phase 3a carry-in (D279) is closed or parked, line by line** | **open** | C1–C4 closed by DCF6; the former Capture Mode C5 is retired by D294. Neither is a cutover blocker. |
| 12 | **Controlled desktop update** | **open, deferred** | D297 fixes the policy and trigger; v1 ships manual in-place updates, then an in-app channel may be scheduled only after the older→newer preservation proof and one ordered quiescence authority exist |

**Nothing here blocks the cutover.** `05-cut-over.md` §Exit criteria names none of these nine, and
that is a deliberate reading rather than an accident of drafting: the cutover switches which
repository files real HR transactions, and every deferral above is a capability the LEGACY system
also lacks or that the operator has decided not to buy. The one to watch is criterion 10 — a
propagation window is not a convenience, and a workflow whose write reaches an unmeasured system
parks for a human on a post-fence absence. That is correct behaviour, not a blocker, but it is the
one row whose "open" has a runtime cost.

**Where each deferral's normative text lives**, because this doc is the index and not the contract:
`ref data-intake-and-edit-data` §5.1 (capture binding) · `ref frontend-backend-integration` §6.9 and
§8 (byte path, the guard arm) · `ref operator-trust` §5.3–§5.6 (explorer edit, authoring) ·
`ref operator-trust` §4.4.2 (the retired advisory) · `ref clock-config-secrets` §3 and
`ref frontend-backend-integration` §3.4 (settings) · `ref write-safety` §4 and §4.2 (propagation) ·
`ref frontend-backend-integration` §3.6 and `ref operator-trust` §2.2/§2.4 (search, screenshots,
export) · `ref operator-trust` §2.2 and `ref dashboard-surfaces` §2.1 (retention).
The desktop update policy and trigger live in `06-ship-the-desktop-app.md` §Packaging and this doc's
`{#def-desktop-update}` section (D297).
