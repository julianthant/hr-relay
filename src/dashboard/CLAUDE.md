# `src/dashboard/` — the operator dashboard (browser bundle)

Everything under this directory is reachable from a browser entry (`index.html`, `capture.html`),
so it may import only pure contracts from `src/domain/**` — never a Node built-in, never a server
module (`dashboard-wire-boundary` walks the closure and fails loud). `DESIGN.md` is binding for
anything visual: read it before building a surface.

## Layout

| Path         | Contents                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | the app shell: `main.tsx` mounts `dashboard-app.tsx`; URL/nav state, global keys, command dispatch, panel-section hooks, `index.css` |
| `surfaces/`  | every operator surface — see the pairing rule below                                                                          |
| `ds/`        | the design system: tokens (`tokens.css`/`tokens.ts`), primitives (`primitives-*.tsx`), theme, and the ONE barrel `ui.tsx`     |
| `client/`    | the BFF client: transport, queries, commands, day-state subscription, typed errors                                            |
| `state/`     | React-side resource hooks over the client (`use-bootstrap`, `use-dashboard-day`, `use-run-detail`, `client-context`)          |
| `lib/`       | framework-free helpers (`utils.ts` for `cn`, `preference-storage.ts`)                                                        |
| `phone/`     | the token-scoped phone capture page — its own entry, its own closure (`capture.html`); may not reach `surfaces/`, `client/`, `app/` |

## The surface / model pairing rule (React Fast Refresh)

A module under `surfaces/` or `app/` with a `.tsx` extension **exports components only**. Its
hooks, pure folds, vocabularies (`Record`/array constants) and wire-derived types live in a sibling
`<surface>-model.ts` — e.g. `queue.tsx` / `queue-model.ts`, `shell.tsx` / `shell-model.ts`. Shared
pure modules that serve several surfaces stay as plain `.ts` beside them (`format.ts`,
`layout-metrics.ts`, `workflow-category.ts`).

**Why:** `@vitejs/plugin-react` treats a module as a Fast Refresh boundary only when every export is
a component or is reference-equal across re-evaluation. One exported helper, hook or object constant
makes the module refuse the update, and the invalidation climbs to `dashboard-app.tsx` — the whole
app remounts and loses its state on every save. `dashboard-refresh-boundary.test.ts` (ref frontend-backend-integration §8.14)
enforces the rule; `ds/ui.tsx` is out of its scope on purpose (one barrel for the whole system is
worth the occasional full remount when a primitive changes).

Type-only exports are erased and are legal anywhere. A module-private helper or constant inside a
`.tsx` file is fine; only **exports** decide the boundary.

## Commands

```bash
npm run dashboard   # BOTH in one terminal: the BFF (3938, /api/v1/* + the SSE day stream) and vite (5174); Ctrl+C stops both
npm run cli -- dashboard   # the BFF alone
npm run web         # the vite dev server alone (proxies /api to 3938 — ECONNREFUSED there just means no BFF is up)
npm run web:build   # production bundle into dist/dashboard (the parity lane builds this itself)
npm run test:parity # ref frontend-backend-integration §7 visual/a11y parity lane
```

## Lessons learned

