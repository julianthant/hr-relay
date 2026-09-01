# A10.3 — mounted capture accounting and exact fixture HTTP

Status: implementation and serial light proof complete; candidate frozen for parent receive and independent review. Writer/light ownership relinquished on return. No command remains active. No commit, staging, browser, build, parity, coverage or reference update was performed.

Unit: `sup_terra_dca4_a10_consumer_accounting`. Assigned tree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`. HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index remains empty. All command execution records name this explicit workdir.

## Receive identity

The final isolated patch is relative to the inherited dirty candidate, not HEAD:

- [Final delta](../evidence/dca4-a10-accounting-final-delta.patch): SHA256 `34a4c445981d2ee9f6dc4ad921a30ea7ef892c70a9cb9e66481efa021141b323`; 9 paths, 693 additions / 37 deletions, including 3 new files.
- [Original bounded before record](../evidence/dca4-a10-accounting-before.json): SHA256 `9eb61f742d258809a4f9889dd563c86114708f636048b517abc059a0be3e4222`. Original existing-file bytes are retained in its named `before-N.txt` files and checked before patch generation.
- [Final bounded identity](../evidence/dca4-a10-accounting-final-freeze.json): SHA256 `832d1a0f0eb07e6fcac511054ee6d3db5dc3b23707dbb5e58d9fd6f649e6ce1f`.
- Scope identity before `122f4d059c435eaa5842a3d772c9ba49ee16f1fb167d192cc2deb2cc39238d39` → final `778973c3b5ec3d44fe0f142047ba17e1fa56a384c6f810f6d82b87d91e1390f3`. These hash JSON objects of scope path → file SHA/null in before-record order.
- Protected **1,861 paths** before and after: `6be0f2781b0cb09f5cfd4fb74e07ef7b8dbaeac8a8e5978eeabbe4126f8358f4`. Recipe: unique JS-sorted `git ls-files -z --cached --others --exclude-standard`; exclude only the nine owned paths and `docs/coordinator/`; compact JSON path → SHA256(bytes), null if missing; SHA256 that JSON. The map is computed locally, never transported as a giant round trip.
- Final reverse patch check exit 0 (chunk `3c7aad`); final `git diff --check` exit 0 (`2875ac`); final patch generation exit 0 (`6c4c95`), numstat/hash exit 0 (`f8b050`).
- Existing A8 test block retained exactly: SHA256 `4e1a4c21c458ee961e0cf6176a5357dc447fedf33e6ffa693b25b1b9fdfffa16`. Its isolated Archive collector still reports the generic orphan. Only the aggregate joins independent observed collectors.

| Owned path | Final SHA256 | Bytes | Delta |
|---|---|---:|---:|
| tests/unit/architecture/wire-connectivity.test.ts | `9eb5bce49b04aae9a71a253705eb058457a9ca599966f8604a7e3fc0cd456648` | 55135 | +261/-7 |
| tests/unit/architecture/helpers/run-capture-browser-route-references.ts (new) | `4439d5a8f04cad5ec90f138b49c62aaf828d2da9fe1bdd35571833f4b5727c2b` | 5562 | +86 |
| tests/unit/dashboard/fixtures/run-captures-app-fixture.ts | `356ff3f3c4fb22a7702e19c89fb6df908937c424061844ad87b6b261f4e0c3b2` | 13248 | +48/-16 |
| tests/parity/helpers/fixture-bff.ts | `393944a843e4b89d27b856b20caf11dc207317d2c78f6cc874d38be6c9866f3e` | 25096 | +38/-8 |
| tests/parity/helpers/fixture-run-captures.ts (new) | `c66c67d0bd1221782bdaf09a2ecfc404f374983307b3f731e3c0baa3ddfa275f` | 4820 | +75 |
| tests/unit/dashboard/run-captures-fixture.test.ts (new) | `2d5fc428a1879369de28c8e4ee11307799ba1130f17804973ddfa28475bc06d9` | 9937 | +159 |
| src/dashboard/AGENTS.md | `41cb89fe5da1c57077379bcd8ea665b48e3f2c44af04f9c2179533ee42691304` | 12524 | +11 |
| docs/rebuild/reference/dashboard-surfaces.md | `aece0a0788d047af26ab46d08eaa2ced10544c61d89627b835aa53a31a9d5fe6` | 410490 | +5/-2 |
| docs/rebuild/reference/frontend-backend-integration.md | `c8b78782a27ecdbf213b9b9185a05457707a94f7eb661181bed9cd8378cf25aa` | 202130 | +10/-4 |

The protected record independently pins unchanged A10.2 product model/component/app/LogPanel and tests, A8 collector, mechanical wire helper, Archive HTTP tests/fixture, image source constants, pending bindings, generated manifest, Archive spec and all six references. Archive spec remains `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`, 23317 bytes. Manifest remains `66d399b7cc1370018778a9101dd9fedd6dcc478b02bd35b214aabe60288a5a49`. Prior A5–A8 and full05 raw evidence were not touched; coordination paths are excluded from the protected digest, so that digest is not misrepresented as proof of their contents.

## What changed and why

1. **Actual mounted consumption, not builder credit.** The new collector mounts the real DashboardApp through the existing closed HTTP/SSE fixture and real query/parser, asserts the requested detail run and no inactive capture fetch, clicks native Receipt and Preview, then observes both native download href and image src. Requested/returned run and artifact, strict section/payload, exact origin and canonical one-ID URL must agree. Each sink must exist. It returns references only after successful observation, control restoration, unmount and read-abort validation. Failure produces named refusal plus the unchanged generic orphan through the SAME route accounting. No CLIENT_PATH pattern/root widening, typed dormant builder adoption, pending exception or route deletion.

2. **Genuine async capability census.** The original complete lifecycle/trust sweep remains. A real SQLite AuthorityDatabase stores a canonical DiagnosticBundle with a real content digest. Public detail initially does not advertise captures; after insertion, public lazy read and public detail verify exact bytes and yield available/count1. Only the returned availableSections are added. Schema, lifecycle and manifest comparisons remain bidirectional. A realm-local Uint8Array copy in this test stream is explained below; no shared byte-verifier change.

3. **Cleanup is part of accounting.** The reusable whole-app fixture now preserves prior URL/history state, act and ResizeObserver property descriptors, and prior body node identities. Root unmount, owned-host removal, history restoration and each global restoration are attempted even when another cleanup step fails. It never deletes foreign DOM to hide a leak. Primary/cleanup errors are aggregated, with caught cleanup cause retained. Real mounted effect callbacks provide mount/unmount failure controls; they do not replace the app/client. The collector's optional hooks are `beforeObservation(dialog) => restore`, `onMount`, `onUnmount`; these are test-only. Existing A10.2 fixture callers remain compatible.

4. **Explicit, exact fixture HTTP join.** `runCaptureScenario: "evidence"` selects two existing run identities only: failed run gets one PNG with all five closed origins, done run gets JPEG plus restricted JSON. All original broad corpus objects remain unchanged. Initial detail/lazy section/day/SSE agree on availability. Image SHA/size/dimensions derive from existing encoder-produced bytes through the existing format parser. No synthetic A10.2 DOM image metadata is reused as HTTP authority.

5. **Exact byte route and refusal dispatch.** Hono serves only `/artifacts/v1/:artifactId` from the opted-in exact map, with owned Response bytes, exact MIME/content length, attachment, no-store and nosniff. Unknown/default-scenario ids are 404, never another map entry. The Node adapter retains the exact Archive two-ID branch. Generic UUID-rooted descendants and extensionless invalid lookup paths go to the app's 404 instead of planted static HTML; named static files such as archive-help.html and archive-notes/readme.json remain static. Tests pin this boundary and ordinary API/static behavior. Production HTTP is untouched.

6. **Owning truth only.** Dashboard lesson and two D292 as-built paragraphs now distinguish mounted/HTTP proof from pending browser acceptance. The same owning integration document's capability table no longer contradicts D292 by calling the mounted Receipt consumer unserved; the separate generic status family/gallery remains deferred. This final one-line documentation correction occurred after the green code gates; no executable file changed after those gates.

## Proof matrix

| Requirement | Concrete proof |
|---|---|
| Two actual run/artifact pairs; full/short app Receipt; no inactive fetch | New collector pair tests plus unchanged A10.2 app/lifecycle suites in final run |
| Neither href nor src may be missing; unused builder grants nothing | Three native sink removal cases, dormant closure case, collector source negative control |
| Exact origin/run/artifact/section/schema/arity | Foreign origin/id/src, initial detail run, returned run/id, wrong section, extra key, invalid origin, Archive/bundle/extra-segment/query refusal cases |
| Generic/Archive accounting stays independent | Generic-only positive retains Archive orphan; unchanged isolated A8 tests retain generic orphan; aggregate green |
| No masking with route deletion/pending exception | Deleted generic route leaves native calls unserved; stale generic pending exception fails; all existing comparisons retained |
| Cleanup can fail without green credit | Real React mount and unmount effect failures; primary observation + secondary cleanup aggregate; exact prior history/globals/foreign DOM restoration |
| Actual ephemeral HTTP and canonical bytes | New nine-case HTTP file; exact JPEG/PNG/data bodies, MIME/SHA/count/dimensions, all5 origin tuples |
| No static fallback/scenario pollution | Planted invalid path bodies refused; default profile facts unchanged; existing Archive9 and corpus9 tests green |
| Assertion strength | Three sequential exact-restored source/helper controls below |

Image provenance: unchanged `tests/unit/fixtures/capture-image-fixtures.ts`, SHA `f55de3e413482f74075dafd2f5d130db3cde5556caeacfeef259abfa35d60cfd`, declares real macOS ImageIO/sips fixtures produced 2026-08-09. BASELINE_JPEG is 16×12; TRUECOLOUR_PNG is 10×14. Tests compare returned bodies against these exact source bytes, independently compare declared SHA/length, and pin dimensions; PNG IHDR is also read directly. JSON is exactly `{"fixture":"run-capture"}\n`. This is synthetic closed evidence, not live HR data or fabricated diagnostic authority.

## Gates, raw capture and exact restoration

Every Vitest used VITEST_MAX_WORKERS=1 and HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation. Every process used direct `set -o pipefail` + `2>&1 | tee <unique raw path>`; process exit was preserved. No raw log was reconstructed from tool-visible output.

[Complete execution/hash index](../evidence/dca4-a10-accounting-evidence-index.json) retains **all 23 actual gate runs**, exact invocations, UTC start/finish, sessions/chunks/exits, raw sizes/SHA256 and control restoration receipts. Each also has its individual `-execution.json` beside the untouched raw log.

| Gate/raw basename after dca4-a10-accounting- | Session | Exit | Result |
|---|---:|---:|---|
| wire-initial-red | 59385 | 1 | Exact original 2 failures /23 passes: section census and generic route orphan |
| cleanup-red → cleanup-green | 98648 →98325 | 1→0 | Prior-history regression red, then both restoration cases green |
| census-green / census-cause | 43942 /36075 | 1/1 | Test stream setup refusal; public lazy read minimized cause |
| census-green-02 | 34990 | 0 | Both census accounting tests green |
| wire-joined-01 | 87685 | 0 | 87 tests /3 files |
| http-initial-red | 94401 | 1 | New selected-scenario availability absent before implementation |
| http-green-01 | 37799 | 0 | 10 tests /2 files |
| http-refusal-red → http-refusal-green | 44988 →13485 | 1→0 | Three static-path wrong-arity reds; then all18 HTTP/Archive tests green |
| wire-final-precontrol | 48604 | 0 | Full then-current wire file49 tests |
| typecheck-01 | 93064 | 0 | Full locked typecheck |
| lint-01 | 51265 | 1 | One preserve-caught-error finding in mount/cleanup aggregation |
| focused-final | 52158 | 0 | **117 tests /6 files**, 10.28s |
| typecheck-final | 7977 | 0 | Full locked typecheck, 00:59:17.480Z–00:59:32.303Z |
| lint-final | 64739 | 0 | Full locked lint, 00:59:37.717Z–01:00:06.689Z |

Final focused command (all six complete files, no test filter):

```sh
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/wire-connectivity.test.ts tests/unit/dashboard/run-captures-app.test.ts tests/unit/dashboard/run-captures-lifecycle.test.ts tests/unit/dashboard/run-captures-fixture.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/parity-fixtures.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

