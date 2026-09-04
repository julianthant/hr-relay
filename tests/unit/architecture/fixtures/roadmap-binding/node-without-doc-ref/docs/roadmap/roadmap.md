# Fixture plan — a task with no doc: ref
asOf: 2026-08-20
head: fixture
eyebrow: roadmap-doc-binding fixture
footer: A miniature repo read by tests/unit/architecture/roadmap-doc-binding.test.ts. Not the plan.
source: docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md step 4b
> The task carries no doc: line, so nothing says which contract it builds. Its phase sibling proves the exemption is real.

<!-- roadmap:start -->

## The fixture phase {#fx-phase}
phase: Phase F
status: active
when: 2026-08-20 | the fixture's own clock
open: no
doc: 03.1 §Phase summary

> A phase node. A phase may omit its doc: ref; this one carries the phase doc's summary section, which every phase doc has.

builds:
- [x] DOCS the mini shelf this fixture reads

### The fixture task {#fx-task}
status: planned

> A task node — the one arm (c) requires to carry a doc: ref.

builds:
- [ ] BE the thing the task builds

<!-- roadmap:end -->
