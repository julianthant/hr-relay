# Control registries

These frozen registries admit work before runtime composition. They do not operate a browser.
`workflow-registry.ts` owns registered workflows; `test-target-registry.ts` parses and freezes the
`subjects` member of `config/test-data.json`, loaded by `test-data.ts`, the ONE test-data reader
(D341). Private test inputs come only from ignored `config/test-data.local.json` through the opaque
`TestDataInputSource` (private half in `src/infra/config/test-data-local.ts`), never from Settings,
credentials or `.env`. Read `ref guards-and-tests` §10.5 for the detour's acceptance status and the
actual owners for current exports, labels, schema versions and availability; never cache those
changing facts in instructions.

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
  Resolve the document through the real start-box parser. Explicit reread metadata may use the
  descriptor's existing canonical ingress; never invent or increment its ordinal during resolution. The standalone
  finalization arm stays blocked by its declared missing facts; never fabricate a ready input.
- Maintain the manifest/registry/CLI correspondence in both directions. Preserve named blocked
  reasons and the observation date without leaking secret values.

Before admission changes, read `docs/rebuild/reference/guards-and-tests.md` §10.5 and the registry's
unit/architecture tests. Search [LESSONS.md](LESSONS.md) for historical failures; requested new
lessons go there. Root rules apply.
