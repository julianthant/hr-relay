# HR Rebuild Roadmap
<!-- `docs/roadmap/roadmap.md` is the plan as written, in the roadmap notation (see docs/roadmap/notation.md): everything between roadmap:start and roadmap:end renders at docs/roadmap/index.html via `npm run roadmap`; appendices after roadmap:end are prose. Per D263 (§Governance below) a node also carries `doc:` — the docs/rebuild sections owning its contracts — and a `log:` block, the append-only per-session journal the `## session:` spine markers summarise. -->
asOf: 2026-08-21
head: 59851cdf
eyebrow: hr-automation-rebuild · the plan · source: docs/roadmap/roadmap.md
source: Stems from the phase docs `docs/rebuild/00`–`06` (§Phases at a glance below, `03c`'s migration order, `00`'s size model)
source: `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` (Tracks 0/A/B/C)
source: `docs/plans/2026-08-20-dashboard-architecture-audit.md` (Track D) · the phase docs win on any disagreement
footer: Generated from `docs/roadmap/roadmap.md` (the plan, written in the roadmap notation) by `npm run roadmap` — edit the plan, never this file; plan, site and owning docs move together — notation: `docs/roadmap/notation.md`.
> The ground-up rebuild of UCSD's UCPath HR automation, as a tree. **Phases 0–2 are complete** — the platform is built and proven; **Phase 3** migrates the 13 remaining legacy workflows one at a time and entered at **separations**; legacy stays the sole production authority until one all-at-once cutover. Every box shows what it **builds** (by layer, filled when built) and what it **needs** — select one for detail, hover to light up what it unlocks.

tiles:
- Phases complete | 0 · 1 · 2 | runtime marker `completedThrough: 2j`
- Active | Phase 3 | per-workflow migration · entered at separations
- Workflows migrated | 2 of 15 | + separations at 8 of 9 exit criteria
- Decisions | D1–D266 | rounds 68–90 landed this wave · D131 retired, never reused
- Gates | 64 guards | 2,271 tests · parity 151/151 re-frozen 08-20 · schema v15
- !Critical-path blocker | Wait for 08-28 | canary **4537 named** — S7 admits its separation date then; the three commits run ② → ① → ③

<!-- roadmap:start -->

## Foundation design {#phase-0}
phase: Phase 0
status: done
when: 2026-07-31 | seeded from legacy @5879004
size: M
chip: complete
doc: 00 §Phase summary · 05 §Phase summary · ref:charter · ref:decisions
open: no

> Every reference spec reconciled through Round 12 (D1–D94); testing policy ratified; the all-at-once cutover (D89/D93) and the two-repo model ratified; the separations identity gate designed here, not at order 8 (D77).

builds:
- [x] DOCS the plan SSOT — fourteen reconciled design docs, each owning its contracts (the shelf is now `00`–`05` + `reference/`, D263)
- [x] DOCS the decision changelog `reference/decisions` as a pointer index
- [x] DOCS ALWAYS-GATE identity approval designed (ref write-safety §14)
- [x] DOCS size model + MUST / SHOULD / LATER delivery tiers (D76)
- [x] DOCS two-repo coexistence + one cutover (D88–D94)

log:
- 2026-08-21 | docs-cohesion 00 | doc 00 rewritten as-built; all three status blocks in this subtree filled. Phase 0 is DONE and every `[x]` here re-verified, but the rewrite adds two lists the phase doc had nowhere to put — **six Phase-0 contracts AMENDED** by a later decision (D150 retired legacy change accounting, D191 the gate family with D91's floors untouched, D247 and D216 the isolation names, D263 the plan's form, D193c the Phase-3 ENTRY with D84's order intact, D184 the D58 inventory guard) and **two Phase-0 promises never built** — D79's `scaffold new-task` / `scaffold new-workflow` generators (the new-workflow half owned by `def-explorer-edit`, the **new-task half UNOWNED and reported**) and D85's `cli test workflow --dry-run` + `TestTargetRegistry` (reassigned to `test-tiers` by R10)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

### ALWAYS-GATE identity approval {#phase0-always-gate}
status: done
date: D77 · ref write-safety §14
doc: 00 §ALWAYS-GATE identity approval · ref:write-safety §14 · ref:write-safety §14.1 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §4

> Manual approval on every separation, both types, no auto-approve-on-match — the control that defends against the `T002173685` wrong-person incident, pulled forward from order 8.

log:
- 2026-08-21 | docs-cohesion 00 | the design D77 wrote here is BUILT and live-proved (D202, separations chunk 3, first live gated run 2026-08-12) and four decisions have moved it since — D203 a gate row IS a dependency's evidence, D204 the receipt derives from it, D211 the packet carries the write plan so a date that moves re-opens the gate, D226 all three ceremonies exist. §14.7's two deferred values were ANSWERED at the separations questionnaire on 2026-08-12 (freshness 4 hours; the I-9 packet question out of scope) while `ref write-safety` §14.7 still reads as open — a finding for that doc's unit, not fixed here. Left: §14.4's manual-EID arm is built narrower than designed (no second live read in that chunk)

### Size model + delivery tiers {#phase0-size-model}
status: done
date: D76 · doc 00 §Size model + delivery tiers
doc: 00 §Size model + delivery tiers · ref:task-contract §2.7

> MUST (the spine) · SHOULD (Phase-2 tails) · LATER (explorer, advisories, catalog) — what may slip without invalidating the base.

log:
- 2026-08-21 | docs-cohesion 00 | D76's model is LIVE, not history — all 24 items it sized carry the same `size:` on their node today, unchanged and never re-estimated, and the five phase-level sizes agree with §Phases at a glance. All three tiers shipped whole (MUST in phases 1–2, SHOULD in 2g/2h, LATER all five in 2i BEFORE Phase 3), so the fallback shape the tiers define has never been exercised. D79's trims all held except its last sentence: the `scaffold` generators the lightweight tier was ratified with do not exist. Five nodes minted since D76 are sized in its unit and were never in its table — `dash-defaults` `duo-lease` `parallel-runs` `observed-logs` `test-tiers`

## The SPINE {#phase-1}
phase: Phase 1
status: done
when: 07-31 → 08-04 | five days
size: XL
chip: complete 2026-08-04
doc: 01 §Phase summary · 00 §The base's dependency graph · ref:operator-trust §0 · ref:frontend-backend-integration §0 · ref:write-safety §1 · ref:write-safety §7 · ref:clock-config-secrets §5
open: no

> The minimum base that carries one workflow end to end. **Exit (D74): person-lookup ran LIVE** against real UCPath + CRM on the new executor — run `4ebf7275` / trace `pl-000619-4ebf`, recovered a dead CRM session mid-run, terminal `done` at attempt 2, all four parity surfaces from the ONE projection.

needs:
- phase-0

log:
- 2026-08-21 | docs-cohesion 01 | doc 01 rewritten as-built and all six status blocks filled; every `[x]` in this subtree re-verified against the code and NONE had to be corrected — the phase is DONE and stayed done. What the rewrite adds is a residuals table: five findings that trace back to a spine contract and are owned in LATER nodes (`track-c`, `observed-logs`, Track D rows D6 and D11, `def-byte-path`, `test-tiers`) plus ONE with no owner — `requestedBy` is stamped on every command envelope and never checked, with no D-number and no `pending-wire-bindings` entry, reported rather than assigned
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §0
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

### 1a · 1b — guards, baselines, the strict domain leaf {#p1-base}
status: done
date: 2026-07-31
size: L
doc: 01 §1a · 1b — guards, baselines, the strict domain leaf · ref:guards-and-tests §2 · ref:guards-and-tests §1.1 · ref:clock-config-secrets §2 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6 · ref:task-contract §2.1.1 · ref:dashboard-surfaces §5 · ref:operator-trust §2 · ref:frontend-backend-integration §3

builds:
- [x] BE guard plumbing + the reviewed guard inventory
- [x] DOCS honest legacy baselines + the D58 capability inventory
- [x] BE strict domain leaf (zod at every boundary)
- [x] BE clock / config / secrets single-sourced (ref clock-config-secrets)
- [x] BE runtime isolation pinned (`.tracker-rebuild`, 3938/5174, locks)

log:
- 2026-08-21 | docs-cohesion 01 | verified at HEAD: nine executable ratchet arms, 75 inventory entries (65 active · 8 retired · 2 planned), the coverage floor still 60/80 at `vitest.config.ts:40-41`. Two of 1a's legacy-lane pieces are RETIRED with successors named (D93 the cross-tree guard family, D150 legacy-change-accounting), and two later decisions amended a 1b contract without re-opening it (D121 moved `paths` to a server-only module, D133 made a required config leaf a read-forward generation) · left: `cancel-mechanism` and `tracker-row-emission` are named in the ratchet port map and held by nothing, and R10's raise of the global floor to 80 has not landed
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §2
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

### 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG {#p1-authority}
status: done
date: 2026-08-01
size: XL
doc: 01 §1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.4 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §4 · ref:operator-trust §1 · ref:task-contract §2 · ref:task-contract §2.7 · ref:workflow-model §3 · ref:operator-trust §1.7 · ref:dashboard-surfaces §2 · ref:write-safety §2 · ref:clock-config-secrets §4 · ref:clock-config-secrets §6.2

builds:
- [x] BE authority SQLite + backup / doctor / degraded mode / restore interlock
- [x] BE the command family + proof union type shells
- [x] BE semantic UI registry (406 ported selector keys, provenance-pinned) + ucpath / crm / kuali drivers
- [x] BE task contracts (ref task-contract) and the three authoring tiers
- [x] BE workflow DAG, delegation, the completion program (ref workflow-model)
- [ ] BE the builder's `.auth()` override — neither `eager` nor `on-first-use` exists (ref workflow-model §3; needs `duo-lease`)
- [ ] BE `cli stop <workflow>` (ref workflow-model §1.2)
- [ ] FE the `Record<IconName, LucideIcon>` map — nothing renders `descriptor.icon` outside the Explorer wire (ref workflow-model §1.3)
- [ ] BOTH the layer-1 `config/workflow-presentation/` override (ref workflow-model §1.5)
- [ ] BE delete the unreachable `TransactionDryRunPreviewSchema` subject-mismatch arm (ref write-safety §2.1)

needs:
- p1-base

log:
- 2026-08-21 | docs-cohesion 01 | verified at HEAD: migrations pinned by literal digest v1→v15, four branded semantic ids at `src/domain/ids.ts:43-46`, the 21-node type proof present in `tests/types/`. Two corrections the code forced — 1c's OFFLINE restore path was complete, tested and UNREACHABLE from its first day because nothing recorded the runtime-lock snapshot its stopped-system proof derives from (D181, found in 2j, fixed there, recorded here because it is 1c's contract); and 1e's type proof survives while its 5 s / 1 GiB BUDGET does not, so the recorded 0.47 s / 215 MiB is history and not a gate. D144, D214 and D221 amended 1e's checkpoint identity without moving a stored byte · left: §3.2's three unimplemented declaration shapes, the Kuali audit call site, D71's unmeasured budget, D208 rule 1
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §1
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

### 1f — registry, workers, commands, the write sequencer {#p1-kernel}
status: done
date: 2026-08-02 → 03
size: XL
doc: 01 §1f — registry, workers, commands, the write sequencer · ref:workflow-model §1.3 · ref:workflow-model §2 · ref:workflow-model §4 · ref:dashboard-surfaces §2.4 · ref:execution-and-sessions §3 · ref:execution-and-sessions §4 · ref:execution-and-sessions §4.1 · ref:write-safety §3 · ref:operator-trust §2.1 · ref:frontend-backend-integration §3.4 · ref:write-safety §3.3

builds:
- [x] BE the ONE `WORKFLOW_MODULES` composition root
- [x] BE worker loop with claim / heartbeat / CAS, worker-owned browser sessions
- [x] BE start-plan ingress authority (D109), terminal authority (D110/D114), provider admission (D112)
- [x] BE the write sequencer: probe → prepare → binding proof → fence → commit → proof → atomic outbox
- [x] BE login proven by CONTENT, never URL (D120); Duo Autopilot hands-off

needs:
- p1-authority

log:
- 2026-08-21 | docs-cohesion 01 | verified at HEAD against `src/control/workflow-registry.ts` and `src/core/{command-kernel,run-executor,worker-loop,write-sequencer,write-recovery}.ts`; all five `[x]` stand. Folded in the two post-Phase-1 decisions that fixed the recovery half without re-opening the contract — D200 (the LEASE is the evidence: a sweep living inside a running worker cannot recover that worker) and a pointer to D218, which is 1g-spine's · left: `requestedBy` stamped and never checked (UNOWNED — no D-number, no `pending-wire-bindings` entry, reachable only with a second actor), the bulk `all-or-none` mode (D235), and `supersede-active`'s three sites giving two answers
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §2.1
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2.4 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

### 1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell {#p1-spine}
status: done
date: 2026-08-04
size: M
doc: 01 §1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.2 · ref:dashboard-surfaces §9.5.2 · ref:frontend-backend-integration §3 · ref:frontend-backend-integration §6.2 · ref:frontend-backend-integration §6.3 · ref:frontend-backend-integration §7.1 · ref:dashboard-surfaces §1 · ref:frontend-backend-integration §3 · ref:clock-config-secrets §3

builds:
- [x] BE span emission + the one run/queue projection
- [x] BOTH in-process Hono BFF: bootstrap / day / run-detail queries, one typed client, resumable SSE
- [x] FE the exact Person Lookup shell in the approved design system, both themes
- [x] PROOF the Playwright parity lane (a11y + screenshot, ASSERT mode)

needs:
- p1-kernel

log:
- 2026-08-21 | docs-cohesion 01 | all four `[x]` stand, and the parity line stands only BECAUSE of two later fixes recorded in doc 01: D132 (the lane asserted the `.png` and rewrote every `.a11y.yml` unconditionally, so a re-freeze was green by construction, and it served a bundle it never rebuilt) and D187 (every `paper-ink` reference photographed dark since the corpus existed, and the run-detail panel — where the failure record and the receipt live — two pixels wide at every viewport since this item, while the a11y tree reported every word). D218 corrected how the projection is FED: the in-process `onEvent` hook was a single-process assumption, so every run enqueued after the dashboard booted served an empty timeline · left: the notes stream has no emitter, five of six topics have no producer, `span.ended` carries no `verdict`, `src/dashboard/state/` has no cache half, the artifact schemas have no route — each owned in a later node
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §1 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

### Phase 1 exit — the live run {#p1-exit}
status: done
date: D74 · 2026-08-04
doc: 01 §Phase 1 exit — the live run · 01 §Exit criteria · ref:workflow-model §8 · ref:workflow-model §8.1

> Found three presentation defects no fixture could — skipped-arm (D123), terminal duration (D124), accessible-name collision (D126) — all fixed the same day. Open item it left: a dead CRM session cost **262.9 s** to surface → `sessionAcquireMs` (D125).

builds:
- [x] PROOF person-lookup live against real UCPath + CRM, dead-session recovery mid-run, all four parity surfaces from one projection

needs:
- p1-spine

log:
- 2026-08-21 | docs-cohesion 01 | the proof stands and its full record is doc 01 §Exit criteria — run `4ebf7275-0158-49af-a78f-1f37948efb27`, EID `10873698`, terminal `done` at attempt 2, `sleepMs` absent on every task span, projection counts agreeing across all four surfaces. The node's own residual became a decision: 262.9 s to surface a dead CRM session → D125's separate `sessionAcquireMs`. A later correction worth carrying — `describeStalledLanding` is unreachable at the shipped defaults (180 s Duo bound inside a 60 s acquisition envelope), which D244 answers by refusing on Duo's own content in 9.52 s · left: nothing on this node
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

## Transaction proof, then the deferred base tails {#phase-2}
phase: Phase 2
status: done
when: 08-04 → 08-09 | six days
size: XL
chip: complete 2026-08-09
doc: 02 §Phase summary · ref:write-safety §3.4
open: no

> **The controlled commit is MET live (D135):** one real Kuali write on doc `4489` — dry run zero durable rows · forced mismatch refused pre-fence · commit 16.45 s with reload read-back proof · idempotent re-run `already-present` in 2 ms · both docs restored. Then four tails landed against a proven spine.

needs:
- p1-exit

log:
- 2026-08-21 | docs-cohesion 02 | doc 02 rewritten as-built — the phase reads DONE-with-named-residuals: nine mechanisms with no production caller or delivery path, each attributed to the node that owns the fix, plus four test-lane gaps owned by `{#test-tiers}`; the 23 `_phase: 2_` rounds in `reference/decisions.md` all indexed


### Transaction proof — the first real write {#p2-proof}
status: done
date: D128–D135 · 2026-08-04
size: L
doc: 02 §Transaction proof — the first real write · ref:write-safety §2.1 · ref:write-safety §3 · ref:write-safety §3.1 · ref:write-safety §5 · ref:guards-and-tests §3.6 · ref:frontend-backend-integration §6.4 · ref:write-safety §3.3 · ref:write-safety §3.4 · ref:clock-config-secrets §4.1 · ref:charter §13

> Same-day withdrawal of the wrong D128 conclusion: the two real causes were driver defects in THIS tree (a ~700 ms gadget debounce, a `commit` returning at request time). Write-heavy migration unblocked.

builds:
- [x] BE `kuali/save-timekeeper-annotation` — the one-transaction-node proving workflow
- [x] PROOF fence durable before the click, reload read-back, propagation window measured (`recoveryAbsence: stabilized` — THIS contract only; both UCPath contracts stay `operator-only`, unmeasured)
- [x] BE mutation-capability registry; `write-sequencer.ts` the only mint
- [x] BOTH preview / binding / fenced write / read-back / parked-write resolution through the production client

needs:
- p1-exit

log:
- 2026-08-21 | docs-cohesion 02 | re-verified in the contract file: `recoveryAbsence: stabilized` is `minSinceFenceMs: 30_000` / 2 reads / 5 s apart and is scoped to THIS contract — both UCPath contracts stay `operator-only` because no UCPath window was ever measured, so the `builds:` line is corrected
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)


### 2g — event / trust layer {#p2-2g}
status: done
date: D134–D145
size: L
doc: 02 §2g — event / trust layer · ref:operator-trust §2 · ref:operator-trust §2.2 · ref:operator-trust §2.3 · ref:operator-trust §4 · ref:operator-trust §6 · ref:operator-trust §6.1 · ref:operator-trust §6.3 · ref:dashboard-surfaces §2.6 · ref:write-safety §6.1 · ref:frontend-backend-integration §6.5 · ref:write-safety §3.1

builds:
- [x] BE schema v10
- [x] BE automatic redacted diagnostic capture
- [x] BE durable actor-keyed notification inbox (row commits before any OS delivery) — 2 of the 7 trigger arms have publishers (D222/D262); five do not
- [x] BE knowledge / fix admission — admission is durable and audited; the PROJECTION has no caller, so no `KNOWLEDGE.md` exists
- [x] BE ordered fsync'd ledger projector — unit-proven and guarded; `createLedgerProjector` has NO production caller, so nothing drains the durable outbox to a file
- [x] BE D82's evidence receipt DERIVED from authority

needs:
- p2-proof

