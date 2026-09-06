# Phase 5A · Close cutover-readiness gaps

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

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
| C1 | ledger 2's 10 structural rows | `9993ab39^:docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` | closed — DCF1 (`c1507786`) row-by-row disposition |
| C2 | ledger 1's layout/control groups + C69's re-plan path | `9993ab39^:docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` | closed — DCF2/DCF3 (`f7c5ca65`, `a36f1510`) |
| C3 | ledger 3's AR39/AR59 and remaining non-copy marks | `9993ab39^:docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` | closed — DCF4 (`d474f526`) and named D275/D179/D223 dispositions |
| C4 | the `PanelHeader`-span heading finding (P1) | `9993ab39^:docs/plans/2026-08-26-p1-refreeze-attribution.md` | closed — 13 production `PanelHeader` headings at `h2` (`029eaba1`); kit specimens excluded |
| C5 | former Capture Mode findings (D278 and photo metadata/retake gaps) | `docs/rebuild/findings/capture.md` | **retired by D294**; no active implementation obligation |

- [Retired — phone photograph → OCR-run Capture Mode (D294)](retired-phone-photograph-ocr-run-capture-mode-d294.md)

- [Run the built dashboard without the dev server](run-the-built-dashboard-without-the-dev-server.md)

- [Edit a workflow's presentation / policy without a code change](edit-a-workflow-s-presentation-policy-without-a-code-change.md)

- [A record-sanity-check advisory panel](a-record-sanity-check-advisory-panel.md)

- [Edit settings in the dashboard](edit-settings-in-the-dashboard.md)

- [Trust UCPath / ServiceNow wait-before-negative-read windows](trust-ucpath-servicenow-wait-before-negative-read-windows.md)

- [Search runs across dates / view screenshots / export Excel](search-runs-across-dates-view-screenshots-export-excel.md)

- [Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes](auto-purge-diagnostics-on-a-measured-schedule-reclaim-unreferenced-artifact-bytes.md)

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
The desktop update policy and trigger live in [6E](../../phase-6/6E-signed-installers/README.md) and
[6A](../../phase-6/6A-controlled-desktop-updates/README.md), which owns `{#def-desktop-update}` (D297).
