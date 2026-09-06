# Retired — phone photograph → OCR-run Capture Mode (D294)

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

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