log:
- 2026-08-21 | docs-cohesion 02 | three `[x]` lines sharpened against the code — the ledger projector has no production caller, the knowledge PROJECTION has no caller, and five of seven notification arms have no publisher; `ref:operator-trust §2` and `§6.3` added, `ref:dashboard-surfaces §2.6` already cited and now carries its own status block
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (e6fb6f37) — §2 / §4 / §6 as-built, with the three unreachable halves named in place: `explain failure <fingerprint>` unbuilt, the knowledge projection uncalled, the retention sweep uncalled
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate


### 2h — data / intake foundation {#p2-2h}
status: done
date: D146–D167
size: XL
doc: 02 §2h — data / intake foundation · ref:data-intake-and-edit-data §1 · ref:data-intake-and-edit-data §2 · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §6 · ref:frontend-backend-integration §6.6

builds:
- [x] BE canonical field registry + column mapping
- [x] BE validation / rejection + immutable intake manifests + rerun diff
- [x] BE extraction / OCR / roster / normalization stores
- [x] BOTH OCR three-producer routes (live-proven on the real 44-page I-9 scan) + classify/group scanner
- [x] WIRE executor / worker provider + artifact wiring
- [x] BE durable capture sessions
- [x] BE Edit Data core
- [x] DOCS legacy change accounting RETIRED (D150)

needs:
- p2-proof

log:
- 2026-08-21 | docs-cohesion 02 | doc 02 §2h separates unwired-BY-DESIGN (the retention projection, D164) from unwired-by-omission (the saved-mapping store, an artifact-projection-declaring descriptor — both unowned and reported) and from waiting-on-a-declaring-workflow (the start-method kinds, the Review surface → `{#order-2}` / `{#order-3}`)
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)


### 2i — the operator surface (A–G) {#p2-2i}
status: done
date: D168–D180
size: L
doc: 02 §2i — the operator surface (A–G) · ref:operator-trust §1.3 · ref:data-intake-and-edit-data §2.7 · ref:data-intake-and-edit-data §5.1 · ref:data-intake-and-edit-data §5.2 · ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §9.7.1 · ref:dashboard-surfaces §9.7.2 · ref:dashboard-surfaces §9.5.3 · ref:operator-trust §5.7 · ref:operator-trust §5.8 · ref:data-intake-and-edit-data §6.4.1 · ref:charter §25

builds:
- [x] BOTH trust surfaces + notification bell over the durable inbox
- [x] BOTH Edit Data rail (D168)
- [x] BOTH Settings + storage doctor + live backup cadence (D169) — Settings is READ-ONLY; `apply-settings` is the kernel's one deferred arm
- [x] BOTH intake surface over schema v12 (D170–D173)
- [x] BOTH token-scoped phone capture: QR start, PDF bundler, intake handoff (D174/D175) — no production delivery path (D189) and no workflow declares a capture binding
- [x] BOTH read-only Workflow Explorer + UI catalog
- [x] BOTH AI advisories (redaction / strict-output / exhaustion / zero-authority pinned)
- [x] BOTH archive model (schema v13, UPDATE/DELETE aborted in SQL) + version bump + Activity report (D176–D180)

needs:
- p2-2g
- p2-2h

log:
- 2026-08-21 | docs-cohesion 02 | two `[x]` lines sharpened — Settings is READ-ONLY and the phone capture surface has no delivery path and no declared binding; `ref:operator-trust §1.3` and `ref:data-intake-and-edit-data §2.7 / §5.1 / §5.2` added; the Explorer's overlay and coverage-claims exclusions recorded as DECISIONS, distinct from D186's reassignment
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code (82c8550c) — §2.7 / §5.1 / §5.2 as-built; the phone surface has no production delivery path and `CAPTURE_INTAKE_BINDINGS` is empty, so no workflow can receive a handoff
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)


### 2j — the closing gate {#p2-2j}
status: done
date: D181–D190 · 2026-08-09
size: M
doc: 02 §2j — the closing gate · 03c §Non-workflow capability closure inventory (D58) · ref:execution-and-sessions §7.1 · ref:guards-and-tests §3.11 · ref:guards-and-tests §3.15 · ref:operator-trust §3 · ref:operator-trust §3.1 · ref:dashboard-surfaces §2.5

> **Found four real defects every earlier green gate missed:** `cli storage restore` could never have worked (D181); every `paper-ink` parity reference had been photographed dark; the run-detail trust panel was **2 px wide** since 1i-spine (D187); the receipt builder 500'd on a reachable path.

builds:
- [x] PROOF scenario corpus + `scenario-coverage` audit — the manifest's preflight fault set has no runner, so `preflight-coverage` stays `planned` (D188)
- [x] PROOF restore drill on a copy of the real authority DB (corrupt → doctor refuses 0.92 s → restore 0.99 s)
- [x] PROOF 3-worker soak, concurrency matrix, redaction scan
- [x] DOCS capability-inventory validation (D184/D188)
- [x] DOCS every owning doc to as-built

needs:
- p2-2i

log:
- 2026-08-21 | docs-cohesion 02 | the scenario-corpus line now records that the manifest's preflight fault set has no runner; `ref:operator-trust §3.1` added; doc 02 §2j writes out all four findings with their causes and the four checks 2j left open (preflight runner, component/parity lane, D91's branch half, D85 parts 2–3)
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2.5 rewritten as-built; status block filled (632ce168)
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code


### Left Phase 2 by explicit disposition {#phase2-dispositions}
status: never
doc: 02 §Left Phase 2 by explicit disposition · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

> Workflow Explorer EDIT half — D186, trigger: the *second* production workflow whose policy you want to change · BFF serves no frontend bytes / no `dashboard:prod` — D189, builds at the first phone-consuming migration (orders 3–4), confirmed 2026-08-12.

