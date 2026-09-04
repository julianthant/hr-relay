# Operator decision context

This folder is a compact record of operator choices that need more context than the canonical
decision pointer can carry. It is **not** a second decision ledger and none of its files is
normative.

The authority chain is:

1. `docs/rebuild/reference/decisions.md` records one numbered pointer.
2. The reference or phase doc named by that pointer owns the normative contract.
3. A topic file here may retain the operator's answer, rejected alternative, or run-local context.

## Reuse before create

Edit an existing topic file whenever the choice belongs to one of the topics below. Do not create a
dated file, an answer-only companion, a receive sheet, or a new file for each run.

A new topic file is justified only when all three conditions hold:

- the decision is hard to reverse, surprising without context, and resolves a real trade-off;
- none of the existing topic files can hold it without mixing unrelated authorities; and
- the same commit adds the numbered pointer and normative text to their canonical owners.

Open questionnaires are temporary working material. Keep them in the active coordinator/status
artifact, then fold the answer into the matching topic file. Run scheduling, branch integration,
one-off diagnostic scope, and similar reversible operational choices stay in the plan, board, or
report that owns the run; they do not create new files here.

## Topics

| File | Context retained here |
|---|---|
| `dashboard.md` | Dashboard fidelity, worker-pool presentation, UI exceptions, completion scope, reporting identity |
| `live-verification.md` | Separations canaries, test-subject admission, controlled-write prerequisites, bounded live-run calls |
| `workflow-authoring.md` | Step omission, workflow-definition authoring, recovery, entry algebra, terminology |
| `phase-governance.md` | Phase-close and transition decisions |

The former 25 dated sheets were consolidated into these four topics on 2026-09-03. Their full text
remains available in git history; the canonical ledger and owning docs remain the source of truth.