- **2026-08-21: an HTTP status decided by reading an error MESSAGE is a protocol keyed on prose, and
  every surface that renders a refusal inherits the mistake (Track D row D2, audit C3).** The BFF's
  `failureStatus` classified every throw by substring — four phrases meant 404, `"is not available"`
  meant 409, `"degraded"` meant a retryable 500 — so rewording an operator-facing sentence moved its
  status, a new producer phrasing the same refusal differently silently got a 500, and NOTHING in
  the gate family could fail when either happened. The kind now travels with the throw
  (`src/server/failures.ts`: `TargetNotFoundError` / `SectionUnavailableError` /
  `ProjectionDegradedError`) and `routes/failure-status.ts` maps by `instanceof`. Two things
  generalize past this file. **The negative control is the test that matters**: the pinned case is a
  plain `Error` wearing each retired phrase answering 500, because the arm that used to be wrong is
  the arm nobody would write a test for. And **a mapping worth testing is worth extracting** — the
  function moved out of `api.ts` into its own module for no reason other than that the claim ("a
  reworded refusal cannot move a status") is about the mapping, not about any one route, and a test
  that has to compose a whole app to reach it would have been written against one route and left the
  rest unpinned. The same commit's other half is the shape D181 named: a scope gate is only
  enforcement if something SUPPLIES its precondition, so the capture phone-host gate's producer is
  now pinned by the guard beside the gate's own behaviour, not assumed.

- **2026-08-20: a fetched value is a fact about the MOMENT it was fetched, and three surfaces here
  read one as if it were standing (D256/D257 and §9.22 item 3).** The first time this dashboard was
  driven against a real composed run, all three of its defects were the same mistake: the right KIND
  of fact, read from the wrong INSTANCE of it. `boot.serverClock.now` is the instant one bootstrap
  fetch happened at, and every live elapsed computed against it, so the whole screen's clock stopped
  at page load — a parked run read `0s` for two minutes, because the tab predated the run and
  `elapsedSecondsBetween`'s clamp turned a negative difference into a plausible zero. The run-detail
  wire is the run as of the last thing the operator clicked, and nothing re-read it from the day
  stream, so an open panel said `Queued` beside a row saying `Done · took 8m 20s` and never offered
  the receipt. And `boot.descriptorHash` is the whole descriptor SET's hash, compared against ONE
  run's `contractFingerprint`, so the "shape moved" hazard was on for every run ever drawn. Three
  rules travel. **A page's now must be DERIVED, not received**: keep the server's instant as the
  authority and add the browser's monotonic time since it arrived (`state/served-clock.ts`) — one
  hook, called once, passed down, because a component reading its own `Date.now()` puts a second
  clock on one screen. **A surface that renders a live thing needs a live key**: the day stream
  already carries every run's `rowRevision`, so following it is a dependency, not a poll. And
  **before comparing two hashes, check they are the same kind of hash** — this one could never be
  equal, and a warning that can never NOT fire trains the eye past the one that matters. Two habits
  that made the fixes safe are worth copying: the parity lane pins the OTHER half of the clock
  (`installFrozenMonotonic` + `assertMonotonicFrozen` in `tests/parity/helpers/app-driver.ts`), so a
  ticking elapsed renders exactly the fixture's served instant and no reference moved; and every
  decision landed as a pure exported fold (`deriveServedNow`, `planRunDetailFollow`,
  `classifyRunShape`) because this tree renders no React in the unit lane, so anything left inside a
  component is pinned only by a screenshot.
- **2026-08-20: a `.then()` that handles one refusal arm calls the other one success (D253).** Two
  surfaces here — the Context rail's Data save and the notification bell — branched on
  `result.state === "rejected"` and let the CAS `conflict` arm fall through to the code that runs on
  success. The rail closed its editor, cleared the drafts and reported a correction saved that the
  kernel refused. **All nine command-issuing surfaces in this directory now settle through
  `app/command-result.ts`'s `settleCommandResult`** (Track D row D3, 2026-08-21 — this bullet said
  so on the day D253 landed, while seven of the nine still enumerated the arms by hand, which is
  exactly why the correction was BOOKED as a row rather than left to be discovered by whoever
  believed it). `command-result-exhaustive.test.ts`
  holds it in two arms: a module may not name one refusal arm without the other (both `===` and
  `!==` count; `archive.tsx`'s negated early return is exhaustive and clean), AND a module that
  calls `.executeCommand(` must import the fold — the second arm exists because a module naming
  NEITHER arm passed the first one while landing every refusal on its success path.

  **When you add a surface that posts a command, read the result through the fold — do not
  re-enumerate the arms.** The fold answers `applied` or `refused`, and a refusal carries both the
  composed one-slot `problem` sentence AND the server's own `message` / `code` / `currentVersion`,
  so drawing a refusal in your own components costs you nothing and never re-decides the verdict.
  What the fold does NOT own is COPY: `problem` adds the version sentence, `message` is the wire's
  own, and the seven surfaces D3 converted deliberately kept `message` because the parity corpus
  photographs one of their refusals.
- **2026-08-20: the rail's "we cannot serve this" comments were about the checkpoint row, not the
  descriptor (D252).** `context-rail.tsx` recorded direction and system as unservable for years. The
  checkpoint row genuinely carries neither — but the node that wrote it declares a task contract
  (`effect`) and the store implementing that task declares the system, and both reach the run-detail
  query through `RunDetailDescriptorView.dataOrigins`, composed at the root because a descriptor may
  not reach a store (D106). If a surface comment here says a fact has no producer, check the
  descriptor and the module before believing it.
- **2026-08-21: "the bundle already carries it" is an argument about ONE source that quietly costs a
  whole composition root — and the IMPORT is what makes the bundle a source (D264 row D11, amending
  D251).** D251 (below) refused three run-modal wire rows because `summary`, `enqueue` and
  `surfaces.inputRun` are plain data on `AnyWorkflowDescriptor`, and serving them would give one
  surface two sources for one value. The two-sources rule was right and the price was never
  measured. A descriptor's plain data does not travel alone: `WORKFLOW_DESCRIPTORS` pulls every
  registered workflow's whole graph, node specs, task contracts and the `src/base/**` builders that
  mint them, so the browser downloaded the composition root to render three fields — **1,114,214
  bytes, 753,197 after the import was deleted.** The fields now ride `WorkflowStartWireSchema` on the
  boot document, projected at the composition root from the same descriptor the daemon plans with,
  so there is still exactly one source. Three things travel. **Serving a fact does not change where
  its bytes came from**: the redaction audit demanded an origin for seven new free-text leaves and
  every one is `repository-authored`, because a descriptor constant is a developer's sentence
  whichever side of the wire it is read on — a guard asking that question at the moment a field
  crosses onto a wire is the guard working. **The rule is held by a CLOSURE arm, not a lint on
  import lines** (`dashboard-wire-boundary` (15)): one shared helper re-exporting a descriptor puts
  the whole tuple back with nothing in the diff that reads like a registry import, which is arms
  (13)/(14)'s lesson a third time. And **a served fact retires a client default**: the modal's
  `enqueue: descriptor?.enqueue ?? "reject-active"` was a fail-closed guess standing in for a fact
  the server always had, so `enqueue` is REQUIRED on the block and the `??` is gone. `run-start.tsx`
  needed no edit — the composed `RunStartWorkflow` is identical field for field.

- **2026-08-20: a fact the browser bundle already carries does not need a wire, and booking one as
  "unserved" invents backend work nobody owes (D251 — see the D264 amendment above; the sentence
  "`surfaces/run-start.tsx` composes its catalogue from `WORKFLOW_DESCRIPTORS`" is no longer true of
  this tree, and the rest of the entry stands).** Three run-modal rows sat on the detail-audit
  ledger as wire gaps — the workflow's own sentence, its active-run policy, and the reason an
  unstartable workflow is not offered. All three were already reachable: `surfaces/run-start.tsx`
  composes its catalogue from `WORKFLOW_DESCRIPTORS`, and `summary`, `enqueue` and `surfaces.inputRun`
  are plain data on `AnyWorkflowDescriptor`. Serving them a second time over the bootstrap would give
  one surface two sources for one value, which ref frontend-backend-integration §8.2 already forbids. The unstartable reason was
  worse than unserved: `dashboard-app.tsx` had been composing it since the picker landed and the
  surface dropped it, under a comment claiming the tree served none — **a false deferral comment is
  the same defect as a missing feed, and it is the harder one to find, because it tells the next
  reader not to look.** Two rules travel. Before booking a wire row, check whether the descriptor
  bundle answers it. And when a demo control has no server that would honour it — the demo's
  `Active-run policy` select against a `descriptor.enqueue` the planner reads with no per-start
  override — draw the FACT read-only in the control's slot rather than the control: an operator choice
  the server ignores is a wrong value about what is being started.