log:
- 2026-08-21 | docs-cohesion 02 | both dispositions written out in doc 02 with their triggers and their shelf owners — D186 → `{#def-explorer-edit}` (04 §Edit a workflow's presentation / policy without a code change), D189 → `{#def-byte-path}` (04 §Run the dashboard without the dev server / use the phone page in production); D79a's trim kept as the standing constraint on whatever the editor becomes
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code


## flag: 2026-08-12 | **D193 — scope and entry.** Solo, local, never hosted. Phase 3 enters at **separations (order 8)**, chosen to force the store task libraries into existence; the §3.3 ordering is NOT re-sequenced. Separations questionnaire fully answered → READY TO BUILD. `test:coverage` becomes the per-commit gate (D191).

## Per-workflow migration — separations first {#phase-3}
phase: Phase 3
status: active
when: 08-12 → today | nine days so far
size: XL
chip: active
doc: 03b §Phase summary · 03c §Phase summary · 03c §Recommended migration order (by risk / complexity / reuse)
open: yes

> One workflow at a time through the seven-step loop (doc 03c §Phase summary): questionnaire → author → guards → **live dry run** → **controlled commit** → rebuild-ready → close-out. The order of work inside the phase: **the dashboard defaults first** (the generic surfaces every workflow inherits), then each workflow as ONE migration node — its store chunks, its live proofs, its controlled commits, and its own **dashboard wiring** on top of the defaults. Separations went first and forced the defaults into existence; they are now a prerequisite every later migration reads.

needs:
- p2-2j

log:
- 2026-08-20 | docs-cohesion step 5.0 | every node in the tree now carries `doc:` — its phase-doc home section plus the reference specs that own its contracts (`81bf48dd`); `test-tiers` drawn as this phase's testing spine (R10) · left: step 4b's binding guard, then the per-doc rewrites
- 2026-08-20 | docs-cohesion 03b | doc 03b rewritten as-built, all fourteen status blocks filled and the whole separations subtree re-bound to its headings; the phase stands at separations **8 of 9**, step 5 open on a calendar date · left: the three controlled commits from 08-28, then rebuild-ready and close-out

### Dashboard defaults — the generic surfaces every workflow inherits {#dash-defaults}
status: active
chip: B+C done · D ratified (D264)
size: L
doc: 03a §Phase summary · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.8 · ref:dashboard-surfaces §1.2

> Built ONCE so a migration only wires it: the run modal, queue rows, run detail + timeline, gate ceremonies, notifications, archive, activity, explorer. Track B finished the surfaces with separations as the forcing function; Track C is proving the connection against a real run; Track D hardens the stack before cutover; **Track F is the fidelity bar above all three** — every region demo-exact or ruled, with 52 current numbered decision lines waiting on the operator. A workflow's own "Dashboard · wire" task sits under that workflow and reads this node as its prerequisite.

builds:
- [ ] BE the per-run stream topics — five of six declared TopicKeys have no producer, so run detail, logs, review, people and artifact updates arrive by re-read, not by patch (ref frontend-backend-integration §3.5)
- [ ] FE the Session Panel's six unbuilt controls — plan/spawn/pause/resume/refresh/reopen have kernel arms and no button; only Stop is composed
- [ ] BOTH the Review panel kind and the Group People page — both §5 matrix rows have no surface and both section arms are declared-unserved (D184)
- [ ] PROOF the parity corpus reaches Settings and the Session Panel — neither is routable from the lane's AppRoute; keyboard and reduced-motion exist in ONE theme
- [ ] BE producers for the five declared notification triggers that have none — run-failed · subject-mismatch · write-parked · repeating-failure · verified-done (audit C4)
- [ ] BE the `operation` run shape is minted by SOME enqueue path — today every path stamps `single`, so §9's group model (member well, rollup, containment) is presentation over fixtures (audit C2)
- [ ] PROOF T2 dashboard feature scenarios over the DEFAULT surfaces (R10)
- [ ] BE a backfill-gap notification trigger — the one record that says WE DO NOT KNOW what you missed; ref dashboard-surfaces §2.6's trigger union carries no gap arm, so the bell's pinned Refusal block has nothing to draw (fidelity-1 A46)
- [ ] BOTH member-outcome vocabulary on the member wire — the typed outcome word and the Outcome / Detail column-heading switch (fidelity-1 B83, B89)
- [ ] BE per-status member counts on `memberRollup` — the well's six-status tally and a group's `△ N` fold (fidelity-1 B56, B77)
- [ ] BOTH a declared `identifierProjection` so a member line can carry its EID column (fidelity-1 B75, B82)
- [ ] BOTH the row-variant naming layer — per-row doing / why / constraint sentences and the row-type word behind the ⓘ (fidelity-1 B43–B48, B51; Track F's vocabulary-surface question decides whether the catalog is a surface too)
- [ ] BE `facts[]` gains `arrowTo`, `warn` and `fullRow` so a fact chip can show direction, hazard and a full-width line (fidelity-1 B114–B116)
- [ ] BOTH the served roster / People section — `View full list`, the workflow-specific `View all signers` label and the whole drill-in triage table (fidelity-1 B97, B98, B130–B135; the queue half of the Group People page line above)
- [ ] BE the `records[]` extraction stream on the queue wire — the record well, `N of M read`, `N blocked`, per-record glyphs and the arriving line (fidelity-1 B100–B104)
- [ ] BE `reviewRunId` so a packet can chip `OCR Review · {status} ↗` (fidelity-1 B110)
- [ ] BE `extractedCount` so a row can chip `N people` (fidelity-1 B111)
- [ ] BE `groupNoun` so the member-preview line reads as a counted anchor (fidelity-1 B68)
- [ ] BE `StartPlanResponse.planned[]` grows the row's role, destination panel, containment, born-as status and note — the demo's whole `PlanRowCard` anatomy, and the same fields the applied banner's created-rows list reads (fidelity-1 C56, C65)
- [ ] BE `StartPlanResponse` grows the plan's headline, its `warnings[]` and the ratified `decisions[]` its shape obeys — the modal counts `planned.length` because there is nothing else to print (fidelity-1 C55, C58, C59)
- [ ] BOTH the descriptor start-capability projection — operator-variable sub-selections with their option lists, per-option unavailability reasons and visibility conditions; today the only declared sub-selection is a parser CONSTANT, which is locked by definition (fidelity-1 C50, C51)
- [ ] BOTH a human label on `SurfaceField`, so a locked sub-selection names the choice instead of printing the field identifier (`keepNonHdh`) at the operator (fidelity-1 C49)
- [ ] BOTH a declared run-flag list on the descriptor's start surface — each flag with its label and its note — beyond the single DERIVED `supportsDryRun` one hardcoded checkbox stands for (fidelity-1 C85, C86)
- [ ] BE `CommandResult`'s `applied` and `rejected` arms grow a served headline and detail sentence, the settlement clock and the requesting actor; every title on the result banner is client-authored today (fidelity-1 C64, C66, C70)
- [ ] BE the command `conflict` arm grows the contract pair — what the form was built against and what the server now serves — the fact the operator needs to know what moved (fidelity-1 C68)
- [ ] BE the resolved host per `(system, instance)` on `SystemInstancePrimitive`, so Destination names the machine the run is about to touch instead of reassuring the operator (fidelity-1 C91)

needs:
- p2-2i

log:
- 2026-08-20 | docs-cohesion step 5.0 | `duo-lease` · `parallel-runs` · `observed-logs` drawn under this node (R11/R12 and the operator's observed-logs ruling), each with its own section in doc 03a · left: 5.3a builds the lease, 5.3b the pool and the session view
- 2026-08-20 | docs-cohesion 03a | doc 03a written to the phase-doc contract — every surface verified against `src/dashboard/**` and `src/server/dashboard/**`, four of nine exit criteria MET; two honest gaps recorded rather than assumed built: the run-detail Review and People bodies have no producer (`availableSections` cannot return them) and belong to the OCR and group migrations
- 2026-08-20 | docs-cohesion frontend-backend-integration | ref frontend-backend-integration rewritten as-built; §5.1 split into seven wire squares (5.1.1 run modal … 5.1.7 intake/capture/Edit Data), each separately citable and tagged; §1.1 and §5 gained a Built column · left: the per-run stream topics, the Review and People panel kinds, six Session-Panel controls
- 2026-08-20 | docs-cohesion dashboard-surfaces audit | 109 sections classified (49 done · 32 needs-attention · 15 to-build · 8 superseded · 5 reference); C1–C4 booked as builds: lines; rewrite split into 5.1b/c/d
- 2026-08-21 | docs-cohesion 03a fidelity fold | Track F drawn under this node (the demo-fidelity bar; ~150 OPEN questions as you-lines) and the nineteen `unserved:` wire gaps ledger 1 named booked here as `builds:` lines (A46; B43–B48, B51, B56, B68, B75, B77, B82, B83, B89, B97, B98, B100–B104, B110, B111, B114–B116, B130–B135; C49–C51, C55, C56, C58, C59, C64–C66, C68, C70, C85, C86, C91) — the preflight/doctor pair (A39/A42) already sits on `{#def-settings}`; ledger 3's dash-defaults proposals are all subsumed by Track F's lines · left: the rulings, then the builds

#### Track B · dashboard completion {#track-b}
status: done
chip: B1–B8 all landed · 08-19 → 20
doc: 03a §Track B · dashboard completion · ref:frontend-backend-integration §3.2 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.3 · ref:write-safety §14.11 · ref:operator-trust §5.9 · ref:operator-trust §2.3.5 · ref:operator-trust §2.3.7

> Separations as the forcing function; the findings ledger swept to zero-or-decided — the definition of "frontend done".

builds:
- [x] BOTH B1 the three identity-approval ceremonies + rejection, against the SERVER's shape; gated parity fixture (D226)
- [x] BOTH B2 a settled gate's decision on the panel; a rehearsal never wears `verified-done` (D237/D238)
- [x] FE B3 the run modal's four rows — three were already in the bundle, one drawn as a read-only fact (D250/D251)
- [x] BOTH B4 queue rows: `QueueBaseFields` served + drawn, rename, the bulk strip + result vector, runs + archived runs (D230–D235)
- [x] BOTH B5 archive: frozen sections, five tabs, Export, ledger read-through (D223)
- [x] BOTH B6 explorer: field census, the declared `when` in words, descriptor prose (D227–D229)
- [x] WIRE B7 worker-card / session-footer batch; the rail names step, direction and bound; a CAS conflict is a refusal (D252/D253)
- [x] BE B8 findings ledger zero-or-decided; `span.patched` RETIRED; a span close binds to an OPEN entry (D254/D255)
- [ ] PROOF the per-archived-run storage delta, on the first real sweep (ref dashboard-surfaces §9.5.1)

log:
- 2026-08-20 | docs-cohesion 03a | all eight re-verified present in the tree for doc 03a's status block; the ledger's own README records five open records across two files and zero undecided ones, which is what makes "frontend done" checkable
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### Track C · connection proof {#track-c}
status: done
chip: done 08-20 — §9.22 + the five same-day fixes + the ONE re-freeze
doc: 03a §Track C · connection proof · ref:workflow-model §1.1 · ref:dashboard-surfaces §2.3 · ref:frontend-backend-integration §7.1

> One pass: the REAL dashboard drives a REAL composed separations dry run — plan → start → gate parks → approve through the B1 ceremony → resume → preview terminal → archive — every UI assertion paired against a direct authority-database check. Closes with the ONE deliberate parity re-freeze. Re-runs over the real commits as Track A's final evidence. Already found and fixed two projection defects on the real run (D258/D259).

builds:
- [x] PROOF `docs/migrations/separations.md` §9.22 — items 1–8 recorded
- [x] BE D258 a timeline event id carries its occurrence ordinal, read forward — the one pre-D214 run that was refusing every archive reads again
- [x] BOTH D259 a replayed step is its own timeline arm (`replayed`, with `replayedFrom`), never `pending`
- [x] PROOF every surface's assertion paired against a direct authority check over the ONE run (§9.22 items 1–8)
- [x] BOTH the five §9.22 defects fixed same-day — ticking served clock (D256), SSE-followed panel (D257), honest shape hazard, replayed arm (D259), archive unblocked (D258)
- [x] BOTH D261 the start door — `resolve-action` finds the action id from the document number; the modal takes ONE box; live run `sp-105225-1e0b` parked at the gate, zero writes
- [x] PROOF the deliberate parity re-freeze — 151/151 assert-green, every drift mapped to its decision

needs:
- track-b

log:
- 2026-08-20 | docs-cohesion 03a | evidence pinned in doc 03a — separations §9.22 items 1–8 plus §9.24's live `sp-105225-1e0b`, and the re-freeze commit's own numbers: 139 references, 151 assert-mode cases green (`81287bb1`)
- 2026-08-21 | docs-dash-surfaces 5.1c | §9.1–§9.4, §9.9, §9.10 written as-built (`bbdf59b3`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### Track D · dashboard hardening, pre-cutover budgets {#track-d}
status: planned
date: D264 · audit 2026-08-20
chip: ratified 2026-08-20 (D264) · D1–D5 planned · D6–D10 proposed
doc: 03a §Track D · dashboard hardening, pre-cutover budgets · ref:frontend-backend-integration §2 · ref:frontend-backend-integration §4 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §7.4 · ref:workflow-model §1.2

> From the 2026-08-20 architecture audit (`docs/plans/2026-08-20-dashboard-architecture-audit.md`). **Verdict: the stack and shape are right; nothing is swapped.** Eleven ordered moves, none a rewrite, sequenced after Track C and before the next workflow leans on the dashboard. **Ruled by D264:** the track sits here under the dashboard defaults; D1–D5 are planned; D6–D10 stay proposed behind one named trigger; and §3.5 is answered — the descriptor registry LEAVES the browser bundle as row D11, amending D251. D4 and D5 double as the FIRST measurement of ref frontend-backend-integration §7.4's performance budgets, whose recorded numbers become the non-regression gates for every later workflow.

builds:
- [ ] BE D1 one status/outcome derivation — exported `deriveRunStatus`, ONE `TASK_OUTCOME` vocabulary, ONE `panelKindOf`; the detail panel stops disagreeing with the queue row (closes C1/C2, part of M3)
- [x] BOTH D2 hygiene — the HTTP status is the error's KIND not its wording (`f39b2e95`), the phone-host gate is WIRED from `capture.ingress: "forwarded"` with a producer guard (`47eeb44e`), two dead hooks and ten dead exports gone (`69102aaf`), the TEST-instance hazard / `plural` / `shortHash` one each (`6d44bb1e`) (closes C3/C4/M7/M8; the D253-sentence half landed with D3, `1b13115f`)
- [x] FE D3 every command settlement folds through `settleCommandResult` — all NINE command-issuing surfaces fold; the guard's second arm requires any module calling `.executeCommand(` to import it (closes C5)
- [x] BOTH D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; MEASURED against the seeded 1,240-row / 108-member fixture and recorded as ref frontend-backend-integration §7.4's first D4 numbers — one SSE row patch `22.30 → 0.02 ms`, `dayWireSchemaParses 1 → 0` (closes P1)
- [x] BE D5 bound the read scans — the member preview slices ids before joining and a row reads its receipt once, the notes reader opens only its run's own `(workflow, date)` partitions, the archive freeze scans once per page walk; measured and recorded in ref frontend-backend-integration §7.4's AFTER table (closes P2/P3/P4)
- [?] FE D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate and `state/` becomes what ref frontend-backend-integration §2 says it is (closes M2)
- [?] FE D7 split `LoadedApp` along its own seams — `useDayRoute`/`useRunDetailState`/`useBulkSelection` into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx` (closes M1)
- [?] BOTH D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, and ONE `foldTaskExecutions(row)` for pipeline / timeline / archive (closes M3/M5/M6)
- [?] FE D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured (closes P5)
- [?] BOTH D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped (closes M4)
- [x] BOTH D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads (`summary`, `enqueue`, `surfaces.inputRun`) on `WorkflowStartWireSchema`, `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import, and `dashboard-wire-boundary` arm (15) refuses any dashboard entry whose closure reaches `src/workflows/**` or `src/control/**` (amends D251; ref frontend-backend-integration §4)
- [ ] BE the write ledger has NO production writer — `createLedgerProjector` is composed nowhere while `createLedgerReadThrough` is composed at two roots; `ledger/` has never been written (ref dashboard-surfaces §9.5.2 · ref write-safety §6.1)
- [ ] BE a production tick that leases and drains the ledger outbox (ref write-safety §6.1)
- [ ] BOTH ledger health as a storage notification per D222, not a banner (ref write-safety §6.1)
- [ ] BE `remove-queue-surface` / `tombstone-queue-surface` have no producer (`src/domain/dashboard/subscription.ts`)
- [ ] BE the stale `SpanPatched` comment in `src/domain/workflow/presentation.ts`
- [ ] BOTH `supersede-active` — kernel implements, planner checks only `reject-active`, the run modal says unimplemented (ref dashboard-surfaces §2.4)
- [ ] BE nothing reads a gate's `subscribes` — a children-terminal / external gate parks forever (`src/base/flow.ts` vs `run-executor.ts`)
- [ ] FE the intake Dropzone's accept list + size cap are client literals; `INTAKE_UPLOAD_MAX_BYTES` / `INTAKE_UPLOAD_MEDIA_TYPES` unimported (ref dashboard-surfaces §9.7.1)
- [ ] FE inspect and upload carry no spinning control (ref dashboard-surfaces §9.7.1)
- [ ] BE the captures wire section is served and placed nowhere; context-evidence fetched and handed to nothing (03a finding)

needs:
- track-c
- fact(met): operator ruling 2026-08-20 — D1–D5 planned, D6–D10 proposed, §3.5 → move (D264)

note: D6–D10 are the maintainability slice and carry ONE trigger — they start before the second migration's `Dashboard · wire` task does, and until then they stay proposed; once D1–D5 land they can be dispatched as independent worktree units.

log:
- 2026-08-20 | docs-cohesion step 4a | ratified by D264 — D1–D5 planned, D6–D10 proposed, D11 added (77a0be76)
- 2026-08-20 | docs-cohesion 03a | every one of the eleven rows re-verified UNLANDED at HEAD rather than carried on the audit's say-so, with the file:line of each finding recorded in doc 03a's Track D table (no exported `deriveRunStatus`, two `TASK_OUTCOME` vocabularies, two `panelKindOf` copies, `settleCommandResult` imported by two surfaces, zero `React.memo`, `WORKFLOW_DESCRIPTORS` at `dashboard-app.tsx:25`)
- 2026-08-20 | docs-cohesion frontend-backend-integration | all eleven rows tick in ONE place — ref frontend-backend-integration §7.4's status block, with a per-row map of where each lands; §7.4 records that NOTHING in src/ or tests/ measures any budget it names
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | track-d D2 | D2 DONE (`f39b2e95`, `47eeb44e`, `69102aaf`, `6d44bb1e`) — the BFF's status mapper stopped reading its own error MESSAGES (three declared kinds in `src/server/failures.ts`, every reachable producer converted, a plain `Error` wearing each retired phrase now a 500 rather than a 404); the phone-host gate is WIRED rather than deleted, because `capture.ingress: "forwarded"` is a producer an operator can set today and deleting the gate would put the scope check in the very slice that opens the door (`capture-durability-and-scope` §2b pins the producer). Two deliberate keeps against the audit's reading: `GET /api/v1/dashboard` (two tests drive it, one the only proof a composed BFF serves a day) and `INTAKE_UPLOAD_MEDIA_TYPES` (a named open wire task). ONE operator-visible change: the receipt's TEST banner no longer uppercases its system names
- 2026-08-21 | track-d5 | D5 DONE (`d6d6c758`, `c1fa129b`, `c74efcca`, `c547f65a`; bounds pinned `4d3247d8`) — all four read scans bounded and BEHAVIOUR-PRESERVING, verified byte-identical over the perf fixture's whole day wire, three neighbouring days, six run details, six logs pages and five archive freezes. Measured against the same seed: day wire 6,718 → 5,568 SQLite statements (the −1,150 decomposes exactly into 940 saved receipt reads + 210 saved preview joins), member-preview delta 216 → 6 and no longer scaling with the member count, logs scope 4 → 2 partitions. The logs row moves only 15 % in LINES because 78 % of this fixture's corpus is on the measured run's own day — what changed is that the read stopped growing with the corpus, which is the bound P3 names. The tests pin the BOUND, not a duration, and the notes reader is proved bounded by a tripwire (unparsable bytes planted in out-of-scope partitions)
- 2026-08-21 | track-d11 | D11 DONE (`149bc5f8` the wire block + server projection + a test driving `buildBootstrap` over the whole registry; `0911becd` the frontend drop + guard arm 15, proved to bite by re-adding the deleted import). The audit's "49 modules for three plain fields" undercounted the cost: the production bundle fell **1,114,214 → 753,197 bytes (32 %)**, `separations` string occurrences 259 → 7. `run-start.tsx` needed no edit — the composed `RunStartWorkflow` is identical field for field, so the whole frontend delta is one deleted import and one read site, and the modal's `?? "reject-active"` default retired with it (it stood in for a fact the server always had). ref frontend-backend-integration §4's ONE named divergence is closed and its §7.4 exit-criterion 2 is MET
- 2026-08-21 | track-d4 | D4 DONE (`345475bf` splice + tests, `bb406615` memo + stable props + guard) — a single-row SSE patch no longer re-validates the whole day: `22.30 → 0.02 ms` median and `dayWireSchemaParses` 1 → 0 over three runs against the same seed, with rows 1/3/4/5 held as an unchanged control so the delta is the change and not the loaded machine. Dropping the parse also gives every untouched row back its REFERENCE, which is the only reason `memo` on `LogPanel` can skip a 2,000-line subtree during a bulk run — the two halves are one change. New guard `dashboard-memo-prop-stability` refuses the five provably-fresh prop shapes, because a `memo` beaten by one fresh prop re-renders as often as before with every gate green. Honest bound recorded in §7.4: the D256 live clock is a prop of all three panels and ticks 1 Hz, so `memo` buys the re-renders BETWEEN ticks; the browser render count is deliberately not taken on a contended laptop and belongs to D9
- 2026-08-21 | track-d3 | D3 DONE (`1b13115f`) — the seven hand-enumerating sites fold; the fold carries the server's own per-arm facts (`message`/`code`/`currentVersion`) beside the composed sentence, so a surface drawing a refusal in its own components stops taking the union apart, and ZERO operator-visible text moved (the parity corpus photographs identity-approve's conflict alert). The guard gains a second arm + fixture (`5c36a82d`): posting through `executeCommand` without importing the fold is now a failure, which the first arm could not see

#### Track F · demo fidelity — every detail, region by region {#track-f}
status: you
date: fidelity re-audit 2026-08-21
size: L
chip: 52 decision lines — needs you
doc: 03a §Demo fidelity — every detail, region by region

> The dashboard is a 1:1 detail replica of the legacy rebuild-demo, reviewed glyph by glyph: every element is exact, or a divergence ruled by a D-number / a plan decision / a dated operator call, or unserved by a NAMED producer (a `builds:` line, never a reason to drop the detail), or OPEN for the operator — nothing is dismissed or "modified" without a citation. Three ledgers audited 1,956 elements/rows at HEAD on 2026-08-21 (`docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` 489 · `…-2-run-detail.md` 348 · `…-3-standing-surfaces.md` 1,119); a mechanical recount after the current ports, Activity AC24 and Explorer EX5 gives 774 exact rows. The consolidated phase list has 52 current numbered decision lines; ledger 3 has 238 OPEN row marks mapped to 30 unresolved numbered groups.

builds:
- [!] DOCS the operator rules the 37 shell / queue / run-start OPEN questions (ledger 1 §Roll-up)
- [!] DOCS the operator rules the 54 run-detail OPEN questions (ledger 2 §Roll-up)
- [!] DOCS the operator rules the 30 unresolved standing-surface decision groups, the twelve structural ones first — the virtualised archive · the bump's MAJOR/MINOR arms · a DS specimen page · the row-and-panel vocabulary surface · Settings as a takeover · the keyboard legend · intake stages 5–6 · the intake review gate · the archived-capture lightbox · the bump plan naming its runs · the operator capture half · the two Settings sections already served (238 OPEN row marks; ledger 3 §Roll-up)
- [x] FE the served-and-dropped facts — receipt/failure, intake, archive, the queue gate age, the run-modal descriptor version, Activity AC24 and Explorer EX5 are complete (doc 03a §Served-and-dropped)
- [ ] FE the structural run-detail ports — the failure-record disclosure + write-state block, the focusable timeline segment, the step-group Well, one-owner `dataExpanded`, the grouped log stream
- [ ] FE the vocabulary sweep — every word / glyph off the demo reverted or ruled (ledgers 1–3)
- [x] DOCS the stale claims in code and docs corrected (`receipt.tsx` header, `archive.tsx` comments, `findings/queue-rows.md:221`, `ref operator-trust` §5.7, `explorer.tsx:8-10`, `DESIGN.md`)
- [ ] BE the receipt's action evidence carries what proved the write (ledger 2 D16–D22)
- [ ] BE a diagnostic bundle is readable (ledger 2 E29)
- [ ] BOTH the intake manifest + rerun-diff surface (ledger 3 IN15/IN16)
- [ ] BOTH the operator half of phone capture (ledger 3 CP3–CP5)
- [ ] PROOF the parity corpus re-frozen once over every change, with the three missing scenes (Settings · the version-bump dialog · a DS specimen page)

needs:
- track-b
- you: rule the 52 current numbered decision lines in doc 03a's consolidated list — each becomes ported, or a recorded divergence with its argument

log:
- 2026-08-21 | docs-cohesion 03a fidelity fold | node drawn from the three 2026-08-21 ledgers; doc 03a §Demo fidelity carries the per-region table, every OPEN question as one line, the served-and-dropped list and the stale-claims table · left: the operator's rulings, then every FE / BE / BOTH / PROOF line above
- 2026-08-25 | track-f archive UI + Activity AC24 | `3d461962` served frozen list warnings/rehearsal state; `d1f87916` drew those and the already-served archive identity, priority, bump-kind, relaunch and enum facts through total folds; `4da19fd7` closes Activity's raw `blocked` caveat with the shared wire→display status fold. Ledger 3 remains 346/1,119 exact with 248 OPEN marks. Before/after screenshots were taken without `PARITY_UPDATE` · left in this unit: Explorer EX5 and every other non-archive served-and-dropped fact
- 2026-08-25 | track-f Explorer EX5 | `4e09fb49` restores the demo's ghost `Version registry` action with its `Eye` icon; it clears the Explorer takeover and opens Archive's actual `Versions & bumps` view through `?archive=&archiveView=versions`. The browser test proves the exact search state, direct deep-link and Back/Forward restoration against the pressed view and real `Workflow version registry` table; no parity reference was re-frozen. A mechanical recount of ledger 3's current rows gives 353/1,119 exact with 238 OPEN marks · left: every non-archive served-and-dropped fact

#### Duo ceremony lease — one login at a time per credential {#duo-lease}
status: planned
date: R12 · 2026-08-20
size: S
doc: 03a §Duo ceremony lease — one login at a time per credential · ref:execution-and-sessions §4.1 · ref:execution-and-sessions §4.2 · ref:execution-and-sessions §10

> A durable per-credential lease in authority serializes EVERY Duo ceremony — from "navigate to SSO" until the content verifier proves the session — across every worker and every system. TTL is `sessionAcquireMs` + grace; waiters are bounded and refuse loud naming the holder; a refused assertion poison-closes and retries ONCE under the same lease on a FRESH profile, then fails naming the profile; `defineVerifiedLoginRecipe` takes a lease token only the lease store mints, pinned by a guard with a violating fixture. The hazard exists TODAY — two workflows' workers cold-starting together share one credential's server-side counter (D243).

builds:
- [ ] BE `duo_ceremony_leases` in authority + the lease token `defineVerifiedLoginRecipe` requires + the grace config leaf `timeouts.duoCeremonyLeaseGraceMs` (a D133 snapshot-generation change)
- [ ] BE bounded waiters + the fresh-profile-once recovery, both failing by name
- [ ] BE the guard: no login path without the lease, with a violating fixture
- [x] PROOF two workers' cold starts serialize — unit (`1c244a40`) + the LIVE two-worker cold start (2026-08-21) + the ref execution-and-sessions §7.1 concurrency-matrix row
- [ ] DOCS the decision in `reference/execution-and-sessions` + `reference/decisions`

needs:
- track-d

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Duo ceremony lease written; verified UNBUILT at HEAD — nothing named `duo_ceremony_leases` exists in `src/` and `defineVerifiedLoginRecipe` (`src/infra/browser/authenticated-application.ts:159`) takes system + verify + flow and no lease token; `doc:` tightened to ref execution-and-sessions §4.1 and §4.2
- 2026-08-21 | docs-cohesion execution-and-sessions | §10 (the lease) and §11 (sessions) are the owning contracts (`fed795e1`)
- 2026-08-21 | duo-lease E2 | PROOF closed live: two cold workers (`live-a` / `live-b`) on ONE credential serialized their Duo ceremonies — generation 3 released 20:49:58.033Z, generation 4 acquired 20:49:58.261Z, both `logged-in`, zero waiter refusals; ref execution-and-sessions §10 §Live proof is the record. The four BE / DOCS lines above landed in E1 (`bfc7d318` · `cb7f17f8` · `37e747f0` · `1c244a40`) and are ticked in doc 03a and ref execution-and-sessions §10; ticking them HERE and moving this node's `status:` is the plan owner's pass

#### Parallel runs — sessions and the worker pool {#parallel-runs}
status: active
date: R11 · 2026-08-20
size: L
doc: 03a §Parallel runs — sessions and the worker pool · ref:execution-and-sessions §1 · ref:execution-and-sessions §3 · ref:execution-and-sessions §7.1 · ref:execution-and-sessions §11

> A SESSION is a dashboard-started group of N runs. Every workflow follows the same browser-profile recipe and every worker owns its own profile INSTANCE (doc 05's `(worker, system, instance, configFingerprint)` partition); N workers per workflow, spawned and stopped from the dashboard. Sessions never share information and workers never message each other — they know what the others are doing through AUTHORITY only: run claims, session leases, write fences, the concurrency matrix. The dashboard shows the session and what each of its workers is doing.

builds:
- [ ] BE worker pool — N workers per workflow, spawned and stopped from the dashboard (the kernel command arms exist and are validated; `createDashboardWorkerSupervisor` refuses spawn BY NAME today)
- [x] BE the projection serves a worker-POOL version — `worker_pools` (schema v17) is the CAS basis `spawn-worker`/`plan-worker-count` cite (`expectedVersion` = the pool row's version, 0 for an unplanned workflow), refused by name when stale; the day wire serves `workerPools[]` (`93b7b18e` · `b4f30ea0` · `24b04dfa`, D269)
- [x] BE durable session record + grouping — `run_sessions` (insert-only, member-less) written by every fan-out before its first member; membership is the run row's `sessionId`; a retry inherits; the queue row serves `session` (`93b7b18e` · `57f2bb9c` · `24b04dfa`, D269)
- [ ] FE session view — worker cards show membership and what each worker is doing, from authority
- [ ] PROOF two separations dry-run scenarios in parallel, recorded
- [ ] BE pool-indexed worker ids — `phase1WorkerId(workflowId)` returns one id per workflow, so two composed workers collide on the authority worker lease (`src/core/worker-loop.ts`)

needs:
- track-d
- duo-lease

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Parallel runs written; one `builds:` line ADDED from reading the code — the pool version is a prerequisite of the spawn control, not a detail of it (`src/dashboard/surfaces/shell.tsx:1036` states the CAS reason the demo's `+` is absent); `doc:` tightened to ref execution-and-sessions §1, §3 and §7.1
- 2026-08-21 | docs-cohesion execution-and-sessions | §10 (the lease) and §11 (sessions) are the owning contracts (`fed795e1`)
- 2026-08-21 | parallel-runs P12 | the AUTHORITY half built (D269): schema v17 `worker_pools` + `run_sessions` + `tasks.session_id` (`93b7b18e`), the pool CAS in the kernel (`b4f30ea0`), the session written at every fan-out and inherited by retry (`57f2bb9c`), the wire's `workerPools[]` + row `session` (`24b04dfa`); left: the pool PROCESS (spawn + pool-indexed ids), the FE session view, the parallel PROOF

#### Observed logs — the log carries what the page said {#observed-logs}
status: active
date: operator 2026-08-20
size: M
doc: 03a §Observed logs — the log carries what the page said · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.1 · ref:operator-trust §2.3

> The log stream quotes the facts each task RECORDED — the provenance points: field, value, direction, observed-at, with the SYSTEM resolved through `dataOrigins` rather than carried on the point (D252/D106) — redacted by the declared evidence classification, and never a second scrape. Transaction roles preserve each call's observation instant; probe/prepare/verify stream synchronously, while commit flushes after callback settlement so instrumentation cannot interrupt fence→click. The log emission path and the log structure are rebuilt around recorded observations; the scope may widen when the operator reviews phase 3a.

builds:
- [ ] BE the notes stream gets a production emitter — `emitNote` is composed and never called; `.tracker-rebuild/notes/` does not exist, while the Logs section re-reads it per request and a failed run opens on it (audit C1)
- [x] BE provenance points captured at record time and redacted by declaration; commit delivery is deferred past callback settlement for fence→click safety (an unclassified leaf fails loud) — D270
- [x] BE transaction beats stream their observations (probe → stage → fence → click → read-back)
- [ ] FE the log panel renders observed rows per step, in the Context rail's vocabulary
- [ ] PROOF a separations dry run reads as a ledger of page facts
- [ ] BOTH a log line carries its own facts, not just a level — the demo's nine-kind icon vocabulary with its read/write direction hues, the per-line `SystemChip`, the read/write `Pill` chips, the attempt badge and the duration; the search predicate widens to match a pill's label and value (fidelity-2 B69–B75, B78)
- [ ] FE the `pause` line's own row tint, once a line carries its kind (fidelity-2 B71)
- [ ] BE the timeline hover card's `System` row and its key lines — the same provenance points this node emits, read one level up (fidelity-2 B52, B54)

needs:
- track-d

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Observed logs written; the emission is a real build, not a re-read — `finalizeRead` validates the recorded points and the executor stores only `provenance` plus the parsed output (`src/core/task-provenance.ts:264`, `src/core/run-executor.ts:1052`), and `DataPoint` carries `direction` natively but NO system, which the store's declaration owns (D252/D106)
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the demo's log-line anatomy booked here from ledger 2 (B52, B54, B69–B75, B78) — the line carries its own facts, which is what this node emits; the stream's GROUPING by step (B65) is a pure FE port today and sits on `{#track-f}` · left: all of it
- 2026-08-21 | D270 | the EMISSION half landed — a twelfth span arm `data.observed`, one event per `ctx.recordData` call, redacted per leaf through the receipt's own declared table, an undeclared leaf failing the recording task by name, and the queue projection ignoring the arm by name (`ef090ea4` `68954117` `4d074886` `aabd46f4`). The channel is the SPAN stream, so the notes-emitter row is untouched · left: the transaction beats, the FE rows, the proof
- 2026-08-25 | observed-logs L2 | transaction probe/prepare/commit/verify roles now own explicit spans and declared observations; `transaction.fenced` is a strict kernel arm, commit call-time batches flush fence-first after callback settlement to keep fallible emission out of fence→click, and dry-run reports only probe + prepare · left: the FE rows and proof

### Testing tiers — the suite organized by what a test needs {#test-tiers}
status: planned
date: R10 · 2026-08-20
size: L
doc: 03c §Testing tiers · ref:guards-and-tests §10

> The no-dry-run tests — unit, architecture guards, ONE honest structural fixture scenario per workflow, dashboard feature scenarios, parity — run per commit, per workflow update, and all of them on a dashboard update. Every test that must RUN a workflow is built on a LIVE dry run of it, declared as a scenario with checkpoints asserted over authority, subject-parameterized against a canary registry (sensitive values outside git, referenced by label; a missing subject reports `blocked`, never `failed`), with dashboard conditions attachable and the result recorded durably. The end-to-end tier is an agent-operated run of MANY dry-run scenarios in parallel. Coverage floor 80 %.

builds:
- [x] DOCS the spec — `reference/guards-and-tests` §10 rewritten: tiers, layout, naming, run policy, subject registry, durable results (R10, dc2901de)
- [ ] BE T1 layout — one structural fixture scenario per workflow + its dry-run scenario manifest (checkpoints + subject labels), the pretending scenarios rewritten
- [ ] BE T2 dashboard / non-run scenarios per feature, seeded from `tests/unit/dashboard`
- [ ] BE T3 dashboard conditions attachable to a dry-run scenario — the first: separations §9.22 as a file
- [ ] BE the subject registry (labels in config, values outside git) + the durable `dry_run_scenario_results` row + `cli dry-run-scenario`
- [ ] PROOF T4 the agent-operated parallel e2e runner + the first journey, recorded (driven by the `{#claude-operator}`'s MCP tools)
- [ ] BE coverage floor 80/80/80 global
- [ ] PROOF the `idempotency-key-hygiene` guard §8 listed and nobody built, with its inventory entry (ref write-safety §8)
- [ ] BE the FIRST T1 pair — `separations-kuali-finalization`, seeded from the dismantled `kuali-timekeeper-annotation` harness (D266; built inside `workflow-tree`)

needs:
- dash-defaults
- fact: a named canary subject per workflow the dry-run scenarios run against (03b's registry first)

log:
- 2026-08-20 | docs-cohesion ref guards-and-tests | §10 written as-built against vitest.config.ts, run-executor/write-sequencer, tests/scenario, tests/parity and separations §9.22 (dc2901de); §7's stub lane verified NEVER PORTED → history; measured 84.23/82.15/84.74/71.76 · left: 5.2b–5.2d
- 2026-08-20 | docs-cohesion 03c | doc 03c §Testing tiers filled against §10: the DOCS line ticks (dc2901de), the six code lines stay open. Confirmed NO workflow in the tree has a T1 pair yet — `tests/scenario/workflows/` does not exist, including for the migrated person-lookup
- 2026-08-21 | workflow-tree ruling | D266 — the first T1 pair is named: `separations-kuali-finalization`, seeded from the dismantled timekeeper harness; the `workflow-tree` code unit builds it

### Co-operate with Claude — a second actor on the one local BFF {#claude-operator}
status: planned
date: R15 · 2026-08-21
size: L
doc: 03d §Phase summary · ref:frontend-backend-integration §3.4 · ref:write-safety §14

> R15, the operator 2026-08-21. Claude Code, in the operator's own terminal and with NO api key — the terminal session IS the credential — becomes a SECOND ACTOR on the one local BFF: it reaches the same command protocol and the same read models over loopback through a local MCP server, and it monitors the whole dashboard through the SSE stream, the observed log and the notification inbox. Full parity — start runs, dry runs, retry/cancel, edit data, archive, settings, intake, explorer reads, notifications — with ONE exception, the **two-actor rule**: an identity gate or a controlled commit resolved by the `claude` actor is recorded `pending-confirmation`, has no effect, and lands only on a second approval by a DIFFERENT actor. What it INHERITS: the ONE command protocol and its CAS `expectedVersion`, so two operators racing get D253's named conflict rather than a silent overwrite; D181's `server` role lock, so there is ONE BFF even with the web dashboard AND the desktop app open, and each of them — Claude included — is a client of the one local port; the spine's unowned `requestedBy` residual, which becomes ENFORCEABLE the moment a second actor exists; ref write-safety §14's human control, which becomes the two-actor rule rather than being widened; and `{#observed-logs}`, which is what makes monitoring legible at all. R10's agent-operated T4 tier IS this capability. Nothing is built: `grep -rn mcp package.json src` matches nothing, and the BFF has no actor model beyond one literal.

needs:
- dash-defaults
- observed-logs

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### Actor identity and the two-actor rule {#claude-actor}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03d §Actor identity and the two-actor rule · ref:frontend-backend-integration §3.4 · ref:write-safety §14

> The actor stops being a literal and becomes a derived fact. A closed union of two ids, a server that DERIVES the acting actor from the caller's own credential instead of trusting a request body, and a per-family policy table: parity everywhere, two-actor on the four arms that authorize a real HR write. This is first because an MCP server built before it would stamp `local-operator` on everything Claude does, and ref operator-trust already says why that cannot be repaired later — an immutable ledger's old rows have no honest answer.

builds:
- [ ] BE a closed actor union — `local-operator` and `claude` — replacing the `z.literal` in `src/domain/ids.ts:136` and the config `actor` default
- [ ] BE `requestedBy` ENFORCED: the server derives the actor from the caller's credential, rejects a mismatched body and stamps the derived value (the spine's one unowned residual, doc 01)
- [ ] BE the per-family parity table — two-actor for `gate/resolve-gate`, `run/resolve-write-present`, `run/resolve-write-absent` and a `start-run` with `dryRun: false`; parity everywhere else
- [ ] BE a `pending-confirmation` resolution with NO effect until a DIFFERENT actor confirms it, re-binding the same evidence digest (a schema version; read-forward, since every existing row is a settled single-actor resolution)
- [ ] WIRE attribution rendered wherever an actor is already durable — gate `resolvedBy`, `plannedBy`/`appliedBy`/`archivedBy`, the D82 evidence receipt
- [ ] BE a guard: no command path stamps an actor the request did not authenticate, and no two-actor arm settles with one — with a violating fixture

needs:
- dash-defaults

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### The local MCP server {#claude-mcp}
status: planned
date: R15 · 2026-08-21
size: L
doc: 03d §The local MCP server · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.5 · ref:frontend-backend-integration §3.6

> A loopback MCP server that is a CLIENT of the BFF, never a second server and never a second wire — it reuses `src/dashboard/client/transport.ts` rather than re-implementing it. A write tool per command family, a read tool per read model, and a tail over the one stream. The local port is not the new thing: the listener already binds `127.0.0.1` and refuses anything else. What is missing is a client Claude Code can speak to.

builds:
- [ ] BE the loopback MCP server over `/api/v1/**`, started from the CLI and registered in a project-scoped `.mcp.json` so the capability travels with the checkout
- [ ] BE a write tool per command family — start plan + confirm, gate resolve, run retry/cancel/bump/rename, edit data, archive, settings, intake, notifications, capture, bulk
- [ ] BE a read tool per read model — bootstrap, the day wire, run detail and every lazy section, the evidence receipt, archive, explorer, the activity report, the storage doctor, the UI catalog
- [ ] BE a `tail` tool over the SSE stream — `Last-Event-ID` resume, `reset-required` reported rather than swallowed
- [ ] BE actor `claude`, and the CAS `expectedVersion` passed through from the read that produced it — never cached across turns
- [ ] BE both refusal arms surfaced verbatim (D253), only actions the served descriptors declare, and D226's ceremony obligations honoured by an agent surface too
- [ ] BE a refusal BY NAME when no BFF answers — the MCP server never starts one, because D181 admits exactly one `server` holder

needs:
- claude-actor

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### Monitoring — the stream, the inbox, the observed log {#claude-monitor}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03d §Monitoring — the stream, the inbox, the observed log · ref:operator-trust §6 · ref:frontend-backend-integration §3.5

> The stream is already cursor-resumable and the projector is already fed by a disk tail, so a second reader is nearly free. The hole is per-actor: the inbox is read for ONE hardcoded id and rides the day wire with no route of its own. And a log of step names teaches an agent nothing — `{#observed-logs}` is what turns monitoring into something worth handing to a second watcher.

builds:
- [ ] BE the notification inbox served PER ACTOR — `run-queue-projection.ts:1518` reads one hardcoded id today
- [ ] BE read / unread / snooze scoped to the acting actor's own rows — a notification is owned by an actor, not broadcast
- [ ] BE a durable per-actor stream cursor, so a terminal session that ended resumes instead of re-reading the day
- [ ] BE a "what changed since `<cursor>`" read that answers in one call
- [ ] WIRE the observed log as a read tool — `{#observed-logs}`' provenance points, redacted by the declared evidence classification
- [ ] PROOF a tail that reports its own degradation — `reset-required` and the health transitions surfaced, never a silent re-snapshot

needs:
- claude-mcp
- observed-logs

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### One BFF, two clients {#claude-clients}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03d §One BFF, two clients · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> "What happens if the user has both open" was answered by D181 before anyone asked it: the `server` role lock is taken before the authority database opens, so there is never more than one BFF on the machine. The web dashboard, the desktop app and Claude's MCP server are three clients of one port, one journal and one projection — which is what makes two actors safe rather than merely convenient.

builds:
- [ ] BE the role lock ELECTS the host; a second app attaches to the running BFF as a client and never starts a second one (doc 06's Electron half)
- [ ] FE every actor-bearing surface renders the actor rather than assuming it — gate `resolvedBy`, `archivedBy`, `plannedBy`, the receipt, the notification row
- [ ] BOTH a client roster the operator can see — who is attached right now and what each last did; live-only, and it says so rather than pretending to be durable
- [ ] WIRE the no-BFF refusal, named, from every client — and never naming npm inside a packaged app (doc 06)
- [ ] PROOF the conflict path as ORDINARY traffic — two clients on one run version, both refused by name with the server's `currentVersion`, neither reporting success

needs:
- claude-actor

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### Proof — a Claude-driven dry run, attributed end to end {#claude-proof}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03d §Proof — a Claude-driven dry run, attributed end to end · ref:guards-and-tests §10

> R10's T1 shape driven from a different client. Separations is the subject because it carries the ALWAYS-GATE and a transaction node, so the two-actor rule is exercised on the arm it was written for. One agent, one scenario — the parallel T4 tier comes later, after `{#parallel-runs}` and `{#duo-lease}`.

builds:
- [ ] PROOF a Claude Code session drives a separations dry run end to end through the MCP tools — start, watch, gate, settle — with no dashboard click
- [ ] PROOF every action attributed to `claude` in the command journal, the spans and the evidence receipt
- [ ] PROOF one identity gate proposed by claude and confirmed by the operator, plus the decline, the stale-digest re-open and the refused self-confirmation
- [ ] PROOF both apps open during the run, one BFF, one journal, proved from the lock files
- [ ] PROOF the result recorded durably the way every dry-run scenario is (R10), written as T4's first journey rather than as a transcript

needs:
- claude-mcp
- claude-monitor
- claude-clients

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

### Separations — order 8, the first migration {#order-8}
status: planned
size: XL
chip: 8 of 9 — the three commits wait for 08-28 (S7)
doc: 03b §Separations — order 8, the first migration · 03b §Exit criteria · 03c §Phase summary · 03c §Exit criteria · 03c §Recommended migration order (by risk / complexity / reuse) · ref:write-safety §12 · ref:write-safety §14.7

> write-heavy — UCPath termination + Kuali finalization. The wrong-person incident (`T002173685`); the deepest write-safety proof, entered first by your choice (D193). Built bottom-up: store tasks first, one small provable sub-workflow per system interaction, then composed — lego recomposition, never conditional branches inside one monolith (§3.1/§3.2 directives). What remains is the calendar: canary 4537 is named and mapped, and S7 admits it on 2026-08-28.

needs:
- dash-defaults
- track-a

log:
- 2026-08-20 | docs-cohesion 03b | the migration's own section rewritten as-built — the nineteen-node graph over four stores, the D260 → D261 start door, the ALWAYS-GATE, and the program's first canary registry (4537 the canary · 4502 the dry-run subject · 4495 future-dated; 4510 and 4524 both evaporated between passes) · left: the three commits, and the registry moving into `config/test-subjects.json` under cohesion 5.2c (`test-tiers` owns it)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 1 · new-kronos timecard read {#sep-1}
status: done
date: D196 · D205 live 08-13
doc: 03b §1 · new-kronos timecard read · ref:task-contract §2.8 · ref:task-contract §2.9

> Live proof took 17 attempts and ten defects — the last two (pinned-viewport scroll, header/cell column offset) unreachable by any fixture.

builds:
- [x] BE the `new-kronos` store: real driver, login recipe, published UI registry, 16 ported selectors live-re-verified
- [x] BE two page-visit read tasks; `separations-kronos-timecard` sub-workflow
- [x] BE virtualized-grid read terminated on coverage, not on the widget (D205)
- [x] PROOF live proof: run `sk-171645-4adf`, 64-day window, 67 days covered
- [?] BE a cold WFD profile's FIRST Employee Search can present a result row whose identity cell is still empty; the driver correctly refuses a row whose subject it cannot name, and whether that wants a bounded wait is the driver owner's call (separations §9.20 item 7 — recorded, not diagnosed)

needs:
- fact(met): §b questionnaire answered (2026-08-12)

log:
- 2026-08-20 | docs-cohesion 03b | verified against `src/stores/new-kronos/{driver,tasks,session.ts}` and separations §9.1/§9.2/§9.2a — nothing left for the migration itself · left: the cold-profile first-search observation, a driver-owner call rather than a separations one

#### 2 · Kuali separation-document read {#sep-2}
status: done
date: D197 · live 08-12
doc: 03b §2 · Kuali separation-document read · ref:task-contract §2.8 · ref:task-contract §2.10 · ref:operator-trust §2.3.3

> Five real runs `done`, three with `verified` receipts over real documents.

builds:
- [x] BE a READ family on the existing `kuali` driver (14 more selectors live-re-verified)
- [x] BE the `separations` pure mini-store
- [x] PROOF §4a termination-type map captured live: 16 options + blank sentinel, exact-match-only, no default arm
- [ ] PROOF S2's refusal arm — a non-separation Kuali document — has never been exercised against a real one; the operator's Action List has only ever held RRSS separation forms (separations §9.4)

log:
- 2026-08-20 | docs-cohesion 03b | verified against `src/stores/kuali/tasks/read-separation-document.ts`, `src/stores/separations/tasks/` and `src/domain/separations/termination-type.ts`; the two platform items this chunk surfaced (D199, D200) both landed · left: S2's refusal arm against a real non-separation document
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code

#### 3 · UCPath employment grid + the ALWAYS-GATE {#sep-3}
status: done
date: D201–D203 · live 08-12
doc: 03b §3 · UCPath employment grid + the ALWAYS-GATE · ref:task-contract §2.11 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §5.5 · ref:operator-trust §2.3.4

> The first live gated run: parked, a real approval through the real command endpoint, resumed — and it found that a gate's durable record is not a checkpoint (D203).

builds:
- [x] BE rich whole-grid UCPath read, classified by a pure fold (D201)
- [x] BE the identity-approval gate node, server-computed approval shape
- [x] BE gate results as dependency evidence (D203) and in the receipt (D204)
- [x] PROOF first live gated run — parked, real approval through the real command endpoint, resumed

log:
- 2026-08-20 | docs-cohesion 03b | verified against `src/stores/ucpath/tasks/read-job-summary.ts`, `src/domain/separations/identity-evidence.ts` and `tests/unit/architecture/identity-gate-before-commit.test.ts`; D213's settle-then-classify pair landed here too · nothing left
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 4 · UCPath termination WRITE {#sep-4}
status: done
date: D206 · prepare live 08-14
doc: 03b §4 · UCPath termination WRITE · ref:task-contract §2.12 · ref:write-safety §3 · ref:write-safety §5 · ref:write-safety §3.2

builds:
- [x] BE two fenced transactions: the pending sweep + the filing
- [x] PROOF Smart HR wizard prepare arm live-proven
- [x] PROOF a duplicate-filing defect caught by the first live read
- [ ] PROOF the two UCPath facts still carried as ported legacy knowledge — whether the confirmation dialog renders the `T…` inline, and the submit → searchable propagation window; `recoveryAbsence` stays `operator-only` until one is measured, because a guessed `minSinceFenceMs` is the banned unverified constant

needs:
- sep-3

log:
- 2026-08-20 | docs-cohesion 03b | verified against `src/stores/ucpath/tasks/` and separations §9.7–§9.9 — the PREPARE arm is live-proven and commit-freedom is proved from durable state (zero intents, zero checkpoints, five refusals for five) · left: the COMMIT arm (Track A ②, 08-28), `clear-pending`'s COMMITTED arm (no mapped witness — `operator-calls`), and the two unmeasured UCPath facts
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 5a/b/c · Kuali finalization WRITE {#sep-5}
status: done
date: D207 · D217 · prepare live on doc 4524
doc: 03b §5a/b/c · Kuali finalization WRITE · ref:write-safety §2.2 · ref:write-safety §3 · ref:write-safety §4.2

builds:
- [x] BE ONE transaction node behind the same gate
- [x] PROOF all twelve `submitDocumentV2` formKeys captured passively off Kuali's `ActionPage` query — ten at separations §9.12, D217's two dates at §9.16
- [x] BE the step-13 date write-backs folded into the one-pass staged set (D217)

needs:
- sep-2

log:
- 2026-08-20 | docs-cohesion 03b | verified against `src/stores/kuali/tasks/*separation-finalization.ts` and separations §9.10–§9.12/§9.15/§9.16; §4e's section-ownership caveat is DISCHARGED for all twelve fields across three documents, and `exactly-one-editable` proved on three open documents · left: the seven wire-payload shapes (RECORDED, not asserted) and D207's provisional `stabilized` window — both commit-only, tracked on `track-a`
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 6a · THE COMPOSITION {#sep-6a}
status: done
date: D211
doc: 03b §6a · THE COMPOSITION · ref:workflow-model §3 · ref:write-safety §14.10 · ref:write-safety §12

> An approval of a person is not an approval of a date — the packet's digest covers what the approval authorises.

builds:
- [x] BE nineteen nodes, one ALWAYS-GATE, three fenced transactions — eighteen composed at 6a, `resolve-action` added by D261 with no other edge, gate, key or `when` moved
- [x] BE the gate packet carries the dates, template and department the approval binds

needs:
- sep-1
- sep-4
- sep-5

log:
- 2026-08-20 | docs-cohesion 03b | node list, gate ancestry and the packet's write-plan block verified against `src/workflows/separations/descriptor.ts`; the "this graph composes no plan" arm is REQUIRED with a stated reason rather than optional · nothing left
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 6b · composed LIVE pass {#sep-6b}
status: done
date: D212–D215
doc: 03b §6b · composed LIVE pass · ref:workflow-model §5.7 · ref:task-contract §6.2 · ref:write-safety §3

builds:
- [x] PROOF whole read chain on two real subjects in 82 s, parked, approved, resumed — zero durable write rows
- [x] BE checkpoint key gains `claimGeneration` (D214, schema v14)
- [x] BE a dry run probes in the real order and REPORTS `already-present` (D215)

needs:
- sep-6a

log:
- 2026-08-20 | docs-cohesion 03b | D214 verified at `src/infra/sqlite/migrations.ts` (schema v14, nullable `claim_generation`, read forward so every historical `record_key` stays byte-identical); D215's probe-first preview arm verified in the sequencer · nothing left
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 6c · PREVIEW TERMINAL reached {#sep-6c}
status: done
date: doc 4502 · canary 4510 refused pre-gate
doc: 03b §6c · PREVIEW TERMINAL reached · ref:workflow-model §2.1 · ref:operator-trust §2.3 · ref:operator-trust §2.3.7

> Still zero write rows beyond 2026-08-04's proof.

builds:
- [x] PROOF a real `transaction.previewed` terminal with a `partial`/`unknown` receipt
- [x] PROOF the real run on 4510 refused `NO_ACTIVE_EMPLOYMENT` before the gate

needs:
- sep-6b

log:
- 2026-08-20 | docs-cohesion 03b | verified against separations §9.17 and `src/events/types.ts`'s restated union — the fourth defect reaching the preview terminal was D215's `not-observed` verdict never reaching the span WIRE leaf, fixed with its regression case (`e1ba81b`); the D58 capability sweep for separations came back three-for-three · nothing left
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### Track A · separations backend completion {#track-a}
status: planned
chip: canary 4537 named — S7 unblocks 08-28
doc: 03b §Track A · separations backend completion · 03b §Exit criteria · ref:write-safety §3 · ref:write-safety §4.2 · ref:write-safety §5 · 03c §Exit criteria · 03c §Non-workflow capability closure inventory (D58) · ref:operator-trust §3.2 · ref:operator-trust §4 · ref:operator-trust §4.1 · ref:operator-trust §4.3 · ref:write-safety §3.2

> Separations is at **8 of 9 exit criteria**. The canary is **doc 4537** (named 08-19, mapped live in §9.19: the first subject with an active terminable employment). S7 refuses to plan until its separation date, **2026-08-28** — then ② UCPath filing, ① the pending sweep on the row ② creates, ③ Kuali finalization.

builds:
- [ ] PROOF controlled commit ① pending sweep · ② UCPath termination · ③ Kuali finalization — each with fence + read-back evidence
- [ ] PROOF `probeToFenceMaxMs` per beat; D207's 30 s Kuali window on this write's own evidence; seven Kuali payload shapes observed live; the `would-prepare` preview arm live
- [x] PROOF the first live RETRY on the composed graph — six retries, two lineages, one `done` (§9.20)
- [x] BE browser-profile wedge root-caused (A7)
- [ ] DOCS close-out: regression scenarios, knowledge records, capability dispositions → separations **rebuild-ready**
- [ ] BE wire the knowledge projection into a composition root — no caller, no `KNOWLEDGE.md` has ever been written (ref operator-trust §4.5)
- [ ] BE call Kuali's own registry audits from `semantic-ui-registry` — three stores of four are audited (ref operator-trust §8)

needs:
- sep-6c
- you(met): name the §4f2 canary target(s) — doc 4537, 2026-08-19
- fact: S7 admits doc 4537 on 2026-08-28 (its separation date)

| # | Step | Status |
|---|---|---|
| ✓A1 | **Canary named: doc 4537** (08-19) — §9.19 mapped it live: one Active terminable employment, every finalization control resolving; 4524 and 4510 both gone. A subject is named by document number ONLY — a document number is not a person, and EIDs stay out of the repository (03b §The canary registry — every subject this migration has mapped) | done |
| A2–A4 | Controlled commits, in the order the facts force: ② UCPath filing → ① pending sweep (on the row ② creates) → ③ Kuali finalization | **08-28** (S7) |
| A5 | Obligations only the commits discharge (timings, propagation window, seven payload shapes, the preview arm live) | after A2–A4 |
| ✓A6 | Live RETRY on the composed graph — six retries, no collision, one reached `done` (§9.20) | done |
| ✓A7 | Root-cause the browser-profile wedge — **closed by D243/D244** | done |
| A8 | Close-out (doc 03c's loop, step 7) → separations **rebuild-ready** | after A2–A7 |

log:
- 2026-08-20 | docs-cohesion 03b | A6 verified against separations §9.20's seven-run lineage table and A7 against `duo-autopilot/src/sign-count.js` + `tests/unit/duo-sign-count.test.ts`; A1's row no longer carries an EID — 03b's canary registry names subjects by document number only · left: A2–A5 and A8, every one of them downstream of 08-28
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
#### Dashboard · wire separations {#sep-dash}
status: active
chip: 9 of 9 wired — every square filled (D262 closed the last)
doc: 03b §Dashboard · wire separations · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9 · ref:write-safety §14.11 · ref:operator-trust §6.3

> What the generic surfaces learned about separations, and the two separations-specific things no default covers (the ALWAYS-GATE's ceremonies, the three commit contracts' ledger lines). Built with Track B as the forcing function, so most squares are already filled; the empty ones are wires not yet run — not sloppy surfaces.

builds:
- [x] WIRE run modal — ONE typed box, the Kuali document number, from the descriptor's `surfaces.inputRun`; no `otherwise` arm, `timekeeperName` a declared constant, the action id resolved by the graph (D250/D251, D261)
- [x] WIRE queue row — subject title, class, rehearsal hue, linked-run chips, per-row actions, the bulk strip (D230–D235)
- [x] WIRE run detail — the descriptor's declared timeline CATEGORIES (D225), per-step durations, the data rail naming step · direction · bound (D252)
- [x] BOTH gate ceremony — the ALWAYS-GATE's three ceremonies + rejection, server-shaped (D226); the settled decision on the panel (D237)
- [x] WIRE archive — separations' three commit contracts are the first `LEDGER_PRESENTATION_DECLARATIONS` entries (D223)
- [x] WIRE explorer — field census, the declared `when` in words, the descriptor's prose (D227–D229)
- [x] WIRE activity — separations in the per-workflow cross-tab + the write-ledger block (D236)
- [x] WIRE notifications — a park at the ALWAYS-GATE publishes a needs-you row to the durable inbox, by re-derivation over authority; the bell links to the run (D262)
- [x] PROOF connection proof — every surface read against the real composed run, each UI assertion paired with authority (Track C, separations §9.22; five defects found and fixed same-day)
- [ ] PROOF T1 scenario tests for separations (structural fixture + dry-run scenario) and its T3 pair (R10)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03b | all nine squares re-verified in the code rather than on the tree's say-so — `descriptor.ts` (`inputRun` · `timeline` · `nodePurposes` · `subjectProjection` · `presentation` · `verdicts`), `src/domain/archive/ledger-resolution.ts:167`, `src/services/notifications/gate-park.ts` composed at `src/server/dashboard/compose.ts:497`, `src/dashboard/app/identity-ceremony.ts`; the run-modal line said "document number, subject" and D261 left ONE box, so it is corrected · left: the two PROOF lines, T1 and T2
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1c | §9.1–§9.4, §9.9, §9.10 written as-built (`bbdf59b3`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

### Platform fixes the live runs forced {#platform-fixes}
status: done
date: 2026-08-14 → 19
doc: 03b §Platform fixes the live runs forced · ref:workflow-model §1.2.1 · ref:workflow-model §4 · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.6 · ref:execution-and-sessions §4.2

builds:
- [x] BE D218 the projector tails the span stream FROM DISK, cross-process
- [x] BE D221 a retry is the ITEM's next attempt
- [x] BOTH D219/D220 workflow roles (composition / chunk-harness / proving)
- [x] BOTH D222 the backup hazard moved from the banner to the durable inbox
- [x] BE D243/D244 Duo's shared signature counter — the browser-profile wedge root-caused
- [x] BE D216 both repos name their browser-profile root `.auth`; the SESSION namespace is the distinct half (`config/runtime-isolation.json`)

log:
- 2026-08-20 | docs-cohesion 03b | all six verified present at the `file:line` doc 03b cites (`compose.ts:598`, `command-service.ts:159`, `authority-database.ts:3782`, `src/domain/workflow/module-role.ts`, `src/domain/notification-triggers.ts:92`, `duo-autopilot/src/sign-count.js`); D216 added — the doc's block enumerates six and the tree listed five · nothing left
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
### The workflow tree — folders are the rail and the timeline {#workflow-tree}
status: planned
date: D265 · ruled 2026-08-21
size: M
chip: next code unit
doc: 03b §The workflow tree — folders are the rail and the timeline · ref:workflow-model §1.2.2 · ref:dashboard-surfaces §9.3 · ref:dashboard-surfaces §9.9 · 03c §The seven-step migration playbook

> Your ruling: `src/workflows/` is organized down to the folder level — one top-level folder per workflow the RAIL lists, one sub-folder per TIMELINE step, test equipment under `proving/`. Separations becomes `separations/` with `kuali-extraction` · `identity-check` · `job-summary` · `kronos-timecard` · `ucpath-transaction` · `kuali-finalization` inside (D225's six categories, as folders); the five harnesses move INTO the step they prove; `kuali-timekeeper-annotation` is DISMANTLED into the testing framework as the Kuali finalization step's first T1 pair (D266) — there is no `proving/`. IDs, run identity and every surface's rendering are unchanged — the `workflow-layout` guard pins role ↔ path so the folder view and the dashboard view cannot disagree.

builds:
- [x] DOCS D265 ratified — the rule, the separations mapping and the `workflow-layout` guard's invariant written (`ref workflow-model` §1.2.2, 2026-08-21)
- [ ] BE `src/workflows/separations/` gains six step folders, each holding its node fragments; the composition's `timeline` is one category per folder
- [ ] BE the five harnesses move INTO the step they prove (`descriptor.ts` + `module.ts`, role `chunk-harness of separations, step <folder>`); ids unchanged; the write harnesses import `identity-check/`'s fragments instead of restating them
- [ ] BE `kuali-timekeeper-annotation` DISMANTLED (D266) — workflow, module, four `kuali/*-timekeeper-annotation` tasks + contracts + UI entries, its scenario + claims, the `proving` arm and the `Test equipment` group; parity refs re-frozen; the D188 successor in `guard-inventory.json` re-pointed
- [ ] BE the FIRST T1 pair — `tests/scenario/workflows/separations-kuali-finalization/{structural.scenario.test.ts, dry-run.scenario.ts}`, seeded from the timekeeper `kualiHarness` + its four real-sequencer scenarios (D266, `ref guards-and-tests` §10.3/§10.4)
- [ ] PROOF that dry-run manifest run live once against the finalization canary via `cli dry-run-scenario`, recorded (the first `dry_run_scenario_results` row)
- [ ] BE `module-role.ts`: `chunk-harness` gains `step`; the registry refuses a `step` that `of` does not declare
- [ ] BE the `workflow-layout` guard activated with its `guard-inventory.json` entry; `descriptor-coverage` and `workflow-editor-compile-integrity` derive a descriptor's path from its ROLE, not its id
- [ ] PROOF `npm run build:manifest` regenerated; the D191 gate green; rail, picker, Explorer and the separations timeline byte-identical (parity unchanged)

needs:
- sep-6a

log:
- 2026-08-21 | workflow-tree ruling | drawn from your ruling on the `src/workflows/` layout; D265 ratified in ref workflow-model §1.2.2 with pointers in ref dashboard-surfaces §9.3/§9.9, 03b, 03c and `docs/migrations/separations.md`; `workflow-layout` listed planned in `guard-inventory.json` · left: the whole code unit — nothing under `src/workflows/` has moved
- 2026-08-21 | workflow-tree ruling | D266 the same session — `proving/` withdrawn, `kuali-timekeeper-annotation` dismantled; its harness seeds the first T1 pair for `separations-kuali-finalization` (builds lines redrawn) · left: the code unit

### Smaller operator calls open {#operator-calls}
status: you
chip: needs you
doc: 03b §Smaller operator calls open · ref:dashboard-surfaces §9.10 · 03c §Non-workflow capability closure inventory (D58) · ref:guards-and-tests §3.11 · ref:operator-trust §10 · ref:write-safety §13

> ONE call is left, and it cannot be made before the day it lands on: whether to spend the narrow window right after ② files on **2026-08-28** to give `clear-pending`'s COMMITTED arm its only possible live witness, or to accept that arm as sequencer- and fixture-proved and say so in the close-out. Both are defensible; neither is a default. (Settled, recorded so nobody re-opens them: the gate-age pill and D192's re-disposition, both answered 2026-08-18; A6's first live retry delivered 2026-08-19; the Activity hours-saved tile DROPPED by D239; archive tabs and export closed by D223/D240; `span.patched` retired by D254.)

builds:
- [!] PROOF ①'s COMMITTED arm has no witness and no mapped subject can give it one — the only honest window is re-running ① immediately after ② files on 08-28, before an approver clears the row; otherwise the arm ships proved by the sequencer and its fixtures, and the close-out says so. **Your call on 08-28**
- [x] DOCS keep or retire `kuali-timekeeper-annotation` — ANSWERED 2026-08-21: RETIRE (D266), dismantled into the testing framework as the Kuali finalization step's T1 pair (`workflow-tree`)
- [x] FE the gate-age pill — ANSWERED 2026-08-18: the status pill carries NO age (*the word names the work, not the wait*); the age renders in the row's footer meta and in the log panel (`ref dashboard-surfaces` amended; `src/dashboard/surfaces/queue.tsx:281`)
- [x] DOCS D192's re-disposition of `legacy-tool-ops-sanity-check-record` — ANSWERED 2026-08-18: no AI feature; §14.2's server-computed `comparisons` array IS the sanity check, deterministically. The register entry is `retired` with the ruling's own words (`config/legacy-capabilities.json`)

log:
- 2026-08-20 | docs-cohesion 03b | three of the four calls this node was drawn for were already settled and the tree still listed them open — corrected against `ref dashboard-surfaces`, `src/dashboard/surfaces/queue.tsx:281` and `config/legacy-capabilities.json` (disposition `retired`, operator ruling 2026-08-18) · left: the ① witness call, which has a deadline it cannot be made before
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1c | §9.1–§9.4, §9.9, §9.10 written as-built (`bbdf59b3`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | workflow-tree ruling | a second call opened — keep or retire `kuali-timekeeper-annotation` (recommendation: keep, under `proving/`); doc 03b §Smaller operator calls open carries the reasoning
- 2026-08-21 | workflow-tree ruling | answered the same session: RETIRE (D266)

## session: 2026-08-20 | docs-cohesion steps 1–2 | the plan moved out of the repo root (0990ebc5) and now sits at docs/roadmap/roadmap.md; the notation grew doc: · log: · session: (ea7704e0); D263 + D264 ratified; Track D redrawn

## session: 2026-08-20 | docs-cohesion step 5.0 | doc: on every node; test-tiers · duo-lease · parallel-runs · observed-logs drawn (R10–R12)

## session: 2026-08-21 | docs-cohesion step 5 | every phase doc (00 01 02 03a 03b 03c 03d 04 05 06) and every reference doc rewritten as-built with status blocks; the tree bound both ways; R13–R15 drawn
## session: 2026-08-21 | docs-cohesion 03a fidelity fold | the three demo-fidelity ledgers folded into doc 03a and the tree — `track-f` drawn (status: you, ~150 OPEN questions), nineteen wire gaps on `dash-defaults`, the log-line anatomy on `observed-logs`, five lines on `def-settings`, three on `def-byte-path`, two on `def-search-export`

## session: 2026-08-21 | workflow-tree ruling | `workflow-tree` drawn — D265, the `src/workflows/` layout IS the rail and the timeline (one folder per rail workflow, one sub-folder per timeline step); D266 the same session — `kuali-timekeeper-annotation` dismantled into the testing framework as the first T1 pair (`separations-kuali-finalization`), `proving/` withdrawn, `operator-calls` answered

## today: 2026-08-21 · HEAD 59851cdf · D265 + D266 ratified — the workflow tree is the rail and the timeline, the crash-test dummy is dismantled into the first T1 pair; the `workflow-tree` code unit is next · 52 current Track F decision lines wait on you · separations 8 / 9 · the three commits wait for 08-28

## The remaining migrations {#migrations}
phase: Phase 3 · continued
status: planned
when: next | undated — order, not calendar
chip: 13 workflows · 9 order rows
doc: 03c §Phase summary · 03c §Recommended migration order (by risk / complexity / reuse) · 04 §Phase summary · ref:guards-and-tests §10 · ref:charter §Migration strategy
open: yes

> Doc 03c §Recommended migration order's risk-proof ordering, kept as-is after the separations entry (order 8 is the migration in flight, under Phase 3 above): reads populate the stores, the OCR service unblocks four consumers, write-heavy lands last. **No workflow after separations is named yet.** Each owes the 12-item §b questionnaire before building, a live dry run, (for writes) a controlled commit on a target you approve — and its own **Dashboard · wire** task on top of the defaults. **Store reality:** only ucpath, crm, kuali, new-kronos have real drivers today; onbase, servicenow, i9, old-kronos, sharepoint are 3-line session declarations with zero tasks.

needs:
- phase-3

note: **Legacy capability register:** 47 open · 20 replaced · 7 native · 4 retired — cutover requires zero open. Every entry advances to native / replaced / retired at its order's migration.

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c written as-built: the seven-step playbook, all nine order rows, the recounted closure inventory. Chip corrected 12 → 13 workflows (15 `legacy-workflow-*` entries minus separations and person-lookup); the register recount CONFIRMS 47/20/7/4 and every open entry names `phase-3-workflow-migration`. Registry reality re-verified — only person-lookup and the six separations descriptors are registered, so orders 1-7 and 9 have no descriptor at all
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)
### Order 0 · person-lookup {#order-0}
status: done
size: M
chip: live-proven (Phase 1)
doc: 03c §Order 0 · person-lookup · 03c §Recommended migration order (by risk / complexity / reuse) · ref:workflow-model §8 · ref:workflow-model §8.1 · ref:task-contract §9.1 · ref:task-contract §9.1.1

builds:
- [x] BOTH resolve a person by name / EID against real UCPath + CRM
- [ ] PROOF T1 scenario tests for person-lookup (structural fixture + dry-run scenario) and its T3 pair (R10)

log:
- 2026-08-20 | docs-cohesion 03c | verified as-built: `src/workflows/person-lookup/descriptor.ts` + `module.ts` registered at `src/control/workflow-registry.ts:39`, live-proven by D74. Its `legacy-workflow-person-lookup` capability entry stays OPEN correctly — legacy's crm-search/match/outcome are order 1. No T1 pair exists
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### Dashboard · wire person-lookup {#order-0-dash}
status: done
chip: the Phase 1 slice
doc: 03c §Dashboard · wire person-lookup · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §6.3

> The first wiring, done in 1i-spine and proven live by D74: the typed Start Run surface, the queue row, run detail + receipt, the Context rail — all four parity surfaces from one projection.

builds:
- [x] WIRE run modal — name / EID typed inputs, the start plan
- [x] WIRE queue row — the person-lookup row, status and timing (D123/D124/D126 fixes from the live run)
- [x] WIRE run detail — timeline, receipt, Context rail; the two-pixel panel found and fixed in 2j (D187)
- [x] WIRE archive · activity · explorer — person-lookup rows appear through the generic surfaces
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | verified: four squares, and four is right — person-lookup does not gate, raises no park notification and consumes no intake, so §5.1.4/§5.1.6/§5.1.7 have nothing to declare. Left: the T2 scenario

### Order 1 · person-lookup Search + Match · i9-lookup {#order-1}
status: planned
size: M
doc: 03c §Order 1 · person-lookup Search + Match · i9-lookup · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §9.10 · ref:task-contract §3.1

> read — HR-Tasks Search/Match; who signed I-9 §2. Two modes prove one descriptor can preserve distinct system surfaces.

builds:
- [ ] BOTH Search + Match modes on person-lookup (D15)
- [ ] BE the `i9` store: driver, login recipe, tasks (zero today)
- [ ] BOTH i9-lookup workflow + its queue/detail surfaces
- [ ] PROOF T1 scenario tests for person-lookup Search + Match · i9-lookup (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- phase-2
- you: §b questionnaire (12 answers) for each workflow

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 1 written: `src/stores/i9/` is a 7-line `declareDriver("i9", "unwired")` with `{}` tasks, and `person-lookup/descriptor.ts` carries no mode. The row's hazard is one descriptor with two modes (D15) plus the first login recipe written from scratch since 1d (D120)

#### Dashboard · wire Search + Match · i9-lookup {#order-1-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire Search + Match · i9-lookup · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about person-lookup's two modes and i9-lookup: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for person-lookup's two modes and i9-lookup (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | six squares, not seven — no gate and no intake; both workflows are reads with typed inputs

### Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports {#order-2}
status: planned
size: M
doc: 03c §Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports · 03c §Recommended migration order (by risk / complexity / reuse) · 04 §Phase summary · ref:task-contract §3.1 · ref:guards-and-tests §3.7 · ref:frontend-backend-integration §3.6

> read / download — iDocs PDFs; rosters; Time Detail PDFs. Single-system reads and downloads at low risk.

builds:
- [ ] BE the `sharepoint` and `old-kronos` stores (declaration-only today)
- [ ] BE crm document download on the existing crm driver
- [ ] BOTH downloads land as content-addressed artifacts; the artifact-bytes route
- [ ] PROOF T1 scenario tests for crm-doc-download · sharepoint-download · old-kronos-reports (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- phase-2
- you: §b questionnaire for each workflow

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 2 written: `sharepoint` and `old-kronos` are 12-line unwired declarations with zero tasks; `crm` has two read tasks and no download. This row also owns the artifact-bytes ROUTE, which does not exist (`legacy-route-files`) and which orders 3, 5 and 7 also need

#### Dashboard · wire the downloads {#order-2-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire the downloads · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §3.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about crm-doc-download · sharepoint-download · old-kronos-reports: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for crm-doc-download · sharepoint-download · old-kronos-reports (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH download viewer — the artifact-bytes route + a per-run downloads tile
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — the download viewer is this order's extra and it is a BUILD, not a wire: run detail's `captures` section is served by the BFF and placed by no panel

### Order 3 · the OCR pipeline workflow {#order-3}
status: planned
size: M
doc: 03c §Order 3 · the OCR pipeline workflow · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §5.1 · ref:frontend-backend-integration §6.9 · ref:dashboard-surfaces §9.7.2 · ref:data-intake-and-edit-data §4.3 · ref:data-intake-and-edit-data §4.8

> service — PDF → extraction → review → fan-out. No browser, no submit; the 2h service stores are already built.

builds:
- [ ] BE the OCR pipeline workflow over the 2h extraction / normalization / ocr / roster stores
- [ ] BE **D189's byte path**: BFF static handler + `capture.html` + ngrok launcher + the phone-origin guard arm; `--prod` starts meaning what it says
- [ ] WIRE capture → workflow binding (`CAPTURE_INTAKE_BINDINGS` filled for the first honest consumer)
- [ ] PROOF T1 scenario tests for the OCR pipeline workflow (structural fixture + dry-run scenario) and its T3 pair (R10)
- [ ] PROOF re-verify the roster SCORING against a real roster — the tiering ported verbatim, the scoring is new (ref data-intake-and-edit-data §7)

needs:
- p2-2h
- you: §b questionnaire

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 3 written: the four 2h service stores are REAL (`extraction` 2 tasks, `ocr` 1, `normalization` 1, `roster` 1) and the pipeline workflow is not. Three hazards recorded — D189's byte path as a HARD cutover blocker, `CAPTURE_INTAKE_BINDINGS` empty because no module declares one (`workflow-registry.ts:194`), and `RunShapeSchema`'s `operation` arm that nothing mints
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)

#### Dashboard · wire the OCR pipeline {#order-3-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire the OCR pipeline · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §5.1.7 · ref:data-intake-and-edit-data §4.3 · ref:dashboard-surfaces §9.10 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about the OCR pipeline workflow: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for the OCR pipeline workflow (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH OCR review UI — expanded page ↔ extracted-text pair, approve / reject / retry page, one atomic correction list
- [ ] WIRE review/approve commands + progressive record patches over the SSE stream
- [ ] BOTH the OCR Review panel body — `review` is declared in TAB_ORDER but `availableSections` can never return it (03a finding)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | the heaviest wire sub-task and mostly a BUILD; `review` is in TAB_ORDER and `sectionsCompatible` (`domain/dashboard/run-detail.ts:309`) means `availableSections` can never return it, so the tab is structurally unreachable today
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)

### Order 4 · oath-signature · emergency-contact {#order-4}
status: planned
size: L
doc: 03c §Order 4 · oath-signature · emergency-contact · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §4.3 · ref:write-safety §3 · ref:write-safety §14 · ref:workflow-model §3.2 · ref:write-safety §3.2

> OCR fan-out + light write — oath date rows; emergency-contact fill. Exercises the completion union (D11), approval gates (D5) and operation-member fan-out; the write is a bounded UCPath enter/fill.

builds:
- [ ] BOTH first operation fan-out + approval gates through the real review UI
- [ ] BE oath-signature and emergency-contact workflows
- [ ] PROOF the first non-separations controlled commits on UCPath enter/fill
- [ ] PROOF T1 scenario tests for oath-signature · emergency-contact (structural fixture + dry-run scenario) and its T3 pair (R10)
- [ ] DOCS the delegation / row-model vocabulary (ref dashboard-surfaces §9.10)

needs:
- order-3
- you: §b questionnaire; controlled-commit target approval

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 4 written: two independent firsts in one row — the first operation fan-out and the first non-separations controlled commit. The doc says not to collapse them: prove the fan-out with the write still dry, then prove the write on one member under ref write-safety §3.2's full contract
- 2026-08-21 | docs-dash-surfaces 5.1c | §9.1–§9.4, §9.9, §9.10 written as-built (`bbdf59b3`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### Dashboard · wire oath-signature · emergency-contact {#order-4-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire oath-signature · emergency-contact · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:write-safety §14.11 · ref:dashboard-surfaces §9.10 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about oath-signature and emergency-contact: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-signature and emergency-contact (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE Group People — paged members + rollup + containment over real operation members
- [ ] BOTH the group People panel body — declared, never servable (03a finding)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | nine squares — the standard seven minus intake, plus Group People and its unservable panel body; the gate square carries §14.11's server-computed shape

### Order 5 · i9-check {#order-5}
status: planned
size: L
doc: 03c §Order 5 · i9-check · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §7 · ref:execution-and-sessions §8 · ref:data-intake-and-edit-data §4.1 · ref:data-intake-and-edit-data §4.10 · ref:workflow-model §3.2

> UCPath read + durable roster projection — verify I-9 packet, the master retention workbook. Operation coordinator + member enqueue + display-only rows, no external submit.

builds:
- [ ] BE the operation coordinator at scale
- [ ] BE stable-keyed SQLite outbox + serialized workbook projector
- [ ] BE the first Excel export writer (the master I-9 retention workbook)
- [ ] PROOF T1 scenario tests for i9-check (structural fixture + dry-run scenario) and its T3 pair (R10)
- [ ] BE the artifact-projection path has no first consumer — no descriptor declares `artifactProjections:`, `RunArtifactProjector` is composed nowhere (ref dashboard-surfaces §3.2 · ref data-intake-and-edit-data §4.1)

needs:
- order-1
- order-4
- you: §b questionnaire

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 5 written: `src/infra/artifacts/xlsx-retention-sink.ts` already proves ref data-intake-and-edit-data §4.1's contract, D164 leaves it uncomposed, and its own header names THIS migration as the owner of the operator-facing column layout. A scale proof with no external submit
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion execution-and-sessions | §10 (the lease) and §11 (sessions) are the owning contracts (`fed795e1`)

#### Dashboard · wire i9-check {#order-5-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire i9-check · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:data-intake-and-edit-data §4.1 · ref:dashboard-surfaces §9.10 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about i9-check: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for i9-check (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE member rows with retention status; the workbook export control
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — six standard (no gate, no intake) plus retention status and the export control; it reuses order 4's Group People rather than rebuilding it

### Order 6 · work-study · kronos-pay-rule {#order-6}
status: planned
size: L
doc: 03c §Order 6 · work-study · kronos-pay-rule · 03c §Recommended migration order (by risk / complexity / reuse) · ref:write-safety §2.2 · ref:write-safety §5 · ref:task-contract §2.9 · ref:data-intake-and-edit-data §1 · ref:write-safety §3.2

> **first real writes** — PayPath pool/comp; UKG pay rules. Small, isolated workflow-specific production commits on the proven transaction kernel.

builds:
- [ ] BE work-study and kronos-pay-rule commit contracts
- [ ] PROOF the canonical-EID audit gate: replay real stored inputs through `Eid` `/^10\d{6}$/`, surface every rejection
- [ ] BE the new-kronos store gains its pay-rule write family
- [ ] PROOF T1 scenario tests for work-study · kronos-pay-rule (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- sep-1
- p2-proof
- you: §b questionnaire; controlled-commit target approval

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 6 written: `new-kronos` has a driver, a session provider and two READ tasks from separations chunk 1 (D196) and no write path. The canonical-EID gate is EVIDENCE — `EidSchema` is `/^10\d{6}$/` at `src/domain/ids.ts:184` and widening it is a wrong person who looks right
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### Dashboard · wire work-study · kronos-pay-rule {#order-6-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire work-study · kronos-pay-rule · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:data-intake-and-edit-data §2.8 · ref:dashboard-surfaces §9.7.1 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9 · ref:data-intake-and-edit-data §2.3

> What the generic surfaces must learn about work-study and kronos-pay-rule: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for work-study and kronos-pay-rule (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH intake grid constants entry + unbind arm (`effectiveDate`, D172/D173)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE the saved-mapping store — a writer and loader for the `ColumnMapping` `resolveSavedMapping` already resolves; today every upload is a fingerprint miss (ref data-intake-and-edit-data §2.3)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | eight squares — seven standard minus the gate, plus the intake grid's constants entry and unbind arm (D172/D173); the intake workspace itself is 2i-E3 and built
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)

### Order 7 · oath-upload · onbase {#order-7}
status: planned
size: L
doc: 03c §Order 7 · oath-upload · onbase · 03c §Recommended migration order (by risk / complexity / reuse) · 03c §Live probe status (the design assumptions still unproven) · ref:write-safety §2.2 · ref:write-safety §4.2 · ref:dashboard-surfaces §4.5 · ref:guards-and-tests §3.5 · ref:task-contract §9.2 · ref:write-safety §3.2

> write-heavy — ServiceNow ticket + PDF; OnBase document import. Prove ServiceNow `receipt`; resolve OnBase OQ2 (`upload-verify` vs `unverifiableByPage`); oath-upload ports the born-at-upload fence.

builds:
- [ ] BE the `servicenow` and `onbase` stores (declaration-only today)
- [ ] BE ServiceNow receipt probe; OnBase upload-verify
- [ ] BE oath-upload's born-at-upload fence
- [ ] PROOF rebuild-verified propagation windows for ServiceNow
- [ ] PROOF T1 scenario tests for oath-upload · onbase (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-6
- you: name a ServiceNow live-probe target
- you: name an OnBase probe target (none exists today)

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 7 written: `servicenow` and `onbase` are 12-line unwired declarations with zero tasks, and TWO of this row's blockers need the operator, not an agent. `unverifiableByPage` would change the WORKFLOW (the operator confirms every upload), not just the assertion
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### Dashboard · wire oath-upload · onbase {#order-7-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire oath-upload · onbase · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:operator-trust §2.3 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about oath-upload and onbase: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-upload and onbase (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] WIRE ServiceNow ticket receipt + OnBase upload-verify on the run-detail receipt
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — six standard plus the two new receipt arms; if OnBase lands on `unverifiableByPage` the receipt square grows an always-park presentation instead of a verify

### Order 9 · onboarding {#order-9}
status: planned
size: XL
doc: 03c §Order 9 · onboarding · 03c §Recommended migration order (by risk / complexity / reuse) · ref:workflow-model §3 · ref:data-intake-and-edit-data §4 · ref:write-safety §5 · ref:write-safety §14 · ref:write-safety §3.2

> write-heavy — the real hire transaction. The duplicate-person incident; last, highest-stakes, most reuse of everything below it.

builds:
- [ ] BE the hire probe with the no-EID key (`ProbeVerdict`-widened)
- [ ] BE roster ingest
- [ ] BE the onboarding composition over the ucpath / crm / kuali / kronos stores
- [ ] PROOF T1 scenario tests for onboarding (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-8
- order-5
- you: §b questionnaire; a hire canary you approve

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 9 written: `probeVerdictSchema` has four arms at `src/domain/write-safety-primitives.ts:50` and every permanent key in the tree is EID-derived — a hire CREATES the identity, so the widening is a real schema question, not a naming one. Its canary is the hardest target in the program
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### Dashboard · wire onboarding {#order-9-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire onboarding · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §5.1.7 · ref:data-intake-and-edit-data §4 · ref:write-safety §14.11 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.5.2 · ref:dashboard-surfaces §9.5.1 · ref:operator-trust §5.9

> What the generic surfaces must learn about onboarding: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for onboarding (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH roster ingest surface; the hire canary's ceremony
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)
- [ ] BE publish `run-failed` / `subject-mismatch` / `write-parked` — four of six trigger arms are unreachable (ref operator-trust §6.3)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | eight squares — the only sub-task that fills every square in the template, which makes it `{#dash-defaults}`'s own proof

### Cross-cutting Phase 3 capabilities (no single order) {#cross-cutting}
status: planned
doc: 03c §Cross-cutting Phase 3 capabilities (no single order) · 03c §Non-workflow capability closure inventory (D58) · ref:clock-config-secrets §3 · ref:clock-config-secrets §6.2 · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §8

> Where legacy is still ahead — the honest list, each shaped against a real run corpus rather than invented in planning.

builds:
- [ ] BOTH editable settings — the `apply-settings` command family (read-only today; D169/D184)
- [ ] BOTH cross-date search module
- [ ] BOTH screenshots gallery + the artifact-bytes route
- [ ] BE Excel export writers (3 in legacy)
- [ ] DOCS `test-login` / setup wizard equivalents, or their retirement with evidence
- [ ] BE `explain failure <fingerprint>` — the indexed column and `listByFingerprint` exist; the command does not (ref operator-trust §4.2)
- [ ] BE an OS delivery channel — `OsNotificationDelivery` has no production implementation, every publish settles `no-channel` (ref operator-trust §6.3)
- [ ] BE the enqueue-time instance / URL check — `resolveInstances` has only a test caller (ref clock-config-secrets §4)
- [ ] BE `requires: SecretName[]` on task contracts + the enqueue check; `validateBootSecrets` / `validateDescriptorSecrets` have no caller (ref clock-config-secrets §6)
- [ ] BE the preflight runners + the doctor service — one runner exists, `buildPreflightReport` is test-only (ref clock-config-secrets §6.2)
- [ ] DOCS a refreshed `.env.example` bound to the secrets registry (ref clock-config-secrets §6)

needs:
- phase-3

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Cross-cutting written against the code and the five capability reasons: `settings.tsx` is read-only while the command union already carries `apply-settings`; no `/api/search` (deliberate — two runs is not a corpus); no screenshots routes and no artifact-bytes route; three legacy Excel writers and zero here; no setup script. None of the five is started
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

## The X → Y traceback {#deferred}
phase: Deferred
status: planned
when: comes due | at a named trigger
chip: every deferral names its trigger
chip-tone: never
doc: 04 §Phase summary · 00 §Size model + delivery tiers · 03c §Live probe status (the design assumptions still unproven) · 05 §Risk register (top sequencing risks)
open: no

> "I want to do X; the plan said build Y; Y is deferred." None is silently dropped, none is "can't ever work"; two have a decided stance instead of a trigger (D193) — they simply do not get built unless you ask.

log:
- 2026-08-20 | docs-cohesion 04 | doc 04 rewritten as-built — eight deferrals, each with its trigger; the sanity check is RETIRED, not deferred, and `def-retention`'s title corrected (no 14/8/5 constant exists)

note: **Never, by design:** unverified silent fallbacks · selector `.or()` chains · per-daemon logs / bespoke polling hooks / secondary count caches · per-action mutation routes · generic retry on a parked write · DSL/codegen workflow authoring (D79a) · LAN/remote operator mode · hosting (D193) · legacy change accounting (D150).

### Photograph a paper form on your phone → it becomes an OCR-backed run {#def-capture-binding}
status: planned
doc: 04 §Photograph a paper form on your phone → it becomes an OCR-backed run · ref:data-intake-and-edit-data §5.1 · ref:dashboard-surfaces §9.7.2 · ref:charter §22

> `CAPTURE_INTAKE_BINDINGS` is deliberately empty — neither current workflow can honestly derive an employee id from a photograph. Comes due with the first OCR-consuming workflow; "close this first": the `run.queued` span from projector-enqueued runs.

builds:
- [ ] BE emit `run.queued` for a handoff-enqueued run — the finalize projector enqueues outside the command service (ref data-intake-and-edit-data §5.1)

needs:
- order-3

log:
- 2026-08-20 | docs-cohesion 04 | the seam, the phone pipeline and the restart drain are all composed in production; the binding is the whole absence (`CAPTURE_INTAKE_BINDINGS` is `{}`, `src/control/workflow-registry.ts:194`)
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

### Run the dashboard without the dev server / use the phone page in production {#def-byte-path}
status: planned
doc: 04 §Run the dashboard without the dev server / use the phone page in production · ref:frontend-backend-integration §6.9 · ref:frontend-backend-integration §8 · ref:dashboard-surfaces §9.7.2

> BFF static bytes + `capture.html` + the ngrok launcher + a guard arm that the file handler serves nothing outside the capture allow-list to a phone origin. D189 / D175; "production" here means LOCAL (D193).

builds:
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed serveStatic; every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — `package.json:12` passes the flag and `src/core/runtime-composition.ts:162` dispatches on `args[0]` alone, so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`
- [ ] BE `/capture.html` delivered, so 2i-F's token-scoped phone surface is reachable from a phone
- [ ] BE the on-demand ngrok tunnel launcher (D175)
- [ ] BE the guard arm — a phone-origin request may be served nothing outside the capture allow-list
- [ ] BE wire or delete the INERT capture-ingress host gate: `deps.capturePhoneHost` is declared and read (`src/server/dashboard/routes/api.ts:65,142`) and supplied by nothing, so the middleware compiles and can never fire (also Track D row D2)
- [ ] WIRE an operator-scoped capture-session read (list + one) and a poll or SSE — `CAPTURE_PHONE_ROUTES` is a closed phone-scoped union and the only operator route mints a session (fidelity-3 CP2, CP6–CP8, CP11, CP12, CP16, CP21; the surface half is `{#track-f}`'s operator-capture line)
- [ ] WIRE `unreadable` / `focusScore` on `CapturePhotoWireSchema`, plus a photo's filename, pixel dimensions and arrival instant, so the unreadable-page alert and the tile frame have something to read (fidelity-3 CP9, CP10, CP13–CP15)
- [ ] FE the phone's RETAKE — `PUT /api/v1/capture/phone/photos/:photoId` is already in `CAPTURE_PHONE_ROUTES` and `CapturePhoneClient` implements no `replacePhoto`, while the demo's own copy tells the operator to "Retake it on the phone" (fidelity-3 CP45)

needs:
- order-3

log:
- 2026-08-20 | docs-cohesion 04 | six build items re-verified unlanded at HEAD; two read as done and are not — `--prod` reaches nothing, and the Host gate has never evaluated a request
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the capture WIRE gaps booked from ledger 3 §7 — an operator-scoped session read, the photo facts, the phone's retake; the operator SURFACE itself (CP3–CP5, CP17, CP18, CP59) is `{#track-f}`'s BOTH line · left: all of it

### Edit a workflow's presentation / policy without a code change {#def-explorer-edit}
status: planned
doc: 04 §Edit a workflow's presentation / policy without a code change · ref:operator-trust §5.1 · ref:operator-trust §5.3 · ref:operator-trust §5.4 · ref:operator-trust §5.5 · ref:operator-trust §5.6

> The Workflow Explorer EDIT half. D186: an editor shaped by a sample of one workflow would be wrong.

needs:
- fact: a SECOND production workflow whose policy you want to change

log:
- 2026-08-20 | docs-cohesion 04 | the new-workflow authoring path (`ref operator-trust` §5.5) travels with this node by the operator's ruling; Phase A proves its own boundary — the wire has nowhere to send a mutation
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)

### A record-sanity-check advisory panel {#def-sanity-check}
status: never
chip: retired 2026-08-18 (D192)
doc: 04 §A record-sanity-check advisory panel · ref:operator-trust §4.4.2 · ref:guards-and-tests §3.11

> RETIRED by the operator 2026-08-18 — no AI feature. D192's deferral condition ("renders beside the order-8 ALWAYS-GATE") was met DETERMINISTICALLY by the §14.2 packet's server-computed comparisons; the deterministic comparison IS the sanity check. Its two siblings retired with it.

needs:
- fact(met): retired by the operator 2026-08-18 (D192; `config/legacy-capabilities.json` → `legacy-tool-ops-sanity-check-record`, `kind: retired`)

log:
- 2026-08-20 | docs-cohesion 04 | status corrected from `planned` — `ref operator-trust` §4.4.2 and `config/legacy-capabilities.json` have carried the 2026-08-18 retirement since it was ruled; `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code

### Edit settings in the dashboard {#def-settings}
status: planned
doc: 04 §Edit settings in the dashboard · ref:clock-config-secrets §3 · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §2.4

> The `apply-settings` command family — rebuild settings are read-only, "nothing here pretends to save" (D169/D184). Phase 3 milestone, no single trigger; listed under cross-cutting above.

builds:
- [ ] BE `apply-settings` stops answering `capability-unavailable` — the kernel's ONE `PHASE1_DEFERRED` arm; family, target and atomic N-leaf payload are already contracted
- [ ] BE the preflight/doctor service `buildBootstrap` composes none of — `FrontendBootstrapWireSchema#preflight` is declared-unserved (D184), so the stethoscope popover never mounts
- [ ] FE the Settings write path and the doctor-rerun command control
- [ ] BE `mergeSettings` must apply `override.browser` — today it silently drops it (ref clock-config-secrets §3)
- [ ] BE a settings-file reader beside the `apply-settings` writer — `settings.json` has no producer (ref clock-config-secrets §3)
- [ ] FE Settings → Help → Keyboard, or a global `?` — the top bar's keyboard glyph was deleted on the operator's instruction "we already have help in settings" and the destination was never built, so `ShortcutsPopover` (`top-bar.tsx:912`) has ZERO callers and `surfaces/shortcuts.tsx` is reachable from nowhere (fidelity-3 SE7, SE43, SE44; a Track F question)
- [ ] BE `settingsSections` lists the status sections whose data is already served — System hosts reads `systemInstances` off the bootstrap, Workflow capabilities is descriptor-derived; neither needs new authority (fidelity-3 SE40–SE42; a Track F question)
- [ ] FE the storage section's at-rest half — the three stat cards (authority generation, rows on disk, newest backup) and the `Backups` table with Size / Verdict / Note (fidelity-3 SE45, SE46, SE48, SE49)
- [ ] WIRE `rowsOnDisk`, and a backup's `sizeLabel` and `note`, so those cards and that table have something true to print (fidelity-3 SE48, SE49)
- [ ] FE once the write half lands: the four editable groups and their eight leaves, the three-layer provenance stack, the source badges, the hazard badge and its escalation banner, the per-section dirty marker and the one action bar (fidelity-3 SE9–SE36)

needs:
- cross-cutting

log:
- 2026-08-20 | docs-cohesion 04 | the family, target and atomic N-leaf payload are contracted; `apply-settings` is the ONE entry in `PHASE1_DEFERRED` (`src/core/command-kernel.ts:141-148`), so the executor is the absence
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`
- 2026-08-21 | docs-cohesion 03a fidelity fold | five lines booked from ledger 3 §5 — the keyboard legend's destination, the two status sections already served, the storage at-rest half and its wire, the write half's full anatomy; the CONTAINER question (takeover vs dialog, SE1–SE4, SE8) is `{#track-f}`'s, not a build · left: all of it

### Trust UCPath / ServiceNow wait-before-negative-read windows {#def-propagation}
status: planned
doc: 04 §Trust UCPath / ServiceNow wait-before-negative-read windows · ref:write-safety §4 · ref:write-safety §4.2 · 03c §Live probe status (the design assumptions still unproven)

> Rebuild-verified propagation measurements replace ported legacy knowledge at each system's own live probe (doc 03c §Live probe status).

builds:
- [x] PROOF Kuali measured — four write/restore cycles on doc 4490, worst fence→trustworthy-negative ≈ 3.3 s; both Kuali contracts carry `stabilized` at `minSinceFenceMs: 30_000` (D135/D207)
- [ ] PROOF UCPath's Smart HR submit → SS Smart HR search window — both termination contracts stay `operator-only` and say why in the contract text
- [ ] PROOF ServiceNow's window — no commit contract exists for it yet
- [ ] PROOF the separations finalization's own controlled commit, which turns D207's provisional mechanism transfer into a measurement

needs:
- order-7

log:
- 2026-08-20 | docs-cohesion 04 | per system, not global: Kuali is closed, UCPath and ServiceNow are open; the direction-of-error argument is why the transfer stops at Kuali
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

### Search runs across dates / view screenshots / export Excel {#def-search-export}
status: planned
doc: 04 §Search runs across dates / view screenshots / export Excel · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §2.2 · ref:operator-trust §2.4

> No search module, artifact-bytes route or export writers in the BFF yet — capability register open; shaped against a real run corpus.

builds:
- [ ] BE the artifact-bytes route — the ref/resource schemas are complete and nothing serves bytes; it also unblocks the `captures` run-detail section, the screenshot gallery, and the ARCHIVE's evidence tiles (no archived capture can be opened at all — fidelity-3 AR188–AR190, AR249)
- [ ] FE the archive's `Change records` section — the record rides `ArchiveSweepWire.changeRecord` today, so this is buildable with no wire change (fidelity-3 AR234)
- [ ] BOTH the cross-date run search route + surface — the Top Bar filters the served day only (`legacy-route-search`)
- [ ] BE the operator xlsx export — the xlsx sink is a retention sink, uncomposed in production (D164); the Activity CSV (D240) is the only export served
- [ ] BOTH the rerun FIELD-LEVEL diff — nothing reads a prior run's receipt beside the current one (ref:operator-trust §2.4); the per-fact half (`retryOf`, `reuse` rows with `ageMs`) already exists

needs:
- cross-cutting

log:
- 2026-08-20 | docs-cohesion 04 | the full BFF route table re-read: no search endpoint, no artifact-bytes route, one served export; the evidence underneath is all durable, so these are routes rather than uncollected data
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the artifact-bytes line now names the archive's evidence tiles as a consumer and the `Change records` section is booked (ledger 3 AR188–AR190, AR234, AR249); the intake manifest / rerun-diff surface and its wire fields are `{#track-f}`'s BOTH line, and the unbooked findings (22 intake · 5 capture · 3 explorer) are in doc 03a §Stale and false claims · left: all of it

### Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes {#def-retention}
status: never
chip: won't build unless you ask
doc: 04 §Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes · ref:operator-trust §2.2 · ref:dashboard-surfaces §2.1 · ref:guards-and-tests §3.7

> Retention-sweep SCHEDULING (the sweep itself is built and tested and nothing calls it) and a content-store refcount — D193: disk growth on one local machine isn't worth a durable reference count. There is no "14/8/5" constant in this tree; the shipped number is 30 days from the bundle's own capture instant (D86's notes floor).

builds:
- [ ] BE a caller for `createDiagnosticRetentionSweep` — built and tested at `src/services/trust/diagnostic-retention.ts:45-85`, called by nothing, so no bundle has ever been purged here
- [ ] BE the content-store reference count that would let the sweep's reported unreferenced artifact ids actually be reclaimed (D137)

log:
- 2026-08-20 | docs-cohesion 04 | title corrected — no constant implements a 14/8/5 schedule; `DIAGNOSTIC_ORDINARY_RETENTION_DAYS` is 30 (`src/domain/trust/diagnostic-capture.ts:44`). Both items stay `wont-build-unless-asked` (D193b)
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)

## One all-at-once authority switch {#cutover}
phase: Cutover
status: planned
when: after Phase 3
size: L
chip: not started
doc: 05 §Phase summary · 05 §Exit criteria · 05 §Legacy vs rebuild (as of 2026-08-21) · ref:dashboard-surfaces §5 · ref:frontend-backend-integration §7.4 · ref:frontend-backend-integration §10 · ref:charter §Migration strategy
open: no

> D89 / D93. No workflow flips individually, no mixed-engine production, ever. The entire legacy repo is preserved as the rollback asset; nothing in it is deleted until rollback-window closure with separate explicit authorization.

builds:
- [ ] BE the ledger's serialized writer composed in production — `createLedgerProjector` has no caller outside `tests/` while the read-through IS composed, so the dashboard reads a corpus nothing writes (doc 05 §Exit criteria 6)
- [ ] PROOF the §7.4 performance and resilience budgets MEASURED on the local production build, and the numbers adopted as the non-regression gates (Track D D4/D5, D264)
- [ ] PROOF the recovery drill rehearsed against the REAL authority database — the unit lane drills a real-shaped copy every commit, and D181 is what made `cli storage restore` reachable at all
- [ ] PROOF T4 green — the agent-operated parallel end-to-end tier, which may not be scheduled before `{#parallel-runs}` and `{#duo-lease}` (ref guards-and-tests §10.8)
- [ ] PROOF the cutover REHEARSAL — ref frontend-backend-integration §10 criterion 11; the isolation half is proven by `operational-isolation`, the rehearsal has never run
- [ ] PROOF stop new legacy enqueues → drain / park / reconcile → back up both repos' state
- [ ] BE approved offline one-time imports (`one-time-import-offline` guard activates)
- [ ] PROOF atomically repoint the launcher → smoke gates, with the legacy launch verified DISABLED as part of the same atomic unit (D89 step 4)
- [ ] PROOF rollback bridge verified before the switch

needs:
- order-1
- order-2
- order-3
- order-4
- order-5
- order-6
- order-7
- order-8
- order-9
- cross-cutting
- track-d
- fact: legacy capability register at zero open (47 open today, all owned by `phase-3-workflow-migration`)
- fact: doc 05 §Exit criteria — the definition of done + the program-wide integration criteria (ref frontend-backend-integration §10) green in the real built app

log:
- 2026-08-21 | docs-cohesion 05 | doc 05 rewritten as-built — the register recount (47, not 48), five build items added for the definition-of-done conditions the tree lacked, and one FINDING: the ledger's serialized writer is built, tested and composed by nothing (`createLedgerProjector` is called only from `tests/`), so exit criterion 6 is open rather than met
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

### Rollback window, then closure {#rollback-window}
status: planned
doc: 05 §Rollback window, then closure · 05 §Phase summary · 05 §Exit criteria · ref:dashboard-surfaces §5

> Legacy code, tests and state intact; closure is its own later authorization. Nothing flips yet, so no window is open — and re-crossing is asymmetric: a launcher repoint before any native write, intent/ledger reconciliation and dedupe proof after one.

needs:
- cutover
- you: the closure authorization — deletion or retirement of the legacy repo is OUTSIDE this cutover and has no trigger, no elapsed-time rule and no automatic expiry (D89)

log:
- 2026-08-21 | docs-cohesion 05 | the section was a pointer paragraph; it now states what the window IS, what closes it, and why nothing has opened — the rollback bridge stays a `{#cutover}` build item rather than being duplicated here

### Later, unplanned {#later-unplanned}
status: never
chip: ideas, not a hosted future
doc: 05 §Later, unplanned · ref:operator-trust §7 · ref:clock-config-secrets §6.1

> A cooperation / multi-user mode built on top of solo (D193) — the tier's one remaining item; the PACKAGING half ("web app → real app") LEFT this tier on 2026-08-21, when the operator made it Phase 6 (`{#desktop-app}`, R14). The LATER tier of D76's MUST / SHOULD / LATER sizing — what the stop-loss cuts FIRST — and it never blocks the cutover: doc 05 §Exit criteria names none of it.

log:
- 2026-08-21 | docs-cohesion 05 | filled as-built — the two D193(a) items carry no owner and no design (which is what separates them from a doc 04 deferral), the four D75 seams that keep them possible are built, and hosting is a decided refusal rather than a LATER item
- 2026-08-21 | docs-cohesion R14 | the packaging half is no longer LATER — the operator promoted it to `{#desktop-app}` / doc 06, which gives it the owner and the design a LATER item by definition lacks; the cooperation / multi-user item and the hosting refusal are untouched
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

## Ship the desktop app {#desktop-app}
phase: Phase 6
status: planned
when: after the cutover | the operator may pull it earlier
size: L
chip: not started
doc: 06 §Phase summary · ref:frontend-backend-integration §6.9 · ref:execution-and-sessions
open: no

> R14, the operator 2026-08-21. The rebuild is DELIVERED as a Mac and Windows desktop app: an Electron shell hosting the BFF and the dashboard bundle in one process tree, managing the worker processes, keeping the browser automation (Playwright's full Chromium + Duo Autopilot) as child processes under app data, storing credentials in the OS keychain behind the ONE secrets reader, and packaged and signed for both operating systems. What it INHERITS: D181's `server` role lock → single instance; `runtime-isolation.json`'s roots → app-data dirs (they are repo-relative off `process.cwd()` today); D189's byte path → the desktop loads the bundle from app RESOURCES, so `{#def-byte-path}`'s phone/tunnel half stays separate; `{#parallel-runs}`' worker pool → the app's worker lifecycle; `{#duo-lease}`, because the desktop is where several workers on one machine become the ordinary case. Nothing is built: there is no Electron dependency at HEAD.

needs:
- cutover
- parallel-runs
- duo-lease

note: The order is "at the end" — but the operator may pull this phase IN FRONT of `{#cutover}` if the cutover should run on the packaged app. Until they do, `needs: cutover` stands.

log:
- 2026-08-21 | docs-cohesion R14 | phase drawn from the operator's instruction; nothing built

### Electron shell — the main process, the window, the single instance {#desk-shell}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Electron shell — the main process, the window, the single instance · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> The main process boots the BFF as a managed CHILD process (recommended over in-process: D181's role lock is per-PID and `cli storage restore` composes its stopped-system proof from those files, a BFF crash must not take the window, and `src/cli.ts` is a command entry rather than a library). The window loads `dist/dashboard` from app resources; every runtime root resolves under `app.getPath("userData")` with `runtime-isolation.json`'s NAMES unchanged; a second launch focuses the open window; the app holds a power save blocker while any run is in flight.

builds:
- [ ] BE the Electron main process boots the BFF as a managed child under the single-instance lock, and a BFF that finds D181's `server` role lock held refuses by name
- [ ] BE every runtime root resolved under `app.getPath("userData")` instead of `process.cwd()` — `compose.ts:336-337` computes them repo-relative, and `operational-isolation` pins the names, not the resolution
- [ ] BE the app-version stamp `RunRecord` carries (D179) read from a source that survives packaging — `compose.ts:337-340` reads `join(repoRoot, "package.json")`, which is inside the asar
- [ ] FE the renderer loads `dist/dashboard` from app resources with an EXPLICIT API base — `src/dashboard/app/main.tsx:21` passes `window.location.origin`, which is the string `"null"` under `file://`; the transport already takes a `baseUrl`, so the fix is a decision, not a seam
- [ ] BE an application menu and keep-awake while any run is in flight — a machine that sleeps mid-run leaves a claim to be swept and a browser on a half-staged page
- [ ] DOCS the decision: in-process vs managed child, and how the app lock composes with the role lock

needs:
- desktop-app

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the child-process recommendation and the four obstacles are read out of the code at HEAD (`src/server/dashboard/compose.ts`, `src/domain/config/schema.ts:8`, `src/dashboard/app/main.tsx:21`)

### Worker lifecycle — the pool the app owns {#desk-worker}
status: planned
date: R14 · 2026-08-21
size: L
doc: 06 §Worker lifecycle — the pool the app owns · ref:execution-and-sessions §1 · ref:execution-and-sessions §3

> Workers become managed child processes started and stopped from the dashboard, which IS `{#parallel-runs}`' pool rather than a second scheduler. Playwright's full bundled Chromium and the vendored Duo Autopilot extension are shipped with the app or installed on first run into app data; profiles keep doc 05's `(worker, system, instance, configFingerprint)` partition with the root moved under app data; the Windows half is verified on real hardware.

builds:
- [ ] BE workers as managed child processes, started and stopped from the dashboard — `createDashboardWorkerSupervisor` refuses spawn by name today and tells the operator to run `npm run cli worker` (`src/server/dashboard/compose.ts:322-331`), which a packaged app cannot offer
- [ ] BE Playwright's FULL bundled Chromium available to a packaged app — shipped inside the installer or installed on first run into app data (the headless shell cannot load an extension, so there is no smaller option)
- [ ] BE the vendored `duo-autopilot/` extension placed under app data with `paths.duoExtensionDir` pointed at it — a hard runtime dependency of every authenticated login (D244)
- [ ] BE browser profiles under app data, keeping the `(worker, system, instance, configFingerprint)` partition
- [ ] PROOF Windows — the extension path, the profile root and the Chromium launch verified on a real Windows machine, not a VM
- [ ] BE a worker that dies is reported with its exit reason and its claim released through D200's lease-as-evidence sweep, never by guessing

needs:
- desktop-app
- parallel-runs

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; this node CONSUMES `{#parallel-runs}`' pool — a second supervisor over one authority table is the shape D200 warned about

### Credentials — the OS keychain behind the one reader {#desk-secrets}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Credentials — the OS keychain behind the one reader · ref:clock-config-secrets §3

> `.env` becomes the macOS Keychain and the Windows Credential Manager, reached through `src/domain/secrets.ts` and nowhere else — the `secrets-single-source` guard does not move. The open design question is HOW a keychain (async, prompting) reaches a synchronous reader: populate each child's environment block at spawn, or give the reader a source seam. They differ in exposure, so it is a decision with a D-number. A first-run setup screen collects what is missing and names each credential it refuses without.

builds:
- [ ] BE the OS keychain as the credential source for a packaged app — macOS Keychain, Windows Credential Manager
- [ ] BE `src/domain/secrets.ts` stays the ONLY reader; `secrets-single-source.test.ts` unchanged
- [ ] BE the Duo credential (`paths.duoCredential`) moved into the same store, or its file placed under app data with the app's own protection — never plaintext inside the shipped bundle
- [ ] FE a first-run setup screen that names every credential it needs and refuses a workflow start by the name of the missing one
- [ ] BE widen `AbsolutePathSchema` for Windows paths — `src/domain/config/schema.ts:8` refuses anything not starting with `/`, and nine `paths.*` leaves use it, so a Windows build fails config resolution at the schema boundary (read-forward safe: every stored snapshot's POSIX path still parses)
- [ ] DOCS the decision: env-block injection vs a source seam inside the one reader

needs:
- desktop-app

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the POSIX-only path schema is a verified blocker for the Windows half and is filed here because it is what the keychain and the extension paths both trip over

### Packaging — signed installers for both operating systems {#desk-package}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Packaging — signed installers for both operating systems · ref:frontend-backend-integration §7.4

> electron-builder, with the dashboard bundle and `duo-autopilot/` as app resources. macOS: a signed and NOTARIZED dmg — an unsigned build fights Gatekeeper at exactly the moment a live run launches its second browser. Windows: a signed nsis or msix installer. The release version is the app-version stamp `RunRecord` already carries (D179), so an archived run names the build that produced it. Auto-update is LATER, deliberately and with its reason written down.

builds:
- [ ] BE electron-builder configured, with `dist/dashboard` and `duo-autopilot/` as app resources
- [ ] BE macOS — a signed and notarized dmg
- [ ] BE Windows — a signed installer (nsis or msix)
- [ ] BE the release version IS D179's app-version stamp, not a second identity
- [ ] DOCS auto-update deferred with a named trigger — an update landing between a fence and a read-back is a hazard nobody has designed for; the trigger is a stated position on updating while a run is in flight
- [ ] PROOF the installer builds from a clean checkout by one command, and the gate family still runs against the source tree unchanged

needs:
- desktop-app
- desk-shell
- desk-worker
- desk-secrets

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; signing is not optional on either OS because the app launches a second browser with an unpacked extension

### Proof — a dry run from the packaged app on both operating systems {#desk-proof}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Proof — a dry run from the packaged app on both operating systems · ref:guards-and-tests §10

> R10's T1 tier run from the INSTALLED app — a live `dryRun=true` workflow with its checkpoints asserted over authority — on macOS and on Windows, on real hardware. R10's T3 dashboard conditions attached, driven through the app's own window. The parity corpus re-rendered in the Electron renderer, because the operator's actual pixels are the ones the corpus exists to pin (D187). The recovery drill exercised through the app's own lock files, which are now what D181's stopped-system proof composes from.

builds:
- [ ] PROOF T1 — a full workflow dry run driven from the installed app on macOS, checkpoints asserted over authority and the result recorded durably
- [ ] PROOF T1 — the same on Windows, on real hardware
- [ ] PROOF T3 — a dashboard condition attached to that dry run and driven through the app's own window
- [ ] PROOF the parity corpus rendered in the Electron renderer (D187: a corpus photographed against the wrong surface records defects instead of catching them)
- [ ] PROOF `cli storage restore` drilled through the app's own runtime lock files (D181)

needs:
- desktop-app
- desk-package
- test-tiers

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the tiers are `{#test-tiers}`' and no workflow has a T1 pair at HEAD, so this node cannot be scheduled before that one

<!-- roadmap:end -->

---

## Governance (the plan's own rules)

_Lifted from the master plan's §0 on 2026-08-20 (cohesion step 3a) — verbatim except
where a name moved: the design docs are now cited by slug under `docs/rebuild/reference/`, and the
plan's own numbers are the phase docs `docs/rebuild/00`–`06` (the number IS the phase; phase 3 is
four docs, `03a`/`03b`/`03c`/`03d`). The master plan itself was dissolved into those docs on the same day
(step 3b); its as-written record, with a section-by-section table of where everything went, is
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`._

### The one-plan rule

Per charter §"One master plan": the owning design docs (now `reference/task-contract`,
`reference/workflow-model`, `reference/dashboard-surfaces`, `reference/decisions`,
`reference/execution-and-sessions`, `reference/data-intake-and-edit-data`, and
`reference/write-safety` through `reference/frontend-backend-integration`) are the binding detail;
THE PLAN — this file, the tree, plus the phase docs `docs/rebuild/00`–`06` — is the authoritative
build order. No second plan, no per-workflow "alt plan," no execution doc that re-sequences
phases. Per-workflow *migration plan docs* (Phase 3+) are **children** of this plan — they answer the §b questionnaire
(`doc 03c` §The §b migration questionnaire) and record what a workflow reuses/adds; they never re-order the
program.

**D263 (2026-08-20) — the plan has a machine-readable form, and it is bound to the docs both ways.**
`docs/roadmap/roadmap.md`, written in the roadmap notation
(`docs/roadmap/notation.md`), is that form and the operator tracking view;
`docs/roadmap/index.html` is GENERATED from it by `npm run roadmap` and is never hand-edited. It is a
second VIEW of this plan, never a second plan — **the plan's prose wins on any disagreement**, and the
disagreement is CAUGHT rather than argued, because the binding is two-way and mechanical: every node
carries a `doc:` line naming the sections that own its contracts, every doc
section that describes a node carries `<!-- roadmap: <id> -->` under its heading, and the
`roadmap-doc-binding` guard refuses a ref or a tag that resolves to nothing — so a rename on either
side fails the gate instead of rotting. Three rules bind the tree itself. A `builds:` box is `[x]`
**only** for what is landed at HEAD, with its commit or D-number cited in the line — never pre-marked.
The tree never invents scope: an unplanned feature is a finding for `docs/findings/`, not a roadmap
line. And session work is RECORDED where it happened — append-only per-node `log:` blocks plus one
`## session:` spine marker per working session, written per `docs/roadmap/notation.md`'s `session`
class, so the next agent reads a node's own history rather than re-deriving it from `git log`.

### D1 ownership map — the quick index (concept → owning doc)

Every concept has exactly one owner (`reference/decisions` D1). Reference the owner; never redefine.
The rows below are the same map the master plan's §0.2 carried, re-pointed to the shelf's new names.

| Concept | Owner |
|---|---|
| Task contract (`defineTaskContract`/`defineTask`), contract/impl split (D3), task-namespace grammar + closed `SystemId` union (D2), error taxonomy, three effects/dry-run mechanics, retry, decoration, system/service stores + pure workflow mini-stores, session providers + login signature, `stores/common/` leaf homes | **`reference/task-contract`** (was doc 01) |
| Workflow builder API (single), descriptor shape, `RunEnvelope`, run-state machine incl. gates/parks (D5), checkpoint/resume + freshness walk (D8), label precedence (D16) | **`reference/workflow-model`** (was doc 02) |
| Span/event wire schema (D10), notes stream, storage layout, SQLite projection role (D14), SSE wire shapes, completion (fan-out/approval) union (D11), cross-repo runtime boundary + one-time import rules (D88/D89/D93), the ONE run/queue projection every count reads (D81), run versioning + archive-on-bump (D80), run display names (D83) | **`reference/dashboard-surfaces`** (was doc 03) |
| Binding cross-doc reconciliation (D1–D118, through 2026-08-02 Round 18) | **`reference/decisions`** (was doc 04) |
| One-item workers, queue dispatch/backpressure, explicit browser-session boundaries + driver leases, speed/sleep-tax contract, page/subject-isolation invariant | **`reference/execution-and-sessions`** (was doc 05) |
| Data-service systems: CSV/PDF extraction, typed contact/address normalization, roster matching, durable mobile capture, operator column mapping, immutable intake manifest/rerun, Edit Data checkpoint UI | **`reference/data-intake-and-edit-data`** (was doc 06) |
| Cross-cutting gap findings memo (owns nothing — a design input) | **`reference/foundation-gap-audit`** (was doc 08) |
| Write-safety contract, permanent-key intents, typed proof, atomic outboxes/recovery, serialized anchored ledger | **`reference/write-safety`** (was doc 09) |
| Guard/test architecture suite: ratchet port map, safety guards, descriptor-coverage crosswalk, guard-of-guards manifest, TDD tiers, stub + live lanes | **`reference/guards-and-tests`** (was doc 10) |
| The Clock (sole time source), config resolver (env>settings>default), per-run prod/test instance (D6-adjacent), fiscal-year rollover, secrets accessor, environment/preflight registry | **`reference/clock-config-secrets`** (was doc 11) |
| Semantic UI vocabulary + typed drivers, failures/diagnostic bundles/evidence receipts, scenario corpus, structured knowledge/fix history, durable trust/explain surfaces, workflow explorer/editor, local-first seams/safety floor, base capability inventory | **`reference/operator-trust`** (was doc 12) |
| Production dashboard composition boundary: bootstrap/day/detail resources, one typed client, cursor-based SSE, product command-family coverage, surface-to-authority matrix, visual-parity harness | **`reference/frontend-backend-integration`** (was doc 13) |

The operator's vision and the non-negotiables stay `reference/charter` (was doc 00). The PLAN half —
phases, tasks, exit criteria, the migration order, the deferrals and the cutover — is this file plus
the phase docs under `docs/rebuild/`, one per tree phase: `00-design-the-foundation` ·
`01-build-the-spine` · `02-prove-writes-build-the-tails` · `03a-finish-the-dashboard` ·
`03b-finish-separations` · `03c-migrate-the-remaining-workflows` · `03d-co-operate-with-claude` ·
`04-close-the-deferrals` · `05-cut-over` · `06-ship-the-desktop-app`.

### Standing rule — each completed phase documents itself

Charter §"One master plan": *the foundation's documentation is part of the foundation.* When a phase
completes, its owning docs are updated to describe **as-built** reality (not just design intent), and
this plan's phase table is checked off. A phase is not "done" until its doc delta is written. New
sub-systems get new docs or amend existing ones; stale prose is corrected, never layered. Per D263
(above) a phase's close-out also ticks its node in `docs/roadmap/roadmap.md` and leaves a `log:`
line there naming what landed and what is left.

---

## Phases at a glance

_Moved from `docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md` §2 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite
re-verifies it, and its four internal §-refs are repointed to the phase docs that now own those
sections. Each phase's detail — its work items, what is done, its exit criteria — is its own doc
under `docs/rebuild/`; the tree above is the same set of phases as nodes._

_**Three rows were ADDED and one renumbered on 2026-08-21** — `3d` (R15), `4` and `6` (R14), with the
cutover row renumbered `5` to match the shelf. The master plan's table stopped at the cutover and the
shelf did not, so the sentence above — the same set of phases as nodes — was false for three of them.
A glance table that omits a phase is worse than no glance table: it reads as a complete list._

| Phase | Headline deliverable | Gate to exit | Size |
|---|---|---|---|
| **0** | Corrected foundation design approved; empty rebuild repo | **COMPLETE 2026-07-31:** decisions reconciled through Round 12; testing policy ratified; executable feasibility + honest gate baseline recorded; write-proof probes carry explicit later milestone gates (`doc 03c` §Live probe status) | **M** |
| **1** | **The SPINE** — the minimum base that can carry one workflow end to end (1a–1f + the span/projection slice + the queue-surface slice) | **COMPLETE 2026-08-04.** 1a + 1b COMPLETE 2026-07-31; 1c + 1d + 1e COMPLETE 2026-08-01; **1f + 1g-spine + 1i-spine COMPLETE 2026-08-04**. The phase exit — **person-lookup ran LIVE on the spine** (D74) against real UCPath + CRM, run `4ebf7275-0158-49af-a78f-1f37948efb27` / trace `pl-000619-4ebf` — is **MET**; full gates green; strict/subject/control/delegation/recovery/scenario fixtures pinned. Evidence and the carried-forward presentation defects are recorded under §Phase 1's exit criteria | **XL** |
| **2** | **Transaction proof, then the deferred base tails** — controlled real commit + crash/recovery, *then* trust tails, data services/intake/capture, explorer | subject-bound dry-run and controlled commit/crash/outbox/ledger proof green; then evidence/notification/knowledge, intake/capture/Edit-Data, and read-only explorer land against a proven spine | **XL** |
| **3+** | Per-workflow rebuild migration, one at a time (order: `doc 03c` §Recommended migration order), plus explicit non-workflow capability closure (`doc 03c` §Non-workflow capability closure inventory) | each: §b questionnaire answered; isolated live dry-run + controlled write evidence where applicable; every capability inventory entry advances to native/replaced/retired; docs updated; legacy production remains authoritative until the final gate | **XL** |
| **3d** | **Co-operate with Claude** — a second actor on the one local BFF: Claude Code in the terminal, a local MCP server, full parity except the two-actor rule on identity gates and controlled commits (`doc 03d`, R15) | MCP server registered and usable from the terminal; the parity table ENFORCED rather than documented; the two-actor rule proved on one identity gate; both apps open on one BFF; monitoring legible (`doc 03d` §Exit criteria) | **L** |
| **4** · Deferred | Every "I want X; the plan said Y; Y is deferred" answer, each with the **trigger** that ends it (`doc 04`) | not a dated block of work: a deferral closes with the decision that ends it, and `doc 05` §Exit criteria names none of them, so none blocks the cutover | **—** |
| **5** · Cutover | One all-at-once production authority switch (D89) | every workflow/shared capability ready; legacy enqueues stopped; active/uncertain work reconciled; both states backed up; imports versioned/idempotent; launcher switches atomically; rollback bridge verified; legacy code/tests preserved | **L** |
| **6** | **Ship the desktop app** — the rebuild delivered as a Mac and Windows application: an Electron shell over the BFF, the worker pool the app owns, keychain credentials, signed installers (`doc 06`, R14) | installable on both operating systems with no checkout and no npm; a real workflow dry run from the INSTALLED app on both; credentials never in a file the app ships; the worker survives sleep or refuses loud (`doc 06` §Exit criteria) | **L** |

**Reading the Size column.** These are relative build sizes, not calendar — the calendar depends
on session cadence, which the plan does not own. The unit is *work sessions of the kind this
program actually runs in*: **S** ≈ 1, **M** ≈ 2–4, **L** ≈ 5–10, **XL** ≈ 10+. They expose
delivery risk and help keep a long coexistence program tractable. Per-item sizes are in `doc 00` §Size model + delivery tiers; they are estimates
offered for correction, not commitments. **Phase 4 carries no size on purpose** — it is not a block of
work but eight named absences, each sized by the decision that ends it.

---

## Where things went

The master plan (`07-master-plan.md`) was dissolved on 2026-08-20 and no longer exists as a doc. Its
sections are now:

| Was | Is |
|---|---|
| §0 governance | this file, §Governance above (lifted 3a) |
| §1 the base's dependency graph · §3 Phase 0 · §3.7 sizes | `docs/rebuild/00-design-the-foundation.md` |
| §2 the phase table | this file, §Phases at a glance above |
| §3 Phase 1 · §7.1–§7.2's Phase-1 rows | `docs/rebuild/01-build-the-spine.md` |
| §3 Phase 2 · §7.1–§7.2's Phase-2 rows | `docs/rebuild/02-prove-writes-build-the-tails.md` |
| §7.1's approved-target bullet · §7.3 the integration execution rule | `docs/rebuild/03a-finish-the-dashboard.md` |
| §3.1's PHASE 3 ENTRY block + separations' status | `docs/rebuild/03b-finish-separations.md` |
| §3.1 the migration loop · §3.2 · §3.3 · §3.4 · §3.6 · §3.8 | `docs/rebuild/03c-migrate-the-remaining-workflows.md` |
| §3.5 · Phase 0's deferred decisions | `docs/rebuild/04-close-the-deferrals.md` |
| §4 · §5 · §5.1 · §6 · §7.4 | `docs/rebuild/05-cut-over.md` |

The whole as-written file, with a section-by-section table of where every § landed, is preserved at
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`.

This file's own appendices went too:

- **Appendix A (the prose decision log and the "named to you at specific future gates" list)** —
  **deleted.** `docs/rebuild/reference/decisions.md` is the append-only authority for every `D<n>`
  (its round headings carry the date, its rows the owning doc), and every future gate it listed is
  already a `you:` line on the node that owes it in the tree above.
- **Appendix B (legacy vs rebuild)** — `docs/rebuild/05-cut-over.md` §Legacy vs rebuild (as of
  2026-08-20), dated because it is an inventory of a moving world.
- **Appendix C (verify any of this yourself)** — the project `CLAUDE.md` §Commands, which already
  carries every command it listed (`phase` and `storage doctor` are subcommands of `npm run cli`).
