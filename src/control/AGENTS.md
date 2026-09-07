# Control registries

These frozen registries admit work before runtime composition. They do not operate a browser.
`workflow-registry.ts` owns registered workflows; `test-target-registry.ts` parses and freezes
`config/test-subjects.json` in the current implementation. D341’s approved detour moves that
registry into shared test configuration and separates private test inputs from application settings;
read `ref guards-and-tests` §10.5 for completion status. Read the actual owners for current exports,
labels, schema versions and availability; never cache those changing facts in instructions.

## Admission rules

- One subject has one label and one dated availability claim, with workflow-specific arms.
  Validate the requested label, workflow, and scenario kind together before interpreting input.
- Gone/unknown/consumed subjects and declared-pending leaves block by name before secret access or
  browser launch. Wrong workflow/manifest bindings and undeclared missing leaves are defects, not
  decayed subjects. An empty pending declaration is invalid; derive reporting from its schema.
- Keep authored facts separate from observed facts. The composed Separations case resolves one
  closed document-number reference through the current typed test-target reader and derives person facts live.
  Never commit person values or replace retired person inputs with a document number.
- Resolve through the actual descriptor's ingress/canonical schemas, constants, and defaults.
  A rehearsal cannot start with an input the real start box cannot produce. The standalone
  finalization arm stays blocked by its declared missing facts; never fabricate a ready input.
- Maintain the manifest/registry/CLI correspondence in both directions. Preserve named blocked
  reasons and the observation date without leaking secret values.

Before admission changes, read `docs/rebuild/reference/guards-and-tests.md` §10.5 and the registry's
unit/architecture tests. Search [LESSONS.md](LESSONS.md) for historical failures; requested new
lessons go there. Keep this file and `CLAUDE.md` identical; root rules apply.
