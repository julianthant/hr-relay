# Lessons learned — the dated ledger

Cited in prose as **`ref lessons`**. Every entry is dated and names the decision(s) it came out of;
newest first. Moved here from the repository root agent instructions on 2026-08-21 so that a session
loads it on demand rather than on every start. Add new root-level lessons HERE; module-scoped
lessons keep living in the module's own `AGENTS.md` (`src/dashboard`, `src/stores/<system>`).
Read before kernel (`src/core`), driver (`src/stores`, `src/infra/browser`), dashboard, or
write-safety work.

- **2026-08-27: a client-rendered row exists before it says anything — poll for the CONTENT you
  will read, at its LAST render stage, and let the parse keep the veto (§9.20 item 7 → separations
  §9.28; `src/stores/new-kronos/driver/search-render.ts`).** WFD renders an Employee Search slat in
  four Angular digests: host with role and no text → skeleton → tabular card still holding its raw
  `{{…}}` bindings → interpolation. A poll that accepted the host on sight read `""` and refused a
  real person; a second cut that waited for the card element refused the same way under load, because
  the element lands before its text. Cold profiles and busy machines do not cause this, they widen a
  gap that exists on every render (30–108 ms cold, 9–18 ms warm, 214–570 ms throttled; reproduced on
  a WARM search under 20× CPU throttle). The fix is a bounded wait for a NAMED fact — non-empty text with no `{{`, in
  the element that carries the identity — inside the caller's existing bound, with a by-name refusal
  when it elapses mid-render, and with the identity parse unchanged: completion decides when to
  read, never what was read. Generalises D205: terminate on what the answer must contain, and when
  the answer is text, "contains" means interpolated, not present.
