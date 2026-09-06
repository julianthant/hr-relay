# Fixture plan — the clean tree
asOf: 2026-08-20
head: fixture
eyebrow: roadmap-doc-binding fixture
footer: A miniature repo read by tests/unit/architecture/roadmap-doc-binding.test.ts. Not the plan.
source: docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md step 4b
> Three nodes, every ref resolving: a phase citing a heading by NAME, a task citing both shelf halves, a sub-task citing a section RANGE.

<!-- roadmap:start -->

## The fixture phase {#fx-phase}
phase: Phase F
status: active
when: 2026-08-20 | the fixture's own clock
open: no
doc: 3.1 §Phase summary

> A phase node. A phase may omit its doc: ref; this one carries the phase doc's summary section, which every phase doc has.

builds:
- [x] DOCS the mini shelf this fixture reads

### The fixture task {#fx-task}
status: planned
doc: 3.1 §The wire · ref:write-safety §2

> A task node — the one arm (c) requires to carry a doc: ref.

builds:
- [ ] BE the thing the task builds

#### The fixture sub-task {#fx-range}
status: planned
doc: ref:write-safety §2–3

> A sub-task citing a RANGE, whose two endpoints must both be real heading numbers.

<!-- roadmap:end -->
