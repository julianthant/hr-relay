# Task 3.1.11.1 · Finish Setup and preflight
<!-- roadmap: dash-setup -->

**Current assignment: 3.1.11.1.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Derive setup from authoritative settings/storage/workers/browsers/prerequisites and execute the
  complete preflight fault corpus with real idempotent repair/re-check actions.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref clock-config-secrets` §D331.10 (Setup renders the same
> served catalog projection, with the `provider-env` families read-only) and §D331.11 P16 — doctor and
> preflight name a protected leaf by NAME and presence only. The first post-upgrade boot's
> `migrated-refused { key }` refusal is a SETUP fault, not an outage: it is presented with the same
> `.env` remove-list the upgrade plan printed (`ref clock-config-secrets` §D332.S5). No redesign.

Consume schema 50/floor 46 and the current catalog/preflight contract. The dated migrated-refused/environment-import wording is historical: it does not authorize retired imports or below-floor upgrade. Display the current named admission/refusal and explicit compatible-release remedy. Full declared fault-corpus execution remains open despite the six existing dashboard runners.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
