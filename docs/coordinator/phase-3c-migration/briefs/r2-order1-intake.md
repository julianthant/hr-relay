# R2 brief — Order 1 migration intake

**Base:** `414d77b810f713d5813c79035fd38064ba04e73c`
**Required branch:** `feature/03c-r2-order1-intake`
**Units:** u10–u12
**Report:** `docs/coordinator/phase-3c-migration/reports/r2-order1-intake.md`
**Research artifact:** `docs/coordinator/phase-3c-migration/research/r2-order1-reuse-map.md`

Prepare the plan-mandated workflow-specific decision and evidence intake for person-lookup Search/Match modes and I-9 lookup. Create `docs/migrations/person-lookup.md` and `docs/migrations/i9-lookup.md` using doc 03c's §b questionnaire as a completeness checklist, citing inherited platform answers rather than duplicating them. Classify every required task REUSE/CUSTOMIZE/BUILD against ref stores, record legacy source provenance where useful, and live-verify the I-9 login/page-state/selectors read-only with Duo Autopilot and `playwright-cli`. Close all owned browser sessions.

This run is parallel with the compiler run and must not implement or assume the unlanded recipe/compiler, touch existing workflow/store source, update the shared phase/roadmap/capability authorities, or modify dashboard/parity files. Its job is to make R3 implementation-ready: exact driver/task seams, scenario matrix, canary requirements, T1 cases, mode T2/T3 cases, capability entries and genuinely unresolved operator choices. Fail loud on unavailable live state; do not invent selectors or include secrets.

Use `/supervise`; the Sol supervisor owns synthesis and evidence judgment. Dispatch only native allowed roles. Review the documents for contract fidelity, run lint plus relevant documentation checks, commit logical paths explicitly, return a clean worktree and exact report. Never edit `board.md`, merge to the integration branch/master, push, or perform an external write.
