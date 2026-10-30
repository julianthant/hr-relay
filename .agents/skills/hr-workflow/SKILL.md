---
name: hr-workflow
description: >-
  Internal-resource creator for Relay. `/hr-workflow WORKFLOW_ID` learns one workflow from its
  definition, registries, stores, the active brief's assigned evidence folder, roadmap, references,
  and public canary subjects, then creates or refreshes a `.agents/skill-library/` reference for
  `hr-manage`. Use for workflow-specific run, monitor, dry-run, verification, debug, and recording
  guidance; it does not author workflow code or execute a workflow.
---

# /hr-workflow <workflow-id> — generate or refresh an internal workflow resource

This skill creates or refreshes an internal resource; it does not author workflow code or run the
workflow. Produce the resource that lets `hr-manage` run it without re-learning the repo. Output one
`.agents/skill-library/hr-<short-id>/REFERENCE.md`, plus optional `references/` for substantial
subject or selector detail. Refresh from the current tree while preserving hand-maintained Known
failure modes and Live record sections.

Read the [workflow-authoring checklist](../../skill-library/workflow-authoring/REFERENCE.md) for the
current definition, registration, and W6 Explorer projection. Use it to understand the authored
source and compiled projections; this skill still produces a `hr-manage` runbook resource.

## 1 · Learn — read in this order, take notes as you go

1. `src/workflows/<id>/workflow.ts` — the authored `defineWorkflow` source: identity and
   presentation, input/result, ordered groups and entries, stable ids, typed references, and task
   contracts. The descriptor, timeline, and graph are compiled products. Keep the authoring
   checklist open for the W6 Explorer projection.
2. `src/backend/app/registries/workflow-registry.ts` and
   `src/workflows/descriptor-registry.ts` — confirm how the definition is registered and compiled
   for the server and dashboard. `src/backend/app/registries/task-registry.ts` is the current
   task-store registry.
3. For every bound task, inspect its exact contract declaration, registered store, and task
   implementation. Read `src/backend/AGENTS.md` and any nearer store `AGENTS.md`; browser stores
   are under `src/backend/systems/<system>/`, processing stores under
   `src/backend/processing/<service>/`, and workflow mini-stores under `src/workflows/<id>/`.
   `docs/rebuild/reference/stores.md` §2 is derived from the task-store registry; code wins.
4. The active brief's assigned evidence folder in the main checkout's `.work/` contains verified
   task records; confirm current workflow state in code and authority.
5. The reference docs it cites: `workflow-model` (run state machine, §5.4 validation/resume),
   `write-safety` (controlled-commit proof and identity gate),
   `execution-and-sessions`, `guards-and-tests` (verification cadence), and
   `dashboard-surfaces`.
6. Read the owning reference for the failure class and nearest module `AGENTS.md`; carry verified
   findings into "Known failure modes".
7. `config/test-data.json` (`subjects`; D341) for public canary labels. Private values resolve
   only through the typed reader and ignored `config/test-data.local.json`; never read or print
   them. The scenario rehearsal corpus is retired; desktop parity remains active under
   `tests/parity/`. Declared `scenarios` are contract data, not test evidence. Find current checks
   in active suite roots and use `ref guards-and-tests` §10.5 for
   canary availability and acceptance status.
8. The platform-wide rails live in `.agents/skills/hr-manage/SKILL.md` and
   `.agents/skill-library/hr-debug/REFERENCE.md` — read both once so the generated resource points to
   them instead of restating them.

Stop when you can fill every template section from evidence. A section you cannot fill gets `UNKNOWN — <what to read/run to fill it>`, never a guess.

## 2 · Decide the short id

`hr-<short-id>` where short-id drops the `separations-` family prefix only when unambiguous: `person-lookup` → `hr-person-lookup`; `separations-kuali-finalization` → `hr-kuali-finalization`; `separations` (the composed graph) → `hr-separations`; `kuali-timekeeper-annotation` → `hr-kuali-timekeeper`. Say the mapping in your recap.

## 3 · The template (write it filled-in; delete the `<…>` hints)

