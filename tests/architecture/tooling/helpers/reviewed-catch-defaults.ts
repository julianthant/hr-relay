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
    "sha256": "77171ff75659e0aa8b995ef8fe9901c5d9fffc71f0cab2b806fe166697f7368f",
    "reason": "Failed UNKNOWN retention or failure-report callbacks retain both causes and leave attempt/browser closure unproved. Context or broker termination revokes the owner and settles the attempt; physical profile deletion waits for owner cleanup and keeps all private-path and native closure checks. Worker stop failure remains uncertain until pump/report settlement and enclosing browser closure are proved; replacement or relaunch remains refused after unproved cleanup."
  },
  {
    "path": "src/backend/app/composition/dashboard/compose.ts",
    "sha256": "eb6dfc2188831da1e75aa5aeb71efb615151ad6b7047c9341efcb2a3260f54f2",
    "reason": "Startup source-closure uncertainty records failed producer closure before unwind, retaining dependent database and admission custody. Selected-context open failure retains typed custody uncertainty and rethrows. Unproved upgrade failure remains retained in the exact exclusive admission and root lifetime; settled cleanup clears exclusiveOwner only after release. Root lifetime transfer failure kills the spawned child and emits the original error; shutdown awaits owned child closure. Rejection observers preserve the original lifetime and immediate stop promises, whose callers await and propagate failures before storage release. An unavailable authority generation stays explicitly unavailable and backup presence is assessed separately. Required native browser closure failures follow the same upgrade rejection and custody-retention path."
  },
  {
    "path": "src/backend/app/composition/worker-compose.ts",
    "sha256": "cded6780300b999531493f8d96c45addbc5cd17c1def69010218d6af469cee3d",
    "reason": "The bound native open validates authority in one SQLite snapshot before protected values are read. Failed opening cleanup retains the actual native database, issued admission and both original/close errors as custody uncertainty. Other open failures close the actual database before admission release and aggregate cleanup errors. Runtime cleanup releases admission only after proven database and browser closure. Maintenance failure stops rescheduling and signals the worker stop controller; composition surfaces the failure. Actual root or inherited lifetime custody remains held through shutdown."
  },
  {
    "path": "src/backend/accounts/chatgpt-account-service.ts",
    "sha256": "b2348eab54084a0bf3788d10a050cd21a87e2a4753210dc5a6cbe5ebdb17b9ae",
    "reason": "The empty catch drains only the rejection of an invalid Promise-valued synchronous authority check; assertAssistantCurrent immediately throws CHATGPT_ASSISTANT_REFUSED unless the result is exactly true. No account authority or availability is substituted. A reader is released only after successful cancel/release or matching typed cancellation proof; other closure failures retain the exact reader and response as resource uncertainty. Other catches publish explicit errors or unconfirmed revocation."
  },
  {
      "path": "src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
      "sha256": "dcdf682261c2bda36edcd48a41e2a510a01c00f64420f3053293e1cfb1889ce6",
      "reason": "Only ENOENT denotes no diagnostic stage directory (empty inventory, zero reclaimed stages or bytes) or an already absent captured file; all other errors rethrow. EEXIST verifies exact winner bytes; custody and cleanup failures throw or aggregate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "fb684a74ef299166adfc1fc0de17ae7092d9ab85e2bfbdefdaf1f67d1df3470e",
    "reason": "ENOENT alone denotes no backup directory; failed authority, credential, recovery or backup inspection publishes explicit unavailable, degraded or invalid health, and failed logical backup identity verification makes restore unavailable."
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "sha256": "8daaad37d471b8375ffe38b3302b545baaaed4628c7e76c5c56466a52d859192",
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
      "sha256": "682f93cefc78e53619237242d86c6d891a1e83903eeed2c32e67297e854075a1",
    "reason": "Failed acquisition scans every nested aggregate and cause for source-closure uncertainty, retains exclusive lifetime custody when found, otherwise releases that capture, and always rethrows the failure. Descriptor, publication and inventory disposal failures retain source owners and original causes; fixed nonce mutation locks belong to credential-safe-file.ts."
  },
  {
    "path": "src/backend/runs/commands/ordinary-path-validator.ts",
    "sha256": "0d0876737df01921f47637505d9845abf84564550cb0498b17c923bbc85887d6",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/backend/transports/http/native-path-picker.ts",
    "sha256": "b2f11f83ba5d48780b419b3ba3e077d410073481b064bc54f1948cec7db78e10",
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
    "sha256": "8b750c18f9508bb12a57f1b9c11dc9e86184eb47a4e3d87097336b32d27a83fa",
    "reason": "Failed constructor cleanup retains the actual native database and admission with both opening and close failures. Failed rollback retains database custody with the original failure; successful rollback still rethrows it. Failed external validation invalidates the admission cache and throws the original mutation error or named search refusal, never validated data. Malformed diagnostics remain explicit. Stopped inspection, upgrade and finite queued cancellation retain original, rollback and close failures before custody releases; required native browser closure precedes cancellation."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "31c9df985b15811e52815997ad03501a781d18e9214f3533bb08007216bfce75",
    "reason": "Only ENOENT returns absent source metadata; the caller rejects a missing main database and permits absent optional sidecars. Unsafe or changed sources throw. Construction and read failures rethrow after private cleanup; failed database close or snapshot disposal retains the resource owners and original causes as source-closure uncertainty, never a read result."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "81da3e5033cbc122260b7faf349de37f927de8a583d98cdd1a3eaffc87c80de2",
    "reason": "Unproved startup proof source closure retains the original opened resource, admission and process handles before any dependent cleanup. Failed admission releases custody only after the opened resource closes successfully; close and release failures retain custody and original errors. Descriptor-bound worker/recovery reads aggregate any read and close failures, then rethrow; receipt absence alone preserves ordinary stale-owner refusal. Restore-publication cleanup preserves primary failures and refuses uncertain closure; failed worker handoff marks custody uncertain before any replacement release."
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "sha256": "4b4aceac9796ee6d65bb2197e33fe2e28ef8d482db8e3c302339df4dc21607cb",
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
    "sha256": "7a50724cfd8a328d4b80d8b8ff5e7d8507d06acb0d1070d85fbb27b5c64cb9ab",
    "reason": "The root listener or inherited lifetime is acquired before admission. Unproved source closure retains admission and rethrows; typed runtime or source-closure uncertainty retains the outer lifetime, while settled paths await its close. Stopped maintenance releases admission only when custody was not retained. No failed bootstrap becomes successful runtime admission. The real browser closure port is supplied to dashboard admission and offline cancellation without changing the failure-retention path."
  },
  {
    "path": "src/backend/storage/admission/process-root.ts",
    "sha256": "6b8b810148e265daab5dff80adfe06f497d27ad927268af55c4eaaf544c9308f",
    "reason": "Only ENOENT reports explicit control-path absence. Callers check absence before creation or permit a missing old-build process root; other filesystem failures rethrow. Existing roots must pass ancestry and private-directory checks, and any artifact produces the named old-build refusal."
  },
  {
    "path": "src/backend/storage/configuration/canonical-credential-store.ts",
    "sha256": "29501abbca72e4a478770141323436ccebba9828974b30218cc753195c9dc92a",
    "reason": "The catch revokes the asynchronous ChatGPT lease by clearing its active flag, retains any unproved source and exact process lock, and rethrows the settled body error or translates the failure to a named credential refusal. It never substitutes a credential record or successful result. Other catches preserve explicit busy, unavailable, pending or uncertain failures and retain source owners before rethrowing."
  },
  {
    "path": "src/backend/storage/sqlite/backup-inspection.ts",
    "sha256": "b66b5731012aa0bbc9359a5e158b0978059eed93970b09a9e505dc9f35c1143c",
    "reason": "Snapshot and database cleanup failures accumulate and rethrow as source-closure uncertainty; the empty list is the accumulator, and the original inspection error is never dropped."
  },
] as const;
