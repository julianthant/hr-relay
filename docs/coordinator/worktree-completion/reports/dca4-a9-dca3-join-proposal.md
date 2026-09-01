# DCA4 A9 — retained DCA3 consumer and join proposal

2026-08-30. **READ-ONLY proposal complete; implementation NOT authorized.**
The missing run-detail Captures consumer is original DCA3 scope. Recommend one DCA4-owned
capture-local state/presentation join, then an explicit bounded receive into DCA2. A real
failure-origin presentation gap needs disposition before implementing its decoration.
Generic-route/full-branch acceptance and shared serving remain open.

## Authority, role and preservation

Assignment: coordinator commit `67bd21dda356253df9bdb5654d029588ed091091`,
`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/briefs/dca-shared-prerequisites.md`.
Profile, board and run plan were read completely at their supplied absolute paths; board is READ ONLY.
This report is the only writable artifact. No implementation, test, guard, configuration,
reference, source-history or foreign-tree write is authorized by this proposal.

Supervisor: `01a052ed-f880-7f20-8c9e-8a2f356b9c35`.
Reused ONE existing native unit: `sup_terra_dca4_a9_dca3_join_proposal`,
`01a052ff-414f-79b3-bc5d-fa871c2457dd`, high reasoning, 240k/220k.
Submission `01a05456-50e4-7a20-9dab-f42ef7522b25`; complete native return received and unit closed.
No new worker, supervisor, worktree or review campaign. Native result: one primary missing-consumer
gap, severity high; static proposal only. Parent verified the cited source paths, history,
overlap sets and authority distinctions, and adds the failure-origin issue below.

Skills: complete /supervise and required applicable instructions; /ui read-only review route,
React19.2.8/Tailwind4.2.2/lucide/TypeScript, no Next or shadcn components.json.
[WIG fetched live](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md);
this is not a rendered UI review. Codebase-design seam discipline informed the options below.
The explicit ONE-existing-unit restriction overrides design-it-twice's extra-agent suggestion.
No current instruction conflict requires a new worker or a gate.