- **2026-08-26: an acknowledgement compared against the object you handed the effect-taker is a
  comparison the effect-taker controls (D271; ref execution-and-sessions §"D271 — worker-pool
  process semantics"; the worker pool supervisor contract in `src/core/worker-loop.ts`).** The pool
  executor validated the supervisor's acknowledgement against the SAME member object it had put in
  the request, so a supervisor that mutated the request after submission was checked against its own
  mutation — and a spawn could be acknowledged for a member the command never targeted, while a
  plan's accepted `workerIds` echoed the rewrite. Freeze what you submit and derive what you will
  acknowledge BEFORE the effect-taker sees the request. The same review closed the seam's other
  lies: a scale-down names the exact authoritative excess indices and requires stop coverage of each
  RUNNING excess member (an honest `unmet` fact — crashed or never started, D271's visibly unmet
  declaration — satisfies coverage; there is no process to stop); every mutating control attests
  durable `supervised` ownership and refuses `external` by name; the stop escalation POLICY
  (stages + timeout bounds) is separated from timestamped OBSERVED stages (a strict prefix, ordered,
  non-decreasing instants, none postdating the command's `now` — a malformed `now` refuses by name
  rather than letting `> NaN` silently unbound the check), and an INITIATING stop or plan
  acknowledgement is pinned to the graceful stage alone — later escalations are recorded as they
  occur, never promised in advance, while a plan fact the supervisor attests as `reconciling`
  (schema-pinned `phase`) truthfully reports the policy-ordered escalation prefix that ALREADY
  occurred, so a stop mid-escalation still has a legal honest fact; and the pool seam is awaitable,
  settling only after the process
  effect settles, carrying distinct method names so it can never be mis-wired into the kernel's
  synchronous seam, while the synchronous phase-1 seam refuses a pending promise instead of
  acknowledging an unproved effect.

- **2026-08-26: the wire-connectivity route guard matches by PATH, not method (D274;
  `tests/unit/architecture/wire-connectivity.test.ts`).** `routeMatches` compares paths only, so a
  GET registered beside a client-called POST on the SAME path counts as consumed the moment it is
  served — and declaring it `served-unconsumed` in `config/pending-wire-bindings.json` fails the
  guard from the other direction. The operator capture list (`GET /api/v1/capture/sessions`, beside
  the start POST) is the case that found this: it ships undeclared, while the genuinely uncalled
  `GET /api/v1/capture/sessions/:sessionId` keeps its declaration. Before declaring a new route,
  check whether any client already calls its path under another method.

- **2026-08-25: record time is not append time, and a page cursor must name the corpus it pages
  (D5/D270; observed logs L3).** The span writer partitions on its append clock while an observation
  retains the earlier instant at which the task recorded it. Deriving reader partitions from run
  instants therefore drops a valid late append without an error. Index observed/fenced rows once in
  the append-time disk-tail projection, retain file/line there for named corruption, and make the
  query consume only that run's indexed rows. Pagination is the same class of bug: an offset into a
  mutable sorted JSONL view duplicates or drops an old row when a newly appended event sorts before
  it. Bind continuation to an immutable, bounded snapshot; a fresh first page sees new history.

- **2026-08-25: operator prose containing a closed wire enum must use the same display fold as
  pills (AC24; ref frontend-backend-integration §4 “State ownership”).** Keep the pill's exact label
  available, then apply a total, tested sentence-case fold for prose; never print the transport
  spelling beside a display label.

- **2026-08-20: a structural rule is satisfied by moving the SCHEMA, not by arguing with the rule —
  and the value you were told to type is often already on the page (D261).** D260 proved, correctly
  and normatively, that a typed-text start surface carries exactly ONE varying value per run and that
  `separations` needed two, then named two shapes and handed the operator the choice. The operator
  chose *"document number should work. no need action id."* and the build took **one day**: the id
  became a graph output, read off the Action-List row's `href`. Nothing about D260 was wrong, nothing
  was withdrawn, and `services/start/plan.ts` did not move — the derivation lives exactly where D260
  said any such lookup could only live, one node past the ingress parse. **When a rule blocks a
  feature, the question is which of the rule's INPUTS can honestly change**, and here the input was a
  required field nobody had to type because the system already published it. Four more things travel.
  **The refusal is where the value is**: a document nobody holds an action on is a real and common
  state (a completed step leaves the list), so it refuses BY NAME and prints the numbers the list did
  show — "not found" alone is a sentence nobody can act on — and two DISTINCT action ids for one
  number refuses rather than choosing, because choosing is how the wrong person's separation gets
  filed. **Two matched nodes was the ordinary row, not the ambiguity**: Kuali publishes a document
  number in both `Document #` and `Document Title`, so a surface asserting `exactly-one-visible`
  would have been false of every real row — the honest invariant was one distinct ACTION, and saying
  so cost a shared schema change (`matchedCount` widened from `z.literal(1)` with a refinement
  pinning every `exactly-one-*` assertion to 1), because the alternative was writing a number nobody
  measured. **Deriving a value can STRENGTHEN the check it looked like it was replacing**: D129's
  document-number proof is now made twice — against the link's anchored accessible name and against
  the opened document's heading — where D260 had correctly refused the tempting version of this
  ("drop `documentNumber` and let the page supply it"), which deletes a check to gain a text box.
  And **a per-OPERATOR constant is not a per-RUN constant, but it is still a constant**: baking
  `timekeeperName` into a bundle-safe descriptor satisfies the rule and is the weakest thing in the
  change, so its scope and its trigger (a second timekeeper) are written where somebody will read
  them rather than left to be discovered.

- **2026-08-20: an unhandled union arm IS a fallback, and it is the one nobody greps for (D253).**
  `CommandResultSchema` has three arms and TWO are refusals — `rejected` and the CAS `conflict`. The
  Context rail's Data save and the notification bell each branched on `rejected` alone, so a
  conflict fell through to the SUCCESS path: the rail closed its editor, discarded the operator's
  drafts and reported a correction **saved** that the kernel had refused. Nothing in either file
  looks like the banned pattern — there is no `catch`, no `??`, no default value — because the
  fallback is the absence of a branch, which is why a fail-loud review reading for `catch { return
  [] }` walks straight past it. It is reachable by ordinary use, not by a corner case: a run's
  version moves whenever a worker claims it or the day stream folds a span under an open panel,
  which is the exact race ref dashboard-surfaces D19's live lock exists to warn about. Three things generalize.
  **Make the exhaustiveness structural, in ONE place** — `settleCommandResult` switches over the
  discriminant so a fourth arm is a compile error, and a guard refuses any dashboard module that
  names one refusal arm without the other (with a checked-in violating fixture carrying the exact
  shipped shape, so a walker resolving nothing cannot report the tree clean). **Keep the two
  refusals distinguishable in the SENTENCE**, because the operator does different things about
  them: a conflict gets the server's `currentVersion` and never the words "try again", since a
  re-send of the same envelope carries the same stale `expectedVersion` and would be refused
  identically. And **a surface that swallows a refusal in silence reads as a broken control, not as
  a stale view** — the bell did nothing and said nothing, which sends the operator looking for a
  bug in the button.
- **2026-08-20: a comment that says a fact is unservable is a claim about the ROW, and the
  descriptor usually knows better (D252).** The Context rail's header had recorded two demo axes as
  impossible: *"nothing durable says whether a recorded field was read or written"* and *"the
  originating system is still absent"*. Both sentences are TRUE of the `run_checkpoints` row and
  FALSE of the descriptor that wrote it — the producing node declares a task contract whose
  `effect` is ref task-contract's own word for what it does to the world, and the store implementing that task
  declares the system. This is D251's false-deferral shape one surface over, and the same
  correction applies: **before booking a wire row, check whether the DECLARATION answers it.** Two
  rules came out of serving it. **Reuse the deciding function, never re-derive its rule**: the
  freshness bound is resolved through `resolveFreshnessBound` and its sinks through
  `reachableCommits` — the two functions `auditCheckpointFreshness` itself calls — so the sentence
  an operator reads is the rule the executor applies rather than a second opinion that can drift.
  And **print a constraint only where it can BITE**: the audit skips a checkpoint whose facts reach
  no commit, so an empty `feeds` set prints nothing rather than an age limit that refuses nothing.
  A serving is still allowed to refuse: an entry with no field identity draws neutral ink and NO
  arrow, because defaulting to `read` would claim the run changed nothing — the most expensive
  thing in this product to be wrong about.
- **2026-08-20: a module that exports one helper beside its component is not a Fast Refresh
  boundary, and the failure shows up two directories away (ref frontend-backend-integration §8.14).** Every surface under
  `src/dashboard` exported folds, hooks or `Record` constants beside its components, so
  `@vitejs/plugin-react` refused each as a refresh boundary and every save invalidated upward into
  `dashboard-app.tsx` — the whole app remounted and lost its state on each edit, and nothing in the
  gate family could see it because a test suite never hot-swaps a module. The rule the plugin actually
  applies (read from its refresh runtime, not the README): every export must be a likely component
  OR reference-equal across re-evaluation — so a primitive constant survives, and a function, hook,
  object or array does not. The fix is purely structural (no behaviour moved): each surface keeps
  components and its pure half lives in `<surface>-model.ts`; the guard runs against a violating
  fixture so it cannot pass by resolving nothing. Verified live the only way it can be: a browser
  connected, a surface touched, and the server's `hmr update` line naming that one module.
- **2026-08-19: a counter kept per WRITER cannot describe a resource shared by many writers — and the
  code that knew this had already written the reason down, one function away (D243/D244).** The
  "browser-profile wedge" recorded twice as an unexplained operational finding (separations §9.17
  item 5, §9.20 item 6) — a worker's UCPath profile where every acquisition burned the full 60 s
  `sessionAcquireMs` bound while a cold profile logged in in under 20 s — was never about the profile.
  Duo's WebAuthn signature counter is per CREDENTIAL, one credential covers every UCSD system, and Duo
  Autopilot's copy lives in `chrome.storage.local`, which is per BROWSER PROFILE — while ref execution-and-sessions §1
  partitions profiles per `(worker, system, instance, configFingerprint)`. So N writers shared one
  server-side counter and none could see another's copy. `autoImportPackagedCredential` had said why
  that matters since the extension's first day (*"a unix timestamp is monotonic across fresh browser
  profiles"*) and stamped a cold profile's counter to `now`; the SIGN path advanced by `+ 1`, as if the
  counter were private to one profile. **A cold profile therefore JUMPS the shared counter to now while
  a warm one creeps by one, and a warm profile stamped earlier can never catch up** — it is behind by
  however much wall clock elapsed between the two stamps, and it gains one per login. The fix is to
  compute the presented value from the source every writer shares: `max(stored + 1, nowSec)`. Three
  things generalize. **A rejected assertion does not merely fail, it BURNS the profile**: once Duo saw
  one cloned-key signal, that profile stayed refused across three further logins presenting counters
  more than a thousand AHEAD, and only a freshly created profile recovered (18.94 s, `PS_TOKEN` proved
  — the credential was never damaged), which is why "delete the directory" was the only remediation
  anyone ever found and why the fix must prevent the first refusal rather than recover from it.
  **A tighter reproduction is not yet a cause**: §9.20's narrowing ("a profile one Duo ceremony old
  wedges on its next acquisition") was falsified by the very first instrumented run — three
  consecutive successes where it predicted a wedge — and the bisection that settled it moved ONE
  variable (the stored counter) in both directions on one profile. And **the failure the operator was
  shown could not have been the failure that happened**: the landing bound is `duoApprovalSeconds`
  (180 s) inside an acquisition envelope of 60 s, so the envelope always fires first and
  `describeStalledLanding` — the function whose whole job is explaining a stalled Duo login — is
  unreachable at the shipped defaults, handing over D125's message naming Duo hand-approval. Ref execution-and-sessions
  §4.1's rule answers it from the other side: authentication is decided by CONTENT and so is its
  REFUSAL — Duo renders *"canceled or timed out"* about a second after the assertion, so the wait
  observes that and refuses in 9.52 s naming the real cause, with a negative control keeping a
  merely-slow prompt on the old message. The pin lives in this repo's own gate rather than the
  extension's offline lane (D244): `duo-autopilot/` is a hard runtime dependency, and a rule pinned
  where `npm run test:coverage` cannot see it is a rule no per-commit gate checks.
- **2026-08-19: a wire arm keyed on a value nothing produces is UNREACHABLE, not merely unused — and
  a mechanical mapping is where a label outlives its meaning (D237/D238).** Two honesty gaps on the
  same panel, both recorded against real settled runs and both invisible to every gate. **(1)** The
  run-detail `resolved` gate arm mapped only the literal `resolutionKey`s `approved`/`rejected`, and
  the command service emits `resolved` for EVERY gate — deliberately, with a comment naming the
  display-key deferral. So the arm could never be taken: every settled gated run's panel said the
  gate was ABSENT, in a reason that reads like a data problem, while `resolvedBy` had been in
  authority since D202 and in the receipt since D204. The fix is D144's shape once more — the READER
  moves to the durable `gate_results` row and through D204's own declared arm table — and the
  generalizable half is the DIVERGENCE it forces: the receipt REFUSES to derive over an undeclared
  gate (it is the durable artifact), while the panel must still render the run it explains, so every
  gap becomes a NAMED absence instead, including the one only the projection can create (a folded
  `gate.resolved` with no durable row beside it). Two surfaces, one derivation, two different things
  to do when it fails. **(2)** `done → verified-done` was mechanical, so a DRY RUN that wrote
  nothing wore the label reserved for an independently verified real completion — while its own
  receipt said `partial`/`unknown` and the authority schema carries `CHECK (result <>
  'verified-done' OR confidence = 'verified')`. Nothing had to be invented: the receipt's `result`
  enum already had `partial` and derives exactly that for a preview, so the fix reuses the verdict
  and adds only `rehearsal` — the envelope fact D6 already puts on the queue row — with a refinement
  making the forbidden pair unrepresentable rather than merely unwritten. **The habit both share:
  when a label and a derived verdict describe the same run, make the surface read the derivation
  instead of re-deriving a parallel one**, and when the two must differ, say so in the schema.
  Side note worth keeping: this tree renders no React in the unit lane, so an operator-facing
  sentence is only as pinned as the parity corpus unless you extract it — `terminalOutcomeText` is a
  pure exported function for exactly that reason (D187's lesson from the other side).
- **2026-08-18: an alert lane that lives inside the thing it reports on cannot report that thing's
  death — and machinery with zero producers is a surface doing another surface's job (D222).** The
  durable notification inbox, its dedupe fold and the bell existed since 2g/2i-B with NO production
  publisher wired, so the every-view `StorageBanner` had been carrying the backup hazard that ref dashboard-surfaces
  §2.6 always named a `storage` notification — every gate green, because nothing checks that a fact
  reaches the RIGHT surface. Moving it (operator decision) made the split structural: backup
  stale/missing publishes `storage-degraded` on state TRANSITIONS only — the D134 fold marks a row
  unread again on every publish, so publishing a standing state each 15-minute tick would make the
  row unreadable-forever, which is §2.6's spam by another route — while authority-unavailable KEEPS
  the banner, because the inbox is an authority table and an authority that cannot be written cannot
  record a notification about its own death. Two shape rules travel: the notifier advances its
  last-reported memory only AFTER the durable publish commits (a throw leaves the transition
  pending, so the next tick retries instead of losing the alert), and the watch reads the SAME
  extracted `readBackupSummary` the bootstrap serves, so the bell can never announce a state
  Settings would not show.
- **2026-08-14: every component of an ITEM-scoped key must itself be item-scoped, and the counter you
  need is usually the one the code already reads that way (D221).** D214 taught the checkpoint key the
  claim generation and closed the collision one ATTEMPT could hold; the same collision one level up —
  across RUNS of one item — stayed open, because `run`/`retry` minted a new run for the same logical
  item at **attempt 1**, so the retry's `always-rerun` node re-executed under the retried run's own
  key and the immutable insert refused it by name. **A separations run that failed at or after
  `timecard-search` could not be retried at all**, and the only way forward was the re-read
  affordance, which mints a different logical item — a different operator intent wearing a retry's
  clothes. Nothing had to be invented: `(workflow, item_id)` is the logical item the table is keyed
  by, ref workflow-model §5.6 #1 has said *"retry = new attempt"* since Phase 1e, the DDL annotates `run_id` as
  audit, and ref write-safety §5's write sequencer already reads `envelope.attempt > 1` as *"this item has been
  attempted before, so probe before you fence"* — a sentence that is only TRUE of an item-scoped
  counter, so a retry was presenting itself to the sequencer as a first attempt at the item (the
  `durable !== undefined` arm is what kept that safe, not the attempt). So the enqueue takes the item's next unspent attempt from
  authority inside its own transaction, a requeue advances the same counter instead of its own `+ 1`
  (a sibling run may hold that), and `runs.enqueue` REFUSES an attempt the item has already spent —
  loud at the insert rather than a checkpoint collision three nodes later. Two things generalize.
  **A rejected alternative is rejected for its REASONS, not its name**: D214 refused "advance the
  attempt" because a gate resume would rewrite an in-flight envelope and re-label a park as a retry,
  and neither reason survives when a fresh envelope is minted for something that IS a retry — read
  the reasons, then check whether they reach you. And **the tempting fix was the expensive one**:
  folding the `runId` into the key would have changed every stored `record_key` (no read-forward
  shape available, since every historical row HAS a run id), turned `latest`'s ordering into a tie
  broken by insertion order, and — if scoped further — silently disabled the cross-run replay that is
  the entire reason checkpoints are item-scoped. Fixing the field's MEANING instead moved nothing on
  disk: no migration, no schema version, every key byte-identical.
- **2026-08-14: an in-process hook feeding a projection is a single-process assumption wearing a
  cross-process contract — and the surfaces BESIDE the broken one are what hid it (D218).** The
  BFF's run/queue projection ingested spans two ways: a one-shot boot replay and a post-append
  `onEvent` hook on its OWN span writer. The worker is a separate OS process, so every run enqueued
  after the dashboard booted served an EMPTY timeline (plus empty pipeline chips and dataFacts)
  while its full span history sat in `spans/*.jsonl` — daily-use, since 1i-spine. It hid because
  run STATUS joins authority per surface and LOGS re-read the notes JSONL per request, so the two
  surfaces beside the timeline kept working and the gap read as a rendering quirk; the fingerprint
  was a run whose fold held exactly ONE event, its own `gate.resolved`. The fix takes ref dashboard-surfaces §2.3's
  "one projector" sentence literally: the ONE live feed is an offset-aware disk tail
  (`ingestFromDisk`, byte cursors seeded by `rebuildFromJsonl` so the two paths can never
  double-fold a line), the `onEvent` hook is DELETED so "append first, fold after" is structural,
  and the command service ticks the SAME cursor after its own emissions so an operator's follow-up
  read never waits for the 250 ms poll. Tail rules worth reusing: a torn trailing line is not
  consumed until its newline lands (another process is mid-append — parsing half a record reports
  real history as corrupt); an unparsable tailed line degrades + schedules the guarded rebuild and
  the rebuild then refuses the SAME line by name, because a line on disk is durable history and
  skipping it would silently unfold real events; and a stream file shorter than its cursor throws —
  append-only files do not shrink. Generalize: a projection fed by an in-process hook is correct
  only while every emitter lives in that process, and nothing fails when that stops being true —
  the events just never arrive.
- **2026-08-14: two schemas that call each other PARITY TWINS still fork on the arm nobody could
  reach — and a fixture emitter is what hides it (separations 6c).** D215 ratified a fourth
  `transaction.previewed` subject verdict, `not-observed`, for the preview that settles
  `already-present` before anything is staged. It landed in the kernel's union
  (`src/core/span-emitter.ts`) with a comment explaining exactly why, and never reached
  `src/events/types.ts` — the leaf the JSONL writer parses. So the **first preview that ever settled**
  killed the worker one emit short of its terminal, on a live run, with `Invalid option: expected one
  of "match"|"mismatch"|"unscoped"`. `span-events.test.ts` opens by promising it "pins that
  restatement … so the two can never quietly fork", and its round-trip list covered eight event
  shapes with **no `transaction.previewed` case at all**: the arm nobody could execute was the arm
  nobody pinned, and every unit gate passed because a fixture `SpanEmitter` does not parse the wire
  schema — only the writer does. Generalize both halves: **a parity claim is only as wide as its
  cases, so enumerate the VALUES a producer can emit rather than sampling the shapes**, and **a port
  whose test double skips the boundary's validation makes that boundary untested by construction.**
  Two side facts worth keeping from the same run. The kernel was right throughout — the crash landed
  after the preview was computed and before anything settled, so zero intent / zero fence / zero
  checkpoint, and D200's lease-as-evidence sweep released the orphaned claim on the next boot and the
  run finished. And a measurement can ride on the wrong thing for months: `probeToFenceMaxMs` was
  recorded twice as "riding on the preview terminal", and a settled preview emits ONE event with no
  beat decomposition and **has no fence at all** — so reaching it could never have produced the
  number. When a blocked measurement finally unblocks, re-derive what it is a measurement OF.
- **2026-08-14: "our graph refuses it" and "the system refuses it" are different facts, and recording
  only the first makes the platform look more constrained than reality (separations §9.16).** Doc
  4510's subject is `Inactive` in UCPath Person Org, so `match-active-employment` refuses
  `no-active-job` before the gate — a correct refusal, and one every prior record stated as though it
  settled the question. It does not: typed into the Smart HR wizard's Page B, that same EID resolved a
  name in **836 ms**, so UCPath itself would stage a termination for it. The refusal is ours. A record
  that does not attribute a refusal to its owner is one nobody can act on — the operator reading "we
  cannot file this" cannot tell whether to change the workflow or change the subject. Two more things
  the same pass found, both about the world moving under a written-down plan. **A recorded canary can
  be gone by the next pass**: doc 4524 — the natural Kuali controlled-commit candidate since §9.12 and
  the best-mapped subject of §9.14's live run — had its Kuali action COMPLETED between the two passes,
  and `ActionPage` now answers `document: null` for it, so the read task that made it the candidate
  can no longer read it. And **clearing a blocker can delete an arm's only witness**: deleting the
  pending `T002209631` cleared the canary path exactly as intended, and it also removed the one mapped
  subject that had anything for `clear-pending`'s COMMITTED arm to sweep. Neither is a defect; both
  are reasons a live inventory belongs in the as-built with a date on it, not in a plan sentence.
- **2026-08-14: a fix that lands in the tree is not a fix that reaches the runtime, and a singleton
  is where that gap hides (separations §9.16 §5).** The composed dry run's live re-proof — the last
  thing standing between separations and its §3.2 dry-run criterion — could not run, and nothing was
  wrong with the code. The dashboard BFF is a singleton by construction (port pinned by
  `config/runtime-isolation.json`, D181's `server` role lock admits one holder), the one running had
  booted before that morning's descriptor changes, and `run-executor.ts` refuses a run whose
  `envelope.contractFingerprint` is not the descriptor's — so every run that process could plan was
  structurally unclaimable by a worker built from the current tree. The interesting part is that every
  gate was green and every unit and scenario arm passed: **a stale long-lived process is invisible to
  a test suite by definition, because the suite composes its own.** D181's lock is what makes it
  legible at all (§9.9 hit the same thing once before), and the standing habit that follows is to
  compare the SERVED descriptor fingerprint against the tree's before blaming a live run — one
  `GET /api/v1/explorer` answers it.
- **2026-08-14: applying a settled model to two more fields costs nothing structurally and everything
  evidentially — a new staged field inherits NO evidence (D217).** The operator's answer to chunk 5a's
  queued question (*"collect all data first and then fill in the forms at the end"*) put legacy's
  step-13 Kuali date write-backs into §4e's one-pass staged set: ten fields become twelve, one save,
  one reload read-back. The graph did not move — `finalize-kuali` already depended on the `dates` node,
  so no edge, gate, `dependsOn` or permanent key changed, and D211's packet already carried both values
  so the approval's digest already covered them. What DID change is the honesty ledger, and it is the
  transferable half: both controls carry `exactly-one-visible` from a read-only pass and NOT D208's
  `exactly-one-editable`, neither `formKey` has ever been observed (so the table admits `null` rather
  than a guess — a fabricated key is a wire check that cannot fail), and **§4e's section caveat, which
  5c had DISCHARGED for ten fields, re-opens for exactly these two** because the section that owns them
  was never read. A discharge is scoped to what was verified, and adding a field silently inherits the
  discharge unless somebody re-states its scope. The design lesson beside it: **legacy's "write it only
  when it moved" was a property of its INCREMENTAL drafts, not of the write** — under one-pass staging a
  conditional field would need an expectation composed from the page's own prior value, which is the
  re-read the model forbids, so unconditional staging is the simpler AND the more honest form (when
  nothing moved the reconciled value equals what the document holds, and the read-back proves the
  outcome either way).
- **2026-08-14: a run ATTEMPT is not one execution of its graph, and a rehearsal that skips the real
  path's first act is a false rehearsal (D214/D215).** Chunk 6b's live pass left two platform items,
  and they turned out to be the same mistake in two places: a model that was true of the ordinary
  case and silently wrong outside it. **(1)** The checkpoint key was `(workflow, item, node, attempt)`
  — right for a graph that runs once per attempt, and a gate park and its resume are TWO executions
  inside one attempt by design, with an `always-rerun` node re-executing across the boundary also by
  design. So the second execution's genuinely different observation landed on the first's key and the
  immutable insert refused it: *a composed graph could not pass its own gate*, and the one live run
  that survived did so only because a crash had bumped the attempt. The fix is the identity the
  platform already had — `claimGeneration`, +1 per claim, never reset — and the three tempting
  alternatives each break something the docs own: writing NO row contradicts "stored for audit" and
  strands terminal evidence and downstream provenance; advancing the attempt rewrites an immutable
  envelope; UPDATE or delete-and-reinsert is D144/D199's forbidden overwrite. Read-forward is the
  whole reason the key is *conditional*: an absent generation appends nothing, so every row this
  database already holds keeps a byte-identical `record_key` — while a WRITER may not adopt that
  shape, because a new row that named no execution would be indistinguishable from a historical one.
  The same defect had a second face nobody looked at: both executions emitted the same span path, so
  the projector's `(runId, attempt, spanPath)` fold collapsed them — D123's lesson one level in.
  **(2)** `executeDryRun` evaluated `prepare` with no probe, and ref write-safety §5's probes are part of the
  transaction's safety story rather than an optimization. For the ORDINARY separations subject — one
  with nothing pending — the real run's beat-① probe settles `already-present` before a page is
  staged, while the preview staged a grid with no row to bind and *refused*. **A rehearsal that fails
  where the performance succeeds is a false rehearsal**, and it was the common case, not the corner.
  Two shape rules came out of the fix and generalize: an `already-present` preview REPORTS the
  settlement the real path would reach without performing it (no checkpoint, no observed-present
  intent, no transition), and the preview's `prepare`/`subject` moved INSIDE its `would-prepare` arm
  so a preview that staged nothing cannot spell an empty staged page. Where the real path refuses —
  ambiguous, unknown, parked, mid-submit — the preview refuses too: *a preview that answered where
  the real run stops is the same defect from the other side.*

- **2026-08-14: a GATE RESUME advances no counter, so a re-executed node is identical to its first
  execution in every identity this platform has — and a DRY RUN that skips a probe rehearses a path
  the real run would never take (separations 6b).** The composed workflow's first live pass reached
  its ALWAYS-GATE twice, took a real approval through the real command endpoint twice, and died one
  node past it both times, on two independent platform defects that only a gated composition could
  expose. **(1)** A checkpoint's durable key is `(workflowId, itemId, nodeId, attempt)` and a gate
  park-then-resume happens INSIDE one attempt, so an `always-rerun` node — a node marked that way
  precisely because its product is browser state and its observation is fresh every time — re-runs,
  produces byte-different output, and the immutable insert refuses by name. The run terminalizes
  `failed` one node after the human approved it. The other run only survived because an unrelated
  crash requeued it and the requeue bumped the attempt: *a crash is not a recovery path.* Both
  executions also emitted the same span path, so the two are indistinguishable in the timeline as
  well as in authority — which is the same absence seen twice and the reason to fix it at the
  identity rather than at the store. **(2)** `executeDryRun` previews a transaction node's PREPARE
  without its probe, so the pending-sweep staged against a grid holding no row for a subject who has
  no pending transaction and refused — a state the real path never reaches, because the probe settles
  `already-present` first. The refusal was *recorded* a chunk earlier as harmless on that argument,
  and composing it is what showed the argument backwards: **a rehearsal that fails where the
  performance succeeds is a false rehearsal**, and the ordinary subject is the common case, not the
  corner. Generalize the pair: an invariant that holds "because nothing reaches that state" is one
  composition away from being false, and the only counter a resume does not touch is the one every
  durable identity is keyed on.
- **2026-08-14: `.or()` is a UNION under strict mode, so waiting on one CLAIMS its arms are mutually
  exclusive — and two live subjects were not enough to test the claim (D213).** UCPath's
  `#PTS_CRITTEXT_DISP` was modelled as a "positive no results marker" and is the search-CRITERIA
  banner, which renders on every result list stating the count. On the first subject whose name
  matched FOUR people the banner and the grid were visible together, the three-arm `.or()` wait
  resolved to two elements, and Playwright threw. Behind it the classifier would have refused the
  same ordinary page as "ambiguous". It survived two chunks because both earlier live subjects
  matched exactly ONE person, where UCPath auto-navigates to the detail page — **only one arm had
  ever matched, so a mapping stayed internally consistent and externally wrong** (D205's shape, from
  a different direction). Three rules fell out. A settle wait should ask "has ANY outcome rendered"
  (`.first()`) and leave "which" to a pure function that can be tested; the verdict function's
  load-bearing arm is the REFUSAL — a count banner with no grid beside it throws by name rather than
  answering not-found, because reading a four-result page as "nobody matched" is a silent wrong
  value about a person; and when a registry LABEL is found to assert something the live page
  disproves, move the label, not the id — durable catalogs and selector provenance bind the id.
- **2026-08-14: a gate DEPENDENCY is not a gate PACKET, and the difference is the digest an approval
  binds to (D211).** Chunks 4 and 5 each hung a resolved value off the ALWAYS-GATE — the
  `{template, reasonCode}` map, the Kuali department option — precisely so a refusal would land before
  a human was asked, and each recorded the same open item in the same words: the value is a gate
  dependency and *is not yet rendered INTO ref write-safety §14.2's packet*. That reads like presentation and is
  not. §14.5 binds an approval to the digest of the exact packet shown, so a value the gate merely
  DEPENDS on is a value the approval does not cover: the operator approved a person while the dates,
  the template and the department their approval was about to authorize sat only in the graph. Moving
  them INSIDE `IdentityEvidencePacketSchema` makes a reconciled separation date that moves after
  approval re-derive a different digest and re-open the gate — *an approval of a person is not an
  approval of a date, and before this the two were the same click.* Two shape rules came with it and
  generalize: the "this graph composes no plan" arm is **required with a stated reason** rather than an
  optional field, because an optional block is one a composition can forget to fill while every gate
  still renders and every guard still passes; and the block's field types are plain rather than
  re-imported, because every value is already schema-bound by the node that produced it and the packet
  is a PRESENTATION of decisions, not a second authority over them. The composition's own rule fell
  out of the same reasoning: **where a refusal lands is decided by what the graph PRODUCES.** Chunk 3
  reports "no active job" and lets the human decide, which is right for a workflow whose product is an
  approved subject; the composition files a termination, so a grid it cannot reduce to ONE row is a run
  that cannot compute what it is about to write, and it refuses before the gate opens.
- **2026-08-14: an ADDRESS is not an EXPECTATION, and the page the app itself loads often answers the
  question for free (separations 5c).** Chunk 5a recorded that filling Kuali's nine unknown
  `submitDocumentV2` `formKey`s would be "a one-line change". The live capture got all ten on the first
  try — off Kuali's own `ActionPage` GraphQL query, observed PASSIVELY on a document open, so the
  section-ownership question, the whole gadget tree and the stored model came back in one response that
  cost nothing and sent nothing. And the sentence was still wrong: the mutation sends the document
  MODEL, which holds a `Date` as epoch milliseconds, a `Dropdown`/`Radios` as `{id,label}` and
  `Checkboxes` as an array of them, so writing the keys in and leaving the comparison as
  `data[formKey] === "<the staged string>"` would have made the payload check **unable to pass** for six
  of ten fields — turning every landed save into a post-fence park. **A check that can only fail is the
  same defect as one that cannot**, and the tempting middle ground failed too: the `Department*` option
  `000719 -  Supply Chain Services` carries a double space in Kuali's model while the driver reads
  options through `HTMLOptionElement.text`, which strips and collapses, so a label comparison is
  provably wrong before it is ever run. Five fields are asserted, five are RECORDED and named, and the
  controlled commit closes them by observing the real payload. The generalization: **when you finally
  learn where a value lives, you have not yet learned what it looks like there** — and a constant table
  whose comment claims a fail-closed behaviour the code does not implement (this one claimed `commit`
  refused on unknown keys; it silently skipped them) is worse than no comment.

- **2026-08-13: a loop that terminates on the WIDGET can be right about the widget and wrong about
  the answer — and a mapping can be internally consistent and externally wrong (D205).** Chunk 1's
  live proof stayed open through 14 attempts because the virtualized timecard read stopped when
  `scrollTop` refused to advance. That was TRUE: the position was being written to ui-grid's pinned
  viewport, which is synced from the body container and drives no virtualization. A true statement
  about the wrong thing reported a 14-of-35-day read as whole. **Terminate on what the gathered set
  must CONTAIN, and refuse when you cannot get there** — here `timecardRangeCoverage`, the same
  invariant the fold already refused on, now shared as ONE implementation between the loop and the
  fold. Two corollaries earned the hard way: an algorithm inside a `page.evaluate` closure is
  untestable by construction, so it moved behind a port where a fake grid runs it; and the first read
  that finally reached the fold exposed a second defect where "bind columns by header NAME" — the
  safe-looking alternative to legacy's hardcoded indices — had become a different hardcoded offset,
  because the names were queried `document`-wide (catching the pinned `Date` header) while the cells
  came from a body row that has none. Nothing threw. Read names from the same container as the cells
  and compare the counts.
- **2026-08-12: "answered durably" and "answered in evidence" are two different claims, and a trust
  surface only honours the second (D204).** D202 put the approver into authority and D203 taught the
  KERNEL to read a `gate_results` row as a dependency's evidence — and the RECEIPT, which is the
  artifact an operator actually reads months later, still derived from checkpoints alone. So chunk
  3's settled live run listed `node.identity-approval` as `unknown` while `resolvedBy` sat in the
  database, and ref write-safety §14.6 risk 6 looked closed from the kernel's side and was open from the
  operator's. The fix is D144's shape a third time — the reader moves, nothing fabricates a
  checkpoint — plus one rule that generalises past gates: **a closed enum fed from an
  author-controlled payload needs a DECLARED mapping, never a field-name sniff.**
  `DecisionEvidence.outcome` has five arms and a gate's payload is authored per gate, so
  `gate-decisions.ts` declares the decision leaf, each stored value's outcome and the bound-evidence
  leaf per `(workflow, gate)`; an unlisted arm value fails loud instead of landing on an HR record as
  `approved`. Two gotchas worth keeping: a gate needs its OWN `EvidenceSource` arm and its own
  redaction scope (`gate-result`, scoped by `(workflow, gate)`) because it owns no task contract, so
  reusing `system`/`task-output` would have required inventing a task id; and a receipt stored before
  a derivation change correctly refuses to re-derive, which is D199 working — the repair is to drop
  and re-derive the ROW as a recorded data decision, never to add a waiver arm to the check table.
- **2026-08-12: a GATE's durable record is not a checkpoint, and the first live gated run is what
  found it (D203).** A task's read-completion validation resolves its declared `dependsOn` against
  whole authority checkpoints. A gate has none and never will — its record is an operator DECISION in
  `gate_results`, not an observation — so a task declaring a gate as a dependency was structurally
  unrunnable, and no fixture in the tree caught it because no fixture had a task node downstream of a
  gate. The live run read UCPath, parked, took a real approval through the real command endpoint, and
  then failed with a message that was TRUE about a record that cannot exist. The fix is D144's shape
  again: the READER moves. `upstreamEvidence` carries `gateResults` beside `checkpoints`, a gate
  contributes exactly ONE `operator`-sourced fact dated at `resolvedAt` with no output leaves, and it
  cannot make a derived output look fresher than its live inputs because a derived leaf takes the
  OLDEST original observation. Fabricating a checkpoint row for the gate was the tempting fix and is
  exactly what D144 refused.
- **2026-08-12: a gate that dominates the DECISION must also dominate the OUTPUT (D202).** The
  identity-gate guard used to audit transaction nodes only, which was the whole truth while every
  separation-class descriptor was gate-free. A read-only chunk whose product is an *approved subject*
  breaks that: the later composition binds it as a write's `expected` side, so a terminal result
  reachable without the gate hands that composition an identity no human confirmed while the eventual
  commit looks perfectly gated. The guard now audits both sinks and caught the descriptor's first
  draft, which read the document number and the employment picture straight off the PRE-gate node.
  The walk's rule is also sharper than "the gate is on every edge" — no post-gate node could satisfy
  that, since it must read the evidence it is checking. A path is gated when it reaches the gate's own
  ANCESTRY; the violation is a side read the gate never depended on, which is data the operator never
  saw.
- **2026-08-12: a read task must not classify its own answer, and "absent" is decided by what a blank
  MEANS (D201).** Legacy computes "all rows terminated" and "two concurrent jobs" as THROWS inside its
  Job Summary page module, and only when the search happened to render a multi-row grid — so a
  single-employment person who is already terminated is never checked at all, and the first live
  subject of the new chunk turned out to be exactly that. The rich read returns the whole grid with
  statuses VERBATIM and classifies nothing; the disposition is a pure unconditional fold. The absent
  arms split the same way: empl record, HR status and business unit refuse a blank (a blank means the
  extraction read a non-employment row), while the nine descriptive cells carry
  `{state:"absent", reason}` — an unreadable department is data, and the consumer that NEEDS a
  department is the one that refuses. One page extraction, two parses, each strict about its own
  needs; widening the existing search task instead would have moved a schema hash shipped run records
  bind.
- **2026-08-12: the incident that motivated the identity gate would not have tripped a tier-triggered
  gate.** `classifyNameSimilarity("Hernandez, Jose Santos", "Santos Hernandez")` returns **`same`**,
  because the token alignment tolerates extra tokens on the longer side. Legacy fires its wrong-person
  control only on `different`. That single fact is the argument for ALWAYS-GATE stated in one line,
  and it is why the gate's packet leads with DISCONFIRMING evidence and computes its `approvalShape`
  SERVER-side: a frontend free to choose the control could quietly turn every gate into one click,
  which is ref write-safety §14.6's rubber-stamping risk manufactured by accident.

- **2026-08-12: A recovery mechanism that lives inside the thing it recovers cannot recover the
  thing it lives inside (D200).** `claimNext` throws while a worker id still owns a non-terminal
  run, and the D118 sweep that releases such a row runs in the maintenance ticker of a RUNNING
  worker. Its boot beat does precede the first claim — but it is staleness-gated, so a worker whose
  loop threw (lease settled on the way out, claimed row left behind) restarts, wins the lease
  seconds later, and inherits a row whose heartbeat is far inside the 60s threshold. Wedged, with
  the only exits being "start a different workflow's worker" or "cancel the run". The fix is not a
  shorter timer: **the lease is the evidence.** `workerLeases.start` succeeding proves no other
  process answers to this id, so every row still under it is orphaned regardless of heartbeat — a
  claim a process may make about ITSELF and nobody else. That is why the sweep request grew a
  `workerId` scope rather than a widened `staleBefore`, which would have released every live sibling
  worker's fresh claim; `RunClaimSweepRequestSchema` now admits exactly one proof of death, because
  a `staleBefore` the scoped scan ignored would be a lying field. Reuse the sweeper, never fork it:
  only the scan predicate differs, so the D118 gate still parks a run holding an `attempting` intent
  instead of handing a possibly-landed real HR write back to the executor. And what no sweep may
  release — a `claimed` row with an attempting intent, which has no legal parked-write edge — is
  refused at startup naming that run and ref write-safety §4.1, not endured as an unexplained first-poll
  throw. Side lesson from the same slice: `lineTaskLogger` spreads its fields over the log line, so
  a field named `message` silently replaces the line's own text.
- **2026-08-12: A durable record must be stamped with a fact about ITSELF, and a hash that can be
  equal when the answer moved is not a binding (D199).** The evidence receipt stamped
  `descriptorFingerprint` from the CURRENT build's `descriptor.contractFingerprint` — a value about
  the process doing the reading, not about the run being described. That is a false statement on an
  operator-facing record, and it is why one raw-control-byte fix stranded all five of chunk 2's
  live-proof `separations-kuali-read` receipts behind `already exists with different content`, with
  no re-run available (a read workflow whose identity is the thing it reads runs once per subject).
  The honest value was always sitting on the run: `envelope.contractFingerprint`, retained at plan
  time. D136 had already shown the closure hash is not NECESSARY; a receipt shows it is not
  SUFFICIENT either, because the declared redaction table and the declared cross-source obligations
  live outside every descriptor's import closure and move with `contractFingerprint` byte-identical
  — D197 moved one and two receipts changed content under a frozen hash. So the check table's last
  row, `declared-evidence`, takes the STORED RECEIPT ROW as its baseline, which is the only way to
  see a declaration the closure cannot describe; it attributes each divergent path to the one
  declaration that owns it, so a refusal says *what* moved. The immutable insert stays underneath as
  the backstop and is never skipped, and there is no waiver arm: the three receipts whose only
  change was the closure came back, and the two whose content genuinely moved stay frozen by design.
- **2026-08-09: An accessibility tree that reports content is not evidence the operator can SEE it,
  and a harness that sets a state without verifying it has only expressed a preference (D187).** 2j's
  parity work found three defects with one shape. The lane stamped `data-demo-theme` on
  `<html>`/`<body>` with a post-navigation `page.evaluate`, but `LoadedApp` renders its own on the app
  root and `tokens.css` scopes the palette off the BARE `[data-demo-theme=…]` selector — so the root
  re-themed its subtree from inside, out of React state nothing had touched, and every `paper-ink`
  reference had been photographed DARK since the corpus existed. The semantic half AGREED with the
  pixels (the toggle read "Switch to Paper Ink", which is what a dark app says), so there was nothing
  to diff. Behind it, `LogPanel`'s root is a flex child with no width, so it sized to content and its
  own `grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail)]` resolved to **`2px 376px`** — the entire
  run-detail panel, which is where the failure record and the evidence receipt live, was a two-pixel
  sliver at every viewport since 1i-spine while the a11y tree reported every word of it. D82's
  acceptance bar was unmet ON SCREEN through a dozen green gates and two deliberate reference reviews.
  The fixes are `page.addInitScript` seeding the product's own stored preference BEFORE navigation
  (so React seeds itself and all three writers agree), an `assertThemeApplied` that refuses when they
  do not, and `w-full` on the panel root. Generalize it: **when a test asserts through one
  representation of a surface, something must assert the other**, and a screenshot corpus nobody looks
  at is a corpus that records defects rather than catching them.
- **2026-08-09: A precondition nothing produces makes a complete, tested path unreachable — and every
  gate stays green (D181).** `OfflineAuthorityRestoreService` has required a one-time
  `StoppedSystemProof` since Phase 1c and `RecoveryStopProofStore` has refused to issue one without a
  recorded `RecoveryRuntimeLockSnapshot`. **Nothing in production ever recorded a snapshot**:
  `recordRuntimeState` had no caller and `.tracker-rebuild/locks` — pinned as a distinct isolated
  resource since D88 — was never created. So `cli storage restore` could not have worked on its first
  day. The fix is one lock file per role, written by the dashboard and worker compositions before the
  database opens and released after its handle closes, with the snapshot COMPOSED at observation time
  from both files: a shared snapshot would need a read-modify-write from two processes, and a lost
  update there would report a running server as stopped, which is the exact state the interlock exists
  to refuse. Liveness is OBSERVED (`process.kill(pid, 0)`, `EPERM` counts as alive) and the observation
  writes nothing — a crashed holder must not brick recovery at the one moment it is needed, and
  rewriting another process's lock file to make a restore possible would be fabricating the fact.
- **2026-08-25: two late observations are not restore exclusion, PID occupancy is not process
  identity, and a pre-swap sentence becomes false after rename.** P3A's first restore repair sampled
  locks twice around proof consumption, but a runtime could still start after the last sample and
  before authority rename; its singleton claim also used check-then-rename, admitting 11 of 48
  adversarial contenders. The repair is one protocol: restore atomically owns an admission sentinel
  through the swap; every runtime checks it on both sides of an atomic singleton claim or per-worker
  record; records bind PID to OS process birth; worker records release only after database closure
  returns; staged bytes are checksummed after copy; and failures carry whether rename already made
  replacement irreversible. Follow-up review found two more aliases for stale evidence: Darwin's raw
  `ps lstart` changes with `TZ`, and a never-run generation equal to the first acquisition lets a
  pre-start proof survive start/release. Normalize the birth stamp, reserve the baseline, and never
  call a failed WAL/SHM rollback unchanged: its rename/fsync/unlink failures carry an explicit
  uncertain state and all causes. Final review found the same mistaken boundary one layer lower: a
  filesystem rename may take effect and then throw, while a `finally` cleanup throw may replace the
  failure that led there. Reconcile source/destination truth after throwing companion-displacement
  or authority-replacement renames, classify unprovable authority state explicitly, and aggregate
  cleanup behind the original error. Sampling,
  PID liveness, a returned primitive, and a generic “not modified” catch are each plausible facts,
  but none proves the state needed at the irreversible boundary.
- **2026-08-09: An id minted unconditionally and emitted conditionally is a citation to nothing
  (D187).** `buildRunEvidenceReceipt` minted a `verificationId` for EVERY node but pushed the
  verification row only for a terminal dependency or a not-run node, while a downstream derived fact
  cites its upstream nodes by that same mint. `assertEvidenceRefsResolve` correctly refused the whole
  receipt — and the surface whose entire job is to explain a run answered HTTP 500. The state is
  reachable in production, not only in fixtures: ref workflow-model §5.4's `startAt` resume with
  `envelope.injected` (the Edit Data path) gives a downstream node its upstream VALUE with no upstream
  checkpoint. Every record-less node now emits `unknown`, which is the honest verdict and exactly what
  the verification section is for; `mandatory` still tracks the terminal dependency set, so confidence
  is unchanged for every receipt that could already be derived.
- **2026-08-09: An inventory that gates cutover must not be milestoned by guesswork (D184/D188).**
  `config/legacy-capabilities.json` had 73 of 78 entries `open`, 53 of them owned by milestones that
  had already shipped — a claim nobody could act on, and one the guard could not see because it only
  checked path coverage. Re-dispositioning against the as-built closed 27 with real targets and moved
  the rest to the milestone that will genuinely build them, and the guard now refuses an entry that is
  `open` at or before the runtime's own `completedThrough`, a `native`/`replaced` target that does not
  resolve, and evidence that only says "the legacy file still exists". The same rot had reached the
  guard inventory: six guards sat `planned` since Phase 0 with the literal invariant "Planned Phase 1+
  guard: <name>." and the milestone `phase-1-or-later`, three of them contradicting ref write-safety's own
  MET-live record. Four retired into the guards that already execute them; two kept, re-owned, with a
  trigger that names a commit somebody will write.

- **2026-08-09: An archive is DATA, and the only way to prove it is to delete the code (D179).**
  Charter §25's whole claim is that reading an archived run needs no old-version code, and the only
  check that can settle it is reading a stored record back with the descriptor list EMPTY — which
  is what `archive-invariants` and `archive-model` both do. Everything else follows from taking
  that literally: the archived record holds the FINAL PROJECTED ROW plus detail/receipt/failure and
  evidence POINTERS, taken through a seam over the same projection the live surfaces render (so the
  frozen bytes are the bytes the operator last saw, not a second derivation), and the workflow
  LABEL is frozen in — resolving it later would be a descriptor read on the archived path, and
  falling back to the id would substitute a plausible value for one nobody recorded. The three v13
  tables abort UPDATE and DELETE **in SQL**, because an archive whose rows could be rewritten is a
  weaker record than the live row it replaced. Two things the build surfaced. **(1) The app-version
  stamp did not exist.** The queue projection stamped `deps.appVersion` — the build serving the
  PAGE — on every row, so run-detail's "served by a different app build" warning compared a value
  with itself and was structurally unable to fire. It is now durable on `RunRecord`, written at the
  ONE enqueue point, and read forward (D133): a pre-D179 run reports its absence with its reason
  and an application-scope bump treats it as prior-version, which is the fail-closed reading.
  **(2) A refusal must be computed where it decides, not where it was reviewed.** `apply` re-derives
  candidates AND blockers from authority inside its own transaction rather than trusting the plan's
  list — a run that went queued between review and apply is exactly the unresolved possible-submit
  the rule exists to keep out — and a refused apply leaves the plan `planned`, so the same reviewed
  plan applies once the blocker settles. The surface keeps Apply clickable while blockers exist for
  the same reason: a button disabled by a client-side count would be the client claiming to know
  what only that transaction can.

- **2026-08-09: A credential that must survive a QR belongs in the FRAGMENT, and a refusal that
  varies is an oracle (D174).** The capture token has to reach a phone through a scanned link, which
  looks like it forces a secret into a URL and breaks ref clock-config-secrets's "no secret-bearing URLs". It does
  not: a URL fragment is never transmitted to any server, so `/capture.html#t=<token>` puts the
  credential in the one part of a link that no proxy, access log, or `Referer` header can see, and
  the phone then presents it in a header. A side benefit decided the ingress design — because the
  asset URL carries no token, the allowlist is a fixed path set with nothing interpolated. The
  second half is that **every way a token can fail to name a live session must answer identically**:
  unknown, malformed, expired, discarded. Naming them is friendlier and is an existence oracle on a
  public origin. Refusals AFTER the token resolves are named in full, because by then the caller has
  proven it holds the secret. The deny test is stronger than "operator routes 404": the phone's 404
  is byte-identical to an unrouted path, so the ingress cannot enumerate the dashboard. And an
  ingress that cannot be built refuses BY NAME (`ingress-not-built`) rather than serving a loopback
  QR — it would scan perfectly and fail on the phone with a network error explaining nothing.
- **2026-08-09: "Idempotent by stable key" is a lie if the identities are minted (D174).** D167's
  handoff seam documented that a replay "returns the SAME identities, never a second run", and the
  only way to keep that is to DERIVE them: `deriveStableUuid(namespace, outbox.stableKey)` for both
  the manifest id and the run id. `ids.uuid()` would satisfy the type and break the sentence. The
  companion lesson is about honesty of shape: a capture bundle's manifest is a real
  `IntakePlanManifest`, but §5.1's capture-only facts (session id, ordered photo digests) have
  nowhere truthful to live in a spreadsheet-shaped record, so they went into a new **optional**
  `capture` block — optional so every pre-D174 row still parses (D133), and its presence is what
  makes "this came from a photograph" a fact rather than an inference. Reusing `mappingFingerprint`
  for the source identity and `mappingSnapshotHash` for the two decisions a capture operator makes
  is honest; inventing a fourth fingerprint field, or a second manifest table, would not have been.
  Where a workflow genuinely cannot consume the artefact — none can turn a photograph into an
  employee id — the answer is a NAMED refusal into durable `failed`, not a fabricated binding.
- **2026-08-04: A durable row's schema hash describes the BYTES IT HOLDS, so the reader moves, not
  the writer (D144).** A transaction node could not be a terminal dependency because beat ⑦ stores
  the whole `TransactionOutcome` envelope while terminal `build` demanded the commit contract's bare
  output hash — and the interpreter never registered the row at all. The tempting fix (make the
  sequencer stamp the commit-output hash) would have made the row lie about its own contents and
  would have demanded a checkpoint nothing wrote, which is exactly D110/D114's "exact stored
  dependencies". The commit contract's identity was never missing: it sits one level down as
  `outcome.output.schemaHash` beside `outcome.proof.schemaHash`, and checking the envelope PLUS both
  nested hashes is strictly stronger than either alone — the composite already existed. The second
  half is shape, not hashing: a transaction node's scope value is `TypedTransactionOutcome<C>`
  (`{disposition, proofSource, output, proof}`), which is what descriptors author against, so the
  terminal factory projects the envelope before `derive` runs. "Which schema owns this node's FIELD
  PATHS" (a detail's `fieldPath`) is a different question with a different answer — one helper
  answering both is what hid the bug. The interpreter now reads beat ⑦'s exact row back and refuses
  if it is absent or does not project to the settlement just reported; it never mints one.
  `TransactionOutcomeSchema` moved into `write-safety-primitives.ts` because `write-safety.ts`
  imports `node:crypto` and a descriptor closure may not reach a Node built-in.
- **2026-08-04: A parked write must outlive an unrelated refactor (D136).** Resolvability binds to
  the SEMANTIC surface a resolution consumes — `workflow-identity`, `descriptor-version`,
  `transaction-node`, `canonical-input`, `permanent-key-identity`, `binding-proof-identity` — not to
  `descriptor.contractFingerprint`, a hash of the whole 31-file source closure. A park waits for a
  human, so expiring it on an edit to `src/domain/ids.ts` is not a recovery path. Byte identity of
  the closure stays the fast path (it proves every check at once); when the closure moves the checks
  run directly, and the load-bearing one re-derives the fenced permanent key from the exact durable
  input — a different key names a DIFFERENT external transaction. Refusals print the whole check
  table with both fingerprints and the moved values, and `[held]`/`[MOVED]`/`[skip]` stay distinct.
  There is no waiver arm on purpose. A resolution releases the WRITE only: the run keeps its planned
  `contractFingerprint`, so ref workflow-model §5.3 replay and `executeClaimedRun` are untouched.
- **2026-08-04: A forward reference decides the write order, and durability decides the delivery
  order.** `diagnostic_bundles.failure_id` references the failure row while
  `FailureRecord.diagnosticBundleId` is a forward ref the failure must already carry, so capture is
  two phases (D137): `prepare` redacts and writes attachments to the content-addressed store with
  nothing durable moved, then the interpreter terminalizes with the prepared `bundleId` and
  `persist`s the bundle inside the SAME authority transaction as the terminal CAS. Redaction is
  schema-owned and happens AT capture — unclassified fields are dropped with a warning, never passed
  through — and a second lock refuses a bundle where a never-exportable key survived as `allowed`.
  Retention purges the row and its attachment index together but **not** the content-addressed
  bytes: they are shared by digest, so the sweep reports unreferenced artifact ids instead of
  deleting something a receipt might still hold. The inbox (D138) commits create-or-fold in one
  transaction and only then attempts OS delivery; a delivery that throws is reported and never
  written back, so a missed toast still leaves an unread item. Its trigger union is ids, closed
  codes, and counts — no free-text field — which is the only way "notification text carries no
  captured form contents" is enforceable. Knowledge (D139) is insert-only, so admission is audited
  inside the insert transaction and supersession is expressed forward by the new record; the active
  view subtracts it, and nothing rewrites the older row.
- **2026-08-04: A required config leaf is a durable-schema change, and a snapshot is evidence — so
  it is read forward, never back-filled (D133).** D125's `timeouts.sessionAcquireMs` shipped with a
  default for fresh resolves and no path for stored `config_snapshots`, which parse strictly at
  database OPEN — so every authority database created before it stopped opening entirely, every
  unrelated row included. The repair is NOT a migration: `fingerprint` hashes exactly the stored
  `config` bytes, the table is insert-only, and writing `60000` into an old row would claim a bound
  that run never had (its absence is why a dead CRM session burned 262.9 s). Instead
  `src/domain/config/snapshot-generations.ts` pins the leaf set per generation, `StoredConfigSchema`
  lets exactly the registered post-baseline leaves be absent, `configSnapshotAbsentLeaves` reports
  them, and reading a stored config applies NO group default — that hole is how `browser.*` landed
  silently. Four earlier leaves (`urls.ucpath.*.login`, `paths.duoExtensionDir`,
  `paths.browserProfileRoot`, and `paths.duoCredential`'s tightening to `AbsolutePathSchema`) were
  the same defect and only escaped because no older database survived them.
- **2026-08-04: A reference corpus that rewrites itself documents behavior instead of holding it
  (D132).** `npm run test:parity` asserted only the `.png` and rewrote every `.a11y.yml`/`.meta.json`
  unconditionally, so an accessible-name change rewrote 56 references, changed zero screenshots, and
  stayed green — and it served a `dist/dashboard` it never rebuilt, so a run could pass against code
  that was not in the working tree. Both halves of a pair are now compared; a mismatch fails with a
  diff naming the reference and leaves the file untouched; a missing reference fails rather than
  being minted. `PARITY_UPDATE=1` (`npm run test:parity:update`) is the single switch driving
  Playwright's `updateSnapshots` AND the a11y/provenance writer, so the halves cannot re-freeze
  independently. The lane builds the bundle itself and stamps it with the working-tree input digest
  plus the emitted output digest; every parity server asserts that stamp before binding a port and
  must declare `proof: "working-tree"` or an explicitly reasoned `proof: "unverified"`. Both arms
  carry negative controls executed through the lane's own entry points — the same reason the ratchet
  arms run against violating fixtures. Generalize the shape, not the file: any "write the
  expectation, then pass" tool is a check that cannot fail.
- **2026-08-04: the controlled commit proved the kernel and disqualified the target (D128/D129).**
  Phase 2's ONE authorized real write fenced, clicked `Save`, got HTTP `200` and a rendered
  `Form saved`, and still persisted nothing — Kuali serializes only the CURRENT workflow step's
  section, and `Timekeeper Name:*` belongs to a later step. Both staging techniques put the value
  into React's own state, so no driver change reaches it. **A field being rendered and editable is
  not evidence the step can write it, and a positive save signal is worth nothing.** The kernel
  behaved as designed: fence durable before the click, read-back `absent`, intent parked `unknown`,
  ZERO checkpoint / ledger / terminal-span rows, and a later run on the same key refused in 1ms with
  no browser. The parked row is LEFT parked — a human decision is genuinely required.
  `recoveryAbsence` stays `operator-only`: a write that never lands measures no propagation window,
  and inventing `minSinceFenceMs` is the banned constant. Two side defects fell out — a real write
  was refusable only on the caller's `dryRun` claim rather than the run's own envelope (now both),
  and Kuali Build paints client-side (menubar ~1s, document heading ~3s after `domcontentloaded`,
  with an EMPTY heading beside "Action"/"Action List" decoys at ~1.5s), so two probes that sampled
  once now bound-wait for the same fact and the heading recipe is NARROWED to exactly one level-1
  heading whose accessible name is a document number.
- **2026-08-04: a live run found three defects fixtures could not — two surfaces that misled, and a
  bound that was the wrong instrument (D123/D124/D125).** `skipped` had no timeline arm, so a node
  the descriptor's own `when` excluded rendered as **Cancelled** — a word that names an act somebody
  took. `skipped` is now its own arm and every timeline event carries `notRun`: the executor stamps
  the skip reason on the `span.ended` task span using the SAME closed vocabulary the durable result
  records, the projector folds it verbatim, and a span with no reason stays explicitly reasonless.
  The queue row computed `now − startedAt` for every non-`queued` status, so a finished run counted
  forever (2h 47m for ~14.5 minutes of work); the wire now serves `endedAt` in its own right, an
  in-flight row is schema-refused from carrying one, and a terminal row with none renders
  `duration unknown` rather than substituting `now`. Third: a dead CRM session took **262.9s** to
  surface, and the cause is structural — every step inside a login recipe is bounded, nothing
  bounded the CHAIN, and the only outer bound was `timeouts.taskMs`, which must stay generous for
  the real read. It never even fired: claim expiry (a RECOVERY mechanism, on the wall clock) requeued
  the run first. Acquisition now has its own leaf, `timeouts.sessionAcquireMs` (60s, >3x the
  live-verified ~17s/~12s logins), failing loud — never retrying — and poison-closing a session that
  lands after its bound.
- **2026-08-04: the first commit contract is real, and everything about it is fail-closed by
  construction.** `kuali/save-timekeeper-annotation` writes ONE benign, restorable field on a Kuali
  RRSS document. Kuali's save is UI-silent, so `verify-timekeeper-annotation` reloads and reads the
  field back; the commit's own output is a claim the kernel never promotes. Post-fence absence is
  `operator-only` — not because the negative read is weak but because no propagation window has been
  measured, and a guessed `minSinceFenceMs` is exactly the unverified constant this tree bans. The
  mutation-capability registry moved to `src/base/mutation-capability.ts` so a `stores/**` driver can
  refuse an unminted capability before its click without a layer inversion; `write-sequencer.ts` is
  still the only permitted minting caller, and `task-driver-boundary` now enforces that plus "a
  `commit` implementation lives only in a store driver owner that validates its capability". Dry-run,
  wrong-subject, unknown-subject, stale-probe, and every post-fence park arm assert DURABLE absence
  (no `write_intents` / `run_checkpoints` / `durable_outbox` rows), never log inspection.
- **2026-08-04: a Kuali `actionId` names a workflow step, not a document.** The 2026-07-23 probe
  recorded the document deep link as stable; re-opening doc 4453's captured action id on 2026-08-04
  silently redirected to the Action List with no form. A run therefore carries the action id AND the
  document number, and the driver proves the number from the page's level-1 heading before touching
  anything. Live read-only re-verification also confirmed the three ported anchors resolve to exactly
  one node each, and that `Save` sits beside `Send Back` and `Mark Complete` — which is why the port
  drops legacy's three-deep `.or()` fallback chain entirely.
- **2026-08-04: the live exit test found three classes of defect no fixture could — and each one was
  green on every gate.** D74's whole argument is that a real run falsifies contracts a fixture
  cannot; here is what it actually caught, so the next live gate is read as a _test_, not a demo.
  **(1) Identity must carry the WHOLE span identity, because only a real failure re-runs a node.**
  `cross-verify` died on a poisoned CRM session, the run re-attempted, and the node ran again at the
  same `spanPath` — so the projector's `spanPath` fold key and the timeline's
  `<trace>/<node>#<taskAttempt>` React seed each collapsed two genuinely distinct executions (262.9s
  cancelled, 12.8s done) into one. Every fixture had one attempt, so `(runId, attempt, spanPath)`
  looked satisfied by using two thirds of it. Fold and seed by `(attempt, spanPath)`; a folded span
  is a fact about ONE execution, never a per-node latest-wins slot.
  **(2) A browser-reachable module that statically imports a Node built-in is a latent prod bug that
  dev reports as a crash and prod reports as a warning.** `typecheck`, `lint` and the whole unit
  suite passed with `node:path` six modules deep under `src/dashboard`'s reach. Dev threw at module
  evaluation (a blank page before any component rendered); the prod build only warned and shipped a
  bundle that would fail later, if at all — so the two environments fail _differently_ and neither
  is trustworthy alone. Never resolve it with an alias, polyfill, or browser stub: a stubbed
  `resolve()` returns a plausible-but-wrong absolute path. See the entry below for the structural
  fix and its guard.
  **(3) A login is proven by CONTENT, never by a URL** — and the live lane is what exposed it (a
  smoke "passed" in 3s having authenticated nothing). D120, entry below.
  The corollary for the next live gate: budget for the failure path, not the happy path. Discovering
  the dead CRM session cost **262.9s** of the run's ~14.5 minutes, and that latency — not
  correctness — is the honest open item this test leaves behind.
- **2026-08-04: "Browser code" is not a directory — the dashboard bundle's reach is.**
  `src/domain/config/schema.ts` statically imported `node:path` for its filesystem `paths` default,
  and `src/domain/commands.ts` → `src/dashboard/client/commands.ts` put it in the browser bundle six
  hops from the entry. Vite's dev server replaces an externalized built-in with a proxy that THROWS
  on the first property read, so the named-import BINDING killed the app at module evaluation — shell
  and title rendered, React rendered nothing. Making the default lazy (an earlier fix) could never be
  enough; only removing the import is. Dev and prod fail DIFFERENTLY here: the production build only
  warns and ships a bundle that fails later, if at all, so a green prod build is not evidence. The
  structural fix is that a browser-reachable module keeps the pure contract while anything needing a
  filesystem, a process, or a working directory moves to a server-only module — `paths` is now
  REQUIRED in `ConfigSchema` and supplied by `src/domain/config/runtime-paths.ts` through the one
  `env > settings.json > default` resolver, so a caller without it gets a loud zod error naming the
  leaf. An alias, polyfill, or browser stub for `node:path` would be strictly worse: a stubbed
  `resolve()` invents a plausible-but-wrong absolute path, which is the exact silent-wrong-value
  failure this program forbids. `dashboard-wire-boundary.test.ts` (ref frontend-backend-integration §8.13) now walks the entry
  declared in `index.html` and fails on any reachable Node built-in, printing the whole import chain.
- **2026-08-03: authentication is a CONTENT-level observation; a URL is never a proof.** A live
  UCPath login smoke passed in ~3 seconds having never authenticated: the recipe matched a host
  SUBSTRING, so the PUBLIC UCPath portal read as the application, and that early
  `already-authenticated` return also skipped the recipe's own second fact. The neutral reset had
  the same hole from the other side — it validated reuse with a URL predicate alone, so PeopleSoft's
  signon page (same host, same route shape) passed as the app; a person lookup would have scraped a
  sign-in page and reported it as HR data. Every browser system now declares a verifier proving TWO
  independent facts — a server-issued session artifact (`PS_TOKEN` for UCPath, `sid` for CRM) and
  the absence of every sign-in form — and `defineVerifiedLoginRecipe` runs it AFTER the flow on
  every return path, with the reset calling the identical verifier. A URL may be a necessary
  precondition; it is never the conclusion, and a probe that cannot RUN reports "not authenticated"
  with the reason. Two live findings came with it: UC now serves campus discovery from the
  PeopleSoft host ROOT (legacy's `ucpathdiscovery/disco` path is gone), and `click()` resolves
  before the SAML chain does — so the gate waits for what the chain actually presented instead of
  reading a URL mid-flight. Cold-profile live proof (2026-08-03): ucpath 17.4s through
  `a5.ucsd.edu` + `api-*.duosecurity.com`; crm 11.8s the same way.
- **2026-08-03: a stale selector chain hides which realm you are in.** CRM's login failed at
  `credential-fill`, then — once that was fixed — burned the whole Duo window and blamed Duo. The
  real cause: TritON defaults to **Business Systems**, and the login-type picker was probed straight
  after `goto` while the browser was still redirecting, so "picker absent" (a real rendering)
  swallowed the actual page and the credentials went to the wrong realm. Its value comparison was
  broken too — `inputValue()` returns `_eventId_authn/PasswordAD`, never the label. TritON also
  renders the SAME `#ssousername` field under three different labels, one per realm, which is why
  the legacy label-first chain looked "stale": a label identifies the REALM, not the field. Port
  structural anchors (`id`, `name`) first, keep every observed label behind them, and make a
  no-match a loud refusal that names the anchors rather than a navigation timeout.
- **2026-08-03: No test may rewrite a tracked artifact in place — parallel forks share ONE working
  tree.** `ui-catalog-cli.test.ts` regenerated `generated/ui-catalog.json` and both `UI-CATALOG.md`
  files in the checkout, and one case deliberately wrote a stale catalog over the tracked one before
  restoring it in `afterAll`. `ui-registry.test.ts` and the `semantic-ui-registry` guard read those
  same files from a concurrent fork. Under `test:coverage` the child `tsx` spawns are slow enough to
  hold the stale file on disk for ~9s, so the freshness assertion failed there and passed under
  `npm run test` — a mode-dependent verdict from a shared-file race, NOT from instrumentation
  perturbing a fingerprint (`assertSafeUiCatalogFresh` compares parsed semantic content and is
  instrumentation-blind). The in-place regenerate was the more dangerous half: it silently healed a
  genuinely stale checkout mid-run, so a guard could go green over a stale committed artifact.
  Fixtures now generate into a `mkdtemp` root through `ui:catalog -- --out-root` and
  `selector:search -- --catalog`, the generator publishes via atomic rename (plain `writeFile`
  truncates first — a poller caught six zero-length windows a reader could `JSON.parse("")` on), and
  a final case pins every tracked projection byte-identical from import to teardown.
- **2026-08-03: D116 binding belongs to whoever owns the run context, and a precondition failure
  never parks.** The sequencer never binds/releases the run config fingerprint itself: during a
  claimed run its leases run under the worker loop's `withBoundRunConfigFingerprint` window (the one
  shared discipline helper in `src/core/worker-sessions.ts`). Ref write-safety §4 recovery leases outside any
  loop, so `recover` binds the TARGET run's retained `configFingerprint` from the authority run row
  — never recomputed from current config, never caller-claimed — around its probe lease, with the
  bind OUTSIDE the probe's catch: an unbound/foreign-bound host throws out of `recover` loudly
  instead of collapsing into a park that reads as a probe verdict, while a genuine probe throw still
  parks `unknown`. The §4.1 operator resolutions lease no driver, so no binding applies. Tests bind
  through the same production API, and each surface pins the D116 refusal arm as a negative test.
- **2026-08-03: The write sequencer is the sole MutationCapability mint, and beat ⑦ wraps the
  narrow primitive.** `src/core/write-sequencer.ts` owns ref write-safety's beats ①–⑦ behind the
  interpreter's `WriteSequencer` seam; `src/core/write-recovery.ts` owns §4 recovery and the
  kernel's `WriteResolutionExecutor`. The capability is runtime-unforgeable via a module-private
  WeakSet (drivers verify with `assertSequencerMintedMutationCapability`), and the
  `task-driver-boundary`/`driver-lease-boundary` ratchets allowlist exactly that file. Beat ⑦ is
  `executeSequencedWriteCommit`: ONE outer authority transaction over run-claim revalidation, the
  Phase-1c four-row primitive (nested savepoint), the `TransactionOutcome` checkpoint, and the run
  transition — `SequencedWriteCommitInputSchema` binds the bundle without widening the primitive.
  Post-fence uncertainty parks intent-first then run (`parked-write`) and raises `WriteParkedError`;
  the Phase-1f interpreter has no parked-write outcome arm yet, so that error surfaces loudly
  through `executeClaimedRun` (durable state is already correct) until the interpreter's owner
  lands the typed arm. Pre-fence indeterminacy refuses with zero fence/zero click. A retryable key
  re-fences generation+1 ONLY via `refenceRetryable` with a FRESH binding proof; operator
  confirmed-absent is the new `operator-confirmed-absent` settlement arm. The staged page-state
  identity comes from the prepare output's `stagedPageState` field, and beat ③ observes via the
  driver's existing semantic `read(observationId)` — no new driver method. Dry-run is the separate
  `executeDryRun` arm (zero intent/fence/commit); `executeTransaction` with dryRun refuses loudly.
- **2026-08-03: A browser session is only "closed" when closure was OBSERVED, and only reusable
  when its whole identity matches.** The real factory (`src/infra/browser/`) launches Playwright's
  FULL bundled Chromium (`channel: "chromium"`, persistent context) with the Duo Autopilot extension
  — the headless shell and Chrome stable both cannot load one. `close()` returns a proof only after
  every page reports `isClosed()` AND the context emits its own `close` event within a bounded
  deadline; `await context.close()` resolving proves nothing by itself. D116 makes
  `configFingerprint` part of the reuse identity (bound per claimed run by the worker loop, absent =
  fail loud), and the fingerprint is in the on-disk profile path too, so a config change cannot be
  inherited through a warm profile. Login recipes stay in `stores/<system>/session.ts`; that file
  and `src/infra/browser/**` are the only raw-browser owners, and tasks/workflows may reach neither.
  Login verifies twice — the ported landing predicate AND the SSO form being gone — because UCPath's
  `?cmd=login` expiry page sits on the same host as a real page, and CRM's login page sits on the
  same host as its app.
- **2026-08-04: The ledger's sequence is assigned BEFORE the append, and degraded stops everything.**
  `src/infra/ledger/ledger-projector.ts` is the only module that appends `.tracker-rebuild/ledger/`.
  Its five durable facts are ordered lease → reconcile → assign `seq` + line digest → append + fsync
  → mark appended/projected. Assigning first is what makes the append window repairable: the line's
  bytes are a pure function of the stored outbox payload and its stored `seq`, so recovery
  re-derives _the same_ line and compares the digest rather than composing a replacement; a crash
  after the append re-marks without re-appending. The partition comes from the entry's own
  `confirmedAt` in UTC — never wall-clock now — so a restart days later reconciles into the same
  file. A duplicate, gap, out-of-order line, torn tail, digest mismatch, or unrecorded line stops
  that partition for **every** entry including valid waiting ones, because projecting past ledger
  corruption is how history gets quietly renumbered. `ledger/` is never pruned structurally:
  `pruneEventStreams` can only see `spans`/`notes`, and a ratchet fails any module that both names
  `ledger/` and calls a deletion primitive.
- **2026-08-04: A durable notification is the one authority row that is UPDATED, and that is not a
  weakened ledger.** Schema v10 folds a repeated identical trigger into the one row its
  `(actorId, dedupeFingerprint)` owns — `count`, `lastSeenAt`, and a version that advances by
  exactly one — because the folded firings leave no rows behind to derive those values from, and
  ref dashboard-surfaces §2.6 forbids spamming the inbox. Identity and `createdAt` are frozen by trigger. The ledger
  tables in the SAME migration go the other way: abort-on-delete, one `assigned → appended`
  transition, immutable seq/digest/partition. Never let "notifications are mutable" leak into
  anything that records what was actually filed.
- **2026-08-04: A trust receipt is DERIVED from authority, and its redaction is declared.** The
  D82 receipt (`src/core/evidence-receipt.ts`) is a pure function of the run record, terminal
  result/failure, checkpoints + provenance, and write intents: identities fold from the run
  identity and `generatedAt` is the terminal instant, so re-deriving one run yields the same bytes
  and `evidenceReceipts.insert` refuses a divergent rebuild by name. It is deliberately NOT minted
  inside `terminalizeSuccess` — authority must never depend on a projection to settle a real HR
  transaction, and the two runs this program already produced would otherwise be permanently
  receipt-less. Redaction is declared per field in `src/domain/trust/evidence-classification.ts`
  and an UNDECLARED leaf fails loud: dropping it would make a receipt look complete while hiding
  what the run read. Leaf granularity matches `task-provenance.ts` exactly (an array is one leaf)
  so every fact is dated by a stored `FactProvenance` row instead of a guess, and `evidenceLeaves`
  walks keys SORTED because a stored record round-trips through canonical JSON while an in-memory
  value keeps its authored order — otherwise one run yields two byte-different receipts. Declared
  cross-source obligations (`evidence-obligations.ts`) carry the SERVER's verdict plus the facts it
  compared, so the operator never eyeballs two `last4` identifiers. Two gotchas: putting the
  receipt on the run-detail wire made `src/domain/redaction.ts` browser-reachable and Vite turns an
  externalized `node:*` import into a proxy that throws at module evaluation, so it lost
  `node:crypto`/`node:path`; and a transaction checkpoint's provenance covers the WRAPPER fields
  (`disposition`/`proofSource`/`proof`/`output`), so commit-output leaves are dated through the
  prefix-covering rule rather than an exact path match.
- **2026-08-03: The interpreter re-reads authority before every CAS, and replay policy is
  structural.** The worker executor (`src/core/run-executor.ts` + `worker-loop.ts`) never tracks a
  run version locally: heartbeat renewal bumps the version concurrently with node transitions, so
  each transition re-reads the current row and CASes with the constant claim token — a conflict then
  only ever means real ownership loss (abandon, never terminalize over it). Entry validation runs in
  `validating` before any browser and aggregates every §5.4 problem into ONE no-node FailureRecord
  (the atomic failure composite requires `running.currentNodeId` to match any node-bearing failure).
  `always-rerun` nodes structurally never reach `loadCheckpoint`; replayed nodes emit no spans; a
  replayed checkpoint's exact stored record is what terminal evidence reuses. Every task invocation
  races a mandatory injected monotonic deadline so a signal-ignoring driver cannot hold the worker,
  and D118 makes the claim sweeper check `attempting` write intents before any requeue — a running
  row parks as `parked-write`/`unknown`, everything else stays unclaimable until ref write-safety recovery.
  The transaction and child-run arms are typed seams that fail loud (`capability-unavailable`) when
  unwired; the SpanEmitter port is required with no no-op default — the JSONL writer is 1g-spine's.
- **2026-08-03: Provider admission is durable authority, and timeout must race the invocation.**
  Capability counters are global even though every decision uses and retains the run's immutable
  budget snapshot. Reserve request count and maximum cost before I/O; reconcile cost only after a
  strict measured result; retain the maximum on abort, timeout, crash, invalid outcome, or lease
  expiry. A signal alone does not bound a non-cooperative adapter, so the kernel races invocation
  against its injected monotonic deadline/cancellation channel, safely observes late rejection, and
  durably releases concurrency before returning unavailable. Settlement failure after remote I/O is
  uncertain and can never return produced data. Fixed UTC minute/day boundaries make `retryAt`
  exact, and a zero cost limit is a hard zero-estimate cap, never unlimited.
- **2026-08-03: Released migrations are immutable, and authorization must bind its consequence.**
  Never add a table to a released migration without advancing the schema version: an already-v7
  database will skip the changed body. The exact released v7 creates terminal failure/result/outbox
  facts; v8 alone adds `run_terminal_authorizations`. A literal SHA-256 table pins every version and
  ordered statement byte in released v1–v9; future schema work starts at v10 and extends that table.
  Recovery and replay require the terminal row to be the authorization's exact consequence: version
  is `expectedVersion + 1`, claim generation is retained, state/outcome and failure id match the
  arm, and both `lifecycle.endedAt` and `updatedAt` equal `authorizedAt`.
- **2026-08-02: Task provenance is an executor-owned data channel, never inferred from logs.** Every
  task context carries a real `recordData` collector. Read completion validates that strict,
  execution-attributed points cover every canonical output leaf and agree with the parsed value;
  derived outputs also resolve the exact static `dependsOn` set from the factory-authenticated
  descriptor (never from caller claims), require one whole, fact-complete authority checkpoint for
  each node, reject undeclared checkpoints, and retain the validated union's oldest original
  observation. Tests use explicit recording fakes, so a missing runtime collector cannot hide
  behind a no-op.
- **2026-08-02: Worker browser resources are callback-leased and uncertain closure stays visible.**
  Serialize driver use by `(worker, system)`; an authored fresh boundary closes before replacement,
  and park/stop waits behind in-flight callbacks. Task, cancellation, reset, login-cleanup, or close-
  proof uncertainty must poison-close the resource. If closure cannot be proved, retain the resource
  as poisoned and refuse reuse; never erase it from ownership or infer that cleanup succeeded.
- **2026-08-02: Start plans bind raw ingress separately from canonical input.** Every accepted and
  refused entry retains strict JSON `rawInput`; a non-JSON submission fails planning before any
  proposal can be minted. Accepted entries additionally retain the schema-bound canonical snapshot
  and its digest. The plan binds ingress/canonical schema hashes and derives its confirmation
  fingerprint from every ordered raw + canonical identity, so defaults/transforms never erase what
  an operator submitted. Schema v6 deletes incompatible, short-lived pre-D109 proposals rather than
  fabricating raw ingress, and an exact replay validates all bindings against its pre-consume
  revision before D113 consumes the plan inside its outer authority transaction.
- **2026-08-02: A terminal lifecycle is the commit marker for terminal authority.** Failed runs are
  settled only with the exact existing `FailureRecord`; done runs are settled only with a strict,
  schema-bound `RunResultRecord` plus a pending `run_terminal_outbox` record. Both paths validate the
  current run identity, version, and claim, write every durable row and the terminal CAS in one outer
  authority transaction, and accept only byte-exact replay. Result dependencies come from a
  factory-authenticated terminal view and explicitly retain either the exact checkpoint identity,
  output/provenance digests and fingerprints or a closed `not-run` reason for a conditional node.
  Schema hashing stays browser-safe because descriptor closures cannot import Node built-ins. The
  initial success path also carries the descriptor factory's unforgeable seal over the exact parsed
  current run and factory-derived result; a schema-valid caller-built result is not authority. A
  strict `run_terminal_authorizations` row retains the original expected version and claim for exact
  replay, and NULL-safe recovery invariants reject every partial or cross-bound terminal settlement.