The final 117 comprise wire50, app37, lifecycle3, generic HTTP9, unchanged Archive HTTP9, unchanged corpus9. Final raw hashes:
- focused `a5f3d54a53bf32536fad5ba4fdbabf251419a7d3e9e294c3e273b9e9ff772bc8`; chunks a37fc8/c3ad7c/f9abf6.
- typecheck `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036`; chunks eccfa9/9dc882/700a37/35b8d2.
- lint `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385`; chunks 3708c4/c50195/f8fa82/ee6367/7e7dfc/d19d35/8777a1.

### Source/helper negative controls

Exactly one control at a time; no assertion edits, timeout changes or broad normalizations. Baseline bytes/hashes are retained in [control-baseline](../evidence/dca4-a10-accounting-control-baseline.json); each mutation has a raw patch, direct raw log, execution record and immediate finally-restoration receipt.

| Control | Intended red | Restore proof | Restored positive |
|---|---|---|---|
| Collector returns [] after actual app observation | session12691 exit1: named generic orphan; filter `resolves every client-called path` | chunk2e43a7 exit0, 5562 bytes / `4439d5a8…` exact | session53157 exit0, 1pass /49skip |
| Remove genericCapture from Node HTTP dispatcher | session83029 exit1: advertised JPEG HTTP404≠200; filter `advertised exact generic JPEG` | chunk249ee0 exit0, 25096 bytes / `393944a8…` exact | session21350 exit0, 1pass /8skip |
| Flip first byte in fixture's returned owned copy | session13960 exit1: exact JPEG body mismatch (254 vs255), not status/MIME failure; same filter | chunk28c42e exit0, 4820 bytes / `c66c67d0…` exact | session63847 exit0, 1pass /8skip |

