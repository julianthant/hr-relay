# Operator dashboard

Everything here is browser-reachable. Import only permitted pure contracts from `src/domain/**`;
never import Node or server code. `kit.html` is a separate entry whose closure is only `ds/**`
and `lib/**`, never app/surfaces/client/state. Keep this file and `CLAUDE.md` identical.

## Before a visual or behavioral change

Use `/ui`. Read [DESIGN.md](DESIGN.md) and open the specimen (`npm run web` →
`http://localhost:5174/kit.html`) before choosing primitives. Read [PARITY.md](PARITY.md) before
changing a ruled deviation or judging reference parity. Search [LESSONS.md](LESSONS.md) by the
surface/decision and read matching entries. Requested lessons go there.

## Boundaries

- `app/`: shell, route state, keys, dispatch. `surfaces/`: operator surfaces and their models.
  `ds/`: tokens/primitives and the one `ui.tsx` barrel. `client/`: BFF transport and wire.
  `state/`: resource hooks. `lib/`: framework-free helpers. `kit/`: specimen page.
- `surfaces/**/*.tsx` and `app/**/*.tsx` export components only; hooks, folds, object constants, and
  vocabulary belong in sibling `*-model.ts` files. Type-only exports and private helpers are fine.
  The DS barrel is the deliberate exception. See the Fast Refresh architecture guard and
  `docs/rebuild/reference/frontend-backend-integration.md` §8 item 14.
- D294 retired mobile/phone document Capture Mode. Do not restore its entry, UI, transport, or
  routes. Diagnostic screenshots, Capture tiles and spreadsheet intake remain. The end-user Archive
  page, Run data rail and Receipt tab are retired; legacy Archive URLs show only a removal notice.
  Internal transaction proof, stored history and required run controls remain.
- Use served authority and the shared command/refusal models; do not invent availability, identity,
  status, or write success in the browser. Preserve exact run joins.

## Verification

D340: desktop/laptop only. Do not add mobile-only layouts, coarse-pointer styling or phone/touch
test variants. Keep the 1024×720 CSS-pixel minimum desktop canvas: queue beside detail, document
scrolling below the floor. Preserve desktop/zoom behavior, keyboard access and the desktop parity lane.
The exact retirement/replacement mapping is in ref frontend-backend-integration §10.

`npm run dashboard` starts BFF + Vite; `npm run web` alone needs a BFF. `npm run web:build` builds
production assets. Root typecheck/lint/coverage requirements apply.

For a single-surface change, run its filtered parity spec. Shared shell/tokens/primitives/models
need the full `npm run test:parity` lane. Run the full lane before the last commit of a dashboard
implementation unit. Never refreeze merely to pass: `test:parity:update` requires a deliberate,
reviewed reference change. The lane and exact filters are owned by
`docs/rebuild/reference/frontend-backend-integration.md` §7.