All local paths below are relative to
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`, unless another root or retained commit is named.
Current DCA2 is read-only at `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca2`.
Every shell command ran with the explicit DCA4 workdir.

| Re-pin evidence | Actual result |
|---|---|
| Both component HEADs | `eda17b2708286e36542e1e18e9f8ef6a06cf3187` |
| DCA4 branch/index | `feature/dca4-archive-evidence`; index empty |
| Existing frozen record | `evidence/dca4-gates/parent-repairs-frozen-final.json`, SHA256 `f0089157f49c391fe877686dc17a13767ca56f9e62e74b7829a5b9983333d558` |
| Parent intake, tool chunk4e546e | All33 candidate file byte counts/hashes, six saved raw logs, manifest and materializer matched |
| Protected source/test/script/config | 1623 paths, digest `fbcb4c5a9c7b352ce1dbb802c1b9dab30f86c4897492c54dfa2248b444f3de65`, same recipe as frozen record |
| Existing UI/backend aggregates | `3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461` / `1ae6ca5fc56a4d49dc44b4ea6b28c289a2dc67702419f00e3abdca9645bd28cb` in matched record |
| Existing Archive spec | `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`,23317bytes |
| Pre-report entire Git-visible inventory, chunk3bd6cd | 2142 paths excluding only this prospective report; digest `3827393a5df1de43b19fc36a17de2f4db4b30541ff9cd3101b8eb356e059a74b` |
| Product gates in A9 | NONE. Saved logs remain historical, including fullcoverage05 RED and wire generic-only RED |

Inventory recipe: sorted distinct `git ls-files -co --exclude-standard`; stream one compact JSON
`[path,byteLength,SHA256(fileBytes)]` plus newline per path through SHA256. Ignored runtime/output
trees are not covered by this inventory; none was operated here.
The accepted five A8 native returns were not re-reviewed or re-retrieved. Existing handoff
`handoffs/2026-08-30-dca4-central-route-dependency.md` remains because full gates/integration are open.

Intake shared document SHA256s:
profile `328279f774f76c299f84f6511165198a1e7a2e0efb3a46d7997fe479f02fe1d6`;
board `90e248740bd50dbf88ca173ff3f165295def5b1940fb1e598582cc19acaeb163`;
run-plan `599b6c86c2937827392699dcf24419bc85773368acee8062dbdc11fc4a875e87`;
shared brief `874f81766c371908961be80b7bea47161e681ae63d3784f77c859420c97e76bc`.
Later coordinator edits do not grant an implicit heavy slot.

## 1. Original scope and actual delivery

Primary source: `git show integration/03b:docs/plans/2026-08-28-dashboard-completion-runs.md`,
DCA3: generic capture/download tiles for artifacts current authority indexes; advertise Captures
only after exact indexed artifacts verify readable; keep absence and corruption distinct.
No OCR Review, phone producer, capture-to-workflow join or Gallery redirection is included.

Owning composition: `docs/rebuild/reference/frontend-backend-integration.md:508` places captures
in Receipt/Review, not a new tab; `dashboard-surfaces.md:2950` places screenshots under both
full and short receipts and requires failure-capture red framing. Existing tab vocabulary
`surfaces/log-panel-model.ts:292` stays unchanged.

Retained tip `7a85bbd596f00ba4052ce1dddd13cd40c8a897ac` supplies:
- `src/domain/dashboard/run-detail.ts:310,758` at that tip: strict available/absent/error
  availability; optional only for old archived records; nonempty verified lazy artifact list.
- `src/server/dashboard/queries/run-detail.ts:863–943`: exact requested-run listByRun, strict
  bundle parses, exact bundle-id and canonical manifest readback, attachment-index/whole-byte
  verification via readDiagnosticBundle, conflict-refusing deduplication.
- `compose.ts:873`: real diagnostic authority and content store. Async detail/section API handlers.
- `src/dashboard/client/queries.ts:216–261`: requested-run identity checks and typed artifactUrl.

The complete retained delta changes63 paths,15 non-reference and48 reference paths. Its ONLY
dashboard source change is client/queries.ts. It changes no hook, panel, tile or preview.
An unused artifactUrl builder is neither rendered consumption nor completed DCA3 UI.

Actual missing path, independently read in current source:

```text
DashboardApp / LoadedApp, route.run
  → useRunDetail (state/use-run-detail.ts:99)
  → usePanelSections (app/use-panel-sections.ts:19)
       no captures in wanted set; merge switch has no captures placement
  → LogPanel (surfaces/log-panel.tsx:167,2429)
       ReceiptView / UnservedTab; no Capture consumer or generic native sink
