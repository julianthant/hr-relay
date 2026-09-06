# Edit a workflow's presentation / policy without a code change
<!-- roadmap: def-explorer-edit -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

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
