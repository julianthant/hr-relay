# Intake findings

Records where a demo intake element (`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoIntake.tsx` + `demo-data-intake.ts`) has no counterpart
in this tree, verified 2026-08-21 by reading `src/dashboard/surfaces/intake.tsx` and
`src/domain/intake/**` against the source-pinned 2026-08-21 standing-surfaces fidelity ledger
(`9993ab39^:docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` §6, rows
IN15/IN16/IN123–IN144; removed with obsolete dashboard plans). See
`README.md` for the standing rules; this file did not
exist before this pass — Track F booked it because the ledger named 22 real gaps and nothing had.

Owning doc for every record below: `docs/rebuild/reference/data-intake-and-edit-data.md` §5/§5.2,
`docs/rebuild/reference/dashboard-surfaces.md` §9.7.1.
Phase 3.1 Task 10-4 owns the remaining presentation decisions and producer work.

## The Manifest and Rerun-diff STAGES are rendered

**Recorded:** 2026-08-21 · **Resolved:** 2026-08-25 · **Owning doc:**
`docs/rebuild/reference/data-intake-and-edit-data.md` §5.2

**Resolution.** The intake surface now has named Manifest and Rerun diff stage tabs. The Manifest
model distinguishes a preflight-reserved plan id from a terminal committed manifest, and renders
the terminal identifiers, fingerprints, totals and per-source-row dispositions only when the
served terminal facts exist. Rerun renders named empty and same-plan states plus exact changed
axes, membership, counts and hash-only changed inputs.

**Demo elements.** `DemoIntake.tsx:96-97` (the two stage tabs), `:946-1091` (the Manifest body),
`:1031-1091` (the rerun empty-state and diff body).

**Ledger rows folded here:** IN123–IN136, IN139 and IN142 are ported. IN137 and IN138 remain
operator-owned presentation decisions. IN143 has the exact served item ids and input hashes, but
remains open for a human-readable item label because no wire producer serves one. IN144 remains an
OPEN operator-owned copy/icon decision; the unratified closing banner is not rendered.

**Verification.** Focused projection tests cover reservation, terminal facts, empty rerun and
changed rerun states. The dashboard fixture renders both terminal stages; reference captures were
intentionally not re-frozen in this pass.

---

## Terminal Manifest/rerun-diff WIRE fields are served

**Recorded:** 2026-08-21 · **Resolved:** 2026-08-25 · **Owning doc:**
`docs/rebuild/reference/data-intake-and-edit-data.md` §5.2

**Resolution.** `IntakeSessionWire` now serves the terminal mapping fingerprint and snapshot,
workflow contract fingerprint, totals and source-row dispositions, and rerun serves exact
membership/count inputs. The UI fails loud for missing terminal facts rather than substituting a
plausible manifest.

**Remaining boundary.** No served source supplies a human-readable membership item label for
IN143. The UI therefore renders the exact item id and short input hash without inventing copy; its
full hash is reachable through the same detail popover as other compact evidence.

---

## The Run verb reads the wire's lowercase form, not the demo's imperative

**Recorded:** 2026-08-21 · **Status:** OPEN — operator call, presentation only (no missing field)
· **Owning doc:** `docs/rebuild/reference/data-intake-and-edit-data.md` §5.2

**Symptom.** The demo's primary control reads `Start N runs` (`Play` icon, disabled once already
applied); the rebuild's reads `Run N rows` (no icon) (`DemoIntake.tsx:391` vs `intake.tsx:1006`).
Ledger row IN138. This is a wording/iconography choice, not a wire gap — both surfaces already have
every fact the button needs.

**What closes it:** an operator ruling on the label; no code change beyond the string and icon once
ruled.
