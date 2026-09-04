# Dashboard decisions — operator context

This topic record preserves the operator answers behind dashboard decisions. Normative behavior is
in the owning docs named by `docs/rebuild/reference/decisions.md`.

## D271–D276 — Phase 3a fidelity decisions

On 2026-08-26 the operator accepted all 49 recommendations from the Phase 3a fidelity review. The
review deliberately grouped related visual, interaction, accessibility, and truthfulness findings
so one product choice was not presented as several decisions.

| Decision | Group | Items | Answer | Canonical owner |
|---|---|---:|:---:|---|
| D271 | Worker-pool process semantics | 5 | all A | ref execution-and-sessions, worker-pool section |
| D272 | Shell, queue, and start | 9 | all A | ref dashboard-surfaces; ref frontend-backend-integration |
| D273 | Run detail | 10 | all A | ref dashboard-surfaces; ref operator-trust; ref data-intake-and-edit-data |
| D274 | Standing product surfaces | 10 | all A | ref dashboard-surfaces; ref data-intake-and-edit-data |
| D275 | Standing-surface conventions | 10 | all A | ref dashboard-surfaces; ref operator-trust |
| D276 | Standing copy and served facts | 5 | all A | ref dashboard-surfaces; ref operator-trust; ref data-intake-and-edit-data |

The common ruling was to restore the demo's coherent interaction and language while retaining only
named exceptions required for accessibility, honest asynchronous/refusal states, or served facts.
No choice authorized fabricated data or a silent fallback.

### D271 — worker-pool process semantics

Dashboard stop requests graceful worker shutdown; escalation is bounded and explicit; the initial
pool cap is three; crashes remain visible; and a restarted dashboard observes processes it cannot
prove it owns instead of adopting or killing them.

### D272 — shell, queue, and start

The full-page Settings route, shell geometry, truthful result feedback, queue state, and start-plan
continuity follow the reviewed demo shape. Useful intake access and honest valid-absence arms remain
as explicit exceptions.

### D273 — run detail

Run identity, timeline controls, logs, decision-age cues, context hierarchy, edit/refusal feedback,
receipts, failure framing, and park metadata use the demo-shaped interaction without hiding or
inventing authority facts.

### D274 — standing product surfaces

Archive, versioning, catalog, Settings, Intake, and capture surfaces expose only behavior and facts
the backend can serve. Minor version bumps archive nothing and cannot be blocked.

### D275 — standing-surface conventions

Catalog entry points return, shared takeovers and responsive tables use bounded accessibility
rules, and loading/refusal states remain explicit. Exceptions are conditional, not blanket forks
from the shared surface language.

### D276 — standing copy and served facts

Intake, Explorer, version-bump, Activity, Settings-storage, design-system, and catalog wording use
one demo vocabulary, with truthful async and refusal feedback retained.

## D281 — UI-1 demo-uncovered elements

On 2026-08-27 the operator chose A for items 1–6 and B for item 7. The toolbar doors and truthful
host/capability facts stayed. The storage-health band became full-bleed without changing the shared
`Banner` primitive. The receive-stage implementation and scheduling calls belonged to the UI run
plan rather than a second product decision.

Normative owner: ref dashboard-surfaces §10.

## D282–D283 — dashboard completion scope

On 2026-08-28 the operator retained Activity's truthful current-only `Unread` axis, admitted strict
span/authority reconciliation in Storage Doctor, and activated the dashboard-owned deferrals.
They then narrowed execution to what Separations and current cross-cutting authority could prove.
OCR, Group People, capture-to-workflow binding, and other workflow-specific producers remain with
the workflow that can verify them.

Normative owners: ref dashboard-surfaces §10, doc 03c workflow admission, and the dashboard
completion plan.

## D288–D289 — reporting identity

The operator accepted both recommendations on 2026-08-28:

- Activity's distinct-people count uses insert-only, secret-keyed, generation-bound pseudonym
  evidence derived from each run's exact canonical subject binding. Missing, ambiguous, mixed, or
  incomplete evidence is unavailable by name.
- Receipt comparison uses a closed workflow fact registry over immutable receipts. It compares the
  exact `retryOf` pair, exposes only reviewed safe-diagnostic values, and withholds sensitive or
  identifier-derived values.

Normative owners: ref dashboard-surfaces §D288 and ref operator-trust §2.3.1a.

## Archive version-bump snapshot disposition

The 2026-08-30 parity recovery chose option C: do not merge a known split screenshot family.
Restore the family from the parent and later recapture both themes together. This was a reversible
run-local disposition, so it has no D-number and creates no product contract.
