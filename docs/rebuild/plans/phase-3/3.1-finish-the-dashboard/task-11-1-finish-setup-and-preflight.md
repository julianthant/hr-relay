# Task 11-1 · Finish Setup and preflight
<!-- roadmap: dash-setup -->

**Current assignment: 3.1.9-1.5.** Former task 3.1.11-1; stable node `dash-setup`.
Read [Shell and configuration](subphase-9-1-shell-and-configuration.md) for dependencies and operator-controlled integration.
The existing filename and historical task heading remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Derive setup from authoritative settings/storage/workers/browsers/prerequisites and execute the
  complete preflight fault corpus with real idempotent repair/re-check actions.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref clock-config-secrets` §D331.10 (Setup renders the same
> served catalog projection, with the `provider-env` families read-only) and §D331.11 P16 — doctor and
> preflight name a protected leaf by NAME and presence only. The first post-upgrade boot's
> `migrated-refused { key }` refusal is a SETUP fault, not an outage: it is presented with the same
> `.env` remove-list the upgrade plan printed (`ref clock-config-secrets` §D332.S5). No redesign.