```

DashboardApp:423–424 discards the shared hook's error. Adding one Promise.all request there
would couple capture refusal to unrelated sections and still risk hiding its error. This
proposal leaves unrelated aggregate-hook/error behavior alone.

## 2. Recommended bounded consumer interface

Three options considered inline, without extra agents:

| Option | Interface / locality | Disposition |
|---|---|---|
| Extend shared PanelSections/wanted/merge/error | Fewest new files, but capture rejection clears the whole aggregate and requires broader error plumbing | Not recommended for this bounded repair |
| Self-contained capture child with its own fetch | Local rendering/state, but must still receive the actual requested route identity, not merely stale detail | Viable, weaker visibility of ownership at composition |
| App-owned capture-only state, component-only presentation | `useRunCaptures(requestedRunId, detail, active)` plus `RunCaptures`; errors and cancellation stay local | Recommended |

Proposed implementation files, not created:
- `src/dashboard/surfaces/run-captures-model.ts`: explicit inactive/loading/available/absent/error
  state, owner/request generation, selection and native-image readiness facts if needed.
- `src/dashboard/surfaces/run-captures.tsx`: component-only tile/list, metadata, native download
  anchor and at most one selected contained native-image preview. Reuse existing DS atoms.
- `src/dashboard/app/dashboard-app.tsx`: call hook with route.run, loaded detail, and active
  Receipt/Review; pass its state into LogPanel.
- `src/dashboard/surfaces/log-panel.tsx`: adjacent Capture section beneath full/short Receipt.
  Review placement only when legitimately relevant; do not manufacture Review's producer.
- `src/dashboard/client/queries.ts`: retain DCA3 run identity checks and artifactUrl; optional
  fourth runSection AbortSignal forwarded to existing requestJson init. Other callers unchanged.

The signal is a proposed public TypeScript interface extension, NOT already approved implementation.
No new HTTP endpoint or producer authority is required for the basic consumer.

State ownership includes requested run, adopted detail revision and request generation. A mismatched
or superseded owner must cease presenting old capture content synchronously; both late successes
and rejections are ignored for the replacement owner. Abort/invalidate on run/revision/tab changes
and unmount. Read the lazy section only when matching live detail advertises available captures
and Receipt/Review is active. Verify returned section discriminator and payload.runId.
Absent/error initial availability stays visible without a failing speculative fetch. A missing
availability field on a live detail is a named protocol error, not default absent. Preserve old
archived-record compatibility; never project current facts into Archive.

Image dimensions come only from the verified attachment ref; reserve their geometry and contain
the uncropped image. Non-image refs have native downloads, not fake screenshot previews.
Retained sensitivity→redaction mapping is declared capture-policy metadata, not a fresh pixel
inspection. Show restricted warnings and exact supported facts; never invent step/system/time,
failure attribution, page counts, dimensions or a redaction-success claim.

## 3. Identity and failure contracts

| Consumer | Exact resource | Authority / limit |
|---|---|---|
| Current run Captures | `/artifacts/v1/:artifactId` | UI selects from this run's verified list; DCA1 separately resolves global diagnostic attachment index |
| DCA2 Gallery | `/api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId` | Exact bundle membership, full bundle verification, selected-byte recheck |
| DCA4 Archive | `/artifacts/v1/archive/:runId/:artifactId` | Frozen archived tile only, never live diagnostic replacement |

DCA1's generic route is NOT run-scoped server authorization. The requested run is bound by the
detail/list chain; the byte route independently verifies its artifact identity. Do not claim a
runId check that the one-ID route cannot perform. URI construction lives only in the real client;
native attributes must equal the validated client's selected resource and expected origin/path.

| Observed condition | Required honest presentation/proof |
|---|---|
| No composed capture authority or empty verified run index | Initial named absent state; no captured bytes or invented producer |
| Verified nonempty list | Available/count initially; lazy exact refs after repeated verification |
| Malformed/foreign index, conflicting refs, digest/size/read failure | Visible error, no available section or successful download claim |
| Bytes disappear before lazy metadata | Existing DCA3 corruption refusal; never silent empty list |
| Bytes disappear after metadata | Byte endpoint refuses; retain metadata and surface load/decode refusal without guessing storage cause |
| Image load/decode refusal | Browser failure only; not proof of a purge or a particular storage defect |

DCA2 `DiagnosticBundleBytesMissingError` extends DiagnosticBundleCorruptError
(`src/server/failures.ts:85` in DCA2); DCA3 wraps failed bundle readback at retained run-detail:880–882.
Therefore DCA3 currently reports capture corruption, not DCA2's narrower missing-byte code.
Preserve route-specific semantics and test them; a separately typed DCA3 missing-byte state would
need explicit contract approval. No purge tombstone exists, so no purge state may be inferred.

### Genuine provenance decision before failure decoration

Parent verified `dashboard-surfaces.md:2950–2953` requires a failure capture's red frame in tile
and lightbox. Retained `ArtifactRefWireSchema` and CaptureList carry no bundle origin/failure
association; captureArtifactRef:844–856 discards it. DiagnosticBundleSchema DOES contain origin,
but one deduplicated artifact may occur in multiple verified bundles.

A renderer cannot label every image in a failed run as a failure capture. Coordinator must either
approve a minimal capture-list provenance projection from the already verified bundle origins,
with explicit multi-origin semantics and strict tests, or record an explicit bounded disposition
of this decoration. Recommend the former to meet the owner without inventing a producer, but do
not choose new origin/precedence rules here. This is distinct from shared byte serving.
Basic metadata/download consumption needs no new producer authority; full failure decoration is
not truthfully implementable from retained refs alone.

## 4. Exact retained port and overlaps

Preserve all retained commits/ancestry, not just patch-equivalent code:

| Commit | Retained intent |
|---|---|
| `fd1cc3022792d6d5980f43bd15f1d7c3294a2173` | Named absence |
| `709cd5d55338554614613ac5db4d14b787b60df7` | Verified lazy capture refs |
| `385675836e1177c5335153502d5027a5d1681f35` | Visible corruption |
| `add58fb1a2eabd976786428a7962fbf86d586754` | Real composition/routes |
| `9132ad7a298e3b7619e913937c46794e24393288` | Client/availability guard; literal credit needs reconciliation below |
| `fc6581c6f89661ae1546e013b87497fdcfa3232f` | Initial requested-run identity |
| `37825254d507207b71aeb808f20674ca1b273276` | Retained DCA3 merge |
| `7a85bbd596f00ba4052ce1dddd13cd40c8a897ac` | Authority/wire reconciliation and historical references |

Exact15 non-reference paths:
```text
AGENTS.md
config/pending-wire-bindings.json
src/dashboard/client/queries.ts
src/domain/dashboard/artifacts.ts
src/domain/dashboard/run-detail.ts
src/server/dashboard/compose.ts
src/server/dashboard/queries/run-detail.ts
src/server/dashboard/routes/api.ts
tests/unit/architecture/helpers/redaction-surface-audit.ts
tests/unit/architecture/helpers/wire-connectivity.ts
tests/unit/architecture/wire-connectivity.test.ts
tests/unit/dashboard-wire.test.ts
tests/unit/dashboard/run-detail-captures-client.test.ts
tests/unit/server/bff-flow.test.ts
tests/unit/server/run-detail-captures.test.ts
```

| Receiver | Exact overlaps with its present dirty work | Receive by intent |
|---|---|---|
| DCA4 | AGENTS.md; client/queries.ts; routes/api.ts; redaction-surface-audit.ts; wire-connectivity.ts helper; wire-connectivity.test.ts | Preserve A5–A8 lessons, Archive client/handlers, A6 origins, A8 native collector/accounting/control semantics |
| DCA2 | AGENTS.md; client/queries.ts; routes/api.ts; server/bff-flow.test.ts | Preserve Gallery client/bundle identity, bundle handlers/error shaping, existing BFF cases and lessons |

DCA2 sampled overlapping file SHA256s (read-only snapshot, re-pin before any later receive):
AGENTS `31b4e87f3788ff51e7bc59b6b66445bcb5f6cb9f0ea2b98e527c16c7df42cead`;
client `34afb7aab7b1c3434b1615e2c57089406a0cbefa0d2c09e30af238766f373dd2`;
API `7f072f7c2eec61048923011a1545488302d479a4176d1c838c459c575b1ad996`;
BFF test `329d25493e39ff5521462359688d138de70eceed48196f14e352300ff92a9383`.

Specific reconciliations:
1. Port domain availability/nonempty verified-ref list and text/yaml support with their tests.
2. Add async readRunDetail/readRunSection and compose captures without overwriting either
   component's handlers. Shared serving owner alone modifies artifact response/materializer logic.
3. Add DCA3 origin registrations at live detail, archived detail and stream envelope leaves;
   remove only old list-resource leaves that truly cease to exist. Preserve A6 and all canaries.
4. Keep DCA3 data-dependent availableSections proof. Remove only the served captures
   declared-unserved pending entry when its producer is joined; no served-unconsumed exception.
5. DO NOT adopt retained CLIENT_PATH's `artifacts` prefix as builder-only credit.
   Preserve current regex/roots/matcher and A8 full bidirectional accounting. See collector below.
6. Preserve DCA2/DCA4 common-file deltas in frontend integration docs, dashboard AGENTS, runtime/
   composition test, fixture BFF and generated roadmap. No whole-file copy. Duo implementations
   already landed independently and are not this feature's new work.
7. Add the actual as-built capture consumer to owning reference statements that currently say
   captures are unserved; preserve every unrelated deferred producer.

Fixture BFF reconciliation is separately owned/sequenced: DCA4 dispatches exact two-ID Archive
artifacts outside /api; DCA2 has bundle JPEG and scenario isolation fixes, plus fixture-day changes.
The new one-ID fixture route must be exact and scenario-owned, not a broad /artifacts fallback.
Its owned real HTTP adapter must prove body delivery, not only Hono app.request.

All48 historical refs were changed in7a85bbd5:12 Explorer a11y and36 Separations a11y/meta.
No Captures PNG/consumer proof is supplied. Preserve their commits; don't adopt old reference
fingerprints as current acceptance. Current six scoped-accepted Archive04 refs stay byte-exact.
Any later changed UI references need attributable stamped capture/direct PNG+a11y review and
assertion under explicit allocation; no capture normalization or blanket corpus update.

## 5. Minimal actual-consumer guard proof

Propose `tests/unit/architecture/helpers/run-captures-browser-route-references.ts`, test-only.
Drive the real DashboardApp through selected run → Receipt → Capture, real client/parser/hook,
then observe native download href and selected image src. Existing full-app mounting precedent:
`tests/unit/dashboard/takeover-frame-focus.test.ts:202`. This is not a copied stand-in component.

Validate origin, one-ID path and selected verified artifact/run facts before returning observed
ClientRouteReference values into the unchanged accounting function. No production URL literal
copy as evidence; no returned reference when mounting, parsing or observation fails.

Required negatives through the SAME collector/accounting:
- Two distinct requested-run/artifact pairs; foreign initial or lazy identity, wrong section,
  extra keys and foreign origin refuse with a named error.
- Remove the actual consumer/sinks → generic orphan; leave only unused artifactUrl → still orphan.
- Substitute Archive two-ID or bundle-scoped URLs → cannot credit generic route, and vice versa.
- Remove served route; stale consumed/deleted pending entries; collector/cleanup failure → red.
- Finally unmount, restore globals/controlled nodes, cancel/invalidate owned work; cleanup failures
  remain fatal. Preserve A8's independent Archive controls/credit and full zero-problems assertion.

On DCA4, generic collector joins A8. On DCA2, receive the common accounting/helper intent with
branch-specific assembly: do not mount/credit an Archive route or source consumer absent there.
A8 isolated tests should still prove Archive alone cannot satisfy generic; complete joined audit
must expect zero, not retain an intentional generic residual after actual consumer completion.
DOM reachability is NOT HTTP, decode, pixels or shell keyboard proof.

## 6. Proposed proof, not executed

| Seam | Required red-capable proof |
|---|---|
| Real run authority | Existing retained run-detail-captures.test.ts/BFF flow; exact ids, absent/index errors, duplicate conflict, mixed screenshot/data refs, whole bundle/index/bytes |
| Client boundary | Retained client test plus wrong section/run, malformed refs, signal forwarding and unchanged omitted-signal callers |
| Mounted production consumer | New run-captures-render.test.ts: active Receipt/Review-only fetch, full/short receipt placement, unavailable/error visibility, native sinks, owner supersession and cancellation |
| Real HTTP | Exact one-ID artifact route, owned ephemeral server, MIME/status/body digest, before/after-metadata loss, corruption and route-specific refusal; Range/Host contracts stay with shared-serving proofs |
| Guard | New collector controls plus full existing wire-connectivity file; A8 unaffected; zero complete accounting problems |
| Browser, only later allocated | Real selected-run→Receipt entry, image decode/native exact-byte download, visible restriction/error states, containment/stable metadata, focus/keyboard and44px nonoverlap/edge ownership in narrow view |
| Regression/integration | Archive and Gallery affected proof, redaction scan, guard manifest, strict wire tests, serial locked lights, then full coverage/full asserted parity on the joined candidate |

Parent corrects the native proposal's abbreviated command examples to the profile's canonical
npm invocation, exact global lock path and legacy override. These are commands FOR A LATER
APPROVED IMPLEMENTATION, not permission to run them now. Some named files are proposed/new:

```sh
# Explicit DCA4 workdir; one owned light lane, never simultaneous.
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/server/run-detail-captures.test.ts tests/unit/server/bff-flow.test.ts tests/unit/dashboard/run-detail-captures-client.test.ts
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/dashboard/run-captures-render.test.ts tests/unit/architecture/wire-connectivity.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/dashboard-wire.test.ts
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Future independent reviews: Tests/Correctness/Standards/Security/Silent for authority/client/guard;
UI accessibility/behavior for rendering, with review scope fixed per sequential delta.
No such review was dispatched in A9. Existing A8 reviews and404 controls are accepted historical
proof and must not be repeated merely to produce another receipt. Fresh affected proofs become
necessary only for genuinely changed joins.

