# Edit settings in the dashboard
<!-- roadmap: def-settings -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

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
