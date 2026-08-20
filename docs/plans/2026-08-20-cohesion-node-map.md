# The doc ↔ node map — step 5.0 of the docs/roadmap cohesion plan

**Date:** 2026-08-20 · **Plan:** `docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` §2 step 5 ·
**Source of nodes:** `docs/roadmap/roadmap.md`, the region between `roadmap:start` and `roadmap:end`, at HEAD `b3f6eb03`.

## How to use this map (rewrite agents read this first)

1. **Follow the map.** §1 gives every node its `doc:` value; §2 gives every doc section the node id its
   `<!-- roadmap: <id> -->` tag names. Your doc's block in §2 is your worklist.
2. **A `doc:` ref names a NUMBERED section.** The step-3 guard resolves `NN §x.y` against a heading whose
   section number matches, so only numbered headings can appear in a `doc:` value. A
   `<!-- roadmap: <id> -->` tag has no such constraint — it may sit on ANY section, including the
   unnumbered phase-keyed as-built blocks (`## Phase 1c Stage B as-built storage delta`, …). The binding is
   deliberately asymmetric: **every `doc:` ref implies a tag, but not every tag implies a `doc:` ref.**
   Where a node's real home is an unnumbered as-built block, §1's `also tag` column names it; put the tag
   there and cite the numbered section the block amends in `doc:`.
3. **You may tighten, not invent.** A rewrite agent may narrow a `doc:` ref (`ref:dashboard-surfaces §2` → `ref:dashboard-surfaces §2.3`), add a tag
   this map missed, or drop a ref that reading the body disproves — record the change in your commit
   message. A **NEW node** needs the orchestrator's ok: report it, do not add it. §3(b) already lists the
   ones this pass found; if you find another, add it to your report, not to `docs/roadmap/roadmap.md`.
4. **`migration ref` is not a `doc:` ref.** `docs/migrations/separations.md` lives outside `docs/rebuild/`,
   so the guard cannot resolve it and it must never appear in a `doc:` value. Cite it in the node's prose
   instead. Tags may go in `docs/migrations/*.md` only if the orchestrator widens the guard's scan — today
   it scans `docs/rebuild/*.md`, so treat migration docs as **untagged** for now.
5. **`confidence`** is about THIS map, not about the doc. `high` = the node's heading, `builds:` lines or
   `date:` line named the owner outright. `medium` = settled by reading the node's prose or by resolving
   which numbered parent an unnumbered `####` decision sits under. `low` = a guess; the rewrite agent
   should re-decide it and tell the orchestrator what it chose.
7. **A ref that landed in `roadmap §…` is DROPPED, not translated.** The 3c sweep repointed every
   `07 §x` citation to wherever step 3b sent that section. Where it went to the roadmap's own
   governance prose (`§Governance`, `§Phases at a glance`), the ref is gone from the `doc:` column
   below: a node may not cite the file it lives in, and the parser admits only a phase number or
   `ref:<slug>`. The phase rows lost exactly those refs; what remains is their phase doc.

6. **Two `##` lines in the region are NOT nodes** and take no tag: the `## flag: 2026-08-12 | D193 …`
   marker and the `## today: 2026-08-20 · HEAD 81287bb …` marker. Step 2's `## session:` marker will be a
   third. The parser treats them as spine markers.

---

## 1 · Node → docs

66 nodes. `proposed id` is filled only where the plan has no `{#id}`; the ids follow the existing style and
must be added to `docs/roadmap/roadmap.md` by the orchestrator (or by the doc's rewrite agent with the orchestrator's
ok) before the sections that reference them can be tagged.

