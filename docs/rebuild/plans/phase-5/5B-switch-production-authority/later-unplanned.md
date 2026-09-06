# Later, unplanned
<!-- roadmap: later-unplanned -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: later-unplanned -->
- [x] the tier exists and is named — D76's MUST / SHOULD / LATER delivery tiers; LATER is what gets cut FIRST when the stop-loss fires, and cutting it costs nothing that was promised
- [x] the two LATER items are recorded with no owner and no design, which is the point — packaging the local system as a locally-run app ("web app → real app"), and a cooperation / multi-user mode built ON TOP OF solo, if ever (D193(a))
- [x] the seams that keep them possible are already built and may never be trimmed as ceremony — actor attribution, one identity checkpoint, credential-set-keyed sessions, per-actor notification state (D75, reaffirmed by D193)
- [-] hosting — never, by design (D193(a)); "production" in these plans means the D89 day this repo becomes the operator's daily LOCAL tool
- [-] designing for multi-user now — refused; no slice may claim scope, ceremony or abstraction in its name (D193(a))
- [x] the PACKAGING half is no longer LATER — the operator promoted it to the desktop stage on 2026-08-21 (R14, `06-ship-the-desktop-app.md`, tree node `{#desktop-app}`), which gives it the owner and the design a LATER item by definition lacks
> 2026-08-21 | docs-cohesion 05 | verified against `ref operator-trust` §7 (the four seams, built and load-bearing) and `reference/decisions.md` D193(a); this node proposes no work and blocks no gate — nothing is left because nothing is owed
> 2026-08-21 | docs-cohesion R14 | one of the two items left this tier: packaging is the desktop stage now; the cooperation / multi-user item and the hosting refusal are untouched

<!-- /roadmap-status -->

**This node holds the LATER tier, and its only rule is that it never blocks the cutover.** D76 sizes
the program in three delivery tiers and the stop-loss cuts them in one order: **LATER first, then
SHOULD, never MUST** (§Program stop-loss / abort gate). A LATER item is therefore defined by what
happens to it under pressure — it is dropped without renegotiating anything the program promised —
and `05-cut-over.md` §Exit criteria names none of them.

**Two items were recorded by D193(a) with no owner and no design, and one of them now has both.**
*Packaging the local system as a locally-run app* — the "web app → real app" idea — **left this tier
on 2026-08-21**, when the operator made it **the desktop stage** (`06-ship-the-desktop-app.md`, tree node
`{#desktop-app}`, plan ruling R14): a Mac and Windows desktop app, delivered at the end of the
program. What remains here is *a cooperation / multi-user mode built on top of the solo system*, if
ever. It is not scheduled, it has no trigger, and it is not a deferral in the
`04-close-the-deferrals.md` sense: a deferral names the event that ends it, and this one names
nothing because nobody has decided it will happen. The desktop stage changes none of that — packaging is a
delivery mechanism, not a step toward multi-user.

**They are cheap to keep possible and expensive to design for now, which is why the answer is
"seams, not scope".** The four D75 seams — actor attribution on every command, run, approval, gate
resolution and ledger entry; one identity checkpoint; credential-set-keyed browser sessions;
per-actor notification read state — are built, carry one constant `local-operator`, and cost nothing
to keep. They exist because retrofitting an actor onto an immutable ledger is impossible: the old
rows would have no honest answer. What is explicitly NOT built and may not be smuggled in under a
LATER banner: RBAC, a permissions UI, user management, teams, tenant separation, remote or cloud
deployment, TLS, per-user dashboards, remote sync, or public API compatibility.

**Hosting is not LATER, it is never (D193(a)).** The distinction matters when reading this node: a
LATER item might happen; hosting is a decided refusal, and it is why "production" throughout these
plans means the D89 day this repository becomes the operator's daily LOCAL tool. The one deny-by-
default exception to loopback stays what it already is — the operator-started, token-scoped mobile
capture ingress.
