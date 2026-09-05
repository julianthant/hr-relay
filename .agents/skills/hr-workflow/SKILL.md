---
name: hr-workflow
description: >-
  Internal-resource creator for hr-automation-rebuild. `/hr-workflow WORKFLOW_ID` learns one workflow from its descriptor, module, stores, migration doc, roadmap, lessons, and canary subjects, then writes or refreshes the matching `.agents/skill-library/` reference for `hr-manage` to consume. Use when creating or refreshing workflow-specific run, monitor, dry-run, test, debug, and recording guidance without adding another operator command.
---

# /hr-workflow <workflow-id> — generate or refresh an internal workflow resource

You are not running the workflow. Produce the internal resource that lets `hr-manage` run it without
re-learning the repo. Output one `.agents/skill-library/hr-<short-id>/REFERENCE.md`, plus optional
`references/` for substantial subject or selector detail. Refresh from the current tree while
preserving hand-maintained Known failure modes and Live record sections.

## 1 · Learn — read in this order, take notes as you go

1. `src/workflows/<id>/descriptor.ts` — nodes, `when`, gates, transaction nodes, `surfaces.inputRun` (what the operator types), result shape. Bundle-safe: zod + `src/domain/**` + `src/base/**` (D106).
2. `src/workflows/<id>/module.ts` + `src/control/workflow-registry.ts` — which store tasks bind which contracts.
3. Each store it binds — `src/stores/<system>/AGENTS.md` (invariants, provenance, lessons) then the task files. `docs/rebuild/reference/stores.md` is the derived catalog; code wins.
4. `docs/rebuild/migrations/<id>.md` if present (separations is the worked example — §1 questionnaire, §9 live records) and the workflow's node in `docs/roadmap/roadmap.md` (status, `you:` lines, `log:` lines).
5. The reference docs it cites: `workflow-model` (run state machine, §5.4 validation/resume), `write-safety` (beats ①–⑦, §3.2 controlled-commit proof, §14 gate), `execution-and-sessions`, `guards-and-tests` §10 (test tiers), `dashboard-surfaces`.
6. `docs/rebuild/reference/lessons.md` — grep the workflow id and each system; every hit becomes a line in "Known failure modes".
7. `config/test-subjects.json` (when it exists) and `tests/scenario/*<id>*` — canary labels and what the existing scenarios assert.
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

## Graph (as built — `src/workflows/<id>/descriptor.ts`)
| node | kind (read · derive · gate · transaction · child-run) | system / task | when | notes |
<one row per node, in order; transaction nodes say prepare/commit/verify contract ids and the permanent key>

## Inputs & subjects
- Run modal / `surfaces.inputRun`: <what the operator types, examples declared by the descriptor>
- Canary subjects: <labels from config/test-subjects.json; values stay in .env via src/domain/secrets.ts — a missing subject is `blocked: needs <label>`, never `failed`>
- Subjects that must NOT be used / are burnt: <from the migration doc's live records>

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

## Known failure modes (from ref lessons + migration doc + store AGENTS.md)
- <date / D-number: one line each — the symptom, the cause, where the fix lives. Link the lesson.>
- Debug anything new through `.agents/skill-library/hr-debug/REFERENCE.md`; selectors use its
  selector-repair loop; never "add a longer wait" first.

## Live record
- <dated lines: run/trace ids, subject label, dry/controlled, durable counts, result — copied from docs/rebuild/migrations/<id>.md §9, newest first>

## Record when you are done
- dated line in `docs/rebuild/migrations/<id>.md`; tree node status block + `npm run roadmap` (notation: `docs/roadmap/notation.md`) in the same commit; store/dashboard AGENTS.md only for invariants; lesson-worthy findings → tell the operator ("this looks lesson-worthy: …") — `/hr-lesson` is theirs to invoke.
```

## 4 · Verify the generated resource

- The entrypoint is exactly `REFERENCE.md`, carries no skill frontmatter, and names `hr-manage` as
  its router.
- Every path it cites exists (`ls` them); every node in the table exists in the descriptor (count matches).
- No secret values, no EIDs, no document numbers of real people outside the "Live record" lines the migration doc already carries.
- Recap: the file path, the short-id mapping, the sections left `UNKNOWN` and what fills them.

## Refresh mode (`/hr-workflow <id>` when `.agents/skill-library/hr-<short-id>` exists)

Regenerate Graph / Inputs / Dry run / Tests from the current tree; preserve and append to Known failure modes and Live record; diff the old and new file in the recap so the operator sees what moved.
