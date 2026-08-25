---
name: hr-workflow
description: Skill CREATOR for the hr-automation-rebuild — `/hr-workflow <workflow-id>` learns one workflow (descriptor, module, stores, migration doc, tree node, lessons, canary subjects) and writes a dedicated project skill `.claude/skills/hr-<short-id>/SKILL.md` (e.g. hr-kuali-separation, hr-person-lookup) that teaches any agent how to run, monitor, dry-run, test, debug and record THAT workflow. Every generated skill is built on the shared toolkit: hr-manage (run/monitor/batch/dashboard), hr-debug (selectors, dry-run audit, platform traps), hr-scan (document intake), hr-lesson (operator-invoked). Also re-run it to REFRESH an existing hr-<id> skill after the workflow changes. Invoke on `/hr-workflow <id>`, "make a skill for workflow X", "scaffold hr-X", "refresh the hr-X skill".
---

# /hr-workflow <workflow-id> — generate (or refresh) the `hr-<id>` skill

You are not running the workflow. You are producing the skill that lets the next agent run it without re-learning the repo. Output = ONE file `.claude/skills/hr-<short-id>/SKILL.md` (plus an optional `references/` dir when the workflow has a lot of subject/selector detail), following the template in §3. Refreshing = regenerate from the current tree and keep the "Known failure modes" / "Live record" sections that were hand-maintained.

## 1 · Learn — read in this order, take notes as you go

1. `src/workflows/<id>/descriptor.ts` — nodes, `when`, gates, transaction nodes, `surfaces.inputRun` (what the operator types), result shape. Bundle-safe: zod + `src/domain/**` + `src/base/**` (D106).
2. `src/workflows/<id>/module.ts` + `src/control/workflow-registry.ts` — which store tasks bind which contracts.
3. Each store it binds — `src/stores/<system>/CLAUDE.md` (invariants, provenance, lessons) then the task files. `docs/rebuild/reference/stores.md` is the derived catalog; code wins.
4. `docs/migrations/<id>.md` if present (separations is the worked example — §1 questionnaire, §9 live records) and the workflow's node in `docs/roadmap/roadmap.md` (status, `you:` lines, `log:` lines).
5. The reference docs it cites: `workflow-model` (run state machine, §5.4 validation/resume), `write-safety` (beats ①–⑦, §3.2 controlled-commit proof, §14 gate), `execution-and-sessions`, `guards-and-tests` §10 (test tiers), `dashboard-surfaces`.
6. `docs/rebuild/reference/lessons.md` — grep the workflow id and each system; every hit becomes a line in "Known failure modes".
7. `config/test-subjects.json` (when it exists) and `tests/scenario/*<id>*` — canary labels and what the existing scenarios assert.
8. The platform-wide rails live in `hr-manage` and `hr-debug` — read their SKILL.md once so the generated skill references them instead of restating them.

Stop when you can fill every template section from evidence. A section you cannot fill gets `UNKNOWN — <what to read/run to fill it>`, never a guess.

## 2 · Decide the short id

`hr-<short-id>` where short-id drops the `separations-` family prefix only when unambiguous: `person-lookup` → `hr-person-lookup`; `separations-kuali-finalization` → `hr-kuali-finalization`; `separations` (the composed graph) → `hr-separations`; `kuali-timekeeper-annotation` → `hr-kuali-timekeeper`. Say the mapping in your recap.

## 3 · The template (write it filled-in; delete the `<…>` hints)

```markdown
---
name: hr-<short-id>
description: Run, dry-run, monitor, test, debug and record the `<workflow-id>` workflow of hr-automation-rebuild — <one clause: what it reads/writes, which systems>. Built on hr-manage (run/monitor/batch), hr-debug (failures), hr-scan (document intake) and hr-lesson (operator-invoked). Invoke on `/hr-<short-id>`, or any request to run / dry-run / prove / fix / test `<workflow-id>` <and its plain-English names>.
---

# /hr-<short-id> — `<workflow-id>`

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

## Known failure modes (from ref lessons + migration doc + store CLAUDE.md)
- <date / D-number: one line each — the symptom, the cause, where the fix lives. Link the lesson.>
- Debug anything new with hr-debug; selectors via its selector-repair loop; never "add a longer wait" first.

## Live record
- <dated lines: run/trace ids, subject label, dry/controlled, durable counts, result — copied from docs/migrations/<id>.md §9, newest first>

## Record when you are done
- dated line in `docs/migrations/<id>.md`; tree node status block + `npm run roadmap` (notation: `docs/roadmap/notation.md`) in the same commit; store/dashboard CLAUDE.md only for invariants; lesson-worthy findings → tell the operator ("this looks lesson-worthy: …") — `/hr-lesson` is theirs to invoke.
```

## 4 · Verify the generated skill

- Frontmatter parses; name matches the directory; description ≤ ~600 chars.
- Every path it cites exists (`ls` them); every node in the table exists in the descriptor (count matches).
- No secret values, no EIDs, no document numbers of real people outside the "Live record" lines the migration doc already carries.
- Recap: the file path, the short-id mapping, the sections left `UNKNOWN` and what fills them.

## Refresh mode (`/hr-workflow <id>` when `hr-<short-id>` exists)

Regenerate Graph / Inputs / Dry run / Tests from the current tree; preserve and append to Known failure modes and Live record; diff the old and new file in the recap so the operator sees what moved.
