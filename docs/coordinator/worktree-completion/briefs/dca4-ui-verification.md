# DCA4 UI completion ledger

Supervisor visual inspection, 2026-08-30. Route: `/ui` → established product UI,
Operate mode → states/hardening and craft floor → repository parity + browser verification.
The incumbent DS, both themes and frozen metadata remain authoritative; this is not a redesign.
Stack: React 19 / Vite / Tailwind 4 / TypeScript / Lucide / Radix; no new design system.
WIG fetched live from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`.

## Open numbered issues

1. Both inherited screenshots (desktop dark 1280×720 and phone light 390×844) contain a broken
   image while claiming verified retained bytes. The fixture must serve bytes belonging to the
   exact archived capture. Prove decode (`naturalWidth`/`naturalHeight`) before screenshot capture;
   prove the download bytes. The initial fixture's first-map-entry substitute is unacceptable.
2. Metadata success and the subsequent image HTTP/decode result are separate facts. A failure
   of that subsequent load must be visible, never a broken image with an unqualified success claim.
3. Screenshot references are misplaced in the standard spec snapshot folder. This repository's
   parity config consumes `tests/parity/references/`; account for the two original PNGs and all
   a11y/meta pairs without weakening assertions or silently retaining unconsumed proof.
4. Prove available, missing and corrupt/refused states; retain frozen metadata in every arm.
   No purge tombstone exists, so no retention-clock-derived “purged” state may be invented.
5. Prove stale/foreign responses cannot attach to another tile or a reopened dialog. Validate
   exact resource URL identity, not merely echoed ids. No arbitrary URL trust at the UI boundary.
6. Prove keyboard operation, Escape and focus return; no footer overflow at phone/narrow width;
   44px touch targets without overlapping neighbors; image dimensions reserve truthful space.
7. Initial typecheck error: `tests/parity/helpers/fixture-bff.ts:242`, typed bytes vs BodyInit.
   Use a safe typed body conversion, no unchecked assertion. Initial lint errors: unnecessary
   assertions in `archive-detail-render.test.ts:30` and `archive-render.test.ts:307`.

Final unit report must resolve each number with a test/artifact or name a real blocker. Inspect the
actual rendered screenshots. Use narrow `test:parity:update` only after attributing changes, then
assert without update. Do not rewrite the unrelated corpus to obtain green.
