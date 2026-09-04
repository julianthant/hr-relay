# Run plan — Phase 3 chronology refactor — 2026-09-04

**Coordination UUID:** `01a836a6-a417-444f-b789-ab8a11c3c2e3`
**Coordinator owner/channel:** task `01a06b20-5f0d-72d1-867b-ffbe98413cd4`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`

No supervisor wave is authorized. The coordinator owns this planning-authority refactor directly.

## Units

### U01 — Replace the obsolete Phase 3 document structure
- Scope: active Phase 3 phase docs and preserved superseded copies
- Acceptance: only decimal Phase 3 filenames remain active; new 3.2/3.3 tasks carry a complete old-to-new crosswalk
- Dependency: operator decisions Q2–Q16
- Role: coordinator planning authority
- Mode: sequential
- Artifact: canonical phase docs
- Review: chronology, provenance, and safety boundaries

### U02 — Reconcile the roadmap and active references
- Scope: roadmap source, paired instructions, current reference/decision/migration guidance, path-sensitive tests
- Acceptance: obsolete labels remain only in dated history/evidence; every active doc binding resolves
- Dependency: U01
- Role: coordinator planning authority
- Mode: sequential
- Artifact: canonical roadmap and references
- Review: dependency graph and active-vs-historical classification

### U03 — Ratify the superseding planning decision
- Scope: canonical decision ledger and phase-governance owner
- Acceptance: next unused decision preserves earlier entries and supersedes only their naming/allocation clauses
- Dependency: U01–U02
- Role: coordinator decision authority
- Mode: sequential
- Artifact: decision pointer plus normative owner text
- Review: hard-to-reverse, surprising, real-tradeoff test

### U04 — Render and verify
- Scope: generated roadmap plus repository gates
- Acceptance: roadmap generation/check, focused tests, typecheck, lint, coverage, parity, and generated checks are green or exact unrelated failures are reported
- Dependency: U01–U03
- Role: coordinator verification
- Mode: sequential
- Artifact: gate output and rendered-roadmap inspection
- Review: final active-label audit and dirty-tree preservation

## Close

U01–U04 completed in `188e2137`. No supervisor task, worker, branch, or auxiliary worktree was
created. The only non-green command was parity assert mode, whose references already carried the
older descriptor-set hash while the committed manifest carried the newer D324-era hash; this run
did not re-freeze unrelated visual references.
