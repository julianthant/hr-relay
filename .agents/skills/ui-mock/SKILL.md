---
name: ui-mock
description: >-
  Use this skill when the operator wants to see and pick between design variants of a Relay
  dashboard screen, panel or control before it is built: it builds the variants inside the mock
  harness from the real components and synthetic fixtures, renders them, and hands the frames over
  for the operator's pick. Not for building or wiring an approved design, or standalone HTML
  mockups.
metadata:
  exposed: "true"
---

# ui-mock — variants in the real dashboard

Read [DESIGN.md](../../../src/dashboard/DESIGN.md), the
[dashboard instructions](../../../src/dashboard/AGENTS.md) and [MOCKS.md](../../../src/dashboard/MOCKS.md)
first. Open the specimen page (`npm run web`, then `http://localhost:5174/kit.html`) before choosing
primitives.

## Rules

- Work on a `design/<area>` branch. Never merge it or open a PR.
- Build every variant in the running dashboard through the mock harness. Never write standalone
  HTML and never rebuild an existing component by hand.
- Use only existing components, primitives, tokens and variants. Keep every real element of a
  component you extend (footers, IDs, timings, icons); add to it, never drop parts. Give each
  control one home. When a mock file sits outside the CSS build's scan, check that each utility
  class it uses exists in the built stylesheet; otherwise use an existing class.
- Desktop only: 1280×720 and the 1024×720 minimum. No phone or touch variants.
- Fixtures are synthetic and fictional; `npm run privacy:check` must pass. Reuse synthetic IDs that
  passing fixtures already use.
- Missing served data is a backend or projection gap: list it in the report. Never design a
  control or placeholder around it.
- Mock frames are evidence for the operator's pick; they are never stored as test references.

## Build

1. Make three directions by default, two when extending an existing screen. Each set answers one
   design question (where a control lives, how evidence is grouped) and varies layout, hierarchy
   or interaction, never only order or color. Name each direction with its benefit and cost.
2. Make every scenario coherent: queue row, status, header, timeline and Logs tell the same story,
   and only actions valid in that state appear.
3. Put the switch behind the harness. Product surfaces read a variant or scenario with
   `mockParam(<name>)` from `src/dashboard/app/mock-surfaces.ts`, which returns `null` unless
   `tests/mocks/app-entry.tsx` set the harness flag, so a served dashboard never shows a mock.
   A standalone control goes in `tests/support/helpers/dashboard/controls/<name>-preview.tsx`,
   exporting `ControlPreview` and opened at `/?fixture=<name>&state=<scenario>`. Fixture data lives
   beside the surface's existing mock or fixture files.

## Render

- Add or extend a scene spec in `tests/mocks/` modelled on `zz-status-mock.test.ts`: start
  `startFixtureServer` from `tests/support/helpers/dashboard/fixture-bff.ts` on `MOCK_DIST_DIR`,
  set `relayMockTheme` per theme, load each variant and scenario, and write PNGs to an output
  folder taken from an environment variable.
- Run it alone: `npm run mocks -- <spec> -g "<title>"`. Each run rebuilds
  `dist/mock-dashboard`. Follow the local operations note's limits for local renders.
- Capture every variant and scenario light and dark at 1280, and at 1024 where layout changes, into
  the task's `.work/` folder. Look at every frame before handing it over.

## Hand over

Write an index beside the frames listing each surface, variant and scenario with its benefit and
cost, the backend gaps and open behavior choices, and a recommended pick. Record it on the ticket
and wait for the operator's pick. Before handing over, run typecheck, lint on changed files and
`npm run privacy:check`.

The pick then follows the dashboard instructions: only the chosen variant is built, in a UI-only
task with mock data and its unit tests, before wiring. Remove the mock switch and scene
spec after the implementation ships unless the operator keeps them.