Controls mutate only the collector/fixture source under test, never canonical image bytes or Archive source/spec. Complete hashes and commands, not only these abbreviated display pins, are in the execution/hash index.

### Non-product red / evidence-generation dispositions

- Census test initially streamed a Node Buffer in the jsdom realm. The existing shared byte verifier refused `instanceof Uint8Array`; public readRunSection exposed “emitted a non-byte chunk.” The fixture now emits `new Uint8Array(bytes)`, retaining exact bytes. The two failed attempts remain under their original names, including misleading prospective name census-green; they are not represented as product regressions or green gates.
- First lint correctly required a cause on the nested mount/cleanup AggregateError. Added `{ cause: cleanupError }`; the original mount error remains first in the errors array. Final focused/type/lint ran after this correction.
- First local freeze receipt script used a nonexistent A8 end delimiter and exited1 in chunk a804ec before emitting JSON. The resulting empty `after.json` is unusable and retained, never called a before map. Corrected only that evidence script's delimiter; `after-verified.json` (chunk37189a exit0) records the pre-final-doc state, and `final-freeze.json` (chunk48ec1c exit0) is the final candidate. Neither replaces the original before record. No protected identity mismatch occurred.
- An optional post-gate read-only image literal extraction assumed a single literal rather than the source's joined string array and exited1 (chunk bff181). It produced no byte-hash evidence and changed no file. The actual HTTP tests use the real imported constants; no inference was substituted for their assertions.

