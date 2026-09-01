# DCA4 intake — 2026-08-30

Assigned worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Branch: `feature/dca4-archive-evidence`; original HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
The complete profile and brief were read. Board is read-only; shared integration/removal belongs to the coordinator.
Native role policy gate: `python3 /Users/julianhein/.agents/skills/supervise/scripts/check-role-policy.py --platform codex --repo /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4` → exit 0, five native roles valid.
DCA1 `c72f0e69` and R-DCF integration `e0cd4353` each pass `git merge-base --is-ancestor <ref> HEAD` (exit 0).

## Original dirty inventory (preserve/adopt)

```
 M docs/rebuild/reference/dashboard-surfaces.md
 M docs/rebuild/reference/frontend-backend-integration.md
 M src/dashboard/AGENTS.md
 M src/dashboard/client/queries.ts
 M src/dashboard/surfaces/archive-model.ts
 M src/dashboard/surfaces/archive.tsx
 M src/domain/dashboard/archive.ts
 M src/server/dashboard/queries/archive.ts
 M src/server/dashboard/routes/api.ts
 M test-results/.last-run.json
 M tests/parity/helpers/fixture-bff.ts
 M tests/unit/dashboard/archive-detail-render.test.ts
 M tests/unit/dashboard/archive-render.test.ts
?? tests/parity/archive-evidence.spec.ts
?? tests/parity/archive-evidence.spec.ts-snapshots/archive-evidence--graphite-warm--1280x720-darwin.png
?? tests/parity/archive-evidence.spec.ts-snapshots/archive-evidence--paper-ink--phone-390x844-darwin.png
?? tests/parity/references/archive-evidence--graphite-warm--1280x720.a11y.yml
?? tests/parity/references/archive-evidence--graphite-warm--1280x720.meta.json
?? tests/parity/references/archive-evidence--paper-ink--phone-390x844.a11y.yml
?? tests/parity/references/archive-evidence--paper-ink--phone-390x844.meta.json
?? tests/unit/server/archive-capture-resource.test.ts
```

13 tracked files: 421 insertions / 24 deletions at intake. Eight untracked files.
Only ignored resources observed: `dist/`, `node_modules/`, `tests/parity/.output/`.
No credential or live authority root is present in this worktree's ignored inventory.

`test-results/.last-run.json` is known generated residue explicitly disposable under the brief.
Its sole change is `status: failed` → `status: passed`, with `failedTests: []` unchanged,
no trailing newline. Intake blob: `cbcc1fbac11a74b608b2b3edc3a2ffd6ab639cb2`.
It will be restored to its original tracked value after preservation here, never committed as feature proof.

Restoration completed and `git diff --exit-code -- test-results/.last-run.json` returned 0.
The two original, unconsumed screenshot files were visually inspected: both show a broken image
beneath a verified-bytes caption. Their SHA-256 identities before any re-freeze/move are:

- dark desktop: `b02cb4260ce632be81ea0c2c81f6ffb8ad38f0eca07a7539204aaf617599dc33`
- light phone: `9f4283369844d0af97cff87519ceda0c6edc0def9bdae6ac491f83ee92b452a8`

They are interrupted, failing proof, not accepted references. The UI unit must preserve their
disposition explicitly while delivering verified triplets at the configured reference path.

## Review decisions

Authority/schema/resource-serving and async UI changes require independent review. The final fixed
commit range will receive applicable review axes separately. Generated parity references are inspected
with rendered proof; no wholesale corpus re-freeze. No new subunit worktrees are needed for these
sequential units, so no owned child merge/sweep is planned.
