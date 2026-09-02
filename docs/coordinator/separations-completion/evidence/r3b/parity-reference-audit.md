# R3b parity reference audit

The first assert run failed 208 reference cases while all 79 behavior-only cases passed. Inspection showed the source change moved two reference descriptor-hash families and the served graph facts for the new separation nodes. The deliberate `npm run test:parity:update` path was used only after this classification.

Audit of all 511 changed reference files:

- 456 text references: 198 a11y + 198 metadata references moved the fixture descriptor hash; 30 a11y + 30 metadata references moved the separations descriptor hash. Remaining text changes were served short fingerprints, Explorer node/read/scenario counts, the new `filing-presence` node, the `finalization-committed` structural scenario, and implementation/source-closure hashes.
- 55 PNG references: programmatic RGB comparison found localized changes. Ordinary run pages changed at the rendered descriptor prefix; receipt comparisons changed at their descriptor prefix; Explorer images changed at the affected workflow counts/node region. Representative `explorer-transaction--graphite-warm--1440x900.png` was inspected visually and renders the new **Verify Current UCPath Filing** task immediately before the Kuali transaction.
- No dashboard or other UI source file changed in R3b. The reference update records the changed served descriptor/graph authority.

`npm run test:parity:update` passed 287/287. The subsequent assert-only `npm run test:parity` passed 287/287 in 1.1 minutes. Raw logs: `parity.log`, `parity-update.log`, and `parity-green.log` in this directory.
