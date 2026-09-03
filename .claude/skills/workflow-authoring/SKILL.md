---
name: workflow-authoring
description: 'Internal checklist for adding or changing a workflow in hr-automation-rebuild: routing the change, reusing tasks, the four authored artifacts and two registration lines, writing workflow.ts, omissions, the T1 pair and live dry run, and what each red gate means. Points at the canonical guide and spec; adds no policy of its own.'
user-invocable: false
---

# workflow-authoring — pointer

Internal repository helper, not an operator command. It adds no policy: the canonical sources are

- `docs/guides/workflow-authoring.md` — the practical guide (API, examples, gate table, routing).
- `docs/rebuild/reference/workflow-model.md` §§1.6, 5.6, 5.8 — normative.
- `docs/rebuild/03c-migrate-the-remaining-workflows.md` `{#workflow-authoring-model}` — routing.

**Read the checklist first:** `.agents/skill-library/workflow-authoring/REFERENCE.md`. It is the
ordered loop (route → reuse → four artifacts → `workflow.ts` → omissions → new task → T1 pair and
live dry run → gates → debug → record) with a one-line pointer per step, plus the "never" list.

Where this helper and the guide/spec disagree, the guide and the spec win. Selector and page-state
failures belong to `hr-debug`, not here.
