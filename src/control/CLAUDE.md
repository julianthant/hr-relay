# `src/control` — the registries a run is judged against before it starts

Two frozen, config-backed registries. Neither drives a browser; both are read before anything
composes a runtime, so a bad answer here is a refusal, not a live mistake.

- `workflow-registry.ts` — the built workflows.
- `test-target-registry.ts` — the **test subject registry** (`ref guards-and-tests` §10.5). It parses
  and recursively freezes `config/test-subjects.json` at module load and exports
  `TEST_TARGET_REGISTRY`, `readTestTargetRegistry` (the repo-root form the CLI uses) and one
  resolver per workflow arm: `resolveSeparationsKualiFinalizationTestTarget` and
  `resolveSeparationsTestTarget`.

## The test subject registry, in one screen

- **One subject, one label (D284).** `config/test-subjects.json` holds exactly one entry today:
  `finalization-canary`, Kuali doc 4537, `available` on its 2026-08-28 read-only re-verification.
  The eight other labels were removed outright — there is no alias, no second registry and no
  label-based guessing of a workflow.
- **Labels in the repo, values outside it.** An entry names a label, its `purpose`, ONE dated
  `availability` claim, the migration section that observed it, and D85's usage rules. A Kuali
  document number is not a person and lives here; an **EID never does** — it is a `secretInput`
  reference resolved only through `src/domain/secrets.ts` from an ignored `.env`.
- **An entry is a subject; `workflows` holds one arm per workflow that can address it.** The
  `separations-kuali-finalization` arm carries the finalization ingress minus its two EID leaves,
  its EID references, and `pending`; the `separations` arm carries the chain subject's document
  (`present` with a number, or `absent` with a reason). Both arms are optional and at least one is
  required, so a subject two workflows can drive is ONE row, not two. `availability` is
  subject-level on purpose: whether the document still exists is a fact about the world, not about
  a workflow. Adding a workflow means adding an arm, not loosening a field.
- **`pending` is how the registry says "true, and not ready".** The finalization arm declares the
  canonical leaves a live read cannot supply — `transactionNumber` (only exists once the UCPath
  filing ② files it) and `timekeeperComments` (composed by the chain) — each with its reason. A
  declared-pending leaf resolves `blocked` BY NAME, before any secret is read. An **undeclared**
  missing leaf stays a registry defect. `schemaVersion` is `2`.
- **A gone subject keeps its row.** `availability.state` is `available` · `consumed` · `gone` ·
  `unknown` with the date it was last observed. Deleting an evaporated subject deletes the history
  that it evaporated — doc 03b records that happening twice (docs 4510 and 4524).
- **Blocked, never failed** — an unresolvable label reports `blocked: needs <label>`, because a
  canary leaving the university is not a defect in the workflow. A subject that is available but
  not yet runnable reports
  `blocked: needs <label> for <workflow>; <field> <reason>, last observed <date>`.
- **One resolver per arm, because the ingress shapes differ.** Both resolvers answer under the SAME
  label and each reads only its OWN arm; asking a resolver for a subject that declares no arm for
  its workflow is refused by name. The finalization resolver assembles a canonical input field by
  field and merges two EID references. The chain's ingress is ONE typed
  Kuali document number (D261), so `resolveSeparationsTestTarget` feeds that number through
  `separationsDescriptor.surfaces.inputRun.parser` — the operator's real start box — and parses the
  result through the descriptor's own ingress and canonical schemas. `timekeeperName` therefore comes
  from the descriptor's `constants[]` and `searchTimeoutMs` from the ingress default; a rehearsal
  cannot start from an input a real run would never produce. No EID crosses this arm at all.
- The guard is `tests/unit/architecture/test-target-registry.test.ts` — which also WALKS every
  `tests/scenario/workflows/*/dry-run.scenario.ts`, evaluates each declaration without importing it,
  and pins the manifests, `config/test-subjects.json` and `src/cli.ts`'s registration against each
  other in both directions; the unit half is `tests/unit/test-target-registry.test.ts`.

## Lessons

- **2026-08-27 — a label that exists but belongs to another workflow is not a decayed canary.**
  `resolveSeparationsKualiFinalizationTestTarget` finds a target by label alone. When the registry
  grew subjects for the composed `separations` chain, asking the finalization resolver for one of
  them fell through to "missing secret EID reference" — a registry-defect message about the wrong
  thing, and reporting it `blocked` would have read as *the subject left the university*. It now
  refuses BY NAME with both workflows in the message. The rule generalises: when a lookup key stops
  being unique across a dimension, the resolver must check that dimension before it interprets what
  it found (D85 · `ref guards-and-tests` §10.5).

- **2026-08-28 — one subject with per-workflow arms, not two entries and not an alias (D284).**
  Doc 4537 had to be addressable by the composed `separations` chain AND by
  `separations-kuali-finalization`. The union-on-`workflow` entry schema could express that only as
  TWO entries — two labels, two `availability` claims, two dated reasons about the SAME document —
  which is exactly the drift the registry exists to prevent: one row could go `gone` while the
  other still claimed `available`. The alternative considered and rejected was an alias (a second
  label pointing at the first): an alias makes a lookup ambiguous and puts the workflow choice back
  into a *name*, which is what D85 forbids. The shape that survived is the subject: identity plus
  ONE availability, and a strict `workflows` object with one arm per workflow. The compatibility
  check moved with it — a manifest case is now judged against `(label, workflow, kind)` on the ARM,
  not on the entry.

  The second half is why the finalization arm **blocks** rather than defects. 4537 has no
  transaction number until the UCPath filing ② runs, and its finalization comments are composed by
  the chain — so the canonical input genuinely cannot be assembled today. Fabricating either value
  would file a real termination against a wrong number; throwing "registry defect" would blame the
  registry for telling the truth. The entry therefore DECLARES both as `pending` with a reason, and
  the resolver reports `blocked` naming the label, the workflow, the missing field and the
  observation date — before it touches a credential, because a run that cannot start must not spend
  one. A missing field the entry did NOT declare is still a defect, by label and date, unchanged
  (D284 · D85 · `ref guards-and-tests` §10.5).