| node id | proposed id | title | level | status | doc: | migration ref | conf | also tag / why |
|---|---|---|---|---|---|---|---|---|
| `phase-0` | — | Foundation design | 2 | done | `00 §Phase summary · 05 §Phase summary` | — | high | phase → roadmap §Phases at a glance + the `### Phase 0` block in §3; §0.2 is "each doc owning its contracts"; §4 the two-repo model |
| — | `phase0-always-gate` | ALWAYS-GATE identity approval | 3 | done | `ref:write-safety §14 · ref:write-safety §14.1 · ref:write-safety §14.3` | — | high | the node's own `date:` line says "ref write-safety §14" |
| — | `phase0-size-model` | Size model + delivery tiers | 3 | done | `00 §Size model + delivery tiers` | — | high | the node's own `date:` line says "00 §Size model + delivery tiers" |
| `phase-1` | — | The SPINE | 2 | done | `01 §Phase summary · 00 §The base's dependency graph` | — | high | the `### Phase 1 — the SPINE (D74)` block; §1 is the dependency graph the spine is a cut of |
| `p1-base` | — | 1a · 1b — guards, baselines, the strict domain leaf | 3 | done | `ref:guards-and-tests §2 · ref:guards-and-tests §1.1 · ref:clock-config-secrets §2 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6 · ref:task-contract §2.1.1 · ref:dashboard-surfaces §5` | — | high | also tag the 1b as-built blocks: `ref:task-contract §Phase 1b as-built domain foundation`, `ref:guards-and-tests §Phase 1b as-built guard delta`, `ref:clock-config-secrets §Phase 1b as-built foundation`, `ref:operator-trust §Phase 1b as-built trust-schema subset`, `ref:frontend-backend-integration §Phase 1b as-built integration subset` |
| `p1-authority` | — | 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG | 3 | done | `ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.4 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §4 · ref:operator-trust §1 · ref:task-contract §2 · ref:task-contract §2.7 · ref:workflow-model §3` | — | high | also tag every `Phase 1c Stage A–D` block (03, 09, 10, 11), every `Phase 1d` block (01, 05, 10, 12) and every `Phase 1e` block (02, 03) |
| `p1-kernel` | — | 1f — registry, workers, commands, the write sequencer | 3 | done | `ref:workflow-model §1.3 · ref:workflow-model §2 · ref:workflow-model §4 · ref:dashboard-surfaces §2.4 · ref:execution-and-sessions §3 · ref:execution-and-sessions §4 · ref:execution-and-sessions §4.1 · ref:write-safety §3` | — | high | also tag the `Phase 1f …ratification` blocks in 01, 02, 03, 05 (×2), 09, 10 |
| `p1-spine` | — | 1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell | 3 | done | `ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.2 · ref:dashboard-surfaces §10.1 · ref:frontend-backend-integration §3 · ref:frontend-backend-integration §6.2 · ref:frontend-backend-integration §6.3 · ref:frontend-backend-integration §7.1` | — | high | also tag `ref:dashboard-surfaces §Phase 1g/1i-spine as-built presentation deltas`, `ref:clock-config-secrets §Phase 1i-spine as-built config-path delta` |
| `p1-exit` | — | Phase 1 exit — the live run | 3 | done | `01 §Exit criteria · ref:workflow-model §8 · ref:workflow-model §8.1` | — | high | 07's Phase-1 exit-criteria block; ref:workflow-model §8 IS the person-lookup worked example |
| `phase-2` | — | Transaction proof, then the deferred base tails | 2 | done | `02 §Phase summary` | — | high | the `### Phase 2 — the transaction proof…` block |
| `p2-proof` | — | Transaction proof — the first real write | 3 | done | `ref:write-safety §2.1 · ref:write-safety §3 · ref:write-safety §3.1 · ref:write-safety §5 · ref:guards-and-tests §3.6 · ref:frontend-backend-integration §6.4` | — | high | also tag `ref:write-safety §Phase 2 transaction-proof as-built — the DRY-RUN half` and `ref:write-safety §Phase 2 controlled-commit as-built — COMPLETE` + its nine `###` subs |
| `p2-2g` | — | 2g — event / trust layer | 3 | done | `ref:operator-trust §2.2 · ref:operator-trust §2.3 · ref:operator-trust §4 · ref:operator-trust §6 · ref:operator-trust §6.1 · ref:dashboard-surfaces §2.6 · ref:write-safety §6.1 · ref:frontend-backend-integration §6.5` | — | high | also tag 12's three `## Phase 2g as-built —` blocks and all their `###` subs (D137–D143, D199, D204, D237) |
| `p2-2h` | — | 2h — data / intake foundation | 3 | done | `ref:data-intake-and-edit-data §1 · ref:data-intake-and-edit-data §2 · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §6 · ref:frontend-backend-integration §6.6` | — | high | every `Phase-2h as-built` sub inside those sections is 2h |
| `p2-2i` | — | 2i — the operator surface (A–G) | 3 | done | `ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §10.2 · ref:dashboard-surfaces §11 · ref:dashboard-surfaces §12 · ref:dashboard-surfaces §13 · ref:operator-trust §5.7 · ref:operator-trust §5.8 · ref:data-intake-and-edit-data §6.4.1` | — | high | every `Phase-2i as-built` sub inside ref:data-intake-and-edit-data §2.7/§2.8/§5.2 is 2i |
| `p2-2j` | — | 2j — the closing gate | 3 | done | `02 §2j — the closing gate · 03c §Non-workflow capability closure inventory · ref:execution-and-sessions §7.1 · ref:guards-and-tests §3.11 · ref:guards-and-tests §3.15 · ref:operator-trust §3 · ref:dashboard-surfaces §2.5` | — | high | also tag `ref:guards-and-tests §3.11 as-built`, `ref:guards-and-tests §D190`, `ref:dashboard-surfaces §D181` |
| — | `phase2-dispositions` | Left Phase 2 by explicit disposition | 3 | never | `ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9` | — | high | the prose names exactly D186 (explorer EDIT half) and D189 (no frontend bytes) |
| `phase-3` | — | Per-workflow migration — separations first | 2 | active | `03b §Phase summary · 03c §Phase summary · 03c §Recommended migration order` | — | high | the `### Phase 3+ —` block plus the migration loop and order |
| `dash-defaults` | — | Dashboard defaults — the generic surfaces every workflow inherits | 3 | active | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.8 · ref:dashboard-surfaces §1.2` | — | high | §5's wiring matrix IS "what every workflow inherits" |
| `track-b` | — | Track B · dashboard completion | 4 | done | `ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §10.2 · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.3 · ref:write-safety §14.11 · ref:operator-trust §5.9` | `separations.md §9.19` | high | B1→ref:write-safety §14.11 · B2→ref:dashboard-surfaces §D238 + ref:operator-trust §D237 · B3/B7→ref:frontend-backend-integration §D250–D253 (all under §5.1) · B4→ref:dashboard-surfaces §Queue-row projection as-built delta + its 10 subs · B5→ref:dashboard-surfaces §D223 as-built · B6→ref:operator-trust §5.9 · B8→ref:dashboard-surfaces §D254 (§1.1) + §D255 (§2.3) |
| `track-c` | — | Track C · connection proof | 4 | done | `ref:workflow-model §1.1 · ref:dashboard-surfaces §2.3 · ref:frontend-backend-integration §7.1` | `separations.md §9.22 · §9.23 · §9.24` | medium | D260/D261 are `####` under `ref:workflow-model §1.1 Shape`; D258 is `####` under `ref:dashboard-surfaces §2.3`; also tag `ref:dashboard-surfaces §Wave-2 connection-proof presentation deltas` + its three subs (D256, D257, shape hazard) and `ref:dashboard-surfaces §D259` |
| `track-d` | — | Track D · dashboard hardening, pre-cutover budgets | 4 | proposed | `ref:frontend-backend-integration §4 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §7.4` | — | high | plan step 4 names D264's owner as ref frontend-backend-integration §4 + §7.4; D11 (`WORKFLOW_DESCRIPTORS` out of the bundle) amends ref:frontend-backend-integration §4 |
| `order-8` | — | Separations — order 8, the first migration | 3 | planned | `03c §Phase summary · 03c §Exit criteria · 03c §Recommended migration order` | `separations.md §1 · §3 · §5 · §6` | high | the migration doc is the child plan; 07 owns the loop, the exit criteria and the order |
| `sep-1` | — | 1 · new-kronos timecard read | 4 | done | `ref:task-contract §2.8 · ref:task-contract §2.9` | `separations.md §2.4 · §9.1 · §9.2 · §9.2a` | high | ref:task-contract §2.9 is literally "the FIRST store authored under §2.8 — `new-kronos` as-built (D196)" |
| `sep-2` | — | 2 · Kuali separation-document read | 4 | done | `ref:task-contract §2.8 · ref:task-contract §2.10` | `separations.md §2.3 · §4a · §9.3 · §9.4` | high | ref:task-contract §2.10 is "the first store CUSTOMIZED under §2.8 — `kuali` as-built (D197)" |
| `sep-3` | — | 3 · UCPath employment grid + the ALWAYS-GATE | 4 | done | `ref:task-contract §2.11 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §5.5` | `separations.md §4d · §9.5 · §9.6` | high | ref:task-contract §2.11 is `ucpath/read-job-summary` (D201); D203 gate-as-evidence lands on ref:workflow-model §5.5's freshness walk; also tag `ref:operator-trust §D204` |
| `sep-4` | — | 4 · UCPath termination WRITE | 4 | done | `ref:task-contract §2.12 · ref:write-safety §3 · ref:write-safety §5` | `separations.md §2.2 · §9.7 · §9.8 · §9.9` | high | ref:task-contract §2.12 is "`ucpath`'s termination family (D206)"; the pending sweep is ref:write-safety §5's double-submit contract |
| `sep-5` | — | 5a/b/c · Kuali finalization WRITE | 4 | done | `ref:write-safety §2.2 · ref:write-safety §3 · ref:write-safety §4.2` | `separations.md §4e · §9.10 · §9.11 · §9.12 · §9.15` | high | D207's propagation-window rule IS ref:write-safety §4.2; D217's date write-backs are §4e's amendment |
| `sep-6a` | — | 6a · THE COMPOSITION | 4 | done | `ref:workflow-model §3 · ref:write-safety §14.10` | `separations.md §9.13` | high | ref:write-safety §14.10 is "the packet carries the WRITE PLAN, and the digest binds to it (D211)" |
| `sep-6b` | — | 6b · composed LIVE pass | 4 | done | `ref:workflow-model §5.7 · ref:task-contract §6.2 · ref:write-safety §3` | `separations.md §9.14 · §9.16` | high | D214's `claimGeneration` is the checkpoint store (ref:workflow-model §5.7); D215's probing dry run is ref:task-contract §6.2 |
| `sep-6c` | — | 6c · PREVIEW TERMINAL reached | 4 | done | `ref:workflow-model §2.1 · ref:operator-trust §2.3` | `separations.md §9.17` | high | ref:workflow-model §2.1 is "How a previewed run ENDS (D210)"; the `partial`/`unknown` receipt is ref:operator-trust §2.3 |
| `track-a` | — | Track A · separations backend completion | 4 | planned | `ref:write-safety §3 · ref:write-safety §4.2 · ref:write-safety §5 · 03c §Exit criteria · 03c §Non-workflow capability closure inventory · ref:operator-trust §3.2 · ref:operator-trust §4` | `separations.md §6 · §9.19 · §9.20 · §9.21` | high | the three controlled commits + `probeToFenceMaxMs` are 09; close-out (scenarios, knowledge, capability dispositions) is ref:operator-trust §3.2/§4 + 03c §Exit criteria/§3.6 |
| `sep-dash` | — | Dashboard · wire separations | 4 | active | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9 · ref:write-safety §14.11` | `separations.md §9.22` | high | the nine wire squares map one-to-one onto the dash-defaults ref set + the gate ceremony |
| `platform-fixes` | — | Platform fixes the live runs forced | 3 | done | `ref:workflow-model §1.2.1 · ref:workflow-model §4 · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.6 · ref:execution-and-sessions §4.2` | `separations.md §9.21` | high | D218→ref:dashboard-surfaces §2.3 · D221→ref:workflow-model §4 (a retry is the item's next attempt) · D219/D220→ref:workflow-model §1.2.1 · D222→ref:dashboard-surfaces §2.6 · D243/D244→ref:execution-and-sessions §4.2 |
| `operator-calls` | — | Smaller operator calls open | 3 | you | `ref:dashboard-surfaces §9 · 03c §Non-workflow capability closure inventory · ref:guards-and-tests §3.11` | `separations.md §9.20` | medium | the gate-age pill is ref:dashboard-surfaces §9's D12; D192's re-disposition is the capability register (ref:guards-and-tests §3.11 + 03c §Non-workflow capability closure inventory) |
| `migrations` | — | The remaining migrations | 2 | planned | `03c §Phase summary · 03c §Recommended migration order · 04 §Phase summary` | — | high | §3.3 IS the order this node renders; §3.5 slots the data systems |
| `order-0` | — | Order 0 · person-lookup | 3 | done | `03c §Recommended migration order · ref:workflow-model §8 · ref:workflow-model §8.1 · ref:task-contract §9.1 · ref:task-contract §9.1.1` | — | high | ref:task-contract §9.1 is the canonical `ucpath/search-person-org` example; §9.1.1 the CRM half |
| `order-0-dash` | — | Dashboard · wire person-lookup | 4 | done | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.3` | — | high | the Phase-1 slice's wiring |
| `order-1` | — | Order 1 · person-lookup Search + Match · i9-lookup | 3 | planned | `03c §Recommended migration order · ref:dashboard-surfaces §9 · ref:task-contract §3.1` | — | high | D15 (Search + Match as modes) lives in ref:dashboard-surfaces §9; the `i9` store's home is ref:task-contract §3.1's layout |
| `order-1-dash` | — | Dashboard · wire Search + Match · i9-lookup | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | the standard five-square wire set (see the note under §2's ref frontend-backend-integration block) |
| `order-2` | — | Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports | 3 | planned | `03c §Recommended migration order · 04 §Phase summary · ref:task-contract §3.1 · ref:guards-and-tests §3.7 · ref:frontend-backend-integration §3.6` | — | high | artifacts-are-immutable is ref:guards-and-tests §3.7; the bytes route is ref:frontend-backend-integration §3.6 |
| `order-2-dash` | — | Dashboard · wire the downloads | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §3.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + the download viewer (ref:frontend-backend-integration §3.6) |
| `order-3` | — | Order 3 · the OCR pipeline workflow | 3 | planned | `ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §5.1 · ref:frontend-backend-integration §6.9 · ref:dashboard-surfaces §12` | — | high | D189's byte path is ref:frontend-backend-integration §6.9; the phone surface is ref:dashboard-surfaces §12 / ref:data-intake-and-edit-data §5.1 |
| `order-3-dash` | — | Dashboard · wire the OCR pipeline | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:data-intake-and-edit-data §4.3 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + the OCR review UI (ref:data-intake-and-edit-data §4.3 for the three producers, ref:dashboard-surfaces §9 D7/D8/D10 for the review row) |
| `order-4` | — | Order 4 · oath-signature · emergency-contact | 3 | planned | `03c §Recommended migration order · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §4.3 · ref:write-safety §3 · ref:write-safety §14` | — | high | first operation fan-out = ref:dashboard-surfaces §4's completion contract; the first non-separations controlled commits = ref:write-safety §3 |
| `order-4-dash` | — | Dashboard · wire oath-signature · emergency-contact | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:write-safety §14.11 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + a gate ceremony (ref:write-safety §14.11) + Group People (ref:dashboard-surfaces §9's D11/D14) |
| `order-5` | — | Order 5 · i9-check | 3 | planned | `03c §Recommended migration order · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §7 · ref:execution-and-sessions §8 · ref:data-intake-and-edit-data §4.1` | — | high | ref:dashboard-surfaces §7 and ref:execution-and-sessions §8 are both the operation-coordinator worked example; the workbook is ref:data-intake-and-edit-data §4.1 |
| `order-5-dash` | — | Dashboard · wire i9-check | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:data-intake-and-edit-data §4.1 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + member rows with retention status + the workbook export control |
| `order-6` | — | Order 6 · work-study · kronos-pay-rule | 3 | planned | `03c §Recommended migration order · ref:write-safety §2.2 · ref:write-safety §5 · ref:task-contract §2.9 · ref:data-intake-and-edit-data §1` | — | high | new-kronos gains a write family (ref:task-contract §2.9 / ref:write-safety §2.2); the canonical-EID audit gate is ref:data-intake-and-edit-data §1's registry |
| `order-6-dash` | — | Dashboard · wire work-study · kronos-pay-rule | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:data-intake-and-edit-data §2.8 · ref:dashboard-surfaces §11 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + the intake grid constants entry / unbind arm (D172/D173 → ref:data-intake-and-edit-data §2.8, ref:dashboard-surfaces §11) |
| `order-7` | — | Order 7 · oath-upload · onbase | 3 | planned | `03c §Recommended migration order · 03c §Live probe status · ref:write-safety §2.2 · ref:write-safety §4.2 · ref:dashboard-surfaces §4.5 · ref:guards-and-tests §3.5 · ref:task-contract §9.2` | — | high | OnBase OQ2 is ref:guards-and-tests §3.5's `unverifiableByPage` allowlist; oath-upload's born-at-upload fence is ref:dashboard-surfaces §4.5; ServiceNow propagation is 03c §Live probe status + ref:write-safety §4.2 |
| `order-7-dash` | — | Dashboard · wire oath-upload · onbase | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:operator-trust §2.3 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + the ServiceNow receipt / OnBase upload-verify on the run-detail receipt (ref:operator-trust §2.3) |
| `order-9` | — | Order 9 · onboarding | 3 | planned | `03c §Recommended migration order · ref:workflow-model §3 · ref:data-intake-and-edit-data §4 · ref:write-safety §5 · ref:write-safety §14` | — | high | the no-EID hire probe widens ref:write-safety §5's `ProbeVerdict`; roster ingest is ref:data-intake-and-edit-data §4 |
| `order-9-dash` | — | Dashboard · wire onboarding | 4 | planned | `ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:data-intake-and-edit-data §4 · ref:write-safety §14.11 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9` | — | high | standard set + a gate ceremony + the roster-ingest surface |
| `cross-cutting` | — | Cross-cutting Phase 3 capabilities (no single order) | 3 | planned | `03c §Non-workflow capability closure inventory · ref:clock-config-secrets §3 · ref:clock-config-secrets §6.2 · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §8` | — | high | editable settings = ref:clock-config-secrets §3 + ref:frontend-backend-integration §3.4's command protocol; search/screenshots = ref:frontend-backend-integration §3.6; exports = ref:data-intake-and-edit-data §4.1; `test-login`/wizard = ref:clock-config-secrets §6.2 + 03c §Non-workflow capability closure inventory |
| `deferred` | — | The X → Y traceback | 2 | planned | `00 §Size model + delivery tiers · 03c §Live probe status · 05 §Risk register` | — | medium | the delivery tiers (MUST/SHOULD/LATER) are what "deferred with a trigger" means; §3.8 carries the unproven probes; §5 the risk register |
| `def-capture-binding` | — | Photograph a paper form → an OCR-backed run | 3 | planned | `ref:data-intake-and-edit-data §5.1 · ref:dashboard-surfaces §12` | — | high | `CAPTURE_INTAKE_BINDINGS` is ref:data-intake-and-edit-data §5.1's seam |
| `def-byte-path` | — | Run the dashboard without the dev server / the phone page in production | 3 | planned | `ref:frontend-backend-integration §6.9 · ref:frontend-backend-integration §8 · ref:dashboard-surfaces §12.6` | — | high | ref:frontend-backend-integration §6.9 IS D189; the guard arm is ref:frontend-backend-integration §8 |
| `def-explorer-edit` | — | Edit a workflow's presentation / policy without a code change | 3 | planned | `ref:operator-trust §5.1 · ref:operator-trust §5.3 · ref:operator-trust §5.4` | — | high | ref:operator-trust §5.3 IS "Phase B — safe edits only" (D186) |
| `def-sanity-check` | — | A record-sanity-check advisory panel | 3 | planned | `ref:operator-trust §4.4 · ref:guards-and-tests §3.11` | — | high | ref:operator-trust §4.4 is optional AI assistance; D192's inventory entry is ref:guards-and-tests §3.11 |
| `def-settings` | — | Edit settings in the dashboard | 3 | planned | `ref:clock-config-secrets §3 · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §2.4` | — | high | the `apply-settings` family is a command-protocol target family over the config resolver |
| `def-propagation` | — | Trust UCPath / ServiceNow wait-before-negative-read windows | 3 | planned | `ref:write-safety §4 · ref:write-safety §4.2 · 03c §Live probe status` | — | high | the node's own prose cites 03c §Live probe status |
| `def-search-export` | — | Search runs across dates / view screenshots / export Excel | 3 | planned | `ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §2.2` | — | high | query/artifact surface, the export writers, the screenshot evidence store |
| `def-retention` | — | Auto-purge diagnostics · reclaim unreferenced artifact bytes | 3 | never | `ref:operator-trust §2.2 · ref:dashboard-surfaces §2.1 · ref:guards-and-tests §3.7` | — | medium | the 14/8/5 schedule belongs to the diagnostic bundle; the stream floors are ref:dashboard-surfaces §2.1; the refcount would live under ref:guards-and-tests §3.7's artifact boundary |
| `cutover` | — | One all-at-once authority switch | 2 | planned | `05 §Phase summary · 05 §Exit criteria · ref:dashboard-surfaces §5 · ref:dashboard-surfaces §5.4 · ref:frontend-backend-integration §10` | — | high | the node's own `needs:` cites 05 §Exit criteria, 05 §Exit criteria and ref:frontend-backend-integration §10 |
| `rollback-window` | — | Rollback window, then closure | 3 | planned | `05 §Phase summary · ref:dashboard-surfaces §5` | — | high | preservation + the one-direction seam |
| `later-unplanned` | — | Later, unplanned | 3 | never | `ref:operator-trust §7` | — | high | ref:operator-trust §7 is the local-FIRST scope and the multi-user seams D193 refuses |

**The standard dash-node ref set.** Every `#### Dashboard · wire <workflow>` node repeats the same five
wire squares, so they repeat the same refs: `ref:frontend-backend-integration §5` (the matrix) · `ref:frontend-backend-integration §5.1` (critical flows, run modal,
queue row, run detail) · `ref:dashboard-surfaces §2.6` (notifications) · `ref:dashboard-surfaces §10.1` (activity / the one projection) ·
`ref:dashboard-surfaces §10.2` (archive) · `ref:operator-trust §5.9` (explorer field census). Per-workflow extras are listed per node above.
Ref frontend-backend-integration's rewrite agent should tag `ref:frontend-backend-integration §5` and `ref:frontend-backend-integration §5.1` with **every** `*-dash` id plus `dash-defaults`.

---

## 2 · Doc → nodes

**Reading a row.** The `node id(s)` cell is either one or more node ids — put a
`<!-- roadmap: <id> -->` tag on that section, one comment per id — or one of four classifications:

- **`FOUNDATION → phase-N`** — describes the platform as built with no tighter node than the phase
  itself. Tag it with the phase id.
- **`TO-BUILD`** — the section plans work the tree does not carry. **Do not invent a node.** Leave the
  section untagged and report it; §3(b) already carries the ones this pass found, with a suggested title
  and parent for the orchestrator to accept or reject.
- **`SUPERSEDED`** — narrative the as-built has overtaken. Candidate for
  `docs/rebuild/history/superseded/2026-08-20-<doc>-<section>.md` per plan ruling Q5. Nothing is deleted.
- **`REFERENCE`** — ownership headers, grounding, adversarial self-reviews, settled-question lists,
  port inventories. Stays where it is, untagged.

A section may be both a node's home and a phase's: prefer the tighter id. Where two nodes genuinely
share a section (`ref:frontend-backend-integration §5.1`), tag it with all of them.

### Ref charter — `reference/charter.md`

**Structure warning.** Ref charter has **no numbered headings** — the vision items every other doc cites as
"charter §12", "charter §22", "charter §25" are numbered items 1–27 in a bullet list under
`## Target architecture`, not headings. No `doc:` ref can resolve into ref charter today. See §3(c).

| section | node id(s) | why |
|---|---|---|
| `## Why we're rebuilding (evidence from the 2026-07-17 structural survey)` | REFERENCE | the survey that motivated the program |
| `## Target architecture (the operator's vision, formalized)` | FOUNDATION → `phase-0` | items 1–27 are the design Phase 0 ratified; the per-item mapping is §3(c)'s structure decision |
| `## Non-negotiables` | FOUNDATION → `phase-0` | fail-loud, no silent fallbacks — the standing rule, not a work item |
| `## One master plan (operator directive 2026-07-17)` | `phase-0` | the rule roadmap §Governance restates; the D263 one-plan decision lands beside it |
| `## Migration strategy` | `migrations` · `cutover` | one-at-a-time order, then one switch |
| `## Process` | REFERENCE | how the program is run |

### Ref task-contract — `reference/task-contract.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1b as-built domain foundation` | `p1-base` | 1b's delta |
| `## Phase 1d ratified seam decisions` | `p1-authority` | 1d |
| `### Phase 1d as-built — sealed task-contract core` | `p1-authority` | 1d |
| `### Phase 1d as-built — bounded task/store/session/provider/artifact seam` | `p1-authority` | 1d |
| `### Phase 1d as-built — the first `stores/common/` leaf` | `p1-authority` | 1d |
| `## 1. What today's code teaches us` | REFERENCE | legacy grounding |
| `## Phase 1f executor ratification` | `p1-kernel` | 1f |
| `## 2. The Task contract` | `p1-authority` | "BE task contracts (ref task-contract)" |
| `### 2.1 Core types` | `p1-authority` | same |
| `### 2.1.1 Strict schema and absence rules (D46)` | `p1-base` | the strict domain leaf |
| `### 2.2 The contract/impl split (D3)` | `p1-authority` | same |
| `### 2.3 The task ctx (narrow by construction)` | `p1-authority` | same |
| `### 2.4 Error taxonomy` | `p1-authority` | same |
| `### 2.5 Identity & naming scheme` | `p1-authority` | same |
| `### 2.6 The task boundary (D5)` | `p1-authority` | same |
| `### 2.7 The authoring floor — three declaration tiers (D79f)` | `p1-authority` | "the three authoring tiers" |
| `### 2.8 The rich-extraction convention (D194)` | `sep-1` · `sep-2` | ratified by chunk 1, applied by chunk 2 |
| `### 2.11 `ucpath/read-job-summary` (D201)` | `sep-3` | chunk 3's store |
| `### 2.9 `new-kronos` as-built (D196)` | `sep-1` · `order-6` | chunk 1's store; order 6 adds its write family |
| `### 2.10 `kuali` CUSTOMIZED (D197)` | `sep-2` | chunk 2's store |
| `### 2.12 `ucpath`'s termination family (D206)` | `sep-4` | chunk 4's two transactions |
| `## 3. Task stores per system plus pure workflow mini-stores` | `p1-authority` | the store model |
| `### 3.1 Layout in the rebuild repo's `src/`` | `p1-authority` · `order-1` · `order-2` | where `i9`/`sharepoint`/`old-kronos` will land |
| `### 3.2 `defineStore`` | `p1-authority` | one impl registry per namespace |
| `### 3.3 Porting selectors + knowledge` | `p1-authority` | the port rule; `ref:operator-trust §1.2` holds the registry |
| `### 3.4 Service stores (D4)` | `p2-2h` | extraction/ocr/roster/normalization homes |
| `### 3.5 Workflow mini-stores` | `p1-authority` · `sep-2` | the model, and separations' pure mini-store |
| `## 4. Customization / decoration model` | FOUNDATION → `phase-1` | standing contract, no slice node names it |
| `### 4.1 The invariant` | FOUNDATION → `phase-1` | same |
| `### 4.2 Where instrumentation attaches` | FOUNDATION → `phase-1` | same |
| `### 4.3 Why adding a task cannot break neighbors` | FOUNDATION → `phase-1` | same |
| `## 5. Composition — what the contract requires of the builder` | `p1-authority` | absorbed into ref:workflow-model §3's builder |
| `## 6. Auth and dry-run as contract concerns` | `p1-kernel` | login + dry-run mechanics |
| `### 6.1 Auth: store-provided, kernel-executed` | `p1-kernel` | 1f login wiring |
| `### 6.2 Dry-run: a graph composition, not a task flag` | `sep-6b` · `track-a` | D215's probing preview and the `would-prepare` arm |
| `## 7. Alternative shapes for the core contract` | SUPERSEDED | A/B/C decided long ago; B shipped |
| `### A. Class-based` | SUPERSEDED | rejected shape |
| `### B. Plain object + factories (recommended)` | SUPERSEDED | the chosen shape is normatively stated in §2.2 |
| `### C. Fluent builder` | SUPERSEDED | rejected shape |
| `## 8. Adversarial self-review — rot vectors and their guards` | REFERENCE | guard list; ref guards-and-tests owns the guards |
| `## 9. Worked example — three real tasks` | `order-0` | person-lookup's tasks |
| `### 9.1 `ucpath/search-person-org` (D16)` | `order-0` | the canonical example |
| `### 9.1.1 CRM Person Lookup reads (D108)` | `order-0` | the CRM half |
| `### 9.2 OnBase import` | `order-7` | onbase is order 7 |
| `### 9.3 Decorating (oath-signature's transaction audit shots)` | `order-4` | oath-signature is order 4 |
| `## 10. Settled design questions` | REFERENCE | closed list |

### Ref workflow-model — `reference/workflow-model.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1e ratified decisions` | `p1-authority` | 1e |
| `### Phase 1e as-built — the typed DAG builder` | `p1-authority` | 1e |
| `### Phase 1e as-built — canonical input and delegation` | `p1-authority` | 1e |
| `### Phase 1e as-built — descriptor assembly, completion, ingress, checkpoints` | `p1-authority` | 1e |
| `## Phase 1f ingress and terminal-result ratification` | `p1-kernel` | D109/D110/D114 |
| `## 0. Grounding — what exists today, why it hurts` | REFERENCE | legacy grounding |
| `## 1. The workflow descriptor` | `p1-authority` | the descriptor SSOT |
| `### 1.1 Shape` | `p1-authority` | same |
| `#### D260 — `inputRun` carries exactly ONE varying value per run` | `track-c` | the start-door ruling |
| `#### D261 — the action id is a GRAPH OUTPUT` | `track-c` | the start door, built |
| `### 1.1.1 The short code — ONE declaration, two consumers (D242)` | `track-b` | B4's queue row reads it |
| `### 1.2 The bundle crossing` | `p1-authority` · `track-d` | D106; Track D row D11 moves `WORKFLOW_DESCRIPTORS` out of the bundle |
| `#### 1.2.1 The module's role declaration (D219)` | `platform-fixes` | D219/D220 workflow roles |
| `### 1.3 Every parallel registry becomes a projection` | `p1-kernel` | the ONE `WORKFLOW_MODULES` root |
| `### 1.4 The ONE coverage guard` | `p1-authority` | `descriptor-coverage`; hosted at ref:guards-and-tests §4 |
| `### 1.5 Labels — exactly two layers (D16)` | `p1-authority` | label precedence |
| `## 2. Workflow-constant input + the RunEnvelope` | `p1-kernel` | the envelope, ingress authority |
| `### 2.1 How a previewed run ENDS (D210)` | `sep-6c` | the preview terminal |
| `## 3. The ONE builder API` | `p1-authority` · `sep-6a` | the builder; the 18-node composition proves it |
| `### 3.1 Task-authoring rule — navigation ownership` | `p1-authority` | authoring rule |
| `### 3.2 Delegation contract` | `order-4` · `order-5` | fan-out arrives at order 4/5 |
| `### 3.3 A node's `when` is a DECLARED condition (D228)` | `track-b` | B6 renders it in words |
| `## 4. The run-state machine (gates are run-state — D5)` | `p1-kernel` · `platform-fixes` | the machine; D221's item-scoped attempt |
| `## 5. Start-anywhere resumability` | `p1-authority` | the resume model |
| `### 5.1 The tension, stated precisely` | REFERENCE | framing |
| `### 5.2 Mechanisms compared (honestly)` | SUPERSEDED | the comparison is settled by §5.3 |
| `### 5.3 Recommendation: checkpoint replay with explicit per-node policy` | `p1-authority` | the chosen model |
| `### 5.4 Exact failure behavior` | `p1-kernel` | validating-phase aggregation |
| `### 5.5 Checkpoint freshness (D8)` | `sep-3` · `p1-authority` | the walk; D203 taught it to read a gate row |
| `### 5.6 The four scenarios` | `p1-authority` | resume scope |
| `### 5.7 The checkpoint store — and resume scope (D9)` | `sep-6b` · `p1-authority` | D214's `claimGeneration` key |
| `## 6. Trace + spans — what this doc owns (D10)` | FOUNDATION → `phase-1` | pointer to ref dashboard-surfaces's schema |
| `## 7. Adversarial self-review` | REFERENCE | guard list |
| `## 8. Worked example — person-lookup` | `order-0` · `p1-exit` | the Phase-1 exit slice |
| `### 8.1 AS-BUILT — the worked example is the shipped workflow` | `order-0` · `p1-exit` | the five deltas the live run forced |
| `## 9. Open questions for the operator / orchestrator` | `operator-calls` | if any remain open; otherwise REFERENCE — the rewrite agent decides per item |

### Ref dashboard-surfaces — `reference/dashboard-surfaces.md`

The largest doc (109 sections) and the one whose structure diverges most from the tree — see §3(c).

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1c Stage A as-built contract delta` | `p1-authority` | 1c |
| `## Phase 1c Stage B as-built storage delta` | `p1-authority` | 1c |
| `## Phase 1c Stage C as-built recovery delta` | `p1-authority` | 1c |
| `## Phase 1c Stage D as-built authority-write delta` | `p1-authority` | 1c |
| `## Phase 1f authority and command ratification` | `p1-kernel` | 1f |
| `## Phase 1g/1i-spine as-built presentation deltas` | `p1-spine` · `p1-exit` | D123/D124/D126 |
| `## Queue-row projection as-built delta (2026-08-14)` | `track-b` | B4's parent block |
| `### The second batch: ordinal, class, links and outcome` | `track-b` | B4 |
| `### Drawing the second batch: the rehearsal hue and the rename control` | `track-b` | B4 |
| `### The per-row action descriptors` | `track-b` | B4 |
| `### The row title is the SUBJECT, and `displayName` is served beside it` | `track-b` | B4 |
| `### D225 — the run-detail timeline is CATEGORICAL` | `sep-dash` · `dash-defaults` | the wire square "run detail" |
| `#### D259 — a REPLAYED step is its own arm` | `track-c` | a Track C same-day fix |
| `### D234 — the queue's model is runs and archived runs` | `track-b` | B4 |
| `### D235 — a bulk command is N children and one vector` | `track-b` | B4's bulk strip |
| `### D238 — a rehearsal's terminal outcome is never `verified-done`` | `track-b` | B2 |
| `## Wave-2 connection-proof presentation deltas (2026-08-20)` | `track-c` | the Track C block |
| `### A live elapsed TICKS (D256)` | `track-c` | same-day fix 1 |
| `### The open run-detail panel FOLLOWS its run (D257)` | `track-c` | same-day fix 2 |
| `### The shape hazard compares a run against ITS OWN workflow's served shape` | `track-c` | same-day fix 3 |
| `## 0. What exists today (and what specifically hurts)` | REFERENCE | legacy grounding |
| `## 1. The span event model` | `p1-spine` | span emission |
| `### 1.1 Primitives` | `p1-spine` | the wire union |
| `#### D254 — the `span.patched` detail channel is RETIRED` | `track-b` | B8 |
| `### 1.2 What each of today's surfaces becomes (all are projections)` | `p1-spine` · `dash-defaults` | the projection model |
| `### 1.3 Decision: archetypes survive as vocabulary, die as per-row stamps` | REFERENCE | closed decision |
| `## 2. Storage and transport` | `p1-authority` | storage layout |
| `### 2.1 On disk — JSONL-per-day stays, two streams` | `p1-spine` · `def-retention` | the two streams and their 30-day floors |
| `### 2.2 Projections are computed server-side` | `p1-spine` | the wire carries surfaces |
| `### 2.3 SQLite (role per D14)` | `p1-authority` | the authority role |
| `#### D218 — the projector consumes the span stream FROM DISK` | `platform-fixes` | D218 |
| `#### D255 — a `span.ended` binds to an OPEN entry` | `track-b` | B8 |
| `#### D258 — the timeline event id carries the OCCURRENCE ordinal` | `track-c` | Track C |
| `### 2.4 One command protocol with strict target families` | `p1-kernel` · `def-settings` | the command kernel; `apply-settings` is a future family |
| `### 2.5 Non-rebuildable SQLite recovery contract` | `p1-authority` · `p2-2j` | the interlock, then the drill |
| `#### D181 — the restore command, and the process locks` | `p2-2j` | 2j's first defect |
| `### 2.6 Durable single-operator notifications` | `p2-2g` · `platform-fixes` · every `*-dash` node | the inbox; D222 moved the backup hazard into it; every wire set's notifications square |
| `## 3. Descriptor fields this layer consumes` | `p1-authority` | the consumed shape |
| `### 3.1 Read from ref workflow-model's descriptor` | `p1-authority` | same |
| `### 3.2 Contributed by this doc, adopted into ref workflow-model's descriptor` | `p1-authority` | same |
| `## Phase 1e as-built completion + delegation-manifest delta` | `p1-authority` | 1e |
| `## 4. Unified completion contract` | `order-4` · `order-5` | fan-out/approval arrives at orders 4–5 |
| `### 4.1 The typed staged completion program` | `order-4` | same |
| `### 4.2 Cross-spec borrowing becomes impossible` | `order-4` | same |
| `### 4.3 Intent-derived child shape and stage consumption` | `order-4` | same |
| `### 4.4 Durability: the approval manifest` | `order-4` | same |
| `### 4.5 oath-upload — owner-consumes via a sibling born-at-upload task` | `order-7` | oath-upload is order 7 |
| `### 4.6 verify — in-run enrichment, not completion` | `order-4` | same |
| `## 5. Cross-repo runtime boundary and one cutover` | `cutover` · `p1-base` | isolation now, the switch later |
| `### 5.1 The seam: one direction, one place` | `cutover` | the seam |
| `### 5.2 The mapping — from the kernel terminal contract (D12)` | `cutover` | the lift adapter |
| `### 5.3 Source authority — immutable per run` | `cutover` | same |
| `### 5.4 The flip is SCOPED (D13), then per-workflow migration` | `cutover` · `migrations` | the flip's scope |
| `## 6. Adversarial self-review` | REFERENCE | guard list |
| `## 7. Worked example — operation coordinator flow, end to end in spans` | `order-5` | the I-9 operation |
| `## 8. Settled design questions and one volume monitor` | REFERENCE | resolved; the volume item is a monitor, not work |
| `## 9. Ratified delegation and presentation decisions (D6–D24)` | `dash-defaults` | the row model every surface inherits |
| `### Row-model D5 — a settled group collapses shut` | `order-4` | group rows |
| `### D6 — oath-upload's signers are `linked`, not `member`` | `order-7` | oath-upload |
| `### D7 — a packet still at OCR review shows its extracted count` | `order-3-dash` | OCR review row |
| `### D8 — record approval exists only after Review` | `order-3-dash` | OCR review |
| `### D9 — rejected members never count toward done` | `order-4-dash` | group counting |
| `### D10 — depth-2 delegated lookups visible only from the OCR review row` | `order-3-dash` | OCR review |
| `### D11 — one member presentation at every count` | `order-4-dash` | Group People |
| `### D12 — the collapsed row shows the gate's age` | `operator-calls` | open: D12 vs the operator's later direction |
| `### D13 — a failed `linked` child makes the parent `Failed`` | `order-7-dash` | linked children |
| `### D14 — a group of one still renders as a Group Row` | `order-4-dash` | Group People |
| `### D15 — Person Lookup carries Search and Match as modes` | `order-1` | order 1's first build line |
| `### D16 — cancelling a group is tree-scoped, final` | `order-4-dash` | group actions |
| `### D17 — per-member confirmation numbers inline on the packet receipt` | `order-5-dash` | packet receipt |
| `### D18 — Status Bar pills` | `p1-spine` · `dash-defaults` | shipped in 1i-spine |
| `### D19 — run-detail tabs derive from panel kind` | `dash-defaults` · `track-b` | the panel model; B7's rail |
| `### D20 — `Write parked` means an unknown write outcome` | `p2-proof` | the parked-write vocabulary |
| `### D21 — every step segment is the same width` | `dash-defaults` | timeline drawing |
| `### D22 — the status vocabulary shortens` | `dash-defaults` · `track-b` | B2 amended it (`rehearsal`) |
| `### D23 — the motion rule is narrowed on purpose` | `dash-defaults` | motion |
| `### D24 — a professional dashboard does not explain itself` | `dash-defaults` | tone |
| `### Shell and layout as rebuilt` | `p1-spine` | the shell 1i-spine shipped |
| `## 10. Round-8 obligations this doc owns` | `p2-2i` | the 2i tail's obligations |
| `### 10.1 ONE projection owns every count (D81)` | `p1-spine` · every `*-dash` node | the activity square reads it |
| `#### D236 — the write-ledger carve-out` | `track-b` · `sep-dash` | B4/the activity wire |
| `### 10.2 Versioning and archive-on-version-bump (D80)` | `p2-2i` · every `*-dash` node | the archive square |
| `#### D179 — the archive model as-built` | `p2-2i` | 2i-G |
| `#### D223 as-built — frozen sections, Export, the change record` | `track-b` | B5 |
| `### 10.3 Operator-assigned run display names (D83)` | `track-b` | B4's rename control |
| `### 10.4 Notification model (D79b + D86)` | `p2-2g` | the model behind §2.6 |
| `## 11. The intake workspace — the surface contract (2i-E3, D173)` | `p2-2i` · `order-6-dash` | built in 2i; order 6 adds the constants entry |
| `### 11.1 Proposed against decided is a PLACE, not a colour` | `p2-2i` | 2i-E |
| `### 11.2 The grid's rows are the WORKFLOW's fields` | `p2-2i` | 2i-E |
| `### 11.3 It is a workspace at `?intake=<sessionId>`` | `p2-2i` | 2i-E |
| `### 11.4 Readiness is DERIVED for courtesy and JUDGED by the kernel` | `p2-2i` | 2i-E |
| `### 11.5 The destructive act names its cost` | `p2-2i` | 2i-E |
| `### 11.6 Which control is in flight` | `p2-2i` | 2i-E |
| `### 11.7 As-built notes` | `p2-2i` | 2i-E |
| `## 12. The capture phone surface (2i-F, D175)` | `p2-2i` · `def-byte-path` | built, but has no delivery path (D189) |
| `### 12.1 The use scene picks the theme` | `p2-2i` | 2i-F |
| `### 12.2 It is ONE page whose bottom bar changes verb` | `p2-2i` | 2i-F |
| `### 12.3 Order is meaning` | `p2-2i` | 2i-F |
| `### 12.4 The camera is the platform's, not ours` | `p2-2i` | 2i-F |
| `### 12.5 A failure is the server's own sentence` | `p2-2i` | 2i-F |
| `### 12.6 The QR is the operator's half, and the token exists once` | `p2-2i` · `def-byte-path` | the QR needs the ingress D189 defers |
| `### 12.7 As-built notes` | `p2-2i` | 2i-F |
| `## 13. The two reference takeovers (2i-G, D176/D177)` | `p2-2i` | explorer + catalog |
| `### 13.1 A read-only explorer must not look like an editor` | `p2-2i` · `def-explorer-edit` | the read-only stance and what edit would cost |
| `### 13.2 A structure rail beside a record column` | `p2-2i` | 2i-G |
| `### 13.3 One saturated mark, spent on consequence` | `p2-2i` | 2i-G |
| `### 13.4 They are takeovers, and precedence is resolved in one place` | `p2-2i` | 2i-G |
| `### 13.5 As-built notes` | `p2-2i` | 2i-G |

### Ref execution-and-sessions — `reference/execution-and-sessions.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1d session seam ratification` | `p1-authority` | 1d |
| `## Phase 1f worker-session runtime` | `p1-kernel` | 1f |
| `## Phase 1f concrete session factory` | `p1-kernel` | 1f |
| `## Session acquisition is bounded separately from the task (D125)` | `p1-exit` | the open item the live run left |
| `## 0. Settled decision` | REFERENCE | the one-item-worker decision |
| `## 1. Units, named precisely` | FOUNDATION → `phase-1` | vocabulary |
| `## 2. Workflow session contract` | `p1-kernel` | worker-owned sessions |
| `### 2.1 Gates and parks` | `p1-kernel` | park semantics |
| `## 3. Worker lifecycle and claiming` | `p1-kernel` | claim/heartbeat/CAS |
| `### 3.0 A worker sweeps its OWN id before its first claim (D200)` | `p1-kernel` | D200 |
| `### 3.1 Dispatch and fairness` | `p1-kernel` | dispatch |
| `## 4. Browser-session behavior` | `p1-kernel` | session lifecycle |
| `### 4.1 Authentication is a content-level observation, never a URL (D120)` | `p1-kernel` | D120 |
| `## 5. Speed engineering` | FOUNDATION → `phase-1` | as-built at zero fixed sleep after the exit run; a monitor, not work |
| `### 4.2 A refused Duo ceremony is an OBSERVATION (D243)` | `platform-fixes` | D243/D244 |
| `## 6. Failure isolation` | `p1-kernel` | isolation invariant |
| `### 6.1 Page/subject-isolation invariant` | `p1-kernel` | same |
| `### 6.2 Failure matrix` | `p1-kernel` | same |
| `## 7. Mechanical guards` | REFERENCE | guard list; ref guards-and-tests owns them |
| `### 7.1 The 2j concurrency matrix — executed (D182)` | `p2-2j` | the soak |
| `## 8. Worked example — 10-person I-9 Check` | `order-5` | i9-check |
| `## 9. Settled defaults` | REFERENCE | closed list |

**Ordering note for the ref execution-and-sessions agent.** `### 4.2` sits AFTER `## 5.` in the file; `### 3.0` sits after
`## 3.`'s intro but is numbered below `### 3.1`. Fix the order in the rewrite — it is a pure move.

### Ref data-intake-and-edit-data — `reference/data-intake-and-edit-data.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## 0. What today does, and what specifically hurts` | REFERENCE | legacy grounding |
| `## 1. Canonical field registry` | `p2-2h` · `order-6` | the registry; order 6's canonical-EID audit replays through it |
| `### 1.1 Phase-2h as-built — frozen against a recorded scan (D146)` | `p2-2h` | 2h |
| `## 2. Operator-defined column mapping` | `p2-2h` | 2h |
| `### 2.1 The mapping object (zod-typed)` | `p2-2h` | 2h |
| `### 2.2 The UI flow (upload → map → validate → run)` | `p2-2i` | shipped as the intake surface |
| `### 2.3 Per-source persistence — header fingerprint` | `p2-2h` | 2h |
| `### 2.4 Per-field coercion + loud per-cell errors` | `p2-2h` | 2h |
| `### 2.5 Fuzzy header auto-match — SUGGESTIONS only` | `p2-2h` | 2h |
| `### 2.6 Phase-2h as-built — projection, mapping and suggestions (D147)` | `p2-2h` | 2h |
| `### 2.7 Phase-2i as-built — the durable session, the parser seam (D170)` | `p2-2i` | 2i-E |
| `### 2.8 Phase-2i as-built — the first real projection, and unions resolve (D172)` | `p2-2i` · `order-6-dash` | D172/D173's constants entry is order 6's wire square |
| `## 3. Extraction store tasks (service store — D4)` | `p2-2h` · `order-3` | the store; the OCR workflow consumes it |
| `### 3.1 Phase-2h as-built — `extraction/extract-spreadsheet` (D149)` | `p2-2h` | 2h |
| `### 3.2 Phase-2h as-built — `extraction/extract-pdf-pages` (D152)` | `p2-2h` | 2h |
| `## 4. Roster store tasks (service store — D4)` | `p2-2h` · `order-9` | roster ingest is order 9 |
| `### 4.1 Mutable retention workbooks are serialized projections` | `order-5` · `def-search-export` | the master I-9 workbook is order 5's build line |
| `### 4.2 Contact/address normalization is typed advice` | `p2-2h` | 2h |
| `### 4.3 Phase-2h as-built — OCR admits three producers identically (D151)` | `p2-2h` · `order-3-dash` | the review UI pairs against these |
| `### 4.4 Phase-2h as-built — the forms are legacy's, and reading them found two gaps (D153)` | `p2-2h` | 2h |
| `### 4.10 Phase-2h as-built — the i9 is ONE form across two loose sections (D160)` | `p2-2h` · `order-5` | i9-check consumes it |
| `### 4.11 Phase-2h as-built — route 1's production adapter (D161)` | `p2-2h` | 2h |
| `### 4.9 Phase-2h as-built — authority schema v11 (D159)` | `p2-2h` | 2h |
| `### 4.8 Phase-2h as-built — stages 1 and 2 of the scanner pipeline (D158)` | `p2-2h` | 2h |
| `### 4.7 Grouping cannot assume adjacency (D157)` | `p2-2h` | 2h |
| `### 4.6 Phase-2h as-built — a two-digit year is resolved, not refused (D155)` | `p2-2h` | 2h |
| `### 4.5 Phase-2h as-built — measured against the real corpus (D154)` | `p2-2h` | 2h |
| `## 5. Intake pipeline: mapped dataset → N inputs` | `p2-2h` | 2h |
| `### 5.0 Phase-2h as-built — validation, rejection and the manifest (D148)` | `p2-2h` | 2h |
| `### 5.2 Phase-2i as-built — the enqueue: readiness, manifest mint, fan-out (D171)` | `p2-2i` | 2i-E |
| `### 5.1 Mobile photo capture is a recoverable artifact-intake source` | `p2-2i` · `def-capture-binding` | built; `CAPTURE_INTAKE_BINDINGS` is deliberately empty |
| `## 6. The Edit-Data surface (charter §12)` | `p2-2h` · `p2-2i` | the core in 2h, the rail in 2i-C |
| `### 6.1 Data source — fetch the snapshot, SSE signals staleness` | `p2-2i` | 2i-C |
| `### 6.2 What is editable vs read-only` | `p2-2i` | 2i-C |
| `### 6.3 Editing = typed field patches` | `p2-2i` | 2i-C |
| `### 6.4 Concurrency — edit-during-resume is fail-closed` | `p2-2i` | 2i-C |
| `#### 6.4.1 As-built — the rail wiring (2i-C, D168)` | `p2-2i` · `track-b` | 2i-C; B7/D253 corrected its CAS-conflict arm |
| `## 7. Adversarial self-review — silent-fallback vectors` | REFERENCE | guard list |
| `## 8. Worked example — a work-study spreadsheet, end to end` | `order-6` | work-study is order 6 |
| `## 9. Settled intake defaults` | REFERENCE | closed list |

**Ordering note for the ref data-intake-and-edit-data agent.** §4's subsections run 4.1, 4.2, 4.3, 4.4, 4.10, 4.11, 4.9, 4.8,
4.7, 4.6, 4.5 and §5's run 5.0, 5.2, 5.1. Reordering is a pure move; do it in the rewrite.

### Doc 07 — `07-master-plan.md` (DISSOLVED 2026-08-20 into the phase docs; see `docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`)

The phase docs stay normative over the tree (plan ruling Q3). This block was written before 07 dissolved:
every phase node's `doc:` cited `07 §2` plus its
`### Phase N` block in §3, so those four blocks each carry a phase tag.

| section | node id(s) | why |
|---|---|---|
| `## 0. Program overview + governance` | `phase-0` | the governance Phase 0 ratified |
| `### 0.1 The one-plan rule` | `phase-0` | D263's owner (plan step 2) |
| `### 0.2 D1 ownership map` | `phase-0` | "each doc owning its contracts" |
| `### 0.3 Standing rule — each completed phase documents itself` | `p2-2j` | 2j's "every owning doc to as-built" |
| `## 1. Dependency graph of the base` | `phase-1` | the graph the SPINE is a cut of |
| `## 2. Phase table (at a glance)` | `phase-0` · `phase-1` · `phase-2` · `phase-3` · `migrations` · `cutover` | the table every phase node cites |
| `## 3. Phased plan (detail)` | `phase-0` · `phase-1` · `phase-2` · `phase-3` | the parent of the four phase blocks |
| `### Phase 0 — foundation design` | `phase-0` | the phase |
| `### Phase 1 — the SPINE (D74)` | `phase-1` · `p1-base` · `p1-authority` · `p1-kernel` · `p1-spine` · `p1-exit` | the ordered work-item table IS the five slice nodes |
| `### Phase 2 — the transaction proof, then the deferred base tails` | `phase-2` · `p2-proof` · `p2-2g` · `p2-2h` · `p2-2i` · `p2-2j` | same shape |
| `### Phase 3+ — per-workflow migration` | `phase-3` · `migrations` | the migration phase |
| `#### 3.1 Migration loop (per workflow)` | `phase-3` · `order-8` · `migrations` | the loop each order node runs |
| `#### 3.2 Exit criteria (per workflow)` | `order-8` · `track-a` | what "rebuild-ready" means |
| `#### 3.3 Recommended migration order` | `migrations` · every `order-*` node | the source the tree's order derives from |
| `#### 3.4 The §b migration questionnaire` | `order-8` | the template `separations.md §5` answers |
| `#### 3.5 Where the data systems slot` | `migrations` · `order-2` | sharepoint/old-kronos |
| `#### 3.6 Non-workflow capability closure inventory (D58)` | `cross-cutting` · `p2-2j` · `operator-calls` · `cutover` | the register the cutover gate reads |
| `### 3.7 Size model and delivery tiers (D76)` | `phase0-size-model` · `deferred` | MUST/SHOULD/LATER |
| `### 3.8 Live probe status` | `def-propagation` · `order-7` | the unproven probes |
| `## 4. Two-repo coexistence and all-at-once cutover (D88–D94)` | `cutover` · `rollback-window` · `phase-0` | the model, ratified in Phase 0 |
| `## 5. Risk register (top sequencing risks)` | `deferred` | REFERENCE if the rewrite agent finds no live risk row |
| `### 5.1 Program stop-loss / abort gate` | REFERENCE | a standing gate, not a work item |
| `## 6. Definition of done (whole program)` | `cutover` | the cutover node's `needs:` cites it |
| `## 7. Frontend/backend integration amendment` | `dash-defaults` | ref frontend-backend-integration's reconciliation into this plan |
| `### 7.1 Reconciled phase boundaries` | `p1-spine` · `p2-2i` | the 1g/1i/2i split |
| `### 7.2 Required additions to existing work items` | `p1-spine` · `p2-2i` | same |
| `### 7.3 Integration execution rule` | `dash-defaults` | the WIRE discipline every `*-dash` node follows |
| `### 7.4 Added program-wide exit criteria` | `cutover` · `track-d` | Track D takes §7.4's first measurements |

**New section the plan owes doc 05 / ref foundation-gap-audit.** Plan step 4 sends `docs/roadmap/roadmap.md`'s Appendix B (legacy vs
rebuild) to `reference/foundation-gap-audit.md` **or** 05 §Phase summary as a dated section, and Appendix C (verify
commands) to `CLAUDE.md` / 05 §Exit criteria. Step 4 is a different unit — the phase-doc rewrite agent must not
pre-empt it, only avoid colliding with it.

### Ref foundation-gap-audit — `reference/foundation-gap-audit.md`

Ref foundation-gap-audit **owns nothing** (roadmap §Governance: "cross-cutting gap findings memo — a design input"). All three of its
top gaps closed in Phase 1. See §3(c) for the structure choice this forces.

| section | node id(s) | why |
|---|---|---|
| `## 2026-07-21 closure / amendment matrix` | REFERENCE | dated audit history |
| `## 2026-07-22 second closure matrix` | REFERENCE | dated audit history |
| `## 2026-07-22 final closure matrix` | REFERENCE | dated audit history |
| `## 2026-07-22 executable-validation closure matrix` | REFERENCE | dated audit history |
| `## 0. Method and the one-sentence thesis` | REFERENCE | method |
| `## 1. Ranked gap table` | REFERENCE | the finding, closed |
| `## 2. TOP GAP 1 — Write-Safety Contract` | SUPERSEDED | ref write-safety owns it and is as-built |
| `### 2.1 What exists today (the port inventory)` | SUPERSEDED | superseded by ref:write-safety §10 |
| `### 2.2 The contract addition` | SUPERSEDED | superseded by ref:write-safety §2.1 |
| `### 2.3 Kernel execution` | SUPERSEDED | superseded by ref:write-safety §3 |
| `### 2.4 Composition with the existing docs` | SUPERSEDED | superseded by ref:write-safety §9 |
| `### 2.5 The guard (fail-loud, ratchet)` | SUPERSEDED | superseded by ref:guards-and-tests §3.3 |
| `### 2.6 Port inventory` | SUPERSEDED | superseded by ref:write-safety §10 |
| `## 3. TOP GAP 2 — Guard & Test Architecture SSOT` | SUPERSEDED | ref guards-and-tests owns it |
| `### 3.1 What exists today (the port inventory)` | SUPERSEDED | superseded by ref:guards-and-tests §1 |
| `### 3.2 The two guards that must exist and don't` | SUPERSEDED | both exist (ref:guards-and-tests §3) |
| `### 3.3 What replaces the ~10 coverage guards` | SUPERSEDED | superseded by ref:guards-and-tests §4 |
| `### 3.4 The TDD topology` | SUPERSEDED | superseded by ref:guards-and-tests §6 |
| `### 3.5 Ownership + guard against my own proposal` | SUPERSEDED | superseded by ref:guards-and-tests §5 |
| `## 4. TOP GAP 3 — The Clock (and Config/Secrets)` | SUPERSEDED | ref clock-config-secrets owns it |
| `### 4.1 What exists today` | SUPERSEDED | superseded by ref:clock-config-secrets §1 |
| `### 4.2 The design` | SUPERSEDED | superseded by ref:clock-config-secrets §2/§3/§6 |
| `### 4.3 Guard + adversarial self-review` | SUPERSEDED | superseded by ref:clock-config-secrets §7 |
| `## 5. PARTIALs — what a doc claims to own but under-specifies` | REFERENCE | the audit's residual list; re-check each item is closed |
| `## 6. Adversarial self-review of my own proposals` | REFERENCE | method |
| `## 7. Open questions for the operator / orchestrator` | `operator-calls` | if any remain open; otherwise REFERENCE |

### Ref write-safety — `reference/write-safety.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1c Stage A as-built contract delta` | `p1-authority` | 1c |
| `## Phase 1c Stage D as-built authority-write delta` | `p1-authority` | 1c |
| `## Phase 1f write-sequencer ratification` | `p1-kernel` | 1f |
| `## Phase 2 transaction-proof as-built — the DRY-RUN half (D122)` | `p2-proof` | the dry-run half |
| `## Phase 2 controlled-commit as-built — COMPLETE (D135)` | `p2-proof` | the commit half |
| `### What the documents are (confirmed read-only before any write)` | `p2-proof` | same |
| `### Why the step-ownership diagnosis was wrong` | `p2-proof` | D128 withdrawn |
| `### Defect 1 — a Kuali text gadget DEBOUNCES` | `p2-proof` | same |
| `### Defect 2 — `commit` returned at REQUEST time` | `p2-proof` | same |
| `### Measured numbers` | `p2-proof` | same |
| `### The controlled commit, and the durable rows it left` | `p2-proof` | same |
| `### The parked intent from the failed attempt, and a drift finding` | `p2-proof` | same |
| `### Exit-criteria status` | `p2-proof` · `phase-2` | the phase gate |
| `### Two defects this lane found outside the write path (D129 · D133)` | `p2-proof` | same |
| `### ~~What is required before this criterion can be met~~ — MET` | SUPERSEDED | struck through and answered by D135 |
| `## 0. Grounding — what exists today (the port inventory)` | REFERENCE | legacy grounding |
| `## 1. The one-sentence thesis + the fail-closed guarantee boundary` | FOUNDATION → `phase-1` | the standing guarantee |
| `## 2. The write-safety contract` | `p1-authority` | the contract shell landed in 1c |
| `### 2.1 The `WriteSafety` field` | `p2-proof` | the first real commit contract instantiates it |
| `### 2.2 Per-system instantiation (three shapes, one mechanism)` | `sep-5` · `order-6` · `order-7` | Kuali, Kronos/PayPath, ServiceNow/OnBase |
| `## 3. The kernel write sequence` | `p1-kernel` · `p2-proof` · `track-a` | the sequencer; the beats each controlled commit proves |
| `### 3.1 Beat ⑦'s checkpoint IS terminal evidence (D144)` | `p2-2g` | the receipt's derivation depends on it |
| `## 4. Crash-window recovery` | `p1-kernel` · `def-propagation` | recovery; the windows are still ported |
| `### 4.1 Parked-write resolution is typed and intent-scoped` | `p1-kernel` · `p2-proof` | the park arms the proof exercised |
| `### 4.2 A measured propagation window transfers with the MECHANISM (D207)` | `sep-5` · `track-a` · `def-propagation` | D207's 30 s Kuali window is a Track A build line |
| `## 5. Double-submit prevention` | `p1-authority` · `sep-4` · `order-9` | the permanent key; the pending sweep; the no-EID hire probe |
| `## 6. The immutable receipt / transaction ledger` | `p2-2g` | the ledger |
| `### 6.1 Phase-2g as-built — the projector exists (D134)` | `p2-2g` | 2g |
| `## 7. Fail-closed everywhere` | FOUNDATION → `phase-1` | the standing rule |
| `## 8. Mechanical guards` | REFERENCE | guard list; ref guards-and-tests owns them |
| `## 9. Composition with the existing docs` | REFERENCE | cross-doc pointer |
| `## 10. Port inventory` | REFERENCE | port record |
| `## 11. Adversarial self-review` | REFERENCE | rot vectors |
| `## 12. Worked example — a separations termination, with a crash` | `order-8` · `sep-6a` | the composition is the worked example, built |
| `## 13. Open questions for the operator / orchestrator` | `operator-calls` | if any remain open; otherwise REFERENCE |
| `## 14. The identity-approval gate — the wrong-PERSON control` | `phase0-always-gate` · `sep-3` | designed in Phase 0, built at chunk 3 |
| `### 14.1 Why this section exists at all` | `phase0-always-gate` | the incident |
| `### 14.2 What ports, and what deliberately changes` | `phase0-always-gate` · `sep-3` | the packet |
| `### 14.3 Where the gate sits in the graph` | `sep-3` · `sep-6a` | the gate node |
| `### 14.4 The resolver — what the operator is actually asked` | `sep-3` | the resolver |
| `### 14.5 Staleness — an approval is an observation` | `sep-3` · `sep-6a` | the digest binding |
| `### 14.6 Adversarial self-review — how this control rots` | REFERENCE | rot vectors |
| `### 14.7 Open question deliberately left to migration` | `order-8` | answered at the migration |
| `### 14.9 As-built — the gate is BUILT (D202)` | `sep-3` | chunk 3 |
| `### 14.10 The packet carries the WRITE PLAN (D211)` | `sep-6a` | chunk 6a |
| `### 14.11 As-built — the THREE CEREMONIES exist (D226)` | `track-b` · `sep-dash` · every `*-dash` node with a gate | B1 |
| `### 14.8 Scope — the Kuali timekeeper-annotation workflow takes NO gate (D127)` | `p2-proof` | the proving workflow's scope |

**Ordering note for the ref write-safety agent.** §14's subsections run 14.1–14.7, 14.9, 14.10, 14.11, 14.8.
Reordering is a pure move.

### Ref guards-and-tests — `reference/guards-and-tests.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership header (D1)` | REFERENCE | ownership header |
| `## Phase 1b as-built guard delta` | `p1-base` | 1b |
| `## Phase 1c Stage A as-built guard delta` | `p1-authority` | 1c |
| `## Phase 1c Stage B as-built guard delta` | `p1-authority` | 1c |
| `## Phase 1c Stage C as-built guard delta` | `p1-authority` | 1c |
| `## Phase 1c Stage D as-built guard delta` | `p1-authority` | 1c |
| `## Phase 1d guard-activation boundary` | `p1-authority` | 1d |
| `### Phase 1d Stage A as-built — selector provenance snapshot` | `p1-authority` | 1d |
| `### Phase 1d Stage B as-built — semantic registry + typed driver seed` | `p1-authority` | 1d |
| `### Phase 1d Stage C as-built — sealed task contracts and contexts` | `p1-authority` | 1d |
| `### Phase 1d Stage D as-built — bounded stores, sessions, providers, artifacts` | `p1-authority` | 1d |
| `## Phase 1f guard-activation boundary` | `p1-kernel` | 1f |
| `## 1. The suite today — what the rebuild repo inherits` | REFERENCE | inherited inventory |
| `### 1.1 Measured pre-rebuild gate baseline` | `p1-base` | 1a's honest baselines |
| `## 2. Ratchet port map` | `p1-base` | the guard plumbing |
| `#### The driver half of `inline-selectors` — a scope decision` | `p1-authority` | 1d's driver boundary |
| `## 3. The NEW safety guards` | `p1-authority` | the safety core |
| `### 3.1 `dry-run-composition-submit-free`` | `p1-authority` · `p2-proof` | charter §1a as a static invariant |
| `### 3.2 `transaction-pairing`` | `p1-authority` | prepare/commit one lease |
| `### 3.3 `write-safety-contract` (HOSTS ref write-safety's guard)` | `p1-kernel` · `p2-proof` | the sequencer's guard |
| `### 3.4 `no-positional-identity`` | `p1-authority` | stable ids |
| `### 3.5 `unverifiableByPage` requires an allowlist + reason (D22)` | `order-7` | OnBase OQ2's escape hatch |
| `### 3.6 `commit-routes-through-mutation` (D22)` | `p2-proof` | the mint boundary |
| `### 3.7 `artifact-effect-boundary`` | `p2-2h` · `order-2` | downloads are immutable |
| `### 3.8 Strict schemas + semantic driver/UI registry` | `p1-base` · `p1-authority` | the strict leaf and the registry |
| `### 3.9 Subject binding, control commands, and delegation` | `p1-kernel` · `order-4` | subject binding now, delegation at order 4 |
| `### 3.10 Trust surfaces: storage recovery, scenarios, evidence, notifications` | `p2-2g` · `p2-2j` | the trust tail's guards |
| `### 3.11 Old-capability closure, mobile capture, and advisory AI` | `p2-2i` · `cross-cutting` · `def-sanity-check` | the capability register |
| `#### 3.11 as-built — the capability-closure sweep (D184)` | `p2-2j` · `operator-calls` | 2j's re-disposition; D192 is still open |
| `### 3.13 Round-8 guards — the decisions that need mechanical teeth` | `dash-defaults` · `p1-spine` | the D6–D24 row model's teeth |
| `### 3.14 Testing standard (D85) — what replaces the e2e ritual` | `p2-2j` | the scenario corpus standard |
| `#### D190 — the safety-critical coverage floor as-built` | `p2-2j` | 2j |
| `#### D191 — `test:coverage` becomes the per-commit gate` | `phase-3` | adopted at Phase 3 entry (the `## flag:` marker names it; markers take no tag) |
| `### 3.12 D71 executable contract/type-budget suite` | `p1-authority` | 1e's type-inference proof |
| `### 3.15 `redaction-surface-scan` (D183, 2j)` | `p2-2j` | 2j |
| `## 4. `descriptor-coverage` — the ONE rebuild guard` | `p1-authority` | the crosswalk |
| `## 5. The guard-of-guards manifest` | `p1-base` | `guard-inventory.json` |
| `### 5.1 The full registered set` | `p1-base` | the registry; the step-3 binding guard adds a row here |
| `## 6. TDD topology for the rebuild repo — four tiers` | FOUNDATION → `phase-1` | the standing topology |
| `## 7. Stub + live lanes on the new kernel` | TO-BUILD | the derived stub lane (`example`-driven, descriptor-projected) is a migration plan; the live lane exists. See §3(b) |
| `## 8. Adversarial self-review — how the guard set rots` | REFERENCE | meta-guards |
| `## 9. Worked example — adding one new submit-bearing workflow` | `migrations` · `order-8` | the per-workflow guard loop |

**Ordering note for the ref guards-and-tests agent.** §3's subsections run 3.1–3.11, 3.13, 3.14, 3.12, 3.15.
Reordering is a pure move.

### Ref clock-config-secrets — `reference/clock-config-secrets.md`

| section | node id(s) | why |
|---|---|---|
| `## 0. Ownership header (D1)` | REFERENCE | ownership header |
| `## Phase 1b as-built foundation` | `p1-base` | 1b |
| `## Phase 1c Stage A as-built config delta` | `p1-authority` | 1c |
| `## Phase 1c Stage C as-built storage-health delta` | `p1-authority` | 1c |
| `## Phase 1c Stage D as-built Clock/acceptance delta` | `p1-authority` | 1c |
| `## Phase 1i-spine as-built config-path delta (D121)` | `p1-spine` | the browser-bundle purity fix |
| `## 1. Grounding — what exists today, why it hurts` | REFERENCE | legacy grounding |
| `## 2. The Clock` | `p1-base` | the sole time source |
| `## 3. Config resolver` | `p1-base` · `def-settings` · `cross-cutting` | read-only today; `apply-settings` is the deferral |
| `## 4. Immutable per-run config and instance snapshot` | `p1-base` | the snapshot |
| `### 4.1 The durable snapshot is versioned by its LEAF SET (D133)` | `p2-proof` | the transaction-proof lane found it |
| `## 5. Fiscal-year dates — fail-loud, not silently stale` | FOUNDATION → `phase-1` | built in 1b; no tighter node |
| `## 6. Secrets accessor` | `p1-base` | the single-source accessor |
| `### 6.1 Explicit single-operator/local scope` | `later-unplanned` | the multi-user seam D193 refuses |
| `### 6.2 One environment doctor replaces scattered startup surprises` | `cross-cutting` | `test-login`/setup-wizard equivalents |
| `## 7. Adversarial self-review` | REFERENCE | rot vectors |
| `## 8. Worked example` | FOUNDATION → `phase-1` | illustrative |
| `## 9. Settled design questions` | REFERENCE | closed list |

### Ref operator-trust — `reference/operator-trust.md`

| section | node id(s) | why |
|---|---|---|
| `## Ownership (D1)` | REFERENCE | ownership header |
| `## Phase 1b as-built trust-schema subset` | `p1-base` | 1b |
| `## Phase 1d UI seam ratification` | `p1-authority` | 1d |
| `### Phase 1d as-built seed` | `p1-authority` | 1d |
| `## Phase 2g as-built — the trust tables exist (D134)` | `p2-2g` | 2g |
| `## Phase 2g as-built — capture, inbox, and knowledge` | `p2-2g` | 2g |
| `### D137 — a bundle is captured at the trigger, redacted at capture` | `p2-2g` | 2g |
| `### D138 — the durable row is committed BEFORE any delivery` | `p2-2g` | 2g |
| `### D139 — knowledge is admitted before it is inserted` | `p2-2g` | 2g |
| `## Phase 2g as-built — the receipt is derived, not minted` | `p2-2g` | 2g |
| `### D140 — evidence classification and cross-source obligations are DECLARED` | `p2-2g` | 2g |
| `### D141 — the receipt is a pure function of authority` | `p2-2g` | 2g |
| `### D142 — the failure section serves content through a whitelist schema` | `p2-2g` | 2g |
| `### D143 — `explain run` and the receipt are one derivation` | `p2-2g` | 2g |
| `### D199 — the receipt binds to the surfaces its derivation consumes` | `sep-2` | chunk 2's stranded receipts forced it |
| `### D204 — a gate's evidence is a `gate_results` row` | `sep-3` | chunk 3 |
| `### D237 — a settled gate's panel names the verdict, the approver, the instant` | `track-b` | B2 |
| `### Named gap: a transaction node cannot yet be a terminal dependency — CLOSED by D144` | `p2-2g` | closed; keep as the as-built record |
| `## 0. Why this is foundation work, not dashboard polish` | FOUNDATION → `phase-1` | framing |
| `## 1. Canonical UI vocabulary and typed system drivers` | `p1-authority` | the registry |
| `### 1.1 Four identifiers with one job each` | `p1-authority` | same |
| `### 1.2 Registry record` | `p1-authority` | same; ref:task-contract §3.3's ports land here |
| `### 1.3 One canonical catalog for the operator and AI tools` | `p1-authority` · `p2-2i` | the catalog, then its surface |
| `### 1.4 Tasks do not receive raw `Page`` | `p1-authority` | the driver boundary |
| `### 1.5 Registry separation` | `p1-authority` | same |
| `## 2. Trust evidence` | `p2-2g` | the trust tail |
| `### 2.1 Durable `FailureRecord`` | `p1-kernel` | 1f's minimal failure authority |
| `### 2.2 Automatic diagnostic bundle` | `p2-2g` · `def-retention` · `def-search-export` | the bundle; its purge schedule is deferred |
| `### 2.3 `RunEvidenceReceipt`` | `p2-2g` · `sep-6c` · `order-7-dash` | the receipt; the preview terminal; the ServiceNow/OnBase receipt lines |
| `### 2.4 Rerun transparency` | `p2-2g` | same |
| `### 2.5 `explain run`` | `p2-2g` | same |
| `## 3. Scenario corpus` | `p2-2j` | the corpus |
| `### 3.1 `example` is not a scenario` | `p2-2j` | same |
| `### 3.2 Minimum scenario coverage` | `p2-2j` · `track-a` | Track A's regression scenarios |
| `### 3.3 Unexpected states become data, never fallbacks` | FOUNDATION → `phase-1` | the standing rule |
| `### 3.4 Bug-to-regression rule` | REFERENCE | process rule |
| `## 4. Structured knowledge and AI-assisted fix history` | `p2-2g` · `track-a` | knowledge records are a Track A close-out line |
| `### 4.1 LESSONS are migration input, not the new authority` | `p2-2g` | 2g |
| `### 4.2 `FixRecord`` | `p2-2g` | 2g |
| `### 4.3 Maintenance and search` | `p2-2g` | 2g |
| `### 4.4 Optional AI assistance reads the evidence; it never becomes the evidence` | `p2-2i` · `def-sanity-check` | advisories shipped; the sanity-check panel is deferred |
| `## 5. Workflow explorer/editor — staged hybrid, one graph` | `p2-2i` · `def-explorer-edit` | Phase A built, Phase B deferred |
| `### 5.1 Decision` | `p2-2i` · `def-explorer-edit` | the staged decision |
| `### 5.2 Phase A — read-only explorer (2i)` | `p2-2i` | shipped |
| `### 5.3 Phase B — safe edits only` | `def-explorer-edit` · `phase2-dispositions` | D186's deferral |
| `### 5.4 Compile/apply protocol` | `def-explorer-edit` | the edit half |
| `### 5.5 New-workflow authoring path` | `def-explorer-edit` | the edit half |
| `### 5.6 What happens to the old workflow modifier` | `def-explorer-edit` | the edit half |
| `### 5.7 Phase A as-built — the explorer is a projection (D176)` | `p2-2i` | 2i-G |
| `### 5.8 The generated UI catalog gets a surface (D177)` | `p2-2i` | 2i-G |
| `### 5.9 The node panel is a FIELD table, and its census is derived (D227)` | `track-b` · every `*-dash` node | B6 and every explorer wire square |
| `## 6. Notifications — durable, event-derived, and actionable` | `p2-2g` | the inbox |
| `### 6.1 The fold is an UPDATE, and that is not a weakened ledger (D134)` | `p2-2g` | 2g |
| `## 7. Local-FIRST scope, the multi-user seams, retained safety floor` | `later-unplanned` | D193's stance |
| `## 8. Base capability inventory (webpage-ready)` | `cross-cutting` | the register 03c §Non-workflow capability closure inventory gates on |
| `### What is better than the old codebase` | REFERENCE | narrative |
| `## 9. Mechanical guards` | REFERENCE | guard list |
| `## 10. Explicit residuals` | `operator-calls` | re-check each residual is still open; else REFERENCE |

### Ref frontend-backend-integration — `reference/frontend-backend-integration.md`

The dashboard doc, rewritten first (plan step 5's order). `§5` and `§5.1` are the busiest sections in the
tree: they carry `dash-defaults` plus every `*-dash` node's tag.

| section | node id(s) | why |
|---|---|---|
| `## Phase 1b as-built integration subset` | `p1-base` | 1b |
| `## 0. Outcome and non-negotiable decisions` | FOUNDATION → `phase-1` · `dash-defaults` | the standing BFF stance |
| `## 1. What the audit found` | REFERENCE | the 2026-07-30 audit |
| `### 1.1 The production target is a complete product, not four panels` | REFERENCE | audit finding |
| `### 1.2 The existing frontend shows why the rebuild needs a BFF boundary` | REFERENCE | audit finding |
| `### 1.3 Existing rebuild contracts are strong but not yet sufficient` | SUPERSEDED | the gap it names is closed by §3 as-built |
| `## 2. Production module boundaries` | `p1-spine` · `track-d` | the boundary; Track D D7 splits `LoadedApp` |
| `## 3. Canonical transport contracts` | `p1-spine` | the wire |
| `### 3.1 `FrontendBootstrapWire`` | `p1-spine` | the wire |
| `### 3.2 `DashboardDayWire`` | `p1-spine` · `track-b` · `track-d` | B4 widened it; D4 patch-splices it |
| `### 3.3 `RunDetailWire` and lazy sections` | `p1-spine` · `track-b` | B2/B3 |
| `### 3.4 One command protocol` | `p1-kernel` · `track-b` · `track-d` · `def-settings` | D253's settlement; D10's one CAS transport |
| `### 3.5 Resumable subscription protocol` | `p1-spine` · `track-c` | D257 followed the panel over it |
| `### 3.6 Query and artifact surface` | `order-2` · `def-search-export` · `cross-cutting` | the bytes route and the search module |
| `## 4. State ownership` | `p1-spine` · `track-d` | D6/D7/D11 all amend it |
| `## 5. Surface-to-backend wiring matrix` | `dash-defaults` · every `*-dash` node | the matrix each wire set fills |
| `### 5.1 Critical user flows` | `dash-defaults` · `track-b` · every `*-dash` node | the flows |
| `#### D250 — the typed box DESCRIBES itself` | `track-b` · `sep-dash` | B3 / the run-modal square |
| `#### D251 — the run modal's three remaining facts are SERVED ALREADY` | `track-b` · `sep-dash` · `track-d` | B3; D11 amends it |
| `#### D252 — a ledger value names its STEP, DIRECTION and bound` | `track-b` · `sep-dash` | B7 / the run-detail square |
| `#### D253 — a refused command that looks like a save` | `track-b` · `track-d` | B7; D2/D3 finish it |
| `## 6. Delivery sequence mapped to the phase docs` | `phase-1` · `phase-2` · `phase-3` | the sequence |
| `### 6.1 Before `1g-spine`: contract and visual foundation` | `p1-spine` | the slice |
| `### 6.2 `1g-spine`: BFF spine` | `p1-spine` | the slice |
| `### 6.3 `1i-spine`: exact shell + Person Lookup vertical slice` | `p1-spine` · `order-0-dash` | the slice |
| `### 6.4 Phase 2 transaction proof` | `p2-proof` | the slice |
| `### 6.5 `2g`: trust surfaces` | `p2-2g` | the slice |
| `### 6.6 `2h`: data acquisition` | `p2-2h` | the slice |
| `### 6.7 `2i`: complete product shell` | `p2-2i` | the slice |
| `#### D180 — the Activity report as-built` | `p2-2i` | 2i-G |
| `#### D236 — the write-ledger block is SERVED` | `track-b` · `sep-dash` | B4 / the activity square |
| `#### D239 — the hours-saved tile is DROPPED` | `track-b` | B4 |
| `#### D240 — the report is EXPORTABLE` | `track-b` | B5 |
| `### 6.8 Phase 3+ workflow migrations` | `dash-defaults` · `migrations` | the WIRE-per-migration rule |
| `### 6.9 NOT BUILT — the BFF serves no frontend bytes (D189)` | `phase2-dispositions` · `def-byte-path` · `order-3` | the deferral and its trigger |
| `## 7. Exact visual-parity and contract verification` | `p1-spine` | the parity lane |
| `### 7.1 Reference route matrix` | `p1-spine` · `track-c` | the corpus; Track C re-froze it 151/151 |
| `### 7.2 Dual-adapter parity harness during construction` | SUPERSEDED | construction-era; the shipped lane is §7.1's single build (D132). Verify against the code before moving it |
| `### 7.3 Required test layers` | `p2-2j` | the layer table 2j closed |
| `### 7.4 Performance and resilience budgets` | `track-d` · `cutover` | Track D takes the first numbers; a cutover exit criterion |
| `## 8. Mechanical guards` | REFERENCE | guard list; ref guards-and-tests owns them |
| `## 9. Decisions rejected` | REFERENCE | rejected shapes |
| `## 10. Integration definition of done` | `cutover` | the cutover node's `needs:` cites it |

---

## 3 · Summary for the orchestrator

### (a) Nodes with no confident doc owner

No node came out `low`. Four are `medium` — the mapping is defensible but the rewrite agent should
re-decide it and say what it chose:

| node | why it is only medium | what would settle it |
|---|---|---|
| `track-c` | its five same-day fixes live in ref dashboard-surfaces's UNNUMBERED `## Wave-2 connection-proof presentation deltas` block and in `####` decisions whose numbered parent I resolved by heading order, not by reading | the ref dashboard-surfaces agent reads the block and confirms D256/D257/D258/D259 + the shape-hazard correction all belong to `track-c` and not to `track-b` |
| `operator-calls` | three unrelated open calls (the D12 gate-age pill, D192's re-disposition, A6's retry evidence) with three different owners; the node is a bucket, not a contract | the ref dashboard-surfaces and ref guards-and-tests agents confirm the two doc-side items are still open; if D192 has closed, the node loses a ref |
| `deferred` | a container node whose children carry the real refs; `00 §Size model + delivery tiers · §3.8 · §5` is the closest thing to a home | acceptable as-is, or the orchestrator rules that a container node needs no `doc:` (which would change step-3 guard arm (c)) |
| `def-retention` | the 14/8/5 purge schedule, the stream floors and an artifact refcount live in three different docs and none of them owns "retention" as a concept | the ref operator-trust agent decides whether ref:operator-trust §2.2 is the home for the schedule or whether it belongs in ref:dashboard-surfaces §2.1 beside the other floors |

**Three nodes have no id at all** and cannot be tagged against until the orchestrator adds one. Proposed,
in the existing style, never renaming anything:

- `### ALWAYS-GATE identity approval` (under `{#phase-0}`) → **`{#phase0-always-gate}`**
- `### Size model + delivery tiers` (under `{#phase-0}`) → **`{#phase0-size-model}`**
- `### Left Phase 2 by explicit disposition` (under `{#phase-2}`) → **`{#phase2-dispositions}`**

Ref write-safety's rewrite needs the first, the phase docs' the second, and refs operator-trust/frontend-backend-integration's the third — so these ids should
land **before batch 1**, not during it.

### (b) Doc sections that plan work the tree lacks

Only one section in 526 plans work with no node behind it. Two more are judgement calls the rewrite agent
must not settle alone. Suggestions only — **no node exists until the orchestrator says so.**

**Ref guards-and-tests**

- `## 7. Stub + live lanes on the new kernel` — the **derived stub lane** (each task's stub output is its
  contract's `example`, the stub map becomes a descriptor projection, the hand-written `StepDataFn`s
  disappear) is a migration plan with no node and no evidence in the tree that it landed. The live lane
  DOES exist (this repo runs live proofs constantly). Suggested node:
  `#### Derived stub lane — the stub map is a descriptor projection {#stub-lane}` under **`{#cross-cutting}`**.
  *Verify against the code first: if `maybeWrapE2EStub`/`stub-workflows.ts` have no rebuild equivalent at
  all, the honest classification may be SUPERSEDED (the lane was never ported) rather than TO-BUILD.*

**Ref operator-trust**

- `### 5.5 New-workflow authoring path` — mapped to `def-explorer-edit`, but authoring a NEW workflow from
  the dashboard is a different capability from editing an existing one's policy, and D186's trigger ("a
  SECOND production workflow whose policy you want to change") does not describe it. Suggested node if the
  orchestrator agrees they are distinct:
  `### Author a NEW workflow without writing code {#def-new-workflow-authoring}` under **`{#deferred}`**,
  trigger: whatever D79a's DSL refusal leaves standing. Otherwise keep it folded into `def-explorer-edit`.

**Ref frontend-backend-integration**

- `### 7.2 Dual-adapter parity harness during construction` — classified SUPERSEDED on the reading that the
  shipped lane (§7.1 + D132) builds ONE bundle and asserts against a frozen corpus, with no second
  adapter. If the fixture adapter genuinely exists in `tests/parity/`, this is not superseded and needs no
  node; if it does not, it is superseded narrative for `docs/rebuild/history/superseded/`. **Verify before moving.**

**Two audit items, not node suggestions.** `ref:foundation-gap-audit §5 PARTIALs` and `ref:operator-trust §10 Explicit residuals` are lists of
things a doc admitted it under-specified. Every item needs re-checking against the code; any that is still
open and has no node becomes a §3(b) entry in that agent's report.

### (c) Docs where the section structure and the tree disagree enough to need a decision

Seven, in the order they will bite. Each names the choice; **the orchestrator picks, not the rewrite agent.**

1. **Every doc — the unnumbered phase-keyed as-built blocks (~40 sections).** `## Phase 1c Stage B as-built
   storage delta`, `## Phase 2g as-built — the receipt is derived`, `## Queue-row projection as-built
   delta`, … These are precisely the sections that describe a slice node, and **none of them can be a
   `doc:` ref target** because they carry no section number. **Choice:** (i) *tag-only* — they keep their
   `<!-- roadmap: -->` tags while the node's `doc:` cites the numbered section the block amends (this map
   assumes (i) and it needs no doc surgery); (ii) *fold* each block into the numbered section it amends,
   per roadmap §Governance's "stale prose is corrected, never layered" — the most faithful to the charter and by far
   the most work; (iii) *number them* as a per-doc `## A. As-built deltas` appendix with `### A.1`… — cheap,
   but it entrenches the layering (i) merely tolerates. **Recommendation: (i) now, (ii) opportunistically
   per doc where the block is short.**
2. **Ref charter — no numbered headings exist.** The charter's 27 vision items (cited everywhere as "charter
   §12", "charter §22", "charter §25") are list items under `## Target architecture`, so `ref:charter §12` resolves
   to nothing and ref charter can never appear in a `doc:` value. **Choice:** (i) promote items 1–27 to
   `### §12 — Edit Data over checkpoints`-style headings, making every existing "charter §N" citation
   resolvable for the first time; (ii) leave ref charter prose and exempt it from `doc:` (tag-only, three tags
   total). **Recommendation: (i)** — it is a mechanical change, it fixes ~30 dangling cross-doc citations,
   and it lets `ref:charter §13`/`§22`/`§25` become the `doc:` refs that `p2-proof`, `def-capture-binding` and
   `p2-2i` are missing today.
3. **Ref dashboard-surfaces — 109 sections in three overlapping presentation layers.** §9's `D5–D24` row model
   (2026-07-26), the `## Queue-row projection as-built delta` block (2026-08-14) and the `## Wave-2
   connection-proof presentation deltas` block (2026-08-20) all describe the same surfaces at three dates,
   and the tree has ONE `dash-defaults` subtree plus `track-b`/`track-c`. **Choice:** (i) reorganize the
   presentation half into one per-surface structure mirroring the wire squares — run modal · queue row ·
   run detail · gate ceremony · archive · activity · explorer · notifications — so each square has exactly
   one home and each `*-dash` node's `doc:` is precise; (ii) keep the chronological layering and tag it as
   this map does. **This is the single biggest structural call in the pass**, it lands in batch 1 or 2
   (ref dashboard-surfaces is two units: audit → rewrite), and (i) is a large rewrite. Decide before dispatching 03-audit.
4. **Ref foundation-gap-audit — owns nothing, and 17 of its 26 sections are superseded.** All three TOP GAPs closed in
   Phase 1; their normative text is in 09/10/11. **Choice:** (i) move §2–§4 to
   `docs/rebuild/history/superseded/2026-08-20-foundation-gap-audit-top-gaps.md` and leave ref foundation-gap-audit as its four closure matrices + §0/§1 +
   §5 PARTIALs + step 4's incoming Appendix B; (ii) freeze ref foundation-gap-audit whole as a dated audit record, tag
   nothing, and let step 4's Appendix B be its only new content. **Recommendation: (ii)** — ref foundation-gap-audit is
   already explicitly a historical design input, and gutting a memo makes the record harder to read, not
   easier. But it must be an orchestrator ruling, because (ii) means one doc in thirteen carries almost no
   tags and that will look like an omission later.
5. **Ref frontend-backend-integration §5/§5.1 carry thirteen tags each.** `dash-defaults` plus twelve `*-dash` nodes all point at the
   same two headings, which makes the `doc:` refs true but useless. **Choice:** (i) split §5.1 into one
   subsection per wire square (`5.1.1 run modal` · `5.1.2 queue row` · `5.1.3 run detail` · `5.1.4 gate
   ceremony` · `5.1.5 archive · activity · explorer` · `5.1.6 notifications`) so each square is separately
   citable and each `*-dash` node's refs become precise; (ii) accept the pile. **Recommendation: (i)** —
   ref frontend-backend-integration is the first unit rewritten, and every later `*-dash` ref in this map improves for free.
6. **`docs/migrations/*.md` is outside the guard's scan.** Twelve nodes carry a `migration ref`; none of
   them is checkable, and `separations.md` (5,800 lines, 24 `§9.x` mapping subsections) is the real
   as-built record for chunks 1–6c. **Choice:** (i) widen step-3 guard arm (b) to scan
   `docs/migrations/*.md` too and let migration sections carry tags; (ii) leave migration refs as prose the
   guard never sees. **Recommendation: (i)** — the sep-* nodes' best evidence lives there, and (ii) means
   the tree's most detailed doc is the one nothing binds.
7. **Out-of-order subsections in 05, 06, 09, 10.** `ref:execution-and-sessions §4.2` sits after `## 5.`; `ref:data-intake-and-edit-data §4.5–§4.11` run
   backwards and `§5.1` follows `§5.2`; `ref:write-safety §14.8` is last; `ref:guards-and-tests §3.12` sits after `§3.14`. Pure moves, but
   they are the kind of change a reviewer reads as content drift. **Choice:** reorder in the rewrite (and
   say so in the commit message), or leave the numbering as historical. **Recommendation: reorder** — a
   `doc:` ref reader who cannot find `§4.5` where `§4.5` should be will assume the ref is stale.

### (d) Counts

**Nodes** — 66 in the plan region (plus two non-node spine markers, `## flag:` and `## today:`).

| | count |
|---|---|
| nodes total | **66** |
| mapped `high` | **62** |
| mapped `medium` | **4** (`track-c`, `operator-calls`, `deferred`, `def-retention`) |
| mapped `low` | **0** |
| nodes needing a new id | **3** (`phase0-always-gate`, `phase0-size-model`, `phase2-dispositions`) |
| nodes carrying a `migration ref` | **12** |

**Sections** — 526 across the thirteen owning docs as they stood before the split (the roadmap excluded; it is the plan).

| doc | total | tagged | foundation | to-build | superseded | reference |
|---|---|---|---|---|---|---|
| 00 | 6 | 2 | 2 | 0 | 0 | 2 |
| 01 | 47 | 35 | 4 | 0 | 4 | 4 |
| 02 | 37 | 31 | 1 | 0 | 1 | 4 |
| 03 | 109 | 104 | 0 | 0 | 0 | 5 |
| 05 | 23 | 17 | 2 | 0 | 0 | 4 |
| 06 | 41 | 37 | 0 | 0 | 0 | 4 |
| 07 | 28 | 27 | 0 | 0 | 0 | 1 |
| 08 | 26 | 1 | 0 | 0 | 17 | 8 |
| 09 | 48 | 38 | 2 | 0 | 1 | 7 |
| 10 | 42 | 37 | 1 | 1 | 0 | 3 |
| 11 | 18 | 12 | 2 | 0 | 0 | 4 |
| 12 | 58 | 52 | 2 | 0 | 0 | 4 |
| 13 | 43 | 35 | 1 | 0 | 2 | 5 |
| **all** | **526** | **428** | **17** | **1** | **25** | **55** |

**How to read the two low outliers.** Ref foundation-gap-audit (1 tagged of 26) is expected — it owns nothing and its gaps
closed; see §3(c) item 4. Ref dashboard-surfaces's 104-of-109 is also expected and is the opposite problem: nearly every
section describes a live surface, which is exactly why its structure needs decision §3(c) item 3 before the
rewrite starts.

**Coverage the other way.** Every one of the 66 nodes has at least one `doc:` ref, so step-3 guard arm (c)
can be turned on with an **empty** ratchet allowlist once the three missing ids land and the refs are
applied — the allowlist plan step 3 permits may not be needed at all.

**Every `doc:` ref in §1 was mechanically validated** against `docs/rebuild/*.md` at HEAD `b3f6eb03`: 140
distinct `NN §x.y` refs, **0 unresolved** — each one matches a real numbered heading in the named doc. So
step-3 guard arm (a) should be green on this map's refs the day it is written; any later failure means a
doc's numbering moved, which is exactly what the guard is for.