## 7. Proposed receive order and continuation boundary

1. Coordinator receives both read-only proposals, resolves failure-origin disposition and assigns
   exact implementation/test seams. No public-field or origin precedence decision is invented here.
2. One DCA4 writer reconciles retained DCA3 non-reference intent, builds capture-local consumer
   and actual guard proof. Preserve frozen component work and raw old reds; no pre-gate commit.
3. Freeze/review the common delta, then DCA2's own writer receives precisely that bounded source/
   test/doc intent against its pinned files. Keep branch-specific guard assembly and Gallery
   authority intact. No simultaneous writers in common files or foreign checkout writes.
4. DCA2 separately implements its approved shared-serving mechanism once. After its scoped proof,
   DCA4 receives the exact shared contract/delta. This proposal grants no byte/storage/lifetime
   mechanism and cannot certify one. Serialize API conflicts, and separately reconcile fixture BFF.
5. Re-pin each complete joined candidate; parent light/focused receive, affected independent
   reviews, explicit heavy allocation, full coverage then full asserted parity. Retain exact old
   evidence; don't rerun known-red full gates before prerequisites land.
6. Only after required green gates: logical category commits and clean reports. Coordinator-owned
   ancestry-preserving integration must make7a85bbd5 and both finished component tips ancestors of
   integration/03b. Bounded dirty-tree porting enables prerequisite proof but is NOT Git ancestry.
   At later authorized merge resolve historical reference bytes by documented current intent;
   do not silently erase the retained commits or adopt their old corpus. Re-gate the actual
   resolved integration tree; no master merge, migration rewrite or worktree removal here.

No heavy OPEN/NEXT was requested. No tests/lint/build/browser/product gate, source edit, file-copy
implementation, merge, stage or commit occurred. Source remains frozen. Only this report is new.
The A9 proposal is complete; implementation and full branch completion remain coordinator-owned
continuations after concrete authority/sequence receive.

## Post-write preservation receipt

Parent verification chunk `d25077`, exit0: all33 frozen candidate pins still match; all2142
Git-visible paths outside this report retain the exact pre-report digest `3827393a5df1de43b19fc36a17de2f4db4b30541ff9cd3101b8eb356e059a74b`.
HEAD remains eda17b27; index empty; whitespace check and materializer diff both0. This is
read-only identity/preservation verification, not an executed product gate or branch acceptance.
