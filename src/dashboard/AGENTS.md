# Operator dashboard

The browser app. Everything here runs in the browser.

## Imports

- Import only browser-safe models and rules from `src/models/**`, `src/rules/**` and
  `src/workflow-kit/**`. Never import Node or backend code.
- `kit.html` is a separate entry. It imports only `ds/**` and `lib/**`.

## Where things live

- `app/`: shell, navigation (the one URL and history owner) and command dispatch.
- `surfaces/<feature>/`: each feature's components, its `*-model.ts` files, styles and mock producer.
  `surfaces/shared/` holds only what several features actually use.
- `client/`: the backend transport. `index.ts`, `queries.ts` and `commands.ts` are the only entry
  points.
- `state/`: resource hooks, bootstrap, day and the served clock.
- `ds/`: the design system. `ui.tsx` is its one barrel; `primitives/` and `theme/` hold the
  implementation.
- `lib/`: framework-free helpers. `kit/`: the design-system preview entry (`kit.html`).

## Rules

- Components never change during wiring. Use every existing component, add none, remove none.
  Feed them real data through their producers, view-model inputs, ports and callbacks.
- The component set is fixed, but what a workflow shows follows the real workflow: the count,
  order, text, branches and sources of Explorer timeline items, Run and Rerun steps and Logs steps,
  built only from existing components. The Explorer timeline comes from the workflow's registered
  definition, never from a hand-written layout.
- If real behavior needs a changed or new component, describe it (what, where, why) and ask the
  operator. Approved components are built first in a UI-only task with mock data and their parity
  references, then wired.
- `.tsx` files under `app/` and `surfaces/` export components only. Hooks, folds, constants and
  vocabulary go in a sibling `*-model.ts`. The `ds/ui.tsx` barrel is the exception.
- Use served data for availability, identity, status and write results. Never invent them in the
  browser. Keep exact run joins.
- Each workflow uses its mock until its own workflow task switches it to served data. Never fall
  back from served to mock.
- The Logs timeline lists every step and action in the order it happened. Steps that don't apply
  stay visible as Skipped.
- Desktop only, with a minimum canvas of 1024×720 CSS pixels: queue beside detail, and the document
  scrolls below that size. No mobile layouts, touch styling or phone test variants. Keep zoom
  behavior and full keyboard access.
- The dashboard has no Archive page, row context menus, version-bump controls or mobile capture.
  A legacy Archive URL shows a removal notice and returns to the dashboard.

## Before a change

Use `/ui`. Read [DESIGN.md](DESIGN.md) and open the specimen page (`npm run web`, then
`http://localhost:5174/kit.html`) before choosing primitives. Read [PARITY.md](PARITY.md) before
judging a visual difference.

## Data and command rules

- Import canonical wire schemas from `src/models/dashboard/**` and command rules from
  `src/rules/commands/**`; never mirror them under the dashboard.
- Keep exact run, attempt, step, record, field, and command identities through every request and result.
- Settle commands through `app/commands/command-result.ts`; an after-dispatch failure is an unknown outcome.
- Retain the last loaded value during refresh, visibly mark stale authority, and disable actions that require fresh authority.
- Key asynchronous results to the request identity and ignore superseded settlements.
- Use declared start capabilities and omission schemas, not workflow-ID tests or copied validators.
- Send omission facts from the canonical schema’s transformed `parsed.data`, never the raw candidate.
- Fingerprint raw omission drafts, including partial edits, so any edit invalidates a settled plan.
- Apply the omission selection cascade exactly once against the new selection.
- Refuse Start when `planOmittedSteps` differs as a set from `sentOmittedSteps`, and name both sets.
- Render missing authority as unavailable or refused; an empty list is a verified empty result.
- Derive browser requirements separately from observed open sessions; unopened slots have no session identity or health.
- Machine-verified identity is not an operator approval; never draw a skipped gate as consent.
- Derive summary counts and their explanations from the same population.
- Clear selection after confirmed deletion so a successful command cannot become a missing-record error.
- Key a shared command-result slot by both target identity and action.
- Derive HTTP classifications from typed error kinds, never operator-facing message substrings.
- Check import closure for browser safety; an indirect registry import is still a backend dependency.
- Check canonical producer/schema fields before declaring a value unavailable or adding a second source.
- Keep schema vocabulary mappings total in both directions and mirror the kernel field its admission reads.
- Derive live time from the served instant plus monotonic elapsed time; compare only matching fingerprint kinds.
- Make verification pointers resolve to current checkout artifacts and commands.
- Keep UI state explicit when no navigation segment applies; never select a plausible substitute.

## Checks

- `npm run dashboard` starts the backend and Vite together; `npm run web` alone needs a running
  backend. `npm run web:build` builds production assets.
- For one surface, run its filtered parity spec. For shared shell, tokens, primitives or models,
  run the full `npm run test:parity`. Run the full suite before the last commit of any dashboard task.
- Parity references are the visual contract. Never update them to make a change pass. Update them
  only for an operator-approved UI change, or when a workflow switches to served data and the
  operator signs off its screens, in its own commit.
- The root `AGENTS.md` checks also apply.
