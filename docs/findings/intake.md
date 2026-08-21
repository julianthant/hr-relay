# Intake findings

Records where a demo intake element (`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoIntake.tsx` + `demo-data-intake.ts`) has no counterpart
in this tree, verified 2026-08-21 by reading `src/dashboard/surfaces/intake.tsx` and
`src/domain/intake/**` against `docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` §6
(ledger 3, rows IN15/IN16/IN123–IN144). See `README.md` for the standing rules; this file did not
exist before this pass — Track F booked it because the ledger named 22 real gaps and nothing had.

Owning doc for every record below: `docs/rebuild/reference/data-intake-and-edit-data.md` §5/§5.2,
`docs/rebuild/reference/dashboard-surfaces.md` §9.7.1.

## The Manifest and Rerun-diff STAGES have no surface

**Recorded:** 2026-08-21 · **Status:** OPEN — blocked on the operator's ruling named below (03a
`{#track-f}` OPEN question 9) · **Owning doc:** `docs/rebuild/03a-finish-the-dashboard.md` OPEN
question 9

**Symptom.** The demo's intake flow has six stages; this tree renders four. The two that render
nowhere are `Manifest` (the plan id, source sha, artifact id, the three fingerprints and the
per-source-row disposition table) and `Rerun diff` (the added/removed item lists, the per-axis
`was… → now…` digest already partially built at `intake.tsx:857-888` under D171). The enqueued
banner today shows one bare `manifest <uuid>` (`intake.tsx:1221`) in place of the whole stage.

**Demo elements.** `DemoIntake.tsx:96-97` (the two stage tabs), `:946-1091` (the Manifest body),
`:1031-1091` (the rerun empty-state and diff body).

**Ledger rows folded here:** IN15, IN16, IN123, IN124, IN126, IN127, IN131, IN137, IN139, IN144 —
all ten are "OPEN — operator call" in the ledger, not wire gaps; several of the fields they would
draw (`IntakeSessionWire.artifact`, `.createdAt`) are already served and simply have nowhere to
render.

**What closes it:** the operator's ruling on `{#track-f}` OPEN question 9 ("Intake stages 5 and 6
have no surface... D173 ratifies the dialog → workspace reshaping at length and says nothing about
where these went"). Building the two stages is the trigger; the wire-field gaps below are a
SEPARATE, smaller trigger nested inside this one.

---

## The Manifest/rerun-diff WIRE fields are unbooked

**Recorded:** 2026-08-21 · **Status:** OPEN — no producer at any layer (re-verified 2026-08-21:
none of the field names below appear in `src/domain/intake/**` or `IntakeSessionWire`) ·
**Owning doc:** `docs/rebuild/reference/data-intake-and-edit-data.md` §5.2

**Symptom.** Even once the two stages above are built, several fields the demo's Manifest and
Rerun-diff bodies draw have no producer to bind to.

**Missing wire fields, by ledger row:**
- IN125 `mapping fingerprint`, IN129 `mapping snapshot hash` — `mappingFingerprint` /
  `mappingSnapshotHash` are not on `IntakeSessionWire`.
- IN128 `mapping fingerprint` (duplicate ledger citation of the same gap) — see above.
- IN130 `workflow contract` fingerprint — `workflowContractFingerprint` is not on the wire.
- IN132 the totals line `N rows · V valid · R rejected · E excluded · C corrected` —
  `IntakeValidationWireSchema` has no `corrected` count (it exists on `IntakeManifestTotalsSchema`,
  a domain type never projected to the wire).
- IN133, IN134, IN135, IN136 the per-source-row disposition table (row / disposition / item / input
  hash / parsed input) — `SourceRowDispositionSchema` and `ValidRowSchema` are domain types, not on
  `IntakeSessionWire`.
- IN142 the rerun chips (`unchanged` / `added` / `removed` / `mapping` / `contract`) — `RerunDiffSchema`
  carries no per-item counts.
- IN143 the two rerun `Well`s ("In this plan, not in `<planId>`" / "In `<planId>`, not here") —
  `RerunDiffSchema` has no `added`/`removed` item lists.

**What closes it:** the same commit that builds the Manifest/Rerun-diff stages (the record above)
must also widen `IntakeSessionWire` and `RerunDiffSchema` with these fields — building the stage
first would ship a page that cannot fill itself in.

---

## The Run verb reads the wire's lowercase form, not the demo's imperative

**Recorded:** 2026-08-21 · **Status:** OPEN — operator call, presentation only (no missing field)
· **Owning doc:** `docs/rebuild/reference/data-intake-and-edit-data.md` §5.2

**Symptom.** The demo's primary control reads `Start N runs` (`Play` icon, disabled once already
applied); the rebuild's reads `Run N rows` (no icon) (`DemoIntake.tsx:391` vs `intake.tsx:996`).
Ledger row IN138. This is a wording/iconography choice, not a wire gap — both surfaces already have
every fact the button needs.

**What closes it:** an operator ruling on the label; no code change beyond the string and icon once
ruled.