## Limits, coordination and next proof

/ui's existing-system route and /tdd tests seam kept proof at actual app/native sinks and real HTTP rather than dormant functions. DOM connectivity is not computed layout, pixel, browser decoder or coarse-pointer proof. HTTP fixtures use explicitly unverified temporary static directories and owned port0 servers; they do not prove a stamped rendered bundle. The unchanged A10.2 DOM tests cover full/short receipts, lifecycle races, metadata, literal failure framing and simulated decoder refusal; no browser acceptance is claimed.

DCA2 integration overlap is explicit: this delta touches fixture-bff's profile inputs, lazy run facts, generic artifact route and Node dispatch, and imports the existing baseline JPEG source through a new generic fixture module. Parent/coordinator must reconcile DCA2's separately owned JPEG fixture work at integration. No foreign DCA2 files/changes were copied or written. Archive's separate exact route/scenario and assertions remain independent.

Proposed next bounded browser work (NOT created or executable yet): authorize a new `tests/parity/run-captures.spec.ts` using this opt-in evidence scenario, covering full/short Receipt native JPEG/PNG/data download identity and bytes, all origins and literal failure frames, keyboard Escape/focus return, coarse-pointer44px effective regions and edge/nonoverlap, two themes, image readiness/refusal and stable outer frame/metadata geometry. Only after that spec is implemented/reviewed and a heavy slot allocated would the proposed command be:
`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts`.
It was not run; no goldens exist for it. Parent owns broader acceptance, independent reviews and integration/full gates.

Pending logical commit category: D292 mounted-consumer connectivity plus exact opt-in fixture HTTP/test proof and owning as-built documentation. No commit until required full gates. No current scope blocker; candidate is ready for parent review with the above browser limits.

