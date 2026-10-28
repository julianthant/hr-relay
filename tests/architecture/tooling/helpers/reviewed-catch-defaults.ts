/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/backend/runs/queries/run-detail/receipts-failures.ts",
    "sha256": "7776f5d9c84f281e4b130ccda95dbb5959d0dc3732e6b616f677741d411d77ba",
    "reason": "Only the canonical typed RerunRefusedError suppresses an unavailable recovery action; it grants no correction or retry. Unexpected snapshot, custody or validation failures propagate. Separate negative controls verify typed refusal and original unexpected-error propagation."
  },
  {
    "path": "src/backend/profiles/onboarding-duo-provider.ts",
    "sha256": "9af03823e468c469cd4298c9636ce27f8b0f7e46ca7614ce0f3e2777017106ce",
    "reason": "A failed UNKNOWN-retention or failure-report callback marks closure unproved and retains the original and retention errors. Closure propagates that stored failure with both causes, keeps the active attempt and browser uncertain, and refuses replacement or relaunch; it never reports successful cleanup. Worker stop failure remains uncertain while pump/report settlement is awaited, and the enclosing browser close retains both causes."
  },
  {
    "path": "src/backend/app/composition/dashboard/compose.ts",
    "sha256": "a605e2f02d4d9d049f217d3e28b3b559a4a0e4b0f8ce778a506b300663fc8d32",
    "reason": "Startup proof source-closure uncertainty marks producer closure unproved before unwind, retaining dependent database and process custody. A failed selected-context open marks database closure unproved for typed custody uncertainty and rethrows. Upgrade cleanup clears exclusiveOwner only after release; source-closure uncertainty retains it. Rejection observers leave the original lifetime failure and immediate stop promises intact: the CLI races failure, stop awaits closure, and both retain failures before dependent storage release. An unavailable authority generation stays explicitly unavailable and backup presence is assessed separately."
  },
  {
    "path": "src/backend/app/composition/worker-compose.ts",
    "sha256": "45f030b422ace6c57625843d92449fee85f2b7154f345caa66a32772e42faed9",
    "reason": "A throwing actual database close records failed closure and preserves the original error; the wrapper throws typed custody uncertainty before parent release. Startup and runtime cleanup release child and process custody only after proven resource and database closure. The maintenance tick retains its first error, stops rescheduling, signals the worker stop controller, and compose surfaces it as a failed report."
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
    "sha256": "383186ffd3199ca35d6d9a1422cccdc084f1d2530b2ec2d96a4d8d397de4adc6",
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
      "sha256": "b1a287723636fc099524581ddb0b902ba95f189b36295b3a9782a86d25823495",
    "reason": "Only ENOENT denotes path absence; healthy registry observation permits direct or private-reader wrapped ENOENT only when the whole generic mutex is absent and final canonical profile evidence revalidates; all other errors propagate. Descriptor and directory close failures retain source custody and original failures; publication cleanup aggregates failures. Abandoned-mutex recovery retains restore custody on unproved closure, and inventory disposal refuses release on failed closure."
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
    "sha256": "876f9298455edeb9962c23b5d99a1003e9aa5929070adb5e447163c819acd4b2",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
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
    "sha256": "73028be2a839bdd4b8f638bbb040ef3fe826449ac7184035cd97274d1ec5da62",
    "reason": "The empty rollback-failure accumulator cannot settle migration success: rollback failure retains database custody with the original error, and successful rollback rethrows that error. Failed external validation clears only its admission cache and throws the mutation error or run-search-index-rebuild-required. Malformed diagnostics remain explicit; stopped inspection and upgrade retain failed source closure and original causes. Finite native6 queued cancellation rolls back on failure and retains original plus rollback or database-close failures before installation or restore custody can release."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "bfec50d0f6b3dbea8525b721950a29723cb981552066f56360be5ede97d5d79b",
    "reason": "Only ENOENT returns absent source metadata; the caller rejects a missing main database and permits absent optional sidecars. Unsafe or changed sources throw. Construction and read failures rethrow after private cleanup; failed database close or snapshot disposal retains the resource owners and original causes as source-closure uncertainty, never a read result."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "b8e0e0fd46bcee4c550d33ecb598f3e662b24a86d702bb7b994969cfb693644f",
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
    "sha256": "91d161a61ca16b7cc7e26090fa741b22dc884b424cbe9258bbaa04d59268b333",
    "reason": "An unproved source closure keeps stopped maintenance custody and rethrows; release runs only when custody was not retained. Offline process-recovery failure prints the catalogued refusal and rethrows the same error, including retained-resource identity."
  },
  {
    "path": "src/backend/storage/configuration/duo-credential-store.ts",
    "sha256": "cb38c1ffaf96d9e4537c61d87a7b1ea2d63226da4792858ab6668f73adb31f99",
    "reason": "The census clears only parsed envelope metadata when arbitrary file bytes fail UTF-8, JSON or envelope validation; filesystem failures propagate. Matching canonical bytes or digest still classify the file unauthorized, and valid same-profile envelopes distinguish managed backups. Restore and erase refuse unauthorized copies; no canonical credential read or publication failure becomes success."
  },
  {
    "path": "src/backend/storage/sqlite/backup-inspection.ts",
    "sha256": "361392559d62ba18705f8baf9a3843d69cd9eccaa48c9bb269d09c877a109ef6",
    "reason": "Snapshot and database cleanup failures accumulate and rethrow as source-closure uncertainty; the empty list is the accumulator, and the original inspection error is never dropped."
  },
] as const;
