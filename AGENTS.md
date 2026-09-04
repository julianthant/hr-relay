# HR Automation — rebuild

This repository is not production. `/Users/julianhein/Projects/hr-automation` remains the sole
production authority and rollback asset until the single all-at-once cutover (D89/D93).

## Working rules and validation

- Never push without explicit instruction. Commit by logical category and stage exact paths;
  never `git add -A` or `git add .`. Preserve other sessions' edits.
- Keep every existing `AGENTS.md` / `CLAUDE.md` pair byte-identical in the same commit. Do not
  create a missing twin unprompted. Update instructions when their rules, structure, or commands
  change; put historical detail in the referenced ledger, not the automatically loaded file.
- Update relevant tests when modifying a feature; say when none exist. Before committing run
  `npm run typecheck && npm run lint && npm run test:coverage` (D191). Lint failures are task failures.
  Coverage runs `unit`, `architecture`, and `scenario` exactly once and replaces the old
  `test` + `test:architecture` per-commit pair. Never weaken floors, assertions, membership,
  isolation, or timeouts to make a gate pass. Keep at most four isolated Vitest file forks;
  run full coverage without a concurrent compiler/linter to avoid host contention.
- A new architecture guard and its `docs/rebuild/guard-inventory.json` entry land together;
  retiring one requires an explicit retired entry with its decision and replacement invariant.
- Report outcomes with evidence (gate output, screenshot, durable row, commit) in a compact table.
  Frontend implementation/visual work goes through `/ui` and the dashboard's instructions.
- No ambient discuss / grill / plan / execute workflows or delegation. `/discuss` and `/grill-me`
  are explicit-only and stateless; record inquiry only when asked. Dispatch only after explicit
  supervision/subagent/parallel-work authorization; task complexity alone is not authorization.
- Batch real operator decisions at the end using `/decision-brief`. Before stopping unfinished
  work use `/handoff`; on resume read it and verify its git state and gates.

## Read the owning authority

The plan is the SSOT: [roadmap](docs/roadmap/roadmap.md), admitted phases under `docs/rebuild/`,
and owning contracts under `docs/rebuild/reference/`. Read the relevant phase and contract before
implementation; never create a second plan. Roadmap §Governance owns D1/D263 and the one-plan rule;
its `index.html` is generated. `reference/decisions.md` is a pointer index, not an implementation
spec; never reuse retired D131. Ratify a decision in its owning contract and pointer in one commit.
`docs/rebuild/history/` cannot override a current owner.

Current status comes from phase docs and `npm run cli -- phase`. D326/D328/D329 order 0.3 → 1.6 →
2.6 → 3.1 → 3.2 → 3.3 → 3.4; decimal parts contain numbered supervisor tasks and checklist subtasks.
Parallel peers use `N-1`, `N-2`, etc. with recorded isolation. Phase 4 needs D319 verification and
operator approval; Phase 5 owns cutover. Phase 3.2 freezes the candidate after authoring/read-only
acceptance; 3.3 consumes that exact candidate. Drift/defects return to 3.2. Never retry an UNKNOWN
submit. Live-verification permission does not authorize cutover.

Read the following when the task reaches that seam. `ref <slug>` means
`docs/rebuild/reference/<slug>.md`:

| Work | Required reading |
| --- | --- |
| Plan/governance | Roadmap §Governance and the admitted phase |
| Kernel/task/workflow/driver/dashboard/write safety | Search `ref lessons` by seam/decision and read matching entries; current contracts win |
| Tasks/workflows | `ref task-contract`, `ref workflow-model`, `ref stores` (derived; code wins), `docs/guides/workflow-authoring.md` |
| Run/settings/upgrade authority | `ref dashboard-surfaces` D330/D332, `ref clock-config-secrets` D331/D332, `ref guards-and-tests` §5.2; Phase 1.6 bindings |
| Workers/browser/write sequencer | `ref execution-and-sessions`, `ref write-safety`, relevant store instructions |
| Dashboard/BFF/CLI composition | `src/dashboard/AGENTS.md`, `src/server/AGENTS.md`, `ref frontend-backend-integration`, `ref dashboard-surfaces`, `ref operator-trust` |
| Intake/OCR/Edit Data | `ref data-intake-and-edit-data` |
| Tests/guards | `ref guards-and-tests`; `tests/scenario/AGENTS.md` for scenarios |
| Commands/environment/isolation/conventions/porting | Relevant section of [.agents/skill-library/repository-work/REFERENCE.md](.agents/skill-library/repository-work/REFERENCE.md) |
| Authorized supervision/coordination | Codex: `~/.agents/skill-library/parallel-agent-work/REFERENCE.md`; Claude: `~/.claude/skill-library/parallel-agent-work/REFERENCE.md`; plus operating reference §Authorized orchestration |

Before editing a nested module, read its nearest `AGENTS.md` even when the task started at the
repository root. Follow its lesson pointer; dashboard and Kuali histories live in sibling
`LESSONS.md`. Every relocated rule needs a read trigger and an existing target. Keep root-to-module
project instruction chains below 32,768 UTF-8 bytes; global Codex guidance is separate. Do not raise the cap to hide growth.

