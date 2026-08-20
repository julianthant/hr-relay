# Fixture plan — a node no doc section describes
asOf: 2026-08-20
head: fixture
eyebrow: roadmap-doc-binding fixture
footer: A miniature repo read by tests/unit/architecture/roadmap-doc-binding.test.ts. Not the plan.
source: docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md step 4b
> The task's ref resolves; no section anywhere in the mini shelf carries its tag.

<!-- roadmap:start -->

## The fixture phase {#fx-phase}
phase: Phase F
status: active
when: 2026-08-20 | the fixture's own clock
open: no
doc: 03a §Phase summary

> A phase node. A phase may omit its doc: ref; this one carries the phase doc's summary section, which every phase doc has.

builds:
- [x] DOCS the mini shelf this fixture reads

### The fixture task {#fx-task}
status: planned
doc: 03a §The wire

> A task node — the one arm (c) requires to carry a doc: ref.

builds:
- [ ] BE the thing the task builds

<!-- roadmap:end -->