```markdown
# `<workflow-id>` workflow resource

> Internal repository playbook selected by `hr-manage` for `<workflow-id>` and its plain-English
> names. It is not an independent operator command.

**What it does.** <3–5 sentences: subject, systems touched in order, what it reads, what it WRITES (or "read-only"), where it gates, its terminal result.>

## Graph (as built — `src/workflows/<id>/workflow.ts` and compiled descriptor)
| group / entry id | kind | compiled node ids / task contracts | system / task | typed references, conditions, notes |
<one row per authored entry in presentation order; dependencies come from typed references, not tuple order; transaction rows name prepare/commit/verify contracts and the permanent key>

## Explorer preview (W6 — derived from the compiled definition)
- Preview state: <compiled definition preview, or the explicit unavailable reason>
- Ordered groups and entries, stable ids, typed dependencies, and systems in first-use order: <…>
- Declared action display: <complete `operationDisplay`, or explicit legacy/unavailable>
- Source jumps: <only exact displayed producers; missing, ambiguous, or retired sources stay unavailable>
- Choices: <hypothetical conditions/branches only; no run state, actual outcomes or values, commands, or live overlay>

## Inputs & subjects
- Run modal / `surfaces.inputRun`: <what the operator types, examples declared in `workflow.ts`
  and confirmed in the compiled descriptor>
- Canary subjects: <labels from the current public registry under ref guards-and-tests §10.5; private values resolve through its typed reader, never `.env` or report text — a missing subject is `blocked: needs <label>`, never `failed`>
- Subjects that must NOT be used / are burnt: <from the active brief's assigned evidence folder,
  confirmed against current authority>

## Run it (details in hr-manage)
- Processes: `npm run dashboard` (BFF 3938 + vite 5174) and
  `npm run cli -- worker <workflow-id>`; restart the BFF after workflow-definition changes
  (fingerprint trap — hr-debug §stale-bff).
- Start: the signed-in dashboard run modal via playwright-cli with `dryRun` — **dryRun=true is the default; a real write only under the controlled-commit proof with the operator's explicit per-run authorization.**
- Gate ceremony (if it gates): <which gate, what the packet shows, approval shape is SERVER-computed>.

## Dry run must show (assert over authority, not logs)
- nodes reached: <…>; nodes excluded: <…>
- `run_checkpoints` rows keyed `(workflow, item, node, attempt, claimGeneration?)`: <which nodes>
- `gate_results`: <row / none>
- `write_intents` / `write_attempts` / `durable_outbox` deltas: **0**
- receipt shape: <…>; preview terminal: <…>
- the `explain run` output mentions: <…>

## Current verification and gate status
- Focused tests, lint, and affected static/generated checks: <existing paths and verified outcomes from the owning task>
- Phase-exit gates: <only the gates required by the active phase plan, with actual outcomes or not run>
- Do not infer test execution from declared scenario ids or revive the retired scenario
  corpus. Keep active desktop parity obligations. Follow root `AGENTS.md` and
  `ref guards-and-tests` for cadence.

## Known failure modes (from the owning reference and nearest module AGENTS.md)
- <one line per verified issue: the symptom, cause, owning reference, and nearest module
  `AGENTS.md`>
- Debug anything new through `.agents/skill-library/hr-debug/REFERENCE.md`; selectors use its
  selector-repair loop; never "add a longer wait" first.

## Live record
- <task-specific run evidence from the active brief's assigned evidence folder, checked against
  current authority>

## Record when you are done
- Record task notes in the active brief's assigned evidence folder under `.work/`; keep lasting invariants in the owning module `AGENTS.md`.
```

## 4 · Verify the generated resource

- The entrypoint is exactly `REFERENCE.md`, carries no skill frontmatter, and names `hr-manage` as
  its router.
- Every concrete path it cites exists (`ls` them); paths containing `<…>` are templates until
  resolved. Every table entry matches the current definition and its compiled descriptor.
- No secret values, no EIDs, no document numbers of real people in the resource.
- Recap: the file path, the short-id mapping, the sections left `UNKNOWN` and what fills them.

## Refresh mode (`/hr-workflow <id>` when `.agents/skill-library/hr-<short-id>` exists)

Regenerate Graph / Explorer preview / Inputs / Dry run / Current verification from the current
tree; preserve and append to Known failure modes and Live record; diff the old and new file in the
recap so the operator sees what moved.
