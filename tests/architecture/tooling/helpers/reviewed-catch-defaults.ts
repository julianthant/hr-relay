/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/backend/runs/queries/run-detail/receipts-failures.ts",
    "sha256": "7776f5d9c84f281e4b130ccda95dbb5959d0dc3732e6b616f677741d411d77ba",
    "reason": "Only the canonical typed RerunRefusedError suppresses an unavailable recovery action; it grants no correction or retry. Unexpected snapshot, custody or validation failures propagate. Separate negative controls verify typed refusal and original unexpected-error propagation."
  },
  {
    "path": "src/backend/runtime/browser/onboarding-duo-provider.ts",
    "sha256": "4730bee5f4781cfcbdfffadfccad276d05537bca11de666dac614668b43be7c8",
    "reason": "Failed UNKNOWN retention or failure-report callbacks retain both causes and leave attempt/browser closure unproved. Context or broker termination revokes the owner and settles the attempt; physical profile deletion waits for owner cleanup and keeps all private-path and native closure checks. Worker stop failure remains uncertain until pump/report settlement and enclosing browser closure are proved; replacement or relaunch remains refused after unproved cleanup."
  },
  {
    "path": "src/backend/app/composition/dashboard/compose.ts",
    "sha256": "5a1f54db1254a3920090ee71595afd7ae83a0078165ab770a6153e1dfc94cfcb",
    "reason": "Startup source-closure uncertainty records failed producer closure before unwind, retaining dependent database and admission custody. Selected-context open failure retains typed custody uncertainty and rethrows. Upgrade cleanup clears exclusiveOwner only after release. Root lifetime transfer failure kills the spawned child and emits the original error; shutdown awaits owned child closure. Rejection observers preserve the original lifetime and immediate stop promises, whose callers await and propagate failures before storage release. An unavailable authority generation stays explicitly unavailable and backup presence is assessed separately. Required native browser closure failures follow the same upgrade rejection and custody-retention path."
  },
  {
    "path": "src/backend/app/composition/worker-compose.ts",
    "sha256": "e61641f9f61f92a5ffcc563f806a41246221c5a5dd6c5252cebe97d7cbf5b16f",
    "reason": "The bound native open validates authority in one SQLite snapshot before protected values are read. Failed opening cleanup retains the actual native database, issued admission and both original/close errors as custody uncertainty. Other open failures close the actual database before admission release and aggregate cleanup errors. Runtime cleanup releases admission only after proven database and browser closure. Maintenance failure stops rescheduling and signals the worker stop controller; composition surfaces the failure. Actual root or inherited lifetime custody remains held through shutdown."
  },
  {
    "path": "src/backend/accounts/chatgpt-account-service.ts",
    "sha256": "5e93187e7c2cbb5aeeadfa97926147263a1ca3f3243984fc941ad0aab90f8e64",
    "reason": "The empty catch drains only the rejection of an invalid Promise-valued synchronous authority check; assertAssistantCurrent immediately throws CHATGPT_ASSISTANT_REFUSED unless the result is exactly true. No account authority or availability is substituted. Other catches publish explicit errors or unconfirmed revocation."
  },
  {
      "path": "src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
      "sha256": "8f7b049c2d8625ca8d072fa1d5bdb27eba6acf0187b3530f8a4e79dc9937e54f",
      "reason": "Only ENOENT denotes no diagnostic stage directory (empty inventory, zero reclaimed stages or bytes) or an already absent captured file; all other errors rethrow. EEXIST verifies exact winner bytes; custody and cleanup failures throw or aggregate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "4c4caa82a69ab726740576666d28eb766353953e9ad9c927a20e72bb07aee780",
    "reason": "ENOENT alone denotes no backup directory; failed authority, credential, recovery or backup inspection publishes explicit unavailable, degraded or invalid health, and relocation-history verification failure makes restore unavailable."
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "sha256": "56ee76a497e98b2ea1c369b50d1ce84b70c6b33fd260315a775a9dab420996f0",
    "reason": "Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
  },
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-editor-model.ts",
    "sha256": "23a6f94a1b8f6209dbe8fa3133aca38d66ee1c0f1da4df7c12bc606dd47c7319",
    "reason": "Initial refresh publishes catalog failure; conflict and reload refresh rejections already publish readProblem with SETTINGS_REFRESH_UNAVAILABLE and retain the verified document and local drafts while admission stays blocked. SettingsReadSuperseded revokes obsolete observation settlement without publishing a current failure or accepting stale readback; command attempts and uncertainty are retained."
},
  {
    "path": "src/dashboard/surfaces/settings/providers/settings-protected-model.ts",
    "sha256": "558f28727e4d9d0739fb2e2ed2052ae1ee08f96bfa834f7a33aaa34652037451",
    "reason": "Only a before-effect refusal clears the attempt; unknown writes retain the exact attempt and draft and publish unconfirmed."
  },
  {
    "path": "src/dashboard/app/navigation/archive-route-model.ts",
    "sha256": "96519e6ef20e4aa19a27df5f8deb8c9bcc6fd0559bee8d0f018798b00fa39458",
    "reason": "Oversized or malformed supplied route JSON returns null; the URL-state caller marks archiveBrowseInvalid instead of substituting a parsed route."
  },
  {
    "path": "src/dashboard/ds/primitives/primitives-date.tsx",
    "sha256": "11a1f2b54858f4c97296409ca073c3d1324024c16bd7b395f95a4b4f2bfd1e01",
    "reason": "Invalid editable dates remain invalid without substitution; a supplied invalid bound now throws DS_DATE_BOUND_INVALID instead of silently dropping the constraint."
  },
  {
    "path": "src/models/dashboard/activity-volume.ts",
    "sha256": "e86030a210690c7f06ee550063b628ac9f113a2321d1e02a16b70aa8e17b25a0",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone."
  },
  {
    "path": "src/backend/storage/admission/installation.ts",
      "sha256": "eb14510f60103b80972240b75b9867d208a61973b01ad1c4967dd29a87452f41",
    "reason": "Only ENOENT returns explicit path absence; callers check it before creation or refusal, and other filesystem failures rethrow. Failed acquisition scans every nested aggregate and cause for source-closure uncertainty, retains exclusive lifetime custody when found, otherwise releases that capture, and always rethrows the failure. Descriptor, publication and inventory disposal failures retain source owners and original causes; fixed nonce mutation locks belong to credential-safe-file.ts."
  },
  {
    "path": "src/backend/runs/commands/ordinary-path-validator.ts",
    "sha256": "b432a6baa55c9f3c585213166cd4537698978f69f7eee1241bc107d6390a3f20",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/backend/transports/http/native-path-picker.ts",
    "sha256": "84cd2402e31c892f8376a8efed0e9efeec92b8f0175ba1350fc48e45124c8d36",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker."
  },
  {
    "path": "src/backend/runs/queries/item-attempt-history.ts",
    "sha256": "0a461642d4dc9a9278b761c9663bde7d5f98afec99d94c4b573721afe1be5e6f",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/workers/worker-supervisor.ts",
    "sha256": "b9e315489db5889974f9d5ea07190a4d12c6cfd6cac678db75ad1851f50b4159",
    "reason": "The rejection observer preserves the original drain promise, which shutdown races and propagates as aggregate failure. A failed owned-child exit reconciliation is retained as recoveryFailure, reported through onFault, blocks spawn and lifecycle reuse, and is included in the final drain failure rather than becoming successful exit settlement."
  },
  {
    "path": "src/backend/logs/browser-action-drain.ts",
    "sha256": "e9b09cc2f9407f5b52a3ea9ae3389b649b63ab7d559d62fdc99928a2654589a3",
    "reason": "A failed note warn records warningFailed and keeps draining; a failed health report records report-failed. Neither invents delivered notes from a diagnostic failure; task screenshot failures are retained for caller settlement."
  },
  {
    "path": "src/backend/logs/confirmed-action-publisher.ts",
    "sha256": "ef0e6fa2ebeb8700620def7ad4ee262c6899d7f0d1a96ec3f79cfddbbcb837a1",
    "reason": "A failing health observer sets diagnosticFailure and keeps the publisher's own state; queue acceptance is still never reported as durable delivery."
  },
  {
    "path": "src/dashboard/app/navigation/view-route-model.ts",
    "sha256": "72534f412535070615d068ba54639ad429c9c23ab3efb6ffde12e392974f1038",
    "reason": "Oversized or invalid view-route JSON returns null; the caller treats the route as unreadable instead of rebuilding shell navigation from a default."
  },
  {
    "path": "src/backend/storage/sqlite/authority-boot.ts",
    "sha256": "a83c56f6def1c1caf87975733313b34dee23f91072c0064cb3030c875083495f",
    "reason": "A failed open or inspection returns degraded-read-only with mutations blocked; only successful close clears the database handle, and uncertain close preserves the handle and aggregate cause."
  },
  {
    "path": "src/backend/storage/sqlite/authority-database.ts",
    "sha256": "ebd04e7c4f14d49779297a14b4f76d28e5804f2bd919a1273c223adcb93a8208",
    "reason": "Failed constructor cleanup retains the actual native database and admission with both opening and close failures. Failed rollback retains database custody with the original failure; successful rollback still rethrows it. Failed external validation invalidates the admission cache and throws the original mutation error or named search refusal, never validated data. Malformed diagnostics remain explicit. Stopped inspection, upgrade and finite queued cancellation retain original, rollback and close failures before custody releases; required native browser closure precedes cancellation."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "9d126991d2a6b2aae868121c86137f04626a2dac4c49c418b54ef963571ccfd4",
    "reason": "Only ENOENT returns absent source metadata; the caller rejects a missing main database and permits absent optional sidecars. Unsafe or changed sources throw. Construction and read failures rethrow after private cleanup; failed database close or snapshot disposal retains the resource owners and original causes as source-closure uncertainty, never a read result."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "61467990efe4e97ded7b4f8af942880a1c93da793bc96e098e8daf404b4e26da",
    "reason": "Unproved startup proof source closure retains the original opened resource, admission and process handles before any dependent cleanup. Failed admission releases custody only after the opened resource closes successfully; close and release failures retain custody and original errors. Descriptor-bound worker/recovery reads aggregate any read and close failures, then rethrow; receipt absence alone preserves ordinary stale-owner refusal. Restore-publication cleanup preserves primary failures and refuses uncertain closure; failed worker handoff marks custody uncertain before any replacement release."
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "sha256": "5a62f900a16060d06abe7166c0a3fa9b3469d8c5aec775e8eb5d159bc6b57bc6",
    "reason": "The navigation rejection observer preserves the original promise raced by the training-reminder wait; the landing wait owns timeout and diagnosis. An empty diagnostic title accompanies LANDING_PROBE_UNAVAILABLE and a thrown BrowserLandingStallError with the original landing cause, never authenticated success. Probe uncertainty stays explicit; initiated clicks drain before settlement, and compound click, disposal and landing failures retain their causes."
  },
  {
    "path": "src/dashboard/state/activity-wiring-adapter.ts",
    "sha256": "bc18bae15b37e0f39a3fb62d52c402b7084c4a4b3ac4e8fbac891acdeaf7eb48",
    "reason": "The population observation consumes a rejection only after createSettingsRead publishes failed with its held selection. useActivityWiring exposes the catalog notice and revokes exports/navigation, preserving a coherent completed report and browse as history; superseded reads cannot publish or replace the current pair."
},
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-facts-model.ts",
    "sha256": "e9c2c3608b6b658b7002788795b478265e8211b3a82fd4f8d4ff96d20ad516b3",
    "reason": "createSettingsRead publishes failed before the facts observation rejects. useSettingsFacts returns SETTINGS_INITIAL_READ_UNAVAILABLE with any held facts, and FactsPane renders the catalog failure beside those exact facts; superseded identity reads cannot publish."
},
  {
    "path": "src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.ts",
    "sha256": "d514cc6f756dde3823fe115093cf1c38fd7266b1525383f6777156e2a9f3d340",
    "reason": "Only CellCoercionError or ZodError makes the field-validation predicate false; the caller marks the supplied value invalid. Unknown field IDs and unexpected errors throw. Blank cells are explicitly optional and never substituted."
  },
  {
    "path": "src/backend/app/bootstrap/secure-env-bootstrap.ts",
    "sha256": "5c842a5699e7d1cc055d523ac3b8486c8701f93cc418d0dc0ac7e8991c8b069c",
    "reason": "The root listener or inherited lifetime is acquired before admission. Unproved source closure retains admission and rethrows; typed runtime or source-closure uncertainty retains the outer lifetime, while settled paths await its close. Stopped maintenance releases admission only when custody was not retained. No failed bootstrap becomes successful runtime admission. The real browser closure port is supplied to dashboard admission and offline cancellation without changing the failure-retention path."
  },
  {
    "path": "src/backend/storage/configuration/duo-credential-store.ts",
    "sha256": "78357e8df2b393ec9bdff85ddea7ac1f765ec82e0ef7fc36644a71debdd1c6e0",
    "reason": "The census clears only parsed envelope metadata when arbitrary file bytes fail UTF-8, JSON or envelope validation; filesystem failures propagate. Matching canonical bytes or digest still classify the file unauthorized, and valid same-profile envelopes distinguish managed backups. Restore and erase refuse unauthorized copies; no canonical credential read or publication failure becomes success."
  },
  {
    "path": "src/backend/storage/sqlite/backup-inspection.ts",
    "sha256": "361392559d62ba18705f8baf9a3843d69cd9eccaa48c9bb269d09c877a109ef6",
    "reason": "Snapshot and database cleanup failures accumulate and rethrow as source-closure uncertainty; the empty list is the accumulator, and the original inspection error is never dropped."
  },
] as const;
