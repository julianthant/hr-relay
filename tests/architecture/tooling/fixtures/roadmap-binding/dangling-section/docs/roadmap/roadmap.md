# Fixture plan — a doc: ref naming a section that does not exist
asOf: 2026-08-20
head: fixture
eyebrow: roadmap-doc-binding fixture
footer: A miniature repo read by tests/architecture/roadmap-doc-binding.test.ts. Not the plan.
source: docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md step 4b
> Two refusals of one shape: a section 3.1 does not have at all, and a section it has under a LONGER title — the second is the common miss, so the refusal names what the file does have.

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
doc: 3.1 §Not a heading here

> A task node — the one arm (c) requires to carry a doc: ref.

builds:
- [ ] BE the thing the task builds

#### The fixture sub-task {#fx-range}
status: planned
doc: 3.1 §Phase

> A truncated heading: right about the section, short of its title.

<!-- roadmap:end -->
