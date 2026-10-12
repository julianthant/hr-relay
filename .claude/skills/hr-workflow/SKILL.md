---
name: hr-workflow
description: >-
  Hidden-helper creator for Relay. `/hr-workflow WORKFLOW_ID` learns one workflow from its
  descriptor, module, stores, the active brief's assigned evidence folder, roadmap, owning references,
  and canary subjects, then refreshes a `user-invocable: false` helper under `.claude/skills/` for
  `hr-manage`. Use to create or refresh workflow-specific guidance without another `/` command.
---

# /hr-workflow <workflow-id> — generate or refresh a hidden workflow helper

You are not running the workflow. Produce the hidden helper that lets `hr-manage` run it without
re-learning the repo. Output one `.claude/skills/hr-<short-id>/SKILL.md`, plus optional `references/`
for substantial subject or selector detail. Refresh from the current tree while preserving
hand-maintained Known failure modes and Live record sections.

## 1 · Learn — read in this order, take notes as you go

1. `src/workflows/<id>/descriptor.ts` — nodes, `when`, gates, transaction nodes, `surfaces.inputRun` (what the operator types), result shape. Bundle-safe: zod + `src/domain/**` + `src/base/**` (D106).
2. `src/workflows/<id>/module.ts` + `src/backend/app/registries/workflow-registry.ts` — which store tasks bind which contracts.
3. Each store it binds — `src/backend/systems/<system>/AGENTS.md` (invariants and provenance) then the task files. `docs/rebuild/reference/stores.md` is the derived catalog; code wins.
4. The active brief's assigned evidence folder in the main checkout's `.work/` contains verified
   task records; confirm current workflow state in code and authority.
5. The reference docs it cites: `workflow-model` (run state machine, §5.4 validation/resume), `write-safety` (controlled-commit proof and identity gate), `execution-and-sessions`, `guards-and-tests` §10 (test tiers), `dashboard-surfaces`.
6. Read the owning reference for the failure class and nearest module `AGENTS.md`; carry verified
   findings into "Known failure modes".
7. `config/test-data.json` (`subjects`; D341) and `tests/scenario/*<id>*` — canary labels and what the existing scenarios assert. Private values live only in ignored `config/test-data.local.json`; never read or print them.
8. The platform-wide rails live in `.claude/skills/hr-manage/SKILL.md` and the hidden
   `.claude/skills/hr-debug/SKILL.md` — read both once so the generated helper references them instead
   of restating them.

Stop when you can fill every template section from evidence. A section you cannot fill gets `UNKNOWN — <what to read/run to fill it>`, never a guess.

## 2 · Decide the short id

`hr-<short-id>` where short-id drops the `separations-` family prefix only when unambiguous: `person-lookup` → `hr-person-lookup`; `separations-kuali-finalization` → `hr-kuali-finalization`; `separations` (the composed graph) → `hr-separations`; `kuali-timekeeper-annotation` → `hr-kuali-timekeeper`. Say the mapping in your recap.

## 3 · The template (write it filled-in; delete the `<…>` hints)

```markdown
---
name: hr-<short-id>
description: Internal workflow guidance for `<workflow-id>` and its plain-English names in Relay — <one clause: what it reads/writes and which systems>. Use through hr-manage for run, dry-run, monitor, prove, test, or debug work.
user-invocable: false
---

# `<workflow-id>` workflow helper

**What it does.** <3–5 sentences: subject, systems touched in order, what it reads, what it WRITES (or "read-only"), where it gates, its terminal result.>

## Graph (as built — `src/workflows/<id>/descriptor.ts`)
| node | kind (read · derive · gate · transaction · child-run) | system / task | when | notes |
<one row per node, in order; transaction nodes say prepare/commit/verify contract ids and the permanent key>

## Inputs & subjects
- Run modal / `surfaces.inputRun`: <what the operator types, examples declared by the descriptor>
- Canary subjects: <labels from config/test-data.json subjects; private values stay in ignored config/test-data.local.json via src/backend/app/registries/test-data.ts (D341) — a missing subject is `blocked: needs <label>`, never `failed`>
- Subjects that must NOT be used / are burnt: <from the active brief's assigned evidence folder,
  confirmed against current authority>

## Run it (details in hr-manage)
- Processes: `npm run dashboard` (BFF 3938 + vite 5174) and `npm run cli -- worker <workflow-id>`; restart the BFF after descriptor edits (fingerprint trap — hr-debug §stale-bff).
- Start: the run modal via playwright-cli, or `POST /api/v1/start-plans` → `POST /api/v1/commands` with `dryRun` — **dryRun=true is the default; a real write only under the controlled-commit proof with the operator's explicit per-run authorization.**
- Gate ceremony (if it gates): <which gate, what the packet shows, approval shape is SERVER-computed>.

## Dry run must show (assert over authority, not logs)
- nodes reached: <…>; nodes excluded: <…>
- `run_checkpoints` rows keyed `(workflow, item, node, attempt, claimGeneration?)`: <which nodes>
- `gate_results`: <row / none>
- `write_intents` / `write_attempts` / `durable_outbox` deltas: **0**
- receipt shape: <…>; preview terminal: <…>
- the `explain run` output mentions: <…>

## Tests it owes (`ref guards-and-tests` §10)
- T1a structural: <path>; T1b dry-run scenario / checkpoint manifest: <path or OWED>; T2 dashboard scenario: <path or OWED>; unit tests for pure folds: <…>
- Gate: `npm run typecheck && npm run lint && npm run test:coverage`; `npm run build:manifest` after any edit under the descriptor's closure.

## Known failure modes (from the owning reference and nearest module `AGENTS.md`)
- <one line per verified issue: the symptom, cause, owning reference, and nearest module
  `AGENTS.md`>
- Debug anything new through hidden `hr-debug`; selectors use its selector-repair loop; never "add a longer wait" first.

## Live record
- <task-specific run evidence from the active brief's assigned evidence folder, checked against
  current authority>

## Record when you are done
- Record task notes in the active brief's assigned evidence folder under `.work/`; keep lasting invariants in the owning module `AGENTS.md`.
```

## 4 · Verify the generated helper

- Frontmatter parses; name matches the directory; description is model-facing; and
  `user-invocable: false` is present.
- Every path it cites exists (`ls` them); every node in the table exists in the descriptor (count matches).
- No secret values, no EIDs, no document numbers of real people in the resource.
- Recap: the file path, the short-id mapping, the sections left `UNKNOWN` and what fills them.

## Refresh mode (`/hr-workflow <id>` when `hr-<short-id>` exists)

Regenerate Graph / Inputs / Dry run / Tests from the current tree; preserve and append to Known failure modes and Live record; diff the old and new file in the recap so the operator sees what moved.
