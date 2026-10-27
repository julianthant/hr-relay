/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/backend/app/composition/dashboard/compose.ts",
    "sha256": "8ac58147e0764e0eda8555a553d22b9d03c4968c10352ae88bd18c9988c9fbe1",
    "reason": "A failed selected-context open marks database closure unproved only for typed custody uncertainty and immediately rethrows; process release remains fenced. Startup and stop cleanup retain every failed required producer closure and original cause before dependent storage release."
  },
  {
    "path": "src/backend/app/composition/worker-compose.ts",
    "sha256": "ebf7584175778cb374978923ef0cf5b811f1dbeb91e517e35e93b41172048587",
    "reason": "A throwing actual database close records failed closure and preserves the original error; the wrapper throws typed custody uncertainty before parent release. Startup and runtime cleanup release child and process custody only after proven resource and database closure."
  },
  {
    "path": "src/backend/accounts/chatgpt-account-service.ts",
    "sha256": "5f03e5b9265314336fa45661abe73da27a86294cbc19f13f2b35d64c0500314f",
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
      "sha256": "4d8fbac7c75ee223447c0b5beff6eba816af4d69364be6e55ad5ee0b1738bdc6",
    "reason": "Only ENOENT denotes path absence; healthy registry observation permits direct or private-reader wrapped ENOENT only when the whole generic mutex is absent and final canonical profile evidence revalidates; all other errors propagate."
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
    "sha256": "125d0f7314956929086dbfc750a56e69189596a05f2da985a57a81d68b8b0271",
    "reason": "Failed external source validation clears only its admission cache and then throws the original mutation error or run-search-index-rebuild-required; malformed diagnostic reads remain explicit malformed states. Named missing-proof recovery retains the original uncertain operation and barrier without success. Claimed-profile configuration rebase rolls back and rethrows; failed rollback or database close retains custody and the original cause."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "53ea2fb8be0e70f8e928d788d8aae3ae40d2336cf2e439802fa6806941caebbf",
    "reason": "Only ENOENT denotes an absent optional sidecar; a missing main database throws, unsafe or changed inputs throw, and failed construction disposes only its private snapshot before rethrowing."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "5103d20ea27cad73d607637b25218a0de9fe82d0c0062445430f9d7ca9c4d2a6",
    "reason": "Failed admission releases custody only after the opened resource closes successfully; close and release failures remain aggregate errors, uncertain resources keep their custody, and the original admission error always rejects."
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "sha256": "839a651d275ebd4ddb441b4bc624c8aaaf1fa124f0d7216a9f36b7ae0ebbf03a",
    "reason": "Stall probes report explicit unknown codes (landing-probe-unavailable, duo-refusal-unproven); every stalled landing still throws BrowserLandingStallError or DuoTerminalRefusalError, the refusal, stale-request, and training-reminder observers leave observation timeout and diagnosis to the landing wait, and training-reminder click failures remain explicit BrowserLoginError failures. Initiated bound-element clicks drain before landing or cancellation settles; compound click, disposal, and landing failures retain their original causes."
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
    "sha256": "f5aa1a473db2743a5ecac3219c979d515662be7ab2d9851ddf1346ea0e291740",
    "reason": "An unproved source closure keeps the stopped machine-control admission and rethrows; release runs only when that custody was not retained."
  },
  {
    "path": "src/backend/storage/configuration/duo-credential-store.ts",
    "sha256": "5bab6b8375f13223a87e0f4694407f003d4aceaf5b247c424720c487b7a3cd07",
    "reason": "A file that does not parse as a Duo publication envelope stays unread; only a matching digest or embedded canonical credential keeps it in the unauthorized or backup set."
  },
  {
    "path": "src/backend/storage/sqlite/backup-inspection.ts",
    "sha256": "361392559d62ba18705f8baf9a3843d69cd9eccaa48c9bb269d09c877a109ef6",
    "reason": "Snapshot and database cleanup failures accumulate and rethrow as source-closure uncertainty; the empty list is the accumulator, and the original inspection error is never dropped."
  },
] as const;