## Fail loud and protect authority

Never turn a missing value, failed check, or corrupt boundary into a plausible substitute.
Throw a legible error naming the field/reference; never log secret/canary values. Defaults,
alternative selectors, cached/latest values, and swallowed-error results require BOTH a valid
expected case AND recorded verification (live proof for page state, tests for pure logic).
Otherwise throw. Retrying the same transient operation is allowed. Ignore failure only when the
operation is optional and its result is not load-bearing. Catch handlers propagate failure or a
distinct unknown checked by callers. Read the operating reference for examples and guard mechanisms.

- Never import, invoke, proxy, or read legacy live state from runtime code or finished gates.
  Port verified knowledge by copying with legacy commit hash + source path and live reverification.
  Frozen provenance is self-contained evidence. Never extend retired legacy-change accounting or
  restore a legacy execution dependency. Never delete legacy files. Prefix inventory paths `legacy:`.
- `config/runtime-isolation.json` owns rebuild BFF/frontend **3938/5174**, session **hrauto-rebuild**,
  and repo-relative `.tracker`, `.tracker/artifacts`, `.tracker/locks`, `.auth`. Never mix live roots.
- Preserve settings/database-journal coupling (D321), terminal-only delete/tombstones (D308), and
  explicit-only verified backup (`npm run cli -- storage backup`, D322). Never discard an authority
  half to silence a mismatch. Ordinary boot refuses existing pre-v30 databases; only named
  backup/doctor/upgrade-preflight readers admit frozen v27–v29. Stopped-system upgrade owns crossing.
- D330/D331/D332 design 1.6; they do not prove it landed. Read exact phase evidence and the operating
  reference before changing resolver, settings, boot, or upgrade behavior.
- Never print credentials or overwrite existing `.env`. If missing, create it with `umask 077` and
  `install -m 600 .env.example .env`. CLI/smoke uses `scripts/secure-env-bootstrap.ts`;
  `src/domain/secrets.ts` alone reads credentials. Preserve secure admission and host-display propagation.
- Use the frozen `config/test-subjects.json` registry. Gone/unknown/consumed subjects block before
  browser/secret access; incomplete available input throws. The separations canary supplies one
  closed document-number reference; derive identity live. Never commit canary names/EIDs or silently
  replace a decayed subject. Read the operating reference's Environment section before live work.

## Live verification is pre-authorized

Read-only selectors, login checks, collectors, and live dry-runs are always available and
pre-authorized; never ask about access, spending the session, or Duo. Transaction-bearing workflow
verification uses `dryRun=true`: no UCPath submit or Kuali finalization. D318 transaction-free
`live-read` may use `dryRun=false` only with zero transaction nodes and exact zero deltas in
`write_intents`, `write_attempts`, `durable_outbox`. Skip a down system and continue with the rest.

Read `~/.agents/skill-library/playwright-cli/REFERENCE.md`; use `playwright-cli`, never
Codex-in-chrome/chrome-devtools MCPs. Default headless: open → snapshot → refs → verify locator.
Auth uses Duo Autopilot and full Chromium (`channel: chromium`); see `duo-autopilot/README.md`.
New enrollment is not unattended. Close owned sessions and sweep orphans, preserving other active
sessions. Use rebuild drivers/registry; consult legacy only for a provenance-bearing port.

## Coding and workflow essentials

Use kebab-case, no default exports, `.js` relative imports, and `.tsx` only in the dashboard.
Use strict recursive zod boundaries (no open records, `any`, or unchecked assertions), frozen
registries, structured errors (no `console.*`), and `src/domain/clock.ts` (`manualClock` test-only).
Browser tasks bind their exact invariant driver declaration; other tasks use the driver-free form.

D311/D317 author one `workflow.ts` per workflow folder with `defineWorkflow` / `compileWorkflow`;
never hand-author a `descriptor.ts` / `module.ts` pair or step node fragments. Typed references own
execution edges; tuple order owns presentation. Step folders exist only for chunk harnesses.
Each workflow owns `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts` plus sibling
`dry-run.scenario.ts`; preserve source-path projections when moving them. Read the operating
reference and workflow contract for omission, conditional gates, provenance, and recovery.

## Commands and generated artifacts

- `npm run dashboard` starts BFF + Vite; Ctrl+C stops both. BFF alone: `npm run cli -- dashboard`.
  Vite alone: `npm run web`. Production: `npm run web:build` then `npm run dashboard:prod`.
- One live case: `npm run cli -- dry-run-scenario <workflow> --subject <label>`.
- Visual/a11y: `npm run test:parity`; `test:parity:update` only for reviewed refreezing.
- Descriptor import-closure edits (including `src/base/**` and much of `src/domain/**`):
  `npm run build:manifest` + `npm run build:manifest:check`; not needed for instruction-only edits.
- Store catalog: `npm run stores:catalog` / `npm run stores:catalog:check`.
  Roadmap: `npm run roadmap` / `npm run roadmap:check`. Never hand-edit generated files.

The operating reference retains full command annotations; the per-commit gate is above.
