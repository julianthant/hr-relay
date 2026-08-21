_History — superseded by `reference/clock-config-secrets.md`'s rewritten header and §6 (see
`history/README.md`); kept verbatim as written on 2026-08-01._

This was `docs/rebuild/reference/clock-config-secrets.md`'s opening `Status:` paragraph — the
chronology of when the doc was revised and what each amendment round decided. It is preserved
because it records WHEN the two-repository framing entered this contract; what is TRUE now is
stated in the doc's own header and §6, without a date-ordered narrative.

---

Status: **Phase 1c Clock/acceptance delta completed 2026-08-01; Phase 1b clock/config/secrets
foundation implemented 2026-07-31; revised 2026-07-22 after
the whole-plan/legacy-code review.** Configuration is now
recursively strict/branded, diagnostic redaction is part of the secret contract, and scope is
explicitly a loopback-only single-operator tool—no RBAC/multi-user infrastructure in the base.
**Amended 2026-07-31 (Round 10):** legacy and rebuild config/secret worlds remain isolated.
**Amended 2026-07-31 (Round 11 — D93):** that isolation is now two repositories (`hr-automation`
legacy, `hr-automation-rebuild`) on **one machine**. The split makes cross-runtime imports/reads/
proxying structurally impossible, but it does not separate the machine — so two `.env`/settings/
secret worlds, two state/artifact roots, distinct ports, distinct process locks, and distinct
browser profiles/sessions remain a hard REQUIREMENT of this doc. Rebuild paths below are the
rebuild repo's own `src/`, `tests/`, and `config/`.

Answers gap-audit (`08`) TOP GAP 3 and closes config/instance, secrets, and fiscal rollover gaps.
Grounded in the legacy repo's `src/config.ts`, settings, queue trace-id, env, and Duo credential code.
